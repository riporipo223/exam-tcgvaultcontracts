/**
 * Tests for TCGRToken: referral token soulbound, only minter can mint.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { parseEther, zeroAddress } from "viem";

const { viem, networkHelpers } = await hre.network.connect();

async function deployFixture() {
  const wallets = await viem.getWalletClients();
  const owner = wallets[0]!;
  const minter = wallets[1]!;
  const referrer = wallets[2]!;
  const tcgr = await viem.deployContract("TCGRToken", [minter.account.address], { client: { wallet: owner } });
  return { owner, minter, referrer, tcgr };
}

describe("TCGRToken", function () {
  it("constructor reverts when minter is zero", async function () {
    const wallets = await viem.getWalletClients();
    const owner = wallets[0]!;
    const { tcgr } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      viem.deployContract("TCGRToken", [zeroAddress], { client: { wallet: owner } }),
      tcgr,
      "ZeroAddress"
    );
  });

  it("has correct name and symbol", async function () {
    const { tcgr } = await networkHelpers.loadFixture(deployFixture);
    assert.strictEqual(await tcgr.read.name(), "TCG-Referral");
    assert.strictEqual(await tcgr.read.symbol(), "TCGR");
  });

  it("returns minter set at deployment", async function () {
    const { tcgr, minter } = await networkHelpers.loadFixture(deployFixture);
    assert.strictEqual((await tcgr.read.minter()).toLowerCase(), minter.account.address.toLowerCase());
  });

  it("only minter can call mintReferral", async function () {
    const { tcgr, minter, referrer, owner } = await networkHelpers.loadFixture(deployFixture);
    const amount = parseEther("100");
    await tcgr.write.mintReferral([referrer.account.address, amount], { account: minter.account });
    assert.strictEqual(await tcgr.read.balanceOf([referrer.account.address]), amount);

    await viem.assertions.revertWithCustomError(
      tcgr.write.mintReferral([referrer.account.address, amount], { account: owner.account }),
      tcgr,
      "OnlyMinter"
    );
  });

  it("setMinter updates minter and only owner can call", async function () {
    const { tcgr, owner, minter, referrer } = await networkHelpers.loadFixture(deployFixture);
    const newMinter = referrer;
    await tcgr.write.setMinter([newMinter.account.address], { account: owner.account });
    assert.strictEqual((await tcgr.read.minter()).toLowerCase(), newMinter.account.address.toLowerCase());

    const amount = parseEther("50");
    await tcgr.write.mintReferral([owner.account.address, amount], { account: newMinter.account });
    assert.strictEqual(await tcgr.read.balanceOf([owner.account.address]), amount);

    await viem.assertions.revertWithCustomError(
      tcgr.write.setMinter([newMinter.account.address], { account: minter.account }),
      tcgr,
      "OwnableUnauthorizedAccount"
    );
  });

  it("mintReferral does nothing when amount is zero", async function () {
    const { tcgr, minter, referrer } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.mintReferral([referrer.account.address, 0n], { account: minter.account });
    assert.strictEqual(await tcgr.read.balanceOf([referrer.account.address]), 0n);
  });

  it("mintReferral reverts when referrer is zero address", async function () {
    const { tcgr, minter } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      tcgr.write.mintReferral([zeroAddress, parseEther("1")], { account: minter.account }),
      tcgr,
      "ZeroAddress"
    );
  });

  it("is soulbound: transfer reverts", async function () {
    const { tcgr, minter, referrer, owner } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.mintReferral([referrer.account.address, parseEther("100")], { account: minter.account });
    await viem.assertions.revertWithCustomError(
      tcgr.write.transfer([owner.account.address, parseEther("10")], { account: referrer.account }),
      tcgr,
      "SoulboundTransferNotAllowed"
    );
  });

  it("is soulbound: transferFrom reverts", async function () {
    const { tcgr, minter, referrer, owner } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.mintReferral([referrer.account.address, parseEther("100")], { account: minter.account });
    await tcgr.write.approve([owner.account.address, parseEther("10")], { account: referrer.account });
    await viem.assertions.revertWithCustomError(
      tcgr.write.transferFrom([referrer.account.address, owner.account.address, parseEther("10")], { account: owner.account }),
      tcgr,
      "SoulboundTransferNotAllowed"
    );
  });

  it("setMinter reverts when new minter is zero", async function () {
    const { tcgr, owner } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      tcgr.write.setMinter([zeroAddress], { account: owner.account }),
      tcgr,
      "ZeroAddress"
    );
  });

  it("converter is zero by default", async function () {
    const { tcgr } = await networkHelpers.loadFixture(deployFixture);
    assert.strictEqual(await tcgr.read.converter(), zeroAddress);
  });

  it("converter() returns set converter address", async function () {
    const { tcgr, owner, referrer } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.setConverter([referrer.account.address], { account: owner.account });
    assert.strictEqual((await tcgr.read.converter()).toLowerCase(), referrer.account.address.toLowerCase());
  });

  it("burnFrom(account, 0) is no-op when called by converter", async function () {
    const { tcgr, owner, minter, referrer } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.mintReferral([referrer.account.address, parseEther("100")], { account: minter.account });
    const mockConverter = await viem.deployContract("contracts/test/MockTCGRConverter.sol:MockTCGRConverter", [], { client: { wallet: owner } });
    await tcgr.write.setConverter([mockConverter.address], { account: owner.account });
    await mockConverter.write.burnZero([tcgr.address, referrer.account.address], { account: owner.account });
    assert.strictEqual(await tcgr.read.balanceOf([referrer.account.address]), parseEther("100"));
  });

  it("burnFrom reverts ZeroAddress when account is zero (called by converter)", async function () {
    const { tcgr, owner } = await networkHelpers.loadFixture(deployFixture);
    const mockConverter = await viem.deployContract("contracts/test/MockTCGRConverter.sol:MockTCGRConverter", [], { client: { wallet: owner } });
    await tcgr.write.setConverter([mockConverter.address], { account: owner.account });
    await viem.assertions.revertWithCustomError(
      mockConverter.write.burnFromZeroAddress([tcgr.address], { account: owner.account }),
      tcgr,
      "ZeroAddress"
    );
  });

  it("setConverter updates converter and only owner can call", async function () {
    const { tcgr, owner, minter, referrer } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.setConverter([referrer.account.address], { account: owner.account });
    assert.strictEqual((await tcgr.read.converter()).toLowerCase(), referrer.account.address.toLowerCase());

    await viem.assertions.revertWithCustomError(
      tcgr.write.setConverter([owner.account.address], { account: minter.account }),
      tcgr,
      "OwnableUnauthorizedAccount"
    );
  });

  it("setConverter(0) is allowed (disables converter)", async function () {
    const { tcgr, owner, referrer } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.setConverter([referrer.account.address], { account: owner.account });
    await tcgr.write.setConverter([zeroAddress], { account: owner.account });
    assert.strictEqual(await tcgr.read.converter(), zeroAddress);
  });

  it("only converter can call burnFrom", async function () {
    const { tcgr, owner, minter, referrer } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.mintReferral([referrer.account.address, parseEther("100")], { account: minter.account });
    const converterAddr = owner.account.address; // any non-converter
    await tcgr.write.setConverter([converterAddr], { account: owner.account });
    // Deploy actual converter contract so we have an address that is set as converter; here we test that non-converter reverts
    await tcgr.write.setConverter([zeroAddress], { account: owner.account });
    await viem.assertions.revertWithCustomError(
      tcgr.write.burnFrom([referrer.account.address, parseEther("10")], { account: owner.account }),
      tcgr,
      "OnlyConverter"
    );
  });

  it("burnFrom zero amount is no-op (only converter can call; convert(0) reverts in converter)", async function () {
    const { tcgr, owner, minter, referrer } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.mintReferral([referrer.account.address, parseEther("100")], { account: minter.account });
    const mockTcgv = await viem.deployContract("contracts/test/MockTCGVPresale.sol:MockTCGVPresale", [], { client: { wallet: owner } });
    await mockTcgv.write.mint([owner.account.address, parseEther("100")], { account: owner.account });
    const converterContract = await viem.deployContract("TCGRToTCGVConverter", [
      tcgr.address,
      mockTcgv.address,
      parseEther("1"),
    ], { client: { wallet: owner } });
    await tcgr.write.setConverter([converterContract.address], { account: owner.account });
    await mockTcgv.write.transfer([converterContract.address, parseEther("100")], { account: owner.account });
    await viem.assertions.revertWithCustomError(
      converterContract.write.convert([0n], { account: referrer.account }),
      converterContract,
      "ZeroAmount"
    );
    assert.strictEqual(await tcgr.read.balanceOf([referrer.account.address]), parseEther("100"));
  });

  it("burnFrom reverts when insufficient balance", async function () {
    const { tcgr, owner, minter, referrer } = await networkHelpers.loadFixture(deployFixture);
    await tcgr.write.mintReferral([referrer.account.address, parseEther("10")], { account: minter.account });
    const mockTcgv = await viem.deployContract("contracts/test/MockTCGVPresale.sol:MockTCGVPresale", [], { client: { wallet: owner } });
    await mockTcgv.write.mint([owner.account.address, parseEther("1000")], { account: owner.account });
    const converterContract = await viem.deployContract("TCGRToTCGVConverter", [
      tcgr.address,
      mockTcgv.address,
      parseEther("1"),
    ], { client: { wallet: owner } });
    await tcgr.write.setConverter([converterContract.address], { account: owner.account });
    await mockTcgv.write.transfer([converterContract.address, parseEther("100")], { account: owner.account });
    await viem.assertions.revertWithCustomError(
      converterContract.write.convert([parseEther("100")], { account: referrer.account }),
      tcgr,
      "InsufficientBalance"
    );
  });
});
