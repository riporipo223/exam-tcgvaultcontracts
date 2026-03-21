# Wallet addresses — review sheet (French ↔ English ↔ `.env`)

Use the same Ethereum addresses in `.env` as in your operational wallet list. Variable names stay as in [`.env.example`](../.env.example).

| # | French (review) | English (same meaning) | Environment variable | On-chain use (summary) |
|---|-----------------|------------------------|----------------------|-------------------------|
| 1 | Wallet **Vault communautaire** (USDC) | **Community protocol vault** (USDC) | `VAULT_ADDRESS` | Buy/sell fee shares (vault + autolp routing to vault), BuyRouter USDC fees; also **30%** of Founder NFT mint USDC (physical Vault acquisitions, whitepaper). |
| 2 | Wallet **Marketing & Structure** | **Marketing & structure** (fees) | `MARKETING_ADDRESS` | TCGV buy/sell fee share to marketing & structure. |
| 3 | Wallet **Liquidité** | **Liquidity** | `LIQUIDITY_RECIPIENT` | Post–presale finalize: TCGV liquidity allocation; **60%** of Founder NFT mint USDC (project liquidity, whitepaper). |
| 4 | Wallet **Burn** (ou adresse dead) | **Burn** — *no wallet* | *(none)* | TCGV **burn** is **on-chain supply reduction** (`_burn`), not a transfer to an address. There is **no** `BURN_ADDRESS` in `.env`. If documentation mentions a “dead” address, that is **not** where router/token burns send funds. |
| 5 | Wallet **Récompenses communautaires** | **Community rewards** | `COMMUNITY_ADDRESS` | TCGV sell (and optional buy) fee share for community rewards. |
| 6 | Wallet **Réserve de structuration** (ex. 70k) | **Structuring reserve** / team reserve (e.g. 70k allocation) | `TEAM_RECIPIENT` | Post–presale finalize: team vesting allocation (aligns with “structuring reserve” in tokenomics). |

### Other required `.env` addresses (same deployment, not in the 6-row table above)

| English | Environment variable | Role |
|---------|------------------------|------|
| **InitialLaunch USDC treasury** | `TREASURY_ADDRESS` | USDC from token presale (`TCGVaultInitialLaunch`), not Founder NFT proceeds. |
| **Operations & ecosystem** | `OPS_RECIPIENT` | Post–presale: direct + vesting ops allocation; **10%** of Founder NFT mint USDC (ops / legal / community dev, whitepaper). |

### Quick mapping checklist

- [ ] `VAULT_ADDRESS` = vault communautaire (USDC)  
- [ ] `MARKETING_ADDRESS` = marketing & structure  
- [ ] `LIQUIDITY_RECIPIENT` = liquidité  
- [ ] Burn = contract burn only (no env wallet)  
- [ ] `COMMUNITY_ADDRESS` = récompenses communautaires  
- [ ] `TEAM_RECIPIENT` = réserve de structuration (70k-style allocation)  
- [ ] `TREASURY_ADDRESS` + `OPS_RECIPIENT` filled for full BSC testnet deploy  
