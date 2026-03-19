// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TCGRToken (TCGR)
 * @notice Jeton de parrainage — récompenses referral pour achats via routeur uniquement.
 * @dev Soulbound (non transférable). Chaque achat validé via le routeur déclenche 0,5 % en TCGR
 *      au profit du parrain. Crédité directement sur le wallet de l'ambassadeur.
 *      Convertible uniquement en carte cadeau (règles CGU, hors contrat).
 */
contract TCGRToken is ERC20, Ownable {
    error OnlyMinter();
    error OnlyConverter();
    error ZeroAddress();
    error ZeroAmount();
    error SoulboundTransferNotAllowed();
    error InsufficientBalance();

    address private _minter;
    address private _converter;

    function minter() external view returns (address) {
        return _minter;
    }

    function converter() external view returns (address) {
        return _converter;
    }

    event ReferralMinted(address indexed referrer, uint256 amount);
    event Converted(address indexed account, uint256 amount);

    constructor(address minter_) ERC20("TCG-Referral", "TCGR") Ownable(msg.sender) {
        if (minter_ == address(0)) revert ZeroAddress();
        _minter = minter_;
    }

    /**
     * @notice Set the only address allowed to mint referral rewards (e.g. TCGVaultBuyRouter).
     */
    function setMinter(address minter_) external onlyOwner {
        if (minter_ == address(0)) revert ZeroAddress();
        _minter = minter_;
    }

    /**
     * @notice Set the converter contract that can burn TCGR in exchange for TCGV.
     */
    function setConverter(address converter_) external onlyOwner {
        _converter = converter_;
    }

    /**
     * @notice Burn TCGR from an account. Only callable by the converter contract (when user converts TCGR → TCGV).
     */
    function burnFrom(address account, uint256 amount) external {
        if (msg.sender != _converter) revert OnlyConverter();
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) return;
        if (balanceOf(account) < amount) revert InsufficientBalance();
        _burn(account, amount);
        emit Converted(account, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) revert SoulboundTransferNotAllowed();
        super._update(from, to, amount);
    }

    /**
     * @notice Mint referral reward. Only callable by minter (BuyRouter).
     * @dev Récompenses calculées uniquement sur achats validés via routeur (hors annulation, fraude, remboursement).
     */
    function mintReferral(address referrer, uint256 amount) external {
        if (msg.sender != _minter) revert OnlyMinter();
        if (referrer == address(0)) revert ZeroAddress();
        if (amount == 0) return;
        _mint(referrer, amount);
        emit ReferralMinted(referrer, amount);
    }
}
