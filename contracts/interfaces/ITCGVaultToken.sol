// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITCGVaultToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function recordBuyAndMintCashback(address recipient, uint256 tcgvAmount) external;
    function burn(uint256 amount) external;
    /// @notice Burn presale allocations from an address. Only callable by the presale finalizer.
    function burnPresale(address from, uint256 amount) external;
    /// @notice Mint presale TCGV; only callable by presale finalizer (e.g. launch contract) during presale.
    function mintPresale(address to, uint256 amount) external;
    /// @notice Finalize presale and recompute supply: 20% liquidity, 4% team vesting, 5% ops direct, 11% ops vesting.
    function finalizePresaleAndRecompute() external;
}

