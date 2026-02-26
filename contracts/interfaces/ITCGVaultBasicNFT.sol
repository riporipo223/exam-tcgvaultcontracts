// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITCGVaultBasicNFT {
    /// @notice Mints one Basic NFT for `account` if they have enough stake. Only callable by the staking vault (e.g. after deposit).
    function mintFor(address account) external;
    /// @notice Burns all Basic NFTs held by `owner`. Only callable by the staking vault when stake drops below minimum.
    function burnAllFor(address owner) external;
}

