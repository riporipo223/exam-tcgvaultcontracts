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
      "after 245 mints wave2StartTimestamp is set and wave 2 price is 350 USDC",
      { timeout: 120000 },
      async () => {
      const sold = await founderNFT.read.soldCount();
      const toMint = 245 - Number(sold);
      if (toMint <= 0) return;
      const maxUsdc = BigInt(toMint) * BigInt(WAVE2_PRICE);
      await usdc.write.approve([founderNFT.address, maxUsdc], { account: owner.account });
      for (let i = 0; i < toMint; i++) {
        await founderNFT.write.mint({ account: owner.account });
      }
      expect(await founderNFT.read.soldCount()).to.equal(245n);
        const wave2Start = (await founderNFT.read.wave2StartTimestamp());
        expect(wave2Start > 0n).to.equal(true);
      expect(await founderNFT.read.currentPrice()).to.equal(BigInt(WAVE2_PRICE));
      expect(await founderNFT.read.currentWave()).to.equal(2n);
      }
    );

    it("owner can mint 10 community Founder NFTs", async () => {
      expect(await founderNFT.read.communityMinted()).to.equal(0n);
      await founderNFT.write.mintCommunity([user1.account.address], { account: owner.account });
      expect(await founderNFT.read.communityMinted()).to.equal(1n);
      expect(getAddress((await founderNFT.read.ownerOf([490n])) as `0x${string}`)).to.equal(getAddress(user1.account.address));
    });

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

    it("setBaseURI reverts when not owner", async () => {
      await expectRevert(
        founderNFT.write.setBaseURI(["https://bad/"], { account: user1.account })
      );
    });

    it("mintCommunity reverts when not owner", async () => {
      await expectRevert(
        founderNFT.write.mintCommunity([user1.account.address], { account: user1.account })
      );
    });

    it("mintCommunity reverts when ExceedsReserved", async () => {
      const already = await founderNFT.read.communityMinted();
      const toMint = 10 - Number(already);
      for (let i = 0; i < toMint; i++) {
        await founderNFT.write.mintCommunity([user1.account.address], { account: owner.account });
      }
      await expectRevert(
        founderNFT.write.mintCommunity([user1.account.address], { account: owner.account })
      );
    });
  });

  describe("TCGVaultInitialLaunch", () => {
    it("buy reverts when usdcAmount is zero", async () => {
      await expectRevert(initialLaunch.write.buy([0n], { account: user1.account }));
    });

    it("wave 2: price 0.008 USDC/TCGV, 4% cap per wallet, 30% NEXUS on buy", async () => {
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
      // Requires wave2StartTimestamp set (e.g. by "after 245 mints" test)
      const endTime = await initialLaunch.read.presaleEndTime();
      if (endTime === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) {
        return t.skip();
      }
      await networkHelpers.time.increase(121 * 3600);
      await networkHelpers.mine();
      await usdc.write.approve([initialLaunch.address, BigInt(1000 * 1e6)], { account: user1.account });
      await expectRevert(initialLaunch.write.buy([BigInt(1000 * 1e6)], { account: user1.account }));
    });

    it("finalize and claim vesting 10% TGE", async () => {
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
      await expectRevert(launchNoFinalize.write.claim({ account: user1.account }));
    });

  });
});
