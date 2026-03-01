// frontend/app.js — ID Verification with Blockchain Integration
const API_URL = window.location.origin || 'http://localhost:3001';

// ─── Blockchain State ─────────────────────────────────
let provider = null;
let signer = null;
let votingContract = null;
let enhancedIdentityContract = null;
let walletAccount = null;

// ─── Multi-Factor State ───────────────────────────────
let webauthnDevice = null;
let faceVerification = null;
let deviceIdHash = null;
let faceDescriptorHash = null;
let faceMatchConfirmed = false;
let livenessToken = null;
let combinedVerificationResult = null;

// ─── DOM Elements ─────────────────────────────────────

const walletStatus    = document.getElementById('walletStatus');
const walletAddressEl = document.getElementById('walletAddress');
const verificationOnChainEl = document.getElementById('verificationOnChain');
const apiStatus       = document.getElementById('apiStatus');
const connectWalletBtn = document.getElementById('connectWalletBtn');
const alreadyVerifiedBanner = document.getElementById('alreadyVerifiedBanner');
const alreadyVerifiedInfo   = document.getElementById('alreadyVerifiedInfo');
const uploadArea      = document.getElementById('uploadArea');
const fileInput       = document.getElementById('fileInput');
const uploadBtn       = document.getElementById('uploadBtn');
const previewCard     = document.getElementById('previewCard');
const imagePreview    = document.getElementById('imagePreview');
const resultsCard     = document.getElementById('resultsCard');
const sessionInfo     = document.getElementById('sessionInfo');
const sessionIdSpan   = document.getElementById('sessionId');
const notification    = document.getElementById('notification');

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
const downloadDataBtn       = document.getElementById('downloadDataBtn');
const resetBtn              = document.getElementById('resetBtn');

// Processing overlay
const processingOverlay = document.getElementById('processingOverlay');
const progressBar       = document.getElementById('progressBar');
const progressText      = document.getElementById('progressText');

// ─── Step 4: Device Registration DOM ──────────────────
const deviceCard          = document.getElementById('deviceCard');
const registerDeviceBtn   = document.getElementById('registerDeviceBtn');
const deviceResult        = document.getElementById('deviceResult');
const deviceResultIcon    = document.getElementById('deviceResultIcon');
const deviceResultTitle   = document.getElementById('deviceResultTitle');
const deviceResultSubtitle = document.getElementById('deviceResultSubtitle');
const deviceStatus        = document.getElementById('deviceStatus');

// ─── Step 3: Face Verification DOM ────────────────────
const faceCard            = document.getElementById('faceCard');
const faceVideo           = document.getElementById('faceVideo');
const startFaceCaptureBtn = document.getElementById('startFaceCaptureBtn');
const retryFaceCaptureBtn = document.getElementById('retryFaceCaptureBtn');
const faceProgressBar     = document.getElementById('faceProgressBar');
const faceInstructions    = document.getElementById('faceInstructions');
const faceResult          = document.getElementById('faceResult');
const faceResultIcon      = document.getElementById('faceResultIcon');
const faceResultTitle     = document.getElementById('faceResultTitle');
const faceResultSubtitle  = document.getElementById('faceResultSubtitle');
const livenessResult      = document.getElementById('livenessResult');
const livenessResultIcon  = document.getElementById('livenessResultIcon');
const livenessResultTitle = document.getElementById('livenessResultTitle');
const livenessResultSubtitle = document.getElementById('livenessResultSubtitle');
const faceMatchResult     = document.getElementById('faceMatchResult');
const faceMatchIcon       = document.getElementById('faceMatchIcon');
const faceMatchTitle      = document.getElementById('faceMatchTitle');
const faceMatchSubtitle   = document.getElementById('faceMatchSubtitle');

// ─── Step 5: Combined Verification DOM ────────────────
const combinedCard            = document.getElementById('combinedCard');
const completeVerificationBtn = document.getElementById('completeVerificationBtn');
const factorOcrStatus         = document.getElementById('factorOcrStatus');
const factorDeviceStatus      = document.getElementById('factorDeviceStatus');
const factorFaceStatus        = document.getElementById('factorFaceStatus');
const factorLivenessStatus    = document.getElementById('factorLivenessStatus');
const combinedHashDisplay     = document.getElementById('combinedHashDisplay');
const combinedHashValue       = document.getElementById('combinedHashValue');
const combinedRegStatus       = document.getElementById('combinedRegStatus');
const combinedRegIcon         = document.getElementById('combinedRegIcon');
const combinedRegTitle        = document.getElementById('combinedRegTitle');
const combinedRegSubtitle     = document.getElementById('combinedRegSubtitle');

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

// ─── Wallet Connection ────────────────────────────────

connectWalletBtn.addEventListener('click', connectWallet);

