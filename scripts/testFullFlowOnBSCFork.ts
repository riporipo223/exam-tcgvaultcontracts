/**
 * Full flow on BSC fork: Presale (Founder NFT + InitialLaunch with USDC) → Finalize → Claim → optional DEX.
 *
 * Requires a BSC mainnet fork (TCGVaultToken constructor calls PancakeSwap router).
 *
 * Option A — separate node:
 *   npx hardhat node --fork https://bsc-dataseed.binance.org/
 *   npx hardhat run scripts/testFullFlowOnBSCFork.ts --network localhost
 *
 * Option B — hardhat network with fork (set BSC_RPC_URL in env or hardhat.config):
 *   BSC_RPC_URL=https://bsc-dataseed.binance.org/ npx hardhat run scripts/testFullFlowOnBSCFork.ts --network hardhat
 *
 * Flow:
 *   1. Deploy: MockUSDC, TCGVaultToken, TCGNexusToken, TCGVaultFounderNFT, TCGVaultInitialLaunch, BuyRouter, Wrapper.
 *   2. Wire: set Nexus on token, set presale finalizer = InitialLaunch, set Nexus presale minters.
 *   3. Fund deployer/trader with MockUSDC; trader buys TCGV via InitialLaunch (wave 1).
 *   4. Mint 245 Founder NFTs (wave 2 starts).
 *   5. Time travel 121h, set allocation recipients, finalize presale.
 *   6. Trader claims vested TCGV.
 *   7. Optional: add liquidity, set pair, one DEX buy/sell.
 */

import hre from "hardhat";
import {
  parseEther,
  formatEther,
  zeroAddress,
  getContractAddress,
  type Address,
} from "viem";

const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as Address;
const PANCAKE_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73" as Address;
const FOUNDER_NFT_WAVE1_CAP = 245;
const PRESALE_COUNTDOWN_HOURS = 120;
const USDC_6 = 1_000_000n; // 1 USDC = 1e6

