# TCG Vault Token Contracts

This directory contains the ERC20 token contracts for the TCG Vault ecosystem.

## Contracts

### TCGVaultToken.sol (TCGV)
Token A — le Moteur économique (whitepaper §4.1). BNB Chain, 1 milliard supply.

**Features (whitepaper §5.1, §5.2):**
- **Direct pair (PancakeSwap):** Buy tax 15% in TCGV (10% Vault, 3% Marketing, 2% burn) + 10% NEXUS cashback. Sell tax 10% in TCGV.
- **Router path (TCGVaultBuyRouter):** Buy fee 13% **in BNB** (10% vault, 3% marketing); 2% of TCGV received is burned; user gets rest + 10% NEXUS cashback.
- Auto-LP and auto-burn on sells.

### TCGNexusToken.sol (NEXUS)
Jeton de Cœur — gouvernance et appartenance (whitepaper §5.5).

**Features:**
- Soulbound (non transférable): no transfers between accounts; mint and burn only
- Minter = TCGVaultToken only, set at deployment (immutable)
- Obtained via 10% cashback on TCGV purchase; owner can mint for presale/initial distribution

### TCGVaultBuyRouter.sol
**Buy TCGV with BNB through this contract: fee is charged in BNB.** User sends BNB; 13% is taken in BNB (10% vault, 3% marketing); the rest is swapped for TCGV via PancakeSwap. 2% of TCGV received is burned. User receives the remaining TCGV + 10% NEXUS cashback. Uses transient storage so the pair→router TCGV transfer is not taxed (fee already taken in BNB).

### TCGVaultLiquidityWrapper.sol
Use for **adding/removing liquidity** so TCGV does **not** charge fees on those transfers (whitepaper: no fees on LP supply/remove). Sets transient storage (EIP-1153) before calling the DEX router; TCGVaultToken skips fees when this slot is set. Requires **Cancun** (or later) hardfork for `tstore`/`tload`.

### Whitepaper NFTs (separate from these contracts)
The whitepaper §7 describes **Founder Edition** NFTs (500) and **Édition basique** (staking 25$ TCGV). Those are separate NFT contracts and are not part of this repo; these contracts only implement TCGV and NEXUS tokens.

## Deployment Steps

1. **Deploy TCGVaultToken first** (with `nexusToken = address(0)`). Name, symbol and supply are fixed in contract (whitepaper).
   ```solidity
   TCGVaultToken token = new TCGVaultToken(
       pancakeRouterAddress,
       vaultAddress,
       marketingAddress,
       communityAddress,
       address(0), // nexusToken set later via setAddresses
       stablecoinAddress   // USDC per whitepaper
   );
   ```

2. **Deploy TCGNexusToken** with minter = TCGVaultToken (immutable). Name and symbol fixed in contract (whitepaper).
   ```solidity
   TCGNexusToken nexusToken = new TCGNexusToken(address(token));
   ```

3. **Set Nexus token on TCGVaultToken:**
   ```solidity
   token.setAddresses(
       vaultAddress,
       marketingAddress,
       communityAddress,
       address(nexusToken),
       stablecoinAddress
   );
   ```

4. **Add initial liquidity to PancakeSwap** and call `token.setPair(pairAddress)` to register the pair.

5. **Deploy TCGVaultBuyRouter** (optional — for fee-in-BNB path) and set it on the token:
   ```solidity
   TCGVaultBuyRouter buyRouter = new TCGVaultBuyRouter(
       pancakeRouterAddress,
       address(token),
       vaultAddress,
       marketingAddress
   );
   token.setBuyRouter(address(buyRouter));
   ```
   Users who buy via `buyRouter.buyTCGVWithBNB(amountOutMin, deadline){ value: bnb }` pay 13% fee in BNB (10% vault, 3% marketing), 2% of TCGV received is burned, and receive the rest + 10% NEXUS cashback.

## Fee Structure

### Buy Tax
- **Direct (PancakeSwap):** 15% in TCGV (10% vault, 3% marketing, 2% burn) + 10% NEXUS cashback.
- **BuyRouter (BNB path):** 13% in BNB (10% vault, 3% marketing), 2% of TCGV received burned, + 10% NEXUS cashback.

### Sell Tax (10%)
- **4%** → Vault Consolidation
- **3%** → Auto-LP (liquidity pool)
- **1%** → Marketing & Structure
- **1%** → Community Rewards
- **1%** → Auto-burn

## Important Notes

1. **Pair Detection:** The contract detects buys/sells by checking if transfers are to/from the PancakeSwap pair address.

2. **Router Support:** The contract supports both router-based swaps and direct swaps through PancakeSwap.

3. **Cashback:** 10% cashback in NEXUS on buy only (whitepaper: la vente ne génère pas de Cashback). NEXUS is Soulbound. TCGNexusToken’s minter is set at deployment to TCGVaultToken and is immutable (no setter).

4. **Auto-LP:** On sells, 3% of the fee is automatically added to the liquidity pool. This requires ETH to be sent to the contract (can happen automatically via swap fees or manually).

5. **Minimum amounts:** Buy and sell transfers below `minBuyAmount` / `minSellAmount` revert with `MinAmountNotMet` so fee computation is always meaningful. Owner can set these via `setMinAmounts`. Default is 10_000 (wei).

6. **Exclusions:** Owner, contract itself, and router are excluded from fees by default. Additional addresses can be excluded via `setExcludedFromFees`.

## Security Considerations

- The contract uses ReentrancyGuard for sell operations
- Owner can pause fees via `setFeesEnabled(false)`
- Emergency withdraw function available for owner
- All fee percentages are constants and cannot be changed after deployment

## Functions

### Owner Functions
- `setPair(address)` - Set PancakeSwap pair address
- `setPairStatus(address, bool)` - Add/remove pair addresses
- `setAddresses(...)` - Update fee recipient addresses
- `setExcludedFromFees(address, bool)` - Exclude/include addresses from fees
- `setFeesEnabled(bool)` - Enable/disable fees
- `setCashbackEnabled(bool)` - Enable/disable cashback
- `setMinAmounts(uint256, uint256)` - Set minimum buy/sell amounts for fee computation
- `emergencyWithdraw(address, uint256)` - Emergency withdraw tokens/ETH

### Public Functions
- Standard ERC20 functions (transfer, approve, etc.)

## Events

- `FeesDistributed` - Emitted when fees are distributed
- `CashbackDistributed` - Emitted when cashback is given
- `LiquidityAdded` - Emitted when liquidity is added
