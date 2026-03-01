# Decentralized Voting System with Multi-Factor Identity Verification

A blockchain-based voting platform with integrated **multi-factor identity verification** — combining OCR document scanning, WebAuthn device binding, facial recognition with liveness detection, and on-chain identity registration. Built with Solidity, Hardhat, Express, face-api.js, MediaPipe, and ethers.js.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the System](#running-the-system)
- [Step-by-Step Usage](#step-by-step-usage)
- [API Endpoints](#api-endpoints)
- [Smart Contracts](#smart-contracts)
- [Running Tests](#running-tests)
- [Configuration Reference](#configuration-reference)
- [Deploying to Sepolia Testnet](#deploying-to-sepolia-testnet)
- [Troubleshooting](#troubleshooting)
- [Privacy & Security](#privacy--security)

---

## Overview

This system implements a **5-step identity verification pipeline** before allowing users to vote:

| Step | What Happens | Technology |
|------|-------------|-----------|
| **0. Connect Wallet** | User connects MetaMask | ethers.js v6, MetaMask |
| **1. Enter Details** | User fills in ID type, number, name, DOB | Browser form |
| **2. Upload ID Document** | OCR extracts text and cross-verifies against user input | Tesseract.js, sharp, jsQR |
| **3. Face Verification** | Live selfie compared against ID card photo + liveness detection | face-api.js, OpenCV, MediaPipe |
| **4. Device Registration** | Creates a device-bound cryptographic key pair (blocked until face match passes) | WebAuthn API |
| **5. Blockchain Registration** | Combines all factor hashes and registers on-chain | Solidity, ethers.js |

**Privacy guarantees:**
- No raw biometric data is ever sent to the server or stored on-chain
- Only SHA-256 hashes of credentials/descriptors are transmitted
- Face descriptors are computed in the browser and immediately hashed
- The liveness microservice receives only video frames for analysis, no identity data

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Browser (Frontend)                        │
│                                                                  │
│  ┌─────────┐  ┌──────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ MetaMask │  │ WebAuthn │  │  face-api.js │  │  ethers.js  │  │
│  │  Wallet  │  │   API    │  │  (browser)   │  │   v6        │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  └──────┬──────┘  │
│       │              │               │                 │         │
│       └──────────────┴───────────────┴─────────────────┘         │
│                              │                                    │
└──────────────────────────────┼────────────────────────────────────┘
                               │ HTTP (port 3001)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│              Express.js Backend (Node.js, port 3001)             │
│                                                                  │
│  /api/extract-ssn       — OCR extraction + cross-verification    │
│  /api/webauthn/register — Store device credential                │
│  /api/webauthn/verify   — Verify device credential               │
│  /api/liveness/detect   — Proxy to liveness microservice         │
│  /api/verify-identity-complete — Combine all factors             │
│                                                                  │
│  Serves: Voting frontend (/) + ID Verification frontend (/verify)│
└──────────────┬───────────────────────────────────────────────────┘
               │ HTTP (port 5001)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│         Liveness Detection Microservice (Python/Flask)            │
│                         (port 5001)                              │
│                                                                  │
│  POST /detect-liveness — Analyzes video frames for:              │
│    • Blink detection (Eye Aspect Ratio via MediaPipe)            │
│    • Head pose estimation (yaw/pitch via solvePnP)               │
│    • Texture analysis (Laplacian variance for photo detection)   │
│  Returns HMAC-signed liveness token on success                   │
└──────────────────────────────────────────────────────────────────┘

               │ JSON-RPC (port 8545)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Hardhat Local Blockchain                        │
│                                                                  │
│  Voting.sol            — Proposals, voting, voter authorization   │
│  EnhancedIdentity.sol  — Multi-factor identity hash storage      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
decentralized-voting/
├── contracts/                          # Solidity smart contracts
│   ├── Voting.sol                      # Voting + basic identity verification
│   └── EnhancedIdentity.sol            # Multi-factor identity proof storage
├── frontend/                           # Voting portal UI
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── config.js
│   ├── contractABI.js                  # Auto-generated after deploy
│   └── contractAddress.js              # Auto-generated after deploy
├── ID_verification/
│   ├── backend/
│   │   ├── server.js                   # Express API (OCR, WebAuthn, combined verification)
│   │   ├── .env                        # Server configuration
│   │   ├── package.json                # Backend dependencies
│   │   └── liveness/                   # Python liveness microservice
│   │       ├── app.py                  # Flask app (OpenCV + MediaPipe)
│   │       └── requirements.txt        # Python dependencies
│   └── frontend/                       # ID verification UI
│       ├── index.html                  # 5-step verification UI
│       ├── app.js                      # Orchestration logic for all steps
│       ├── style.css                   # Styles including face capture UI
│       ├── contractABI.js              # Voting contract ABI (auto-generated)
│       ├── contractAddress.js          # Voting contract address (auto-generated)
│       ├── enhancedIdentityABI.js      # EnhancedIdentity ABI (auto-generated)
│       ├── enhancedIdentityAddress.js  # EnhancedIdentity address (auto-generated)
│       └── js/
│           ├── webauthn-device.js      # WebAuthn device registration module
│           └── face-verification.js    # Face detection + descriptor extraction
├── scripts/
│   └── deploy.js                       # Deploys both contracts + saves ABIs
├── test/
│   ├── Voting.test.js                  # Voting contract tests
│   └── EnhancedIdentity.test.js        # Enhanced identity contract tests (27 tests)
├── hardhat.config.js
├── package.json
└── README.md
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Smart Contracts | Solidity ^0.8.24, Hardhat | On-chain voting + identity storage |
| Blockchain | Ethereum (local Hardhat / Sepolia) | Decentralized ledger |
| Frontend | Vanilla HTML/CSS/JS, ethers.js v6 | UI, wallet interaction |
| OCR | Tesseract.js, sharp, jsQR | ID document text extraction |
| Device Binding | WebAuthn API (browser-native) | Cryptographic device registration |
| Face Detection | face-api.js (via CDN) | Face descriptor extraction in-browser |
| Liveness Detection | Python, Flask, OpenCV, MediaPipe | Blink/head-pose/texture analysis |
| Backend | Express.js, Multer, Axios | REST API, file upload, service proxy |
| Wallet | MetaMask | Ethereum transaction signing |

---

## Prerequisites

| Requirement | Version | Required For |
|------------|---------|-------------|
| [Node.js](https://nodejs.org/) | v18+ | Backend, Hardhat, deployment |
| [Python](https://www.python.org/) | 3.9+ | Liveness detection microservice |
| [MetaMask](https://metamask.io/) | Latest | Browser wallet |
| npm | (comes with Node.js) | Package management |
| pip | (comes with Python) | Python package management |

> **Note:** Python is only required for the liveness detection feature. The rest of the system works without it (face hash is still captured, just no liveness verification).

---

## Installation

### 1. Install Node.js Dependencies

```bash
cd decentralized-voting
npm install
```

Then install the backend dependencies:

```bash
cd ID_verification/backend
npm install
cd ../..
```

### 2. Install Python Dependencies (for Liveness Detection)

```bash
cd ID_verification/backend/liveness
pip install -r requirements.txt
cd ../../..
```

> On some systems, use `pip3` instead of `pip`. If you use a virtual environment:
> ```bash
> python -m venv venv
> venv\Scripts\activate        # Windows
> # source venv/bin/activate   # macOS/Linux
> pip install -r requirements.txt
> ```

### 3. Configure MetaMask

Add the local Hardhat network to MetaMask:

| Field | Value |
|-------|-------|
| Network Name | Hardhat Localhost |
| RPC URL | `http://localhost:8545` |
| Chain ID | `1337` |
| Currency Symbol | ETH |

Import a Hardhat test account using one of the private keys printed when the Hardhat node starts.

---

## Running the System

You need **3 terminals** (or 2 if you use the combined start command).

### Option A: Quick Start (2 terminals)

**Terminal 1** — Start Hardhat node + Express server together:

```bash
cd decentralized-voting
npm start
```

This launches:
- Hardhat Node on `http://localhost:8545` (blockchain)
- Express Server on `http://localhost:3001` (both frontends + API)

**Terminal 2** — Deploy both smart contracts:

```bash
cd decentralized-voting
npm run deploy
```

This deploys `Voting.sol` and `EnhancedIdentity.sol`, creates sample proposals, and auto-generates all contract address/ABI files for both frontends.

**Terminal 3 (optional)** — Start the liveness detection microservice:

```bash

python app.py
```

The liveness service starts on `http://localhost:5001`.

### Option B: Start Everything Separately (3+ terminals)

**Terminal 1** — Hardhat blockchain node:
```bash
cd decentralized-voting
npm run node
```

**Terminal 2** — Express backend server:
```bash
cd decentralized-voting
npm run server
```

**Terminal 3** — Deploy contracts:
```bash
cd decentralized-voting
npm run deploy
```

**Terminal 4** — Liveness microservice:
```bash
cd decentralized-voting/ID_verification/backend/liveness
python app.py
```

### Open in Browser

| Page | URL | Purpose |
|------|-----|---------|
| Voting Portal | [http://localhost:3001](http://localhost:3001) | Create proposals, vote, view results |
| ID Verification | [http://localhost:3001/verify](http://localhost:3001/verify) | 5-step identity verification |

---

## All Available Commands

All commands run from the `decentralized-voting/` project root directory:

| Command | Description |
|---------|------------|
| `npm start` | Start Hardhat node + Express server together |
| `npm run dev` | Same as `npm start` (alias) |
| `npm run node` | Start only the Hardhat blockchain node |
| `npm run server` | Start only the Express backend server |
| `npm run compile` | Compile Solidity smart contracts |
| `npm run deploy` | Deploy contracts to local Hardhat network |
| `npm run deploy:sepolia` | Deploy contracts to Sepolia testnet |
| `npm test` | Run all smart contract tests |

Liveness microservice (run from `ID_verification/backend/liveness/`):

| Command | Description |
|---------|------------|
| `python app.py` | Start the liveness detection Flask server on port 5001 |

---

## Step-by-Step Usage

### For Voters (Identity Verification Flow)

1. **Open** [http://localhost:3001/verify](http://localhost:3001/verify)

2. **Step 0 — Connect Wallet**: Click "Connect MetaMask" and approve the connection. The system checks if you're already verified on-chain.

3. **Step 1 — Enter Details**: Fill in your ID type (Aadhaar, PAN, Voter ID, etc.), ID number, full name, and date of birth exactly as they appear on your document.

4. **Step 2 — Upload ID Document**: Upload a clear photo of your government-issued ID. The system:
   - Preprocesses the image (7 enhancement variants via sharp)
   - Runs OCR text extraction (Tesseract.js)
   - Scans for QR/barcodes (jsQR)
   - Cross-verifies extracted text against your entered details
   - Generates a SHA-256 hash of the verified data

   If all 4 fields match, Steps 3-5 become available.

5. **Step 3 — Face Verification**: Click "Start Face Capture." The system:
   - Loads face-api.js models (tinyFaceDetector, faceLandmark68Net, faceRecognitionNet)
   - Starts your camera and captures frames over ~6 seconds
   - Extracts a 128-dimensional face descriptor from the live video (best frame selected by confidence)
   - **Extracts a face descriptor from your uploaded ID card photo**
   - **Compares both descriptors using Euclidean distance** (threshold < 0.6 = match)
   - Displays a Face Match / Face Mismatch banner with similarity %
   - Hashes the live descriptor with SHA-256 (raw descriptor never leaves your browser)
   - Sends captured frames to the liveness microservice for blink, head pose, and texture analysis
   - **If faces do NOT match, Step 4 (Device Registration) is blocked — the user must retry**

6. **Step 4 — Register Device** *(only available after face match)*: Click "Register This Device." Your browser prompts for biometric/PIN confirmation (Windows Hello, Touch ID, etc.) via WebAuthn. A device-bound cryptographic key pair is created. Only the credential ID and public key hash are sent to the backend.

7. **Step 5 — Complete Verification**: Click "Complete & Register on Blockchain." The system:
   - Sends all factor data to `/api/verify-identity-complete` for backend validation
   - Backend combines hashes into a single `combinedHash`
   - Registers your basic identity on the `Voting` contract
   - Registers your multi-factor identity on the `EnhancedIdentity` contract
   - Both transactions require MetaMask confirmation

8. **Vote**: Go to [http://localhost:3001](http://localhost:3001), connect the same wallet, and wait for a proposal creator to authorize you. Once authorized, cast your vote.

### For Admins / Proposal Creators

1. Connect with the **contract owner wallet** (first Hardhat account, Account #0)
2. Create proposals and add voting options
3. Start voting on a proposal (set duration in minutes)
4. View the **Verified Voters** section to see all registered identities
5. Click **Authorize** next to a voter to allow them to vote on a specific proposal

---

## API Endpoints

### Express Backend (port 3001)

| Method | Endpoint | Description |
|--------|---------|------------|
| `GET` | `/api/health` | Health check (includes liveness service status) |
| `POST` | `/api/extract-ssn` | Upload ID image for OCR extraction + cross-verification |
| `GET` | `/api/session/:id` | Retrieve session data by ID |
| `POST` | `/api/webauthn/register` | Register a WebAuthn device credential |
| `POST` | `/api/webauthn/verify` | Verify a stored device credential |
| `POST` | `/api/liveness/detect` | Proxy: forwards frames to liveness microservice |
| `GET` | `/api/liveness/health` | Proxy: check liveness microservice status |
| `POST` | `/api/verify-identity-complete` | Combine all verification factors |
| `GET` | `/api/combined-verification/:sessionId` | Get combined verification result |

### Liveness Microservice (port 5001)

| Method | Endpoint | Description |
|--------|---------|------------|
| `POST` | `/detect-liveness` | Analyze frames for liveness (blinks, head pose, texture) |
| `POST` | `/verify-token` | Verify an HMAC-signed liveness token |
| `GET` | `/health` | Microservice health check |

---

## Smart Contracts

### Voting.sol

The core voting contract with per-proposal authorization and identity verification.

**Key functions:**
- `registerVerifiedVoter(idHash, name, idType)` — Register verified identity (called by voter)
- `addProposal(name, description, ipfsHash)` — Create a new proposal (owner)
- `authorizeVoter(voter, proposalId)` — Authorize a verified voter for a proposal (owner)
- `startVoting(proposalId, durationInMinutes)` — Start voting period (owner)
- `vote(proposalId, optionId)` — Cast a vote (authorized voter)
- `isVoterVerified(voter)` — Check if voter has verified identity

### EnhancedIdentity.sol

Multi-factor identity storage. Stores only cryptographic hashes on-chain.

**Key functions:**
- `registerIdentity(ssnHash, deviceIdHash, faceHash, combinedHash, factorsVerified)` — Self-register identity
- `registerIdentityFor(user, ...)` — Register on behalf of user (owner-only)
- `revokeIdentity(user)` — Revoke identity (owner-only)
- `deactivateMyIdentity()` — User voluntarily deactivates their identity
- `isVerified(user)` — Check if user has active identity
- `isVerifiedWithFactors(user, minFactors)` — Check verification with minimum factor count
- `verifyCombinedHash(user, hash)` — Verify a combined hash matches stored identity

**Identity struct stored on-chain:**
```
VerifiedIdentity {
    bytes32 ssnHash          // SHA-256 of ID document data
    bytes32 deviceIdHash     // SHA-256 of WebAuthn credential
    bytes32 faceHash         // SHA-256 of face descriptor
    bytes32 combinedHash     // Combined multi-factor proof
    uint256 verifiedAt       // Registration timestamp
    bool    isActive         // Active/revoked status
    uint8   factorsVerified  // Number of factors (1-4)
}
```

---

## Running Tests

### Smart Contract Tests

```bash
cd decentralized-voting
npm test
```

This runs both test suites:
- **Voting.test.js** — Voting contract functionality
- **EnhancedIdentity.test.js** — 27 tests covering:
  - Registration (all factors, single factor, duplicates, edge cases)
  - Event emissions
  - Owner-only operations
  - Revocation and self-deactivation
  - View functions (verification checks, hash validation)
  - Ownership transfer

To run only the EnhancedIdentity tests:

```bash
npx hardhat test test/EnhancedIdentity.test.js
```

### Recompile After Contract Changes

```bash
npx hardhat clean
npx hardhat compile
```

---

## Configuration Reference

### Environment Variables (`ID_verification/backend/.env`)

| Variable | Default | Description |
|----------|---------|------------|
| `PORT` | `3001` | Express server port |
| `NODE_ENV` | `development` | Environment mode |
| `MAX_FILE_SIZE` | `10485760` | Max upload size in bytes (10 MB) |
| `ALLOWED_ORIGINS` | `http://localhost:3001,...` | CORS allowed origins |
| `LIVENESS_SERVICE_URL` | `http://localhost:5001` | URL of the Python liveness microservice |

### Liveness Microservice Tuning (`app.py` constants)

| Constant | Default | Description |
|----------|---------|------------|
| `EAR_THRESHOLD` | `0.21` | Eye Aspect Ratio threshold for blink detection |
| `LAPLACIAN_THRESHOLD` | `50.0` | Minimum Laplacian variance (detects printed photos) |
| `MIN_CONFIDENCE` | `0.6` | Minimum liveness confidence score to pass |
| `LIVENESS_TOKEN_EXPIRY` | `300` | Token validity in seconds (5 minutes) |

### Hardhat Network

| Setting | Value |
|---------|-------|
| Solidity Version | 0.8.28 |
| Chain ID | 1337 |
| RPC URL | `http://127.0.0.1:8545` |
| Optimizer | Enabled (200 runs) |

---

## Deploying to Sepolia Testnet

1. Set your private key:

```bash
cd decentralized-voting
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

2. Deploy:

```bash
npm run deploy:sepolia
```

> **Note:** The liveness microservice and Express backend still run locally. Only the smart contracts are deployed to Sepolia.

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| **"WebAuthn is not supported"** | Use HTTPS or `localhost`. WebAuthn requires a secure context. |
| **"Liveness Service Unavailable"** | Start the Python microservice: `cd ID_verification/backend/liveness && python app.py` |
| **Face models fail to load** | face-api.js models load from CDN. Check internet connection. |
| **MetaMask shows wrong chain** | Switch to Hardhat network (Chain ID 1337, RPC `http://localhost:8545`) |
| **"Contract config not found"** | Run `npm run deploy` to compile and deploy contracts |
| **"This ID is already registered"** | Each ID document can only register with one wallet address |
| **Liveness check fails** | Ensure good lighting, face the camera, blink naturally, move head slightly |
| **Python import errors** | Install dependencies: `pip install -r requirements.txt` |
| **"nonce too high" error in MetaMask** | Reset MetaMask account: Settings → Advanced → Clear activity tab data |
| **Transaction fails after restarting Hardhat** | Redeploy contracts (`npm run deploy`) and reset MetaMask nonce |

---

## Privacy & Security

- **No raw biometrics stored**: Only SHA-256 hashes of face descriptors and device credentials are transmitted or stored
- **Face matching enforced**: The live camera face is compared against the ID card photo using Euclidean distance on 128-d descriptors (threshold < 0.6). Device registration and blockchain registration are blocked unless the face match succeeds
- **Face processing in-browser**: face-api.js runs entirely in the browser. The 128-d descriptor is hashed before any network call
- **Device-bound keys**: WebAuthn private keys never leave the authenticator hardware
- **Liveness tokens are HMAC-signed**: Prevents replay attacks; tokens expire after 5 minutes
- **On-chain data is hash-only**: The `EnhancedIdentity` contract stores `bytes32` hashes, not human-readable data
- **Duplicate prevention**: Each SSN hash and combined hash can only be used once across all wallets
- **Rate limiting**: API endpoints are rate-limited (10 requests/min per IP) to prevent abuse
- **All verification factors are open-source**: No proprietary or cloud-dependent APIs

