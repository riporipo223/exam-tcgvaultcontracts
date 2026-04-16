// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface ITCGVaultToken {
    function recordBuyAndMintCashback(address recipient, uint256 tcgvAmount) external;
}

/**
 * @notice Test helper: acts as buyRouter to cover TCGVaultToken recordBuyAndMintCashback.
 */
contract TestBuyRouter {
    ITCGVaultToken public token;

    function setToken(address token_) external {
        token = ITCGVaultToken(token_);
    }

    function callRecordBuyAndMintCashback(address recipient, uint256 tcgvAmount) external {
        token.recordBuyAndMintCashback(recipient, tcgvAmount);
    }
}
