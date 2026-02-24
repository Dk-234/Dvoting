# Decentralized Voting System with Identity Verification

A blockchain-based voting platform with integrated ID verification using OCR. Voters must verify their identity before participating in proposals. Built with Solidity, Hardhat, Express, and Tesseract.js.

## Project Overview

- **Smart Contract** (`contracts/Voting.sol`) — On-chain voting with per-proposal authorization, identity verification, and duplicate prevention
- **Voting Frontend** (`frontend/`) — Create proposals, authorize voters, cast votes, view results
- **ID Verification Frontend** (`ID_verification/frontend/`) — Upload government ID, OCR extraction, blockchain identity registration
- **ID Verification Backend** (`ID_verification/backend/`) — Express server with OCR (Tesseract.js), QR reader, and image preprocessing

## Project Structure

```
decentralized-voting/
├── contracts/              # Solidity smart contracts
│   └── Voting.sol          # Main voting + identity verification contract
├── frontend/               # Voting portal UI
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── config.js
│   ├── contractABI.js      # Auto-generated after deploy
│   └── contractAddress.js  # Auto-generated after deploy
├── ID_verification/
│   ├── backend/
│   │   └── server.js       # Express API server (serves both frontends)
│   └── frontend/           # ID verification UI
│       ├── index.html
│       ├── app.js
│       ├── style.css
│       ├── contractABI.js      # Auto-generated after deploy
│       └── contractAddress.js  # Auto-generated after deploy
├── scripts/
│   └── deploy.js           # Deployment script
├── test/
│   └── Voting.test.js      # Contract tests
├── hardhat.config.js
└── package.json
```

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [MetaMask](https://metamask.io/) browser extension
- npm (comes with Node.js)

## Setup

### 1. Install Dependencies

> **Directory:** `decentralized-voting/` (project root)

```shell
cd decentralized-voting
npm install
```

Then install the ID verification backend dependencies:

> **Directory:** `decentralized-voting/ID_verification/backend/`

```shell
cd ID_verification/backend
npm install
cd ../..
```

### 2. Configure MetaMask

Add the local Hardhat network to MetaMask:

| Field        | Value                    |
|--------------|--------------------------|
| Network Name | Hardhat Localhost        |
| RPC URL      | http://localhost:8545    |
| Chain ID     | 1337                    |
| Currency     | ETH                     |

Import a Hardhat test account using one of the private keys printed when you start the Hardhat node.

---

## Quick Start (One Command)

> **Directory:** `decentralized-voting/` (project root)

**Terminal 1** — Start both the Hardhat blockchain node and the web server together:

```shell
cd decentralized-voting
npm start
```

This launches:
- **Hardhat Node** on `http://localhost:8545` (blockchain)
- **Web Server** on `http://localhost:3001` (both frontends + API)

**Terminal 2** — In a **separate terminal**, deploy the smart contract:

> **Directory:** `decentralized-voting/` (project root)

```shell
cd decentralized-voting
npm run deploy
```

Open your browser:
- **Voting Portal** → [http://localhost:3001](http://localhost:3001)
- **ID Verification** → [http://localhost:3001/verify](http://localhost:3001/verify)

---

## All Available Commands

> All commands below must be run from: `decentralized-voting/` (project root)

| Command                  | Directory              | Description                                              |
|--------------------------|------------------------|----------------------------------------------------------|
| `npm start`              | `decentralized-voting/` | Start Hardhat node + web server together                |
| `npm run dev`            | `decentralized-voting/` | Same as `npm start` (alias)                             |
| `npm run node`           | `decentralized-voting/` | Start only the Hardhat blockchain node                  |
| `npm run server`         | `decentralized-voting/` | Start only the Express web server                       |
| `npm run compile`        | `decentralized-voting/` | Compile the Solidity smart contracts                    |
| `npm run deploy`         | `decentralized-voting/` | Deploy contracts to the local Hardhat network           |
| `npm run deploy:sepolia` | `decentralized-voting/` | Deploy contracts to Sepolia testnet                     |
| `npm test`               | `decentralized-voting/` | Run smart contract tests                                |

---

## Step-by-Step Usage

### Step 1: Start the System

> **Directory:** `decentralized-voting/` (project root)  
> **Terminal:** Terminal 1

```shell
cd decentralized-voting
npm start
```

### Step 2: Deploy the Contract

> **Directory:** `decentralized-voting/` (project root)  
> **Terminal:** Terminal 2 (open a new/separate terminal)

```shell
cd decentralized-voting
npm run deploy
```

This compiles and deploys the `Voting.sol` contract, creates sample proposals, and auto-generates `contractABI.js` and `contractAddress.js` for both frontends.

### Step 3: Verify Your Identity

1. Open [http://localhost:3001/verify](http://localhost:3001/verify) in your browser
2. Connect your MetaMask wallet
3. Enter your ID details (ID type, number, name, date of birth)
4. Upload a photo of your government-issued ID
5. The system uses OCR to extract and cross-verify your details
6. If verified, click **"Register Identity on Blockchain"** to store a secure hash on-chain

### Step 4: Vote on Proposals

1. Open [http://localhost:3001](http://localhost:3001) in your browser
2. Connect MetaMask (same wallet as Step 3)
3. Your identity status will show as **"Verified"**
4. Wait for a proposal creator to authorize your wallet for a proposal
5. Once authorized and voting is active, cast your vote

### Admin / Proposal Creator Flow

1. Connect with the contract owner wallet (first Hardhat account)
2. Create proposals, add voting options, and start voting
3. Go to **"Verified Voters"** section to see all blockchain-registered voters
4. Click **"Authorize"** next to a voter to allow them to vote on a specific proposal

---

## Deploying to Sepolia Testnet

> **Directory:** `decentralized-voting/` (project root)

1. Set your private key:

```shell
cd decentralized-voting
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

2. Deploy:

```shell
cd decentralized-voting
npm run deploy:sepolia
```

---

## Running Tests

> **Directory:** `decentralized-voting/` (project root)

```shell
cd decentralized-voting
npm test
```

## Tech Stack

| Layer            | Technology                          |
|------------------|-------------------------------------|
| Smart Contract   | Solidity ^0.8.24, Hardhat           |
| Blockchain       | Ethereum (local Hardhat / Sepolia)  |
| Frontend         | Vanilla HTML/CSS/JS, Ethers.js v6   |
| ID Verification  | Tesseract.js (OCR), sharp, jsQR     |
| Backend          | Express.js, Multer                  |
| Charts           | Chart.js                            |
| Wallet           | MetaMask                            |

