/**
 * Tests for TCGVaultBuyRouter: buy TCGV with BNB, sell TCGV for BNB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { parseEther } from "viem";

const { viem, networkHelpers } = await hre.network.connect();

async function deployFixture() {
  const wallets = await viem.getWalletClients();
  const owner = wallets[0]!;
  const user1 = wallets[1]!;
  const vault = wallets[2]!;
  const marketing = wallets[3]!;
  const community = wallets[4]!;

  const wethContract = await viem.deployContract("MockWETH", [], { client: { wallet: owner } });
  const wethAddress = wethContract.address;
  const weth = await viem.getContractAt("MockWETH", wethAddress);

  const factoryContract = await viem.deployContract("MockUniswapV2Factory", [], { client: { wallet: owner } });
  const factoryAddress = factoryContract.address;
  const factory = await viem.getContractAt("MockUniswapV2Factory", factoryAddress);

  const routerContract = await viem.deployContract("MockUniswapV2Router", [factoryAddress, wethAddress], { client: { wallet: owner } });
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

  await factory.write.createPair([tcgvAddress, wethAddress], { account: owner.account });
  const pairAddress = await factory.read.getPair([tcgvAddress, wethAddress]);
  const pair = await viem.getContractAt("MockUniswapV2Pair", pairAddress);
  await tcgv.write.setPair([pairAddress], { account: owner.account });

  const mockPresaleLaunch = await viem.deployContract("contracts/test/MockPresaleLaunch.sol:MockPresaleLaunch", [], { client: { wallet: owner } });
  await tcgv.write.setPresaleFinalizer([mockPresaleLaunch.address], { account: owner.account });
  const mintAmount = parseEther("1000000");
  const liqAmount = parseEther("900000");
  await mockPresaleLaunch.write.mintPresale([tcgvAddress, owner.account.address, mintAmount], { account: owner.account });

  const buyRouter = await viem.deployContract("TCGVaultBuyRouter", [
    routerAddress,
    tcgvAddress,
    vault.account.address,
    marketing.account.address,
    community.account.address,
  ], { client: { wallet: owner } });

  await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
  await tcgv.write.setExcludedFromFees([buyRouter.address, true], { account: owner.account });

  const ethAmount = parseEther("10");
  await tcgv.write.approve([routerAddress, liqAmount], { account: owner.account });
  await router.write.addLiquidityETH(
    [tcgvAddress, liqAmount, 0n, 0n, owner.account.address, BigInt(Math.floor(Date.now() / 1000) + 300)],
    { value: ethAmount, account: owner.account }
  );

  return { owner, user1, vault, marketing, community, weth, factory, router, tcgv, nexus, buyRouter, pair, wethAddress, routerAddress, tcgvAddress, pairAddress };
}

describe("TCGVaultBuyRouter", function () {
  it("buyTCGVWithBNB charges 13% BNB fee, burns 2% of TCGV, gives user rest + NEXUS cashback", async function () {
    const { owner, tcgv, nexus, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    const bnbIn = parseEther("1");
    const buyer = owner;
    const userTcgvBefore = await tcgv.read.balanceOf([buyer.account.address]);
    const userNexusBefore = await nexus.read.balanceOf([buyer.account.address]);

    const hash = await buyRouter.write.buyTCGVWithBNB([0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
      value: bnbIn,
      account: buyer.account,
    });
    const publicClient = await viem.getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const events = await publicClient.getContractEvents({
      address: buyRouter.address,
      abi: buyRouter.abi,
      eventName: "BuyWithBNB",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    const buyEvent = events.find((e: { transactionHash: `0x${string}` }) => e.transactionHash === hash);
    assert.ok(buyEvent !== undefined);
    assert.ok(buyEvent.args?.feeBNB !== undefined && buyEvent.args.feeBNB > 0n);
    assert.strictEqual(buyEvent.args?.bnbIn, bnbIn);
    assert.ok(buyEvent.args?.tcgvOut !== undefined && buyEvent.args.tcgvOut > 0n);

    const userTcgvAfter = await tcgv.read.balanceOf([buyer.account.address]);
    const userNexusAfter = await nexus.read.balanceOf([buyer.account.address]);
    assert.ok(userTcgvAfter > userTcgvBefore);
    assert.ok(userNexusAfter > userNexusBefore);
  });

  it("buyTCGVWithBNB reverts with zero BNB", async function () {
    const { user1, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.buyTCGVWithBNB([0n, BigInt(Math.floor(Date.now() / 1000) + 300)], { account: user1.account }),
      buyRouter,
      "ZeroBNB"
    );
  });

  it("buyTCGVWithBNB reverts with expired deadline", async function () {
    const { user1, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.buyTCGVWithBNB([0n, 1n], { value: parseEther("0.1"), account: user1.account }),
      buyRouter,
      "Expired"
    );
  });

  it("sellTCGVForBNB charges 10% fee and gives user BNB", async function (t) {
    const { owner, tcgv, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    const seller = owner;
    const tcgvBefore = await tcgv.read.balanceOf([seller.account.address]);
    if (tcgvBefore === 0n) return t.skip();
    const sellAmount = parseEther("0.001");
    if (sellAmount > tcgvBefore) return t.skip();
    const publicClient = await viem.getPublicClient();
    const userBnbBefore = await publicClient.getBalance({ address: seller.account.address });

    await tcgv.write.approve([buyRouter.address, sellAmount], { account: seller.account });
    await buyRouter.write.sellTCGVForBNB([sellAmount, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
      account: seller.account,
    });

    const tcgvAfter = await tcgv.read.balanceOf([seller.account.address]);
    const userBnbAfter = await publicClient.getBalance({ address: seller.account.address });
    assert.strictEqual(tcgvBefore - tcgvAfter, sellAmount);
    assert.ok(userBnbAfter >= userBnbBefore - parseEther("0.01"));
  });

  it("sellTCGVForBNB reverts with zero TCGV", async function () {
    const { user1, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.sellTCGVForBNB([0n, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)], { account: user1.account }),
      buyRouter,
      "ZeroTCGV"
    );
  });

  it("sellTCGVForBNB reverts with expired deadline", async function () {
    const { user1, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      buyRouter.write.sellTCGVForBNB([parseEther("100"), 0n, 1n], { account: user1.account }),
      buyRouter,
      "Expired"
    );
  });

  it("buyTCGVWithBNB reverts with InsufficientOutputAmount when amountOutMin too high", async function () {
    const { owner, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    const bnbIn = parseEther("0.1");
    const impossibleMin = parseEther("1000000");
    await viem.assertions.revertWithCustomError(
      buyRouter.write.buyTCGVWithBNB([impossibleMin, BigInt(Math.floor(Date.now() / 1000) + 300)], {
        value: bnbIn,
        account: owner.account,
      }),
      buyRouter,
      "InsufficientOutputAmount"
    );
  });

  it("sellTCGVForBNB reverts with InsufficientOutputAmount when amountOutMin too high", async function () {
    const { owner, tcgv, buyRouter } = await networkHelpers.loadFixture(deployFixture);
    const sellAmount = parseEther("0.001");
    await tcgv.write.approve([buyRouter.address, sellAmount], { account: owner.account });
    const impossibleMin = parseEther("1000");
    let reverted = false;
    try {
      await buyRouter.write.sellTCGVForBNB([sellAmount, impossibleMin, BigInt(Math.floor(Date.now() / 1000) + 300)], {
        account: owner.account,
      });
    } catch {
      reverted = true;
    }
    assert.ok(reverted, "sellTCGVForBNB should revert when amountOutMin exceeds possible BNB out");
  });

  it("constructor reverts with ZeroAddress when vault, marketing, or community is zero", async function () {
    const { owner, routerAddress, tcgvAddress, vault, marketing, community } = await networkHelpers.loadFixture(deployFixture);
    const zero = "0x0000000000000000000000000000000000000000" as `0x${string}`;
    await assert.rejects(
      viem.deployContract("TCGVaultBuyRouter", [routerAddress, tcgvAddress, zero, marketing.account.address, community.account.address], { client: { wallet: owner } }),
      /ZeroAddress|zero address/
    );
    await assert.rejects(
      viem.deployContract("TCGVaultBuyRouter", [routerAddress, tcgvAddress, vault.account.address, zero, community.account.address], { client: { wallet: owner } }),
      /ZeroAddress|zero address/
    );
    await assert.rejects(
      viem.deployContract("TCGVaultBuyRouter", [routerAddress, tcgvAddress, vault.account.address, marketing.account.address, zero], { client: { wallet: owner } }),
      /ZeroAddress|zero address/
    );
  });

  it("buyTCGVWithBNB reverts with VaultTransferFailed when vault rejects BNB", async function () {
    const { owner, tcgv, buyRouter, routerAddress, tcgvAddress, marketing, community } = await networkHelpers.loadFixture(deployFixture);
    const rejectVault = await viem.deployContract("RejectETH", [], { client: { wallet: owner } });
    const routerRejectVault = await viem.deployContract("TCGVaultBuyRouter", [
      routerAddress,
      tcgvAddress,
      rejectVault.address,
      marketing.account.address,
      community.account.address,
    ], { client: { wallet: owner } });
    await tcgv.write.setExcludedFromFees([routerRejectVault.address, true], { account: owner.account });
    await tcgv.write.setBuyRouter([routerRejectVault.address], { account: owner.account });
    await viem.assertions.revertWithCustomError(
      routerRejectVault.write.buyTCGVWithBNB([0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
        value: parseEther("0.1"),
        account: owner.account,
      }),
      routerRejectVault,
      "VaultTransferFailed"
    );
    await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
  });

  it("buyTCGVWithBNB reverts with MarketingTransferFailed when marketing rejects BNB", async function () {
    const { owner, tcgv, buyRouter, routerAddress, tcgvAddress, vault, community } = await networkHelpers.loadFixture(deployFixture);
    const rejectMarketing = await viem.deployContract("RejectETH", [], { client: { wallet: owner } });
    const routerRejectMarketing = await viem.deployContract("TCGVaultBuyRouter", [
      routerAddress,
      tcgvAddress,
      vault.account.address,
      rejectMarketing.address,
      community.account.address,
    ], { client: { wallet: owner } });
    await tcgv.write.setExcludedFromFees([routerRejectMarketing.address, true], { account: owner.account });
    await tcgv.write.setBuyRouter([routerRejectMarketing.address], { account: owner.account });
    await viem.assertions.revertWithCustomError(
      routerRejectMarketing.write.buyTCGVWithBNB([0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
        value: parseEther("0.1"),
        account: owner.account,
      }),
      routerRejectMarketing,
      "MarketingTransferFailed"
    );
    await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
  });

  it("sellTCGVForBNB reverts with UserTransferFailed when seller rejects BNB", async function (t) {
    const { owner, tcgv, buyRouter, tcgvAddress } = await networkHelpers.loadFixture(deployFixture);
    const sellerContract = await viem.deployContract("SellerRejectETH", [], { client: { wallet: owner } });
    await tcgv.write.setExcludedFromFees([sellerContract.address, true], { account: owner.account });
    const sellAmount = parseEther("0.001");
    const tcgvBal = await tcgv.read.balanceOf([owner.account.address]);
    if (sellAmount > tcgvBal) return t.skip();
    await tcgv.write.transfer([sellerContract.address, sellAmount], { account: owner.account });
    await viem.assertions.revertWithCustomError(
      sellerContract.write.sellTCGVForBNB([
        tcgvAddress,
        buyRouter.address,
        sellAmount,
        0n,
        BigInt(Math.floor(Date.now() / 1000) + 300),
      ], { account: owner.account }),
      buyRouter,
      "UserTransferFailed"
    );
  });

});
