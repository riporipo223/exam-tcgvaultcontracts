// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IRouter.sol";

/// @notice Token may set transient fee-exempt (EIP-1153 is per-contract; wrapper calls token so token's tstore is visible in token's _update).
interface ITransientFeeExemptToken {
    function setTransientFeeExempt(bool exempt) external;
}

/// @notice Router not in the allowed list.
error RouterNotAllowed();

/**
 * @title TCGVaultLiquidityWrapper
 * @notice Add/remove liquidity for TCGV/USDC pool on multiple DEXes (e.g. PancakeSwap, Uniswap) without redeploying. Per-router config: fee-exempt (no TCGV fees on LP moves) or fees enforced.
 * @dev For each router, owner sets allowed and whether to set token transient fee-exempt. When fee-exempt, TCGV does not charge fees on add/remove liquidity (whitepaper). User supplies both TCGV and quote token (e.g. USDC).
 */
contract TCGVaultLiquidityWrapper is Ownable {
    /// @notice The TCGV token for which transient fee-exempt can be toggled.
    address public immutable tcgvToken;
    /// @notice Routers that can be used for add/remove liquidity.
    mapping(address => bool) private _allowedRouters;
    /// @notice When true, token.setTransientFeeExempt(true) is used around the router call (no fees). When false, fees apply.
    mapping(address => bool) private _feeExemptForRouter;

    // External getters (private/external pattern)
    function allowedRouters(address router) external view returns (bool) {
        return _allowedRouters[router];
    }

    function feeExemptForRouter(address router) external view returns (bool) {
        return _feeExemptForRouter[router];
    }

    /// @param tcgvToken_ The TCGV token address (must match tokenA in add/remove liquidity).
    /// @param initialRouter Optional. If non-zero, set as allowed and fee-exempt for backward compatibility.
    constructor(address tcgvToken_, address initialRouter) Ownable(msg.sender) {
        if (tcgvToken_ == address(0)) revert();
        tcgvToken = tcgvToken_;
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

    /// @notice Add liquidity to TCGV/tokenB pool (e.g. TCGV/USDC). Caller must approve this contract for both tokens.
    function addLiquidity(
        address router,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (!_allowedRouters[router]) revert RouterNotAllowed();
        IERC20(tcgvToken).transferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);
        IERC20(tcgvToken).approve(router, amountADesired);
        IERC20(tokenB).approve(router, amountBDesired);
        bool isFeeExempt = _feeExemptForRouter[router];
        if (isFeeExempt) {
            ITransientFeeExemptToken(tcgvToken).setTransientFeeExempt(true);
        }
        (amountA, amountB, liquidity) = IRouter(router).addLiquidity(
            tcgvToken,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            msg.sender,
            deadline
        );
        if (isFeeExempt) {
            ITransientFeeExemptToken(tcgvToken).setTransientFeeExempt(false);
        }
        if (amountA < amountADesired) {
            IERC20(tcgvToken).transfer(msg.sender, amountADesired - amountA);
        }
        if (amountB < amountBDesired) {
            IERC20(tokenB).transfer(msg.sender, amountBDesired - amountB);
        }
    }

    /// @notice Remove liquidity from TCGV/tokenB pool. Caller must approve this contract for the LP token.
    function removeLiquidity(
        address router,
        address tokenB,
        address lpToken,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB) {
        if (!_allowedRouters[router]) revert RouterNotAllowed();
        IERC20(lpToken).transferFrom(msg.sender, address(this), liquidity);
        IERC20(lpToken).approve(router, liquidity);
        bool isFeeExempt = _feeExemptForRouter[router];
        if (isFeeExempt) {
            ITransientFeeExemptToken(tcgvToken).setTransientFeeExempt(true);
        }
        (amountA, amountB) = IRouter(router).removeLiquidity(
            tcgvToken,
            tokenB,
            liquidity,
            amountAMin,
            amountBMin,
            msg.sender,
            deadline
        );
        if (isFeeExempt) {
            ITransientFeeExemptToken(tcgvToken).setTransientFeeExempt(false);
        }
    }
}
