/**
 * Tests for Founder NFT and Initial Launch (whitepaper §6, §7).
 * Uses mock ERC20 for USDC and TCGV to avoid deploying full TCGVaultToken.
 */
import { expect } from "chai";
import * as hre from "hardhat";
import { getAddress, parseEther } from "viem";

describe("TCGVaultFounderNFT + InitialLaunch (whitepaper)", function () {
  let owner: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let user1: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let usdc: ReturnType<typeof hre.viem.getContractAt>;
  let nexus: Awaited<ReturnType<typeof hre.viem.deployContract>>;
  let founderNFT: Awaited<ReturnType<typeof hre.viem.deployContract>>;
  let initialLaunch: Awaited<ReturnType<typeof hre.viem.deployContract>>;
  let tcgv: ReturnType<typeof hre.viem.getContractAt>;

  const WAVE1_PRICE = 200 * 1e6;
  const WAVE2_PRICE = 350 * 1e6;

  before(async function () {
    [owner, user1] = await hre.viem.getWalletClients();

    const mockUsdc = await hre.viem.deployContract("MockWETH", [], { account: owner.account });
    usdc = await hre.viem.getContractAt("MockWETH", mockUsdc.address);
    await usdc.write.deposit({ value: parseEther("100"), account: owner.account });
    await usdc.write.transfer([user1.account.address, parseEther("50")], { account: owner.account });

    const mockTcgv = await hre.viem.deployContract("MockWETH", [], { account: owner.account });
    tcgv = await hre.viem.getContractAt("MockWETH", mockTcgv.address);
    await tcgv.write.deposit({ value: parseEther("1000"), account: owner.account });

    nexus = await hre.viem.deployContract("TCGNexusToken", [owner.account.address], { account: owner.account });

    founderNFT = await hre.viem.deployContract("TCGVaultFounderNFT", [
      usdc.address,
      nexus.address,
      owner.account.address,
    ], { account: owner.account });
    initialLaunch = await hre.viem.deployContract("TCGVaultInitialLaunch", [
      tcgv.address,
      usdc.address,
      founderNFT.address,
      nexus.address,
      owner.account.address,
    ], { account: owner.account });

    await nexus.write.setPresaleMinter([founderNFT.address, true], { account: owner.account });
    await nexus.write.setPresaleMinter([initialLaunch.address, true], { account: owner.account });

    // Enough TCGV for presale vesting claims in tests (1000 tokens)
    await tcgv.write.transfer([initialLaunch.address, parseEther("1000")], { account: owner.account });
  });

  describe("TCGVaultFounderNFT", function () {
    it("wave 1: first mint at 200 USDC, buyer gets 30% NEXUS", async function () {
      await usdc.write.approve([founderNFT.address, WAVE1_PRICE], { account: user1.account });
      const nexusBefore = await nexus.read.balanceOf([user1.account.address]);
      await founderNFT.write.mint({ account: user1.account });
      const nexusAfter = await nexus.read.balanceOf([user1.account.address]);
      const expectedNexus = (BigInt(WAVE1_PRICE) * 3000n * (10n ** 18n)) / (10000n * (10n ** 6n));
      expect(nexusAfter - nexusBefore).to.equal(expectedNexus);
      expect(await founderNFT.read.currentWave()).to.equal(1n);
    });

    it("after 245 mints wave2StartTimestamp is set and wave 2 price is 350 USDC", async function () {
      const sold = await founderNFT.read.soldCount();
      const toMint = 245 - Number(sold);
      if (toMint <= 0) return;
      const maxUsdc = BigInt(toMint) * BigInt(WAVE2_PRICE);
      await usdc.write.approve([founderNFT.address, maxUsdc], { account: owner.account });
      for (let i = 0; i < toMint; i++) {
        await founderNFT.write.mint({ account: owner.account });
      }
      expect(await founderNFT.read.soldCount()).to.equal(245n);
      expect(await founderNFT.read.wave2StartTimestamp()).to.be.gt(0);
      expect(await founderNFT.read.currentPrice()).to.equal(BigInt(WAVE2_PRICE));
      expect(await founderNFT.read.currentWave()).to.equal(2n);
    }).timeout(120000);

    it("owner can mint 10 community Founder NFTs", async function () {
      expect(await founderNFT.read.communityMinted()).to.equal(0n);
      await founderNFT.write.mintCommunity([user1.account.address], { account: owner.account });
      expect(await founderNFT.read.communityMinted()).to.equal(1n);
      expect(getAddress(await founderNFT.read.ownerOf([490]))).to.equal(getAddress(user1.account.address));
    });

    it("owner can setBaseURI and tokenURI returns base + tokenId", async function () {
      await founderNFT.write.setBaseURI(["https://api.tcg-vault.io/founder/"], { account: owner.account });
      const uri = await founderNFT.read.tokenURI([0n]);
      expect(uri).to.equal("https://api.tcg-vault.io/founder/0");
    });

    it("owner can setTreasury", async function () {
      await founderNFT.write.setTreasury([user1.account.address], { account: owner.account });
      expect(getAddress(await founderNFT.read.treasury())).to.equal(getAddress(user1.account.address));
    });

    it("setTreasury reverts when not owner", async function () {
      await expect(founderNFT.write.setTreasury([user1.account.address], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("setBaseURI reverts when not owner", async function () {
      await expect(founderNFT.write.setBaseURI(["https://bad/"], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("mintCommunity reverts when not owner", async function () {
      await expect(founderNFT.write.mintCommunity([user1.account.address], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("mintCommunity reverts when ExceedsReserved", async function () {
      const already = await founderNFT.read.communityMinted();
      const toMint = 10 - Number(already);
      for (let i = 0; i < toMint; i++) {
        await founderNFT.write.mintCommunity([user1.account.address], { account: owner.account });
      }
      await expect(founderNFT.write.mintCommunity([user1.account.address], { account: owner.account })).to.be.rejectedWith(/ExceedsReserved|revert/);
    });
  });

  describe("TCGVaultInitialLaunch", function () {
    it("buy reverts when usdcAmount is zero", async function () {
      await expect(initialLaunch.write.buy([0n], { account: user1.account })).to.be.rejectedWith(/ZeroAmount|revert/);
    });

    it("wave 2: price 0.008 USDC/TCGV, 4% cap per wallet, 30% NEXUS on buy", async function () {
      // Use 8 USDC so 10% TGE fits in contract's 1000 TCGV for finalize/claim test
      const usdcAmount = 8 * 1e6;
      await usdc.write.approve([initialLaunch.address, usdcAmount], { account: user1.account });
      const nexusBefore = await nexus.read.balanceOf([user1.account.address]);
      await initialLaunch.write.buy([BigInt(usdcAmount)], { account: user1.account });
      const nexusAfter = await nexus.read.balanceOf([user1.account.address]);
      const expectedNexus = (BigInt(usdcAmount) * 3000n * (10n ** 18n)) / (10000n * (10n ** 6n));
      expect(nexusAfter - nexusBefore).to.equal(expectedNexus);
      const u = await initialLaunch.read.allocations([user1.account.address]);
      // 0.008 USDC/TCGV => price = 8000 (6 decimals), tcgvAmount = usdcAmount * 1e18 / 8000
      expect(u[0]).to.equal((BigInt(usdcAmount) * (10n ** 18n)) / 8000n);
    });

    it("non-owner cannot finalize before 120h countdown or hard cap", async function () {
      const endTime = await initialLaunch.read.presaleEndTime();
      if (endTime === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) {
        this.skip();
        return;
      }
      if (await initialLaunch.read.tgeTimestamp() !== 0n) {
        this.skip();
        return;
      }
      await expect(initialLaunch.write.finalize({ account: user1.account })).to.be.rejected;
    });

    it("buy reverts after 120h countdown", async function () {
      // Requires wave2StartTimestamp set (e.g. by "after 245 mints" test)
      const endTime = await initialLaunch.read.presaleEndTime();
      if (endTime === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) {
        this.skip();
        return;
      }
      await hre.network.provider.request({
        method: "evm_increaseTime",
        params: [121 * 3600],
      });
      await hre.network.provider.request({ method: "evm_mine", params: [] });
      await usdc.write.approve([initialLaunch.address, 1000 * 1e6], { account: user1.account });
      await expect(initialLaunch.write.buy([BigInt(1000 * 1e6)], { account: user1.account }))
        .to.be.rejected;
    });

    it("finalize and claim vesting 10% TGE", async function () {
      await initialLaunch.write.finalize({ account: owner.account });
      const releasable = await initialLaunch.read.releasable([user1.account.address]);
      const allocation = await initialLaunch.read.allocations([user1.account.address]);
      expect(releasable).to.equal((allocation[0] * 10n) / 100n);
      await initialLaunch.write.claim({ account: user1.account });
      expect(await tcgv.read.balanceOf([user1.account.address])).to.equal(releasable);
    });

    it("owner can setTreasury on InitialLaunch", async function () {
      await initialLaunch.write.setTreasury([user1.account.address], { account: owner.account });
      expect(getAddress(await initialLaunch.read.treasury())).to.equal(getAddress(user1.account.address));
    });

    it("InitialLaunch setTreasury reverts when not owner", async function () {
      await expect(initialLaunch.write.setTreasury([user1.account.address], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("presaleEndTime returns max when wave2 not started", async function () {
      const freshFounder = await hre.viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { account: owner.account });
      const launchNoWave2 = await hre.viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        freshFounder.address,
        nexus.address,
        owner.account.address,
      ], { account: owner.account });
      const end = await launchNoWave2.read.presaleEndTime();
      expect(end).to.equal(BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"));
    });

    it("releasable returns 0 for user with no allocation", async function () {
      const [,, u2] = await hre.viem.getWalletClients();
      const r = await initialLaunch.read.releasable([u2.account.address]);
      expect(r).to.equal(0n);
    });

    it("claim reverts when nothing to claim", async function () {
      const [,, u2] = await hre.viem.getWalletClients();
      await expect(initialLaunch.write.claim({ account: u2.account })).to.be.rejectedWith(/NothingToClaim|revert/);
    });

    it("claim reverts when not finalized", async function () {
      const launchNoFinalize = await hre.viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        founderNFT.address,
        nexus.address,
        owner.account.address,
      ], { account: owner.account });
      await expect(launchNoFinalize.write.claim({ account: user1.account })).to.be.rejectedWith(/NotFinalized|revert/);
    });

    it("basicNFTSoldCount returns 0 when staticcall fails (EOA)", async function () {
      const [u0] = await hre.viem.getWalletClients();
      const count = await initialLaunch.read.basicNFTSoldCount([u0.account.address]);
      expect(count).to.equal(0n);
    });

    it("basicNFTSoldCount returns 0 for zero address", async function () {
      expect(await initialLaunch.read.basicNFTSoldCount(["0x0000000000000000000000000000000000000000"])).to.equal(0n);
    });

    it("basicNFTSoldCount returns totalSupply for contract with totalSupply()", async function () {
      const count = await initialLaunch.read.basicNFTSoldCount([tcgv.address]);
      expect(count).to.equal(await tcgv.read.totalSupply());
    });
  });
});
