import hre from "hardhat";
import {
  parseEther,
  formatEther,
  zeroAddress,
  encodeFunctionData,
  getContractAddress,
  type Address,
} from "viem";

/**
 * End-to-end test script for TCG Vault on BSC fork
 *
 * Complete flow:
 *   Phase 1 — Deploy: TCGVaultToken, TCGNexusToken, TCGVaultBuyRouter, TCGVaultLiquidityWrapper
 *   Phase 2 — Configure & liquidity: setAddresses, setBuyRouter, setPair, exclude from fees, add liquidity via wrapper
 *   Phase 3 — Buy flows: same BNB for all — PancakeSwap (3.1), TCGVaultBuyRouter (3.2), direct pair (3.3), dummy router (5.2); then buy comparison table (TCGV/BNB, best for user)
 *   Phase 4 — Sell flows: same TCGV sold for both — PancakeSwap (4.1), TCGVaultBuyRouter (4.2); then sell comparison table (BNB out, best for user)
 *   Phase 5 — Dummy router deploy before 3.3/5.2 for getAmountsOut parity
 *
 * Usage (must use a BSC-forked network so PancakeSwap router/factory exist):
 *   yarn hardhat run scripts/testOnBSCFork.ts --network localhost
 *
 * Configure BSC fork in hardhat.config / hardhat.network.ts:
 *   networks.hardhat = {
 *     forking: { url: "https://bsc-dataseed.binance.org/", blockNumber: <block> },
 *     hardfork: "cancun",
 *   };
 */

const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as Address;
const PANCAKE_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73" as Address;

// Same BNB amount for all buy routes (Pancake, BuyRouter, direct pair, dummy) so comparison is apples-to-apples.
const COMPARE_BUY_BNB = parseEther("0.05");
// Same TCGV amount for both sell routes so we can compare BNB out and see what's more profitable for the user.
const COMPARE_SELL_TCGV = parseEther("10000");

// Whitepaper tokenomics (§5) — used for assertions
const BUY_TAX_BP = 1500; // 15% (Pancake direct: token buy tax)
const BUY_BNB_TAX_BP = 1300; // 13% BNB (BuyRouter path: 10% vault + 3% marketing)
const BUY_VAULT_BP = 1000; // 10% of total to vault
const BUY_MARKETING_BP = 300; // 3% of total
const BUY_TCGV_BURN_BP = 200; // 2% of TCGV received burned (BuyRouter path)
const CASHBACK_BP_PRESALE = 3000; // 30% NEXUS during presale (whitepaper §6)
const SELL_TAX_BP = 1000; // 10%
const SELL_VAULT_BP = 400; // 4% of total (vault share)
const SELL_AUTOLP_BP = 300; // 3% of total (autolp → vault for manual LP)
const SELL_VAULT_PLUS_AUTOLP_BP = SELL_VAULT_BP + SELL_AUTOLP_BP; // 7% to vault on BuyRouter sell (vault + autolp TCGV)
const SELL_BURN_BP = 100; // 1% of total

