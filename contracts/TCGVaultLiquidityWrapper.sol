// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IRouter} from "./interfaces/IRouter.sol";

/// @notice Router not in the allowed list.
error RouterNotAllowed();

/**
 * @title TCGVaultLiquidityWrapper
 * @notice Add/remove liquidity for TCGV/tokenB (e.g. USDC) on allowed V2 routers without redeploying.
 * @dev The token **must** fee-exclude `address(this)` via `TCGVaultToken.setExcludedFromFees(wrapper, true)` so that
 *      (1) add: TCGV moves wrapper→pair with `from` excluded, and (2) remove: pair→wrapper with `to` excluded.
 *      Removing liquidity uses `to = address(this)` on the router, then this contract forwards tokens to the user
 *      so the pair→EOA transfer (otherwise taxed as a “buy”) never happens on-chain.
 */
contract TCGVaultLiquidityWrapper is Ownable2Step {
    event AllowedRouterUpdated(address router, bool allowed);

    /// @notice The TCGV token this wrapper pulls and forwards.
    address public immutable tcgvToken;
    /// @notice Routers that may be used for add/remove liquidity.
    mapping(address => bool) private _allowedRouters;

    function allowedRouters(address router) external view returns (bool) {
        return _allowedRouters[router];
    }

    /// @param tcgvToken_ The TCGV token address (tokenA in add/remove liquidity).
    /// @param initialRouter If non-zero, registered as allowed.
    constructor(address tcgvToken_, address initialRouter) Ownable(msg.sender) {
        if (tcgvToken_ == address(0)) revert();
        tcgvToken = tcgvToken_;
        if (initialRouter != address(0)) {
            _allowedRouters[initialRouter] = true;
            emit AllowedRouterUpdated(initialRouter, true);
        }
    }

    function setAllowedRouter(address router, bool allowed) external onlyOwner {
        _allowedRouters[router] = allowed;
        emit AllowedRouterUpdated(router, allowed);
    }

    /// @notice Add liquidity. Caller approves this contract for TCGV and tokenB. LP tokens go to caller.
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
        if (amountA < amountADesired) {
            IERC20(tcgvToken).transfer(msg.sender, amountADesired - amountA);
        }
        if (amountB < amountBDesired) {
            IERC20(tokenB).transfer(msg.sender, amountBDesired - amountB);
        }
    }

    /// @notice Remove liquidity. Router sends withdrawn tokens to this contract; we forward to caller.
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
        uint256 tcgvBefore = IERC20(tcgvToken).balanceOf(address(this));
        uint256 tokenBBefore = IERC20(tokenB).balanceOf(address(this));
        IRouter(router).removeLiquidity(
            tcgvToken,
            tokenB,
            liquidity,
            amountAMin,
            amountBMin,
            address(this),
            deadline
        );
        // Forward by balance delta (pair token0/token1 order may differ from TCGV/tokenB param order).
        uint256 tcgvOut = IERC20(tcgvToken).balanceOf(address(this)) - tcgvBefore;
        uint256 tokenBOut = IERC20(tokenB).balanceOf(address(this)) - tokenBBefore;
        if (tcgvOut > 0) {
            IERC20(tcgvToken).transfer(msg.sender, tcgvOut);
        }
        if (tokenBOut > 0) {
            IERC20(tokenB).transfer(msg.sender, tokenBOut);
        }
        return (tcgvOut, tokenBOut);
    }
}