async function connectWallet() {
    if (typeof window.ethereum === 'undefined') {
        showNotification('Please install MetaMask to register your identity on blockchain', 'error');
        return;
    }

    try {
        showNotification('Connecting to MetaMask...', 'info');
        var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

        if (accounts.length > 0) {
            walletAccount = accounts[0];
            provider = new ethers.BrowserProvider(window.ethereum);
            signer = await provider.getSigner();

            // Check network
            var network = await provider.getNetwork();
            var chainId = Number(network.chainId);
            if (chainId !== 1337) {
                showNotification('Please switch to Hardhat Local network (Chain ID: 1337)', 'error');
                return;
            }

            // Initialize voting contract
            if (typeof VOTING_CONTRACT_ADDRESS !== 'undefined' && typeof VOTING_CONTRACT_ABI !== 'undefined') {
                votingContract = new ethers.Contract(VOTING_CONTRACT_ADDRESS, VOTING_CONTRACT_ABI, signer);
            } else {
                showNotification('Contract config not found. Please deploy the contract first.', 'error');
                return;
            }

            // Initialize enhanced identity contract (optional — may not be deployed yet)
            if (typeof ENHANCED_IDENTITY_ADDRESS !== 'undefined' && typeof ENHANCED_IDENTITY_ABI !== 'undefined') {
                enhancedIdentityContract = new ethers.Contract(ENHANCED_IDENTITY_ADDRESS, ENHANCED_IDENTITY_ABI, signer);
                console.log('[Wallet] Enhanced Identity contract initialized');
            } else {
                console.log('[Wallet] Enhanced Identity contract not available (not deployed yet)');
            }

            // Update UI
            walletStatus.textContent = 'Connected';
            walletStatus.className = 'status-value online';
            walletAddressEl.textContent = walletAccount.substring(0, 6) + '...' + walletAccount.substring(walletAccount.length - 4);
            connectWalletBtn.textContent = '✅ Wallet Connected';
            connectWalletBtn.disabled = true;

            showNotification('Wallet connected successfully!', 'success');

            // Check if already verified on-chain
            await checkOnChainVerification();
        }
    } catch (error) {
        console.error('Wallet connection error:', error);
        showNotification('Failed to connect wallet: ' + error.message, 'error');
    }

    // Listen for account changes
    if (window.ethereum) {
        window.ethereum.on('accountsChanged', async function (accounts) {
            if (accounts.length > 0) {
                walletAccount = accounts[0];
                provider = new ethers.BrowserProvider(window.ethereum);
                signer = await provider.getSigner();
                votingContract = new ethers.Contract(VOTING_CONTRACT_ADDRESS, VOTING_CONTRACT_ABI, signer);
                if (typeof ENHANCED_IDENTITY_ADDRESS !== 'undefined' && typeof ENHANCED_IDENTITY_ABI !== 'undefined') {
                    enhancedIdentityContract = new ethers.Contract(ENHANCED_IDENTITY_ADDRESS, ENHANCED_IDENTITY_ABI, signer);
                }
                walletAddressEl.textContent = walletAccount.substring(0, 6) + '...' + walletAccount.substring(walletAccount.length - 4);
                await checkOnChainVerification();
            }
        });
    }
}

