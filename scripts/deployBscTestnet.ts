/**
 * BSC Testnet (chainId 97) — full TCG Vault stack with PancakeSwap V2 testnet.
 *
 * Core addresses (official Pancake docs):
 *   Factory: 0x6725F303b657a9451d8BA641348b6761A6CC7a17
 *   Router:  0xD99D1c33F9fC3444f8101754aBC46c52416550D1
 *
 * Stablecoin:
 *   There is no widely canonical Circle USDC on BSC testnet. By default this script deploys
 *   `MockUSDC` (6 decimals, open `mint` — testnet only). To use another token, set USDC_ADDRESS.
 *
 * Prerequisites (Hardhat 3 keystore / env per hardhat.config.ts):
 *   - Network `bsctest` with BSCTEST_RPC_URL and TCG_KEY configured.
 *
 * Optional env:
 *   - VAULT_ADDRESS, MARKETING_ADDRESS, COMMUNITY_ADDRESS — required fee recipients
 *   - TREASURY_ADDRESS — Founder NFT + InitialLaunch USDC treasury (required)
 *   - LIQUIDITY_RECIPIENT, TEAM_RECIPIENT, OPS_RECIPIENT — required post-presale split recipients
 *   - USDC_ADDRESS — skip MockUSDC deploy and use this 6-decimal stablecoin
 *   - SKIP_TCGR=1 — do not deploy TCGR + converter
 *   - MOCK_USDC_MINT_DEPLOYER=0 — when deploying MockUSDC, skip minting 1M USDC to deployer
 *
 * Usage:
 *   yarn deploy:bsctest
 */

import hre from "hardhat";
import { formatEther, getContractAddress, parseEther, type Address } from "viem";
import { execSync } from "node:child_process";

const CHAIN_ID_BSC_TESTNET = 97n;

/** PancakeSwap V2 on BSC testnet (docs). */
const PANCAKE_FACTORY_TESTNET = "0x6725F303b657a9451d8BA641348b6761A6CC7a17" as Address;
const PANCAKE_ROUTER_TESTNET = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1" as Address;

const USDC_6 = 1_000_000n;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type VerifyJob = {
  address: Address;
  constructorArguments: readonly unknown[];
  contract?: string;
};

