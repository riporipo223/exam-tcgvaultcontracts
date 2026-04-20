// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface ITCGVaultFounderNFT {
    /// @notice Active paid Founder mints (non-cancelled); excludes strategic reserve.
    function soldCount() external view returns (uint256);

    /// @notice Strategic reserve NFTs minted (max 10).
    function strategicReserveMinted() external view returns (uint256);

    /// @notice Effective wave-2 start timestamp (time-based default, accelerated on wave-1 sellout).
    function wave2StartTimestamp() external view returns (uint256);

    /// @notice Owner-only: mint one strategic reserve NFT (no USDC / no NEXUS).
    function mintStrategicReserve(address to) external;
}