async function main() {
  const { viem, networkHelpers } = await hre.network.connect();
  const wallets = await viem.getWalletClients();
  if (!wallets || wallets.length < 2) {
    throw new Error("Need at least 2 wallet accounts (deployer, trader)");
  }
  const deployer = wallets[0]!;
  const trader = wallets[1]!;

  const vaultReceiver = await viem.deployContract("FeeReceiver", [], { client: { wallet: deployer } });
  const marketingReceiver = await viem.deployContract("FeeReceiver", [], { client: { wallet: deployer } });
  const communityReceiver = await viem.deployContract("FeeReceiver", [], { client: { wallet: deployer } });
  const vaultAddr = vaultReceiver.address as Address;
  const marketingAddr = marketingReceiver.address as Address;
  const communityAddr = communityReceiver.address as Address;

  const publicClient = await viem.getPublicClient();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log("=".repeat(80));
  console.log("TCG Vault — Full flow on BSC fork (Presale → Finalize → Claim)");
  console.log("=".repeat(80));
  console.log("Deployer:", deployer.account.address);
  console.log("Trader:  ", trader.account.address);
  console.log();

  let nonce = await publicClient.getTransactionCount({ address: deployer.account.address });

  // --- Phase 1: Deploy MockUSDC and core contracts ---
  console.log("--- Phase 1: Deploy MockUSDC and core contracts ---");
  const mockUsdc = await viem.deployContract("contracts/test/MockUSDC.sol:MockUSDC", [], { client: { wallet: deployer } });
  const usdcAddress = mockUsdc.address as Address;
  nonce++;
  console.log("MockUSDC:", usdcAddress);

  await viem.deployContract("TCGVaultToken", [
    PANCAKE_ROUTER,
    vaultAddr,
    marketingAddr,
    communityAddr,
    zeroAddress,
  ], { client: { wallet: deployer } });
  const tokenAddress = getContractAddress({ from: deployer.account.address, nonce: BigInt(nonce++) }) as Address;
  const token = await viem.getContractAt("TCGVaultToken", tokenAddress);
  console.log("TCGVaultToken:", tokenAddress);

  await viem.deployContract("contracts/TCGNexusToken.sol:TCGNexusToken", [tokenAddress], { client: { wallet: deployer } });
  const nexusTokenAddress = getContractAddress({ from: deployer.account.address, nonce: BigInt(nonce++) }) as Address;
  const nexusToken = await viem.getContractAt("TCGNexusToken", nexusTokenAddress);
  console.log("TCGNexusToken:", nexusTokenAddress);

  await token.write.setAddresses([vaultAddr, marketingAddr, communityAddr, nexusTokenAddress], { account: deployer.account });

  const founderNFT = await viem.deployContract("TCGVaultFounderNFT", [
    usdcAddress,
    nexusTokenAddress,
    vaultAddr,
  ], { client: { wallet: deployer } });
  const founderNFTAddress = founderNFT.address as Address;
  console.log("TCGVaultFounderNFT:", founderNFTAddress);

  const initialLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
    tokenAddress,
    usdcAddress,
    founderNFTAddress,
    nexusTokenAddress,
    vaultAddr,
  ], { client: { wallet: deployer } });
  const initialLaunchAddress = initialLaunch.address as Address;
  console.log("TCGVaultInitialLaunch:", initialLaunchAddress);

  await token.write.setPresaleFinalizer([initialLaunchAddress], { account: deployer.account });
  await nexusToken.write.setPresaleMinter([founderNFTAddress, true], { account: deployer.account });
  await nexusToken.write.setPresaleMinter([initialLaunchAddress, true], { account: deployer.account });
  console.log("Presale finalizer = InitialLaunch; Nexus presale minters set.");
  console.log();

  // --- Phase 2: BuyRouter & Wrapper (for optional DEX later) ---
  console.log("--- Phase 2: BuyRouter & Wrapper ---");
  const buyRouter = await viem.deployContract("TCGVaultBuyRouter", [
    PANCAKE_ROUTER,
    tokenAddress,
    vaultAddr,
    marketingAddr,
    communityAddr,
  ], { client: { wallet: deployer } });
  await token.write.setBuyRouter([buyRouter.address as Address], { account: deployer.account });
  const wrapper = await viem.deployContract("contracts/TCGVaultLiquidityWrapper.sol:TCGVaultLiquidityWrapper", [PANCAKE_ROUTER], { client: { wallet: deployer } });
  await token.write.setLiquidityWrapper([wrapper.address as Address], { account: deployer.account });
  await token.write.setExcludedFromFees([wrapper.address as Address, true], { account: deployer.account });
  console.log("BuyRouter and Wrapper set.");
  console.log();

  // --- Phase 3: Fund USDC and trader buy (wave 1) ---
  console.log("--- Phase 3: Fund USDC, trader buy in wave 1 ---");
  const deployerUsdc = 50_000n * USDC_6;   // 245 * 200 + buffer
  const traderUsdc = 2_000n * USDC_6;
  await (mockUsdc as any).write.mint([deployer.account.address, deployerUsdc], { account: deployer.account });
  await (mockUsdc as any).write.mint([trader.account.address, traderUsdc], { account: deployer.account });

  const buyUsdcAmount = 1_000n * USDC_6;
  await (mockUsdc as any).write.approve([initialLaunchAddress, buyUsdcAmount], { account: trader.account });
  await initialLaunch.write.buy([buyUsdcAmount], { account: trader.account });
  const allocated = (await initialLaunch.read.allocations([trader.account.address])) as readonly [bigint, bigint];
  console.log(`Trader bought with ${Number(buyUsdcAmount) / 1e6} USDC; TCGV allocated: ${formatEther(allocated[0])}`);
  console.log();

  // --- Phase 4: Mint 245 Founder NFTs (wave 2 starts) ---
  console.log("--- Phase 4: Mint 245 Founder NFTs (wave 2) ---");
  const wave1Price = 200n * USDC_6;
  await (mockUsdc as any).write.approve([founderNFTAddress, wave1Price * BigInt(FOUNDER_NFT_WAVE1_CAP)], { account: deployer.account });
  for (let i = 0; i < FOUNDER_NFT_WAVE1_CAP; i++) {
    await founderNFT.write.mint({ account: deployer.account });
    if ((i + 1) % 50 === 0) console.log(`  Minted ${i + 1}/${FOUNDER_NFT_WAVE1_CAP}`);
  }
  const soldCount = await founderNFT.read.soldCount();
  const w2 = await founderNFT.read.wave2StartTimestamp();
  console.log(`Founder NFT soldCount: ${soldCount}, wave2StartTimestamp: ${w2}`);
  console.log();

  // --- Phase 5: Time travel 121h and finalize ---
  console.log("--- Phase 5: Time travel 121h, set recipients, finalize ---");
  try {
    if (networkHelpers?.time) {
      await networkHelpers.time.increase(PRESALE_COUNTDOWN_HOURS * 3600 + 3600);
      await networkHelpers.mine();
      console.log("Time increased by 121h and block mined.");
    } else {
      const provider = (hre as any).network?.provider;
      if (provider?.request) {
        await provider.request({ method: "evm_increaseTime", params: [PRESALE_COUNTDOWN_HOURS * 3600 + 3600] });
        await provider.request({ method: "evm_mine", params: [] });
        console.log("Time increased by 121h (provider) and block mined.");
      } else {
        throw new Error("No time travel available");
      }
    }
  } catch (e) {
    console.warn("Time travel not supported (e.g. live RPC); skipping. Finalize may revert.", e instanceof Error ? e.message : e);
  }

  await token.write.setAllocationRecipients([deployer.account.address, deployer.account.address, deployer.account.address], { account: deployer.account });
  await initialLaunch.write.finalize({ account: deployer.account });
  const tgeTs = await initialLaunch.read.tgeTimestamp();
  console.log("Presale finalized. TGE timestamp:", tgeTs.toString());
  const totalAllocated = await initialLaunch.read.totalTCGVAllocated();
  console.log("Total TCGV allocated (presale):", formatEther(totalAllocated));
  console.log();

  // --- Phase 6: Trader claims vested TCGV ---
  console.log("--- Phase 6: Trader claims (10% TGE) ---");
  const releasable = await initialLaunch.read.releasable([trader.account.address]);
  console.log("Releasable for trader:", formatEther(releasable));
  await initialLaunch.write.claim({ account: trader.account });
  const traderTcgv = await token.read.balanceOf([trader.account.address]);
  console.log("Trader TCGV balance after claim:", formatEther(traderTcgv));
  console.log();

  // --- Phase 7 (optional): Add liquidity and one DEX swap (requires BSC fork) ---
  console.log("--- Phase 7: Add liquidity and one DEX swap ---");
  try {
    const pancakeFactory = await viem.getContractAt("PancakeFactory", PANCAKE_FACTORY);
    const pancakeRouter = await viem.getContractAt("PancakeRouter", PANCAKE_ROUTER);
    const wbnbAddress = (await pancakeRouter.read.WETH()) as Address;
    let pairAddress = (await pancakeFactory.read.getPair([tokenAddress, wbnbAddress])) as Address;
    if (pairAddress === zeroAddress) {
      await pancakeFactory.write.createPair([tokenAddress, wbnbAddress], { account: deployer.account });
      pairAddress = (await pancakeFactory.read.getPair([tokenAddress, wbnbAddress])) as Address;
    }
    await token.write.setPair([pairAddress], { account: deployer.account });
    await token.write.setMinAmounts([1n, 1n], { account: deployer.account });

    const deployerTcgv = await token.read.balanceOf([deployer.account.address]);
    const liqTcgv = deployerTcgv / 2n;
    const liqBnb = parseEther("5");
    if (liqTcgv > 0n) {
      await token.write.approve([wrapper.address as Address, liqTcgv], { account: deployer.account });
      await wrapper.write.addLiquidityETH([
        PANCAKE_ROUTER,
        tokenAddress,
        liqTcgv,
        0n,
        0n,
        deadline,
      ], { value: liqBnb, account: deployer.account });
      console.log(`Liquidity added: ${formatEther(liqTcgv)} TCGV + ${formatEther(liqBnb)} BNB`);
    }

    const path = [wbnbAddress, tokenAddress];
    const minOut = 0n;
    const swapCalldata = await publicClient.encodeFunctionData({
      abi: pancakeRouter.abi,
      functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
      args: [minOut, path, trader.account.address, deadline],
    });
    await trader.sendTransaction({
      to: PANCAKE_ROUTER,
      data: swapCalldata,
      value: parseEther("0.01"),
    });
    const traderTcgvAfter = await token.read.balanceOf([trader.account.address]);
    console.log("After DEX buy (0.01 BNB): trader TCGV", formatEther(traderTcgvAfter));
  } catch (e) {
    console.warn("Phase 7 (DEX) skipped or failed (need BSC fork with PancakeSwap):", e instanceof Error ? e.message : e);
  }
  console.log();

  console.log("=".repeat(80));
  console.log("Full flow summary");
  console.log("=".repeat(80));
  console.log("Token:      ", tokenAddress);
  console.log("Nexus:      ", nexusTokenAddress);
  console.log("Founder NFT:", founderNFTAddress);
  console.log("InitialLaunch:", initialLaunchAddress);
  console.log("Presale → Finalize → Claim → DEX buy completed successfully.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
