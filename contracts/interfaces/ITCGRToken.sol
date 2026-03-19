// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITCGRToken {
    function mintReferral(address referrer, uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}
