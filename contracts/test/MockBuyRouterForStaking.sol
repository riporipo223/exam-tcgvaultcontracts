// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Minimal buy router surface used by TCGVaultStakingVault dynamic Basic NFT pricing tests.
contract MockBuyRouterForStaking {
    address public immutable factory;
    address public immutable usdc;
    address public immutable tcgv;

    constructor(address factory_, address usdc_, address tcgv_) {
        factory = factory_;
        usdc = usdc_;
        tcgv = tcgv_;
    }
}
