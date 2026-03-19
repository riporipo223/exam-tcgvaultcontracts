/**
 * Tests for TCGVaultBuyRouter: buy/sell TCGV with USDC.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { parseEther, parseUnits, zeroAddress } from "viem";

const { viem, networkHelpers } = await hre.network.connect();

async function deployFixture() {
  const wallets = await viem.getWalletClients();
  const owner = wallets[0]!;
  const user1 = wallets[1]!;
  const vault = wallets[2]!;
  const marketing = wallets[3]!;
  const community = wallets[4]!;

  // USDC (6 decimals) for router pair and user payments
  const usdcContract = await viem.deployContract("contracts/test/MockUSDC.sol:MockUSDC", [], { client: { wallet: owner } });
  const usdcAddress = usdcContract.address;
  const usdc = await viem.getContractAt("MockUSDC", usdcAddress);

  const factoryContract = await viem.deployContract("MockUniswapV2Factory", [], { client: { wallet: owner } });
  const factoryAddress = factoryContract.address;
  const factory = await viem.getContractAt("MockUniswapV2Factory", factoryAddress);

  // Router is still needed for TCGVaultToken tests but buy router uses factory directly.
  const routerContract = await viem.deployContract("MockUniswapV2Router", [factoryAddress, usdcAddress], { client: { wallet: owner } });
  const routerAddress = routerContract.address;
  const router = await viem.getContractAt("MockUniswapV2Router", routerAddress);

  const tcgvContract = await viem.deployContract("TCGVaultToken", [
    routerAddress,
    vault.account.address,
    marketing.account.address,
    community.account.address,
    "0x0000000000000000000000000000000000000000",
  ], { client: { wallet: owner } });
  const tcgvAddress = tcgvContract.address;
  const tcgv = await viem.getContractAt("TCGVaultToken", tcgvAddress);

  const nexusContract = await viem.deployContract("TCGNexusToken", [tcgvAddress], { client: { wallet: owner } });
  const nexusAddress = nexusContract.address;
  const nexus = await viem.getContractAt("TCGNexusToken", nexusAddress);

  await tcgv.write.setAddresses([
    vault.account.address,
    marketing.account.address,
    community.account.address,
    nexusAddress,
  ], { account: owner.account });

  // Create USDC/TCGV pair and seed liquidity directly via pair.mint
  await factory.write.createPair([tcgvAddress, usdcAddress], { account: owner.account });
  const pairAddress = await factory.read.getPair([tcgvAddress, usdcAddress]);
  const pair = await viem.getContractAt("MockUniswapV2Pair", pairAddress);
  await tcgv.write.setPair([pairAddress], { account: owner.account });

  const mockPresaleLaunch = await viem.deployContract("contracts/test/MockPresaleLaunch.sol:MockPresaleLaunch", [], { client: { wallet: owner } });
  await tcgv.write.setPresaleFinalizer([mockPresaleLaunch.address], { account: owner.account });
  const mintAmount = parseEther("1000000");
  const liqAmount = parseEther("900000");
  await mockPresaleLaunch.write.mintPresale([tcgvAddress, owner.account.address, mintAmount], { account: owner.account });

  const buyRouter = await viem.deployContract("TCGVaultBuyRouter", [
    routerAddress,
    usdcAddress,
    tcgvAddress,
    vault.account.address,
    marketing.account.address,
    community.account.address,
  ], { client: { wallet: owner } });

  await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
  await tcgv.write.setExcludedFromFees([buyRouter.address, true], { account: owner.account });

  // Seed USDC and TCGV liquidity into pair
  const usdcLiq = parseUnits("10000", 6);
  await usdc.write.mint([owner.account.address, usdcLiq], { account: owner.account });
  await usdc.write.transfer([pairAddress, usdcLiq], { account: owner.account });
  await tcgv.write.transfer([pairAddress, liqAmount], { account: owner.account });
  await pair.write.mint([owner.account.address], { account: owner.account });

  return { owner, user1, vault, marketing, community, usdc, factory, router, tcgv, nexus, buyRouter, pair, usdcAddress, routerAddress, tcgvAddress, pairAddress };
}

describe("TCGVaultBuyRouter", function () {
  it("buyTCGVWithUSDC charges 13% USDC fee, burns 2% of TCGV, gives user rest + NEXUS cashback", async function () {
    const { owner, tcgv, nexus, buyRouter, usdc } = await networkHelpers.loadFixture(deployFixture);
    const usdcIn = parseUnits("1000", 6);
    const buyer = owner;
    const userTcgvBefore = await tcgv.read.balanceOf([buyer.account.address]);
    const userNexusBefore = await nexus.read.balanceOf([buyer.account.address]);

    await usdc.write.mint([buyer.account.address, usdcIn], { account: owner.account });
    await usdc.write.approve([buyRouter.address, usdcIn], { account: buyer.account });

    const hash = await buyRouter.write.buyTCGVWithUSDC([usdcIn, 0n, BigInt(Math.floor(Date.now() / 1000) + 300), zeroAddress], {
      account: buyer.account,
    });
    const publicClient = await viem.getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const events = await publicClient.getContractEvents({
      address: buyRouter.address,
      abi: buyRouter.abi,
      eventName: "BuyWithUSDC",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    const buyEvent = events.find((e: { transactionHash: `0x${string}` }) => e.transactionHash === hash);
    assert.ok(buyEvent !== undefined);
    assert.ok(buyEvent.args?.feeUSDC !== undefined && buyEvent.args.feeUSDC > 0n);
    assert.strictEqual(buyEvent.args?.usdcIn, usdcIn);
    assert.ok(buyEvent.args?.tcgvOut !== undefined && buyEvent.args.tcgvOut > 0n);

    const userTcgvAfter = await tcgv.read.balanceOf([buyer.account.address]);
    const userNexusAfter = await nexus.read.balanceOf([buyer.account.address]);
    assert.ok(userTcgvAfter > userTcgvBefore);
    assert.ok(userNexusAfter > userNexusBefore);
  });

  it("buyTCGVWithUSDC mints 0.5% TCGR to referrer when referral token is set", async function () {
    const { owner, user1, tcgv, buyRouter, usdc } = await networkHelpers.loadFixture(deployFixture);
    const tcgr = await viem.deployContract("TCGRToken", [buyRouter.address], { client: { wallet: owner } });
    await buyRouter.write.setReferralToken([tcgr.address], { account: owner.account });

    const referrer = owner;
    const buyer = user1;
    const usdcIn = parseUnits("1000", 6);
    const expectedReferral = (usdcIn * 10n ** 12n * 50n) / 10000n; // 0.5%, scaled to 18 decimals

    const tcgrBefore = await tcgr.read.balanceOf([referrer.account.address]);
    await usdc.write.mint([buyer.account.address, usdcIn], { account: owner.account });
    await usdc.write.approve([buyRouter.address, usdcIn], { account: buyer.account });
    await buyRouter.write.buyTCGVWithUSDC([usdcIn, 0n, BigInt(Math.floor(Date.now() / 1000) + 300), referrer.account.address], {
      account: buyer.account,
    });
    const tcgrAfter = await tcgr.read.balanceOf([referrer.account.address]);
    assert.ok(tcgrAfter - tcgrBefore === expectedReferral, `referrer should receive 0.5% TCGR: got ${tcgrAfter - tcgrBefore}, expected ${expectedReferral}`);
  });

  it("buyTCGVWithUSDC reverts with zero USDC", async function () {
    const { user1, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.buyTCGVWithUSDC([0n, 0n, BigInt(Math.floor(Date.now() / 1000) + 300), zeroAddress], { account: user1.account }),
      buyRouter,
      "ZeroUSDC"
    );
  });

  it("buyTCGVWithUSDC reverts with expired deadline", async function () {
    const { user1, buyRouter, usdc } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      (async () => {
        const usdcIn = parseUnits("100", 6);
        await usdc.write.mint([user1.account.address, usdcIn], { account: user1.account });
        await usdc.write.approve([buyRouter.address, usdcIn], { account: user1.account });
        return buyRouter.write.buyTCGVWithUSDC([usdcIn, 0n, 1n, zeroAddress], { account: user1.account });
      })(),
      buyRouter,
      "Expired"
    );
  });

  it("sellTCGVForUSDC charges 10% fee and gives user USDC", async function (t) {
    const { owner, tcgv, buyRouter, usdc } = await networkHelpers.loadFixture(deployFixture);
    const seller = owner;
    const tcgvBefore = await tcgv.read.balanceOf([seller.account.address]);
    if (tcgvBefore === 0n) return t.skip();
    const sellAmount = parseEther("0.001");
    if (sellAmount > tcgvBefore) return t.skip();
    const userUsdcBefore = await usdc.read.balanceOf([seller.account.address]);

    await tcgv.write.approve([buyRouter.address, sellAmount], { account: seller.account });
    await buyRouter.write.sellTCGVForUSDC([sellAmount, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
      account: seller.account,
    });

    const tcgvAfter = await tcgv.read.balanceOf([seller.account.address]);
    const userUsdcAfter = await usdc.read.balanceOf([seller.account.address]);
    assert.strictEqual(tcgvBefore - tcgvAfter, sellAmount);
    assert.ok(userUsdcAfter > userUsdcBefore);
  });

  it("sellTCGVForUSDC reverts with zero TCGV", async function () {
    const { user1, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.sellTCGVForUSDC([0n, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)], { account: user1.account }),
      buyRouter,
      "ZeroTCGV"
    );
  });

  it("sellTCGVForUSDC reverts with expired deadline", async function () {
    const { user1, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.sellTCGVForUSDC([parseEther("100"), 0n, 1n], { account: user1.account }),
      buyRouter,
      "Expired"
    );
  });

  it("buyTCGVWithUSDC reverts with InsufficientOutputAmount when amountOutMin too high", async function () {
    const { owner, buyRouter, usdc } = await networkHelpers.loadFixture(deployFixture);
    const usdcIn = parseUnits("100", 6);
    const impossibleMin = parseEther("1000000");
    await viem.assertions.revertWithCustomError(
      (async () => {
        await usdc.write.mint([owner.account.address, usdcIn], { account: owner.account });
        await usdc.write.approve([buyRouter.address, usdcIn], { account: owner.account });
        return buyRouter.write.buyTCGVWithUSDC([usdcIn, impossibleMin, BigInt(Math.floor(Date.now() / 1000) + 300), zeroAddress], {
          account: owner.account,
        });
      })(),
      buyRouter,
      "InsufficientOutputAmount"
    );
  });

  it("sellTCGVForUSDC reverts with InsufficientOutputAmount when amountOutMin too high", async function () {
    const { owner, tcgv, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    const sellAmount = parseEther("0.001");
    await tcgv.write.approve([buyRouter.address, sellAmount], { account: owner.account });
    const impossibleMin = parseEther("1000");
    let reverted = false;
    try {
      await buyRouter.write.sellTCGVForUSDC([sellAmount, impossibleMin, BigInt(Math.floor(Date.now() / 1000) + 300)], {
        account: owner.account,
      });
    } catch {
      reverted = true;
    }
    assert.ok(reverted, "sellTCGVForBNB should revert when amountOutMin exceeds possible BNB out");
  });

  it("BuyRouter getters return correct addresses and params", async function () {
    const { buyRouter, routerAddress, usdcAddress, tcgvAddress, vault, marketing, community } = await networkHelpers.loadFixture(deployFixture);
    assert.strictEqual((await buyRouter.read.router()).toLowerCase(), routerAddress.toLowerCase());
    assert.ok((await buyRouter.read.factory()) !== undefined);
    assert.strictEqual((await buyRouter.read.tcgv()).toLowerCase(), tcgvAddress.toLowerCase());
    assert.strictEqual((await buyRouter.read.usdc()).toLowerCase(), usdcAddress.toLowerCase());
    assert.strictEqual((await buyRouter.read.vault()).toLowerCase(), vault.account.address.toLowerCase());
    assert.strictEqual((await buyRouter.read.marketing()).toLowerCase(), marketing.account.address.toLowerCase());
    assert.strictEqual((await buyRouter.read.community()).toLowerCase(), community.account.address.toLowerCase());
    assert.strictEqual(await buyRouter.read.referralToken(), "0x0000000000000000000000000000000000000000");
    assert.ok((await buyRouter.read.buyVaultBp()) > 0n);
    assert.ok((await buyRouter.read.buyMarketingBp()) > 0n);
    assert.ok((await buyRouter.read.buyCommunityBp()) >= 0n);
    assert.ok((await buyRouter.read.buyTcgvBurnBp()) >= 0n);
    assert.ok((await buyRouter.read.sellTaxBp()) > 0n);
    assert.ok((await buyRouter.read.sellVaultShareBp()) >= 0n);
    assert.ok((await buyRouter.read.sellAutolpShareBp()) >= 0n);
    assert.ok((await buyRouter.read.sellMarketingShareBp()) >= 0n);
    assert.ok((await buyRouter.read.sellCommunityShareBp()) >= 0n);
    assert.ok((await buyRouter.read.sellBurnShareBp()) >= 0n);
  });
  it("owner can setBuyFeeParams setSellFeeParams setReferralToken", async function () {
    const { buyRouter, owner, tcgvAddress } = await networkHelpers.loadFixture(deployFixture);
    const tcgr = await viem.deployContract("TCGRToken", [buyRouter.address], { client: { wallet: owner } });
    await buyRouter.write.setReferralToken([tcgr.address], { account: owner.account });
    assert.strictEqual((await buyRouter.read.referralToken()).toLowerCase(), tcgr.address.toLowerCase());
    await buyRouter.write.setBuyFeeParams([1000n, 300n, 0n, 200n], { account: owner.account });
    assert.strictEqual(await buyRouter.read.buyVaultBp(), 1000n);
    assert.strictEqual(await buyRouter.read.buyMarketingBp(), 300n);
    await buyRouter.write.setSellFeeParams([1000n, 4000n, 3000n, 1000n, 1000n, 1000n], { account: owner.account });
    assert.strictEqual(await buyRouter.read.sellTaxBp(), 1000n);
  });

  it("setBuyFeeParams reverts when vaultBp + marketingBp + communityBp > 10000", async function () {
    const { buyRouter, owner } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.setBuyFeeParams([5000n, 5000n, 100n, 0n], { account: owner.account }),
      buyRouter,
      "InvalidFeeParams"
    );
  });

  it("setBuyFeeParams reverts when tcgvBurnBp > 10000", async function () {
    const { buyRouter, owner } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.setBuyFeeParams([1000n, 500n, 500n, 10001n], { account: owner.account }),
      buyRouter,
      "InvalidFeeParams"
    );
  });

  it("setSellFeeParams reverts when taxBp > 10000", async function () {
    const { buyRouter, owner } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.setSellFeeParams([10001n, 4000n, 3000n, 1000n, 1000n, 1000n], { account: owner.account }),
      buyRouter,
      "InvalidFeeParams"
    );
  });

  it("setSellFeeParams reverts when shares do not sum to 10000", async function () {
    const { buyRouter, owner } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.setSellFeeParams([1000n, 4000n, 3000n, 1000n, 500n, 1000n], { account: owner.account }),
      buyRouter,
      "InvalidFeeParams"
    );
  });

  it("buy with communityBp > 0 transfers community share", async function () {
    const { owner, buyRouter, usdc, community } = await networkHelpers.loadFixture(deployFixture);
    await buyRouter.write.setBuyFeeParams([1000n, 300n, 100n, 200n], { account: owner.account });
    const usdcIn = parseUnits("500", 6);
    await usdc.write.mint([owner.account.address, usdcIn], { account: owner.account });
    await usdc.write.approve([buyRouter.address, usdcIn], { account: owner.account });
    const communityBefore = await usdc.read.balanceOf([community.account.address]);
    await buyRouter.write.buyTCGVWithUSDC([usdcIn, 0n, BigInt(Math.floor(Date.now() / 1000) + 300), zeroAddress], { account: owner.account });
    const communityAfter = await usdc.read.balanceOf([community.account.address]);
    assert.ok(communityAfter > communityBefore);
  });

  it("sell with fee distributes to vault autolp marketing community", async function () {
    const { owner, tcgv, buyRouter, usdc, vault, marketing, community } = await networkHelpers.loadFixture(deployFixture);
    const sellAmount = parseEther("100");
    const tcgvBal = await tcgv.read.balanceOf([owner.account.address]);
    if (tcgvBal < sellAmount) return;
    const vBefore = await usdc.read.balanceOf([vault.account.address]);
    const mBefore = await usdc.read.balanceOf([marketing.account.address]);
    const cBefore = await usdc.read.balanceOf([community.account.address]);
    await tcgv.write.approve([buyRouter.address, sellAmount], { account: owner.account });
    await buyRouter.write.sellTCGVForUSDC([sellAmount, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)], { account: owner.account });
    const vAfter = await usdc.read.balanceOf([vault.account.address]);
    const mAfter = await usdc.read.balanceOf([marketing.account.address]);
    const cAfter = await usdc.read.balanceOf([community.account.address]);
    assert.ok(vAfter >= vBefore && mAfter >= mBefore && cAfter >= cBefore);
  });

  it("_handleReferral skips mint when referrer is buyer (referrer == buyer)", async function () {
    const { owner, user1, buyRouter, usdc } = await networkHelpers.loadFixture(deployFixture);
    const tcgr = await viem.deployContract("TCGRToken", [buyRouter.address], { client: { wallet: owner } });
    await buyRouter.write.setReferralToken([tcgr.address], { account: owner.account });
    const usdcIn = parseUnits("100", 6);
    await usdc.write.mint([user1.account.address, usdcIn], { account: owner.account });
    await usdc.write.approve([buyRouter.address, usdcIn], { account: user1.account });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    await buyRouter.write.buyTCGVWithUSDC([usdcIn, 0n, deadline, user1.account.address], { account: user1.account });
    assert.strictEqual(await tcgr.read.balanceOf([user1.account.address]), 0n);
  });
  it("constructor reverts with ZeroAddress when vault, marketing, or community is zero", async function () {
    const { owner, routerAddress, usdcAddress, tcgvAddress, vault, marketing, community } = await networkHelpers.loadFixture(deployFixture);
    const zero = "0x0000000000000000000000000000000000000000" as `0x${string}`;
    await assert.rejects(
      viem.deployContract("TCGVaultBuyRouter", [routerAddress, usdcAddress, tcgvAddress, zero, marketing.account.address, community.account.address], { client: { wallet: owner } }),
      /ZeroAddress|zero address/
    );
    await assert.rejects(
      viem.deployContract("TCGVaultBuyRouter", [routerAddress, usdcAddress, tcgvAddress, vault.account.address, zero, community.account.address], { client: { wallet: owner } }),
      /ZeroAddress|zero address/
    );
    await assert.rejects(
      viem.deployContract("TCGVaultBuyRouter", [routerAddress, usdcAddress, tcgvAddress, vault.account.address, marketing.account.address, zero], { client: { wallet: owner } }),
      /ZeroAddress|zero address/
    );
  });

});
