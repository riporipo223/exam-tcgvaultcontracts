// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Staking vault surface used by `TCGVaultToken` (seize) and `TCGVaultBasicNFT` (min stake + share balance).
interface ITCGVaultStakingVault {
    /// @notice Return minimum shares required to keep a Basic NFT.
    /// @return Minimum stake threshold expressed in vault shares.
    function minStakeForBasicNFT() external view returns (uint256);

    /// @notice Return share balance for an account in the staking vault.
    /// @param account Address whose sTCGV balance is queried.
    /// @return Share balance held by `account`.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Redeems all `account` shares to the asset token's vault. Only callable by `asset()`.
    /// @param account Address whose shares are force-redeemed.
    function forceWithdrawFromBlacklist(address account) external;
}
