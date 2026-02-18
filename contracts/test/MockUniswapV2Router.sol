// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./MockUniswapV2Factory.sol";
import "./MockUniswapV2Pair.sol";
import "./MockWETH.sol";

contract MockUniswapV2Router {
    address public immutable factory;
    address public immutable WETH;

    constructor(address _factory, address _WETH) {
        factory = _factory;
        WETH = _WETH;
    }

    receive() external payable {
        assert(msg.sender == WETH);
    }

    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pair = MockUniswapV2Factory(factory).getPair(token0, token1);
    }

    function _getReserves(address tokenA, address tokenB) internal view returns (uint256 reserveA, uint256 reserveB) {
        (address token0,) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        (uint112 reserve0, uint112 reserve1,) = MockUniswapV2Pair(_pairFor(tokenA, tokenB)).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(deadline >= block.timestamp, "EXPIRED");
        address pair = _pairFor(token, WETH);
        if (MockUniswapV2Factory(factory).getPair(token, WETH) == address(0)) {
            MockUniswapV2Factory(factory).createPair(token, WETH);
            pair = _pairFor(token, WETH);
        }
        (uint256 reserveToken, uint256 reserveWETH) = _getReserves(token, WETH);
        if (reserveToken == 0 && reserveWETH == 0) {
            amountToken = amountTokenDesired;
            amountETH = msg.value;
        } else {
            uint256 amountETHOptimal = (amountTokenDesired * reserveWETH) / reserveToken;
            if (amountETHOptimal <= msg.value) {
                require(amountETHOptimal >= amountETHMin, "INSUFFICIENT_ETH");
                amountToken = amountTokenDesired;
                amountETH = amountETHOptimal;
            } else {
                uint256 amountTokenOptimal = (msg.value * reserveToken) / reserveWETH;
                require(amountTokenOptimal >= amountTokenMin, "INSUFFICIENT_TOKEN");
                amountToken = amountTokenOptimal;
                amountETH = msg.value;
            }
        }
        IERC20(token).transferFrom(msg.sender, pair, amountToken);
        MockWETH(payable(WETH)).deposit{value: amountETH}();
        IERC20(WETH).transfer(pair, amountETH);
        liquidity = MockUniswapV2Pair(pair).mint(to);
        if (msg.value > amountETH) {
            (bool ok,) = msg.sender.call{value: msg.value - amountETH}("");
            require(ok, "REFUND_FAILED");
        }
    }

    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH) {
        require(deadline >= block.timestamp, "EXPIRED");
        address pair = _pairFor(token, WETH);
        IERC20(pair).transferFrom(msg.sender, pair, liquidity);
        (amountToken, amountETH) = MockUniswapV2Pair(pair).burn(address(this));
        require(amountToken >= amountTokenMin && amountETH >= amountETHMin, "INSUFFICIENT_AMOUNTS");
        IERC20(token).transfer(to, IERC20(token).balanceOf(address(this)));
        uint256 wethBal = IERC20(WETH).balanceOf(address(this));
        if (wethBal > 0) {
            MockWETH(payable(WETH)).withdraw(wethBal);
            (bool ok,) = to.call{value: wethBal}("");
            require(ok, "ETH_TRANSFER_FAILED");
        }
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "EXPIRED");
        require(path.length >= 2 && path[0] == WETH, "INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = msg.value;
        MockWETH(payable(WETH)).deposit{value: msg.value}();
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = _getReserves(path[i], path[i + 1]);
            amounts[i + 1] = _getAmountOut(amounts[i], reserveIn, reserveOut);
        }
        require(amounts[path.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT");
        IERC20(WETH).transfer(_pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "EXPIRED");
        require(path.length >= 2 && path[path.length - 1] == WETH, "INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        IERC20(path[0]).transferFrom(msg.sender, _pairFor(path[0], path[1]), amountIn);
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = _getReserves(path[i], path[i + 1]);
            amounts[i + 1] = _getAmountOut(amounts[i], reserveIn, reserveOut);
        }
        require(amounts[path.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT");
        _swap(amounts, path, address(this));
        MockWETH(payable(WETH)).withdraw(amounts[path.length - 1]);
        (bool ok,) = to.call{value: amounts[path.length - 1]}("");
        require(ok, "ETH_TRANSFER_FAILED");
    }

    function _swap(uint256[] memory amounts, address[] calldata path, address _to) internal {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = input < output ? (input, output) : (output, input);
            uint256 amount0Out = input == token0 ? 0 : amounts[i + 1];
            uint256 amount1Out = input == token0 ? amounts[i + 1] : 0;
            address to = i < path.length - 2 ? _pairFor(output, path[i + 2]) : _to;
            MockUniswapV2Pair(_pairFor(input, output)).swap(amount0Out, amount1Out, to, "");
        }
    }
}
