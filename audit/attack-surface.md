# TCG Vault Attack Surface

## Critical Contracts

### TCGVaultToken.sol

Functions:
- transfer
- transferFrom
- _update
- setBuyFeeParams
- setSellFeeParams
- executePendingAutolp
- burnPresaleAllocation
- blacklist
- pause

Risks:
- fee bypass
- privilege abuse
- balance manipulation
- tax bypass
- supply manipulation


### TCGVaultBuyRouter.sol

Functions:
- buyTCGVWithUSDC
- sellTCGVForUSDC
- claimUsdcFees

Risks:
- slippage
- incorrect fee calculation
- price manipulation
- token accounting


### TCGVaultStakingVault.sol

Functions:
- deposit
- withdraw
- redeem
- convertToShares
- convertToAssets

Risks:
- ERC4626 inflation attack
- rounding
- share manipulation


### TCGVaultInitialLaunch.sol

Risks:
- presale bypass
- vesting bypass
- claim duplication
- timestamp manipulation


### TCGRToken.sol

Risks:
- mint abuse
- referral abuse
- vesting bypass


### TCGVaultFounderNFT.sol

Risks:
- supply bypass
- price manipulation
- refund abuse
