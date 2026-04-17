// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Mock TCGV for tests: ERC20 with mintPresale(to, amount) callable by initialLaunch (e.g. InitialLaunch).
contract MockTCGVPresale is ERC20, Ownable {
    address public initialLaunch;

    error OnlyInitialLaunch();

    constructor() ERC20("Mock TCGV", "mTCGV") Ownable(msg.sender) {}

    function setInitialLaunch(address _initialLaunch) external onlyOwner {
        initialLaunch = _initialLaunch;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function mintPresale(address to, uint256 amount) external {
        if (msg.sender != initialLaunch) revert OnlyInitialLaunch();
        if (to != address(0) && amount > 0) _mint(to, amount);
    }

    function burnPresaleAllocation(address from, uint256 amount) external {
        if (msg.sender != initialLaunch) revert OnlyInitialLaunch();
        if (from != address(0) && amount > 0) _burn(from, amount);
    }

    /// @notice No-op for tests where InitialLaunch calls finalizePresale().
    function finalizePresale() external {}

    /// @notice No-op for tests where InitialLaunch calls recomputeSupplyAndBurn().
    function recomputeSupplyAndBurn() external {}

    /// @notice No-op for tests where InitialLaunch calls finalizePresaleAndRecompute().
    function finalizePresaleAndRecompute() external {}
}
