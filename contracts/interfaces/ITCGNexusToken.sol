// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface ITCGNexusToken {
    /// @notice Mint NEXUS cashback to a recipient after a validated TCGV buy.
    /// @param recipient Address that receives minted NEXUS.
    /// @param amount Amount of NEXUS to mint (18 decimals).
    function mintCashback(address recipient, uint256 amount) external;

    /// @notice Mint the presale NEXUS bonus for FounderNFT/InitialLaunch purchases.
    /// @param recipient Address that receives the presale bonus.
    /// @param amount Amount of bonus NEXUS to mint (18 decimals).
    function mintPresaleBonus(address recipient, uint256 amount) external;

    /// @notice Claw back presale bonus NEXUS from `holder` (MiCA cooling-off cancellations).
    /// @dev Callable only by immutable FounderNFT or InitialLaunch contracts set at NEXUS deploy.
    /// @param holder Address whose presale bonus is burned.
    /// @param amount Amount of NEXUS to claw back (burn).
    function clawBackPresaleBonus(address holder, uint256 amount) external;
}

