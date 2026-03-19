/**
 * Tests for TCGVaultBasicNFT and TCGVaultStakingVault (whitepaper §7.2).
 */
import { describe, it, before } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, getAddress } from "viem";
import type { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";

const { viem } = await hre.network.connect();

async function expectRevert(promise: Promise<unknown>) {
  let reverted = false;
  try {
    await promise;
  } catch {
    reverted = true;
  }
  expect(reverted).to.equal(true);
}

describe("TCGVaultBasicNFT + StakingVault", () => {
  let owner: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let user1: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let user2: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let tcgv: ContractReturnType<"MockWETH">;
  let stakingVault: ContractReturnType<"TCGVaultStakingVault">;
  let basicNFT: ContractReturnType<"TCGVaultBasicNFT">;

  const MIN_STAKE = parseEther("100");

  before(async () => {
    [owner, user1, user2] = await viem.getWalletClients();

    const mockTcgv = await viem.deployContract("MockWETH", [], { client: { wallet: owner } });
    const tcgvAddress = mockTcgv.address;
    tcgv = await viem.getContractAt("MockWETH", tcgvAddress);
    await tcgv.write.deposit({ value: parseEther("1000"), account: owner.account });
    await tcgv.write.transfer([user1.account.address, parseEther("500")], { account: owner.account });

    stakingVault = await viem.deployContract("TCGVaultStakingVault", [tcgvAddress], { client: { wallet: owner } });
    await stakingVault.write.setMinStakeForBasicNFT([MIN_STAKE], { account: owner.account });

    basicNFT = await viem.deployContract("TCGVaultBasicNFT", [stakingVault.address], { client: { wallet: owner } });
    await stakingVault.write.setBasicNFTContract([basicNFT.address], { account: owner.account });
  });

  describe("TCGVaultStakingVault", () => {
    it("owner can set minStakeForBasicNFT and basicNFTContract", async () => {
      expect(await stakingVault.read.minStakeForBasicNFT()).to.equal(MIN_STAKE);
      expect(getAddress((await stakingVault.read.basicNFTContract()) as `0x${string}`)).to.equal(getAddress(basicNFT.address));
    });

    it("setMinStakeForBasicNFT reverts when not owner", async () => {
      await expectRevert(
        stakingVault.write.setMinStakeForBasicNFT([parseEther("50")], { account: user1.account })
      );
    });

    it("setBasicNFTContract reverts when not owner", async () => {
      await expectRevert(
        stakingVault.write.setBasicNFTContract([basicNFT.address], { account: user1.account })
      );
    });

    it("withdraw keeping balance >= minStake does not burn Basic NFT", async () => {
      const stakeAmt = parseEther("300");
      await tcgv.write.approve([stakingVault.address, stakeAmt], { account: user1.account });
      await stakingVault.write.deposit([stakeAmt, user1.account.address], { account: user1.account });
      expect(await basicNFT.read.ownerToTokenId([user1.account.address])).to.not.equal(0n);
      const shares = (await stakingVault.read.balanceOf([user1.account.address]));
      const redeemShares = shares - MIN_STAKE;
      if (redeemShares > 0n) {
        await stakingVault.write.redeem([redeemShares, user1.account.address, user1.account.address], { account: user1.account });
      }
      expect(await basicNFT.read.ownerToTokenId([user1.account.address])).to.not.equal(0n);
    });

    it("deposit and withdraw", async () => {
      const depositAmount = parseEther("200");
      await tcgv.write.approve([stakingVault.address, depositAmount], { account: user1.account });
      await stakingVault.write.deposit([depositAmount, user1.account.address], { account: user1.account });
      const shares = (await stakingVault.read.balanceOf([user1.account.address]));
      expect(shares > 0n).to.equal(true);
      await stakingVault.write.redeem([shares, user1.account.address, user1.account.address], { account: user1.account });
      expect(await stakingVault.read.balanceOf([user1.account.address])).to.equal(0n);
    });
  });

  describe("TCGVaultBasicNFT", () => {
    it("minStakeRequired returns staking vault min", async () => {
      expect(await basicNFT.read.minStakeRequired()).to.equal(MIN_STAKE);
    });

    it("deposit below min does not mint Basic NFT", async () => {
      await tcgv.write.transfer([user2.account.address, parseEther("50")], { account: owner.account });
      await tcgv.write.approve([stakingVault.address, parseEther("50")], { account: user2.account });
      await stakingVault.write.deposit([parseEther("50"), user2.account.address], { account: user2.account });
      expect(await basicNFT.read.ownerToTokenId([user2.account.address])).to.equal(0n);
    });

    it("deposit with enough stake auto-mints Basic NFT", async () => {
      await tcgv.write.transfer([user2.account.address, parseEther("200")], { account: owner.account });
      await tcgv.write.approve([stakingVault.address, parseEther("200")], { account: user2.account });
      const nextBefore = await basicNFT.read.nextTokenId();
      await stakingVault.write.deposit([parseEther("200"), user2.account.address], { account: user2.account });
      const tokenId = (await basicNFT.read.nextTokenId()) - 1n;
      expect(getAddress((await basicNFT.read.ownerOf([tokenId])) as `0x${string}`)).to.equal(getAddress(user2.account.address));
      expect(await basicNFT.read.totalSupply()).to.equal(nextBefore + 1n);
      expect(await basicNFT.read.ownerToTokenId([user2.account.address])).to.equal(tokenId + 1n); // 1-based
    });

    it("second deposit when already holding Basic NFT does not double-mint", async () => {
      const nextBefore = await basicNFT.read.nextTokenId();
      await tcgv.write.transfer([user2.account.address, parseEther("100")], { account: owner.account });
      await tcgv.write.approve([stakingVault.address, parseEther("100")], { account: user2.account });
      await stakingVault.write.deposit([parseEther("100"), user2.account.address], { account: user2.account });
      const nextAfter = await basicNFT.read.nextTokenId();
      expect(nextAfter).to.equal(nextBefore);
    });

    it("Basic NFT is soulbound (transfer reverts)", async () => {
      const tokenId = (await basicNFT.read.ownerToTokenId([user2.account.address])) - 1n;
      await expectRevert(
        basicNFT.write.transferFrom([user2.account.address, user1.account.address, tokenId], { account: user2.account })
      );
    });

    it("tokenURI returns base + tokenId when baseURI set", async (t) => {
      await basicNFT.write.setBaseURI(["https://api.tcg-vault.io/basic/"], { account: owner.account });
      const nextTokenId = (await basicNFT.read.nextTokenId());
      if (nextTokenId === 0n) return t.skip();
      const tokenId = nextTokenId - 1n;
      const uri = (await basicNFT.read.tokenURI([tokenId])) as string;
      expect(uri).to.equal(`https://api.tcg-vault.io/basic/${tokenId}`);
    });

    it("setBaseURI reverts when not owner", async () => {
      await expectRevert(
        basicNFT.write.setBaseURI(["https://bad/"], { account: user1.account })
      );
    });

    it("setStakingVault reverts when not owner", async () => {
      await expectRevert(
        basicNFT.write.setStakingVault([stakingVault.address], { account: user1.account })
      );
    });

    it("burnAllFor reverts when caller is not staking vault", async () => {
      await expectRevert(
        basicNFT.write.burnAllFor([user1.account.address], { account: owner.account })
      );
    });

    it("mintFor reverts OnlyStakingVault when caller is not staking vault", async () => {
      await expectRevert(
        basicNFT.write.mintFor([user1.account.address], { account: owner.account })
      );
    });

    it("mintFor is no-op when account stake is below min (only staking vault can call)", async () => {
      const mockStaking = await viem.deployContract("contracts/test/MockStakingForBasicNFT.sol:MockStakingForBasicNFT", [], { client: { wallet: owner } });
      await basicNFT.write.setStakingVault([mockStaking.address], { account: owner.account });
      const nextBefore = await basicNFT.read.nextTokenId();
      await mockStaking.write.triggerMintFor([basicNFT.address, user2.account.address], { account: owner.account });
      expect(await basicNFT.read.nextTokenId()).to.equal(nextBefore);
      await basicNFT.write.setStakingVault([stakingVault.address], { account: owner.account });
    });

    it("withdraw below min burns Basic NFT", async () => {
      const shares = (await stakingVault.read.balanceOf([user2.account.address]));
      expect(shares >= MIN_STAKE).to.equal(true);
      const tokenId = (await basicNFT.read.nextTokenId()) - 1n;
      await stakingVault.write.redeem([shares, user2.account.address, user2.account.address], {
        account: user2.account,
      });
      expect(await stakingVault.read.balanceOf([user2.account.address])).to.equal(0n);
      await expectRevert(basicNFT.read.ownerOf([tokenId]));
      expect(await basicNFT.read.ownerToTokenId([user2.account.address])).to.equal(0n);
    });

    it("owner can setStakingVault", async () => {
      await basicNFT.write.setStakingVault([stakingVault.address], { account: owner.account });
      expect(getAddress((await basicNFT.read.stakingVault()) as `0x${string}`)).to.equal(getAddress(stakingVault.address));
    });
  });
});
