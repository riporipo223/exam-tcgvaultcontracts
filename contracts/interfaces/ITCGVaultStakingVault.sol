// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Staking vault surface used by `TCGVaultToken` (seize) and `TCGVaultBasicNFT` (min stake + share balance).
interface ITCGVaultStakingVault {
    function minStakeForBasicNFT() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    /// @notice Redeems all `account` shares to the asset token's vault. Only callable by `asset()`.
    function forceWithdrawFromBlacklist(address account) external;
}
