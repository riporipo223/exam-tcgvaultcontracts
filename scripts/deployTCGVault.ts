import hre from "hardhat";
import { formatEther, zeroAddress, getContractAddress } from "viem";

/**
 * Deployment script for TCG Vault Token contracts
 * 
 * Usage:
 *   yarn hardhat run scripts/deployTCGVault.ts --network <network>
 * 
 * Environment variables needed:
 *   - PANCAKE_ROUTER: PancakeSwap router address
 *   - VAULT_ADDRESS: Vault address for fee collection
 *   - MARKETING_ADDRESS: Marketing address
 *   - COMMUNITY_ADDRESS: Community rewards address
 *   - STABLECOIN_ADDRESS: Stablecoin address (USDT/USDC)
 */

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  console.log("Deploying contracts with account:", deployer.account.address);
  console.log("Account balance:", formatEther(await publicClient.getBalance({ address: deployer.account.address })));

  // Get addresses from environment or use defaults
  const pancakeRouter = (process.env.PANCAKE_ROUTER || "0x10ED43C718714eb63d5aA57B78B54704E256024E") as `0x${string}`; // BSC Mainnet
  const vaultAddress = (process.env.VAULT_ADDRESS || deployer.account.address) as `0x${string}`; // Replace with actual vault
  const marketingAddress = (process.env.MARKETING_ADDRESS || deployer.account.address) as `0x${string}`; // Replace with actual marketing
  const communityAddress = (process.env.COMMUNITY_ADDRESS || deployer.account.address) as `0x${string}`; // Replace with actual community
  const stablecoin = (process.env.STABLECOIN_ADDRESS || "0x55d398326f99059fF775485246999027B3197955") as `0x${string}`; // USDT BSC

  // Deploy TCGVaultToken first (nexusToken set to zero until Nexus is deployed)
  console.log("\n1. Deploying TCGVaultToken...");
  let nonce = await publicClient.getTransactionCount({ address: deployer.account.address });
  const tokenHash = await hre.viem.deployContract("TCGVaultToken", [
    pancakeRouter,
    vaultAddress,
    marketingAddress,
    communityAddress,
    zeroAddress, // nexusToken set later via setAddresses
    stablecoin
  ], { account: deployer.account });
  const tokenAddress = getContractAddress({ from: deployer.account.address, nonce: BigInt(nonce++) });
  const token = await hre.viem.getContractAt("TCGVaultToken", tokenAddress);
  console.log("TCGVaultToken deployed to:", tokenAddress);

  // Deploy TCGNexusToken with minter = TCGVaultToken (immutable, no setMinter)
  console.log("\n2. Deploying TCGNexus Token...");
  const nexusToken = await hre.viem.deployContract("TCGNexusToken", [tokenAddress], { account: deployer.account });
  const nexusTokenAddress = getContractAddress({ from: deployer.account.address, nonce: BigInt(nonce++) });
  console.log("TCGNexus Token deployed to:", nexusTokenAddress);

  // Point TCGVaultToken to Nexus for cashback
  console.log("\n3. Setting Nexus token on TCGVaultToken...");
  const setAddrHash = await token.write.setAddresses([
    vaultAddress,
    marketingAddress,
    communityAddress,
    nexusTokenAddress,
    stablecoin
  ], { account: deployer.account });
  await publicClient.waitForTransactionReceipt({ hash: setAddrHash });
  console.log("Nexus token set successfully");

  // Deploy TCGVaultBuyRouter
  console.log("\n4. Deploying TCGVaultBuyRouter...");
  const buyRouterHash = await hre.viem.deployContract("TCGVaultBuyRouter", [
    pancakeRouter,
    tokenAddress,
    vaultAddress,
    marketingAddress,
    communityAddress
  ], { account: deployer.account });
  const buyRouterAddress = getContractAddress({ from: deployer.account.address, nonce: BigInt(nonce++) });
  const buyRouter = await hre.viem.getContractAt("TCGVaultBuyRouter", buyRouterAddress);
  console.log("TCGVaultBuyRouter deployed to:", buyRouterAddress);

  // Set buy router on token
  console.log("\n5. Setting buy router on TCGVaultToken...");
  const setRouterHash = await token.write.setBuyRouter([buyRouterAddress], { account: deployer.account });
  await publicClient.waitForTransactionReceipt({ hash: setRouterHash });
  console.log("Buy router set successfully");

  console.log("\n=== Deployment Summary ===");
  console.log("TCGVaultToken:", tokenAddress);
  console.log("TCGNexus Token:", nexusTokenAddress);
  console.log("TCGVaultBuyRouter:", buyRouterAddress);
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