async function verifyOne(
  address: Address,
  constructorArguments: readonly unknown[],
  contract?: string,
): Promise<void> {
  try {
    const network = process.env.HARDHAT_NETWORK ?? "bsctest";
    const args = constructorArguments.map((v) => String(v));
    const cmd = [
      "yarn hardhat verify etherscan",
      `--network ${network}`,
      ...(contract ? [`--contract "${contract}"`] : []),
      address,
      ...args,
    ].join(" ");
    execSync(cmd, { stdio: "pipe" });
    console.log(`Verified on BscScan: ${address}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("already verified")) {
      console.log(`Already verified: ${address}`);
      return;
    }
    console.warn(`Verification failed for ${address}: ${msg}`);
  }
}

async function runQueuedVerifications(jobs: VerifyJob[]): Promise<void> {
  if (jobs.length === 0) return;
  const waitSeconds = Number(process.env.VERIFY_WAIT_SECONDS ?? "30");
  if (waitSeconds > 0) {
    console.log(`\nWaiting ${waitSeconds}s before verification batch...`);
    await sleep(waitSeconds * 1000);
  }
  console.log(`Starting verification for ${jobs.length} contracts...`);
  for (const job of jobs) {
    await verifyOne(job.address, job.constructorArguments, job.contract);
  }
}

function readRequiredAddress(name: string): Address | undefined {
  const v = process.env[name]?.trim();
  if (!v) return undefined;
  return v as Address;
}

async function main() {
  const { viem } = await hre.network.connect();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const deployerAddr = deployer.account.address as Address;
  const vaultAddr = readRequiredAddress("VAULT_ADDRESS");
  const marketingAddr = readRequiredAddress("MARKETING_ADDRESS");
  const communityAddr = readRequiredAddress("COMMUNITY_ADDRESS");
  const treasuryAddr = readRequiredAddress("TREASURY_ADDRESS");
  const liquidityRecipient = readRequiredAddress("LIQUIDITY_RECIPIENT");
  const teamRecipient = readRequiredAddress("TEAM_RECIPIENT");
  const opsRecipient = readRequiredAddress("OPS_RECIPIENT");

  if (
    !vaultAddr ||
    !marketingAddr ||
    !communityAddr ||
    !treasuryAddr ||
    !liquidityRecipient ||
    !teamRecipient ||
    !opsRecipient
  ) {
    console.error(
      "Missing one or more required address env vars: VAULT_ADDRESS, MARKETING_ADDRESS, COMMUNITY_ADDRESS, TREASURY_ADDRESS, LIQUIDITY_RECIPIENT, TEAM_RECIPIENT, OPS_RECIPIENT. Refusing to deploy.",
    );
    return;
  }

  console.log("=".repeat(72));
  console.log("BSC Testnet deploy — chainId 97");
  console.log("=".repeat(72));
  console.log("Deployer:     ", deployerAddr);
  console.log("Native bal:   ", formatEther(await publicClient.getBalance({ address: deployerAddr })));
  console.log("Vault (fees): ", vaultAddr);
  console.log("Marketing:    ", marketingAddr);
  console.log("Community:    ", communityAddr);
  console.log("Treasury:     ", treasuryAddr, "(Founder NFT + InitialLaunch USDC sink)");
  console.log("Pancake factory (ref):", PANCAKE_FACTORY_TESTNET);
  console.log("Pancake router:       ", PANCAKE_ROUTER_TESTNET);
  console.log();
  const verifyJobs: VerifyJob[] = [];

  let usdcAddress = process.env.USDC_ADDRESS?.trim() as Address | undefined;
  if (usdcAddress) {
    console.log("Using USDC_ADDRESS:", usdcAddress);
  } else {
    console.log("Deploying MockUSDC (6 decimals, testnet — open mint)…");
    const mock = await viem.deployContract("contracts/test/MockUSDC.sol:MockUSDC", [], {
      client: { wallet: deployer },
    });
    usdcAddress = mock.address as Address;
    console.log("MockUSDC:", usdcAddress);
    if (process.env.MOCK_USDC_MINT_DEPLOYER !== "0") {
      const m = await viem.getContractAt("contracts/test/MockUSDC.sol:MockUSDC", usdcAddress);
      const mintAmt = 1_000_000n * USDC_6;
      const h = await m.write.mint([deployerAddr, mintAmt], { account: deployer.account });
      await publicClient.waitForTransactionReceipt({ hash: h });
      console.log(`Minted ${Number(mintAmt) / 1e6} USDC to deployer for tests.`);
    }
    verifyJobs.push({
      address: usdcAddress,
      constructorArguments: [],
      contract: "contracts/test/MockUSDC.sol:MockUSDC",
    });
  }
  console.log();

  let nonce = BigInt(
    await publicClient.getTransactionCount({ address: deployerAddr, blockTag: "pending" }),
  );

  const nexusTokenAddress = getContractAddress({ from: deployerAddr, nonce }) as Address;
  const tokenAddress = getContractAddress({ from: deployerAddr, nonce: nonce + 1n }) as Address;
  const founderNFTAddress = getContractAddress({ from: deployerAddr, nonce: nonce + 2n }) as Address;
  const initialLaunchAddress = getContractAddress({ from: deployerAddr, nonce: nonce + 3n }) as Address;

  console.log("--- Core (CREATE2-style nonce prediction) ---");

  await viem.deployContract("contracts/TCGNexusToken.sol:TCGNexusToken", [tokenAddress], {
    client: { wallet: deployer },
  });
  nonce += 1n;
  console.log("TCGNexusToken:", nexusTokenAddress);
  verifyJobs.push({
    address: nexusTokenAddress,
    constructorArguments: [tokenAddress],
    contract: "contracts/TCGNexusToken.sol:TCGNexusToken",
  });

  await viem.deployContract("TCGVaultToken", [
    PANCAKE_ROUTER_TESTNET,
    vaultAddr,
    marketingAddr,
    communityAddr,
    nexusTokenAddress,
    initialLaunchAddress,
  ], { client: { wallet: deployer } });
  nonce += 1n;
  console.log("TCGVaultToken:", tokenAddress);
  verifyJobs.push({
    address: tokenAddress,
    constructorArguments: [
      PANCAKE_ROUTER_TESTNET,
      vaultAddr,
      marketingAddr,
      communityAddr,
      nexusTokenAddress,
      initialLaunchAddress,
    ],
    contract: "contracts/TCGVaultToken.sol:TCGVaultToken",
  });

  await viem.deployContract("TCGVaultFounderNFT", [usdcAddress, nexusTokenAddress, treasuryAddr], {
    client: { wallet: deployer },
  });
  nonce += 1n;
  console.log("TCGVaultFounderNFT:", founderNFTAddress);
  verifyJobs.push({
    address: founderNFTAddress,
    constructorArguments: [usdcAddress, nexusTokenAddress, treasuryAddr],
    contract: "contracts/TCGVaultFounderNFT.sol:TCGVaultFounderNFT",
  });

  await viem.deployContract("TCGVaultInitialLaunch", [
    tokenAddress,
    usdcAddress,
    founderNFTAddress,
    nexusTokenAddress,
    treasuryAddr,
  ], { client: { wallet: deployer } });
  nonce += 1n;
  console.log("TCGVaultInitialLaunch:", initialLaunchAddress);
  verifyJobs.push({
    address: initialLaunchAddress,
    constructorArguments: [
      tokenAddress,
      usdcAddress,
      founderNFTAddress,
      nexusTokenAddress,
      treasuryAddr,
    ],
    contract: "contracts/TCGVaultInitialLaunch.sol:TCGVaultInitialLaunch",
  });

  const nexusToken = await viem.getContractAt("TCGNexusToken", nexusTokenAddress);
  const token = await viem.getContractAt("TCGVaultToken", tokenAddress);

  console.log("--- Allocation recipients (pre-presale finalize) ---");
  console.log("Liquidity recipient:", liquidityRecipient);
  console.log("Team recipient:     ", teamRecipient);
  console.log("Ops recipient:      ", opsRecipient);

  const setAllocHash = await token.write.setAllocationRecipients(
    [liquidityRecipient, teamRecipient, opsRecipient],
    { account: deployer.account },
  );
  await publicClient.waitForTransactionReceipt({ hash: setAllocHash });
  console.log("token.setAllocationRecipients ✓");

  let h = await nexusToken.write.setPresaleMinter([founderNFTAddress, true], { account: deployer.account });
  await publicClient.waitForTransactionReceipt({ hash: h });
  h = await nexusToken.write.setPresaleMinter([initialLaunchAddress, true], { account: deployer.account });
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log("Nexus presale minters: FounderNFT + InitialLaunch");
  console.log();

  console.log("--- BuyRouter + Liquidity wrapper ---");
  const buyRouter = await viem.deployContract("TCGVaultBuyRouter", [
    PANCAKE_ROUTER_TESTNET,
    usdcAddress,
    tokenAddress,
    vaultAddr,
    marketingAddr,
    communityAddr,
  ], { client: { wallet: deployer } });
  const buyRouterAddress = buyRouter.address as Address;
  console.log("TCGVaultBuyRouter:", buyRouterAddress);
  verifyJobs.push({
    address: buyRouterAddress,
    constructorArguments: [
      PANCAKE_ROUTER_TESTNET,
      usdcAddress,
      tokenAddress,
      vaultAddr,
      marketingAddr,
      communityAddr,
    ],
    contract: "contracts/TCGVaultBuyRouter.sol:TCGVaultBuyRouter",
  });

  h = await token.write.setBuyRouter([buyRouterAddress], { account: deployer.account });
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log("token.setBuyRouter ✓");

  const wrapper = await viem.deployContract(
    "contracts/TCGVaultLiquidityWrapper.sol:TCGVaultLiquidityWrapper",
    [tokenAddress, PANCAKE_ROUTER_TESTNET],
    { client: { wallet: deployer } },
  );
  const wrapperAddress = wrapper.address as Address;
  nonce += 1n;
  console.log("TCGVaultLiquidityWrapper:", wrapperAddress);
  verifyJobs.push({
    address: wrapperAddress,
    constructorArguments: [tokenAddress, PANCAKE_ROUTER_TESTNET],
    contract: "contracts/TCGVaultLiquidityWrapper.sol:TCGVaultLiquidityWrapper",
  });

  h = await token.write.setExcludedFromFees([wrapperAddress, true], { account: deployer.account });
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log("token.setExcludedFromFees(wrapper) ✓");
  console.log();

  let tcgrAddress: Address | undefined;
  let converterAddress: Address | undefined;
  if (process.env.SKIP_TCGR !== "1") {
    console.log("--- TCGR + converter (1:1) ---");
    const tcgr = await viem.deployContract("TCGRToken", [buyRouterAddress], { client: { wallet: deployer } });
    tcgrAddress = tcgr.address as Address;
    nonce += 1n;
    verifyJobs.push({
      address: tcgrAddress,
      constructorArguments: [buyRouterAddress],
      contract: "contracts/TCGRToken.sol:TCGRToken",
    });
    const buyRouter = await viem.getContractAt("TCGVaultBuyRouter", buyRouterAddress);
    h = await buyRouter.write.setReferralToken([tcgrAddress], { account: deployer.account });
    await publicClient.waitForTransactionReceipt({ hash: h });

    const converter = await viem.deployContract("TCGRToTCGVConverter", [
      tcgrAddress,
      tokenAddress,
      parseEther("1"),
    ], { client: { wallet: deployer } });
    converterAddress = converter.address as Address;
    nonce += 1n;
    verifyJobs.push({
      address: converterAddress,
      constructorArguments: [tcgrAddress, tokenAddress, parseEther("1")],
      contract: "contracts/TCGRToTCGVConverter.sol:TCGRToTCGVConverter",
    });
    const tcgrC = await viem.getContractAt("TCGRToken", tcgrAddress);
    h = await tcgrC.write.setConverter([converterAddress], { account: deployer.account });
    await publicClient.waitForTransactionReceipt({ hash: h });
    console.log("TCGRToken:", tcgrAddress);
    console.log("TCGRToTCGVConverter:", converterAddress, "(fund converter with TCGV before convert)");
    console.log();
  }

  const out = {
    chainId: Number(CHAIN_ID_BSC_TESTNET),
    pancakeFactory: PANCAKE_FACTORY_TESTNET,
    pancakeRouter: PANCAKE_ROUTER_TESTNET,
    usdc: usdcAddress,
    usdcIsMock: !process.env.USDC_ADDRESS?.trim(),
    tcgv: tokenAddress,
    nexus: nexusTokenAddress,
    founderNFT: founderNFTAddress,
    initialLaunch: initialLaunchAddress,
    buyRouter: buyRouterAddress,
    liquidityWrapper: wrapperAddress,
    vault: vaultAddr,
    marketing: marketingAddr,
    community: communityAddr,
    treasury: treasuryAddr,
    tcgr: tcgrAddress ?? null,
    tcgrConverter: converterAddress ?? null,
  };

  console.log("=".repeat(72));
  console.log("Deployment JSON (save for frontend / ops)");
  console.log("=".repeat(72));
  console.log(JSON.stringify(out, null, 2));
  console.log();
  await runQueuedVerifications(verifyJobs);
  console.log();
  console.log("Next steps:");
  console.log("  1. Run presale (Founder NFT + InitialLaunch.buy).");
  console.log("  2. After countdown, initialLaunch.finalize() → token supply recompute + 10% NEXUS mode.");
  console.log("  3. Create TCGV/USDC pair on Pancake testnet (factory above) or router; token.setPair(pair, true).");
  console.log("  4. Add liquidity via LiquidityWrapper (approve TCGV + USDC, addLiquidity).");
  console.log("  5. Optional: token.setMinAmounts(minBuy, minSell) for small pools.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
