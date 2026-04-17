// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Minimal interface for TCGVaultInitialLaunch so TCGVaultToken can read presale sold amount (no owner input).
interface ITCGVaultInitialLaunch {
    /// @notice Return total TCGV allocated during presale purchases (net of cancellations).
    /// @return Total allocated presale TCGV amount (18 decimals).
    function totalTCGVAllocated() external view returns (uint256);
}
