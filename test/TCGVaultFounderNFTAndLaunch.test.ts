/**
 * Tests for Founder NFT and Initial Launch (whitepaper §6, §7).
 * Uses MockWETH for USDC and MockTCGVPresale for TCGV (mint on buy via mintPresale).
 */
import { describe, it, before } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther } from "viem";
import type { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";

const { viem, networkHelpers } = await hre.network.connect();

async function expectRevert(promise: Promise<unknown>) {
  let reverted = false;
  try {
    await promise;
  } catch {
    reverted = true;
  }
  expect(reverted).to.equal(true);
}

describe("TCGVaultFounderNFT + InitialLaunch (whitepaper)", () => {
  let owner: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let user1: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let usdc: ContractReturnType<"MockWETH">;
  let nexus: ContractReturnType<"TCGNexusToken">;
  let founderNFT: ContractReturnType<"TCGVaultFounderNFT">;
  let initialLaunch: ContractReturnType<"TCGVaultInitialLaunch">;
  let tcgv: ContractReturnType<"MockTCGVPresale">;

  const WAVE1_PRICE = 200 * 1e6;
  const WAVE2_PRICE = 350 * 1e6;

  async function sellOutWave1Founder() {
    const wave1Cap = 250;
    let sold = Number(await founderNFT.read.soldCount());
    if (sold >= wave1Cap) return;

    const maxNonOwner = 245;
    // First, non-owner mints up to 245 (or until wave1Cap)
    if (sold < maxNonOwner) {
      const nonOwnerToMint = Math.min(maxNonOwner - sold, wave1Cap - sold);
      const usdcNonOwner = BigInt(nonOwnerToMint) * BigInt(WAVE1_PRICE);
      await usdc.write.approve([founderNFT.address, usdcNonOwner], { account: user1.account });
      for (let i = 0; i < nonOwnerToMint; i++) {
        await founderNFT.write.mint({ account: user1.account });
        sold++;
      }
    }

    // Remaining wave 1 mints (at most 5) are for the owner
    if (sold < wave1Cap) {
      const ownerToMint = wave1Cap - sold;
      const usdcOwner = BigInt(ownerToMint) * BigInt(WAVE1_PRICE);
      await usdc.write.approve([founderNFT.address, usdcOwner], { account: owner.account });
      for (let i = 0; i < ownerToMint; i++) {
        await founderNFT.write.mint({ account: owner.account });
      }
    }
  }

  before(async () => {
    [owner, user1] = await viem.getWalletClients();

    const mockUsdc = await viem.deployContract("MockWETH", [], { client: { wallet: owner } });
    usdc = await viem.getContractAt("MockWETH", mockUsdc.address);
    await usdc.write.deposit({ value: parseEther("100"), account: owner.account });
    await usdc.write.transfer([user1.account.address, parseEther("50")], { account: owner.account });

    const mockTcgv = await viem.deployContract("contracts/test/MockTCGVPresale.sol:MockTCGVPresale", [], { client: { wallet: owner } });
    tcgv = await viem.getContractAt("MockTCGVPresale", mockTcgv.address);

    nexus = await viem.deployContract("TCGNexusToken", [owner.account.address], { client: { wallet: owner } });

    founderNFT = await viem.deployContract("TCGVaultFounderNFT", [
      usdc.address,
      nexus.address,
      owner.account.address,
    ], { client: { wallet: owner } });
    initialLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
      tcgv.address,
      usdc.address,
      founderNFT.address,
      nexus.address,
      owner.account.address,
    ], { client: { wallet: owner } });

    await tcgv.write.setPresaleFinalizer([initialLaunch.address], { account: owner.account });
    await nexus.write.setPresaleMinter([founderNFT.address, true], { account: owner.account });
    await nexus.write.setPresaleMinter([initialLaunch.address, true], { account: owner.account });
  });

  describe("TCGVaultFounderNFT", () => {
    it("Founder NFT getters return correct values", async () => {
      expect(getAddress((await founderNFT.read.usdc()) as `0x${string}`)).to.equal(getAddress(usdc.address));
      expect(getAddress((await founderNFT.read.nexusToken()) as `0x${string}`)).to.equal(getAddress(nexus.address));
      expect(await founderNFT.read.nextTokenId()).to.be.a("bigint");
      expect(await founderNFT.read.wave2StartTimestamp()).to.equal(0n);
      expect(getAddress((await founderNFT.read.treasury()) as `0x${string}`)).to.equal(getAddress(owner.account.address));
      expect(await founderNFT.read.ownerWave1Mints()).to.equal(0n);
      expect(await founderNFT.read.ownerWave2Mints()).to.equal(0n);
      expect(await founderNFT.read.soldCount()).to.equal(await founderNFT.read.nextTokenId());
      expect(await founderNFT.read.currentWave()).to.equal(1n);
      expect(await founderNFT.read.currentPrice()).to.equal(BigInt(WAVE1_PRICE));
    });
    it("wave 1: first mint at 200 USDC, buyer gets 30% NEXUS", async () => {
      await usdc.write.approve([founderNFT.address, BigInt(WAVE1_PRICE)], { account: user1.account });
      const nexusBefore = (await nexus.read.balanceOf([user1.account.address]));
      await founderNFT.write.mint({ account: user1.account });
      const nexusAfter = (await nexus.read.balanceOf([user1.account.address]));
      const expectedNexus = (BigInt(WAVE1_PRICE) * 3000n * (10n ** 18n)) / (10000n * (10n ** 6n));
      expect(nexusAfter - nexusBefore).to.equal(expectedNexus);
      expect(await founderNFT.read.currentWave()).to.equal(1n);
    });

    it(
      "after 250 mints wave2StartTimestamp is set and wave 2 price is 350 USDC",
      { timeout: 120000 },
      async () => {
      await sellOutWave1Founder();
      expect(await founderNFT.read.soldCount()).to.equal(250n);
        const wave2Start = (await founderNFT.read.wave2StartTimestamp());
        expect(wave2Start > 0n).to.equal(true);
      expect(await founderNFT.read.currentPrice()).to.equal(BigInt(WAVE2_PRICE));
      expect(await founderNFT.read.currentWave()).to.equal(2n);
      }
    );

    it("owner can setBaseURI and tokenURI returns base + tokenId", async () => {
      await founderNFT.write.setBaseURI(["https://api.tcg-vault.io/founder/"], { account: owner.account });
      const uri = (await founderNFT.read.tokenURI([0n])) as string;
      expect(uri).to.equal("https://api.tcg-vault.io/founder/0");
    });

    it("owner can setTreasury", async () => {
      await founderNFT.write.setTreasury([user1.account.address], { account: owner.account });
      expect(getAddress((await founderNFT.read.treasury()) as `0x${string}`)).to.equal(getAddress(user1.account.address));
    });

    it("setTreasury reverts when not owner", async () => {
      await expectRevert(
        founderNFT.write.setTreasury([user1.account.address], { account: user1.account })
      );
    });

    it("constructor reverts when nexus is zero", async () => {
      await expectRevert(
        viem.deployContract("TCGVaultFounderNFT", [
          usdc.address,
          "0x0000000000000000000000000000000000000000",
          owner.account.address,
        ], { client: { wallet: owner } })
      );
    });

    it("constructor reverts when treasury is zero", async () => {
      await expectRevert(
        viem.deployContract("TCGVaultFounderNFT", [
          usdc.address,
          nexus.address,
          "0x0000000000000000000000000000000000000000",
        ], { client: { wallet: owner } })
      );
    });

    it("setTreasury reverts when treasury is zero", async () => {
      await viem.assertions.revertWithCustomError(
        founderNFT.write.setTreasury(["0x0000000000000000000000000000000000000000"], { account: owner.account }),
        founderNFT,
        "ZeroAddress"
      );
    });

    it("setBaseURI reverts when not owner", async () => {
      await expectRevert(
        founderNFT.write.setBaseURI(["https://bad/"], { account: user1.account })
      );
    });

    it("mint reverts ExceedsSupply when 500 sold", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      const user1Amount = BigInt(245 * WAVE1_PRICE + 245 * WAVE2_PRICE);
      await usdc.write.transfer([user1.account.address, user1Amount], { account: owner.account });
      await usdc.write.approve([freshFounder.address, user1Amount], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      const ownerAmount = BigInt(5 * WAVE1_PRICE + 5 * WAVE2_PRICE);
      await usdc.write.approve([freshFounder.address, ownerAmount], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      expect(await freshFounder.read.soldCount()).to.equal(500n);
      await expectRevert(freshFounder.write.mint({ account: user1.account }));
    });
    it("owner cannot mint more than 5 NFTs in wave 1", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });

      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });

      const bigApprove = 10n ** 24n;
      await usdc.write.approve([freshFounder.address, bigApprove], { account: owner.account });

      // Owner can mint exactly 5 in wave 1
      for (let i = 0; i < 5; i++) {
        await freshFounder.write.mint({ account: owner.account });
      }
      // 6th owner mint in wave 1 reverts
      await expectRevert(
        freshFounder.write.mint({ account: owner.account })
      );
    });

    it("owner cannot mint more than 5 NFTs in wave 2", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      const user1Amount = BigInt(245 * WAVE1_PRICE + 245 * WAVE2_PRICE);
      await usdc.write.transfer([user1.account.address, user1Amount], { account: owner.account });
      await usdc.write.approve([freshFounder.address, user1Amount], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      await usdc.write.approve([freshFounder.address, BigInt(5 * WAVE1_PRICE)], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      await usdc.write.approve([freshFounder.address, BigInt(5 * WAVE2_PRICE)], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      await expectRevert(freshFounder.write.mint({ account: owner.account }));
    });
    it("ReservedForOwner: non-owner cannot mint when only owner quota left in wave 1", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      await usdc.write.approve([freshFounder.address, BigInt(246 * WAVE1_PRICE)], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      await expectRevert(freshFounder.write.mint({ account: user1.account }));
    });

    it("ReservedForOwner: non-owner cannot mint in wave 2 when only owner quota left", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      const user1Wave1 = BigInt(245 * WAVE1_PRICE);
      const user1Wave2 = BigInt(245 * WAVE2_PRICE);
      await usdc.write.transfer([user1.account.address, user1Wave1 + user1Wave2], { account: owner.account });
      await usdc.write.approve([freshFounder.address, user1Wave1 + user1Wave2], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      const ownerWave1 = BigInt(5 * WAVE1_PRICE);
      await usdc.write.approve([freshFounder.address, ownerWave1], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      expect(await freshFounder.read.soldCount()).to.equal(495n);
      expect(await freshFounder.read.currentWave()).to.equal(2n);
      await expectRevert(freshFounder.write.mint({ account: user1.account }));
    });
  });

  describe("TCGVaultInitialLaunch", () => {
    it("InitialLaunch getters return correct values", async () => {
      expect(getAddress((await initialLaunch.read.tcgv()) as `0x${string}`)).to.equal(getAddress(tcgv.address));
      expect(getAddress((await initialLaunch.read.usdc()) as `0x${string}`)).to.equal(getAddress(usdc.address));
      expect(getAddress((await initialLaunch.read.founderNFT()) as `0x${string}`)).to.equal(getAddress(founderNFT.address));
      expect(getAddress((await initialLaunch.read.nexusToken()) as `0x${string}`)).to.equal(getAddress(nexus.address));
      expect(await initialLaunch.read.totalTCGVAllocated()).to.be.a("bigint");
      expect(await initialLaunch.read.tgeTimestamp()).to.be.a("bigint");
      expect(getAddress((await initialLaunch.read.treasury()) as `0x${string}`)).to.equal(getAddress(owner.account.address));
      const [alloc, claimed] = await initialLaunch.read.allocations([user1.account.address]);
      expect(alloc).to.be.a("bigint");
      expect(claimed).to.be.a("bigint");
      expect(await initialLaunch.read.currentPrice()).to.be.a("bigint");
      expect(await initialLaunch.read.maxPerWallet()).to.be.a("bigint");
    });
    it("buy reverts when usdcAmount is zero", async () => {
      await expectRevert(initialLaunch.write.buy([0n], { account: user1.account }));
    });

    it("wave 2: price 0.008 USDC/TCGV, 4% cap per wallet, 30% NEXUS on buy", async () => {
      // Ensure Founder wave 1 is fully sold so InitialLaunch uses wave 2 price
      await sellOutWave1Founder();
      // Use 8 USDC so 10% TGE fits in contract's 1000 TCGV for finalize/claim test
      const usdcAmount = 8 * 1e6;
      await usdc.write.approve([initialLaunch.address, BigInt(usdcAmount)], { account: user1.account });
      const nexusBefore = (await nexus.read.balanceOf([user1.account.address]));
      await initialLaunch.write.buy([BigInt(usdcAmount)], { account: user1.account });
      const nexusAfter = (await nexus.read.balanceOf([user1.account.address]));
      const expectedNexus = (BigInt(usdcAmount) * 3000n * (10n ** 18n)) / (10000n * (10n ** 6n));
      expect(nexusAfter - nexusBefore).to.equal(expectedNexus);
      const u = (await initialLaunch.read.allocations([user1.account.address])) as readonly [bigint, bigint];
      // 0.008 USDC/TCGV => price = 8000 (6 decimals), tcgvAmount = usdcAmount * 1e18 / 8000
      expect(u[0]).to.equal((BigInt(usdcAmount) * (10n ** 18n)) / 8000n);
    });

    it("non-owner cannot finalize before 120h countdown or hard cap", async (t) => {
      const endTime = await initialLaunch.read.presaleEndTime();
      if (endTime === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) {
        return t.skip();
      }
      if (await initialLaunch.read.tgeTimestamp() !== 0n) {
        return t.skip();
      }
      await expectRevert(initialLaunch.write.finalize({ account: user1.account }));
    });

    it("buy reverts after 120h countdown", async (t) => {
      // Ensure wave2StartTimestamp is set (250 Founder NFTs sold)
      await sellOutWave1Founder();
      const endTime = await initialLaunch.read.presaleEndTime();
      if (endTime === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) {
        return t.skip();
      }
      await networkHelpers.time.increase(121 * 3600);
      await networkHelpers.mine();
      await usdc.write.approve([initialLaunch.address, BigInt(1000 * 1e6)], { account: user1.account });
      await expectRevert(initialLaunch.write.buy([BigInt(1000 * 1e6)], { account: user1.account }));
    });

    it("buy reverts PresaleEnded when presale is already finalized", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      await usdc.write.approve([freshFounder.address, BigInt(245 * WAVE1_PRICE)], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      await usdc.write.approve([freshFounder.address, BigInt(5 * WAVE1_PRICE)], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      const freshLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        freshFounder.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await tcgv.write.setPresaleFinalizer([freshLaunch.address], { account: owner.account });
      await nexus.write.setPresaleMinter([freshLaunch.address, true], { account: owner.account });
      await usdc.write.approve([freshLaunch.address, BigInt(8 * 1e6)], { account: user1.account });
      await freshLaunch.write.buy([BigInt(8 * 1e6)], { account: user1.account });
      await networkHelpers.time.increase(121 * 3600);
      await networkHelpers.mine();
      await freshLaunch.write.finalize({ account: owner.account });
      await usdc.write.approve([freshLaunch.address, BigInt(1000 * 1e6)], { account: user1.account });
      await viem.assertions.revertWithCustomError(
        freshLaunch.write.buy([BigInt(1000 * 1e6)], { account: user1.account }),
        freshLaunch,
        "PresaleEnded"
      );
      await tcgv.write.setPresaleFinalizer([initialLaunch.address], { account: owner.account });
    });

    it("finalize and claim vesting 10% TGE", async () => {
      // Ensure countdown has ended: sell 250 Founder NFTs and advance time
      await sellOutWave1Founder();
      await networkHelpers.time.increase(121 * 3600);
      await networkHelpers.mine();
      await initialLaunch.write.finalize({ account: owner.account });
      const releasable = (await initialLaunch.read.releasable([user1.account.address]));
      const allocation = (await initialLaunch.read.allocations([user1.account.address])) as readonly [bigint, bigint];
      expect(releasable).to.equal((allocation[0] * 10n) / 100n);
      await initialLaunch.write.claim({ account: user1.account });
      expect(await tcgv.read.balanceOf([user1.account.address])).to.equal(releasable);
    });

    it("owner can setTreasury on InitialLaunch", async () => {
      await initialLaunch.write.setTreasury([user1.account.address], { account: owner.account });
      expect(getAddress((await initialLaunch.read.treasury()) as `0x${string}`)).to.equal(getAddress(user1.account.address));
    });

    it("InitialLaunch setTreasury reverts when not owner", async () => {
      await expectRevert(
        initialLaunch.write.setTreasury([user1.account.address], { account: user1.account })
      );
    });

    it("InitialLaunch constructor reverts when nexus is zero", async () => {
      await expectRevert(
        viem.deployContract("TCGVaultInitialLaunch", [
          tcgv.address,
          usdc.address,
          founderNFT.address,
          "0x0000000000000000000000000000000000000000",
          owner.account.address,
        ], { client: { wallet: owner } })
      );
    });

    it("finalize reverts PresaleNotEnded when called before 120h countdown", async () => {
      await sellOutWave1Founder();
      const endTime = await initialLaunch.read.presaleEndTime();
      if (endTime === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) return;
      await expectRevert(initialLaunch.write.finalize({ account: owner.account }));
    });

    it("buy reverts ExceedsHardCap when total TCGV would exceed hard cap", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      await usdc.write.approve([freshFounder.address, BigInt(245 * WAVE1_PRICE)], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      await usdc.write.approve([freshFounder.address, BigInt(5 * WAVE1_PRICE)], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      const freshLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        freshFounder.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await tcgv.write.setPresaleFinalizer([freshLaunch.address], { account: owner.account });
      await nexus.write.setPresaleMinter([freshLaunch.address, true], { account: owner.account });
      const price = await freshLaunch.read.currentPrice();
      const HARD_CAP_TCGV = 600_000_000n * (10n ** 18n);
      const usdcToExceedCap = (HARD_CAP_TCGV * price) / (10n ** 18n) + 1n;
      await usdc.write.transfer([user1.account.address, usdcToExceedCap], { account: owner.account });
      await usdc.write.approve([freshLaunch.address, usdcToExceedCap], { account: user1.account });
      await viem.assertions.revertWithCustomError(
        freshLaunch.write.buy([usdcToExceedCap], { account: user1.account }),
        freshLaunch,
        "ExceedsHardCap"
      );
      await tcgv.write.setPresaleFinalizer([initialLaunch.address], { account: owner.account });
    });

    it("releasable returns total - claimed when monthsElapsed >= 9 (full vesting)", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      await usdc.write.approve([freshFounder.address, BigInt(245 * WAVE1_PRICE)], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      await usdc.write.approve([freshFounder.address, BigInt(5 * WAVE1_PRICE)], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      const freshLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        freshFounder.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await tcgv.write.setPresaleFinalizer([freshLaunch.address], { account: owner.account });
      await nexus.write.setPresaleMinter([freshLaunch.address, true], { account: owner.account });
      const usdcAmount = 8 * 1e6;
      await usdc.write.approve([freshLaunch.address, BigInt(usdcAmount)], { account: user1.account });
      await freshLaunch.write.buy([BigInt(usdcAmount)], { account: user1.account });
      await networkHelpers.time.increase(121 * 3600);
      await networkHelpers.mine();
      await freshLaunch.write.finalize({ account: owner.account });
      const allocation = (await freshLaunch.read.allocations([user1.account.address])) as readonly [bigint, bigint];
      const total = allocation[0];
      const NINE_MONTHS = 9 * 30 * 24 * 3600;
      await networkHelpers.time.increase(NINE_MONTHS);
      await networkHelpers.mine();
      const releasableFull = await freshLaunch.read.releasable([user1.account.address]);
      expect(releasableFull).to.equal(total);
      await tcgv.write.setPresaleFinalizer([initialLaunch.address], { account: owner.account });
    });

    it("releasable vesting path: vested and return when monthsElapsed < 9", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      await usdc.write.approve([freshFounder.address, BigInt(245 * WAVE1_PRICE)], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      await usdc.write.approve([freshFounder.address, BigInt(5 * WAVE1_PRICE)], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      const freshLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        freshFounder.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await tcgv.write.setPresaleFinalizer([freshLaunch.address], { account: owner.account });
      await nexus.write.setPresaleMinter([freshLaunch.address, true], { account: owner.account });
      const usdcAmount = 8 * 1e6;
      await usdc.write.approve([freshLaunch.address, BigInt(usdcAmount)], { account: user1.account });
      await freshLaunch.write.buy([BigInt(usdcAmount)], { account: user1.account });
      await networkHelpers.time.increase(121 * 3600);
      await networkHelpers.mine();
      await freshLaunch.write.finalize({ account: owner.account });
      const allocation = (await freshLaunch.read.allocations([user1.account.address])) as readonly [bigint, bigint];
      const total = allocation[0];
      const EIGHT_MONTHS = 8 * 30 * 24 * 3600;
      await networkHelpers.time.increase(EIGHT_MONTHS);
      await networkHelpers.mine();
      const releasable8m = await freshLaunch.read.releasable([user1.account.address]);
      const expectedVested = (total * (10n + 8n * 10n)) / 100n;
      expect(releasable8m).to.equal(expectedVested);
      await tcgv.write.setPresaleFinalizer([initialLaunch.address], { account: owner.account });
    });

    it("releasable never exceeds total at any month 0..10", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      await usdc.write.approve([freshFounder.address, BigInt(245 * WAVE1_PRICE)], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      await usdc.write.approve([freshFounder.address, BigInt(5 * WAVE1_PRICE)], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      const freshLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        freshFounder.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await tcgv.write.setPresaleFinalizer([freshLaunch.address], { account: owner.account });
      await nexus.write.setPresaleMinter([freshLaunch.address, true], { account: owner.account });
      const usdcAmount = 8 * 1e6;
      await usdc.write.approve([freshLaunch.address, BigInt(usdcAmount)], { account: user1.account });
      await freshLaunch.write.buy([BigInt(usdcAmount)], { account: user1.account });
      await networkHelpers.time.increase(121 * 3600);
      await networkHelpers.mine();
      await freshLaunch.write.finalize({ account: owner.account });
      const allocation = (await freshLaunch.read.allocations([user1.account.address])) as readonly [bigint, bigint];
      const total = allocation[0];
      const thirtyDays = 30 * 24 * 3600;
      for (let months = 0; months <= 10; months++) {
        if (months > 0) {
          await networkHelpers.time.increase(thirtyDays);
          await networkHelpers.mine();
        }
        const r = await freshLaunch.read.releasable([user1.account.address]);
        expect(r <= total).to.equal(true);
      }
      await tcgv.write.setPresaleFinalizer([initialLaunch.address], { account: owner.account });
    });

    it("releasable returns 0 after user claimed all", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      await usdc.write.approve([freshFounder.address, BigInt(245 * WAVE1_PRICE)], { account: user1.account });
      for (let i = 0; i < 245; i++) await freshFounder.write.mint({ account: user1.account });
      await usdc.write.approve([freshFounder.address, BigInt(5 * WAVE1_PRICE)], { account: owner.account });
      for (let i = 0; i < 5; i++) await freshFounder.write.mint({ account: owner.account });
      const freshLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        freshFounder.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await tcgv.write.setPresaleFinalizer([freshLaunch.address], { account: owner.account });
      await nexus.write.setPresaleMinter([freshLaunch.address, true], { account: owner.account });
      const usdcAmount = 8 * 1e6;
      await usdc.write.approve([freshLaunch.address, BigInt(usdcAmount)], { account: user1.account });
      await freshLaunch.write.buy([BigInt(usdcAmount)], { account: user1.account });
      await networkHelpers.time.increase(121 * 3600);
      await networkHelpers.mine();
      await freshLaunch.write.finalize({ account: owner.account });
      const releasableBefore = await freshLaunch.read.releasable([user1.account.address]);
      if (releasableBefore > 0n) await freshLaunch.write.claim({ account: user1.account });
      expect(await freshLaunch.read.releasable([user1.account.address])).to.equal(0n);
      await tcgv.write.setPresaleFinalizer([initialLaunch.address], { account: owner.account });
    });

    it("presaleEndTime returns max when wave2 not started", async () => {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      const launchNoWave2 = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        freshFounder.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      const end = await launchNoWave2.read.presaleEndTime();
      expect(end).to.equal(BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"));
    });

    it("releasable returns 0 for user with no allocation", async () => {
      const [, , u2] = await viem.getWalletClients();
      const r = await initialLaunch.read.releasable([u2.account.address]);
      expect(r).to.equal(0n);
    });

    it("claim reverts when nothing to claim", async () => {
      const [, , u2] = await viem.getWalletClients();
      await expectRevert(initialLaunch.write.claim({ account: u2.account }));
    });

    it("claim reverts when not finalized", async () => {
      const launchNoFinalize = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        founderNFT.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await viem.assertions.revertWithCustomError(
        launchNoFinalize.write.claim({ account: user1.account }),
        launchNoFinalize,
        "NotFinalized"
      );
    });

    it("buy reverts ExceedsWalletCap when allocation would exceed maxPerWallet", async function () {
      const freshFounder = await viem.deployContract("TCGVaultFounderNFT", [
        usdc.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await nexus.write.setPresaleMinter([freshFounder.address, true], { account: owner.account });
      const wave1Cap = 250;
      const nonOwnerMints = 245;
      const ownerMints = 5;
      await usdc.write.approve([freshFounder.address, BigInt(nonOwnerMints * WAVE1_PRICE)], { account: user1.account });
      for (let i = 0; i < nonOwnerMints; i++) await freshFounder.write.mint({ account: user1.account });
      await usdc.write.approve([freshFounder.address, BigInt(ownerMints * WAVE1_PRICE)], { account: owner.account });
      for (let i = 0; i < ownerMints; i++) await freshFounder.write.mint({ account: owner.account });
      const freshLaunch = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        freshFounder.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      await tcgv.write.setPresaleFinalizer([freshLaunch.address], { account: owner.account });
      await nexus.write.setPresaleMinter([freshLaunch.address, true], { account: owner.account });
      const maxPerWallet = await freshLaunch.read.maxPerWallet();
      const price = await freshLaunch.read.currentPrice();
      const usdcForFullCap = (maxPerWallet * price) / (10n ** 18n);
      await usdc.write.transfer([user1.account.address, usdcForFullCap + 10n ** 6n], { account: owner.account });
      await usdc.write.approve([freshLaunch.address, usdcForFullCap + 10n ** 6n], { account: user1.account });
      await freshLaunch.write.buy([10n ** 6n], { account: user1.account });
      await expectRevert(freshLaunch.write.buy([usdcForFullCap], { account: user1.account }));
      await tcgv.write.setPresaleFinalizer([initialLaunch.address], { account: owner.account });
    });

    it("releasable returns 0 when not finalized", async () => {
      const launchNoFinalize = await viem.deployContract("TCGVaultInitialLaunch", [
        tcgv.address,
        usdc.address,
        founderNFT.address,
        nexus.address,
        owner.account.address,
      ], { client: { wallet: owner } });
      expect(await launchNoFinalize.read.releasable([user1.account.address])).to.equal(0n);
    });

    it("claim reverts NothingToClaim when releasable is 0", async () => {
      const [, , u2] = await viem.getWalletClients();
      await viem.assertions.revertWithCustomError(
        initialLaunch.write.claim({ account: u2.account }),
        initialLaunch,
        "NothingToClaim"
      );
    });
  });
});
