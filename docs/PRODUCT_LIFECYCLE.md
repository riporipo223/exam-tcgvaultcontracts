# Product lifecycle (contract implementation)

Summary of how the main phases behave **in this repository’s Solidity contracts**. Authoritative fee parameters: [**FEE_REFERENCE.md**](FEE_REFERENCE.md). French summary: [**IMPLEMENTATION_NOTES_FR.md**](IMPLEMENTATION_NOTES_FR.md).

**Index of docs in this folder:** [`README.md`](README.md#documentation-in-this-folder).

## On-chain fees (defaults)

Numeric defaults, mutability (`ADMIN_ROLE`, router `onlyOwner`), token/router fee caps (`TCGVaultToken.MAX_BUY_TAX_BP = 600`, `TCGVaultToken.MAX_SELL_TAX_BP = 500`, `TCGVaultBuyRouter.MAX_BUY_TOTAL_BP = 500`, `TCGVaultBuyRouter.MAX_SELL_TAX_BP = 400`), and the split between **direct V2 pool (`TCGVaultToken`)** and **`TCGVaultBuyRouter` (USDC)** are fully specified in [**FEE_REFERENCE.md**](FEE_REFERENCE.md). Summary:

- **Direct pool buy:** **6%** TCGV fee, thirds to vault / marketing / `pendingAutolp`; no swap-tax supply burn.
- **Direct pool sell:** **5%** TCGV fee; default **40% / 40% / 20% / 0%** of the fee to vault / autolp / marketing / community.
- **Router buy:** **5%** of USDC in (default **3% + 2%** vault + marketing); **100%** of TCGV out to buyer; no TCGV burn on that leg.
- **Router sell:** **4%** of USDC out by default; four-way split on the fee (see **FEE_REFERENCE.md**, section 2.2).
- **NEXUS cashback (buys only):** **30%** of TCGV buy amount while presale flag is active, **10%** after (`TCGVaultToken`).

## Product lifecycle

1. **Founder NFT sale (500 units)**  
   - Wave 1: **up to 250 NFTs** at **200 USDC** for **7 days from the first Founder mint** (`WAVE1_DURATION`).  
   - Wave 2: **350 USDC** starts automatically after that 7-day window, or earlier if wave 1 sells out before the timer (`wave2StartTimestamp`).  
   - Each paid mint: USDC split **30%** vault / **60%** liquidity / **10%** ops (rounding remainder to ops).  
   - Buyer receives **30%** of the USDC price as NEXUS (18 decimals; `TCGVaultFounderNFT`).  
   - Owner may mint up to **5** NFTs per wave at the same price; public mints revert with `ReservedForOwner` when the remaining wave supply would not leave room for that reserve.

2. **Token presale (Initial Launch)**  
   - Users spend **USDC** for a **TCGV allocation** (vesting on the launch contract).  
   - Price wave 1: **0.005** USDC per 1 TCGV before Founder wave 2 starts; wave 2: **0.008** once `block.timestamp >= founderNFT.wave2StartTimestamp()`.  
   - Founder wave 2 runs for **10 days** (`FOUNDER_WAVE2_DURATION`), then a **120h** countdown starts (`presaleCountdownStartTime()`), and presale closes at `presaleEndTime()`.  
   - **Per-wallet cap:** **4%** of hard cap; **hard cap:** **600M** TCGV (18 decimals).  
   - **NEXUS bonus:** **30%** of USDC spent.  
   - After countdown, anyone can call **`finalize()`**. There is **no** early `finalize` when only the hard cap is reached.  
   - After `finalize` (TGE): **`claim()`** vests **10%** at TGE, then **10%/month** for **9** months (`releasable()`).

## Regulated custody and cancellation settlement

USDC custody and cooling-off cancellation are intentionally split between on-chain state management and regulated off-chain settlement.

- **Founder NFT (`TCGVaultFounderNFT`)**: `mint()` transfers USDC directly to `caspUsdcRecipient()` (`_caspUsdcRecipient` storage).
- **Initial Launch (`TCGVaultInitialLaunch`)**: `buy()` transfers USDC directly to `treasury()` (`_treasury` storage; deployment may use a CASP address).
- **No contract escrow**: USDC is not retained on these contracts during the 14-day cancellation window.
- **On-chain cancellation effects**: `cancelFounderPurchase()` and `cancelOrder()` unwind entitlement on-chain (burn NFT / burn allocated TCGV / claw back NEXUS bonus where applicable).
- **Refund execution**: USDC repayment is handled off-chain by the regulated recipient after indexing cancellation events (`FounderPurchaseCancelled`, `PresaleOrderCancelled`), where `usdcRefundDue` is emitted as the reconciliation amount.

This architecture is used to satisfy the requirement that client funds are routed to regulated custody rails (CASP/treasury) instead of being held in smart contract escrow.

3. **Post-TGE trading**  
   - **`TCGVaultBuyRouter`:** USDC buy path (default **5%** USDC fee then swap; NEXUS via token); USDC sell path (default **4%** on USDC out — see **FEE_REFERENCE.md**). Router is fee-excluded on `TCGVaultToken` so pool taxes are not applied twice on that path.  
   - **`TCGVaultToken`:** direct pair swaps (**6%** buy / **5%** sell defaults in TCGV); presale flag, cashback, blacklist, pause, `pendingAutolp`, vesting hooks.

4. **Staking + Basic NFT**  
   - **ERC-4626** vault over TCGV. Depositing enough shares (≥ `requiredStakeForBasicNFT`) mints a **Basic NFT** to the **receiver**; withdrawing below the minimum **burns** that wallet’s Basic NFT.  
   - Basic NFT is **soulbound** (non-transferable).
