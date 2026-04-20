# BSC Fork Testing Script

This script (`testOnBSCFork.ts`) deploys all TCG Vault contracts, creates a PancakeSwap pair, adds liquidity, and tests various trading scenarios on a BSC fork.

## Setup

### 1. Configure BSC Fork in `hardhat.network.ts`

Uncomment and configure the fork settings in `hardhat.network.ts`:

```typescript
networks.hardhat = {
  hardfork: 'cancun', // EIP-1153 tstore/tload for TCGVaultToken liquidity exemption
  forking: {
    url: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
    blockNumber: undefined, // Use latest block, or specify a block number
  },
};
```

### 2. Set Environment Variables (Optional)

Create a `.env` file or export environment variables:

```bash
export BSC_RPC_URL="https://bsc-dataseed.binance.org/"
# Or use a private RPC like Alchemy, Infura, etc.
```

### 3. Run the Script

```bash
npx hardhat run scripts/testOnBSCFork.ts --network hardhat
```

## What the Script Does

1. **Deploys Contracts:**
   - `TCGVaultToken` - Main token with buy/sell fees
   - `TCGNexusToken` - Soulbound cashback token
   - `TCGVaultBuyRouter` - Router for USDC fee path
   - `TCGVaultLiquidityWrapper` - Wrapper for fee-free liquidity operations

2. **Creates PancakeSwap Pair:**
   - Gets or creates TCGV/USDC pair on PancakeSwap
   - Sets pair address on token contract

3. **Adds Liquidity:**
   - Adds TCGV + USDC via the liquidity wrapper (no fees)

4. **Tests Trading Scenarios:**
   - **Buy via PancakeSwap Router:** USDC → TCGV with **routeur OFF** token buy tax (**6%** TCGV, thirds vault/marketing/autolp; no NEXUS on pair)
   - **Buy via TCGVaultBuyRouter:** **Routeur ON** — **5%** USDC (3% vault + 2% marketing), swap, NEXUS cashback via token; no TCGV burn on fee
   - **Direct Pair Swap:** Same pool path as above without the official router
   - **Sell via PancakeSwap Router:** **5%** TCGV sell tax on pool path (routeur OFF)
   - **Sell via TCGVaultBuyRouter:** **4%** fee on USDC out (routeur ON)

## Expected Output

The script will output:
- Contract addresses
- Pair reserves
- Trade results (amounts received, fees collected, burns)
- NEXUS cashback amounts

## Notes

- The script uses the real PancakeSwap router (`0x10ED43C718714eb63d5aA57B78B54704E256024E`) and factory (`0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73`) on BSC
- All transactions are executed on the forked network
- Make sure your test account has BNB for gas; the script also seeds BSC USDC balances for trading steps
- The script uses BSC USDC at `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`
