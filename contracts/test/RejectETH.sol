// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Used in tests to simulate recipients rejecting native BNB/ETH.
contract RejectETH {
    receive() external payable {
        revert("REJECT_ETH");
    }
}

/// @notice Legacy helper for router-path sell tests.
interface ITCGVaultBuyRouter {
    function sellTCGVForUSDC(uint256 amountIn, uint256 amountOutMin, uint256 deadline) external;
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract SellerRejectETH {
    receive() external payable {
        revert("REJECT_ETH");
    }

    /// @notice Approve router then sell; when called from EOA, msg.sender in approve is this contract so router can pull from this contract.
    function sellTCGVForUSDC(address tcgv, address router, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external {
        IERC20(tcgv).approve(router, amountIn);
        ITCGVaultBuyRouter(router).sellTCGVForUSDC(amountIn, amountOutMin, deadline);
    }
}
