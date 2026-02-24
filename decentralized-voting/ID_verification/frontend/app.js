// frontend/app.js
const API_URL = window.location.origin || 'http://localhost:3001';

// ─── DOM Elements ─────────────────────────────────────

const systemStatus  = document.getElementById('systemStatus');
const apiStatus     = document.getElementById('apiStatus');
const uploadArea    = document.getElementById('uploadArea');
const fileInput     = document.getElementById('fileInput');
const uploadBtn     = document.getElementById('uploadBtn');
const previewCard   = document.getElementById('previewCard');
const imagePreview  = document.getElementById('imagePreview');
const resultsCard   = document.getElementById('resultsCard');
const sessionInfo   = document.getElementById('sessionInfo');
const sessionIdSpan = document.getElementById('sessionId');
const notification  = document.getElementById('notification');

// User input fields
const userIdType   = document.getElementById('userIdType');
const userIdNumber = document.getElementById('userIdNumber');
const userName     = document.getElementById('userName');
const userDob      = document.getElementById('userDob');

// Comparison elements
const compUserIdType   = document.getElementById('compUserIdType');
const compExtIdType    = document.getElementById('compExtIdType');
const matchIdType      = document.getElementById('matchIdType');
const compUserIdNumber = document.getElementById('compUserIdNumber');
const compExtIdNumber  = document.getElementById('compExtIdNumber');
const matchIdNumber    = document.getElementById('matchIdNumber');
const compUserName     = document.getElementById('compUserName');
const compExtName      = document.getElementById('compExtName');
const matchName        = document.getElementById('matchName');
const compUserDob      = document.getElementById('compUserDob');
const compExtDob       = document.getElementById('compExtDob');
const matchDob         = document.getElementById('matchDob');

// Banner
const verificationBanner = document.getElementById('verificationBanner');
const bannerIcon         = document.getElementById('bannerIcon');
const bannerTitle        = document.getElementById('bannerTitle');
const bannerSubtitle     = document.getElementById('bannerSubtitle');

// Result extras
const confidenceResult = document.getElementById('confidenceResult');
const confidenceBadge  = document.getElementById('confidenceBadge');
const qrResult         = document.getElementById('qrResult');
const qrBadge          = document.getElementById('qrBadge');
const hashResult       = document.getElementById('hashResult');
const rawOcrText       = document.getElementById('rawOcrText');

// Action buttons
const registerBlockchainBtn = document.getElementById('registerBlockchainBtn');
const downloadDataBtn       = document.getElementById('downloadDataBtn');
const resetBtn              = document.getElementById('resetBtn');

// Processing overlay
const processingOverlay = document.getElementById('processingOverlay');
const progressBar       = document.getElementById('progressBar');
const progressText      = document.getElementById('progressText');

// State
let selectedFile     = null;
let currentSessionId = null;
let verificationData = null;
let progressInterval = null;

// ID Type labels
const ID_TYPE_LABELS = {
    aadhaar: 'Aadhaar Card',
    pan: 'PAN Card',
    voter_id: 'Voter ID (EPIC)',
    driving_license: 'Driving License',
    passport: 'Passport'
};

// ─── Health Check ─────────────────────────────────────

async function checkHealth() {
    try {
        const response = await fetch(API_URL + '/api/health');
        const data = await response.json();

        if (response.ok) {
            systemStatus.textContent = 'Online';
            systemStatus.className  = 'status-value online';
            apiStatus.textContent   = 'Connected';
            apiStatus.className     = 'status-value online';
        } else {
            throw new Error('Health check failed');
        }
    } catch (error) {
        console.error('Health check failed:', error);
        systemStatus.textContent = 'Offline';
        systemStatus.className  = 'status-value offline';
        apiStatus.textContent   = 'Disconnected';
        apiStatus.className     = 'status-value offline';
        showNotification('Cannot connect to API server', 'error');
    }
}

checkHealth();
setInterval(checkHealth, 30000);

// ─── File Upload Handlers ─────────────────────────────

uploadArea.addEventListener('click', function () { fileInput.click(); });

uploadArea.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', function () {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', function (e) {
    if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
});