async function checkOnChainVerification() {
    if (!votingContract || !walletAccount) return;

    var dashboard = document.getElementById('verifiedDashboard');
    var mainContent = document.getElementById('mainContent');

    try {
        var isVerified = await votingContract.isVoterVerified(walletAccount);
        if (isVerified) {
            verificationOnChainEl.textContent = '✅ Verified';
            verificationOnChainEl.className = 'status-value online';

            // Get voter details
            var voter = await votingContract.getVerifiedVoter(walletAccount);
            alreadyVerifiedInfo.textContent =
                'Registered as "' + voter.name + '" (' + voter.idType + ') on ' +
                new Date(Number(voter.verifiedAt) * 1000).toLocaleDateString() +
                '. You can proceed to the voting portal.';
            alreadyVerifiedBanner.classList.remove('hidden');

            // ── Show verified dashboard, hide verification steps ──
            if (dashboard && mainContent) {
                mainContent.classList.add('hidden');
                dashboard.classList.remove('hidden');

                // Show device auth gate first, hide dashboard content
                var deviceAuthGate = document.getElementById('deviceAuthGate');
                var dashboardContent = document.getElementById('dashboardContent');
                if (deviceAuthGate) deviceAuthGate.classList.remove('hidden');
                if (dashboardContent) dashboardContent.classList.add('hidden');

                // Fill dashboard details from Voting contract (populated but hidden)
                var dashName = document.getElementById('dashName');
                var dashIdType = document.getElementById('dashIdType');
                var dashVerifiedAt = document.getElementById('dashVerifiedAt');
                if (dashName) dashName.textContent = voter.name || '—';
                if (dashIdType) dashIdType.textContent = voter.idType || '—';
                if (dashVerifiedAt) dashVerifiedAt.textContent =
                    new Date(Number(voter.verifiedAt) * 1000).toLocaleString();

                // Check EnhancedIdentity contract for multi-factor details
                if (enhancedIdentityContract) {
                    try {
                        var enhanced = await enhancedIdentityContract.isVerified(walletAccount);
                        var dashEnhancedRow = document.getElementById('dashEnhancedRow');
                        var dashEnhanced = document.getElementById('dashEnhanced');
                        var dashFactorsRow = document.getElementById('dashFactorsRow');
                        var dashFactors = document.getElementById('dashFactors');
                        var dashFactorBadges = document.getElementById('dashFactorBadges');

                        if (enhanced) {
                            var identity = await enhancedIdentityContract.getIdentity(walletAccount);
                            var factorCount = Number(identity.factorsVerified || 0);
                            var verifiedTime = Number(identity.verifiedAt || 0);

                            if (dashEnhancedRow) dashEnhancedRow.style.display = '';
                            if (dashEnhanced) dashEnhanced.textContent = '✅ Active';
                            if (dashFactorsRow) dashFactorsRow.style.display = '';
                            if (dashFactors) dashFactors.textContent = factorCount + ' / 4';

                            // Show factor badges with active/inactive state
                            if (dashFactorBadges) {
                                dashFactorBadges.style.display = '';
                                var hasSsn = identity.ssnHash !== ethers.ZeroHash;
                                var hasDevice = identity.deviceIdHash !== ethers.ZeroHash;
                                var hasFace = identity.faceHash !== ethers.ZeroHash;
                                // Liveness is inferred: if face + factors >= 4
                                var hasLiveness = hasFace && factorCount >= 4;

                                var badgeOcr = document.getElementById('dashBadgeOcr');
                                var badgeDevice = document.getElementById('dashBadgeDevice');
                                var badgeFace = document.getElementById('dashBadgeFace');
                                var badgeLiveness = document.getElementById('dashBadgeLiveness');
                                if (badgeOcr) badgeOcr.className = 'factor-badge ' + (hasSsn ? 'badge-ok' : 'badge-missing');
                                if (badgeDevice) badgeDevice.className = 'factor-badge ' + (hasDevice ? 'badge-ok' : 'badge-missing');
                                if (badgeFace) badgeFace.className = 'factor-badge ' + (hasFace ? 'badge-ok' : 'badge-missing');
                                if (badgeLiveness) badgeLiveness.className = 'factor-badge ' + (hasLiveness ? 'badge-ok' : 'badge-missing');
                            }

                            // Override verified-at with enhanced timestamp if available
                            if (verifiedTime > 0 && dashVerifiedAt) {
                                dashVerifiedAt.textContent = new Date(verifiedTime * 1000).toLocaleString();
                            }
                        } else {
                            if (dashEnhancedRow) dashEnhancedRow.style.display = '';
                            if (dashEnhanced) dashEnhanced.textContent = '⚠️ Basic only (no multi-factor)';
                        }
                    } catch (enhErr) {
                        console.warn('[Dashboard] Could not read EnhancedIdentity:', enhErr.message);
                    }
                }

                // Wire re-verify button
                var reverifyBtn = document.getElementById('reverifyBtn');
                if (reverifyBtn) {
                    reverifyBtn.onclick = function () {
                        dashboard.classList.add('hidden');
                        mainContent.classList.remove('hidden');
                    };
                }

                // Wire device authentication button (returning user gate)
                var deviceAuthBtn = document.getElementById('deviceAuthBtn');
                var skipDeviceAuthBtn = document.getElementById('skipDeviceAuthBtn');
                var deviceAuthResult = document.getElementById('deviceAuthResult');
                var deviceAuthResultIcon = document.getElementById('deviceAuthResultIcon');
                var deviceAuthResultTitle = document.getElementById('deviceAuthResultTitle');
                var deviceAuthResultSubtitle = document.getElementById('deviceAuthResultSubtitle');

                function revealDashboard() {
                    if (deviceAuthGate) deviceAuthGate.classList.add('hidden');
                    if (dashboardContent) dashboardContent.classList.remove('hidden');
                }

                if (deviceAuthBtn) {
                    deviceAuthBtn.onclick = async function () {
                        deviceAuthBtn.disabled = true;
                        deviceAuthBtn.textContent = '⏳ Authenticating...';
                        if (deviceAuthResult) {
                            deviceAuthResult.classList.remove('hidden');
                            deviceAuthResult.className = 'verification-banner';
                            deviceAuthResultIcon.textContent = '⏳';
                            deviceAuthResultTitle.textContent = 'Authenticating...';
                            deviceAuthResultSubtitle.textContent = 'Follow device prompts';
                        }

                        try {
                            if (!WebAuthnDevice) throw new Error('WebAuthn module not loaded');
                            if (!WebAuthnDevice.isSupported()) throw new Error('WebAuthn not supported on this browser');

                            var device = new WebAuthnDevice(walletAccount);
                            var authResult = await device.authenticate();
                            if (!authResult || !authResult.credentialId) {
                                throw new Error('Authentication failed — no credential returned');
                            }

                            // Device authenticated successfully
                            if (deviceAuthResult) {
                                deviceAuthResult.className = 'verification-banner verified';
                                deviceAuthResultIcon.textContent = '✅';
                                deviceAuthResultTitle.textContent = 'Device Verified!';
                                deviceAuthResultSubtitle.textContent = 'Welcome back! Loading your dashboard...';
                            }
                            showNotification('Device authenticated successfully! Welcome back.', 'success');

                            // Brief delay then reveal dashboard
                            setTimeout(revealDashboard, 800);

                        } catch (authErr) {
                            console.warn('[DeviceAuth] Authentication failed:', authErr.message);
                            if (deviceAuthResult) {
                                deviceAuthResult.className = 'verification-banner failed';
                                deviceAuthResultIcon.textContent = '❌';
                                deviceAuthResultTitle.textContent = 'Device Authentication Failed';
                                deviceAuthResultSubtitle.textContent = authErr.message + ' — You can skip or try again.';
                            }
                            deviceAuthBtn.disabled = false;
                            deviceAuthBtn.textContent = '📱 Authenticate Device';
                        }
                    };
                }

                if (skipDeviceAuthBtn) {
                    skipDeviceAuthBtn.onclick = function () {
                        revealDashboard();
                        showNotification('Dashboard loaded without device verification.', 'info');
                    };
                }
            }
        } else {
            verificationOnChainEl.textContent = 'Not Verified';
            verificationOnChainEl.className = 'status-value offline';
            alreadyVerifiedBanner.classList.add('hidden');
            if (dashboard) dashboard.classList.add('hidden');
            if (mainContent) mainContent.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error checking on-chain verification:', error);
        verificationOnChainEl.textContent = 'Error';
    }
}

// Auto-connect wallet on page load
async function autoConnectWallet() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            var accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                walletAccount = accounts[0];
                provider = new ethers.BrowserProvider(window.ethereum);
                signer = await provider.getSigner();

                var network = await provider.getNetwork();
                if (Number(network.chainId) === 1337) {
                    if (typeof VOTING_CONTRACT_ADDRESS !== 'undefined' && typeof VOTING_CONTRACT_ABI !== 'undefined') {
                        votingContract = new ethers.Contract(VOTING_CONTRACT_ADDRESS, VOTING_CONTRACT_ABI, signer);
                    }
                    if (typeof ENHANCED_IDENTITY_ADDRESS !== 'undefined' && typeof ENHANCED_IDENTITY_ABI !== 'undefined') {
                        enhancedIdentityContract = new ethers.Contract(ENHANCED_IDENTITY_ADDRESS, ENHANCED_IDENTITY_ABI, signer);
                    }
                    walletStatus.textContent = 'Connected';
                    walletStatus.className = 'status-value online';
                    walletAddressEl.textContent = walletAccount.substring(0, 6) + '...' + walletAccount.substring(walletAccount.length - 4);
                    connectWalletBtn.textContent = '✅ Wallet Connected';
                    connectWalletBtn.disabled = true;
                    await checkOnChainVerification();
                }
            }
        } catch (e) {
            console.log('Auto-connect skipped:', e.message);
        }
    }
}
autoConnectWallet();

