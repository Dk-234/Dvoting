import hre from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const { ethers } = hre;

// Get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log("🚀 Starting deployment...\n");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📱 Deploying contracts with account:", deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Deploy the contract
  console.log("📝 Deploying Voting contract...");
  const Voting = await ethers.getContractFactory("Voting");
  
  // Set voting to last 60 minutes (1 hour)
  const votingDuration = 60; // minutes
  const voting = await Voting.deploy("Community Election 2024", votingDuration);
  
  await voting.waitForDeployment();
  const contractAddress = await voting.getAddress();
  
  console.log("✅ Voting contract deployed to:", contractAddress);
  console.log("📋 Voting title:", await voting.votingTitle());
  console.log("⏱️ Voting duration:", votingDuration, "minutes\n");

  // Create frontend directory if it doesn't exist
  const frontendDir = join(__dirname, "../frontend");
  if (!existsSync(frontendDir)) {
    mkdirSync(frontendDir, { recursive: true });
    console.log("📁 Created frontend directory");
  }

  // Save contract address
  const addressFile = join(frontendDir, "contractAddress.js");
  writeFileSync(
    addressFile,
    `export const contractAddress = "${contractAddress}";\n`
  );
  console.log("📍 Contract address saved to:", addressFile);

  // Get and save the ABI
  const contractArtifact = await ethers.getContractFactory("Voting");
  const abi = contractArtifact.interface.formatJson();
  
  const abiFile = join(frontendDir, "contractABI.js");
  writeFileSync(
    abiFile,
    `export const contractABI = ${abi};\n`
  );
  console.log("📄 Contract ABI saved to:", abiFile);

  // Create a simple configuration file
  const configFile = join(frontendDir, "config.js");
  writeFileSync(
    configFile,
    `export const config = {
  contractAddress: "${contractAddress}",
  network: {
    name: "localhost",
    chainId: 1337
  },
  votingTitle: "Community Election 2024",
  votingDuration: ${votingDuration}
};\n`
  );
  console.log("⚙️ Configuration saved to:", configFile);

  console.log("\n🎉 Deployment completed successfully!");
  console.log("\nNext steps:");
  console.log("1. Run: npx hardhat node (in a new terminal)");
  console.log("2. Run: npx hardhat run scripts/deploy.js --network localhost");
  console.log("3. Open the frontend/index.html in your browser");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });