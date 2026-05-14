// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IPancakePair} from "../interfaces/IPancakeV2.sol";

/// @notice PancakeSwap V2 / Uniswap V2 compatible cumulative price helpers (TWAP input).
library PancakeV2TWAPLib {
    uint224 internal constant Q112 = 2 ** 112;

    /// @dev Mirrors pair `_update`: per-second increment is `uint224((reserveNum * 2**112) / reserveDen)`.
    function priceFractionPerSecond(uint112 reserveNum, uint112 reserveDen) internal pure returns (uint256) {
        if (reserveDen == 0 || reserveNum == 0) return 0;
        return uint256(uint224((uint256(reserveNum) * Q112) / uint256(reserveDen)));
    }

    /// @dev Returns pair accumulators projected to `block.timestamp` (same semantics as Uniswap V2 oracle library).
    function currentCumulativePrices(address pair)
        internal
        view
        returns (uint256 price0Cumulative, uint256 price1Cumulative, uint32 blockTimestamp)
    {
        blockTimestamp = uint32(block.timestamp);
        IPancakePair p = IPancakePair(pair);
        price0Cumulative = p.price0CumulativeLast();
        price1Cumulative = p.price1CumulativeLast();
        (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) = p.getReserves();
        unchecked {
            if (blockTimestampLast != blockTimestamp && reserve0 != 0 && reserve1 != 0) {
                uint256 timeElapsed = uint256(uint32(blockTimestamp - blockTimestampLast));
                price0Cumulative += priceFractionPerSecond(reserve1, reserve0) * timeElapsed;
                price1Cumulative += priceFractionPerSecond(reserve0, reserve1) * timeElapsed;
            }
        }
    }
}
