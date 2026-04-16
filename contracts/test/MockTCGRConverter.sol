// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "../interfaces/ITCGRToken.sol";

/// @notice Mock converter to test TCGRToken.burnFrom paths (coverage).
contract MockTCGRConverter {
    function burnZero(ITCGRToken tcgr, address account) external {
        tcgr.burnFrom(account, 0);
    }

    function burnFromZeroAddress(ITCGRToken tcgr) external {
        tcgr.burnFrom(address(0), 1);
    }
}