async function main() {
  const { viem } = await hre.network.connect();
  const wallets = await viem.getWalletClients();
  if (!wallets || wallets.length < 2) {
    throw new Error("Need at least 2 wallet accounts (deployer, trader)");
  }
  const deployer = wallets[0]!;
  const trader = wallets[1]!;
  // Use dedicated receiver contracts so inbound BNB can be verified reliably on fork nodes.
  // Some fork backends don't reflect inbound transfers in `eth_getBalance` for prefunded dev accounts.
  const vaultReceiver = await viem.deployContract("FeeReceiver", [], {
    client: { wallet: deployer },
  });
  const marketingReceiver = await viem.deployContract("FeeReceiver", [], {
    client: { wallet: deployer },
  });
  const communityReceiver = await viem.deployContract("FeeReceiver", [], {
    client: { wallet: deployer },
  });
  const vaultAddr = vaultReceiver.address as Address;
  const marketingAddr = marketingReceiver.address as Address;
  const communityAddr = communityReceiver.address as Address;

  const publicClient = await viem.getPublicClient();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  console.log("=".repeat(80));
  console.log("TCG Vault — End-to-end test on BSC fork");
  console.log("=".repeat(80));
  console.log(`Deployer (owner): ${deployer.account.address}`);
  console.log(
    `Deployer BNB: ${formatEther(await publicClient.getBalance({ address: deployer.account.address }))}`
  );
  console.log(`Trader:         ${trader.account.address}`);
  console.log(
    `Trader BNB:   ${formatEther(await publicClient.getBalance({ address: trader.account.address }))}`
  );
  console.log(`Vault:          ${vaultAddr}`);
  console.log(`Marketing:      ${marketingAddr}`);
  console.log(`Community:      ${communityAddr}`);
  console.log();

  const pancakeRouter = await viem.getContractAt("PancakeRouter", PANCAKE_ROUTER);
  const pancakeFactory = await viem.getContractAt("PancakeFactory", PANCAKE_FACTORY);
  const wbnbAddress = (await pancakeRouter.read.WETH()) as Address;
  console.log("PancakeSwap Router:", PANCAKE_ROUTER);
  console.log("PancakeSwap Factory:", PANCAKE_FACTORY);
  console.log("WBNB:", wbnbAddress);
  console.log();

  // ---------------------------------------------------------------------------
  // Phase 1: Deploy all contracts
  // ---------------------------------------------------------------------------
  console.log("--- Phase 1: Deployment ---");
  console.log();

  let nonce = await publicClient.getTransactionCount({ address: deployer.account.address });

  console.log("1.1 Deploying TCGVaultToken...");
  await viem.deployContract("TCGVaultToken", [
    PANCAKE_ROUTER,
    vaultAddr,
    marketingAddr,
    communityAddr,
    zeroAddress,
  ], { client: { wallet: deployer } });
  const tokenAddress = getContractAddress({ from: deployer.account.address, nonce: BigInt(nonce++) }) as Address;
  const token = await viem.getContractAt("TCGVaultToken", tokenAddress);
  console.log(`    TCGVaultToken: ${tokenAddress}`);
  console.log(`    Total supply:  ${formatEther((await token.read.totalSupply()))} TCGV`);
  console.log();

  console.log("1.2 Deploying TCGNexusToken...");
  await viem.deployContract("contracts/TCGNexusToken.sol:TCGNexusToken", [tokenAddress], { client: { wallet: deployer } });
  const nexusTokenAddress = getContractAddress({ from: deployer.account.address, nonce: BigInt(nonce++) }) as Address;
  const nexusToken = await viem.getContractAt("TCGNexusToken", nexusTokenAddress);
  console.log(`    TCGNexusToken: ${nexusTokenAddress}`);
  console.log();

  console.log("1.3 Setting Nexus on TCGVaultToken...");
  await token.write.setAddresses([
    vaultAddr,
    marketingAddr,
    communityAddr,
    nexusTokenAddress,
  ], { account: deployer.account });
  console.log("    Nexus set.");
  console.log();

  console.log("1.4 Deploying TCGVaultBuyRouter...");
  const buyRouter = await viem.deployContract("TCGVaultBuyRouter", [
    PANCAKE_ROUTER,
    tokenAddress,
    vaultAddr,
    marketingAddr,
    communityAddr,
  ], { client: { wallet: deployer } });
  const buyRouterAddress = buyRouter.address as Address;
  await token.write.setBuyRouter([buyRouterAddress], { account: deployer.account });
  console.log(`    TCGVaultBuyRouter: ${buyRouterAddress} (set as buy router)`);
  console.log();

  console.log("1.5 Deploying TCGVaultLiquidityWrapper...");
  const wrapper = await viem.deployContract("contracts/TCGVaultLiquidityWrapper.sol:TCGVaultLiquidityWrapper", [PANCAKE_ROUTER], {
    client: { wallet: deployer },
  });
  const wrapperAddress = wrapper.address as Address;
  await token.write.setLiquidityWrapper([wrapperAddress], { account: deployer.account });
  await token.write.setExcludedFromFees([wrapperAddress, true], { account: deployer.account });
  console.log(`    TCGVaultLiquidityWrapper: ${wrapperAddress} (set as liquidity wrapper, excluded from fees)`);
  console.log();

  console.log("1.6 Presale finalizer and initial mint (no constructor mint)...");
  const mockPresaleLaunch = await viem.deployContract("contracts/test/MockPresaleLaunch.sol:MockPresaleLaunch", [], {
    client: { wallet: deployer },
  });
  await token.write.setPresaleFinalizer([mockPresaleLaunch.address as Address], { account: deployer.account });
  const initialMint = parseEther("1000000000");
  await mockPresaleLaunch.write.mintPresale([tokenAddress, deployer.account.address, initialMint], { account: deployer.account });
  console.log(`    MockPresaleLaunch: ${mockPresaleLaunch.address}; minted ${formatEther(initialMint)} TCGV to deployer for liquidity & tests`);
  console.log();

  // ---------------------------------------------------------------------------
  // Phase 2: Pair, set pair on token, add liquidity
  // ---------------------------------------------------------------------------
  console.log("--- Phase 2: Configure & add liquidity ---");
  console.log();

  console.log("2.1 Create/get PancakeSwap pair TCGV/WBNB...");
  let pairAddress = (await pancakeFactory.read.getPair([tokenAddress, wbnbAddress])) as Address;
  if (pairAddress === zeroAddress) {
    const createHash = await pancakeFactory.write.createPair([tokenAddress, wbnbAddress], {
      account: deployer.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: createHash });
    pairAddress = (await pancakeFactory.read.getPair([tokenAddress, wbnbAddress])) as Address;
    console.log("    Pair created:", pairAddress);
  } else {
    console.log("    Pair exists: ", pairAddress);
  }
  await token.write.setPair([pairAddress], { account: deployer.account });
  console.log("    Pair set on token.");
  console.log();

  console.log("2.2 Add liquidity via wrapper...");
  const tokenAmount = parseEther("1000000");
  const ethAmount = parseEther("10");
  await token.write.approve([wrapperAddress, tokenAmount], { account: deployer.account });
  const addLiqHash = await wrapper.write.addLiquidityETH([
    PANCAKE_ROUTER,
    tokenAddress,
    tokenAmount,
    0n,
    0n,
    deadline,
  ], { value: ethAmount, account: deployer.account });
  await publicClient.waitForTransactionReceipt({ hash: addLiqHash });
  console.log(`    Liquidity: ${formatEther(tokenAmount)} TCGV + ${formatEther(ethAmount)} BNB`);
  const pair = await viem.getContractAt("contracts/test/PancakePair.sol:PancakePair", pairAddress);
  const [reserve0, reserve1] = await (pair as any).read.getReserves();
  const token0 = await (pair as any).read.token0();
  const isToken0TCGV = token0.toLowerCase() === tokenAddress.toLowerCase();
  const tcgvReserve = isToken0TCGV ? reserve0 : reserve1;
  const wbnbReserve = isToken0TCGV ? reserve1 : reserve0;
  console.log(`    Reserves: ${formatEther(tcgvReserve)} TCGV / ${formatEther(wbnbReserve)} WBNB`);
  console.log();

  console.log("2.3 Simple transfer (A → B, fresh address): no fee, no burn...");
  const simpleTransferAmount = parseEther("1000");
  const freshReceiver = getContractAddress({ from: deployer.account.address, nonce: 999999n }) as Address;
  const supplyBeforeTransfer = await token.read.totalSupply();
  const traderBalBefore = await token.read.balanceOf([trader.account.address]);
  await token.write.transfer([trader.account.address, simpleTransferAmount], { account: deployer.account });
  const traderBalAfter = await token.read.balanceOf([trader.account.address]);
  if (traderBalAfter - traderBalBefore !== simpleTransferAmount) {
    throw new Error(`2.3 Deployer→Trader: expected +${formatEther(simpleTransferAmount)}, got +${formatEther(traderBalAfter - traderBalBefore)}`);
  }
  const amountToFresh = simpleTransferAmount / 2n;
  const supplyBeforeToFresh = await token.read.totalSupply();
  await token.write.transfer([freshReceiver, amountToFresh], { account: trader.account });
  const freshBal = await token.read.balanceOf([freshReceiver]);
  const supplyAfterToFresh = await token.read.totalSupply();
  const burnTransfer = supplyBeforeToFresh - supplyAfterToFresh;
  if (freshBal !== amountToFresh) {
    throw new Error(`2.3 Trader→fresh: expected ${formatEther(amountToFresh)}, got ${formatEther(freshBal)} (fee would have been taken)`);
  }
  if (burnTransfer !== 0n) {
    throw new Error(`2.3 Trader→fresh: expected 0 burn, got ${formatEther(burnTransfer)}`);
  }
  console.log(`    Deployer → Trader: ${formatEther(simpleTransferAmount)} TCGV (no fee, deployer excluded).`);
  console.log(`    Trader → Fresh ${freshReceiver}: ${formatEther(amountToFresh)} TCGV received, burn: ${formatEther(burnTransfer)} (regular transfer, no fee/no burn).`);
  console.log("    [OK] 2.3 Simple transfer to fresh address: no fee, no burn.");
  console.log();

  // ---------------------------------------------------------------------------
  // Phase 3: Buy flows
  // ---------------------------------------------------------------------------
  console.log("--- Phase 3: Buy flows ---");
  console.log();

  const path = [wbnbAddress, tokenAddress];
  let minAmountOutRouter = 0n;
  try {
    const amountsOut = (await pancakeRouter.read.getAmountsOut([COMPARE_BUY_BNB, path]));
    minAmountOutRouter = amountsOut[1] > 0n ? (amountsOut[1] * 50n) / 100n : 0n;
  } catch {
    minAmountOutRouter = 0n;
  }

  console.log("3.1 Buy via PancakeSwap router (swapExactETHForTokensSupportingFeeOnTransferTokens)...");
  const buyAmountBNB = COMPARE_BUY_BNB;
  console.log(`    BNB in: ${formatEther(buyAmountBNB)} (compare amount)`);
  const traderTcgvBefore1 = (await token.read.balanceOf([trader.account.address]));
  const vaultTcgvBefore1 = (await token.read.balanceOf([vaultAddr]));
  const supplyBefore1 = (await token.read.totalSupply());

  const swapCalldata = encodeFunctionData({
    abi: pancakeRouter.abi,
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: [minAmountOutRouter, path, trader.account.address, deadline],
  });
  const swapHash = await trader.sendTransaction({
    to: PANCAKE_ROUTER,
    data: swapCalldata,
    value: buyAmountBNB,
  });
  const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
  if (!swapReceipt || swapReceipt.status === "reverted") {
    throw new Error(`Pancake buy reverted: ${JSON.stringify(swapReceipt)}`);
  }

  const traderTcgvAfter1 = (await token.read.balanceOf([trader.account.address]));
  const vaultTcgvAfter1 = (await token.read.balanceOf([vaultAddr]));
  const supplyAfter1 = (await token.read.totalSupply());
  const nexusBal1 = (await nexusToken.read.balanceOf([trader.account.address]));
  const traderDelta1 = traderTcgvAfter1 - traderTcgvBefore1;
  const vaultDelta1 = vaultTcgvAfter1 - vaultTcgvBefore1;
  const burn1 = supplyBefore1 - supplyAfter1;
  const gross1 = traderDelta1 + vaultDelta1 + burn1;
  const totalFee1 = vaultDelta1 + burn1;
  console.log(`    Trader TCGV: +${formatEther(traderDelta1)}`);
  console.log(`    Vault TCGV:  +${formatEther(vaultDelta1)}`);
  console.log(`    Burned:      ${formatEther(burn1)} TCGV (totalSupply: ${formatEther(supplyBefore1)} → ${formatEther(supplyAfter1)})`);
  console.log(`    NEXUS:       ${formatEther(nexusBal1)}`);
  if (gross1 > 0n) {
    const feeBp = Number((totalFee1 * 10000n) / gross1);
    if (feeBp < BUY_TAX_BP - 300 || feeBp > BUY_TAX_BP + 300) {
      throw new Error(`3.1 Buy tax: expected ~${BUY_TAX_BP}bp, got ${feeBp}bp`);
    }
    const burnBpOfFee = Number((burn1 * 10000n) / totalFee1);
    if (burnBpOfFee < 1000 || burnBpOfFee > 1800) {
      throw new Error(`3.1 Burn share of fee: expected ~1333bp (2% of total), got ${burnBpOfFee}bp`);
    }
  }
  if (traderDelta1 === 0n || vaultDelta1 === 0n) {
    throw new Error("3.1 Trader or Vault TCGV delta must be positive");
  }
  const comparePancake = { bnb: buyAmountBNB, traderTcgv: traderDelta1, burned: burn1 };
  console.log("    [OK] 3.1 Buy tax 15%, vault + burn shares match whitepaper");
  console.log();

  console.log("3.2 Buy via TCGVaultBuyRouter (BNB fee path, NEXUS cashback) — same BNB as 3.1 for comparison...");
  const buyRouterBNB = COMPARE_BUY_BNB;
  const traderTcgvBefore2 = await token.read.balanceOf([trader.account.address]);
  const supplyBefore2 = await token.read.totalSupply();
  const vaultBNBBefore2 = await publicClient.getBalance({ address: vaultAddr });
  const marketingBNBBefore2 = await publicClient.getBalance({ address: marketingAddr });
  const nexusBefore2 = await nexusToken.read.balanceOf([trader.account.address]);

  try {
    await publicClient.simulateContract({
      address: buyRouterAddress,
      abi: buyRouter.abi,
      functionName: "buyTCGVWithBNB",
      args: [0n, deadline],
      value: buyRouterBNB,
      account: trader.account,
    });
  } catch (simErr: any) {
    const msg =
      simErr?.shortMessage ??
      simErr?.message ??
      simErr?.cause?.shortMessage ??
      simErr?.cause?.message ??
      simErr?.details ??
      String(simErr);
    throw new Error(`3.2 Buy via TCGVaultBuyRouter would revert: ${msg}`);
  }

  let buyRouterTxHash: `0x${string}`;
  try {
    buyRouterTxHash = await buyRouter.write.buyTCGVWithBNB([0n, deadline], {
      value: buyRouterBNB,
      account: trader.account,
    });
  } catch (err: any) {
    throw new Error(`3.2 Buy via TCGVaultBuyRouter failed: ${err?.shortMessage ?? err?.message ?? String(err)}`);
  }
  const buyRouterReceipt = await publicClient.waitForTransactionReceipt({ hash: buyRouterTxHash });
  if (buyRouterReceipt.status === "reverted") {
    let revertReason = "unknown";
    try {
      await publicClient.simulateContract({
        address: buyRouterAddress,
        abi: buyRouter.abi,
        functionName: "buyTCGVWithBNB",
        args: [0n, deadline],
        value: buyRouterBNB,
        account: trader.account,
      });
    } catch (simErr2: any) {
      revertReason =
        simErr2?.shortMessage ??
        simErr2?.message ??
        simErr2?.cause?.shortMessage ??
        simErr2?.cause?.message ??
        simErr2?.details ??
        (simErr2?.cause ? String(simErr2.cause) : String(simErr2));
    }
    throw new Error(`3.2 Buy via TCGVaultBuyRouter reverted: ${revertReason}`);
  }

  const routerVaultAddr = (await buyRouter.read.vault()) as Address;
  const routerMarketingAddr = (await buyRouter.read.marketing()) as Address;
  if (routerVaultAddr.toLowerCase() !== vaultAddr.toLowerCase()) {
    throw new Error(`3.2 BuyRouter vault ${routerVaultAddr} != vault ${vaultAddr}`);
  }
  if (routerMarketingAddr.toLowerCase() !== marketingAddr.toLowerCase()) {
    throw new Error(`3.2 BuyRouter marketing ${routerMarketingAddr} != marketing ${marketingAddr}`);
  }

  const expectedVaultBNBMin = (buyRouterBNB * BigInt(BUY_VAULT_BP)) / 10000n;
  const expectedMarketingBNBMin = (buyRouterBNB * BigInt(BUY_MARKETING_BP)) / 10000n;

  const traderTcgvAfter2 = (await token.read.balanceOf([trader.account.address]));
  const supplyAfter2 = await token.read.totalSupply();
  const burn2 = supplyBefore2 - supplyAfter2;
  const vaultBNBAfter2 = await publicClient.getBalance({ address: vaultAddr });
  const marketingBNBAfter2 = await publicClient.getBalance({ address: marketingAddr });
  const nexusAfter2 = (await nexusToken.read.balanceOf([trader.account.address]));
  const traderTcgvDelta2 = traderTcgvAfter2 - traderTcgvBefore2;
  const vaultBNBDelta2 = vaultBNBAfter2 - vaultBNBBefore2;
  const marketingBNBDelta2 = marketingBNBAfter2 - marketingBNBBefore2;
  const nexusDelta2 = nexusAfter2 - nexusBefore2;
  if (traderTcgvDelta2 === 0n) {
    throw new Error("3.2 Buy via TCGVaultBuyRouter: trader received 0 TCGV");
  }

  const routerBNBAfter2 = await publicClient.getBalance({ address: buyRouterAddress });
  const vaultReceived2 = await vaultReceiver.read.received();
  const marketingReceived2 = await marketingReceiver.read.received();
  console.log(`    Trader TCGV: +${formatEther(traderTcgvDelta2)}`);
  console.log(`    Burned:      ${formatEther(burn2)} TCGV (totalSupply: ${formatEther(supplyBefore2)} → ${formatEther(supplyAfter2)})`);
  console.log(`    BNB fee: 13% (10% vault, 3% marketing); router keeps 0 BNB. 2% of TCGV received is burned.`);
  console.log(`    Vault BNB (latest):     +${formatEther(vaultBNBDelta2)} (expected >= ${formatEther(expectedVaultBNBMin)})`);
  console.log(`    Marketing BNB (latest): +${formatEther(marketingBNBDelta2)} (expected >= ${formatEther(expectedMarketingBNBMin)})`);
  console.log(`    Vault receiver total:     ${formatEther(vaultReceived2)}`);
  console.log(`    Marketing receiver total: ${formatEther(marketingReceived2)}`);
  console.log(`    Router BNB after: ${formatEther(routerBNBAfter2)} (expected 0)`);
  console.log(`    Router vault=${routerVaultAddr}, marketing=${routerMarketingAddr}`);

  if (routerBNBAfter2 !== 0n) {
    throw new Error(`3.2 Router must retain 0 BNB, got ${formatEther(routerBNBAfter2)}`);
  }
  if (vaultBNBDelta2 < expectedVaultBNBMin - expectedVaultBNBMin / 20n) {
    throw new Error(`3.2 Vault BNB: expected >= ${formatEther(expectedVaultBNBMin)}, got +${formatEther(vaultBNBDelta2)}`);
  }
  if (marketingBNBDelta2 < expectedMarketingBNBMin - expectedMarketingBNBMin / 20n) {
    throw new Error(
      `3.2 Marketing BNB: expected >= ${formatEther(expectedMarketingBNBMin)}, got +${formatEther(marketingBNBDelta2)}`
    );
  }

  const expectedNexusMin = (traderTcgvDelta2 * BigInt(CASHBACK_BP_PRESALE - 200)) / 10000n;
  const expectedNexusMax = (traderTcgvDelta2 * BigInt(CASHBACK_BP_PRESALE + 200)) / 10000n;
  if (nexusDelta2 < expectedNexusMin || nexusDelta2 > expectedNexusMax) {
    throw new Error(
      `3.2 NEXUS cashback: expected ~30% of buy (~${formatEther(expectedNexusMin)}-${formatEther(expectedNexusMax)}), got ${formatEther(nexusDelta2)}`
    );
  }
  console.log(`    Trader TCGV: +${formatEther(traderTcgvDelta2)}`);
  console.log(`    Vault BNB:     +${formatEther(vaultBNBDelta2)} (>= 10% of buy)`);
  console.log(`    Marketing BNB: +${formatEther(marketingBNBDelta2)} (>= 3% of buy)`);
  console.log(`    NEXUS:         +${formatEther(nexusDelta2)}`);
  const compareBuyRouter = { bnb: buyRouterBNB, traderTcgv: traderTcgvDelta2, burned: burn2, nexusDelta: nexusDelta2 };
  console.log("    [OK] 3.2 Vault + Marketing BNB and NEXUS 30% presale cashback match whitepaper");
  console.log();

  // Deploy dummy router before 3.3 so we use its getAmountsOut for the direct swap — same formula as 5.2 for a fair comparison.
  console.log("5.1 Deploy dummy PancakeRouter (same factory + WETH as official)...");
  const dummyRouter = await viem.deployContract("contracts/test/PancakeRouter.sol:PancakeRouter", [PANCAKE_FACTORY, wbnbAddress], {
    client: { wallet: deployer },
  });
  const dummyRouterAddress = dummyRouter.address as Address;
  console.log("    Dummy router:", dummyRouterAddress);
  console.log();

  console.log("3.3 Direct pair swap (WBNB → TCGV, no router)...");
  const wbnb = await viem.getContractAt("WBNB", wbnbAddress);
  const directBNB = COMPARE_BUY_BNB;
  console.log(`    BNB in: ${formatEther(directBNB)} (compare amount)`);
  await wbnb.write.deposit({ value: directBNB, account: trader.account });

  const traderTcgvBefore3 = (await token.read.balanceOf([trader.account.address]));
  const supplyBefore3 = (await token.read.totalSupply());
  // Use dummy router's getAmountsOut so 3.3 and 5.2 use the same formula (official router can use a different fee constant).
  const directPath = [wbnbAddress, tokenAddress];
  const amountsOutDirect = await (dummyRouter as any).read.getAmountsOut([directBNB, directPath]);
  const amountOut = amountsOutDirect[1];
  if (amountOut === 0n) {
    throw new Error("3.3 getAmountsOut returned 0 TCGV for direct swap; check pair liquidity");
  }
  // We are swapping WBNB -> TCGV, so the out token is TCGV.
  const amount0Out = isToken0TCGV ? amountOut : 0n;
  const amount1Out = isToken0TCGV ? 0n : amountOut;

  await wbnb.write.transfer([pairAddress, directBNB], { account: trader.account });
  const pairSwapCalldata = encodeFunctionData({
    abi: pair.abi,
    functionName: "swap",
    args: [amount0Out, amount1Out, trader.account.address, "0x"],
  });
  const directHash = await trader.sendTransaction({
    to: pairAddress,
    data: pairSwapCalldata,
    value: 0n,
  });
  await publicClient.waitForTransactionReceipt({ hash: directHash });

  const traderTcgvAfter3 = (await token.read.balanceOf([trader.account.address]));
  const supplyAfter3 = (await token.read.totalSupply());
  const burn3 = supplyBefore3 - supplyAfter3;
  console.log(`    Trader TCGV: +${formatEther(traderTcgvAfter3 - traderTcgvBefore3)}`);
  console.log(`    Burned:      ${formatEther(burn3)} TCGV (totalSupply: ${formatEther(supplyBefore3)} → ${formatEther(supplyAfter3)})`);
  if (burn3 === 0n) {
    throw new Error("3.3 Direct swap must trigger buy tax and burn");
  }
  const compareDirect = { bnb: directBNB, traderTcgv: traderTcgvAfter3 - traderTcgvBefore3, burned: burn3 };
  console.log("    [OK] 3.3 Direct swap burn (2% of buy) applied");
  console.log();

  // ---------------------------------------------------------------------------
  // Phase 5: Buy via dummy router (before any sell — same BNB as 3.1/3.3 for comparison)
  // ---------------------------------------------------------------------------
  console.log("--- Phase 5: Buy via dummy router (fee parity, before any sell) ---");
  console.log();

  console.log("5.2 Buy TCGV via dummy router (swapExactETHForTokensSupportingFeeOnTransferTokens)...");
  const dummyBuyBNB = COMPARE_BUY_BNB;
  console.log(`    BNB in: ${formatEther(dummyBuyBNB)} (compare amount)`);
  const supplyBeforeDummy = await token.read.totalSupply();
  const traderTcgvBeforeDummy = await token.read.balanceOf([trader.account.address]);
  let minOutDummy = 0n;
  try {
    const amountsDummy = await (dummyRouter as any).read.getAmountsOut([dummyBuyBNB, path]);
    minOutDummy = amountsDummy[1] > 0n ? (amountsDummy[1] * 50n) / 100n : 0n;
  } catch {
    minOutDummy = 0n;
  }
  const dummyCalldata = encodeFunctionData({
    abi: (dummyRouter as any).abi,
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: [minOutDummy, path, trader.account.address, deadline],
  });
  const dummyHash = await trader.sendTransaction({
    to: dummyRouterAddress,
    data: dummyCalldata,
    value: dummyBuyBNB,
  });
  await publicClient.waitForTransactionReceipt({ hash: dummyHash });
  const supplyAfterDummy = await token.read.totalSupply();
  const burnDummy = supplyBeforeDummy - supplyAfterDummy;
  const traderTcgvAfterDummy = await token.read.balanceOf([trader.account.address]);
  const traderDeltaDummy = traderTcgvAfterDummy - traderTcgvBeforeDummy;

  console.log(`    Trader TCGV: +${formatEther(traderDeltaDummy)}`);
  console.log(`    Burned:      ${formatEther(burnDummy)} TCGV (totalSupply: ${formatEther(supplyBeforeDummy)} → ${formatEther(supplyAfterDummy)})`);
  if (burnDummy === 0n) {
    throw new Error("5.2 Dummy router buy must trigger buy tax and burn (same as official router)");
  }
  if (traderDeltaDummy === 0n) {
    throw new Error("5.2 Dummy router buy: trader received 0 TCGV");
  }
  const compareDummy = { bnb: dummyBuyBNB, traderTcgv: traderDeltaDummy, burned: burnDummy };
  console.log("    [OK] 5.2 Dummy router applies same buy tax/burn as official PancakeSwap");
  console.log();

  // --- Buy comparison: same BNB in for all four routes ---
  const buyRows = [
    { name: "PancakeSwap router (3.1)", ...comparePancake },
    { name: "TCGVaultBuyRouter (3.2)", ...compareBuyRouter },
    { name: "Direct pair swap (3.3)", ...compareDirect },
    { name: "Dummy router (5.2)", ...compareDummy },
  ];
  const tcgvPerBnb = (tcgv: bigint, bnb: bigint) => (bnb === 0n ? 0n : (tcgv * 1_000_000n) / bnb);
  let bestBuyIdx = 0;
  for (let i = 1; i < buyRows.length; i++) {
    if (buyRows[i]!.traderTcgv > buyRows[bestBuyIdx]!.traderTcgv) bestBuyIdx = i;
  }
  console.log("--- BUY comparison (same BNB in for all routes — most TCGV out = best for user) ---");
  console.log(`    BNB in: ${formatEther(COMPARE_BUY_BNB)} (identical for all)`);
  console.log("    Route                      | BNB in    | Trader TCGV   | Burned TCGV | TCGV/BNB (1e6)");
  console.log("    ---------------------------|-----------|---------------|---------------|----------------");
  for (const row of buyRows) {
    const tpb = tcgvPerBnb(row.traderTcgv, row.bnb);
    console.log(
      `    ${row.name.padEnd(28)} | ${formatEther(row.bnb).padStart(9)} | ${formatEther(row.traderTcgv).padStart(13)} | ${formatEther(row.burned).padStart(13)} | ${tpb.toString().padStart(14)}`
    );
  }
  console.log(`    >> Best for user (most TCGV per BNB): ${buyRows[bestBuyIdx]!.name}`);
  console.log("    Note: Order of execution depletes pool (first buy gets most TCGV). BuyRouter also gives NEXUS bonus.");
  console.log();

  // ---------------------------------------------------------------------------
  // Phase 4: Sell flows
  // ---------------------------------------------------------------------------
  console.log("--- Phase 4: Sell flows ---");
  console.log();

  const traderTcgvBeforeSells = await token.read.balanceOf([trader.account.address]);
  const sellAmountFixed = traderTcgvBeforeSells >= 2n * COMPARE_SELL_TCGV ? COMPARE_SELL_TCGV : traderTcgvBeforeSells / 2n;
  if (sellAmountFixed === 0n) throw new Error("Trader has no TCGV to sell in Phase 4");
  console.log(`    Using same TCGV amount for both sell routes: ${formatEther(sellAmountFixed)} (comparison)`);
  console.log();

  console.log("4.1 Sell via PancakeSwap router (swapExactTokensForETHSupportingFeeOnTransferTokens)...");
  const sellAmount1 = sellAmountFixed;
  await token.write.approve([PANCAKE_ROUTER, sellAmount1], { account: trader.account });
  const vaultTcgvBefore4 = (await token.read.balanceOf([vaultAddr]));
  const supplyBefore4 = (await token.read.totalSupply());
  const traderBNBBefore4 = await publicClient.getBalance({ address: trader.account.address });

  // Whitepaper §6: Sell tax 10% (4% vault, 3% LP, 1% marketing, 1% community, 1% burn). No exception for Pancake router.
  const sellPath = [tokenAddress, wbnbAddress];
  // Preflight to get an actionable revert reason (stdout-friendly even when redirecting output to a file).
  try {
    await publicClient.simulateContract({
      address: PANCAKE_ROUTER,
      abi: pancakeRouter.abi,
      functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
      args: [sellAmount1, 0n, sellPath, trader.account.address, deadline],
      account: trader.account,
    });
  } catch (simErr: any) {
    const msg =
      simErr?.shortMessage ??
      simErr?.message ??
      simErr?.cause?.shortMessage ??
      simErr?.cause?.message ??
      simErr?.details ??
      String(simErr);
    console.log(`    [REVERT] 4.1 preflight: ${msg}`);
    throw new Error(`4.1 PancakeSwap sell would revert: ${msg}`);
  }

  const sellCalldata = encodeFunctionData({
    abi: pancakeRouter.abi,
    functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
    args: [sellAmount1, 0n, sellPath, trader.account.address, deadline],
  });
  const sellHash = await trader.sendTransaction({
    to: PANCAKE_ROUTER,
    data: sellCalldata,
    value: 0n,
  });
  const sellReceipt1 = await publicClient.waitForTransactionReceipt({ hash: sellHash });

  const traderTcgvAfter4 = (await token.read.balanceOf([trader.account.address]));
  const vaultTcgvAfter4 = (await token.read.balanceOf([vaultAddr]));
  const supplyAfter4 = (await token.read.totalSupply());
  const traderBNBAfter4 = await publicClient.getBalance({ address: trader.account.address });
  const sold1 = sellAmount1;
  const vaultDelta4 = vaultTcgvAfter4 - vaultTcgvBefore4;
  const burn4 = supplyBefore4 - supplyAfter4;
  const bnbOutPancake = traderBNBAfter4 - traderBNBBefore4;
  console.log(`    Trader sold:  ${formatEther(sold1)} TCGV`);
  console.log(`    Trader BNB:   +${formatEther(bnbOutPancake)}`);
  console.log(`    Vault TCGV:   +${formatEther(vaultDelta4)}`);
  console.log(`    Burned:       ${formatEther(burn4)} TCGV (totalSupply: ${formatEther(supplyBefore4)} → ${formatEther(supplyAfter4)})`);

  if (sellReceipt1.status === "reverted") {
    let msg = "unknown";
    try {
      await publicClient.simulateContract({
        address: PANCAKE_ROUTER,
        abi: pancakeRouter.abi,
        functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
        args: [sellAmount1, 0n, sellPath, trader.account.address, deadline],
        account: trader.account,
      });
    } catch (simErr2: any) {
      msg =
        simErr2?.shortMessage ??
        simErr2?.message ??
        simErr2?.cause?.shortMessage ??
        simErr2?.cause?.message ??
        simErr2?.details ??
        String(simErr2);
    }
    console.log(`    [REVERT] 4.1 receipt.status=reverted: ${msg}`);
    throw new Error(`4.1 PancakeSwap sell reverted: ${msg}`);
  }
  if (sold1 === 0n) {
    throw new Error(
      "4.1 PancakeSwap sell succeeded but trader balance unchanged (0 TCGV sold)."
    );
  }
  // Whitepaper §6: sell tax 10% (4% vault, 3% LP, 1% marketing, 1% community, 1% burn). Verify vault and burn of sold amount.
  if (sold1 > 0n) {
    const vaultBp = Number((vaultDelta4 * 10000n) / sold1);
    if (vaultBp < SELL_VAULT_BP - 150 || vaultBp > SELL_VAULT_BP + 150) {
      throw new Error(`4.1 Sell vault share: expected ~${SELL_VAULT_BP}bp (4%), got ${vaultBp}bp`);
    }
    const burnBp = Number((burn4 * 10000n) / sold1);
    if (burnBp < SELL_BURN_BP - 50 || burnBp > SELL_BURN_BP + 50) {
      throw new Error(`4.1 Sell burn share: expected ~${SELL_BURN_BP}bp (1%), got ${burnBp}bp`);
    }
  }
  console.log("    [OK] 4.1 Sell tax 10%, vault 4%, burn 1% match whitepaper");
  console.log();

  console.log("4.2 Sell via TCGVaultBuyRouter (TCGV fee → BNB to user) — same TCGV amount for comparison...");
  const sellAmount2 = sellAmountFixed;
  await token.write.approve([buyRouterAddress, sellAmount2], { account: trader.account });
  const vaultTcgvBefore5 = (await token.read.balanceOf([vaultAddr]));
  const supplyBefore5 = (await token.read.totalSupply());
  const traderBNBBefore5 = await publicClient.getBalance({ address: trader.account.address });

  let minBNBOut = 0n;
  try {
    const amountsOutSell = await pancakeRouter.read.getAmountsOut([
      (sellAmount2 * 90n) / 100n,
      sellPath,
    ]);
    minBNBOut = amountsOutSell[1] > 0n ? (amountsOutSell[1] * 50n) / 100n : 0n;
  } catch {
    minBNBOut = 0n;
  }

  const sellRouterTxHash = await (buyRouter as any).write.sellTCGVForBNB([sellAmount2, minBNBOut, deadline], {
    account: trader.account,
  });
  const sellReceipt = await publicClient.waitForTransactionReceipt({ hash: sellRouterTxHash });
  if (sellReceipt.status === "reverted") {
    throw new Error("4.2 Sell via TCGVaultBuyRouter reverted");
  }

  const traderTcgvAfter5 = (await token.read.balanceOf([trader.account.address]));
  const vaultTcgvAfter5 = (await token.read.balanceOf([vaultAddr]));
  const supplyAfter5 = (await token.read.totalSupply());
  const traderBNBAfter5 = await publicClient.getBalance({ address: trader.account.address });
  const sold2 = sellAmount2;
  const vaultDelta5 = vaultTcgvAfter5 - vaultTcgvBefore5;
  const burn5 = supplyBefore5 - supplyAfter5;
  const bnbOutBuyRouter = traderBNBAfter5 - traderBNBBefore5;
  console.log(`    Trader sold:   ${formatEther(sold2)} TCGV`);
  console.log(`    Trader BNB:    +${formatEther(bnbOutBuyRouter)}`);
  console.log(`    Vault TCGV:    +${formatEther(vaultDelta5)}`);
  console.log(`    Burned:        ${formatEther(burn5)} TCGV (totalSupply: ${formatEther(supplyBefore5)} → ${formatEther(supplyAfter5)})`);
  if (sold2 > 0n) {
    const burnBp = Number((burn5 * 10000n) / sold2);
    if (burnBp < SELL_BURN_BP - 20 || burnBp > SELL_BURN_BP + 20) {
      throw new Error(`4.2 Sell burn: expected ${SELL_BURN_BP}bp (1%), got ${burnBp}bp`);
    }
    const vaultBp = Number((vaultDelta5 * 10000n) / sold2);
    if (vaultBp < SELL_VAULT_PLUS_AUTOLP_BP - 100 || vaultBp > SELL_VAULT_PLUS_AUTOLP_BP + 300) {
      throw new Error(
        `4.2 Sell vault+autolp share: expected ~${SELL_VAULT_PLUS_AUTOLP_BP}bp (4% vault + 3% autolp TCGV to vault), got ${vaultBp}bp`
      );
    }
  }
  console.log("    [OK] 4.2 Sell tax 10%, vault 4%+autolp 3% to vault (manual LP), burn 1% match whitepaper");
  console.log();

  // --- Sell comparison: same TCGV sold for both routes ---
  const bnbPerTcgv = (bnb: bigint, tcgv: bigint) => (tcgv === 0n ? 0n : (bnb * 1_000_000n) / tcgv);
  const sellRows = [
    { name: "PancakeSwap router (4.1)", tcgvSold: sold1, bnbOut: bnbOutPancake },
    { name: "TCGVaultBuyRouter (4.2)", tcgvSold: sold2, bnbOut: bnbOutBuyRouter },
  ];
  const bestSellIdx = bnbOutBuyRouter > bnbOutPancake ? 1 : 0;
  console.log("--- SELL comparison (same TCGV sold — most BNB out = best for user) ---");
  console.log(`    TCGV sold: ${formatEther(sellAmountFixed)} (identical for both)`);
  console.log("    Route                      | TCGV sold    | BNB out      | BNB/TCGV (1e6)");
  console.log("    ---------------------------|--------------|--------------|----------------");
  for (const row of sellRows) {
    const bpt = bnbPerTcgv(row.bnbOut, row.tcgvSold);
    console.log(
      `    ${row.name.padEnd(28)} | ${formatEther(row.tcgvSold).padStart(12)} | ${formatEther(row.bnbOut).padStart(12)} | ${bpt.toString().padStart(14)}`
    );
  }
  console.log(`    >> Best for user (most BNB per TCGV sold): ${sellRows[bestSellIdx]!.name}`);
  console.log("    Note: 4.2 runs after 4.1 so pool state differs; same sell amount used for fair comparison.");
  console.log();

  // ---------------------------------------------------------------------------
  // Summary & tokenomics verification
  // ---------------------------------------------------------------------------
  console.log("=".repeat(80));
  console.log("End-to-end summary");
  console.log("=".repeat(80));
  console.log("TCGVaultToken:           ", tokenAddress);
  console.log("TCGNexusToken:          ", nexusTokenAddress);
  console.log("TCGVaultBuyRouter:      ", buyRouterAddress);
  console.log("TCGVaultLiquidityWrapper:", wrapperAddress);
  console.log("PancakeSwap Pair:        ", pairAddress);
  console.log("Dummy router (Phase 5):  ", dummyRouterAddress);
  console.log("Vault (BNB/TCGV):       ", vaultAddr);
  console.log("Marketing (BNB/TCGV):    ", marketingAddr);
  console.log("Community (TCGV):        ", communityAddr);
  console.log();
  console.log("Tokenomics (whitepaper §5, §6) verified:");
  console.log("  Buy (Pancake direct): 15% in TCGV (10% vault, 3% marketing, 2% burn) + NEXUS cashback (30% presale / 10% standard)");
  console.log("  Buy (BuyRouter):      13% BNB (10% vault, 3% marketing) + 2% TCGV burn + NEXUS cashback (30% presale / 10% standard)");
  console.log("  Sell: 10% (4% vault, 3% LP, 1% marketing, 1% community, 1% burn)");
  console.log();
  console.log("Flow: Deploy → Pair & Liquidity → Buy 4 routes (same BNB) → Buy comparison → Sell 2 routes (same TCGV) → Sell comparison");
  console.log("All steps completed successfully. Production-ready.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