// ─── Health Check ─────────────────────────────────────

async function checkHealth() {
    try {
        const response = await fetch(API_URL + '/api/health');
        const data = await response.json();

        if (response.ok) {
            apiStatus.textContent   = 'Connected';
            apiStatus.className     = 'status-value online';
        } else {
            throw new Error('Health check failed');
        }
    } catch (error) {
        console.error('Health check failed:', error);
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

    // Show next step ONLY if ALL fields verified
    if (overallStatus === 'verified') {
        // ── Show Step 3: Face Verification ──
        if (faceCard) {
            faceCard.classList.remove('hidden');
            showNotification('OCR verified! Now proceed to face verification (Step 3).', 'success');
        }
    } else {
        // Hide multi-factor steps if OCR failed
        if (deviceCard) deviceCard.classList.add('hidden');
        if (faceCard) faceCard.classList.add('hidden');
        if (combinedCard) combinedCard.classList.add('hidden');
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

// Old single-contract blockchain registration removed — now handled by Step 5 Combined Verification

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

    // Reset multi-factor state
    if (faceVerification) { faceVerification.destroy(); faceVerification = null; }
    if (webauthnDevice) { webauthnDevice.clear(); webauthnDevice = null; }
    deviceIdHash = null;
    faceDescriptorHash = null;
    faceMatchConfirmed = false;
    livenessToken = null;
    combinedVerificationResult = null;

    // Hide multi-factor cards
    if (deviceCard) { deviceCard.classList.add('hidden'); deviceResult.classList.add('hidden'); }
    if (faceCard) { faceCard.classList.add('hidden'); faceResult.classList.add('hidden'); livenessResult.classList.add('hidden'); if (faceMatchResult) faceMatchResult.classList.add('hidden'); }
    if (combinedCard) { combinedCard.classList.add('hidden'); combinedRegStatus.classList.add('hidden'); combinedHashDisplay.classList.add('hidden'); }

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

// ═══════════════════════════════════════════════════════
// ─── STEP 4: DEVICE REGISTRATION (WebAuthn) ──────────
// ═══════════════════════════════════════════════════════

if (registerDeviceBtn) {
    registerDeviceBtn.addEventListener('click', async function () {
        if (!WebAuthnDevice) {
            showNotification('WebAuthn module not loaded.', 'error');
            return;
        }

        if (!WebAuthnDevice.isSupported()) {
            showNotification('WebAuthn is not supported on this browser/device.', 'error');
            return;
        }

        registerDeviceBtn.disabled = true;
        registerDeviceBtn.textContent = '⏳ Registering Device...';
        deviceResult.classList.remove('hidden');
        deviceResult.className = 'verification-banner';
        deviceResultIcon.textContent = '⏳';
        deviceResultTitle.textContent = 'Registering Device...';
        deviceResultSubtitle.textContent = 'Please follow your device prompts (fingerprint, face, or PIN).';

        try {
            webauthnDevice = new WebAuthnDevice();
            var credential = await webauthnDevice.register(walletAccount || undefined);
            deviceIdHash = await webauthnDevice.getDeviceIdHash();

            // Register device credential on backend
            await fetch(API_URL + '/api/webauthn/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    credentialId: credential.credentialId,
                    rawId: credential.rawId,
                    publicKey: credential.publicKey,
                    algorithm: credential.algorithm,
                    deviceIdHash: deviceIdHash
                })
            });

            // Update UI — success
            deviceResult.className = 'verification-banner verified';
            deviceResultIcon.textContent = '✅';
            deviceResultTitle.textContent = 'Device Registered!';
            deviceResultSubtitle.textContent = 'Device hash: ' + deviceIdHash.substring(0, 16) + '...';
            if (deviceStatus) {
                deviceStatus.querySelector('.status-icon').textContent = '✅';
                deviceStatus.querySelector('span:last-child').textContent = 'Device registered';
            }
            registerDeviceBtn.textContent = '✅ Device Registered';

            showNotification('Device registered! Proceed to complete verification (Step 5).', 'success');

            // Show Step 5: Combined Verification
            showCombinedCard();

        } catch (error) {
            console.error('[WebAuthn] Registration error:', error);
            deviceResult.className = 'verification-banner failed';
            deviceResultIcon.textContent = '❌';
            deviceResultTitle.textContent = 'Device Registration Failed';
            deviceResultSubtitle.textContent = error.message;
            registerDeviceBtn.disabled = false;
            registerDeviceBtn.textContent = '📱 Register This Device';
            showNotification('Device registration failed: ' + error.message, 'error');
        }
    });
}

