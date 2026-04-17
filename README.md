# TCG-VAULT Contracts

Smart contracts for the TCG Vault ecosystem on BNB Chain.

## Documentation Status

This README describes the **current on-chain implementation** in this repository.
The Solidity source of truth is:

- `contracts/TCGVaultToken.sol`
- `contracts/TCGVaultBuyRouter.sol`

## Current Fee Model (Implemented)

### 1) Direct DEX/Pool Transfers (`TCGVaultToken`)

- **Buy tax:** `BUY_TAX = 600` (6%).
- **Buy split (of fee amount):**
  - Vault: `BUY_VAULT_SHARE = 3333` (~33.33% of fee, ~2.00% notional)
  - Marketing: `BUY_MARKETING_SHARE = 3333` (~33.33% of fee, ~2.00% notional)
  - Auto-LP bucket: `BUY_AUTOLP_SHARE = 3334` (~33.34% of fee, ~2.00% notional)
- **Sell tax:** `SELL_TAX = 500` (5%).
- **Sell split (of fee amount):**
  - Vault: `SELL_VAULT_SHARE = 4000` (40% of fee, 2.00% notional)
  - Auto-LP bucket: `SELL_AUTOLP_SHARE = 4000` (40% of fee, 2.00% notional)
  - Marketing: `SELL_MARKETING_SHARE = 2000` (20% of fee, 1.00% notional)
  - Community: `SELL_COMMUNITY_SHARE = 0`

### 2) USDC Router Path (`TCGVaultBuyRouter`)

- **Buy (USDC -> TCGV):**
  - Fee is taken in USDC before swap.
  - Defaults:
    - Vault: `_buyVaultBp = 300` (3%)
    - Marketing: `_buyMarketingBp = 200` (2%)
    - Community: `_buyCommunityBp = 0`
  - Total default router buy fee = **5% USDC**.
  - Remaining USDC is swapped; user receives **100% of `tcgvReceived`** from swap output.

- **Sell (TCGV -> USDC):**
  - Fee is taken on USDC output after swap.
  - Defaults:
    - `_sellTaxBp = 400` (4% total fee on USDC out)
    - `_sellVaultShareBp = 3750` (37.5% of fee = 1.5% notional)
    - `_sellAutolpShareBp = 2500` (25.0% of fee = 1.0% notional)
    - `_sellMarketingShareBp = 1250` (12.5% of fee = 0.5% notional)
    - `_sellCommunityShareBp = 2500` (25.0% of fee = 1.0% notional)

## Burn Behavior

- There is **no buy/sell burn fee mechanism** in the current transfer tax or router tax flows.
- Buy/sell fees are routed to pending claim balances and/or `pendingAutolp`, not burned.
- The only burn-related path in `TCGVaultToken` is `burnPresaleAllocation(...)`, gated to `initialLaunch`.

## Fee Mutability / Admin Controls

Fees are **not immutable constants**. They are configurable by privileged roles, with hard caps:

- `TCGVaultToken` (pool mode):
  - `setBuyFeeParams(...)`
  - `setSellFeeParams(...)`
- `TCGVaultBuyRouter` (router mode):
  - `setBuyFeeParams(...)`
  - `setSellFeeParams(...)`

Absolute caps:

- `TCGVaultToken`: `MAX_BUY_TAX_BP = 600` (6%) and `MAX_SELL_TAX_BP = 500` (5%).
- `TCGVaultBuyRouter`: `MAX_BUY_TOTAL_BP = 500` (5%) and `MAX_SELL_TAX_BP = 400` (4%).

Constraints:

- In token buy/sell split setters, shares must sum to `10000`.
- In token buy/sell setters, tax must be <= contract-specific cap and cannot increase versus current on-chain value.
- In router buy setter, total buy fee (`vault + marketing + community`) must be <= `MAX_BUY_TOTAL_BP` and cannot increase.
- In router sell setter, sell split shares must sum to `10000` and tax must be <= `MAX_SELL_TAX_BP` and cannot increase.

## Notes

- NEXUS cashback logic is active in token/router flows as implemented in code.
- If you use these contracts for calculators, analytics, or simulations, read fee values directly from contract state where possible rather than assuming static values.
- Founder sale and initial presale custody/refund model (direct USDC transfer to regulated recipient, event-driven cooling-off refunds) is documented in `docs/PRODUCT_LIFECYCLE.md` and `docs/WALLET_ADDRESSES.md`.
