// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title FeeReceiver
 * @notice Simple payable receiver for fork/integration tests.
 */
contract FeeReceiver {
    uint256 public received;

    event Received(address indexed from, uint256 amount);

    receive() external payable {
        received += msg.value;
        emit Received(msg.sender, msg.value);
    }
}

