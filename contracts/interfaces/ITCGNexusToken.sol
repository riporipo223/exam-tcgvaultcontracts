// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface ITCGNexusToken {
    function mintCashback(address recipient, uint256 amount) external;
    function mintPresaleBonus(address recipient, uint256 amount) external;
    /// @notice Claw back presale bonus NEXUS from `holder` (MiCA cooling-off cancellations).
    /// @dev Callable only by immutable FounderNFT or InitialLaunch contracts set at NEXUS deploy.
    function clawBackPresaleBonus(address holder, uint256 amount) external;
}

