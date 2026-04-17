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
   - **Buy via PancakeSwap Router:** USDC -> TCGV with token-side buy fees
   - **Buy via TCGVaultBuyRouter:** USDC fee path (5% USDC fee = 3% vault + 2% marketing, then swap to TCGV; no TCGV burn)
   - **Direct Pair Swap:** Non-router path (direct pair interaction)
   - **Sell via PancakeSwap Router:** Sell TCGV for USDC with token-side sell fees
   - **Sell via TCGVaultBuyRouter:** TCGV -> USDC with 4% USDC fee split (vault + marketing)

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
