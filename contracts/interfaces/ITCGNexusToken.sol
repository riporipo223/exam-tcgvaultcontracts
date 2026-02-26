// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITCGNexusToken {
    function mintCashback(address recipient, uint256 amount) external;
    function mintPresaleBonus(address recipient, uint256 amount) external;
}

