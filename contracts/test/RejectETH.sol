// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice Used in tests to simulate vault/marketing rejecting BNB
contract RejectETH {
    receive() external payable {
        revert("REJECT_ETH");
    }
}

/// @notice Seller that rejects BNB to trigger UserTransferFailed in BuyRouter tests
interface ITCGVaultBuyRouter {
    function sellTCGVForBNB(uint256 amountIn, uint256 amountOutMin, uint256 deadline) external;
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract SellerRejectETH {
    receive() external payable {
        revert("REJECT_ETH");
    }

    /// @notice Approve router then sell; when called from EOA, msg.sender in approve is this contract so router can pull from this contract
    function sellTCGVForBNB(address tcgv, address router, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external {
        IERC20(tcgv).approve(router, amountIn);
        ITCGVaultBuyRouter(router).sellTCGVForBNB(amountIn, amountOutMin, deadline);
    }
}
