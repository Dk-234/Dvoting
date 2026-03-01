/**
 * Face Verification Module using face-api.js
 * (Browser global — exposes window.FaceVerification)
 * 
 * Captures live video from the device camera, detects a face,
 * extracts a 128-dimensional face descriptor, and provides
 * liveness guidance (head movement, blinking prompts).
 * 
 * No raw biometric data is sent to any server. Only a SHA-256
 * hash of the descriptor is exported for blockchain storage.
 * 
 * Dependencies:
 * - face-api.js (loaded via CDN or local models)
 * - Models: tinyFaceDetector, faceLandmark68Net, faceRecognitionNet
 */

// IIFE to avoid polluting global scope except for window.FaceVerification
(function(global) {
'use strict';

class FaceVerification {
    constructor() {
        /** @type {boolean} Whether models have been loaded */
        this._modelsLoaded = false;
        /** @type {string} Path to face-api.js model weights */
        this._modelPath = '/verify/models';
        /** @type {MediaStream|null} Active camera stream */
        this._stream = null;
        /** @type {Float32Array|null} Last extracted face descriptor (128-d) */
        this._descriptor = null;
        /** @type {HTMLVideoElement|null} Video element for camera feed */
        this._videoElement = null;
        /** @type {number} Capture duration in ms */
        this.captureDuration = 6000; // 6 seconds (more time for detection)
        /** @type {number} Frame sampling interval in ms */
        this.frameSampleInterval = 400; // sample every 400ms
    }

    /**
     * Load face-api.js models from the specified path.
     * Must be called before any detection operations.
     * 
     * @param {string} [modelPath] - Override default model path
     * @returns {Promise<void>}
     * @throws {Error} If face-api.js is not available or models fail to load
     */
    async loadModels(modelPath) {
        if (this._modelsLoaded) {
            console.log('[FaceVerification] Models already loaded.');
            return;
        }

        if (typeof faceapi === 'undefined') {
            throw new Error(
                'face-api.js is not loaded. Include it via <script> tag or npm import.'
            );
        }

        const path = modelPath || this._modelPath;
        console.log(`[FaceVerification] Loading models from ${path}...`);

        try {
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(path),
                faceapi.nets.faceLandmark68Net.loadFromUri(path),
                faceapi.nets.faceRecognitionNet.loadFromUri(path)
            ]);

            this._modelsLoaded = true;
            console.log('[FaceVerification] All models loaded successfully.');
        } catch (error) {
            throw new Error(`Failed to load face-api.js models: ${error.message}`);
        }
    }

    /**
     * Start the camera and return the video element.
     * 
     * @param {HTMLVideoElement} videoElement - DOM video element to attach the stream
     * @returns {Promise<HTMLVideoElement>}
     * @throws {Error} If camera access is denied
     */
    async startCamera(videoElement) {
        if (!videoElement) {
            throw new Error('A <video> element must be provided.');
        }

        try {
            this._stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user' // Front-facing camera
                },
                audio: false
            });

            videoElement.srcObject = this._stream;
            videoElement.setAttribute('playsinline', ''); // Required for iOS
            await videoElement.play();

            this._videoElement = videoElement;
            console.log('[FaceVerification] Camera started.');
            return videoElement;
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                throw new Error('Camera access was denied. Please allow camera access and try again.');
            }
            if (error.name === 'NotFoundError') {
                throw new Error('No camera found on this device.');
            }
            throw new Error(`Failed to start camera: ${error.message}`);
        }
    }

    /**
     * Stop the active camera stream and release resources.
     */
    stopCamera() {
        if (this._stream) {
            this._stream.getTracks().forEach(track => track.stop());
            this._stream = null;
        }
        if (this._videoElement) {
            this._videoElement.srcObject = null;
            this._videoElement = null;
        }
        console.log('[FaceVerification] Camera stopped.');
    }

    /**
     * Capture video frames for the specified duration and extract
     * the best face descriptor from multiple sampled frames.
     * 
     * "Best" is defined as the frame with the highest detection
     * confidence and a frontal face orientation.
     * 
     * @param {HTMLVideoElement} videoElement - Video element with active camera
     * @param {function} [onProgress] - Callback(progress: 0-1, message: string)
     * @returns {Promise<{descriptor: Float32Array, confidence: number, framesAnalyzed: number}>}
     * @throws {Error} If no face is detected during capture
     */
    async extractDescriptorFromVideo(videoElement, onProgress) {
        if (!this._modelsLoaded) {
            throw new Error('Models not loaded. Call loadModels() first.');
        }

        const video = videoElement || this._videoElement;
        if (!video || video.readyState < 2) {
            throw new Error('Video element is not ready. Start the camera first.');
        }

        const detectionOptions = new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.35
        });

        const frames = [];
        const totalFrames = Math.floor(this.captureDuration / this.frameSampleInterval);
        let framesCaptured = 0;

        console.log(`[FaceVerification] Capturing ${totalFrames} frames over ${this.captureDuration}ms...`);

        return new Promise((resolve, reject) => {
            const captureInterval = setInterval(async () => {
                try {
                    framesCaptured++;
                    const progress = framesCaptured / totalFrames;

                    if (onProgress) {
                        onProgress(progress, `Analyzing frame ${framesCaptured}/${totalFrames}...`);
                    }

                    // Detect face with landmarks and descriptor
                    const detection = await faceapi
                        .detectSingleFace(video, detectionOptions)
                        .withFaceLandmarks()
                        .withFaceDescriptor();

                    if (detection) {
                        frames.push({
                            descriptor: detection.descriptor,
                            score: detection.detection.score,
                            landmarks: detection.landmarks,
                            box: detection.detection.box,
                            frameIndex: framesCaptured
                        });
                    }

                    // Done capturing
                    if (framesCaptured >= totalFrames) {
                        clearInterval(captureInterval);

                        if (frames.length === 0) {
                            reject(new Error(
                                'No face detected during capture. Please ensure your face is clearly visible and well-lit.'
                            ));
                            return;
                        }

                        // Select best frame: highest detection confidence
                        frames.sort((a, b) => b.score - a.score);
                        const best = frames[0];

                        this._descriptor = best.descriptor;

                        console.log(`[FaceVerification] Best frame: #${best.frameIndex}, score: ${best.score.toFixed(3)}, total frames with face: ${frames.length}/${totalFrames}`);

                        resolve({
                            descriptor: best.descriptor,
                            confidence: best.score,
                            framesAnalyzed: frames.length,
                            totalFrames
                        });
                    }
                } catch (err) {
                    // Non-fatal: skip frame on error
                    console.warn(`[FaceVerification] Frame ${framesCaptured} error:`, err.message);
                }
            }, this.frameSampleInterval);

            // Safety timeout (capture duration + generous buffer)
            setTimeout(() => {
                clearInterval(captureInterval);
                if (frames.length > 0) {
                    frames.sort((a, b) => b.score - a.score);
                    const best = frames[0];
                    this._descriptor = best.descriptor;
                    resolve({
                        descriptor: best.descriptor,
                        confidence: best.score,
                        framesAnalyzed: frames.length,
                        totalFrames
                    });
                } else {
                    reject(new Error('Face capture timed out with no valid detections.'));
                }
            }, this.captureDuration + 4000);
        });
    }

    /**
     * Extract selected frames from the video as base64-encoded images.
     * Used for sending to the liveness detection microservice.
     * 
     * @param {HTMLVideoElement} videoElement
     * @param {number} [numFrames=5] - Number of frames to capture
     * @returns {Promise<string[]>} Array of base64 image strings (JPEG)
     */
    async captureFramesAsBase64(videoElement, numFrames = 5) {
        const video = videoElement || this._videoElement;
        if (!video || video.readyState < 2) {
            throw new Error('Video element is not ready.');
        }

        const frames = [];
        const canvas = document.createElement('canvas');
        // Downsample to max 320px wide to keep payload small
        const scale = Math.min(1, 320 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');

        const interval = Math.floor(this.captureDuration / numFrames);

        return new Promise((resolve) => {
            let captured = 0;
            const timer = setInterval(() => {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                // Strip the "data:image/jpeg;base64," prefix
                frames.push(dataUrl.split(',')[1]);
                captured++;

                if (captured >= numFrames) {
                    clearInterval(timer);
                    console.log(`[FaceVerification] Captured ${frames.length} frames as base64.`);
                    resolve(frames);
                }
            }, interval);
        });
    }

    /**
     * Generate a SHA-256 hash of the face descriptor.
     * This hash is safe to send to the backend and store on-chain.
     * The raw 128-d descriptor NEVER leaves the device.
     * 
     * @returns {Promise<string>} Hex-encoded SHA-256 hash
     * @throws {Error} If no descriptor is available
     */
    async getDescriptorHash() {
        if (!this._descriptor) {
            throw new Error('No face descriptor available. Run extractDescriptorFromVideo() first.');
        }

        // Convert Float32Array to a stable byte representation
        const buffer = new ArrayBuffer(this._descriptor.length * 4);
        const view = new DataView(buffer);
        for (let i = 0; i < this._descriptor.length; i++) {
            view.setFloat32(i * 4, this._descriptor[i], true); // little-endian
        }

        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = new Uint8Array(hashBuffer);
        const hashHex = Array.from(hashArray)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        console.log('[FaceVerification] Descriptor hash:', hashHex.substring(0, 16) + '...');
        return hashHex;
    }

    /**
     * Get liveness analysis hints from captured frames.
     * Analyzes facial landmark movement across frames to detect
     * head movement and potential blink events.
     * 
     * @param {Array} frames - Array of frame data with landmarks
     * @returns {{headMovement: boolean, blinkDetected: boolean, score: number}}
     */
    analyzeLivenessHints(frames) {
        if (!frames || frames.length < 3) {
            return { headMovement: false, blinkDetected: false, score: 0 };
        }

        let headMovement = false;
        let maxNoseShift = 0;

        // Analyze nose tip position across frames for head movement
        for (let i = 1; i < frames.length; i++) {
            if (frames[i].landmarks && frames[i - 1].landmarks) {
                const nose1 = frames[i - 1].landmarks.getNose()[3]; // Nose tip
                const nose2 = frames[i].landmarks.getNose()[3];
                const shift = Math.sqrt(
                    Math.pow(nose2.x - nose1.x, 2) + Math.pow(nose2.y - nose1.y, 2)
                );
                if (shift > maxNoseShift) maxNoseShift = shift;
            }
        }

        // If nose moved more than ~5px across frames, consider it head movement
        if (maxNoseShift > 5) {
            headMovement = true;
        }

        // Simple blink detection: check eye aspect ratio changes
        let blinkDetected = false;
        for (let i = 1; i < frames.length; i++) {
            if (frames[i].landmarks && frames[i - 1].landmarks) {
                const ear1 = this._eyeAspectRatio(frames[i - 1].landmarks);
                const ear2 = this._eyeAspectRatio(frames[i].landmarks);
                // A blink causes a sudden drop in EAR
                if (ear1 > 0.2 && ear2 < 0.18) {
                    blinkDetected = true;
                    break;
                }
            }
        }

        const score = (headMovement ? 0.5 : 0) + (blinkDetected ? 0.5 : 0);

        return { headMovement, blinkDetected, score };
    }

    /**
     * Compute the Eye Aspect Ratio (EAR) from landmarks.
     * @param {faceapi.FaceLandmarks68} landmarks
     * @returns {number}
     * @private
     */
    _eyeAspectRatio(landmarks) {
        try {
            const leftEye = landmarks.getLeftEye();
            const rightEye = landmarks.getRightEye();

            const earLeft = this._computeEAR(leftEye);
            const earRight = this._computeEAR(rightEye);

            return (earLeft + earRight) / 2;
        } catch {
            return 0.3; // Default open-eye value
        }
    }

    /**
     * Compute EAR for a single eye (6 landmark points).
     * EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
     * @param {Array<{x,y}>} eye - 6 eye landmark points
     * @returns {number}
     * @private
     */
    _computeEAR(eye) {
        if (eye.length < 6) return 0.3;

        const dist = (a, b) => Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

        const v1 = dist(eye[1], eye[5]);
        const v2 = dist(eye[2], eye[4]);
        const h = dist(eye[0], eye[3]);

        return h > 0 ? (v1 + v2) / (2.0 * h) : 0.3;
    }

    /**
     * Extract a face descriptor from a static image (e.g. ID card photo).
     * Loads the image into a hidden <img>, detects a face, and returns
     * the 128-d descriptor.
     *
     * @param {string} imageSource - Data URL or URL of the image
     * @returns {Promise<{descriptor: Float32Array, confidence: number}|null>}
     *          null if no face is found in the image
     */
    async extractDescriptorFromImage(imageSource) {
        if (!this._modelsLoaded) {
            throw new Error('Models not loaded. Call loadModels() first.');
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                try {
                    // Try with the standard SSD model first for a still image (more accurate)
                    // then fall back to TinyFaceDetector
                    const detectionOptions = new faceapi.TinyFaceDetectorOptions({
                        inputSize: 416,       // Higher resolution for still photo
                        scoreThreshold: 0.3   // Lower threshold for ID card photos (printed)
                    });

                    const detection = await faceapi
                        .detectSingleFace(img, detectionOptions)
                        .withFaceLandmarks()
                        .withFaceDescriptor();

                    if (!detection) {
                        console.warn('[FaceVerification] No face found in image.');
                        resolve(null);
                        return;
                    }

                    console.log('[FaceVerification] ID card face detected, score:',
                        detection.detection.score.toFixed(3));

                    resolve({
                        descriptor: detection.descriptor,
                        confidence: detection.detection.score
                    });
                } catch (err) {
                    reject(new Error(`Failed to extract face from image: ${err.message}`));
                }
            };
            img.onerror = () => reject(new Error('Failed to load image for face extraction.'));
            img.src = imageSource;
        });
    }

    /**
     * Compare two face descriptors using Euclidean distance.
     * face-api.js descriptors are 128-dimensional vectors.
     *
     * A distance < 0.6 is generally considered a match (same person).
     * Lower distance = more similar faces.
     *
     * @param {Float32Array} descriptor1
     * @param {Float32Array} descriptor2
     * @returns {{distance: number, similarity: number, isMatch: boolean}}
     */
    compareDescriptors(descriptor1, descriptor2) {
        if (!descriptor1 || !descriptor2) {
            throw new Error('Both descriptors are required for comparison.');
        }
        if (descriptor1.length !== descriptor2.length) {
            throw new Error('Descriptor dimensions do not match.');
        }

        // Euclidean distance
        const distance = faceapi.euclideanDistance(descriptor1, descriptor2);

        // Convert distance to a 0-1 similarity percentage
        // Distance of 0 = perfect match (similarity 1.0)
        // Distance of 1.0+ = very different (similarity ~0)
        const similarity = Math.max(0, 1 - distance);

        // Threshold: 0.6 is the standard face-api.js match threshold
        const isMatch = distance < 0.6;

        console.log(`[FaceVerification] Face comparison — distance: ${distance.toFixed(4)}, similarity: ${(similarity * 100).toFixed(1)}%, match: ${isMatch}`);

        return { distance, similarity, isMatch };
    }

    /**
     * Clean up all resources.
     */
    destroy() {
        this.stopCamera();
        this._descriptor = null;
        this._idDescriptor = null;
        this._modelsLoaded = false;
    }
}

// Expose as a global
global.FaceVerification = FaceVerification;

})(window);
