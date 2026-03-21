# Whitepaper reference (technical summary)

The marketing whitepaper (`TCG-VAULT_WhitePaper_EN … .docx`) should live in this folder when available for legal/comms alignment. Until then, use this file plus [`RAPPORT_WHITEPAPER_POINTS_NON_PRECISES.md`](RAPPORT_WHITEPAPER_POINTS_NON_PRECISES.md) to reconcile copy with **on-chain behavior**.

## Product lifecycle (as implemented in contracts)

1. **Founder NFT sale (500 units)**  
   - Wave 1: 250 NFTs at **200 USDC**; wave 2: 250 at **350 USDC**.  
   - Each paid mint: USDC split **30%** vault acquisitions / **60%** liquidity / **10%** ops (remainder from rounding to ops).  
   - Buyer receives **30%** of the USDC price as **$TCGNEXUS** (18 decimals; formula in `TCGVaultFounderNFT`).  
   - **Owner** may mint up to **5** NFTs per wave at the same price; **public** mints are blocked when remaining wave supply would not leave room for that reserve (`ReservedForOwner`).

2. **Token presale (Initial Launch)**  
   - Users spend **USDC** for a **TCGV allocation** (vesting on the launch contract).  
   - Price **wave 1**: `0.005` USDC per 1 TCGV (6-decimal USDC rate); **wave 2**: `0.008`, active while `founderNFT.soldCount() < 250` vs `>= 250` (see `TCGVaultInitialLaunch.currentPrice()`).  
   - **120h countdown** to presale end starts when **`TCGVaultFounderNFT` sets `wave2StartTimestamp`** — i.e. on the mint that sells the **last** wave-1 slot (token id `249`, 250th sale).  
   - **Per-wallet cap**: **4%** of hard cap; **hard cap**: **600M** TCGV (18 decimals).  
   - **NEXUS bonus**: **30%** of USDC (same style as Founder).  
   - After countdown, anyone can call **`finalize()`** (not before). **No early finalize** when hard cap is hit.  
   - After finalize (**TGE**): **`claim()`** releases vested TCGV (10% at TGE, then 10%/month for 9 months — see `releasable()`).

3. **Post-TGE trading**  
   - **`TCGVaultBuyRouter`**: buy TCGV with USDC (fees + swap + TCGV burn slice + NEXUS cashback via token); sell TCGV for USDC.  
   - **`TCGVaultToken`** handles presale mode, cashback rates, fees, blacklist, etc. (see token contract and subgraph `Protocol` fields).

4. **Staking + Basic NFT**  
   - **ERC-4626** vault over TCGV. Depositing enough **shares** (≥ `minStakeForBasicNFT`) triggers **Basic NFT** mint to the **receiver**; withdrawing below minimum **burns** that wallet’s Basic NFT.  
   - Basic NFT is **soulbound** (non-transferable).

## Where whitepaper text may differ from code

See the table in [`RAPPORT_WHITEPAPER_POINTS_NON_PRECISES.md`](RAPPORT_WHITEPAPER_POINTS_NON_PRECISES.md). The **frontend and audits** should treat **Solidity + this repo** as source of truth until marketing/legal updates the PDF/DOCX.

## Adding the official document

Place the English whitepaper next to this file, e.g.:

`contracts/docs/TCG-VAULT_WhitePaper_EN.docx`

Then update [`../../docs/frontend-integration.md`](../../docs/frontend-integration.md) with a single link under “External references” if needed.
