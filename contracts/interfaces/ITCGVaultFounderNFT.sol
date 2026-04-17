// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface ITCGVaultFounderNFT {
    /// @notice Return total Founder NFTs sold (paid mints).
    /// @return Number of Founder NFTs minted/sold so far.
    function soldCount() external view returns (uint256);

    /// @notice Return effective wave-2 start timestamp (time-based default, accelerated on wave-1 sellout).
    /// @return UNIX timestamp for wave 2 start.
    function wave2StartTimestamp() external view returns (uint256);
}