// ═══════════════════════════════════════════════════════
// ─── STEP 3: FACE VERIFICATION & LIVENESS ────────────
// ═══════════════════════════════════════════════════════

if (startFaceCaptureBtn) {
    startFaceCaptureBtn.addEventListener('click', async function () {
        if (!FaceVerification) {
            showNotification('Face verification module not loaded.', 'error');
            return;
        }

        startFaceCaptureBtn.disabled = true;
        startFaceCaptureBtn.textContent = '⏳ Loading Models...';
        faceResult.classList.add('hidden');
        livenessResult.classList.add('hidden');
        if (faceMatchResult) faceMatchResult.classList.add('hidden');
        if (retryFaceCaptureBtn) retryFaceCaptureBtn.classList.add('hidden');

        try {
            // 1. Initialize and load models
            faceVerification = new FaceVerification();
            if (faceInstructions) faceInstructions.textContent = 'Loading face detection models...';
            await faceVerification.loadModels();

            // 2. Start camera
            startFaceCaptureBtn.textContent = '📷 Starting Camera...';
            if (faceInstructions) faceInstructions.textContent = 'Starting camera...';
            await faceVerification.startCamera(faceVideo);

            // 3. Begin capture
            startFaceCaptureBtn.textContent = '🔍 Analyzing Face...';
            if (faceInstructions) faceInstructions.textContent = 'Look at the camera. Blink naturally and move your head slightly.';

            // Start descriptor extraction + frame capture in parallel
            var descriptorPromise = faceVerification.extractDescriptorFromVideo(faceVideo, function(progress, msg) {
                if (faceProgressBar) faceProgressBar.style.width = (progress * 100) + '%';
                if (faceInstructions) faceInstructions.textContent = msg;
            });

            var framesPromise = faceVerification.captureFramesAsBase64(faceVideo, 6);

            var results = await Promise.all([descriptorPromise, framesPromise]);
            var descriptorResult = results[0];
            var capturedFrames = results[1];

            // 4. Get face descriptor hash (stays on device)
            faceDescriptorHash = await faceVerification.getDescriptorHash();

            // Show face result
            faceResult.classList.remove('hidden');
            faceResult.className = 'verification-banner verified';
            faceResultIcon.textContent = '✅';
            faceResultTitle.textContent = 'Face Detected!';
            faceResultSubtitle.textContent = 'Confidence: ' + (descriptorResult.confidence * 100).toFixed(1) +
                '% (' + descriptorResult.framesAnalyzed + '/' + descriptorResult.totalFrames + ' frames)';

            // 4b. Compare live face with ID card photo
            if (faceMatchResult) {
                faceMatchResult.classList.remove('hidden');
                faceMatchResult.className = 'verification-banner';
                faceMatchIcon.textContent = '🔍';
                faceMatchTitle.textContent = 'Comparing with ID Card...';
                faceMatchSubtitle.textContent = 'Extracting face from your uploaded ID document';
            }

            var idCardFaceMatch = false;
            try {
                var idImageSrc = imagePreview ? imagePreview.src : null;
                if (!idImageSrc || idImageSrc === '' || idImageSrc === window.location.href) {
                    throw new Error('No ID card image available. Complete Step 2 (OCR) first.');
                }

                var idFaceResult = await faceVerification.extractDescriptorFromImage(idImageSrc);
                if (!idFaceResult) {
                    throw new Error('No face detected in the ID card image. Ensure the photo on your ID is clear.');
                }

                // Compare: live face vs ID card face
                var comparison = faceVerification.compareDescriptors(
                    descriptorResult.descriptor,
                    idFaceResult.descriptor
                );

                if (comparison.isMatch) {
                    idCardFaceMatch = true;
                    faceMatchResult.className = 'verification-banner verified';
                    faceMatchIcon.textContent = '✅';
                    faceMatchTitle.textContent = 'Face Match Confirmed!';
                    faceMatchSubtitle.textContent = 'Similarity: ' + (comparison.similarity * 100).toFixed(1) +
                        '% (distance: ' + comparison.distance.toFixed(3) + ') — Your live face matches the ID card photo.';
                } else {
                    faceMatchResult.className = 'verification-banner failed';
                    faceMatchIcon.textContent = '❌';
                    faceMatchTitle.textContent = 'Face Mismatch!';
                    faceMatchSubtitle.textContent = 'Similarity: ' + (comparison.similarity * 100).toFixed(1) +
                        '% (distance: ' + comparison.distance.toFixed(3) + ') — Your live face does NOT match the ID card photo.';
                }
            } catch (matchErr) {
                console.warn('[FaceMatch] Could not compare faces:', matchErr.message);
                if (faceMatchResult) {
                    faceMatchResult.className = 'verification-banner warning';
                    faceMatchIcon.textContent = '⚠️';
                    faceMatchTitle.textContent = 'Face Comparison Unavailable';
                    faceMatchSubtitle.textContent = matchErr.message;
                }
            }

            // 5. Send frames to liveness detection service
            if (faceInstructions) faceInstructions.textContent = 'Checking liveness...';
            livenessResult.classList.remove('hidden');
            livenessResult.className = 'verification-banner';
            livenessResultIcon.textContent = '⏳';
            livenessResultTitle.textContent = 'Liveness Check...';
            livenessResultSubtitle.textContent = 'Analyzing frames for liveness indicators';

            try {
                var livenessResponse = await fetch(API_URL + '/api/liveness/detect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ frames: capturedFrames })
                });

                var livenessData = await livenessResponse.json();

                if (livenessData.success && livenessData.isLive) {
                    livenessToken = livenessData.token;
                    livenessResult.className = 'verification-banner verified';
                    livenessResultIcon.textContent = '✅';
                    livenessResultTitle.textContent = 'Liveness Confirmed!';
                    livenessResultSubtitle.textContent = 'Score: ' + (livenessData.confidence * 100).toFixed(0) +
                        '% — Blinks: ' + (livenessData.blinks != null ? livenessData.blinks : (livenessData.details ? livenessData.details.blinks : '?')) +
                        ', Head movement: ' + (livenessData.headMovement ? 'Yes' : 'No');
                } else {
                    livenessResult.className = 'verification-banner failed';
                    livenessResultIcon.textContent = '❌';
                    livenessResultTitle.textContent = 'Liveness Check Failed';
                    livenessResultSubtitle.textContent = livenessData.message || 'Could not confirm liveness. Try again with better lighting.';
                    livenessToken = null;
                }
            } catch (livenessErr) {
                console.warn('[Liveness] Service unavailable:', livenessErr.message);
                livenessResult.className = 'verification-banner warning';
                livenessResultIcon.textContent = '⚠️';
                livenessResultTitle.textContent = 'Liveness Service Unavailable';
                livenessResultSubtitle.textContent = 'The liveness microservice is not running. Face hash was still captured.';
                livenessToken = null;
            }

            // 6. Stop camera
            faceVerification.stopCamera();
            if (faceInstructions) faceInstructions.textContent = 'Face verification complete!';
            startFaceCaptureBtn.textContent = '✅ Face Captured';

            // Only proceed to Step 4 if face match succeeded
            if (idCardFaceMatch) {
                faceMatchConfirmed = true;
                showNotification('Face matched with ID card! Now register your device (Step 4).', 'success');

                // Show retry button
                if (retryFaceCaptureBtn) retryFaceCaptureBtn.classList.remove('hidden');

                // Show Step 4: Device Registration
                if (deviceCard) {
                    deviceCard.classList.remove('hidden');
                }
            } else {
                faceMatchConfirmed = false;
                showNotification('Face does NOT match ID card. Please retry with the correct ID.', 'error');

                // Show retry button but do NOT show Step 4
                if (retryFaceCaptureBtn) retryFaceCaptureBtn.classList.remove('hidden');
                startFaceCaptureBtn.disabled = false;
                startFaceCaptureBtn.textContent = '📷 Retry Face Capture';
            }

        } catch (error) {
            console.error('[FaceVerification] Error:', error);
            faceResult.classList.remove('hidden');
            faceResult.className = 'verification-banner failed';
            faceResultIcon.textContent = '❌';
            faceResultTitle.textContent = 'Face Capture Failed';
            faceResultSubtitle.textContent = error.message;

            if (faceVerification) faceVerification.stopCamera();
            startFaceCaptureBtn.disabled = false;
            startFaceCaptureBtn.textContent = '📷 Start Face Capture';
            if (retryFaceCaptureBtn) retryFaceCaptureBtn.classList.remove('hidden');
            showNotification('Face capture failed: ' + error.message, 'error');
        }
    });
}

