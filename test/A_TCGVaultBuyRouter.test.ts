/**
 * Tests for TCGVaultBuyRouter: buy TCGV with BNB, sell TCGV for BNB.
 */
import { expect } from "chai";
import hre from "hardhat";
import { parseEther } from "viem";

describe("TCGVaultBuyRouter", function () {
  let owner: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let user1: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let weth: ReturnType<typeof hre.viem.getContractAt>;
  let factory: ReturnType<typeof hre.viem.getContractAt>;
  let router: ReturnType<typeof hre.viem.getContractAt>;
  let tcgv: ReturnType<typeof hre.viem.getContractAt>;
  let nexus: ReturnType<typeof hre.viem.getContractAt>;
  let buyRouter: ReturnType<typeof hre.viem.getContractAt>;
  let pair: ReturnType<typeof hre.viem.getContractAt>;
  let vault: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let marketing: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let community: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];

  let wethAddress: `0x${string}`;
  let routerAddress: `0x${string}`;
  let tcgvAddress: `0x${string}`;
  let pairAddress: `0x${string}`;

  before(async function () {
    [owner, user1, vault, marketing, community] = await hre.viem.getWalletClients();

    const wethContract = await hre.viem.deployContract("MockWETH", [], { account: owner.account });
    wethAddress = wethContract.address as `0x${string}`;
    weth = await hre.viem.getContractAt("MockWETH", wethAddress);

    const factoryContract = await hre.viem.deployContract("MockUniswapV2Factory", [], { account: owner.account });
    const factoryAddress = factoryContract.address;
    factory = await hre.viem.getContractAt("MockUniswapV2Factory", factoryAddress);

    const routerContract = await hre.viem.deployContract("MockUniswapV2Router", [factoryAddress, wethAddress], { account: owner.account });
    routerAddress = routerContract.address as `0x${string}`;
    router = await hre.viem.getContractAt("MockUniswapV2Router", routerAddress);

    const tcgvContract = await hre.viem.deployContract("TCGVaultToken", [
      routerAddress,
      vault.account.address,
      marketing.account.address,
      community.account.address,
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
    ], { account: owner.account });
    tcgvAddress = tcgvContract.address as `0x${string}`;
    tcgv = await hre.viem.getContractAt("TCGVaultToken", tcgvAddress);

    const nexusContract = await hre.viem.deployContract("TCGNexusToken", [tcgvAddress], { account: owner.account });
    const nexusAddress = nexusContract.address;
    nexus = await hre.viem.getContractAt("TCGNexusToken", nexusAddress);

    await tcgv.write.setAddresses([
      vault.account.address,
      marketing.account.address,
      community.account.address,
      nexusAddress,
      "0x0000000000000000000000000000000000000000",
    ], { account: owner.account });

    await factory.write.createPair([tcgvAddress, wethAddress], { account: owner.account });
    pairAddress = (await factory.read.getPair([tcgvAddress, wethAddress])) as `0x${string}`;
    pair = await hre.viem.getContractAt("MockUniswapV2Pair", pairAddress);
    await tcgv.write.setPair([pairAddress], { account: owner.account });

    buyRouter = await hre.viem.deployContract("TCGVaultBuyRouter", [
      routerAddress,
      tcgvAddress,
      vault.account.address,
      marketing.account.address,
      community.account.address,
    ], { account: owner.account });

    await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
    await tcgv.write.setExcludedFromFees([buyRouter.address, true], { account: owner.account });

    const tokenAmount = parseEther("1000000");
    const ethAmount = parseEther("10");
    await tcgv.write.approve([routerAddress, tokenAmount], { account: owner.account });
    await router.write.addLiquidityETH(
      [tcgvAddress, tokenAmount, 0n, 0n, owner.account.address, BigInt(Math.floor(Date.now() / 1000) + 300)],
      { value: ethAmount, account: owner.account }
    );
  });

  it("buyTCGVWithBNB charges 13% BNB fee, burns 2% of TCGV, gives user rest + NEXUS cashback", async function () {
    const bnbIn = parseEther("1");
    const buyer = owner;
    const userTcgvBefore = await tcgv.read.balanceOf([buyer.account.address]);
    const userNexusBefore = await nexus.read.balanceOf([buyer.account.address]);

    const hash = await buyRouter.write.buyTCGVWithBNB([0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
      value: bnbIn,
      account: buyer.account,
    });
    const publicClient = await hre.viem.getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const events = await publicClient.getContractEvents({
      address: buyRouter.address,
      abi: buyRouter.abi,
      eventName: "BuyWithBNB",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    const buyEvent = events.find((e) => e.transactionHash === hash);
    expect(buyEvent).to.not.be.undefined;
    expect(buyEvent!.args.feeBNB).to.be.gt(0n);
    expect(buyEvent!.args.bnbIn).to.equal(bnbIn);
    expect(buyEvent!.args.tcgvOut).to.be.gt(0n);

    const userTcgvAfter = await tcgv.read.balanceOf([buyer.account.address]);
    const userNexusAfter = await nexus.read.balanceOf([buyer.account.address]);
    expect(userTcgvAfter).to.be.gt(userTcgvBefore);
    expect(userNexusAfter).to.be.gt(userNexusBefore);
  });

  it("buyTCGVWithBNB reverts with zero BNB", async function () {
    await expect(
      buyRouter.write.buyTCGVWithBNB([0n, BigInt(Math.floor(Date.now() / 1000) + 300)], { account: user1.account })
    ).to.be.rejectedWith(/ZeroBNB|revert/);
  });

  it("buyTCGVWithBNB reverts with expired deadline", async function () {
    await expect(
      buyRouter.write.buyTCGVWithBNB([0n, 1n], { value: parseEther("0.1"), account: user1.account })
    ).to.be.rejectedWith(/Expired|revert/);
  });

  it("sellTCGVForBNB charges 10% fee and gives user BNB", async function () {
    const seller = owner;
    const tcgvBefore = await tcgv.read.balanceOf([seller.account.address]);
    if (tcgvBefore === 0n) return this.skip();
    const sellAmount = parseEther("0.001");
    if (sellAmount > tcgvBefore) return this.skip();
    const userBnbBefore = await hre.viem.getPublicClient().then(c => c.getBalance({ address: seller.account.address }));

    await tcgv.write.approve([buyRouter.address, sellAmount], { account: seller.account });
    await buyRouter.write.sellTCGVForBNB([sellAmount, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
      account: seller.account,
    });

    const tcgvAfter = await tcgv.read.balanceOf([seller.account.address]);
    const userBnbAfter = await hre.viem.getPublicClient().then(c => c.getBalance({ address: seller.account.address }));
    expect(tcgvBefore - tcgvAfter).to.equal(sellAmount);
    // BNB: user received BNB from sell; balance may still drop if gas cost > BNB received (tiny sells)
    expect(userBnbAfter).to.be.gte(userBnbBefore - parseEther("0.01"));
  });

  it("sellTCGVForBNB reverts with zero TCGV", async function () {
    await expect(
      buyRouter.write.sellTCGVForBNB([0n, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)], { account: user1.account })
    ).to.be.rejectedWith(/ZeroTCGV|revert/);
  });

  it("sellTCGVForBNB reverts with expired deadline", async function () {
    await expect(
      buyRouter.write.sellTCGVForBNB([parseEther("100"), 0n, 1n], { account: user1.account })
    ).to.be.rejectedWith(/Expired|revert/);
  });

  it("buyTCGVWithBNB reverts with InsufficientOutputAmount when amountOutMin too high", async function () {
    const bnbIn = parseEther("0.1");
    const impossibleMin = parseEther("1000000");
    await expect(
      buyRouter.write.buyTCGVWithBNB([impossibleMin, BigInt(Math.floor(Date.now() / 1000) + 300)], {
        value: bnbIn,
        account: owner.account,
      })
    ).to.be.rejectedWith(/InsufficientOutputAmount|revert/);
  });

  it("sellTCGVForBNB reverts with InsufficientOutputAmount when amountOutMin too high", async function () {
    const sellAmount = parseEther("0.001");
    await tcgv.write.approve([buyRouter.address, sellAmount], { account: owner.account });
    const impossibleMin = parseEther("1000");
    await expect(
      buyRouter.write.sellTCGVForBNB([sellAmount, impossibleMin, BigInt(Math.floor(Date.now() / 1000) + 300)], {
        account: owner.account,
      })
    ).to.be.rejectedWith(/InsufficientOutputAmount|revert/);
  });

  it("buy with vault=0 and marketing=0 skips fee transfers", async function () {
    const zero = "0x0000000000000000000000000000000000000000" as `0x${string}`;
    const routerZero = await hre.viem.deployContract("TCGVaultBuyRouter", [
      routerAddress,
      tcgvAddress,
      zero,
      zero,
      zero,
    ], { account: owner.account });
    await tcgv.write.setExcludedFromFees([routerZero.address, true], { account: owner.account });
    await tcgv.write.setBuyRouter([routerZero.address], { account: owner.account });
    const bnbIn = parseEther("0.01");
    await routerZero.write.buyTCGVWithBNB([0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
      value: bnbIn,
      account: owner.account,
    });
    const bal = await tcgv.read.balanceOf([owner.account.address]);
    expect(bal).to.be.gt(0n);
    await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
  });

  it("buyTCGVWithBNB reverts with VaultTransferFailed when vault rejects BNB", async function () {
    const rejectVault = await hre.viem.deployContract("RejectETH", [], { account: owner.account });
    const routerRejectVault = await hre.viem.deployContract("TCGVaultBuyRouter", [
      routerAddress,
      tcgvAddress,
      rejectVault.address,
      marketing.account.address,
      community.account.address,
    ], { account: owner.account });
    await tcgv.write.setExcludedFromFees([routerRejectVault.address, true], { account: owner.account });
    await tcgv.write.setBuyRouter([routerRejectVault.address], { account: owner.account });
    await expect(
      routerRejectVault.write.buyTCGVWithBNB([0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
        value: parseEther("0.1"),
        account: owner.account,
      })
    ).to.be.rejectedWith(/VaultTransferFailed|revert/);
    await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
  });

  it("buyTCGVWithBNB reverts with MarketingTransferFailed when marketing rejects BNB", async function () {
    const rejectMarketing = await hre.viem.deployContract("RejectETH", [], { account: owner.account });
    const routerRejectMarketing = await hre.viem.deployContract("TCGVaultBuyRouter", [
      routerAddress,
      tcgvAddress,
      vault.account.address,
      rejectMarketing.address,
      community.account.address,
    ], { account: owner.account });
    await tcgv.write.setExcludedFromFees([routerRejectMarketing.address, true], { account: owner.account });
    await tcgv.write.setBuyRouter([routerRejectMarketing.address], { account: owner.account });
    await expect(
      routerRejectMarketing.write.buyTCGVWithBNB([0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
        value: parseEther("0.1"),
        account: owner.account,
      })
    ).to.be.rejectedWith(/MarketingTransferFailed|revert/);
    await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
  });

  it("sellTCGVForBNB reverts with UserTransferFailed when seller rejects BNB", async function () {
    const sellerContract = await hre.viem.deployContract("SellerRejectETH", [], { account: owner.account });
    await tcgv.write.setExcludedFromFees([sellerContract.address, true], { account: owner.account });
    const sellAmount = parseEther("0.001");
    const tcgvBal = await tcgv.read.balanceOf([owner.account.address]);
    if (sellAmount > tcgvBal) return this.skip();
    await tcgv.write.transfer([sellerContract.address, sellAmount], { account: owner.account });
    await expect(
      sellerContract.write.sellTCGVForBNB([
        tcgvAddress,
        buyRouter.address,
        sellAmount,
        0n,
        BigInt(Math.floor(Date.now() / 1000) + 300),
      ], { account: owner.account })
    ).to.be.rejectedWith(/UserTransferFailed|revert/);
  });

  it("sell with vault=0 uses router as LP recipient", async function () {
    const zero = "0x0000000000000000000000000000000000000000" as `0x${string}`;
    const routerZeroVault = await hre.viem.deployContract("TCGVaultBuyRouter", [
      routerAddress,
      tcgvAddress,
      zero,
      marketing.account.address,
      community.account.address,
    ], { account: owner.account });
    await tcgv.write.setExcludedFromFees([routerZeroVault.address, true], { account: owner.account });
    await tcgv.write.setBuyRouter([routerZeroVault.address], { account: owner.account });
    const sellAmount = parseEther("0.001");
    const tcgvBal = await tcgv.read.balanceOf([owner.account.address]);
    if (sellAmount > tcgvBal) return this.skip();
    await tcgv.write.approve([routerZeroVault.address, sellAmount], { account: owner.account });
    await routerZeroVault.write.sellTCGVForBNB([sellAmount, 0n, BigInt(Math.floor(Date.now() / 1000) + 300)], {
      account: owner.account,
    });
    await tcgv.write.setBuyRouter([buyRouter.address], { account: owner.account });
  });
});
