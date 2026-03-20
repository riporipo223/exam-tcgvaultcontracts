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

NEXUS is **immutable** on `TCGVaultToken` (constructor arg). `TCGNexusToken` needs the TCGV address as minter, so deploy in this order using the **predicted** TCGV address (Create address for `nonce` and `nonce+1` on the deployer account):

1. **Deploy TCGNexusToken** with `minter = predictedTCGVAddress`.
   ```solidity
   TCGNexusToken nexusToken = new TCGNexusToken(predictedTCGVAddress);
   ```

2. **Deploy TCGVaultToken** with `nexusToken = address(nexusToken)` (must match the address from step 1). Name, symbol and supply are fixed in contract (whitepaper).
   ```solidity
   TCGVaultToken token = new TCGVaultToken(
       dexRouterAddress,
       vaultAddress,
       marketingAddress,
       communityAddress,
       address(nexusToken)
   );
   ```

3. **Add initial liquidity** on your DEX and call `token.setPair(pairAddress, true)` to register the taxable pair (use `active = false` to disable a pool).

4. **Fee-exclude the liquidity wrapper** via `token.setExcludedFromFees(wrapperAddress, true)` so LP add/remove path (wrapper↔pair) is not taxed as swap. The wrapper withdraws to itself on remove, then forwards to the user.

5. **Deploy TCGVaultBuyRouter** (optional — stablecoin path on BSC) and set it on the token:
   ```solidity
   TCGVaultBuyRouter buyRouter = new TCGVaultBuyRouter(
       dexRouterAddress,
       usdcAddress,
       ITCGVaultToken(address(token)),
       vaultAddress,
       marketingAddress,
       communityAddress
   );
   token.setBuyRouter(address(buyRouter));
   ```
   Users who buy via `buyTCGVWithUSDC` follow the router’s USDC fee + swap + burn + NEXUS cashback rules (see `TCGVaultBuyRouter` comments).

### BSC Testnet (chainId 97)

Script: `yarn deploy:bsctest` → `scripts/deployBscTestnet.ts` on Hardhat network `bsctest` (`BSCTEST_RPC_URL` + `TCG_KEY` in keystore).

- PancakeSwap V2 testnet **factory** `0x6725F303b657a9451d8BA641348b6761A6CC7a17`, **router** `0xD99D1c33F9fC3444f8101754aBC46c52416550D1` — see [Pancake docs](https://developer.pancakeswap.finance/contracts/v2/addresses).
- **USDC:** BSC testnet has no single canonical Circle USDC. The script deploys **`MockUSDC`** (6 decimals, open `mint`) unless you set **`USDC_ADDRESS`** to an existing token.

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

2. **DEX routers:** The constructor registers one V2-style router (`dexFactoryForRouter[router] = router.factory()`). Add or remove more with `setDexRouter(router, active)` (emits `DexRouterUpdated`). Registered routers are fee-excluded. Taxed swaps are still driven by `isPair`, not by this mapping.

3. **Cashback:** 10% cashback in NEXUS on buy only (whitepaper: la vente ne génère pas de Cashback). NEXUS is Soulbound. TCGNexusToken’s minter is set at deployment to TCGVaultToken and is immutable (no setter).

4. **Auto-LP:** On sells, 3% of the fee is automatically added to the liquidity pool. This requires ETH to be sent to the contract (can happen automatically via swap fees or manually).

5. **Minimum amounts:** Buy and sell transfers below `minBuyAmount` / `minSellAmount` revert with `MinAmountNotMet` so fee computation is always meaningful. Owner can set these via `setMinAmounts`. Default is 10_000 (wei).

6. **Exclusions:** The token contract itself and the initial DEX router are excluded from fees by default; more routers added via `setDexRouter` are excluded too. Other addresses via `setExcludedFromFees` (including the owner if you choose to set it explicitly).

## Security Considerations

- The contract uses ReentrancyGuard for sell operations
- Owner can pause fees via `setFeesEnabled(false)`
- Emergency withdraw function available for owner
- All fee percentages are constants and cannot be changed after deployment

## Functions

### Admin functions (`DEFAULT_ADMIN_ROLE`, granted to deployer)
- `setDexRouter(address, bool)` - Register another V2 router (stores `factory()`, fee-excludes it) or remove one (`DexRouterUpdated`)
- `setPair(address, bool)` - Register or disable a V2 pool for buy/sell fee logic (`PairActiveUpdated`)
- `setAddresses(vault, marketing, community)` - Update vault / marketing / community fee recipients; emits `FeeRecipientsUpdated` (**NEXUS address is not updatable**)
- `setExcludedFromFees(address, bool)` - Exclude/include addresses from fees (emits `ExcludedFromFeesUpdated`; constructor also emits for deployer, token, and DEX router; `setBuyRouter` emits when router is non-zero)
- `setFeesEnabled(bool)` - Enable/disable fees
- `setCashbackEnabled(bool)` - Enable/disable cashback
- `setMinAmounts(uint256, uint256)` - Set minimum buy/sell amounts for fee computation  
- Use OpenZeppelin `AccessControl` `grantRole` / `revokeRole` if you add custom roles later; transfer admin with `grantRole` + `revokeRole` on `DEFAULT_ADMIN_ROLE`.

### Public Functions
- Standard ERC20 functions (transfer, approve, etc.)

## Events

`TCGVaultToken` emits configuration events whenever state changes, **including in the constructor** (fee recipients, NEXUS, min amounts, fee toggles, buy/sell params, first DEX router, exclusions), so a subgraph can index from block 0 without missing defaults.

Notable events: `FeeRecipientsUpdated`, `MinAmountsUpdated`, `FeesEnabledUpdated`, `CashbackEnabledUpdated`, `PresaleActiveUpdated`, `BuyFeeParamsUpdated`, `SellFeeParamsUpdated`, `DexRouterUpdated`, `ExcludedFromFeesUpdated`, `PairActiveUpdated`, `PresaleFinalizerSet`, `AllocationRecipientsUpdated`, `BuyRouterUpdated`, `Paused` / `Unpaused`, `BlacklistUpdated`, `SupplyRecomputed`, vesting / fee distribution events.

- `FeesDistributed` — Buy/sell fee splits applied
- `CashbackDistributed` — NEXUS cashback minted
- `LiquidityAdded` — Legacy / documentation hook (if used)
