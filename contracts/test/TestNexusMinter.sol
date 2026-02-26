// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITCGNexusToken {
    function mintCashback(address recipient, uint256 amount) external;
    function mintPresaleBonus(address recipient, uint256 amount) external;
}

/**
 * Test helper: acts as minter for TCGNexusToken to cover revert branches (ZeroAddress, ZeroAmount).
 */
contract TestNexusMinter {
    function mintCashback(ITCGNexusToken nexus, address recipient, uint256 amount) external {
        nexus.mintCashback(recipient, amount);
    }

    function mintPresaleBonus(ITCGNexusToken nexus, address recipient, uint256 amount) external {
        nexus.mintPresaleBonus(recipient, amount);
    }
}
