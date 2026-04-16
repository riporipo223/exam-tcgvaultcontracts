// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "../interfaces/ITCGVaultBasicNFT.sol";

/// @notice Mock staking vault that reports balance below min so Basic NFT mintFor returns early (coverage).
contract MockStakingForBasicNFT {
    uint256 public constant MIN = 100e18;

    function minStakeForBasicNFT() external pure returns (uint256) {
        return MIN;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function triggerMintFor(ITCGVaultBasicNFT nft, address account) external {
        nft.mintFor(account);
    }
}
