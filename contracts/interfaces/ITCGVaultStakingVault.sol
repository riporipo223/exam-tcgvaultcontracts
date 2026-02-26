// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITCGVaultStakingVault {
    function balanceOf(address account) external view returns (uint256);
    function minStakeForBasicNFT() external view returns (uint256);
}

