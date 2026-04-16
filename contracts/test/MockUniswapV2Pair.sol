// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUniswapV2Pair is ERC20 {
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    constructor() ERC20("Uniswap V2", "UNI-V2") {}

    function initialize(address _token0, address _token1) external {
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32) {
        return (reserve0, reserve1, 0);
    }

    function mint(address to) external returns (uint256 liquidity) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = _sqrt(amount0 * amount1) - 1000;
            _mint(DEAD, 1000); // lock minimum liquidity (OZ ERC20 rejects address(0))
        } else {
            liquidity = amount0 * _totalSupply / reserve0;
            uint256 l1 = amount1 * _totalSupply / reserve1;
            if (l1 < liquidity) liquidity = l1;
        }
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
    }

    function burn(address to) external returns (uint256 amount0, uint256 amount1) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));
        uint256 _totalSupply = totalSupply();
        amount0 = liquidity * balance0 / _totalSupply;
        amount1 = liquidity * balance1 / _totalSupply;
        require(amount0 > 0 && amount1 > 0, "INSUFFICIENT_LIQUIDITY_BURNED");
        _burn(address(this), liquidity);
        IERC20(token0).transfer(to, amount0);
        IERC20(token1).transfer(to, amount1);
        balance0 = IERC20(token0).balanceOf(address(this));
        balance1 = IERC20(token1).balanceOf(address(this));
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        require(amount0Out > 0 || amount1Out > 0, "INSUFFICIENT_OUTPUT_AMOUNT");
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "INSUFFICIENT_LIQUIDITY");
        if (amount0Out > 0) IERC20(token0).transfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).transfer(to, amount1Out);
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
    }

    function sync() external {
        reserve0 = uint112(IERC20(token0).balanceOf(address(this)));
        reserve1 = uint112(IERC20(token1).balanceOf(address(this)));
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
