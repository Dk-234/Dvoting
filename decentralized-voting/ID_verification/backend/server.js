// backend/server.js (improved with image preprocessing + QR reader + country-agnostic ID)
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Tesseract from 'tesseract.js';
import { ethers } from 'ethers';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import sharp from 'sharp';
import jsQR from 'jsqr';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve ID verification frontend at /verify
const idFrontendDir = path.join(__dirname, '..', 'frontend');
app.use('/verify', express.static(idFrontendDir));

// Serve voting frontend at / (root)
const votingFrontendDir = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(votingFrontendDir));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|bmp|tiff|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Store verification results temporarily
const verificationCache = new Map();

// ============================================================
//  IMAGE PREPROCESSING (sharp) — adaptive multi-variant pipeline
// ============================================================

async function preprocessImage(inputPath) {
    console.log('🖼️  Preprocessing image (adaptive pipeline)...');
    const variants = []; // paths of preprocessed images

    try {
        const metadata = await sharp(inputPath).metadata();
        const origW = metadata.width || 1;
        const origH = metadata.height || 1;
        console.log(`   Original: ${origW}×${origH}  format: ${metadata.format}`);

        // ── Adaptive target width ──
        // ID cards ~3.375" wide → need ≥300 DPI → ~1012 px.
        // But Tesseract works much better at 400-600 DPI equivalent.
        // We always upscale so the width lands between 3200-4000 px,
        // regardless of the original size.
        const MIN_TARGET = 3200;
        const MAX_TARGET = 4000;
        let targetW;
        if (origW < MIN_TARGET) {
            targetW = MIN_TARGET;                     // upscale small images
        } else if (origW > MAX_TARGET) {
            targetW = MAX_TARGET;                     // downscale huge images to save time
        } else {
            targetW = origW;                          // already in the sweet spot
        }

        const scale = targetW / origW;
        const targetH = Math.round(origH * scale);
        console.log(`   Target: ${targetW}×${targetH}  (scale ${scale.toFixed(2)}x)`);

        // Helper: resize any sharp pipeline to the adaptive target
        const applyResize = (pipe) =>
            scale !== 1
                ? pipe.resize(targetW, targetH, {
                      fit: 'fill',
                      kernel: sharp.kernel.lanczos3,
                      withoutEnlargement: false,
                  })
                : pipe;

        // ---- Variant 1: Grayscale + normalize + sharpen ----
        const v1Path = inputPath.replace(/(\.[\w]+)$/i, '_v1.png');
        await applyResize(sharp(inputPath).png())
            .grayscale()
            .normalize()
            .sharpen({ sigma: 2.0 })
            .toFile(v1Path);
        variants.push(v1Path);

        // ---- Variant 2: Grayscale + low threshold (keeps only very dark text) ----
        const v2Path = inputPath.replace(/(\.[\w]+)$/i, '_v2.png');
        await applyResize(sharp(inputPath).png())
            .grayscale()
            .normalize()
            .threshold(100)
            .toFile(v2Path);
        variants.push(v2Path);

        // ---- Variant 3: Grayscale + medium threshold ----
        const v3Path = inputPath.replace(/(\.[\w]+)$/i, '_v3.png');
        await applyResize(sharp(inputPath).png())
            .grayscale()
            .normalize()
            .threshold(150)
            .toFile(v3Path);
        variants.push(v3Path);

        // ---- Variant 4: Grayscale + high threshold (captures lighter text) ----
        const v4Path = inputPath.replace(/(\.[\w]+)$/i, '_v4.png');
        await applyResize(sharp(inputPath).png())
            .grayscale()
            .normalize()
            .threshold(200)
            .toFile(v4Path);
        variants.push(v4Path);

        // ---- Variant 5: Denoise (median) + normalize + sharpen ----
        const v5Path = inputPath.replace(/(\.[\w]+)$/i, '_v5.png');
        await applyResize(sharp(inputPath).png())
            .grayscale()
            .median(3)          // 3×3 median filter removes salt-and-pepper noise
            .normalize()
            .sharpen({ sigma: 1.5 })
            .toFile(v5Path);
        variants.push(v5Path);

        // ---- Variant 6: Colour preserved + sharpen (ID holograms, coloured text) ----
        const v6Path = inputPath.replace(/(\.[\w]+)$/i, '_v6.png');
        await applyResize(sharp(inputPath).png())
            .normalize()
            .sharpen({ sigma: 1.5, m1: 1.0, m2: 0.5 })
            .toFile(v6Path);
        variants.push(v6Path);

        // ---- Variant 7: Inverted (white-on-dark → dark-on-white) ----
        const v7Path = inputPath.replace(/(\.[\w]+)$/i, '_v7.png');
        await applyResize(sharp(inputPath).png())
            .grayscale()
            .negate({ alpha: false })
            .normalize()
            .sharpen({ sigma: 1.5 })
            .toFile(v7Path);
        variants.push(v7Path);

        console.log(`   ✅ Created ${variants.length} adaptive variants`);
        return variants;
    } catch (error) {
        console.error('   ⚠️  Preprocessing error:', error.message);
        return variants;  // OCR will fall back to the original image
    }
}

// ============================================================
//  QR CODE READER (sharp + jsQR) — fixed buffer alignment
// ============================================================

async function readQRCode(imagePath) {
    console.log('📱 Scanning for QR codes (multi-strategy)...');

    // Helper: safely convert a Node Buffer to a Uint8ClampedArray
    const toPixels = (buf) =>
        new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);

    // Helper: try jsQR on a sharp pipeline and return result or null
    async function tryQR(pipeline, label) {
        try {
            const { data, info } = await pipeline
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });

            const code = jsQR(toPixels(data), info.width, info.height);
            if (code && code.data && code.data.length > 0) {
                console.log(`   ✅ QR found [${label}]: ${code.data.substring(0, 120)}...`);
                return { found: true, data: code.data, location: code.location };
            }
        } catch (e) {
            // silently continue to next strategy
        }
        return null;
    }

    try {
        const metadata = await sharp(imagePath).metadata();
        const w = metadata.width || 1;
        const h = metadata.height || 1;

        // ── Strategy 1: Full image at multiple sizes & thresholds ──
        const widths = [w, 1600, 2400, 3200];
        const thresholds = [null, 100, 128, 160, 200]; // null = no threshold (grayscale+normalize)

        for (const tw of widths) {
            for (const thr of thresholds) {
                let pipe = sharp(imagePath).resize({ width: tw, withoutEnlargement: tw <= w });
                pipe = pipe.grayscale().normalize();
                if (thr !== null) pipe = pipe.threshold(thr);
                else pipe = pipe.sharpen();

                const result = await tryQR(pipe, `full-${tw}-thr${thr ?? 'none'}`);
                if (result) return result;
            }
        }

        // ── Strategy 2: Inverted (light QR on dark background) ──
        for (const tw of [w, 2400]) {
            const pipe = sharp(imagePath)
                .resize({ width: tw, withoutEnlargement: tw <= w })
                .grayscale()
                .negate({ alpha: false })
                .normalize();
            const result = await tryQR(pipe, `inverted-${tw}`);
            if (result) return result;
        }

        // ── Strategy 3: Crop quadrants (QR is often in a corner) ──
        const regions = [
            { left: 0,               top: 0,               width: Math.floor(w / 2), height: Math.floor(h / 2), label: 'top-left' },
            { left: Math.floor(w/2), top: 0,               width: Math.floor(w / 2), height: Math.floor(h / 2), label: 'top-right' },
            { left: 0,               top: Math.floor(h/2), width: Math.floor(w / 2), height: Math.floor(h / 2), label: 'bottom-left' },
            { left: Math.floor(w/2), top: Math.floor(h/2), width: Math.floor(w / 2), height: Math.floor(h / 2), label: 'bottom-right' },
            // Center crop (some IDs have QR in center)
            { left: Math.floor(w*0.25), top: Math.floor(h*0.25), width: Math.floor(w*0.5), height: Math.floor(h*0.5), label: 'center' },
        ];

        for (const region of regions) {
            // Ensure region is valid
            if (region.width < 50 || region.height < 50) continue;
            if (region.left + region.width > w) region.width = w - region.left;
            if (region.top + region.height > h) region.height = h - region.top;

            for (const thr of [null, 128]) {
                let pipe = sharp(imagePath)
                    .extract(region)
                    .resize({ width: 1200, withoutEnlargement: false })
                    .grayscale()
                    .normalize();
                if (thr !== null) pipe = pipe.threshold(thr);
                else pipe = pipe.sharpen();

                const result = await tryQR(pipe, `crop-${region.label}-thr${thr ?? 'none'}`);
                if (result) return result;
            }
        }

        // ── Strategy 4: Rotations (90°, 180°, 270°) ──
        for (const angle of [90, 180, 270]) {
            const pipe = sharp(imagePath)
                .rotate(angle)
                .resize({ width: 2400, withoutEnlargement: false })
                .grayscale()
                .normalize()
                .sharpen();
            const result = await tryQR(pipe, `rotated-${angle}`);
            if (result) return result;
        }

        console.log('   ℹ️  No QR code detected after exhaustive scan');
        return { found: false, data: null };
    } catch (error) {
        console.error('   ⚠️  QR scan error:', error.message);
        return { found: false, data: null, error: error.message };
    }
}

