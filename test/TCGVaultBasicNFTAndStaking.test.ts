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
  let user3: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let user4: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let user5: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let tcgv: ContractReturnType<"contracts/test/MockTCGVStakingAsset.sol:MockTCGVStakingAsset">;
  let usdc: ContractReturnType<"contracts/test/MockUSDC.sol:MockUSDC">;
  let factory: ContractReturnType<"contracts/test/MockUniswapV2Factory.sol:MockUniswapV2Factory">;
  let pricingRouter: ContractReturnType<"contracts/test/MockBuyRouterForStaking.sol:MockBuyRouterForStaking">;
  let stakingVault: ContractReturnType<"TCGVaultStakingVault">;
  let basicNFT: ContractReturnType<"TCGVaultBasicNFT">;

  const MIN_STAKE = parseEther("100");
  const USDC_6 = 1_000_000n;

  before(async () => {
    [owner, user1, user2, user3, user4, user5] = await viem.getWalletClients();

    const mockTcgv = await viem.deployContract("contracts/test/MockTCGVStakingAsset.sol:MockTCGVStakingAsset", [
      owner.account.address,
    ], { client: { wallet: owner } });
    const tcgvAddress = mockTcgv.address;
    tcgv = await viem.getContractAt("contracts/test/MockTCGVStakingAsset.sol:MockTCGVStakingAsset", tcgvAddress);
    await tcgv.write.transfer([user1.account.address, parseEther("500")], { account: owner.account });
    await tcgv.write.transfer([user4.account.address, parseEther("500")], { account: owner.account });
    await tcgv.write.transfer([user5.account.address, parseEther("500")], { account: owner.account });

    stakingVault = await viem.deployContract("TCGVaultStakingVault", [tcgvAddress], { client: { wallet: owner } });
    await stakingVault.write.setRequiredStakeForBasicNFT([MIN_STAKE], { account: owner.account });

    basicNFT = await viem.deployContract("TCGVaultBasicNFT", [stakingVault.address], { client: { wallet: owner } });
    await stakingVault.write.setBasicNFTContract([basicNFT.address], { account: owner.account });

    usdc = await viem.deployContract("contracts/test/MockUSDC.sol:MockUSDC", [], { client: { wallet: owner } });
    factory = await viem.deployContract("contracts/test/MockUniswapV2Factory.sol:MockUniswapV2Factory", [], { client: { wallet: owner } });
    await factory.write.createPair([tcgv.address, usdc.address], { account: owner.account });
    const pairAddress = await factory.read.getPair([tcgv.address, usdc.address]) as `0x${string}`;
    const pair = await viem.getContractAt("contracts/test/MockUniswapV2Pair.sol:MockUniswapV2Pair", pairAddress);
    await tcgv.write.transfer([pairAddress, parseEther("10000")], { account: owner.account });
    await usdc.write.mint([pairAddress, 50_000n * USDC_6], { account: owner.account });
    await pair.write.sync({ account: owner.account });

    pricingRouter = await viem.deployContract("contracts/test/MockBuyRouterForStaking.sol:MockBuyRouterForStaking", [
      factory.address,
      usdc.address,
      tcgv.address,
    ], { client: { wallet: owner } });
  });

  describe("TCGVaultStakingVault", () => {
    it("owner can set requiredStakeForBasicNFT and basicNFTContract", async () => {
      expect(await stakingVault.read.requiredStakeForBasicNFT()).to.equal(MIN_STAKE);
      expect(getAddress((await stakingVault.read.basicNFTContract()) as `0x${string}`)).to.equal(getAddress(basicNFT.address));
    });

    it("setRequiredStakeForBasicNFT reverts when not owner", async () => {
      await expectRevert(
        stakingVault.write.setRequiredStakeForBasicNFT([parseEther("50")], { account: user1.account })
      );
    });

    it("setBasicNFTContract reverts when not owner", async () => {
      await expectRevert(
        stakingVault.write.setBasicNFTContract([basicNFT.address], { account: user1.account })
      );
    });

    it("deposit input amount is ignored; vault stakes to current requirement", async () => {
      await tcgv.write.approve([stakingVault.address, MIN_STAKE], { account: user4.account });
      await stakingVault.write.deposit([1n, user4.account.address], { account: user4.account });
      expect(await stakingVault.read.balanceOf([user4.account.address])).to.equal(MIN_STAKE);
      await stakingVault.write.redeem([1n, user4.account.address, user4.account.address], { account: user4.account });
    });

    it("deposit and withdraw", async () => {
      const depositAmount = MIN_STAKE;
      await tcgv.write.approve([stakingVault.address, depositAmount], { account: user1.account });
      await stakingVault.write.deposit([depositAmount, user1.account.address], { account: user1.account });
      const shares = (await stakingVault.read.balanceOf([user1.account.address]));
      expect(shares > 0n).to.equal(true);
      await stakingVault.write.redeem([shares, user1.account.address, user1.account.address], { account: user1.account });
      expect(await stakingVault.read.balanceOf([user1.account.address])).to.equal(0n);
    });

    it("redeem input amount is ignored and full-unstakes", async () => {
      const depositAmount = MIN_STAKE;
      await tcgv.write.approve([stakingVault.address, depositAmount], { account: user5.account });
      await stakingVault.write.deposit([depositAmount, user5.account.address], { account: user5.account });
      const shares = await stakingVault.read.balanceOf([user5.account.address]);
      await stakingVault.write.redeem([1n, user5.account.address, user5.account.address], { account: user5.account });
      expect(await stakingVault.read.balanceOf([user5.account.address])).to.equal(0n);
      expect(shares > 0n).to.equal(true);
    });

    it("redeem reverts when share owner is blacklisted on underlying asset", async () => {
      const depositAmount = MIN_STAKE;
      await tcgv.write.approve([stakingVault.address, depositAmount], { account: user4.account });
      await stakingVault.write.deposit([depositAmount, user4.account.address], { account: user4.account });
      const shares = await stakingVault.read.balanceOf([user4.account.address]);
      await tcgv.write.setBlacklisted([user4.account.address, true], { account: owner.account });
      await expectRevert(
        stakingVault.write.redeem([shares, user4.account.address, user4.account.address], { account: user4.account })
      );
      await tcgv.write.setBlacklisted([user4.account.address, false], { account: owner.account });
      await stakingVault.write.redeem([shares, user4.account.address, user4.account.address], { account: user4.account });
    });

    it("reverts deposits when required stake is not configured", async () => {
      const freshVault = await viem.deployContract("TCGVaultStakingVault", [tcgv.address], { client: { wallet: owner } });
      const stakeTry = parseEther("1");
      await tcgv.write.approve([freshVault.address, stakeTry], { account: user1.account });
      await expectRevert(
        freshVault.write.deposit([stakeTry, user1.account.address], { account: user1.account })
      );
    });
  });

  describe("TCGVaultBasicNFT", () => {
    it("requiredStake returns staking vault requirement", async () => {
      expect(await basicNFT.read.requiredStake()).to.equal(MIN_STAKE);
    });

    it("deposit below exact threshold reverts", async () => {
      await tcgv.write.transfer([user2.account.address, parseEther("50")], { account: owner.account });
      await tcgv.write.approve([stakingVault.address, parseEther("50")], { account: user2.account });
      await expectRevert(
        stakingVault.write.deposit([parseEther("50"), user2.account.address], { account: user2.account })
      );
    });

    it("deposit with enough stake auto-mints Basic NFT", async () => {
      await tcgv.write.transfer([user2.account.address, MIN_STAKE], { account: owner.account });
      await tcgv.write.approve([stakingVault.address, MIN_STAKE], { account: user2.account });
      const totalSupplyBefore = await basicNFT.read.totalSupply();
      const totalMintedBefore = await basicNFT.read.totalMinted();
      await stakingVault.write.deposit([MIN_STAKE, user2.account.address], { account: user2.account });
      const tokenId = (await basicNFT.read.nextTokenId()) - 1n;
      expect(getAddress((await basicNFT.read.ownerOf([tokenId])) as `0x${string}`)).to.equal(getAddress(user2.account.address));
      expect(await basicNFT.read.totalSupply()).to.equal(totalSupplyBefore + 1n);
      expect(await basicNFT.read.totalMinted()).to.equal(totalMintedBefore + 1n);
      expect(await basicNFT.read.ownerToTokenId([user2.account.address])).to.equal(tokenId + 1n); // 1-based
    });

    it("second deposit when already staked exact amount reverts", async () => {
      const nextBefore = await basicNFT.read.nextTokenId();
      await tcgv.write.transfer([user2.account.address, parseEther("100")], { account: owner.account });
      await tcgv.write.approve([stakingVault.address, parseEther("100")], { account: user2.account });
      await expectRevert(
        stakingVault.write.deposit([parseEther("100"), user2.account.address], { account: user2.account })
      );
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

    it("full unstake burns Basic NFT", async () => {
      const shares = (await stakingVault.read.balanceOf([user2.account.address]));
      expect(shares >= MIN_STAKE).to.equal(true);
      const tokenId = (await basicNFT.read.nextTokenId()) - 1n;
      const totalSupplyBefore = await basicNFT.read.totalSupply();
      const totalMintedBefore = await basicNFT.read.totalMinted();
      await stakingVault.write.redeem([shares, user2.account.address, user2.account.address], {
        account: user2.account,
      });
      expect(await stakingVault.read.balanceOf([user2.account.address])).to.equal(0n);
      await expectRevert(basicNFT.read.ownerOf([tokenId]));
      expect(await basicNFT.read.ownerToTokenId([user2.account.address])).to.equal(0n);
      expect(await basicNFT.read.totalSupply()).to.equal(totalSupplyBefore - 1n);
      expect(await basicNFT.read.totalMinted()).to.equal(totalMintedBefore);
    });

    it("owner can setStakingVault", async () => {
      await basicNFT.write.setStakingVault([stakingVault.address], { account: owner.account });
      expect(getAddress((await basicNFT.read.stakingVault()) as `0x${string}`)).to.equal(getAddress(stakingVault.address));
    });

    it("uses dynamic 25 USDC threshold from buy-router pool pricing", async () => {
      await (stakingVault.write as any).setBasicNFTPricingRouter([pricingRouter.address], { account: owner.account });

      const dynamicMinStake = await stakingVault.read.requiredStakeForBasicNFT();
      expect(dynamicMinStake).to.equal(parseEther("5")); // pool price = 5 USDC/TCGV => 25 USDC == 5 TCGV

      const depositAmount = dynamicMinStake;
      await tcgv.write.transfer([user3.account.address, depositAmount], { account: owner.account });
      await tcgv.write.approve([stakingVault.address, depositAmount], { account: user3.account });
      await stakingVault.write.deposit([depositAmount, user3.account.address], { account: user3.account });
      expect(await basicNFT.read.ownerToTokenId([user3.account.address])).to.not.equal(0n);
    });
  });
});
