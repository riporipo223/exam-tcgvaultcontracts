// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice ETH refund to caller failed.
error RefundETHFailed();
/// @notice Only the router may send ETH (refund from addLiquidity); use addLiquidityETH to add liquidity.
error OnlyRouterCanSendETH();

/// @notice Router interface for add/remove liquidity (Uniswap V2 / PancakeSwap compatible).
interface IRouter {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH);
}

/**
 * @title TCGVaultLiquidityWrapper
 * @notice Use this contract to add/remove liquidity so TCGV does not charge fees on those transfers (whitepaper: no fees on LP supply/remove).
 * @dev Sets transient storage (EIP-1153) before calling the router; TCGVaultToken skips fees when this slot is set.
 *      Withdrawals from users: only via transferFrom when the user has approved this contract and calls addLiquidityETH/removeLiquidityETH (caller's own funds).
 *      No one can withdraw from this contract: ETH is only accepted from the router (refund); token/LP are pulled per call and forwarded in the same tx. No balance is held for third parties.
 */
contract TCGVaultLiquidityWrapper {
    uint256 private constant FEE_EXEMPT_SLOT = 0;

    address public immutable router;

    constructor(address router_) {
        router = router_;
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        IERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired);
        IERC20(token).approve(router, amountTokenDesired);
        assembly {
            tstore(FEE_EXEMPT_SLOT, 1)
        }
        (amountToken, amountETH, liquidity) = IRouter(router).addLiquidityETH{value: msg.value}(
            token,
            amountTokenDesired,
            amountTokenMin,
            amountETHMin,
            to,
            deadline
        );
        assembly {
            tstore(FEE_EXEMPT_SLOT, 0)
        }
        if (amountToken < amountTokenDesired) {
            IERC20(token).transfer(msg.sender, amountTokenDesired - amountToken);
        }
        if (address(this).balance > 0) {
            (bool ok,) = msg.sender.call{value: address(this).balance}("");
            if (!ok) revert RefundETHFailed();
        }
    }

    /// @notice Only accepts ETH from the router (excess ETH refund from addLiquidity). Reverts on direct sends so no one can drain the contract and no one can be front-run for refunds.
    receive() external payable {
        if (msg.sender != router) revert OnlyRouterCanSendETH();
    }

    function removeLiquidityETH(
        address token,
        address lpToken,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH) {
        IERC20(lpToken).transferFrom(msg.sender, address(this), liquidity);
        IERC20(lpToken).approve(router, liquidity);
        assembly {
            tstore(FEE_EXEMPT_SLOT, 1)
        }
        (amountToken, amountETH) = IRouter(router).removeLiquidityETH(
            token,
            liquidity,
            amountTokenMin,
            amountETHMin,
            to,
            deadline
        );
        assembly {
            tstore(FEE_EXEMPT_SLOT, 0)
        }
    }
}