// ============================================================
//  OCR — run on all variants, pick best result (by confidence)
// ============================================================

async function processImageWithOCR(imagePath) {
    console.log('🔄 Processing image with OCR (best-result strategy)...');

    // Create preprocessed variants
    const variants = await preprocessImage(imagePath);

    // Always include the original as the last variant
    variants.push(imagePath);

    // Collect results per variant
    const results = []; // { label, text, confidence }

    for (let i = 0; i < variants.length; i++) {
        const variantPath = variants[i];
        const label = variantPath === imagePath ? 'original' : `v${i + 1}`;

        try {
            // Use eng+hin (English + Hindi) for Indian IDs; fall back to eng only
            const ocrLang = 'eng';
            const { data: { text, confidence } } = await Tesseract.recognize(
                variantPath,
                ocrLang,
                {
                    logger: i === 0
                        ? m => console.log(`   OCR [${label}]: ${m.status} ${Math.round(m.progress * 100)}%`)
                        : () => {},
                }
            );

            const conf = Math.round(confidence);
            console.log(`   ✅ OCR [${label}]  confidence: ${conf}%  chars: ${text.length}`);
            results.push({ label, text, confidence: conf });
        } catch (err) {
            console.error(`   ❌ OCR [${label}] error:`, err.message);
        }
    }

    // Clean up preprocessed files (not the original)
    for (const v of variants) {
        if (v !== imagePath) {
            try { fs.unlinkSync(v); } catch (_) {}
        }
    }

    if (results.length === 0) {
        console.log('   ⚠️  All OCR variants failed');
        return '';
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);

    const best = results[0];
    console.log(`   🏆 Best variant: [${best.label}] at ${best.confidence}% confidence`);

    // Combine best text with unique content from runner-up variants.
    // This captures any data that appeared clearly in a different variant
    // without diluting the main text with garbage from low-confidence runs.
    let combined = best.text;
    const RUNNER_UP_THRESHOLD = best.confidence * 0.75; // at least 75% of best
    for (let i = 1; i < results.length; i++) {
        if (results[i].confidence >= RUNNER_UP_THRESHOLD) {
            combined += '\n---VARIANT-BREAK---\n' + results[i].text;
        }
    }

    console.log(`   📝 Using ${results.filter(r => r.confidence >= RUNNER_UP_THRESHOLD).length}/${results.length} variants  (combined ${combined.length} chars)`);
    return combined;
}

// ============================================================
//  ID NUMBER EXTRACTION (context-aware per ID type)
// ============================================================

