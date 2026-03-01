# Decentralized Voting System

### Blockchain-Powered Elections with Multi-Factor Identity Verification

> **No fake voters. No double votes. No trust required.**
> A tamper-proof voting platform where every identity is cryptographically verified before a single vote is cast.

---

## The Problem

Traditional online voting is plagued by identity fraud, vote manipulation, and opaque counting. Centralized systems require voters to *trust* the platform — and that trust is often misplaced.

## Our Solution

A fully **decentralized voting system** on Ethereum where:
- Votes are recorded on an **immutable blockchain** — no one can alter results
- Every voter must pass a **5-step identity verification** pipeline before they can vote
- All verification happens with **zero raw biometric data** leaving the user's device

---

## How Identity Verification Works

This is the core of our system. Before casting a vote, every user must clear **all 5 gates**:

```
  Connect       Enter        Upload &       Face          Device        Register
  MetaMask  →   Details  →   OCR Verify →   Match ID  →   Bind      →  On-Chain
  (Step 0)      (Step 1)     (Step 2)       (Step 3)      (Step 4)     (Step 5)
```

### Step 0-2 : Document Verification
The user enters their ID details and uploads a government-issued document. The system runs **OCR** (Tesseract.js) with 7 image enhancement variants and **cross-verifies** every field — name, ID number, DOB — against the user's input. A SHA-256 hash of the verified data is generated.

### Step 3 : Face Verification *(the critical gate)*
This is where impersonation is stopped:
1. The camera captures a **live selfie** over ~6 seconds
2. A **128-dimensional face descriptor** is extracted from the live video
3. A face descriptor is **also extracted from the uploaded ID card photo**
4. Both are compared using **Euclidean distance** (threshold < 0.6 = match)
5. **Liveness detection** (blink, head pose, texture analysis) confirms it's a real person, not a photo

> **If the live face doesn't match the ID card photo, all subsequent steps are blocked.**
> The user cannot register their device or complete blockchain registration.

### Step 4 : Device Binding
Using the **WebAuthn API**, the user's device creates a cryptographic key pair bound to that specific hardware. This ensures that even if someone steals credentials, they can't verify from a different device.

> *This step only unlocks after face match succeeds.*

### Step 5 : Blockchain Registration
All verification factor hashes are combined and registered on **two smart contracts**:
- **Voting.sol** — basic voter identity for proposal authorization
- **EnhancedIdentity.sol** — multi-factor proof (up to 4 factors stored as `bytes32` hashes)

No human-readable data ever touches the blockchain. Only cryptographic hashes.

---

## Architecture at a Glance

```
 Browser                    Express Backend              Blockchain
┌─────────────┐            ┌──────────────┐            ┌──────────────┐
│  MetaMask   │            │  OCR Engine  │   deploy   │  Voting.sol  │
│  WebAuthn   │───HTTP────▶│  WebAuthn DB │───────────▶│  Enhanced    │
│  face-api.js│  :3001     │  Liveness ──┐│   :8545    │  Identity.sol│
│  ethers.js  │            │             ││            └──────────────┘
└─────────────┘            └─────────────┘│
                                          │  :5001
                              ┌───────────▼──────────┐
                              │  Python Flask         │
                              │  MediaPipe + OpenCV   │
                              │  Blink / Pose / Tex.  │
                              └──────────────────────┘
```

| Service | Port | Role |
|---------|------|------|
| Hardhat Node | 8545 | Local Ethereum blockchain |
| Express Server | 3001 | API + both frontends |
| Liveness Service | 5001 | Blink/head-pose/texture analysis |

---

## Tech Stack

| | Technology |
|---|---|
| **Smart Contracts** | Solidity ^0.8.24, Hardhat |
| **Frontend** | Vanilla JS, ethers.js v6 |
| **OCR** | Tesseract.js, sharp, jsQR |
| **Face Detection** | face-api.js (in-browser) |
| **Liveness** | Python, Flask, OpenCV, MediaPipe |
| **Device Auth** | WebAuthn API |
| **Backend** | Express.js, Multer, Axios |
| **Wallet** | MetaMask |

---

## Quick Start

```bash
# Terminal 1 — Blockchain + Server
cd decentralized-voting
npm install
npm start

# Terminal 2 — Deploy contracts
npm run deploy

# Terminal 3 (optional) — Liveness service
cd ID_verification/backend/liveness
pip install -r requirements.txt
python app.py
```

Then open:
- **Voting Portal** → [http://localhost:3001](http://localhost:3001)
- **ID Verification** → [http://localhost:3001/verify](http://localhost:3001/verify)

---

## Privacy Guarantees

| What | How |
|------|-----|
| Face data | Processed **entirely in-browser**. Only a SHA-256 hash is transmitted |
| Device keys | WebAuthn private keys **never leave** the hardware authenticator |
| On-chain data | Only `bytes32` hashes — no names, no photos, no biometrics |
| Liveness tokens | HMAC-signed, expire in 5 minutes — replay-proof |
| Duplicate prevention | Each ID document + each combined hash can only register once |

---

## Project Structure

```
decentralized-voting/
├── contracts/           # Voting.sol + EnhancedIdentity.sol
├── frontend/            # Voting portal UI
├── ID_verification/
│   ├── backend/
│   │   ├── server.js    # Express API (OCR, WebAuthn, combined verification)
│   │   └── liveness/    # Python microservice (blink, pose, texture)
│   └── frontend/
│       ├── index.html   # 5-step verification UI
│       ├── app.js       # Full orchestration logic
│       └── js/          # face-verification.js, webauthn-device.js
├── scripts/deploy.js    # Deploys both contracts
├── test/                # Solidity test suites
└── hardhat.config.js
```

---

## Available Commands

| Command | What it does |
|---------|-------------|
| `npm start` | Start blockchain node + Express server |
| `npm run deploy` | Deploy contracts to local network |
| `npm test` | Run all smart contract tests |
| `npm run deploy:sepolia` | Deploy to Sepolia testnet |

---

> For detailed API documentation, contract interfaces, configuration tuning, and deployment guides, see [Document.md](decentralized-voting/Document.md).
