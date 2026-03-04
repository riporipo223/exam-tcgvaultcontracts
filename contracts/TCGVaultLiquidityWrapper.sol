// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IRouter.sol";

/// @notice Token may set transient fee-exempt (EIP-1153 is per-contract; wrapper calls token so token's tstore is visible in token's _update).
interface ITransientFeeExemptToken {
    function setTransientFeeExempt(uint256 value) external;
}

/// @notice ETH refund to caller failed.
error RefundETHFailed();
/// @notice Only an allowed router may send ETH (refund from addLiquidity); use addLiquidityETH to add liquidity.
error OnlyAllowedRouterCanSendETH();
/// @notice Router not in the allowed list.
error RouterNotAllowed();

/**
 * @title TCGVaultLiquidityWrapper
 * @notice Add/remove liquidity on multiple DEXes (e.g. PancakeSwap, Uniswap) without redeploying. Per-router config: fee-exempt (no TCGV fees on LP moves) or fees enforced.
 * @dev For each router, owner sets allowed and whether to set token transient fee-exempt. When fee-exempt, TCGV does not charge fees on add/remove liquidity (whitepaper). When not fee-exempt, normal token fees apply (e.g. enforce fees on Uniswap).
 *      ETH is only accepted from allowed routers (refund). LP/token are pulled per call and forwarded to msg.sender.
 */
contract TCGVaultLiquidityWrapper is Ownable {
    /// @notice Routers that can be used for add/remove liquidity and that may send ETH refunds to this contract.
    mapping(address => bool) private _allowedRouters;
    /// @notice When true, token.setTransientFeeExempt(1) is used around the router call (no fees). When false, fees apply.
    mapping(address => bool) private _feeExemptForRouter;

    // External getters (private/external pattern)
    function allowedRouters(address router) external view returns (bool) {
        return _allowedRouters[router];
    }

    function feeExemptForRouter(address router) external view returns (bool) {
        return _feeExemptForRouter[router];
    }

    /// @param initialRouter Optional. If non-zero, set as allowed and fee-exempt for backward compatibility.
    constructor(address initialRouter) Ownable(msg.sender) {
        if (initialRouter != address(0)) {
            _allowedRouters[initialRouter] = true;
            _feeExemptForRouter[initialRouter] = true;
        }
    }

    function setAllowedRouter(address router, bool allowed) external onlyOwner {
        _allowedRouters[router] = allowed;
    }

    function setFeeExemptForRouter(address router, bool exempt) external onlyOwner {
        _feeExemptForRouter[router] = exempt;
    }

    function addLiquidityETH(
        address router,
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        if (!_allowedRouters[router]) revert RouterNotAllowed();
        IERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired);
        IERC20(token).approve(router, amountTokenDesired);
        if (_feeExemptForRouter[router]) {
            ITransientFeeExemptToken(token).setTransientFeeExempt(1);
        }
        (amountToken, amountETH, liquidity) = IRouter(router).addLiquidityETH{value: msg.value}(
            token,
            amountTokenDesired,
            amountTokenMin,
            amountETHMin,
            msg.sender,
            deadline
        );
        if (_feeExemptForRouter[router]) {
            ITransientFeeExemptToken(token).setTransientFeeExempt(0);
        }
        if (amountToken < amountTokenDesired) {
            IERC20(token).transfer(msg.sender, amountTokenDesired - amountToken);
        }
        if (address(this).balance > 0) {
            (bool ok,) = msg.sender.call{value: address(this).balance}("");
            if (!ok) revert RefundETHFailed();
        }
    }

    /// @notice Only accepts ETH from an allowed router (excess ETH refund from addLiquidity).
    receive() external payable {
        if (!_allowedRouters[msg.sender]) revert OnlyAllowedRouterCanSendETH();
    }

    function removeLiquidityETH(
        address router,
        address token,
        address lpToken,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH) {
        if (!_allowedRouters[router]) revert RouterNotAllowed();
        IERC20(lpToken).transferFrom(msg.sender, address(this), liquidity);
        IERC20(lpToken).approve(router, liquidity);
        if (_feeExemptForRouter[router]) {
            ITransientFeeExemptToken(token).setTransientFeeExempt(1);
        }
        (amountToken, amountETH) = IRouter(router).removeLiquidityETH(
            token,
            liquidity,
            amountTokenMin,
            amountETHMin,
            msg.sender,
            deadline
        );
        if (_feeExemptForRouter[router]) {
            ITransientFeeExemptToken(token).setTransientFeeExempt(0);
        }
    }
}
