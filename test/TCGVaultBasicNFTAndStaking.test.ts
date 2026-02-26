/**
 * Tests for TCGVaultBasicNFT and TCGVaultStakingVault (whitepaper §7.2).
 */
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, getAddress } from "viem";

describe("TCGVaultBasicNFT + StakingVault", function () {
  let owner: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let user1: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[0];
  let tcgv: Awaited<ReturnType<typeof hre.viem.deployContract>>;
  let stakingVault: Awaited<ReturnType<typeof hre.viem.deployContract>>;
  let basicNFT: Awaited<ReturnType<typeof hre.viem.deployContract>>;

  const MIN_STAKE = parseEther("100");

  before(async function () {
    [owner, user1] = await hre.viem.getWalletClients();

    const mockTcgv = await hre.viem.deployContract("MockWETH", [], { account: owner.account });
    const tcgvAddress = mockTcgv.address as `0x${string}`;
    tcgv = await hre.viem.getContractAt("MockWETH", tcgvAddress);
    await tcgv.write.deposit({ value: parseEther("1000"), account: owner.account });
    await tcgv.write.transfer([user1.account.address, parseEther("500")], { account: owner.account });

    stakingVault = await hre.viem.deployContract("TCGVaultStakingVault", [tcgvAddress], { account: owner.account });
    await stakingVault.write.setMinStakeForBasicNFT([MIN_STAKE], { account: owner.account });

    basicNFT = await hre.viem.deployContract("TCGVaultBasicNFT", [stakingVault.address as `0x${string}`], { account: owner.account });
    await stakingVault.write.setBasicNFTContract([basicNFT.address], { account: owner.account });
  });

  describe("TCGVaultStakingVault", function () {
    it("owner can set minStakeForBasicNFT and basicNFTContract", async function () {
      expect(await stakingVault.read.minStakeForBasicNFT()).to.equal(MIN_STAKE);
      expect(getAddress(await stakingVault.read.basicNFTContract())).to.equal(getAddress(basicNFT.address));
    });

    it("setMinStakeForBasicNFT reverts when not owner", async function () {
      await expect(stakingVault.write.setMinStakeForBasicNFT([parseEther("50")], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("setBasicNFTContract reverts when not owner", async function () {
      await expect(stakingVault.write.setBasicNFTContract([basicNFT.address], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("withdraw keeping balance >= minStake does not burn Basic NFT", async function () {
      const stakeAmt = parseEther("300");
      await tcgv.write.approve([stakingVault.address, stakeAmt], { account: user1.account });
      await stakingVault.write.deposit([stakeAmt, user1.account.address], { account: user1.account });
      await basicNFT.write.mint({ account: user1.account });
      expect(await basicNFT.read.ownerToTokenId([user1.account.address])).to.not.equal(0n);
      const shares = await stakingVault.read.balanceOf([user1.account.address]);
      const redeemShares = shares - MIN_STAKE;
      if (redeemShares > 0n) {
        await stakingVault.write.redeem([redeemShares, user1.account.address, user1.account.address], { account: user1.account });
      }
      expect(await basicNFT.read.ownerToTokenId([user1.account.address])).to.not.equal(0n);
    });

    it("deposit and withdraw", async function () {
      const depositAmount = parseEther("200");
      await tcgv.write.approve([stakingVault.address, depositAmount], { account: user1.account });
      await stakingVault.write.deposit([depositAmount, user1.account.address], { account: user1.account });
      const shares = await stakingVault.read.balanceOf([user1.account.address]);
      expect(shares).to.be.gt(0n);
      await stakingVault.write.redeem([shares, user1.account.address, user1.account.address], { account: user1.account });
      expect(await stakingVault.read.balanceOf([user1.account.address])).to.equal(0n);
    });
  });

  describe("TCGVaultBasicNFT", function () {
    it("minStakeRequired returns staking vault min", async function () {
      expect(await basicNFT.read.minStakeRequired()).to.equal(MIN_STAKE);
    });

    it("mint reverts without enough stake", async function () {
      await expect(basicNFT.write.mint({ account: user1.account })).to.be.rejectedWith(/InsufficientStake|revert/);
    });

    it("mint succeeds with enough stake", async function () {
      const stakeAmount = parseEther("200");
      await tcgv.write.approve([stakingVault.address, stakeAmount], { account: user1.account });
      await stakingVault.write.deposit([stakeAmount, user1.account.address], { account: user1.account });
      const nextBefore = await basicNFT.read.nextTokenId();
      await basicNFT.write.mint({ account: user1.account });
      const tokenId = (await basicNFT.read.nextTokenId()) - 1n;
      expect(getAddress(await basicNFT.read.ownerOf([tokenId]))).to.equal(getAddress(user1.account.address));
      expect(await basicNFT.read.totalSupply()).to.equal(nextBefore + 1n);
      expect(await basicNFT.read.ownerToTokenId([user1.account.address])).to.equal(tokenId + 1n); // 1-based
    });

    it("mint reverts when already minted", async function () {
      await expect(basicNFT.write.mint({ account: user1.account })).to.be.rejectedWith(/AlreadyMinted|revert/);
    });

    it("tokenURI returns base + tokenId when baseURI set", async function () {
      await basicNFT.write.setBaseURI(["https://api.tcg-vault.io/basic/"], { account: owner.account });
      const totalSupply = await basicNFT.read.totalSupply();
      if (totalSupply === 0n) return this.skip();
      const tokenId = totalSupply - 1n;
      const uri = await basicNFT.read.tokenURI([tokenId]);
      expect(uri).to.equal(`https://api.tcg-vault.io/basic/${tokenId}`);
    });

    it("setBaseURI reverts when not owner", async function () {
      await expect(basicNFT.write.setBaseURI(["https://bad/"], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("setStakingVault reverts when not owner", async function () {
      await expect(basicNFT.write.setStakingVault([stakingVault.address], { account: user1.account })).to.be.rejectedWith(/Ownable|revert/);
    });

    it("burnAllFor reverts when caller is not staking vault", async function () {
      await expect(basicNFT.write.burnAllFor([user1.account.address], { account: owner.account })).to.be.rejectedWith(/OnlyStakingVault|revert/);
    });


    it("withdraw below min burns Basic NFT", async function () {
      const shares = await stakingVault.read.balanceOf([user1.account.address]);
      expect(shares).to.be.gte(MIN_STAKE);
      const tokenId = (await basicNFT.read.nextTokenId()) - 1n;
      await stakingVault.write.redeem([shares, user1.account.address, user1.account.address], { account: user1.account });
      expect(await stakingVault.read.balanceOf([user1.account.address])).to.equal(0n);
      await expect(basicNFT.read.ownerOf([tokenId])).to.be.rejected;
      expect(await basicNFT.read.ownerToTokenId([user1.account.address])).to.equal(0n);
    });

    it("owner can setStakingVault", async function () {
      await basicNFT.write.setStakingVault([stakingVault.address], { account: owner.account });
      expect(getAddress(await basicNFT.read.stakingVault())).to.equal(getAddress(stakingVault.address));
    });
  });
});
