// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITCGRToken} from "./interfaces/ITCGRToken.sol";

/**
 * @title TCGRToTCGVConverter
 * @notice Convert TCGR (referral token, soulbound) into TCGV at a fixed ratio by burning TCGR and sending TCGV from this contract's treasury.
 * @dev Contract must be funded with TCGV. Ratio: amountTcgv = (amountTcgr * ratio) / 1e18 (both 18 decimals).
 */
contract TCGRToTCGVConverter is Ownable {
    using SafeERC20 for IERC20;

    IERC20 private immutable _tcgr;
    IERC20 private immutable _tcgv;
    uint256 private _ratio; // 1e18 TCGR -> ratio TCGV (18 decimals)

    event RatioUpdated(uint256 oldRatio, uint256 newRatio);
    event Converted(address user, uint256 tcgrBurned, uint256 tcgvOut);

    error ZeroAmount();
    error InsufficientTcgvReserve();
    error ZeroRatio();

    constructor(address tcgr_, address tcgv_, uint256 ratio_) Ownable(msg.sender) {
        _tcgr = IERC20(tcgr_);
        _tcgv = IERC20(tcgv_);
        if (ratio_ == 0) revert ZeroRatio();
        _ratio = ratio_;
        emit RatioUpdated(0, ratio_);
    }

    function tcgr() external view returns (address) {
        return address(_tcgr);
    }

    function tcgv() external view returns (address) {
        return address(_tcgv);
    }

    function ratio() external view returns (uint256) {
        return _ratio;
    }

    /**
     * @notice How much TCGV the user would receive for burning tcgrAmount TCGR.
     */
    function getTcgvOut(uint256 tcgrAmount) external view returns (uint256) {
        return (tcgrAmount * _ratio) / 1e18;
    }

    /**
     * @notice Set the conversion ratio: 1e18 TCGR = ratio TCGV (18 decimals).
     */
    function setRatio(uint256 ratio_) external onlyOwner {
        if (ratio_ == 0) revert ZeroRatio();
        uint256 old = _ratio;
        _ratio = ratio_;
        emit RatioUpdated(old, ratio_);
    }

    /**
     * @notice Burn tcgrAmount TCGR and send (tcgrAmount * ratio) / 1e18 TCGV to msg.sender.
     * @dev Caller must have approved this contract on TCGR for at least `tcgrAmount` (ERC-20 allowance). This contract must be set as the TCGR converter.
     */
    function convert(uint256 tcgrAmount) external {
        if (tcgrAmount == 0) revert ZeroAmount();
        uint256 tcgvOut = (tcgrAmount * _ratio) / 1e18;
        if (tcgvOut == 0) revert ZeroAmount();
        if (_tcgv.balanceOf(address(this)) < tcgvOut) revert InsufficientTcgvReserve();

        ITCGRToken(address(_tcgr)).burnForConversion(msg.sender, tcgrAmount);
        _tcgv.safeTransfer(msg.sender, tcgvOut);
        emit Converted(msg.sender, tcgrAmount, tcgvOut);
    }
}
