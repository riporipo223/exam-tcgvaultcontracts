// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITCGVaultFounderNFT {
    function soldCount() external view returns (uint256);
    function wave2StartTimestamp() external view returns (uint256);
}

