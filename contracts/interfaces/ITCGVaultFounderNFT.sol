// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface ITCGVaultFounderNFT {
    /// @notice Return total Founder NFTs sold (paid mints).
    /// @return Number of Founder NFTs minted/sold so far.
    function soldCount() external view returns (uint256);

    /// @notice Return timestamp when wave 2 started (250th Founder NFT sold).
    /// @return UNIX timestamp for wave 2 start, or zero when wave 1 is still active.
    function wave2StartTimestamp() external view returns (uint256);
}

