import { ethers } from "hardhat";

/**
 * Deployment script for TCG Vault Token contracts
 * 
 * Usage:
 *   npx hardhat run scripts/deployTCGVault.ts --network <network>
 * 
 * Environment variables needed:
 *   - PANCAKE_ROUTER: PancakeSwap router address
 *   - VAULT_ADDRESS: Vault address for fee collection
 *   - MARKETING_ADDRESS: Marketing address
 *   - COMMUNITY_ADDRESS: Community rewards address
 *   - STABLECOIN_ADDRESS: Stablecoin address (USDT/USDC)
 */

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Get addresses from environment or use defaults
  const pancakeRouter = process.env.PANCAKE_ROUTER || "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // BSC Mainnet
  const vaultAddress = process.env.VAULT_ADDRESS || deployer.address; // Replace with actual vault
  const marketingAddress = process.env.MARKETING_ADDRESS || deployer.address; // Replace with actual marketing
  const communityAddress = process.env.COMMUNITY_ADDRESS || deployer.address; // Replace with actual community
  const stablecoin = process.env.STABLECOIN_ADDRESS || "0x55d398326f99059fF775485246999027B3197955"; // USDT BSC

  // Deploy TCGVaultToken first (nexusToken set to zero until Nexus is deployed)
  console.log("\n1. Deploying TCGVaultToken...");
  const TCGVaultToken = await ethers.getContractFactory("TCGVaultToken");
  const token = await TCGVaultToken.deploy(
    pancakeRouter,
    vaultAddress,
    marketingAddress,
    communityAddress,
    ethers.ZeroAddress, // nexusToken set later via setAddresses
    stablecoin
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("TCGVaultToken deployed to:", tokenAddress);

  // Deploy TCGNexusToken with minter = TCGVaultToken (immutable, no setMinter)
  console.log("\n2. Deploying TCGNexus Token...");
  const TCGNEXUS = await ethers.getContractFactory("TCGNexusToken");
  const nexusToken = await TCGNEXUS.deploy(tokenAddress);
  await nexusToken.waitForDeployment();
  const nexusTokenAddress = await nexusToken.getAddress();
  console.log("TCGNexus Token deployed to:", nexusTokenAddress);

  // Point TCGVaultToken to Nexus for cashback
  console.log("\n3. Setting Nexus token on TCGVaultToken...");
  const setAddrTx = await token.setAddresses(
    vaultAddress,
    marketingAddress,
    communityAddress,
    nexusTokenAddress,
    stablecoin
  );
  await setAddrTx.wait();
  console.log("Nexus token set successfully");

  console.log("\n=== Deployment Summary ===");
  console.log("TCGVaultToken:", tokenAddress);
  console.log("TCGNexus Token:", nexusTokenAddress);
  console.log("PancakeSwap Router:", pancakeRouter);
  console.log("Vault Address:", vaultAddress);
  console.log("Marketing Address:", marketingAddress);
  console.log("Community Address:", communityAddress);
  console.log("Stablecoin:", stablecoin);
  
  console.log("\n=== Next Steps ===");
  console.log("1. Add liquidity to PancakeSwap");
  console.log("2. Call token.setPair(pairAddress) to register the pair");
  console.log("3. Verify all addresses are correct");
  console.log("4. Test buy/sell transactions");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