function handleFileSelect(file) {
    var validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp'];
    if (!validTypes.includes(file.type)) {
        showNotification('Please select a valid image file (JPG, PNG, GIF, BMP)', 'error');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showNotification('File size must be less than 10MB', 'error');
        return;
    }

    selectedFile = file;

    var reader = new FileReader();
    reader.onload = function (e) {
        imagePreview.src = e.target.result;
        previewCard.classList.remove('hidden');
    };
    reader.readAsDataURL(file);

    updateUploadButtonState();
    showNotification('File selected. Fill in your details and click "Verify Identity".', 'info');
}

// Enable upload button only when both file and all fields are filled
function updateUploadButtonState() {
    var allFilled = selectedFile
        && userIdType.value.trim() !== ''
        && userIdNumber.value.trim() !== ''
        && userName.value.trim() !== ''
        && userDob.value.trim() !== '';

    uploadBtn.disabled = !allFilled;
}

// Listen for input changes on all fields
userIdType.addEventListener('change', updateUploadButtonState);
userIdNumber.addEventListener('input', updateUploadButtonState);
userName.addEventListener('input', updateUploadButtonState);
userDob.addEventListener('input', updateUploadButtonState);

// ─── Processing Overlay Helpers ───────────────────────

function showProcessing() {
    processingOverlay.classList.remove('hidden');
    for (var i = 1; i <= 5; i++) {
        var step = document.getElementById('step' + i);
        step.className = 'step';
        step.querySelector('.step-icon').textContent = '⏳';
    }
    progressBar.style.width = '0%';
    progressText.textContent = 'Starting...';

    var currentStep = 0;
    var steps = [
        { id: 1, label: 'Preprocessing image...', pct: 10 },
        { id: 2, label: 'Running OCR extraction...', pct: 35 },
        { id: 3, label: 'Scanning for QR codes...', pct: 60 },
        { id: 4, label: 'Cross-verifying your details...', pct: 80 },
        { id: 5, label: 'Generating verification report...', pct: 92 }
    ];

    function advanceStep() {
        if (currentStep > 0) {
            var prev = document.getElementById('step' + steps[currentStep - 1].id);
            prev.className = 'step done';
            prev.querySelector('.step-icon').textContent = '✅';
        }
        if (currentStep < steps.length) {
            var cur = document.getElementById('step' + steps[currentStep].id);
            cur.className = 'step active';
            cur.querySelector('.step-icon').textContent = '🔄';
            progressBar.style.width = steps[currentStep].pct + '%';
            progressText.textContent = steps[currentStep].label;
            currentStep++;
        }
    }

    advanceStep();
    progressInterval = setInterval(function () {
        advanceStep();
        if (currentStep >= steps.length) clearInterval(progressInterval);
    }, 4000);
}

function hideProcessing(success) {
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }

    for (var i = 1; i <= 5; i++) {
        var step = document.getElementById('step' + i);
        step.className = 'step done';
        step.querySelector('.step-icon').textContent = '✅';
    }
    if (!success) {
        var lastStep = document.getElementById('step5');
        lastStep.className = 'step error';
        lastStep.querySelector('.step-icon').textContent = '❌';
    }

    progressBar.style.width = '100%';
    progressText.textContent = success ? 'Complete!' : 'Failed';

    setTimeout(function () {
        processingOverlay.classList.add('hidden');
    }, 800);
}

// ─── Form Validation ──────────────────────────────────

function validateForm() {
    var valid = true;
    var fields = [
        { el: userIdType,   label: 'ID Type' },
        { el: userIdNumber, label: 'ID Number' },
        { el: userName,     label: 'Full Name' },
        { el: userDob,      label: 'Date of Birth' }
    ];

    fields.forEach(function (f) {
        if (!f.el.value.trim()) {
            f.el.classList.add('input-error');
            valid = false;
        } else {
            f.el.classList.remove('input-error');
        }
    });

    if (!valid) {
        showNotification('Please fill in all required fields', 'error');
    }
    return valid;
}

// ─── Upload & Process ─────────────────────────────────

uploadBtn.addEventListener('click', async function () {
    if (!selectedFile) {
        showNotification('Please select a file first', 'error');
        return;
    }

    if (!validateForm()) return;

    // Disable button
    var btnText = uploadBtn.querySelector('.btn-text');
    var spinner = uploadBtn.querySelector('.loading-spinner');
    btnText.textContent = 'Verifying...';
    spinner.classList.remove('hidden');
    uploadBtn.disabled = true;

    showProcessing();

    var formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('userIdType', userIdType.value);
    formData.append('userIdNumber', userIdNumber.value.trim());
    formData.append('userName', userName.value.trim());
    formData.append('userDob', userDob.value.trim());

    try {
        var response = await fetch(API_URL + '/api/extract-ssn', {
            method: 'POST',
            body: formData
        });

        var data = await response.json();

        if (data.success) {
            currentSessionId = data.sessionId;
            verificationData = data.data;

            hideProcessing(true);

            setTimeout(function () {
                displayResults(data.data);
                sessionIdSpan.textContent = currentSessionId;
                sessionInfo.classList.remove('hidden');
                showNotification('Verification complete!', 'success');
            }, 900);
        } else {
            hideProcessing(false);
            showNotification(data.error || 'Verification failed', 'error');
        }
    } catch (error) {
        console.error('Upload error:', error);
        hideProcessing(false);
        showNotification('Failed to connect to server', 'error');
    } finally {
        btnText.textContent = '🔍 Verify Identity';
        spinner.classList.add('hidden');
        uploadBtn.disabled = false;
    }
});

// ─── Display Results (Comparison View) ────────────────

function displayResults(data) {
    resultsCard.classList.remove('hidden');

    var cv = data.crossVerification || {};
    var matches = cv.fieldMatches || {};
    var details = cv.fieldDetails || {};

    // --- Fill comparison rows ---

    // ID Type
    compUserIdType.textContent = ID_TYPE_LABELS[data.userInput && data.userInput.idType] || (data.userInput && data.userInput.idType) || '-';
    compExtIdType.textContent  = details.idType || ((data.extracted && data.extracted.idType && data.extracted.idType.label) || 'Not detected');
    setMatchBadge(matchIdType, matches.idType, document.getElementById('compIdType'));

    // ID Number
    compUserIdNumber.textContent = (data.userInput && data.userInput.idNumber) || '-';
    compExtIdNumber.textContent  = details.idNumber || ((data.extracted && data.extracted.idNumber) || 'Not found');
    setMatchBadge(matchIdNumber, matches.idNumber, document.getElementById('compIdNumber'));

    // Name
    compUserName.textContent = (data.userInput && data.userInput.name) || '-';
    compExtName.textContent  = details.name || ((data.extracted && data.extracted.name) || 'Not found');
    setMatchBadge(matchName, matches.name, document.getElementById('compName'));

    // DOB
    compUserDob.textContent = (data.userInput && data.userInput.dob) || '-';
    compExtDob.textContent  = details.dob || ((data.extracted && data.extracted.dob) || 'Not found');
    setMatchBadge(matchDob, matches.dob, document.getElementById('compDob'));

    // --- Overall banner ---
    var overallStatus = cv.overallStatus || 'failed';
    var matchCount    = cv.matchCount || 0;
    var totalFields   = cv.totalFields || 4;

    verificationBanner.className = 'verification-banner';

    if (overallStatus === 'verified') {
        verificationBanner.classList.add('verified');
        bannerIcon.textContent     = '✅';
        bannerTitle.textContent    = 'Identity Verified';
        bannerSubtitle.textContent = 'All ' + totalFields + ' of ' + totalFields + ' fields successfully matched. You may proceed to register.';
    } else {
        verificationBanner.classList.add('failed');
        bannerIcon.textContent     = '❌';
        bannerTitle.textContent    = 'Verification Failed';
        bannerSubtitle.textContent = 'All ' + totalFields + ' fields must match to register. Only ' + matchCount + ' of ' + totalFields + ' matched. Please re-check your details and upload a clearer photo.';
    }

    // --- Confidence ---
    var conf = (data.extracted && data.extracted.confidence) || 'low';
    var confLabel = conf.charAt(0).toUpperCase() + conf.slice(1);
    confidenceResult.textContent = confLabel;
    if (conf === 'high') {
        confidenceBadge.textContent = 'High';
        confidenceBadge.className   = 'result-badge success';
    } else if (conf === 'medium') {
        confidenceBadge.textContent = 'Medium';
        confidenceBadge.className   = 'result-badge warning';
    } else {
        confidenceBadge.textContent = 'Low';
        confidenceBadge.className   = 'result-badge danger';
    }

    // --- QR Code ---
    if (data.extracted && data.extracted.qrData && data.extracted.qrData.fields) {
        var fields = data.extracted.qrData.fields;
        var summary = Object.keys(fields).slice(0, 3).map(function (k) {
            return k + ': ' + String(fields[k]).substring(0, 30);
        }).join(' | ');
        qrResult.textContent = summary || data.extracted.qrData.raw.substring(0, 60);
        qrBadge.textContent  = 'Detected (' + data.extracted.qrData.format + ')';
        qrBadge.className    = 'result-badge success';
    } else {
        qrResult.textContent = 'No QR code found';
        qrBadge.textContent  = 'None';
        qrBadge.className    = 'result-badge info';
    }

    // --- Hash ---
    if (data.hash) {
        hashResult.textContent = data.hash.substring(0, 20) + '...';
    } else {
        hashResult.textContent = 'No hash generated';
    }

    // Show blockchain button ONLY if ALL fields verified
    if (overallStatus === 'verified') {
        registerBlockchainBtn.classList.remove('hidden');
    } else {
        registerBlockchainBtn.classList.add('hidden');
    }

    // Raw OCR text
    if (data.rawText) {
        rawOcrText.textContent = data.rawText;
    } else {
        rawOcrText.textContent = 'No OCR text available';
    }
}

