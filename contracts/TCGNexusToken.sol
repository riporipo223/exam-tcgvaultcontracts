// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TCGNexusToken (TCG-NEXUS)
 * @notice Jeton de Cœur — gouvernance et appartenance à la Guilde TCG-VAULT (whitepaper §5.5).
 * @dev Soulbound (non transférable). Obtention : cashback à l'achat de TCGV. Minter = TCGVaultToken uniquement.
 */
contract TCGNexusToken is ERC20, Ownable {
    /// @notice Minter can only be the TCGVaultToken contract.
    error OnlyMinter();
    /// @notice Recipient cannot be the zero address.
    error ZeroAddress();
    /// @notice Amount must be greater than zero.
    error ZeroAmount();
    /// @notice Nexus is Soulbound; transfers between accounts are not allowed (whitepaper).
    error SoulboundTransferNotAllowed();

    /// @notice TCGVaultToken contract; only it can mint cashback. Set at deployment, immutable.
    address public immutable minter;

    event CashbackMinted(address indexed recipient, uint256 amount);

    /// @notice Whitepaper: TCG-NEXUS, NEXUS. Obtention par cashback; pas d'offre initiale.
    constructor(address minter_) ERC20("TCG-NEXUS", "NEXUS") Ownable(msg.sender) {
        if (minter_ == address(0)) revert ZeroAddress();
        minter = minter_;
    }

    /**
     * @notice Soulbound: only mint (from zero) and burn (to zero) allowed; no transfers between accounts.
     */
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) revert SoulboundTransferNotAllowed();
        super._update(from, to, amount);
    }

    /**
     * @notice Mint tokens for cashback. Only callable by the TCGVaultToken contract (minter).
     */
    function mintCashback(address recipient, uint256 amount) external {
        if (msg.sender != minter) revert OnlyMinter();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        _mint(recipient, amount);
        emit CashbackMinted(recipient, amount);
    }

    /**
     * @notice Mint tokens (only owner, for presale/initial distribution — e.g. 30% Nexus bonus presale).
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        _mint(to, amount);
    }
}
