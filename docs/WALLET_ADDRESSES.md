# Wallet addresses — review sheet (French ↔ English ↔ `.env`)

Use the same Ethereum addresses in `.env` as in your operational wallet list. Variable names stay as in [`.env.example`](../.env.example).

| # | French (review) | English (same meaning) | Environment variable | On-chain use (summary) |
|---|-----------------|------------------------|----------------------|-------------------------|
| 1 | Wallet **Vault communautaire** (USDC) | **Community protocol vault** (USDC) | `VAULT_ADDRESS` | Vault share of **direct pool** fees (TCGV) and of **BuyRouter** USDC fees; Founder NFT mint: **30%** of USDC to vault (`TCGVaultFounderNFT`). Autolp accrual on the token is executed separately — see `executePendingAutolp` / [**FEE_REFERENCE.md**](FEE_REFERENCE.md). |
| 2 | Wallet **Marketing & Structure** | **Marketing & structure** (fees) | `MARKETING_ADDRESS` | Marketing share of direct pool fees (TCGV) and BuyRouter USDC fees. |
| 3 | Wallet **Liquidité** | **Liquidity** | `LIQUIDITY_RECIPIENT` | Post–presale finalize: TCGV liquidity allocation; **60%** of Founder NFT mint USDC (`TCGVaultFounderNFT`). |
| 4 | Wallet **Burn** (ou adresse dead) | **Burn** — *no wallet* | *(none)* | Swap **fees** do **not** route to a “burn wallet”: there is **no** `BURN_ADDRESS` in `.env`. Supply still changes via **minting** (presale, cashback, allocations) and **one-off** tokenomics paths documented in `TCGVaultToken`; do not assume a dead-address fee sink for trading. |
| 5 | Wallet **Récompenses communautaires** | **Community rewards** | `COMMUNITY_ADDRESS` | **BuyRouter** default sell path sends part of the **USDC** fee here (see [**FEE_REFERENCE.md**](FEE_REFERENCE.md) §2.2). **Direct pool** sell defaults give **0%** of the sell fee to community unless `SELL_COMMUNITY_SHARE` / params are changed on-chain. |
| 6 | Wallet **Réserve de structuration** (ex. 70k) | **Structuring reserve** / team reserve (e.g. 70k allocation) | `TEAM_RECIPIENT` | Post–presale finalize: team vesting recipient (`TCGVaultToken` allocation / `claimTeam`). |

### Other required `.env` addresses (same deployment, not in the 6-row table above)

| English | Environment variable | Role |
|---------|------------------------|------|
| **InitialLaunch USDC treasury** | `TREASURY_ADDRESS` | USDC from token presale (`TCGVaultInitialLaunch`), not Founder NFT proceeds. |
| **Operations & ecosystem** | `OPS_RECIPIENT` | Post–presale: direct + vesting ops allocation; **10%** of Founder NFT mint USDC (`TCGVaultFounderNFT`). |

### Quick mapping checklist

- [ ] `VAULT_ADDRESS` = vault communautaire (USDC)  
- [ ] `MARKETING_ADDRESS` = marketing & structure  
- [ ] `LIQUIDITY_RECIPIENT` = liquidité  
- [ ] Burn = contract burn only (no env wallet)  
- [ ] `COMMUNITY_ADDRESS` = récompenses communautaires  
- [ ] `TEAM_RECIPIENT` = réserve de structuration (70k-style allocation)  
- [ ] `TREASURY_ADDRESS` + `OPS_RECIPIENT` filled for full BSC testnet deploy  
