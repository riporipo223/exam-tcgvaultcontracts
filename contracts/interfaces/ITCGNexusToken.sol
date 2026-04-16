// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface ITCGNexusToken {
    function mintCashback(address recipient, uint256 amount) external;
    function mintPresaleBonus(address recipient, uint256 amount) external;
    /// @notice Burn presale bonus tokens from `holder`. Used for MiCA cooling-off cancellations.
    /// @dev Callable only by addresses authorized as presale minters (e.g. FounderNFT + InitialLaunch).
    function burnPresaleBonus(address holder, uint256 amount) external;
}