// Retry face capture
if (retryFaceCaptureBtn) {
    retryFaceCaptureBtn.addEventListener('click', function () {
        faceDescriptorHash = null;
        faceMatchConfirmed = false;
        livenessToken = null;
        faceResult.classList.add('hidden');
        if (faceMatchResult) faceMatchResult.classList.add('hidden');
        livenessResult.classList.add('hidden');
        retryFaceCaptureBtn.classList.add('hidden');
        if (faceProgressBar) faceProgressBar.style.width = '0%';
        startFaceCaptureBtn.disabled = false;
        startFaceCaptureBtn.textContent = '📷 Start Face Capture';
        if (faceInstructions) faceInstructions.textContent = 'Position your face in the oval';
    });
}

// ═══════════════════════════════════════════════════════
// ─── STEP 5: COMBINED VERIFICATION ───────────────────
// ═══════════════════════════════════════════════════════

function showCombinedCard() {
    if (!combinedCard) return;
    combinedCard.classList.remove('hidden');

    // Update factor statuses
    var ocrOk = !!(currentSessionId && verificationData &&
        verificationData.crossVerification && verificationData.crossVerification.overallStatus === 'verified');
    var deviceOk = !!deviceIdHash;
    var faceOk = !!faceDescriptorHash;
    var livenessOk = !!livenessToken;

    setFactorStatus(factorOcrStatus, ocrOk);
    setFactorStatus(factorDeviceStatus, deviceOk);
    setFactorStatus(factorFaceStatus, faceOk);
    setFactorStatus(factorLivenessStatus, livenessOk);
}