function setMatchBadge(badgeEl, status, rowEl) {
    if (!status || status === 'not_found') {
        badgeEl.textContent = 'Not Found';
        badgeEl.className   = 'match-badge not-found';
        if (rowEl) rowEl.className = 'comparison-row';
    } else if (status === 'match') {
        badgeEl.textContent = '✅ Match';
        badgeEl.className   = 'match-badge match';
        if (rowEl) rowEl.className = 'comparison-row row-match';
    } else if (status === 'partial') {
        badgeEl.textContent = '⚠️ Partial';
        badgeEl.className   = 'match-badge partial';
        if (rowEl) rowEl.className = 'comparison-row row-partial';
    } else {
        badgeEl.textContent = '❌ Mismatch';
        badgeEl.className   = 'match-badge mismatch';
        if (rowEl) rowEl.className = 'comparison-row row-mismatch';
    }
}

// ─── Blockchain Registration ──────────────────────────

registerBlockchainBtn.addEventListener('click', async function () {
    if (!currentSessionId || !verificationData) {
        showNotification('No verification data available', 'error');
        return;
    }

    showNotification('Preparing blockchain transaction...', 'info');

    setTimeout(function () {
        showNotification('Hash registered on blockchain (simulated)', 'success');
        registerBlockchainBtn.disabled    = true;
        registerBlockchainBtn.textContent = '✅ Registered';
    }, 2000);
});

// ─── Download Data ────────────────────────────────────

downloadDataBtn.addEventListener('click', function () {
    if (!verificationData) {
        showNotification('No data to download', 'error');
        return;
    }

    var payload = {
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId
    };
    for (var key in verificationData) {
        payload[key] = verificationData[key];
    }

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'verification-' + currentSessionId + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Data downloaded', 'success');
});

// ─── Reset ────────────────────────────────────────────

resetBtn.addEventListener('click', function () {
    fileInput.value = '';
    selectedFile    = null;

    // Clear user inputs
    userIdType.value   = '';
    userIdNumber.value = '';
    userName.value     = '';
    userDob.value      = '';

    // Remove input-error classes
    [userIdType, userIdNumber, userName, userDob].forEach(function (el) {
        el.classList.remove('input-error');
    });

    previewCard.classList.add('hidden');
    resultsCard.classList.add('hidden');
    sessionInfo.classList.add('hidden');

    uploadBtn.disabled = true;

    registerBlockchainBtn.disabled    = false;
    registerBlockchainBtn.textContent = '⛓️ Register on Blockchain';
    registerBlockchainBtn.classList.add('hidden');

    showNotification('Ready for new verification', 'info');
});

// ─── Notification ─────────────────────────────────────

function showNotification(message, type) {
    type = type || 'info';
    notification.textContent = message;
    notification.className   = 'notification ' + type + ' show';

    setTimeout(function () {
        notification.classList.remove('show');
    }, 5000);
}

// ─── Keyboard Shortcuts ──────────────────────────────

document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        fileInput.click();
    }
});