function extractIDNumber(text, idType) {
    const t = text || '';
    const type = (idType && idType.type) || 'unknown';

    console.log('   🔍 Extracting ID number (type hint:', type, ')');

    // ── Type-specific extractors (run first for the detected type) ──

    const typeExtractors = {
        aadhaar: () => {
            // Aadhaar: 12 digits, usually "XXXX XXXX XXXX" or "XXXX-XXXX-XXXX"
            // OCR often reads spaces/dashes/dots between groups
            // Also handle OCR noise like |, l, I mixed in with digits
            const cleanDigits = (s) => s.replace(/[\s.\-|lI]/g, '').replace(/O/g, '0').replace(/o/g, '0');

            const patterns = [
                /(?:aadhaar|aadhar|uid|UID|VID)[\s:.-]*?(\d[\d\s.\-|]{10,18})/im,
                /(\d{4}\s\d{4}\s\d{4})/,
                /(\d{4}[\s.\-]\d{4}[\s.\-]\d{4})/,
                /(\d{12})/,
                // OCR sometimes puts random chars between digit groups
                /(\d{4}[^\d\n]{0,3}\d{4}[^\d\n]{0,3}\d{4})/,
            ];
            for (const p of patterns) {
                const m = t.match(p);
                if (m) {
                    const raw = m[1] || m[0];
                    const val = cleanDigits(raw);
                    if (val.length === 12 && /^\d{12}$/.test(val)) {
                        return { raw: m[0], value: val, source: 'aadhaar', formatted: val.replace(/(\d{4})/g, '$1 ').trim() };
                    }
                }
            }
            return null;
        },

        pan: () => {
            // PAN: exactly AAAAA9999A (5 upper letters, 4 digits, 1 upper letter)
            // OCR commonly misreads: O↔0, I↔1, S↔5, B↔8, Z↔2
            const patterns = [
                /(?:PAN|Permanent\s*Account)[\s:.-]*?([A-Z]{5}\d{4}[A-Z])/im,
                /\b([A-Z]{5}\d{4}[A-Z])\b/,
            ];
            for (const p of patterns) {
                const m = t.match(p);
                if (m) {
                    const val = (m[1] || m[0]).trim();
                    if (/^[A-Z]{5}\d{4}[A-Z]$/.test(val)) {
                        return { raw: m[0], value: val, source: 'pan' };
                    }
                }
            }
            // Fuzzy match: allow O/0 confusion in PAN
            const fuzzyPatterns = [
                /\b([A-Z0-9]{5}[\d]{4}[A-Z0-9])\b/g,
                /\b([A-Z][A-Z0-9]{4}\d{4}[A-Z])\b/g,
            ];
            for (const pat of fuzzyPatterns) {
                let m;
                while ((m = pat.exec(t)) !== null) {
                    let val = m[1];
                    // Fix letter positions (0-4 and 9) that should be letters, digit positions (5-8)
                    let fixed = '';
                    for (let i = 0; i < val.length; i++) {
                        if (i < 5 || i === 9) {
                            // Should be a letter
                            fixed += val[i] === '0' ? 'O' : val[i] === '1' ? 'I' : val[i] === '5' ? 'S' : val[i];
                        } else {
                            // Should be a digit
                            fixed += val[i] === 'O' ? '0' : val[i] === 'I' ? '1' : val[i] === 'S' ? '5' : val[i];
                        }
                    }
                    if (/^[A-Z]{5}\d{4}[A-Z]$/.test(fixed)) {
                        return { raw: m[0], value: fixed, source: 'pan-fuzzy' };
                    }
                }
            }
            return null;
        },

        voter: () => {
            // Voter ID (EPIC): usually 3 letters + 7 digits (e.g., ABC1234567)
            // Some states use 2-3 letters + 7-10 digits
            const patterns = [
                /(?:EPIC|Voter|Electoral|Elector)[\s:.-]*?(?:No|Number|ID|Card)?[\s:.-]*?([A-Z]{2,3}\d{7,10})/im,
                /(?:No|Number|ID|Card)[\s:.-]*?([A-Z]{2,3}\d{7,10})/im,
                /\b([A-Z]{2,3}\d{7,10})\b/,
            ];
            for (const p of patterns) {
                const m = t.match(p);
                if (m) {
                    const val = (m[1] || m[0]).trim();
                    if (/^[A-Z]{2,3}\d{7,10}$/.test(val)) {
                        return { raw: m[0], value: val, source: 'voter-epic' };
                    }
                }
            }
            return null;
        },

        driving: () => {
            // Indian DL: State code (2 letters) + RTO code (2 digits) + year or serial
            // Common formats: KA01 20120001234, DL-0420150012345, MH12 20190001234
            const patterns = [
                /(?:DL|D\.?L\.?|Licence|License)\s*(?:No|Number|#)?[\s:.-]*?([A-Z]{2}[\s-]?\d{2}[\s-]?\d{4,13})/im,
                /\b([A-Z]{2}[\s-]?\d{2}[\s-]?(?:19|20)\d{2}[\s-]?\d{5,9})\b/,
                /\b([A-Z]{2}\d{2}\s?\d{11,13})\b/,
                /\b([A-Z]{2}-?\d{2}-?\d{4,13})\b/,
            ];
            for (const p of patterns) {
                const m = t.match(p);
                if (m) {
                    const val = (m[1] || m[0]).replace(/[\s-]/g, '').trim();
                    if (val.length >= 10 && /^[A-Z]{2}\d/.test(val)) {
                        return { raw: m[0], value: val, source: 'driving-license' };
                    }
                }
            }
            return null;
        },

        passport: () => {
            // Indian passport: 1 letter + 7 digits (e.g., J1234567)
            // Others: various formats
            const patterns = [
                /(?:Passport)[\s:.-]*?(?:No|Number|#)?[\s:.-]*?([A-Z]\d{7})/im,
                /\b([A-Z]\d{7})\b/,
                /(?:Passport)[\s:.-]*?([A-Z0-9]{6,12})/im,
            ];
            for (const p of patterns) {
                const m = t.match(p);
                if (m) {
                    const val = (m[1] || m[0]).trim();
                    if (val.length >= 7) {
                        return { raw: m[0], value: val, source: 'passport' };
                    }
                }
            }
            return null;
        },
    };

    // 1) Try the specific extractor for the detected type first
    if (type !== 'unknown' && typeExtractors[type]) {
        const result = typeExtractors[type]();
        if (result) {
            console.log(`   ✅ ID number found via ${type} extractor: ${result.value}`);
            return result;
        }
    }

    // 2) Try all type-specific extractors (in case detection was wrong/uncertain)
    for (const [key, extractor] of Object.entries(typeExtractors)) {
        if (key === type) continue; // already tried
        const result = extractor();
        if (result) {
            console.log(`   ✅ ID number found via ${key} extractor (fallback): ${result.value}`);
            return result;
        }
    }

    // 3) Generic labelled patterns
    const genericLabelPatterns = [
        /(?:ID|Id|Identification)\s*(?:No|Number|#)?[\s.:#-]*([A-Z0-9][A-Z0-9\s-]{4,25})/im,
        /(?:SSN|Social Security)[\s.:#-]*(\d[\d\s-]{6,12})/im,
        /(?:NI|National Insurance|NIN)[\s.:#-]*([A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D])/im,
        /(?:Card|Document|Registration|Reg|Ref)\s*(?:No|Number|#)?[\s.:#-]*([A-Z0-9][A-Z0-9\s-]{4,20})/im,
        /(?:No|Number|#)[\s.:#-]*([A-Z0-9][A-Z0-9-]{4,20})/im,
    ];
    for (const pat of genericLabelPatterns) {
        const m = t.match(pat);
        if (m && m[1]) {
            const cleaned = m[1].trim().replace(/\s+$/, '');
            if (/\d/.test(cleaned) && cleaned.replace(/[\s-]/g, '').length >= 5) {
                console.log(`   ✅ ID number found via generic label: ${cleaned}`);
                return { raw: m[0].trim(), value: cleaned, source: 'labelled-generic' };
            }
        }
    }

    // 4) Unlabelled — longest digit sequence
    const digitCandidates = [];
    const digitPatterns = [
        /(\d{4}[\s.-]\d{4}[\s.-]\d{4})/g,      // 12-digit grouped
        /(\d{3,4}[\s-]\d{3,4}[\s-]\d{3,4})/g,  // other grouped digits
        /(\d{7,15})/g,                            // long digit runs
    ];
    for (const pat of digitPatterns) {
        let m;
        while ((m = pat.exec(t)) !== null) {
            const clean = m[1].replace(/[\s.-]/g, '');
            if (clean.length >= 7 && clean.length <= 15) {
                digitCandidates.push({ raw: m[1], value: clean, len: clean.length });
            }
        }
    }
    digitCandidates.sort((a, b) => b.len - a.len);
    if (digitCandidates.length > 0) {
        console.log(`   ✅ ID number found via digit sequence: ${digitCandidates[0].value}`);
        return { raw: digitCandidates[0].raw, value: digitCandidates[0].value, source: 'digits' };
    }

    // 5) Alphanumeric codes
    const alphaPatterns = [
        /\b([A-Z]{1,5}\d{4,10}[A-Z]?)\b/g,
        /\b(\d{1,5}[A-Z]{1,5}\d{4,10})\b/g,
    ];
    for (const pat of alphaPatterns) {
        const m = t.match(pat);
        if (m && m[0] && m[0].length >= 6) {
            console.log(`   ✅ ID number found via alphanumeric: ${m[0]}`);
            return { raw: m[0], value: m[0], source: 'alphanumeric' };
        }
    }

    console.log('   ⚠️  No ID number found');
    return null;
}

// ============================================================
//  EXTRACT QR DATA INTO STRUCTURED FIELDS
// ============================================================

function parseQRData(qrRaw) {
    if (!qrRaw) return null;

    const result = { raw: qrRaw, fields: {} };

    // Try JSON
    try {
        const json = JSON.parse(qrRaw);
        result.format = 'json';
        result.fields = json;
        return result;
    } catch (_) {}

    // Try XML (very basic)
    if (qrRaw.trim().startsWith('<')) {
        result.format = 'xml';
        // extract tag-value pairs
        const tagRe = /<(\w+)>([^<]+)<\/\1>/g;
        let m;
        while ((m = tagRe.exec(qrRaw)) !== null) {
            result.fields[m[1]] = m[2].trim();
        }
        if (Object.keys(result.fields).length > 0) return result;
    }

    // Try key=value or key:value pairs
    const kvRe = /([\w\s]+?)\s*[=:]\s*(.+)/g;
    let m;
    while ((m = kvRe.exec(qrRaw)) !== null) {
        result.fields[m[1].trim()] = m[2].trim();
    }
    if (Object.keys(result.fields).length > 0) {
        result.format = 'key-value';
        return result;
    }

    // Try URL
    try {
        const url = new URL(qrRaw);
        result.format = 'url';
        result.fields.url = qrRaw;
        url.searchParams.forEach((v, k) => { result.fields[k] = v; });
        return result;
    } catch (_) {}

    // Fallback — plain text
    result.format = 'text';
    result.fields.text = qrRaw;
    return result;
}

// ============================================================
//  CROSS-VERIFY OCR vs QR
// ============================================================

function crossVerify(ocrID, ocrName, ocrDOB, qrParsed) {
    const verification = { ocrMatch: false, qrMatch: false, combined: {}, confidence: 'low' };

    // Start with OCR data
    verification.combined.idNumber = ocrID ? ocrID.value : null;
    verification.combined.name = ocrName;
    verification.combined.dob = ocrDOB;

    if (!qrParsed || !qrParsed.fields) {
        // No QR data — rely on OCR only
        verification.confidence = ocrID ? 'medium' : 'low';
        return verification;
    }

    const qf = qrParsed.fields;

    // Try to find ID in QR fields
    const qrIDKeys = Object.keys(qf).filter(k =>
        /id|ssn|aadhaar|uid|pan|passport|number|no|nic|nin|card/i.test(k)
    );
    let qrIDValue = null;
    for (const k of qrIDKeys) {
        if (qf[k] && String(qf[k]).replace(/[\s-]/g, '').length >= 5) {
            qrIDValue = String(qf[k]).replace(/[\s-]/g, '');
            break;
        }
    }

    // If QR has an ID and OCR found one too, compare
    if (qrIDValue && ocrID) {
        const ocrClean = ocrID.value.replace(/[\s-]/g, '');
        if (ocrClean === qrIDValue) {
            verification.ocrMatch = true;
            verification.qrMatch = true;
            verification.confidence = 'high';
        } else {
            // Partial match? (one contains the other)
            if (ocrClean.includes(qrIDValue) || qrIDValue.includes(ocrClean)) {
                verification.confidence = 'medium';
            } else {
                verification.confidence = 'low';
            }
        }
        // Prefer QR value as it's usually more reliable
        verification.combined.idNumber = qrIDValue;
    } else if (qrIDValue) {
        // Only QR has ID
        verification.combined.idNumber = qrIDValue;
        verification.qrMatch = true;
        verification.confidence = 'medium';
    }

    // Try to find name in QR
    const qrNameKeys = Object.keys(qf).filter(k => /name/i.test(k));
    if (qrNameKeys.length > 0) {
        verification.combined.name = String(qf[qrNameKeys[0]]);
    }

    // Try to find DOB in QR
    const qrDOBKeys = Object.keys(qf).filter(k => /dob|birth|date/i.test(k));
    if (qrDOBKeys.length > 0) {
        verification.combined.dob = String(qf[qrDOBKeys[0]]);
    }

    // If QR had raw text (not structured), also run ID extraction on it
    if (qrParsed.format === 'text' && !verification.combined.idNumber) {
        const fromQR = extractIDNumber(qrParsed.raw);
        if (fromQR) {
            verification.combined.idNumber = fromQR.value;
            verification.confidence = 'medium';
        }
    }

    return verification;
}

// ============================================================
//  ID TYPE DETECTION
// ============================================================
//
// Analyses the OCR text (and optionally QR data) to classify the
// document as one of the well-known Indian / international ID types.
//

function detectIDType(text, qrParsed) {
    const t = (text || '').toUpperCase();

    // ── Score-based detection — each ID type gets a weighted score ──
    const scores = {
        aadhaar:  0,
        pan:      0,
        voter:    0,
        driving:  0,
        passport: 0,
    };

    // ── Aadhaar Card ──
    // Keywords: AADHAAR, UIDAI, Unique Identification, "Government of India" + 12-digit number
    if (/AADHAAR|AADHAR/i.test(t))                            scores.aadhaar += 5;
    if (/UIDAI|UNIQUE\s*IDENTIFICATION/i.test(t))             scores.aadhaar += 4;
    if (/ENROLL/i.test(t) && /UID/i.test(t))                  scores.aadhaar += 3;
    if (/\b\d{4}\s?\d{4}\s?\d{4}\b/.test(t))                 scores.aadhaar += 3; // 12-digit grouped
    if (/VID/i.test(t) && /\d{16}/.test(t))                   scores.aadhaar += 2;
    if (/MALE|FEMALE|जन्म|पिता|DOB/i.test(t) && scores.aadhaar > 0) scores.aadhaar += 1;

    // ── PAN Card ──
    // Pattern: AAAAA9999A — exactly 5 letters + 4 digits + 1 letter
    // Keywords: INCOME TAX, PERMANENT ACCOUNT, PAN, GOVT OF INDIA / IT DEPT
    if (/PERMANENT\s*ACCOUNT\s*NUMBER/i.test(t))              scores.pan += 5;
    if (/INCOME\s*TAX/i.test(t))                              scores.pan += 4;
    if (/\bPAN\b/.test(t))                                    scores.pan += 3;
    if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(t))                    scores.pan += 4; // PAN format
    if (/IT\s*DEPART/i.test(t))                               scores.pan += 2;

    // ── Voter ID (EPIC) ──
    // Keywords: ELECTION, VOTER, ELECTORAL, EPIC, COMMISSION
    if (/ELECTION\s*COMMISSION/i.test(t))                     scores.voter += 5;
    if (/VOTER/i.test(t))                                     scores.voter += 4;
    if (/ELECTORAL/i.test(t))                                  scores.voter += 4;
    if (/EPIC/i.test(t))                                       scores.voter += 3;
    if (/\b[A-Z]{3}\d{7}\b/.test(t))                          scores.voter += 2; // EPIC format
    if (/ELECTORS\s*PHOTO/i.test(t))                          scores.voter += 4;

    // ── Driving License ──
    // Keywords: DRIVING, LICENCE/LICENSE, MOTOR, TRANSPORT, DL, RTO
    if (/DRIV(?:ING|ER'?S?)\s*LIC(?:ENCE|ENSE)/i.test(t))    scores.driving += 5;
    if (/\bDRIVING\b/i.test(t))                               scores.driving += 3;
    if (/\bLIC(?:ENCE|ENSE)\b/i.test(t))                      scores.driving += 2;
    if (/\bMOTOR\s*VEHICLE/i.test(t))                         scores.driving += 3;
    if (/\bTRANSPORT/i.test(t))                               scores.driving += 2;
    if (/\bRTO\b/i.test(t))                                   scores.driving += 3;
    if (/\bDL\s*NO/i.test(t))                                 scores.driving += 4;
    if (/\b[A-Z]{2}\d{2}\s?\d{11,13}\b/.test(t))             scores.driving += 3; // DL number format
    if (/COV|LMV|MCWG|HMV|HPMV|HTV/i.test(t))                scores.driving += 3; // vehicle categories
    if (/VALIDITY|VALID\s*(TILL|UPTO|FROM)/i.test(t) && scores.driving > 0) scores.driving += 1;

    // ── Passport ──
    // Keywords: PASSPORT, REPUBLIC, NATIONALITY, MRZ patterns
    if (/PASSPORT/i.test(t))                                   scores.passport += 5;
    if (/REPUBLIC\s*OF/i.test(t))                             scores.passport += 2;
    if (/NATIONALITY/i.test(t))                               scores.passport += 3;
    if (/PLACE\s*OF\s*(BIRTH|ISSUE)/i.test(t))                scores.passport += 2;
    if (/TYPE\s*[:\s]*P\b/i.test(t))                          scores.passport += 3;
    if (/COUNTRY\s*CODE/i.test(t))                            scores.passport += 2;
    if (/\b[A-Z]\d{7}\b/.test(t))                             scores.passport += 2; // Indian passport format
    // MRZ line (machine-readable zone): 44 chars of [A-Z0-9<]
    if (/[A-Z0-9<]{30,44}/.test(t))                           scores.passport += 2;

    // ── Also check QR data for clues ──
    if (qrParsed && qrParsed.raw) {
        const qr = qrParsed.raw.toUpperCase();
        if (/AADHAAR|UIDAI/i.test(qr))    scores.aadhaar  += 4;
        if (/\bPAN\b/i.test(qr))          scores.pan      += 3;
        if (/ELECTION|EPIC/i.test(qr))     scores.voter    += 3;
        if (/LICENCE|LICENSE|DL/i.test(qr))scores.driving  += 3;
        if (/PASSPORT/i.test(qr))          scores.passport += 4;
    }

    // ── Determine winner ──
    const entries = Object.entries(scores);
    entries.sort((a, b) => b[1] - a[1]);

    const [topType, topScore] = entries[0];
    const secondScore = entries[1][1];

    // Need a minimum score and some margin over runner-up to be confident
    const MIN_SCORE      = 4;
    const MARGIN          = 2;
    const HIGH_CONFIDENCE = 8;

    let detectedType = 'unknown';
    let typeConfidence = 'low';

    if (topScore >= MIN_SCORE && (topScore - secondScore) >= MARGIN) {
        detectedType = topType;
        typeConfidence = topScore >= HIGH_CONFIDENCE ? 'high' : 'medium';
    } else if (topScore >= MIN_SCORE) {
        // Score is above threshold but margin is thin — still report best guess
        detectedType = topType;
        typeConfidence = 'low';
    }

    // Human-readable labels
    const labels = {
        aadhaar:  'Aadhaar Card',
        pan:      'PAN Card',
        voter:    'Voter ID (EPIC)',
        driving:  'Driving License',
        passport: 'Passport',
        unknown:  'Unknown / Other',
    };

    console.log('   🪪 ID Type scores:', scores, `→ ${labels[detectedType]} (${typeConfidence})`);

    return {
        type: detectedType,
        label: labels[detectedType],
        confidence: typeConfidence,
        scores,
    };
}

// ============================================================
//  OTHER EXTRACTORS  (name, DOB)
// ============================================================

function extractName(text, idType) {
    const t = text || '';
    const type = (idType && idType.type) || 'unknown';
    console.log('   🔍 Extracting name (type hint:', type, ')');

    // Common noise words / labels to filter out (case-insensitive)
    const noiseWords = /^(government|india|of|the|department|income|tax|republic|election|commission|valid|till|from|upto|date|birth|dob|doi|issue|expiry|transport|authority|aadhaar|aadhar|uid|pan|epic|voter|passport|driving|licence|license|card|permanent|account|number|no|photo|identity|proof|enroll|electoral|roll|class|type|category|national|unique|identification|print|generated|online|form|help|line|www|http|com|org|govt)$/i;

    // Helper: validate a candidate name string
    function isValidName(name) {
        if (!name) return false;
        name = name.trim();
        // Remove trailing junk
        name = name.replace(/[^A-Za-z\s.'-]+$/, '').trim();
        // At least 2 characters, at most ~50
        if (name.length < 2 || name.length > 50) return false;
        // Must contain at least one proper word (2+ letters)
        const words = name.split(/\s+/).filter(w => w.length >= 2);
        if (words.length === 0) return false;
        // Filter out if all words are noise
        const meaningful = words.filter(w => !noiseWords.test(w.replace(/[.'-]/g, '')));
        if (meaningful.length === 0) return false;
        // Must be mostly letters (tolerate dots, hyphens, apostrophes, spaces)
        if (!/^[A-Za-z\s.'-]+$/.test(name)) return false;
        return true;
    }

    function cleanName(name) {
        if (!name) return null;
        name = name.trim();
        // Remove trailing punctuation / digits
        name = name.replace(/[^A-Za-z\s.'-]+$/, '').trim();
        // Remove leading articles / prepositions
        name = name.replace(/^(?:Mr\.?|Mrs\.?|Ms\.?|Shri\.?|Smt\.?|Kumari|Dr\.?)\s+/i, '').trim();
        // Title-case normalization for ALL-CAPS names
        if (name === name.toUpperCase() && name.length > 3) {
            name = name.replace(/\b(\w)(\w*)\b/g, (_, first, rest) =>
                first.toUpperCase() + rest.toLowerCase()
            );
        }
        return isValidName(name) ? name : null;
    }

    // Labelled patterns — ordered by specificity
    const labelledPatterns = [
        // "Name : XXX" or "Name: XXX" — most common across all Indian IDs
        /\bName\s*[:\-=]\s*([A-Za-z][A-Za-z\s.'-]{2,45})/im,
        // Handle "Name" and value on same line with extra spacing
        /\bName\s{2,}([A-Z][A-Za-z\s.'-]{2,45})/im,
        // "Full Name : XXX"
        /\bFull\s*Name\s*[:\-=]\s*([A-Za-z][A-Za-z\s.'-]{2,45})/im,
        // Aadhaar / Voter: S/O, D/O, W/O, C/O (captures the father/husband name)
        /\b(?:S\/O|D\/O|W\/O|C\/O|Son of|Daughter of|Wife of)[\s:.-]*([A-Za-z][A-Za-z\s.'-]{2,45})/im,
        /\b(?:Father(?:'?s?)?\s*(?:Name)?|Husband(?:'?s?)?\s*(?:Name)?)\s*[:\-=]?\s*([A-Za-z][A-Za-z\s.'-]{2,45})/im,
        /\b(?:Surname|Last\s*Name|Given\s*Name|First\s*Name)\s*[:\-=]?\s*([A-Za-z][A-Za-z\s.'-]{2,45})/im,
        // Voter ID / EPIC: "Elector's Name"
        /\b(?:Elector(?:'?s?)?\s*Name)\s*[:\-=]?\s*([A-Za-z][A-Za-z\s.'-]{2,45})/im,
        /\bGiven\s*Name(?:\(s\))?\s*[:\-=]?\s*([A-Za-z][A-Za-z\s.'-]{2,45})/im,
        // PAN: name appears after "Name" or "Holder"
        /\bHolder(?:'?s?)?\s*Name\s*[:\-=]?\s*([A-Za-z][A-Za-z\s.'-]{2,45})/im,
        // Generic "Name" at start of line
        /^\s*Name\s+([A-Z][A-Z\s.'-]{2,45})/im,
        // "Applicant" label (DL)
        /\bApplicant(?:'?s?)?\s*Name\s*[:\-=]?\s*([A-Za-z][A-Za-z\s.'-]{2,45})/im,
    ];

    for (const pattern of labelledPatterns) {
        const match = t.match(pattern);
        if (match && match[1]) {
            const name = cleanName(match[1]);
            if (name) {
                console.log(`   ✅ Name found (labelled): "${name}"`);
                return name;
            }
        }
    }

    // Line-by-line approach: look for lines that are ALL-CAPS proper names
    // This catches Indian IDs where name appears on its own line without a label
    const lines = t.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 0);

    // Collect candidate name lines
    const nameCandidates = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip if line has too many digits (probably ID number, date, or address)
        const digitCount = (line.match(/\d/g) || []).length;
        if (digitCount > 2) continue;
        // Skip if line is too short or too long
        if (line.length < 4 || line.length > 50) continue;
        // Must be mostly English letters (allow some punctuation)
        if (!/^[A-Za-z\s.'-]+$/.test(line)) continue;
        const words = line.split(/\s+/).filter(w => w.length >= 2);
        if (words.length < 1 || words.length > 5) continue;
        // Filter out noise words
        const meaningful = words.filter(w => !noiseWords.test(w.replace(/[.'-]/g, '')));
        if (meaningful.length < 1) continue;
        // Check if previous line is a name-related label
        const prevLine = (i > 0 ? lines[i - 1] : '').toLowerCase();
        const afterLabel = /name|holder|elector|applicant|bearer/i.test(prevLine);
        // Check if next line could confirm (e.g., S/O, D/O after a name)
        const nextLine = (i < lines.length - 1 ? lines[i + 1] : '').toLowerCase();
        const beforeRelation = /s\/o|d\/o|w\/o|c\/o|son|daughter|wife|father|husband|male|female/i.test(nextLine);

        nameCandidates.push({
            text: line,
            wordCount: meaningful.length,
            afterLabel,
            beforeRelation,
            score: (afterLabel ? 10 : 0) + (beforeRelation ? 8 : 0) + (meaningful.length >= 2 && meaningful.length <= 4 ? 5 : 0),
            index: i,
        });
    }

    // Sort by score descending
    nameCandidates.sort((a, b) => b.score - a.score);

    // Prefer candidates with highest score
    if (nameCandidates.length > 0 && nameCandidates[0].score > 0) {
        const name = cleanName(nameCandidates[0].text);
        if (name) {
            console.log(`   ✅ Name found (scored line, score=${nameCandidates[0].score}): "${name}"`);
            return name;
        }
    }

    // Prefer candidates that follow a "Name" label
    const labelledCandidate = nameCandidates.find(c => c.afterLabel);
    if (labelledCandidate) {
        const name = cleanName(labelledCandidate.text);
        if (name) {
            console.log(`   ✅ Name found (after-label line): "${name}"`);
            return name;
        }
    }

    // Otherwise pick the candidate with 2-4 words (looks like a name)
    const bestCandidate = nameCandidates.find(c => c.wordCount >= 2 && c.wordCount <= 4);
    if (bestCandidate) {
        const name = cleanName(bestCandidate.text);
        if (name) {
            console.log(`   ✅ Name found (standalone line): "${name}"`);
            return name;
        }
    }

    // Final fallback: multi-word pattern in text (Title Case or ALL CAPS)
    const fallbackPatterns = [
        /\b([A-Z][a-z]+ [A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/,    // Title Case (2-3 words)
        /\b([A-Z]{2,15} [A-Z]{2,15}(?: [A-Z]{2,15})?)\b/,    // ALL CAPS (2-3 words)
    ];
    for (const pat of fallbackPatterns) {
        const allMatches = [...t.matchAll(new RegExp(pat.source, 'gm'))];
        for (const match of allMatches) {
            const name = cleanName(match[1]);
            if (name) {
                console.log(`   ✅ Name found (fallback pattern): "${name}"`);
                return name;
            }
        }
    }

    console.log('   ⚠️  No name found');
    return null;
}

function extractDOB(text, idType) {
    const t = text || '';
    console.log('   🔍 Extracting DOB...');

    // Labelled DOB patterns (various labels used across Indian & international IDs)
    const labelledPatterns = [
        // "DOB : 01/02/1990" or "DOB: 01-02-1990" or "D.O.B. 01.02.1990"
        /\bD\.?O\.?B\.?\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
        /\bDate\s*of\s*Birth\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
        /\bBirth\s*Date\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
        /\bBorn\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
        // "जन्म तिथि" (Hindi for DOB)
        /जन्म\s*(?:तिथि|दिनांक)?\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/,
        // Year of Birth: "YOB: 1990" or "Year of Birth: 1990"
        /\b(?:YOB|Year\s*of\s*Birth)\s*[:\-]?\s*(\d{4})/i,
        // Aadhaar: DOB label variations
        /\bDOB\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
        // "Date of Birth" spanning a line break
        /Date[\s\n]*of[\s\n]*Birth[\s\n:.-]*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/im,
        // YYYY format after "Birth" or "DOB"
        /\b(?:DOB|Birth)\s*[:\-]?\s*(\d{4})/i,
    ];

    for (const pattern of labelledPatterns) {
        const match = t.match(pattern);
        if (match && match[1]) {
            const val = match[1].trim();
            console.log(`   ✅ DOB found (labelled): "${val}"`);
            return val;
        }
    }

    // Unlabelled date patterns — look for DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD
    const datePatterns = [
        /(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/,
        /(\d{4}[\/.\-]\d{2}[\/.\-]\d{2})/,  // ISO format
        /(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/,
    ];

    // Collect all candidate dates and pick the first reasonable one
    for (const pattern of datePatterns) {
        const allMatches = [...t.matchAll(new RegExp(pattern.source, 'g'))];
        for (const match of allMatches) {
            const val = match[1];
            // Validate it looks like a real date (not a random number)
            const parts = val.split(/[\/.\-]/);
            if (parts.length === 3) {
                const nums = parts.map(Number);
                // Quick sanity: at least one part should be a year (>1900 or <100 for 2-digit)
                const hasYear = nums.some(n => (n >= 1900 && n <= 2030) || (n >= 0 && n <= 99 && parts[parts.indexOf(String(n))].length <= 2));
                if (hasYear) {
                    console.log(`   ✅ DOB found (unlabelled date): "${val}"`);
                    return val;
                }
            }
        }
    }

    console.log('   ⚠️  No DOB found');
    return null;
}

// ============================================================
//  DIRECT TEXT-SEARCH CROSS-VERIFICATION
//  Instead of extracting fields (hard), we search for the
//  user-provided values directly in the raw OCR text (easy).
// ============================================================

// Common OCR misread character substitutions
const OCR_SUBS = {
    '0': '[0Oo]',
    'O': '[0Oo]',
    'o': '[0Oo]',
    '1': '[1Il|]',
    'I': '[1Il|]',
    'l': '[1Il|]',
    '5': '[5Ss]',
    'S': '[5Ss]',
    's': '[5Ss]',
    '8': '[8B]',
    'B': '[8B]',
    '2': '[2Zz]',
    'Z': '[2Zz]',
    '6': '[6G]',
    'G': '[6G]',
};

/**
 * Build a fuzzy regex from a string that tolerates common OCR errors.
 * e.g. "RAHUL" → "R[A]HU[1Il|]"  (L→[1Il|])
 * Each character gets its OCR-substitute class; others stay as-is.
 * Allows optional whitespace/noise between characters.
 */
function buildFuzzyPattern(str) {
    let pattern = '';
    for (const ch of str) {
        if (OCR_SUBS[ch]) {
            pattern += OCR_SUBS[ch];
        } else if (/[a-zA-Z0-9]/.test(ch)) {
            // Case-insensitive literal
            pattern += ch;
        } else if (ch === ' ') {
            // Space: allow any whitespace or common OCR noise
            pattern += '[\\s.,;:_\\-]*';
        } else {
            pattern += '\\' + ch;
        }
    }
    return pattern;
}

/**
 * Search for a string (user-provided value) directly inside raw OCR text.
 * Returns { found: boolean, confidence: 'exact'|'fuzzy'|'partial'|'none', detail: string }
 */
function searchInOCR(rawText, searchValue, fieldType) {
    if (!searchValue || !rawText) {
        return { found: false, confidence: 'none', detail: 'No value to search' };
    }

    const text = rawText; // Keep original case for case-insensitive regex

    // ─── NAME search ────────────────────────────
    if (fieldType === 'name') {
        const words = searchValue.trim().split(/\s+/).filter(w => w.length >= 2);
        if (words.length === 0) return { found: false, confidence: 'none', detail: 'Name too short' };

        // Strategy 1: Exact full name (case-insensitive)
        const exactRe = new RegExp(searchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (exactRe.test(text)) {
            return { found: true, confidence: 'exact', detail: `Exact name "${searchValue}" found in OCR text` };
        }

        // Strategy 2: Fuzzy full name (OCR substitutions)
        try {
            const fuzzyRe = new RegExp(buildFuzzyPattern(searchValue), 'i');
            if (fuzzyRe.test(text)) {
                return { found: true, confidence: 'fuzzy', detail: `Fuzzy name match for "${searchValue}"` };
            }
        } catch (_) {}

        // Strategy 3: Individual word search — count how many name words appear
        let wordsFound = 0;
        const foundWords = [];
        const missedWords = [];
        for (const word of words) {
            const wordExact = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            if (wordExact.test(text)) {
                wordsFound++;
                foundWords.push(word);
            } else {
                // Try fuzzy word
                try {
                    const wordFuzzy = new RegExp(buildFuzzyPattern(word), 'i');
                    if (wordFuzzy.test(text)) {
                        wordsFound += 0.8;
                        foundWords.push(word + '~');
                    } else {
                        missedWords.push(word);
                    }
                } catch (_) {
                    missedWords.push(word);
                }
            }
        }

        const ratio = wordsFound / words.length;
        if (ratio >= 0.99) {
            return { found: true, confidence: 'exact', detail: `All name words found: [${foundWords.join(', ')}]` };
        } else if (ratio >= 0.5) {
            return { found: true, confidence: 'partial', detail: `${Math.round(wordsFound)}/${words.length} words found: [${foundWords.join(', ')}], missed: [${missedWords.join(', ')}]` };
        } else {
            return { found: false, confidence: 'none', detail: `Only ${Math.round(wordsFound)}/${words.length} words found. Missed: [${missedWords.join(', ')}]` };
        }
    }

    // ─── ID NUMBER search ───────────────────────
    if (fieldType === 'idNumber') {
        // Remove spaces/hyphens from user input for searching
        const cleanId = searchValue.replace(/[\s\-]/g, '');
        const textClean = text.replace(/[\s\-]/g, '');

        // Strategy 1: Exact match (case-insensitive)
        const exactRe = new RegExp(cleanId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (exactRe.test(textClean)) {
            return { found: true, confidence: 'exact', detail: `Exact ID "${cleanId}" found in OCR text` };
        }

        // Strategy 2: Search with spaces allowed between digit groups
        // e.g. "123456789012" → search for "1234 5678 9012" patterns
        const spacedPattern = cleanId.split('').join('[\\s\\-]*');
        try {
            const spacedRe = new RegExp(spacedPattern, 'i');
            if (spacedRe.test(text)) {
                return { found: true, confidence: 'exact', detail: `ID found with spacing variants` };
            }
        } catch (_) {}

        // Strategy 3: Fuzzy OCR substitution match
        try {
            const fuzzyRe = new RegExp(buildFuzzyPattern(cleanId), 'i');
            if (fuzzyRe.test(textClean)) {
                return { found: true, confidence: 'fuzzy', detail: `Fuzzy ID match (OCR substitutions)` };
            }
        } catch (_) {}

        // Strategy 4: Chunk match — split ID into 4-digit chunks and see how many found
        const chunks = cleanId.match(/.{1,4}/g) || [];
        let chunksFound = 0;
        for (const chunk of chunks) {
            if (textClean.includes(chunk)) chunksFound++;
        }
        const chunkRatio = chunksFound / chunks.length;
        if (chunkRatio >= 0.75) {
            return { found: true, confidence: 'partial', detail: `${chunksFound}/${chunks.length} ID chunks found` };
        } else if (chunkRatio >= 0.5) {
            return { found: true, confidence: 'partial', detail: `${chunksFound}/${chunks.length} ID chunks found (weak)` };
        }

        // Strategy 5: Last 4 digits match (masked Aadhaar cards show only last 4)
        if (cleanId.length >= 4) {
            const last4 = cleanId.slice(-4);
            if (textClean.includes(last4)) {
                return { found: true, confidence: 'partial', detail: `Last 4 digits "${last4}" found (possibly masked ID)` };
            }
        }

        return { found: false, confidence: 'none', detail: `ID "${cleanId}" not found in OCR text` };
    }

    // ─── DOB search ─────────────────────────────
    if (fieldType === 'dob') {
        // User provides YYYY-MM-DD from date input. Generate all possible display formats.
        const isoMatch = searchValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!isoMatch) {
            return { found: false, confidence: 'none', detail: 'Invalid date format' };
        }

        const year  = isoMatch[1];
        const month = isoMatch[2].padStart(2, '0');
        const day   = isoMatch[3].padStart(2, '0');
        const shortYear = year.slice(-2);

        // Generate all date format variations that might appear on an ID
        const dateVariants = [
            `${day}/${month}/${year}`,      // 15/05/1990
            `${day}-${month}-${year}`,      // 15-05-1990
            `${day}.${month}.${year}`,      // 15.05.1990
            `${day}/${month}/${shortYear}`,  // 15/05/90
            `${day}-${month}-${shortYear}`,  // 15-05-90
            `${month}/${day}/${year}`,       // 05/15/1990 (US format)
            `${month}-${day}-${year}`,       // 05-15-1990
            `${year}-${month}-${day}`,       // 1990-05-15 (ISO)
            `${year}/${month}/${day}`,       // 1990/05/15
            `${day}${month}${year}`,         // 15051990 (no separators)
            `${day} ${month} ${year}`,       // 15 05 1990
        ];

        // Also try without leading zeros
        const dayNoZero = String(parseInt(day));
        const monthNoZero = String(parseInt(month));
        if (dayNoZero !== day || monthNoZero !== month) {
            dateVariants.push(`${dayNoZero}/${monthNoZero}/${year}`);
            dateVariants.push(`${dayNoZero}-${monthNoZero}-${year}`);
            dateVariants.push(`${dayNoZero}.${monthNoZero}.${year}`);
        }

        // Strategy 1: Exact date variant match
        for (const variant of dateVariants) {
            if (text.includes(variant)) {
                return { found: true, confidence: 'exact', detail: `Date "${variant}" found in OCR text` };
            }
        }

        // Strategy 2: Fuzzy date match (OCR errors in digits)
        for (const variant of dateVariants.slice(0, 6)) {
            try {
                const fuzzyRe = new RegExp(buildFuzzyPattern(variant), 'i');
                if (fuzzyRe.test(text)) {
                    return { found: true, confidence: 'fuzzy', detail: `Fuzzy date match for "${variant}"` };
                }
            } catch (_) {}
        }

        // Strategy 3: Year-only match (at least the year should appear)
        if (text.includes(year)) {
            // Year found — check if day and month are nearby
            const dayFound = text.includes(day) || text.includes(dayNoZero);
            const monthFound = text.includes(month) || text.includes(monthNoZero);
            if (dayFound && monthFound) {
                return { found: true, confidence: 'partial', detail: `Year "${year}", day, and month all found separately in text` };
            }
            return { found: true, confidence: 'partial', detail: `Year "${year}" found but full date not matched` };
        }

        return { found: false, confidence: 'none', detail: `No date variants found in OCR text` };
    }

    // ─── ID TYPE search ─────────────────────────
    if (fieldType === 'idType') {
        const typeKeywords = {
            aadhaar:         ['aadhaar', 'aadhar', 'adhar', 'uidai', 'unique identification', 'आधार'],
            pan:             ['permanent account number', 'pan', 'income tax', 'आयकर'],
            voter_id:        ['election', 'voter', 'epic', 'electors', 'निर्वाचन', 'electoral'],
            driving_license: ['driving', 'licence', 'license', 'transport', 'motor vehicle', 'dl no', 'sarthi'],
            passport:        ['passport', 'republic of india', 'travel document', 'पासपोर्ट'],
        };

        const keywords = typeKeywords[searchValue] || [];
        let kFound = 0;
        const matchedKw = [];
        for (const kw of keywords) {
            if (text.toLowerCase().includes(kw.toLowerCase())) {
                kFound++;
                matchedKw.push(kw);
            }
        }

        if (kFound >= 2) {
            return { found: true, confidence: 'exact', detail: `Multiple ID type keywords found: [${matchedKw.join(', ')}]` };
        } else if (kFound >= 1) {
            return { found: true, confidence: 'fuzzy', detail: `ID type keyword found: "${matchedKw[0]}"` };
        }
        return { found: false, confidence: 'none', detail: `No keywords for "${searchValue}" found` };
    }

    return { found: false, confidence: 'none', detail: 'Unknown field type' };
}

/**
 * Main cross-verification: search for each user-provided value
 * directly in the raw OCR text. No extraction needed.
 */
function crossVerifyUserInput(userInput, rawText, detectedIdType) {
    console.log('\n   🔍 === DIRECT TEXT-SEARCH VERIFICATION ===');

    const fieldMatches = {};
    const fieldDetails = {};
    let matchCount = 0;
    const totalFields = 4;

    // 1. ID Type — search for keywords in OCR text
    const idTypeResult = searchInOCR(rawText, userInput.idType, 'idType');
    fieldDetails.idType = idTypeResult.detail;
    console.log(`   [ID Type]   ${idTypeResult.confidence}: ${idTypeResult.detail}`);
    if (idTypeResult.confidence === 'exact') {
        fieldMatches.idType = 'match';
        matchCount++;
    } else if (idTypeResult.confidence === 'fuzzy') {
        fieldMatches.idType = 'match';
        matchCount++;
    } else if (detectedIdType?.type === userInput.idType) {
        // Fallback: use the score-based detector
        fieldMatches.idType = 'match';
        matchCount++;
        fieldDetails.idType = `Detected via scoring: ${detectedIdType.label}`;
    } else {
        fieldMatches.idType = 'not_found';
    }

    // 2. ID Number — direct text search
    const idNumResult = searchInOCR(rawText, userInput.idNumber, 'idNumber');
    fieldDetails.idNumber = idNumResult.detail;
    console.log(`   [ID Number] ${idNumResult.confidence}: ${idNumResult.detail}`);
    if (idNumResult.confidence === 'exact') {
        fieldMatches.idNumber = 'match';
        matchCount++;
    } else if (idNumResult.confidence === 'fuzzy') {
        fieldMatches.idNumber = 'match';
        matchCount++;
    } else if (idNumResult.confidence === 'partial') {
        fieldMatches.idNumber = 'partial';
        matchCount += 0.5;
    } else {
        fieldMatches.idNumber = 'not_found';
    }

    // 3. Name — direct word search in OCR text
    const nameResult = searchInOCR(rawText, userInput.name, 'name');
    fieldDetails.name = nameResult.detail;
    console.log(`   [Name]      ${nameResult.confidence}: ${nameResult.detail}`);
    if (nameResult.confidence === 'exact') {
        fieldMatches.name = 'match';
        matchCount++;
    } else if (nameResult.confidence === 'fuzzy') {
        fieldMatches.name = 'match';
        matchCount++;
    } else if (nameResult.confidence === 'partial') {
        fieldMatches.name = 'partial';
        matchCount += 0.5;
    } else {
        fieldMatches.name = 'not_found';
    }

    // 4. DOB — search all date format variants
    const dobResult = searchInOCR(rawText, userInput.dob, 'dob');
    fieldDetails.dob = dobResult.detail;
    console.log(`   [DOB]       ${dobResult.confidence}: ${dobResult.detail}`);
    if (dobResult.confidence === 'exact') {
        fieldMatches.dob = 'match';
        matchCount++;
    } else if (dobResult.confidence === 'fuzzy') {
        fieldMatches.dob = 'match';
        matchCount++;
    } else if (dobResult.confidence === 'partial') {
        fieldMatches.dob = 'partial';
        matchCount += 0.5;
    } else {
        fieldMatches.dob = 'not_found';
    }

    // Overall status — ALL 4 fields must be a full 'match' to be accepted
    const roundedCount = Math.round(matchCount);
    const allFieldsMatch = (
        fieldMatches.idType   === 'match' &&
        fieldMatches.idNumber === 'match' &&
        fieldMatches.name     === 'match' &&
        fieldMatches.dob      === 'match'
    );
    let overallStatus;
    if (allFieldsMatch) {
        overallStatus = 'verified';
    } else {
        overallStatus = 'failed';
    }

    console.log(`   📊 Result: ${roundedCount}/${totalFields} fields matched (all must match) → ${overallStatus}`);
    console.log('   ========================================\n');

    return {
        fieldMatches,
        fieldDetails,
        matchCount: roundedCount,
        totalFields,
        overallStatus
    };
}

// ============================================================
//  API ENDPOINTS
// ============================================================

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Identity Verification System',
        features: ['ocr', 'qr-reader', 'multi-country-id', 'id-type-detection']
    });
});

// Extract ID from Image (OCR + QR) with User Input Cross-Verification
app.post('/api/extract-ssn', upload.single('document'), async (req, res) => {
    console.log('\n📸 Received document for processing');

    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Read user-provided fields
    const userInput = {
        idType:   req.body.userIdType   || '',
        idNumber: req.body.userIdNumber || '',
        name:     req.body.userName     || '',
        dob:      req.body.userDob      || ''
    };
    console.log('   👤 User input:', userInput);

    const sessionId = crypto.randomBytes(16).toString('hex');
    const filePath = req.file.path;

    try {
        // ── Step 1: Run OCR and QR in parallel ──
        const [extractedText, qrResult] = await Promise.all([
            processImageWithOCR(filePath),
            readQRCode(filePath)
        ]);

        // ── Step 2: Parse QR data ──
        const qrParsed = qrResult.found ? parseQRData(qrResult.data) : null;

        // Log raw OCR text for debugging
        console.log('\n   ===== RAW OCR TEXT (first 1500 chars) =====');
        console.log(extractedText.substring(0, 1500));
        console.log('   ===== END RAW OCR TEXT =====\n');

        // ── Step 3: Detect ID type (before extraction so we can guide it) ──
        const idType = detectIDType(extractedText, qrParsed);
        console.log(`   🪪 Detected ID type: ${idType.label} (${idType.confidence})`);

        // ── Step 4: Extract fields from OCR text (type-aware) — kept as fallback ──
        const ocrID = extractIDNumber(extractedText, idType);
        const ocrName = extractName(extractedText, idType);
        const ocrDOB = extractDOB(extractedText, idType);

        console.log('   📋 OCR extraction results (fallback):', {
            id: ocrID ? ocrID.value : null,
            name: ocrName,
            dob: ocrDOB,
        });

        // ── Step 5: Cross-verify OCR vs QR ──
        const verified = crossVerify(ocrID, ocrName, ocrDOB, qrParsed);

        // ── Step 6: DIRECT TEXT-SEARCH verification (the main approach) ──
        // Search for user-provided values directly in the raw OCR text
        const crossVerification = crossVerifyUserInput(userInput, extractedText, idType);
        console.log('   🔀 Cross-verification result:', crossVerification);

        // ── Step 7: Build extracted data (combine old extraction + text search results) ──
        const extracted = {
            idType:     idType,
            idNumber:   verified.combined.idNumber || null,
            name:       verified.combined.name || null,
            dob:        verified.combined.dob || null,
            confidence: verified.confidence,
            qrData:     qrParsed,
        };

        // ── Step 8: Build hash for blockchain ──
        const idValue = userInput.idNumber || verified.combined.idNumber;
        const hash = idValue
            ? crypto
                .createHash('sha256')
                .update(idValue + (userInput.name || '') + (userInput.dob || ''))
                .digest('hex')
            : null;

        // ── Step 9: Cache result ──
        const result = {
            sessionId,
            success: true,
            userInput,
            extracted,
            crossVerification,
            hash,
            timestamp: new Date().toISOString(),
            fullText: extractedText.substring(0, 2000)
        };

        verificationCache.set(sessionId, result);

        // Clean up old cache entries (> 1 hour)
        for (const [key, value] of verificationCache.entries()) {
            if (Date.now() - new Date(value.timestamp).getTime() > 3600000) {
                verificationCache.delete(key);
            }
        }

        console.log('✅ Processing complete:', {
            sessionId,
            overallStatus: crossVerification.overallStatus,
            matchCount: crossVerification.matchCount + '/' + crossVerification.totalFields,
            idType: idType.label,
            qrFound: qrResult.found,
        });

        res.json({
            success: true,
            sessionId,
            data: {
                userInput,
                extracted,
                crossVerification,
                hash,
                rawText: extractedText.substring(0, 2000)
            }
        });

    } catch (error) {
        console.error('❌ Error processing document:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process document',
            details: error.message
        });
    } finally {
        // Clean up uploaded file and any leftover variants
        const cleanups = [filePath];
        for (const suffix of ['_v1.png','_v2.png','_v3.png','_v4.png','_v5.png','_v6.png','_v7.png']) {
            cleanups.push(filePath.replace(/(\.[\w]+)$/i, suffix));
        }
        for (const f of cleanups) {
            try { fs.unlinkSync(f); } catch (_) {}
        }
        console.log('🧹 Cleaned up temporary files');
    }
});

// Get verification result by session ID
app.get('/api/verification-result/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const result = verificationCache.get(sessionId);

    if (!result) {
        return res.status(404).json({
            success: false,
            error: 'Session not found or expired'
        });
    }

    res.json({ success: true, data: result });
});

// Prepare for blockchain storage
app.post('/api/prepare-blockchain', (req, res) => {
    const { sessionId, walletAddress } = req.body;

    if (!sessionId || !walletAddress) {
        return res.status(400).json({
            success: false,
            error: 'Missing sessionId or walletAddress'
        });
    }

    const result = verificationCache.get(sessionId);

    if (!result || !result.ssnRaw) {
        return res.status(400).json({
            success: false,
            error: 'No valid ID found in session'
        });
    }

    const blockchainHash = crypto
        .createHash('sha256')
        .update(result.ssnRaw + walletAddress + result.timestamp)
        .digest('hex');

    res.json({
        success: true,
        data: {
            hash: blockchainHash,
            timestamp: result.timestamp,
            walletAddress
        }
    });
});

// Fallback: serve voting index.html for unknown routes (SPA-like)
app.get('/', (req, res) => {
    res.sendFile(path.join(votingFrontendDir, 'index.html'));
});
app.get('/verify', (req, res) => {
    res.sendFile(path.join(idFrontendDir, 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`
    🚀 Decentralized Voting + Identity Verification System
    ======================================================
    Server running on port:  ${PORT}
    Voting Portal:           http://localhost:${PORT}
    ID Verification:         http://localhost:${PORT}/verify
    Health check:            http://localhost:${PORT}/api/health
    Extract ID API:          POST http://localhost:${PORT}/api/extract-ssn
    Features:                OCR (multi-variant) + QR Reader + Cross-verification
    `);
});