function setFactorStatus(el, ok) {
    if (!el) return;
    if (ok) {
        el.textContent = '✅ Verified';
        el.className = 'factor-status factor-ok';
    } else {
        el.textContent = '❌ Pending';
        el.className = 'factor-status factor-pending';
    }
}

if (completeVerificationBtn) {
    completeVerificationBtn.addEventListener('click', async function () {
        // Check prerequisites
        if (!currentSessionId || !verificationData) {
            showNotification('Please complete OCR verification (Step 2) first.', 'error');
            return;
        }
        if (!faceMatchConfirmed) {
            showNotification('Face verification required: your live face must match the ID card photo (Step 3).', 'error');
            return;
        }
        if (!walletAccount || !votingContract) {
            showNotification('Please connect your MetaMask wallet first.', 'error');
            return;
        }

        completeVerificationBtn.disabled = true;
        completeVerificationBtn.textContent = '⏳ Processing...';

        combinedRegStatus.classList.remove('hidden');
        combinedRegStatus.className = 'verification-banner';
        combinedRegIcon.textContent = '⏳';
        combinedRegTitle.textContent = 'Combining Verification Factors...';
        combinedRegSubtitle.textContent = 'Sending combined verification to backend';

        try {
            // 1. Authenticate device (get fresh assertion for server verification)
            var deviceAssertion = null;
            if (webauthnDevice) {
                try {
                    combinedRegSubtitle.textContent = 'Authenticating device... Follow your device prompts.';
                    deviceAssertion = await webauthnDevice.authenticate();
                    console.log('[CombinedVerification] Device assertion obtained:', deviceAssertion.credentialId);
                } catch (devErr) {
                    console.warn('[CombinedVerification] Device auth skipped:', devErr.message);
                }
            }

            // 2. Call combined verification endpoint
            var credData = webauthnDevice ? webauthnDevice.getCredentialData() : {};
            var payload = {
                sessionId: currentSessionId,
                walletAddress: walletAccount,
                deviceCredentialId: deviceAssertion ? deviceAssertion.credentialId : (credData.credentialId || null),
                deviceRawId: deviceAssertion ? deviceAssertion.rawId : (credData.credentialId || null),
                deviceSignature: deviceAssertion ? deviceAssertion.signature : null,
                deviceAuthenticatorData: deviceAssertion ? deviceAssertion.authenticatorData : null,
                deviceClientDataJSON: deviceAssertion ? deviceAssertion.clientDataJSON : null,
                faceDescriptorHash: faceDescriptorHash || null,
                faceMatchConfirmed: faceMatchConfirmed || false,
                livenessToken: livenessToken || null
            };

            var response = await fetch(API_URL + '/api/verify-identity-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            var data = await response.json();
            combinedVerificationResult = data;

            if (!data.success) {
                throw new Error(data.error || 'Combined verification failed');
            }

            // Show combined hash
            if (data.combinedHash && combinedHashDisplay && combinedHashValue) {
                combinedHashDisplay.classList.remove('hidden');
                combinedHashValue.textContent = data.combinedHash.substring(0, 20) + '...';
            }

            combinedRegTitle.textContent = 'Verification Combined';
            combinedRegSubtitle.textContent = 'Status: ' + data.verificationStatus +
                ' (' + data.factorsVerified + ' factors). Registering on blockchain...';

            // 2. Register on the Voting contract (basic identity registration)
            var idHash = verificationData.hash;
            var voterName = (verificationData.userInput && verificationData.userInput.name) || '';
            var idTypeLabel = ID_TYPE_LABELS[(verificationData.userInput && verificationData.userInput.idType)] || 'Unknown';

            // Check if already registered on Voting contract
            var alreadyRegistered = false;
            try {
                alreadyRegistered = await votingContract.isVoterVerified(walletAccount);
            } catch (e) { /* ignore */ }

            if (!alreadyRegistered && idHash) {
                combinedRegSubtitle.textContent = 'Registering on Voting contract... Confirm in MetaMask.';
                var tx1 = await votingContract.registerVerifiedVoter(idHash, voterName, idTypeLabel);
                await tx1.wait();
                console.log('[Blockchain] Voting contract registration confirmed');
            }

            // 3. Register on Enhanced Identity contract (multi-factor)
            if (enhancedIdentityContract && data.combinedHash) {
                combinedRegSubtitle.textContent = 'Registering enhanced identity... Confirm in MetaMask.';

                var ssnHashBytes32 = idHash ? ethers.id(idHash) : ethers.ZeroHash;
                var deviceHashBytes32 = deviceIdHash ? ethers.id(deviceIdHash) : ethers.ZeroHash;
                var faceHashBytes32 = faceDescriptorHash ? ethers.id(faceDescriptorHash) : ethers.ZeroHash;
                var combinedHashBytes32 = ethers.id(data.combinedHash);
                var factorsCount = data.factorsVerified || 1;

                try {
                    // Check if already registered on enhanced identity contract
                    var existingIdentity = await enhancedIdentityContract.isVerified(walletAccount);
                    if (!existingIdentity) {
                        var tx2 = await enhancedIdentityContract.registerIdentity(
                            ssnHashBytes32,
                            deviceHashBytes32,
                            faceHashBytes32,
                            combinedHashBytes32,
                            factorsCount
                        );
                        await tx2.wait();
                        console.log('[Blockchain] Enhanced Identity registration confirmed');
                    }
                } catch (enhancedErr) {
                    console.warn('[Blockchain] Enhanced Identity registration failed (contract may not be deployed):', enhancedErr.message);
                    // Non-fatal: continue with success
                }
            }

            // 4. Success!
            combinedRegStatus.className = 'verification-banner verified';
            combinedRegIcon.textContent = '✅';
            combinedRegTitle.textContent = 'Identity Fully Registered!';
            combinedRegSubtitle.textContent = data.factorsVerified +
                '-factor identity registered on blockchain. You can now be authorized to vote.';
            completeVerificationBtn.textContent = '✅ Registered on Blockchain';

            await checkOnChainVerification();
            showNotification('🎉 Multi-factor identity registered on blockchain!', 'success');

        } catch (error) {
            console.error('[CombinedVerification] Error:', error);
            combinedRegStatus.className = 'verification-banner failed';
            combinedRegIcon.textContent = '❌';
            combinedRegTitle.textContent = 'Registration Failed';

            if (error.message.includes('user rejected')) {
                combinedRegSubtitle.textContent = 'Transaction was cancelled by user.';
            } else if (error.message.includes('already')) {
                combinedRegSubtitle.textContent = 'Identity already registered.';
            } else {
                combinedRegSubtitle.textContent = 'Error: ' + error.message.substring(0, 150);
            }

            completeVerificationBtn.disabled = false;
            completeVerificationBtn.textContent = '🔗 Complete & Register on Blockchain';
            showNotification('Registration failed: ' + error.message, 'error');
        }
    });
}