// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Minimal contract that receives ETH and forwards it to a target. Used to test TCGVaultLiquidityWrapper.receive() (msg.sender must be allowed router).
contract ForwardETH {
    receive() external payable {}

    function forwardTo(address target) external {
        (bool ok,) = payable(target).call{value: address(this).balance}("");
        require(ok, "ForwardETH: send failed");
    }
}
