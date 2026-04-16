// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Minimal interface for TCGVaultInitialLaunch so TCGVaultToken can read presale sold amount (no owner input).
interface ITCGVaultInitialLaunch {
    function totalTCGVAllocated() external view returns (uint256);
}
