// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITCGRToken {
    function processValidatedBuy(address buyer, uint256 usdcAmount) external;
    function burnFrom(address account, uint256 amount) external;
    function referrerOf(address referee) external view returns (address);
}
