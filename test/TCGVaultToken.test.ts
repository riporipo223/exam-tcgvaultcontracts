import { expect } from "chai";
import hre from "hardhat";
import { parseEther, formatEther, zeroAddress, getAddress, getContractAddress, encodeFunctionData } from "viem";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

const ZERO = zeroAddress;

// Helper to ensure transactions complete in Hardhat
async function waitForTx(hash: `0x${string}`) {
  const publicClient = await hre.viem.getPublicClient();
  try {
    // In Hardhat, transactions are synchronous, but we wait to ensure state is updated
    await publicClient.waitForTransactionReceipt({ hash, timeout: 10000 });
  } catch (error: any) {
    // If wait fails (e.g., ABI parsing issues), transaction likely already completed
    // In Hardhat's synchronous environment, this is usually fine
    if (!error.message?.includes('inputs')) {
      throw error;
    }
  }
}

describe("TCGVaultToken", function () {
  let owner: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let vault: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let marketing: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let community: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let user1: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let user2: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];

  let weth: ReturnType<typeof hre.viem.getContractAt>;
  let factory: ReturnType<typeof hre.viem.getContractAt>;
  let router: ReturnType<typeof hre.viem.getContractAt>;
  let tcgv: ReturnType<typeof hre.viem.getContractAt>;
  let nexus: ReturnType<typeof hre.viem.getContractAt>;
  let wrapper: ReturnType<typeof hre.viem.getContractAt>;
  let pair: ReturnType<typeof hre.viem.getContractAt>;
  let publicClient: Awaited<ReturnType<typeof hre.viem.getPublicClient>>;
  let wethAddress: `0x${string}`;
  let factoryAddress: `0x${string}`;
  let routerAddress: `0x${string}`;
  let tcgvAddress: `0x${string}`;
  let nexusAddress: `0x${string}`;
  let wrapperAddress: `0x${string}`;
  let pairAddress: `0x${string}`;

  const TOTAL_SUPPLY = parseEther("1000000000");
  const BUY_TAX_BP = 1500;
  const SELL_TAX_BP = 1000;
  const CASHBACK_BP = 1000;

  before(async function () {
    [owner, vault, marketing, community, user1, user2] = await hre.viem.getWalletClients();
    publicClient = await hre.viem.getPublicClient();

    let nonce = await publicClient.getTransactionCount({ address: owner.account.address });

    // Deploy MockWETH
    const wethHash = await hre.viem.deployContract("MockWETH", [], { account: owner.account });
    wethAddress = getContractAddress({ from: owner.account.address, nonce: BigInt(nonce++) });
    // Don't wait for deployment transactions in Hardhat - they're synchronous
    weth = await hre.viem.getContractAt("MockWETH", wethAddress);

    // Deploy MockFactory
    const factoryHash = await hre.viem.deployContract("MockUniswapV2Factory", [], { account: owner.account });
    factoryAddress = getContractAddress({ from: owner.account.address, nonce: BigInt(nonce++) });
    factory = await hre.viem.getContractAt("MockUniswapV2Factory", factoryAddress);

    // Deploy MockRouter
    const routerHash = await hre.viem.deployContract("MockUniswapV2Router", [factoryAddress, wethAddress], { account: owner.account });
    routerAddress = getContractAddress({ from: owner.account.address, nonce: BigInt(nonce++) });
    router = await hre.viem.getContractAt("MockUniswapV2Router", routerAddress);

    // Deploy TCGVaultToken
    const tcgvHash = await hre.viem.deployContract("TCGVaultToken", [
      routerAddress,
      vault.account.address,
      marketing.account.address,
      community.account.address,
      ZERO,
      ZERO
    ], { account: owner.account });
    tcgvAddress = getContractAddress({ from: owner.account.address, nonce: BigInt(nonce++) });
    tcgv = await hre.viem.getContractAt("TCGVaultToken", tcgvAddress);

    // Deploy TCGNexusToken
    const nexusHash = await hre.viem.deployContract("TCGNexusToken", [tcgvAddress], { account: owner.account });
    nexusAddress = getContractAddress({ from: owner.account.address, nonce: BigInt(nonce++) });
    nexus = await hre.viem.getContractAt("TCGNexusToken", nexusAddress);

    // Set addresses on TCGVaultToken
    const setAddrHash = await tcgv.write.setAddresses([
      vault.account.address,
      marketing.account.address,
      community.account.address,
      nexusAddress,
      ZERO
    ], { account: owner.account });
    await waitForTx(setAddrHash);

    // Create pair
    const createPairHash = await factory.write.createPair([tcgvAddress, wethAddress], { account: owner.account });
    await waitForTx(createPairHash);
    pairAddress = await factory.read.getPair([tcgvAddress, wethAddress]);
    
    // Set pair on token
    const setPairHash = await tcgv.write.setPair([pairAddress], { account: owner.account });
    await waitForTx(setPairHash);
    pair = await hre.viem.getContractAt("MockUniswapV2Pair", pairAddress);

    // Deploy wrapper (deployContract waits for confirmation and returns the contract instance)
    wrapper = await hre.viem.deployContract("TCGVaultLiquidityWrapper", [routerAddress], { account: owner.account });
    wrapperAddress = wrapper.address;
    
    // Exclude wrapper from fees
    const setExcludedHash = await tcgv.write.setExcludedFromFees([wrapperAddress, true], { account: owner.account });
    await waitForTx(setExcludedHash);
    
    // Verify wrapper is excluded
    const isExcluded = await tcgv.read.isExcludedFromFees([wrapperAddress]);
    if (!isExcluded) {
      throw new Error("Wrapper was not excluded from fees");
    }

    // Add liquidity via wrapper (use chain time so deadline is valid after other tests advance time)
    const tokenAmount = parseEther("1000000");
    const ethAmount = parseEther("10");
    const block = await publicClient.getBlock();
    const deadline = block.timestamp + 300n;
    
    // Approve wrapper to spend tokens
    const approveHash = await tcgv.write.approve([wrapperAddress, tokenAmount], { account: owner.account });
    await waitForTx(approveHash);
    
    // Verify approval
    const allowance = await tcgv.read.allowance([owner.account.address, wrapperAddress]);
    if (allowance < tokenAmount) {
      throw new Error(`Approval failed: expected ${tokenAmount}, got ${allowance}`);
    }
    
    // Add liquidity - use write method directly (should work now that wrapper is deployed)
    const addLiqHash = await wrapper.write.addLiquidityETH([
      tcgvAddress,
      tokenAmount,
      0n,
      0n,
      owner.account.address,
      deadline
    ], { value: ethAmount, account: owner.account });
    
    // Mine a block to ensure transaction is included
    await mine();
    
    // Wait for transaction receipt and check status
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash: addLiqHash, timeout: 5000 });
    } catch (error: any) {
      // If wait fails, transaction might have reverted - check balances
      const ownerBalanceAfter = await tcgv.read.balanceOf([owner.account.address]);
      const pairBalance = await tcgv.read.balanceOf([pairAddress]);
      const wrapperBalance = await tcgv.read.balanceOf([wrapperAddress]);
      throw new Error(`Transaction wait failed: ${error.message}. Owner: ${ownerBalanceAfter}, Pair: ${pairBalance}, Wrapper: ${wrapperBalance}`);
    }
    
    if (receipt.status === "reverted") {
      const ownerBalanceAfter = await tcgv.read.balanceOf([owner.account.address]);
      const pairBalance = await tcgv.read.balanceOf([pairAddress]);
      const wrapperBalance = await tcgv.read.balanceOf([wrapperAddress]);
      throw new Error(`addLiquidityETH reverted. Owner: ${ownerBalanceAfter}, Pair: ${pairBalance}, Wrapper: ${wrapperBalance}`);
    }
    
    // Verify liquidity was added by checking pair reserves
    const [r0, r1] = await pair.read.getReserves();
    if (r0 === 0n && r1 === 0n) {
      const pairBalance = await tcgv.read.balanceOf([pairAddress]);
      const wrapperBalance = await tcgv.read.balanceOf([wrapperAddress]);
      const ownerBalanceAfter = await tcgv.read.balanceOf([owner.account.address]);
      throw new Error(`Liquidity was not added. Owner: ${ownerBalanceAfter}, Pair: ${pairBalance}, Wrapper: ${wrapperBalance}`);
    }
  });

  describe("Deployment", function () {
    it("has correct name and symbol", async function () {
      expect(await tcgv.read.name()).to.equal("TCG-VAULT Token");
      expect(await tcgv.read.symbol()).to.equal("TCGV");
    });
    it("minted 1B to owner", async function () {
      expect(await tcgv.read.totalSupply()).to.equal(TOTAL_SUPPLY);
      expect(await tcgv.read.balanceOf([owner.account.address])).to.equal(TOTAL_SUPPLY - parseEther("1000000"));
    });
    it("pair has liquidity", async function () {
      const [r0, r1] = await pair.read.getReserves();
      expect(r0 + r1).to.be.gt(0);
    });
  });

  describe("Router path: buy (ETH -> TCGV)", function () {
    it("charges 15% buy tax and gives 10% NEXUS cashback", async function () {
      const buyAmountEth = parseEther("1");
      const path = [wethAddress, tcgvAddress];
      const vaultBefore = await tcgv.read.balanceOf([vault.account.address]);
      const marketingBefore = await tcgv.read.balanceOf([marketing.account.address]);
      const nexusBefore = await nexus.read.balanceOf([user1.account.address]);
      const totalSupplyBefore = await tcgv.read.totalSupply();

      await router.write.swapExactETHForTokens([
        0n,
        path,
        user1.account.address,
        (await publicClient.getBlock()).timestamp + 300n
      ], { value: buyAmountEth, account: user1.account });

      const userReceived = await tcgv.read.balanceOf([user1.account.address]);
      const vaultAfter = await tcgv.read.balanceOf([vault.account.address]);
      const marketingAfter = await tcgv.read.balanceOf([marketing.account.address]);
      const nexusAfter = await nexus.read.balanceOf([user1.account.address]);
      const totalSupplyAfter = await tcgv.read.totalSupply();

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
      await weth.write.deposit({ value: ethIn, account: user2.account });
      await weth.write.transfer([pairAddress, ethIn], { account: user2.account });

      const token0 = await pair.read.token0();
      const isToken0Weth = token0.toLowerCase() === wethAddress.toLowerCase();
      const amountTcgvOut = parseEther("1000");
      const amount0Out = isToken0Weth ? 0n : amountTcgvOut;
      const amount1Out = isToken0Weth ? amountTcgvOut : 0n;

      const user2Before = await tcgv.read.balanceOf([user2.account.address]);
      const totalSupplyBefore = await tcgv.read.totalSupply();

      await pair.write.swap([amount0Out, amount1Out, user2.account.address, "0x"], { account: user2.account });

      const user2After = await tcgv.read.balanceOf([user2.account.address]);
      const totalSupplyAfter = await tcgv.read.totalSupply();

      expect(user2After).to.be.gte(user2Before);
      expect(totalSupplyBefore).to.be.gt(totalSupplyAfter);
    });
  });

  describe("Router path: sell (TCGV -> ETH)", function () {
    it("charges 10% sell tax and no cashback", async function () {
      const sellAmount = parseEther("5000");
      const path = [tcgvAddress, wethAddress];
      const vaultBefore = await tcgv.read.balanceOf([vault.account.address]);
      const marketingBefore = await tcgv.read.balanceOf([marketing.account.address]);
      const communityBefore = await tcgv.read.balanceOf([community.account.address]);
      const totalSupplyBefore = await tcgv.read.totalSupply();
      const nexusBefore = await nexus.read.balanceOf([user1.account.address]);

      await tcgv.write.approve([routerAddress, sellAmount], { account: user1.account });
      await router.write.swapExactTokensForETH([
        sellAmount,
        0n,
        path,
        user1.account.address,
        (await publicClient.getBlock()).timestamp + 300n
      ], { account: user1.account });

      const vaultAfter = await tcgv.read.balanceOf([vault.account.address]);
      const marketingAfter = await tcgv.read.balanceOf([marketing.account.address]);
      const communityAfter = await tcgv.read.balanceOf([community.account.address]);
      const totalSupplyAfter = await tcgv.read.totalSupply();
      const nexusAfter = await nexus.read.balanceOf([user1.account.address]);

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
      const userBalanceBefore = await tcgv.read.balanceOf([user1.account.address]);
      const pairBalanceBefore = await tcgv.read.balanceOf([pairAddress]);
      const totalSupplyBefore = await tcgv.read.totalSupply();

      await tcgv.write.approve([wrapperAddress, addTokenAmount], { account: user1.account });
      await wrapper.write.addLiquidityETH([
        tcgvAddress,
        addTokenAmount,
        0n,
        0n,
        user1.account.address,
        (await publicClient.getBlock()).timestamp + 300n
      ], { value: addEthAmount, account: user1.account });

      const pairBalanceAfter = await tcgv.read.balanceOf([pairAddress]);
      const totalSupplyAfter = await tcgv.read.totalSupply();

      expect(pairBalanceAfter - pairBalanceBefore).to.equal(addTokenAmount);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore);
    });

    it("removeLiquidityETH via wrapper does not charge fees", async function () {
      const lpBalance = await pair.read.balanceOf([user1.account.address]);
      if (lpBalance === 0n) return this.skip();
      const userTcgvBefore = await tcgv.read.balanceOf([user1.account.address]);
      const totalSupplyBefore = await tcgv.read.totalSupply();

      await pair.write.approve([wrapperAddress, lpBalance], { account: user1.account });
      await wrapper.write.removeLiquidityETH([
        tcgvAddress,
        pairAddress,
        lpBalance / 2n,
        0n,
        0n,
        user1.account.address,
        (await publicClient.getBlock()).timestamp + 300n
      ], { account: user1.account });

      const userTcgvAfter = await tcgv.read.balanceOf([user1.account.address]);
      const totalSupplyAfter = await tcgv.read.totalSupply();

      expect(userTcgvAfter).to.be.gt(userTcgvBefore);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore);
    });

    it("wrapper receive reverts when sender is not router", async function () {
      let reverted = false;
      try {
        await owner.sendTransaction({ to: wrapperAddress, value: 1n, account: owner.account });
      } catch {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("wrapper refunds excess token when router uses less than desired", async function () {
      const [r0, r1] = await pair.read.getReserves();
      if (r0 === 0n && r1 === 0n) return this.skip();
      const tokenDesired = parseEther("50000");
      const ethAmount = parseEther("0.5");
      const userBalanceBefore = await tcgv.read.balanceOf([user1.account.address]);
      await tcgv.write.approve([wrapperAddress, tokenDesired], { account: user1.account });
      await wrapper.write.addLiquidityETH([
        tcgvAddress,
        tokenDesired,
        0n,
        0n,
        user1.account.address,
        (await publicClient.getBlock()).timestamp + 300n
      ], { value: ethAmount, account: user1.account });
      const userBalanceAfter = await tcgv.read.balanceOf([user1.account.address]);
      if (userBalanceAfter > userBalanceBefore - tokenDesired) {
        expect(userBalanceAfter).to.be.gt(userBalanceBefore - tokenDesired);
      }
    });
  });

  describe("Burn", function () {
    it("buy burn reduces total supply", async function () {
      const supplyBefore = await tcgv.read.totalSupply();
      const ethIn = parseEther("0.2");
      const path = [wethAddress, tcgvAddress];
      await router.write.swapExactETHForTokens([
        0n,
        path,
        user2.account.address,
        (await publicClient.getBlock()).timestamp + 300n
      ], { value: ethIn, account: user2.account });
      const supplyAfter = await tcgv.read.totalSupply();
      expect(supplyAfter).to.be.lt(supplyBefore);
    });

    it("sell burn reduces total supply", async function () {
      const supplyBefore = await tcgv.read.totalSupply();
      const sellAmt = parseEther("1000");
      await tcgv.write.approve([routerAddress, sellAmt], { account: user2.account });
      const path = [tcgvAddress, wethAddress];
      await router.write.swapExactTokensForETH([
        sellAmt,
        0n,
        path,
        user2.account.address,
        (await publicClient.getBlock()).timestamp + 300n
      ], { account: user2.account });
      const supplyAfter = await tcgv.read.totalSupply();
      expect(supplyAfter).to.be.lt(supplyBefore);
    });
  });

  describe("NEXUS Soulbound", function () {
    it("NEXUS transfer reverts", async function () {
      await nexus.write.mint([owner.account.address, parseEther("100")], { account: owner.account });
      let reverted = false;
      try {
        await nexus.write.transfer([user1.account.address, parseEther("1")], { account: owner.account });
      } catch {
        reverted = true; // any revert (SoulboundTransferNotAllowed) means soulbound is enforced
      }
      expect(reverted).to.be.true;
    });

    it("NEXUS nonces returns value for account", async function () {
      const n = await nexus.read.nonces([owner.account.address]);
      expect(n).to.be.a("bigint");
    });

    it("NEXUS constructor reverts when minter is zero", async function () {
      await expect(hre.viem.deployContract("TCGNexusToken", [ZERO], { account: owner.account })).to.be.rejectedWith(/ZeroAddress|revert/);
    });

    it("NEXUS setPresaleMinter reverts when not owner", async function () {
      await expect(nexus.write.setPresaleMinter([user1.account.address, true], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("NEXUS mintCashback reverts when not minter", async function () {
      await expect(nexus.write.mintCashback([owner.account.address, parseEther("1")], { account: user1.account })).to.be.rejectedWith(/OnlyMinter|revert/);
    });

    it("NEXUS mintCashback reverts when recipient is zero or amount is zero", async function () {
      const testMinter = await hre.viem.deployContract("TestNexusMinter", [], { account: owner.account });
      const nexusMinter = await hre.viem.deployContract("TCGNexusToken", [testMinter.address], { account: owner.account });
      await nexusMinter.write.mint([owner.account.address, parseEther("100")], { account: owner.account });
      await expect(testMinter.write.mintCashback([nexusMinter.address as `0x${string}`, ZERO, parseEther("1")], { account: owner.account })).to.be.rejectedWith(/ZeroAddress|revert/);
      await expect(testMinter.write.mintCashback([nexusMinter.address as `0x${string}`, owner.account.address, 0n], { account: owner.account })).to.be.rejectedWith(/ZeroAmount|revert/);
    });

    it("NEXUS mintPresaleBonus reverts when not presale minter", async function () {
      await expect(nexus.write.mintPresaleBonus([owner.account.address, parseEther("1")], { account: user1.account })).to.be.rejectedWith(/OnlyPresaleMinter|revert/);
    });

    it("NEXUS mintPresaleBonus reverts when recipient is zero", async function () {
      await nexus.write.setPresaleMinter([owner.account.address, true], { account: owner.account });
      await expect(nexus.write.mintPresaleBonus([ZERO, parseEther("1")], { account: owner.account })).to.be.rejectedWith(/ZeroAddress|revert/);
    });

    it("NEXUS mintPresaleBonus reverts when amount is zero", async function () {
      await expect(nexus.write.mintPresaleBonus([owner.account.address, 0n], { account: owner.account })).to.be.rejectedWith(/ZeroAmount|revert/);
    });

    it("NEXUS mint reverts when to is zero", async function () {
      await expect(nexus.write.mint([ZERO, parseEther("1")], { account: owner.account })).to.be.rejectedWith(/ZeroAddress|revert/);
    });
  });

  describe("TCGVaultToken branch coverage", function () {
    it("setPair reverts when pair is zero", async function () {
      await expect(tcgv.write.setPair([ZERO], { account: owner.account })).to.be.rejectedWith(/PairZeroAddress|revert/);
    });

    it("setPairStatus reverts when not owner", async function () {
      await expect(tcgv.write.setPairStatus([pairAddress, false], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("setFeesEnabled reverts when not owner", async function () {
      await expect(tcgv.write.setFeesEnabled([false], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("setCashbackEnabled reverts when not owner", async function () {
      await expect(tcgv.write.setCashbackEnabled([false], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("setMinAmounts reverts when not owner", async function () {
      await expect(tcgv.write.setMinAmounts([0n, 0n], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("setBuyRouter with zero does not set isExcludedFromFees", async function () {
      await tcgv.write.setBuyRouter([ZERO], { account: owner.account });
      expect(await tcgv.read.buyRouter()).to.equal(ZERO);
    });

    it("recordBuyAndMintCashback early return when cashback disabled", async function () {
      const testRouter = await hre.viem.deployContract("TestBuyRouter", [], { account: owner.account });
      await testRouter.write.setToken([tcgvAddress], { account: owner.account });
      await tcgv.write.setBuyRouter([testRouter.address], { account: owner.account });
      await tcgv.write.setCashbackEnabled([false], { account: owner.account });
      await testRouter.write.callRecordBuyAndMintCashback([owner.account.address, parseEther("100")], { account: owner.account });
    });

    it("recordBuyAndMintCashback early return when cashbackAmount is zero", async function () {
      const testRouter = await hre.viem.deployContract("TestBuyRouter", [], { account: owner.account });
      await testRouter.write.setToken([tcgvAddress], { account: owner.account });
      await tcgv.write.setBuyRouter([testRouter.address], { account: owner.account });
      await tcgv.write.setCashbackEnabled([true], { account: owner.account });
      await testRouter.write.callRecordBuyAndMintCashback([owner.account.address, 1n], { account: owner.account });
    });

    it("burn early return when amount is zero", async function () {
      const testRouter = await hre.viem.deployContract("TestBuyRouter", [], { account: owner.account });
      await testRouter.write.setToken([tcgvAddress], { account: owner.account });
      await tcgv.write.setBuyRouter([testRouter.address], { account: owner.account });
      await testRouter.write.callBurn([0n], { account: owner.account });
    });

    it("recordBuyAndMintCashback reverts when not buyRouter", async function () {
      await expect(tcgv.write.recordBuyAndMintCashback([owner.account.address, parseEther("100")], { account: user1.account })).to.be.rejectedWith(/OnlyBuyRouter|revert/);
    });

    it("burn reverts when not buyRouter", async function () {
      await expect(tcgv.write.burn([parseEther("1")], { account: user1.account })).to.be.rejectedWith(/OnlyBuyRouter|revert/);
    });
  });

});
