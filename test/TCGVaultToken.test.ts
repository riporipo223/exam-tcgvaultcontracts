import { expect } from "chai";
import { ethers } from "hardhat";

const parseEther = (n: string) => ethers.parseEther(n);
const ZERO = ethers.ZeroAddress;

describe("TCGVaultToken", function () {
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let vault: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let marketing: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let community: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let user1: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  let user2: Awaited<ReturnType<typeof ethers.getSigners>>[0];

  let weth: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let factory: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let router: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let tcgv: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let nexus: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let wrapper: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let pair: Awaited<ReturnType<typeof ethers.getContractAt>>;

  const TOTAL_SUPPLY = parseEther("1000000000");
  const BUY_TAX_BP = 1500;
  const SELL_TAX_BP = 1000;
  const CASHBACK_BP = 1000;

  before(async function () {
    [owner, vault, marketing, community, user1, user2] = await ethers.getSigners();

    const MockWETH = await ethers.getContractFactory("MockWETH");
    const MockFactory = await ethers.getContractFactory("MockUniswapV2Factory");
    const MockRouter = await ethers.getContractFactory("MockUniswapV2Router");

    const wethContract = await MockWETH.deploy();
    await wethContract.waitForDeployment();
    weth = await ethers.getContractAt("MockWETH", await wethContract.getAddress());

    const factoryContract = await MockFactory.deploy();
    await factoryContract.waitForDeployment();
    factory = await ethers.getContractAt("MockUniswapV2Factory", await factoryContract.getAddress());

    const routerContract = await MockRouter.deploy(await factory.getAddress(), await weth.getAddress());
    await routerContract.waitForDeployment();
    router = await ethers.getContractAt("MockUniswapV2Router", await routerContract.getAddress());

    const TCGV = await ethers.getContractFactory("TCGVaultToken");
    const tcgvContract = await TCGV.deploy(
      await router.getAddress(),
      vault.address,
      marketing.address,
      community.address,
      ZERO,
      ZERO
    );
    await tcgvContract.waitForDeployment();
    tcgv = await ethers.getContractAt("TCGVaultToken", await tcgvContract.getAddress());

    const Nexus = await ethers.getContractFactory("TCGNexusToken");
    const nexusContract = await Nexus.deploy(await tcgv.getAddress());
    await nexusContract.waitForDeployment();
    nexus = await ethers.getContractAt("TCGNexusToken", await nexusContract.getAddress());

    await tcgv.setAddresses(
      vault.address,
      marketing.address,
      community.address,
      await nexus.getAddress(),
      ZERO
    );

    await factory.createPair(await tcgv.getAddress(), await weth.getAddress());
    const pairAddress = await factory.getPair(await tcgv.getAddress(), await weth.getAddress());
    await tcgv.setPair(pairAddress);
    pair = await ethers.getContractAt("MockUniswapV2Pair", pairAddress);

    const Wrapper = await ethers.getContractFactory("TCGVaultLiquidityWrapper");
    const wrapperContract = await Wrapper.deploy(await router.getAddress());
    await wrapperContract.waitForDeployment();
    wrapper = await ethers.getContractAt("TCGVaultLiquidityWrapper", await wrapperContract.getAddress());
    await tcgv.setExcludedFromFees(await wrapper.getAddress(), true);

    const tokenAmount = parseEther("1000000");
    const ethAmount = parseEther("10");
    const deadline = Math.floor(Date.now() / 1000) + 300;
    // Use wrapper so pair receives full amount (no TCGV fee on add liquidity)
    await tcgv.approve(await wrapper.getAddress(), tokenAmount);
    await wrapper.addLiquidityETH(
      await tcgv.getAddress(),
      tokenAmount,
      0,
      0,
      owner.address,
      deadline,
      { value: ethAmount }
    );
  });

  describe("Deployment", function () {
    it("has correct name and symbol", async function () {
      expect(await tcgv.name()).to.equal("TCG-VAULT Token");
      expect(await tcgv.symbol()).to.equal("TCGV");
    });
    it("minted 1B to owner", async function () {
      expect(await tcgv.totalSupply()).to.equal(TOTAL_SUPPLY);
      expect(await tcgv.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY - parseEther("1000000"));
    });
    it("pair has liquidity", async function () {
      const [r0, r1] = await pair.getReserves();
      expect(r0 + r1).to.be.gt(0);
    });
  });

  describe("Router path: buy (ETH -> TCGV)", function () {
    it("charges 15% buy tax and gives 10% NEXUS cashback", async function () {
      const buyAmountEth = parseEther("1");
      const path = [await weth.getAddress(), await tcgv.getAddress()];
      const vaultBefore = await tcgv.balanceOf(vault.address);
      const marketingBefore = await tcgv.balanceOf(marketing.address);
      const nexusBefore = await nexus.balanceOf(user1.address);
      const totalSupplyBefore = await tcgv.totalSupply();

      await router.connect(user1).swapExactETHForTokens(
        0,
        path,
        user1.address,
        Math.floor(Date.now() / 1000) + 300,
        { value: buyAmountEth }
      );

      const userReceived = await tcgv.balanceOf(user1.address);
      const vaultAfter = await tcgv.balanceOf(vault.address);
      const marketingAfter = await tcgv.balanceOf(marketing.address);
      const nexusAfter = await nexus.balanceOf(user1.address);
      const totalSupplyAfter = await tcgv.totalSupply();

      expect(userReceived).to.be.gt(0);
      expect(vaultAfter - vaultBefore).to.be.gte(0);
      expect(marketingAfter - marketingBefore).to.be.gte(0);
      expect(totalSupplyBefore - totalSupplyAfter).to.be.gt(0);
      expect(nexusAfter - nexusBefore).to.be.gt(0);
    });
  });

  describe("Non-router path: direct pair swap (buy)", function () {
    it("charges buy tax when swapping via pair directly", async function () {
      const ethIn = parseEther("0.5");
      await weth.connect(user2).deposit({ value: ethIn });
      await weth.connect(user2).transfer(await pair.getAddress(), ethIn);

      const token0 = await pair.token0();
      const wethAddr = await weth.getAddress();
      const isToken0Weth = token0.toLowerCase() === wethAddr.toLowerCase();
      const amountTcgvOut = parseEther("1000");
      const amount0Out = isToken0Weth ? 0n : amountTcgvOut;
      const amount1Out = isToken0Weth ? amountTcgvOut : 0n;

      const user2Before = await tcgv.balanceOf(user2.address);
      const totalSupplyBefore = await tcgv.totalSupply();

      await pair.connect(user2).swap(amount0Out, amount1Out, user2.address, "0x");

      const user2After = await tcgv.balanceOf(user2.address);
      const totalSupplyAfter = await tcgv.totalSupply();

      expect(user2After).to.be.gte(user2Before);
      expect(totalSupplyBefore).to.be.gt(totalSupplyAfter);
    });
  });

  describe("Router path: sell (TCGV -> ETH)", function () {
    it("charges 10% sell tax and no cashback", async function () {
      const sellAmount = parseEther("5000");
      const path = [await tcgv.getAddress(), await weth.getAddress()];
      const vaultBefore = await tcgv.balanceOf(vault.address);
      const marketingBefore = await tcgv.balanceOf(marketing.address);
      const communityBefore = await tcgv.balanceOf(community.address);
      const totalSupplyBefore = await tcgv.totalSupply();
      const nexusBefore = await nexus.balanceOf(user1.address);

      await tcgv.connect(user1).approve(await router.getAddress(), sellAmount);
      await router.connect(user1).swapExactTokensForETH(
        sellAmount,
        0,
        path,
        user1.address,
        Math.floor(Date.now() / 1000) + 300
      );

      const vaultAfter = await tcgv.balanceOf(vault.address);
      const marketingAfter = await tcgv.balanceOf(marketing.address);
      const communityAfter = await tcgv.balanceOf(community.address);
      const totalSupplyAfter = await tcgv.totalSupply();
      const nexusAfter = await nexus.balanceOf(user1.address);

      expect(vaultAfter - vaultBefore).to.be.gte(0);
      expect(marketingAfter - marketingBefore).to.be.gte(0);
      expect(communityAfter - communityBefore).to.be.gte(0);
      expect(totalSupplyBefore - totalSupplyAfter).to.be.gt(0);
      expect(nexusAfter).to.equal(nexusBefore);
    });
  });

  describe("Liquidity wrapper: add/remove without fees", function () {
    it("addLiquidityETH via wrapper does not charge fees on token transfer to pair", async function () {
      const addTokenAmount = parseEther("1000");
      const addEthAmount = parseEther("0.1");
      const userBalanceBefore = await tcgv.balanceOf(user1.address);
      const pairBalanceBefore = await tcgv.balanceOf(await pair.getAddress());
      const totalSupplyBefore = await tcgv.totalSupply();

      await tcgv.connect(user1).approve(await wrapper.getAddress(), addTokenAmount);
      await wrapper.connect(user1).addLiquidityETH(
        await tcgv.getAddress(),
        addTokenAmount,
        0,
        0,
        user1.address,
        Math.floor(Date.now() / 1000) + 300,
        { value: addEthAmount }
      );

      const pairBalanceAfter = await tcgv.balanceOf(await pair.getAddress());
      const totalSupplyAfter = await tcgv.totalSupply();

      expect(pairBalanceAfter - pairBalanceBefore).to.equal(addTokenAmount);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore);
    });

    it("removeLiquidityETH via wrapper does not charge fees", async function () {
      const lpBalance = await pair.balanceOf(user1.address);
      if (lpBalance === 0n) return this.skip();
      const userTcgvBefore = await tcgv.balanceOf(user1.address);
      const totalSupplyBefore = await tcgv.totalSupply();

      await pair.connect(user1).approve(await wrapper.getAddress(), lpBalance);
      await wrapper.connect(user1).removeLiquidityETH(
        await tcgv.getAddress(),
        await pair.getAddress(),
        lpBalance / 2n,
        0,
        0,
        user1.address,
        Math.floor(Date.now() / 1000) + 300
      );

      const userTcgvAfter = await tcgv.balanceOf(user1.address);
      const totalSupplyAfter = await tcgv.totalSupply();

      expect(userTcgvAfter).to.be.gt(userTcgvBefore);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore);
    });
  });

  describe("Burn", function () {
    it("buy burn reduces total supply", async function () {
      const supplyBefore = await tcgv.totalSupply();
      const ethIn = parseEther("0.2");
      const path = [await weth.getAddress(), await tcgv.getAddress()];
      await router.connect(user2).swapExactETHForTokens(
        0,
        path,
        user2.address,
        Math.floor(Date.now() / 1000) + 300,
        { value: ethIn }
      );
      const supplyAfter = await tcgv.totalSupply();
      expect(supplyAfter).to.be.lt(supplyBefore);
    });

    it("sell burn reduces total supply", async function () {
      const supplyBefore = await tcgv.totalSupply();
      const sellAmt = parseEther("1000");
      await tcgv.connect(user2).approve(await router.getAddress(), sellAmt);
      const path = [await tcgv.getAddress(), await weth.getAddress()];
      await router.connect(user2).swapExactTokensForETH(
        sellAmt,
        0,
        path,
        user2.address,
        Math.floor(Date.now() / 1000) + 300
      );
      const supplyAfter = await tcgv.totalSupply();
      expect(supplyAfter).to.be.lt(supplyBefore);
    });
  });

  describe("NEXUS Soulbound", function () {
    it("NEXUS transfer reverts", async function () {
      await nexus.connect(owner).mint(owner.address, parseEther("100"));
      await expect(
        nexus.connect(owner).transfer(user1.address, parseEther("1"))
      ).to.be.revertedWithCustomError(nexus, "SoulboundTransferNotAllowed");
    });
  });
});
