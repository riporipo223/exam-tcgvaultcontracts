# On-chain fee reference (source of truth)

Fee and role behavior as implemented in **`contracts/`** in this repository. Always verify live parameters on deployed instances (`BUY_TAX`, `sellTaxBp()`, etc.) before integrating.

**Basis points:** `10000` = 100%. **Mutability:** direct-pool taxes live on `TCGVaultToken` (`setBuyFeeParams` / `setSellFeeParams`, **`ADMIN_ROLE`**); USDC-router taxes live on `TCGVaultBuyRouter` (`setBuyFeeParams` / `setSellFeeParams`, **`onlyOwner`**). Each contract enforces **`MAX_FEE_BP = 2500`** (25%) on the configurable tax leg. **No fee-driven TCGV supply burn** on swap tax distribution in the current design (fees accrue to recipients / `pendingAutolp`; router sends 100% of purchased TCGV to the buyer).

---

## 1. Direct V2 pool path — `TCGVaultToken`

Applies when users swap **TCGV ↔ other token** through a registered **pair** (`setPair(..., true)`). The token charges fees in **TCGV** on the transfer leg that looks like a buy or sell.

### 1.1 Buy (pool / router swap into TCGV)

| Parameter | Default (bps) | Meaning |
|-------------|---------------|---------|
| `BUY_TAX` | **600** | **6%** of the bought TCGV amount is taken as fee. |
| `BUY_VAULT_SHARE` | **3333** | **⅓** of the fee → `vaultAddress`. |
| `BUY_MARKETING_SHARE` | **3333** | **⅓** of the fee → `marketingAddress`. |
| `BUY_AUTOLP_SHARE` | **3334** | **⅓** of the fee → `pendingAutolp` (liquidity accrual; not a burn). |

**Notional split (defaults):** each third of the **6%** fee ≈ **2%** of buy notional to vault, marketing, and `pendingAutolp` respectively.

### 1.2 Sell (pool / router swap out of TCGV)

| Parameter | Default (bps) | Meaning |
|-------------|---------------|---------|
| `SELL_TAX` | **500** | **5%** of the sold TCGV amount is taken as fee. |
| `SELL_VAULT_SHARE` | **4000** | **40%** of the fee → vault (**2%** of notional). |
| `SELL_AUTOLP_SHARE` | **4000** | **40%** of the fee → `pendingAutolp` (**2%** of notional). |
| `SELL_MARKETING_SHARE` | **2000** | **20%** of the fee → marketing (**1%** of notional). |
| `SELL_COMMUNITY_SHARE` | **0** | **0%** of the fee → community on the default direct-pool path. |

### 1.3 NEXUS cashback (same contract)

| Mode | Cashback (of buy **TCGV** amount) | Constant in code |
|------|-------------------------------------|------------------|
| Presale active | **30%** | `CASHBACK_RATE_PRESALE = 3000` |
| After presale finalize | **10%** | `CASHBACK_RATE = 1000` |

Cashback is **minted in NEXUS** to the buyer; **sells do not** mint cashback.

---

## 2. USDC router path — `TCGVaultBuyRouter`

Users call **`buyTCGVWithUSDC`** / **`sellTCGVForUSDC`**. The router is **fee-excluded** on `TCGVaultToken`; fees are taken in **USDC** (buy) or from **USDC output** (sell), not as TCGV tax on the router→user transfer.

### 2.1 Buy with USDC

| Parameter | Default (bps) | Meaning |
|-------------|---------------|---------|
| `_buyVaultBp` (`buyVaultBp()`) | **300** | **3%** of USDC sent in → vault (before swap). |
| `_buyMarketingBp` (`buyMarketingBp()`) | **200** | **2%** of USDC in → marketing. |
| `_buyCommunityBp` (`buyCommunityBp()`) | **0** | **0%** default to community on buy. |
| **Total USDC fee** | **500** | **5%** of USDC in; remainder swapped for TCGV. |

After the swap, **100%** of TCGV received is transferred to the buyer (**no** TCGV burn). NEXUS cashback is still triggered via `TCGVaultToken` rules (30% / 10% of the **TCGV** buy amount).

### 2.2 Sell for USDC

Fee is applied to **USDC received** from the swap (output side), not as a second `TCGVaultToken` sell tax on top (input TCGV goes to pair; see router implementation).

| Parameter | Default (bps) | Meaning |
|-------------|---------------|---------|
| `_sellTaxBp` (`sellTaxBp()`) | **400** | **4%** of USDC out is taken as fee. |
| `_sellVaultShareBp` | **3750** | **37.5%** of the **fee amount** → vault = **1.5%** of USDC notional. |
| `_sellAutolpShareBp` | **2500** | **25%** of the fee → autolp recipient = **1%** of notional. |
| `_sellMarketingShareBp` | **1250** | **12.5%** of the fee → marketing = **0.5%** of notional. |
| `_sellCommunityShareBp` | **2500** | **25%** of the fee → community = **1%** of notional. |

Shares are basis points of the **fee slice** and must **sum to 10000** when calling `setSellFeeParams`.

### 2.3 Router admin

| Function | Who | Notes |
|----------|-----|-------|
| `setBuyFeeParams(vaultBp, marketingBp, communityBp)` | Owner | Sum of three ≤ `MAX_FEE_BP`. |
| `setSellFeeParams(taxBp, vaultShareBp, autolpShareBp, marketingShareBp, communityShareBp)` | Owner | `taxBp` ≤ `MAX_FEE_BP`; four shares sum to **10000**. |
| `setReferralToken` | Owner | Optional TCGR referral integration. |

### 2.4 TCGR referral (optional)

When `referralToken` is set to a non-zero `TCGR` contract, each qualifying **`buyTCGVWithUSDC`** can call `processValidatedBuy` so referrers earn **TCGR** per that token’s rules (e.g. **0.5%** of validated buy — see `TCGRToken.sol`). This is separate from USDC fee bps above.

---

## 3. `TCGVaultToken` admin roles (fee-related)

| Role | Fee-related powers |
|------|---------------------|
| `ADMIN_ROLE` | `setBuyFeeParams`, `setSellFeeParams`, `setFeesEnabled`, `setCashbackEnabled`, `setMinAmounts`, `setDexRouter`, `setPair`, `setAddresses`, `setExcludedFromFees`, `setBuyRouter`, `setAllocationRecipients`, … |
| `PAUSER_ROLE` | `pause` |
| `UNPAUSER_ROLE` | `unpause` |
| `BLACKLISTER_ROLE` | `setBlacklisted` |
| `DEFAULT_ADMIN_ROLE` | Grant/revoke the roles above only (not routine setters). |

Deployer receives **all** roles at construction; operational security is improved by **narrowing** hot wallets (revoke `ADMIN_ROLE` from keys that should not move fee params).

---

## 4. Liquidity wrapper

`TCGVaultLiquidityWrapper` sets transient storage so **add/remove liquidity** through an allowed router does **not** trigger TCGV buy/sell taxes on wrapper↔pair transfers.
