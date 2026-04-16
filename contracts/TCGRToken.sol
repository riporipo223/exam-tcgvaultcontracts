// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TCGRToken (TCGR)
 * @notice Jeton de parrainage — récompenses referral pour achats validés via routeur uniquement.
 * @dev Soulbound (non transférable). À l'inscription on enregistre un parrain une seule fois (non révocable).
 *      Seuls les achats validés via le BuyRouter déclenchent 0,5 % en TCGR pour le parrain (whitepaper).
 *      L'owner peut bannir un parrain ou un filleul du programme (fraude) : plus de récompenses TCGR pour ces achats.
 */
contract TCGRToken is ERC20, Ownable {
    error OnlyMinter();
    error OnlyConverter();
    error ZeroAddress();
    error ZeroAmount();
    error SoulboundTransferNotAllowed();
    error InsufficientBalance();
    error ReferrerAlreadySet();
    error SelfReferralNotAllowed();

    /// @notice 0.5% of USDC (6 decimals) value minted as TCGR (18 decimals) per validated buy.
    uint256 public constant REFERRAL_BP = 50;

    address private _minter;
    address private _converter;

    /// @notice referee => parrain (set once by referee at registration).
    mapping(address referee => address referrer) private _referrerOf;

    /// @notice If true, `processValidatedBuy` pays no TCGR for this address as buyer and mints nothing to this address as referrer.
    mapping(address account => bool) private _bannedFromReferralProgram;

    event ReferrerBound(address indexed referee, address indexed referrer);
    event ReferralRewarded(address indexed referee, address indexed referrer, uint256 amount);
    event ReferralProgramBanUpdated(address indexed account, bool banned);
    event Converted(address account, uint256 amount);
    event MinterUpdated(address minter);
    event ConverterUpdated(address converter);

    constructor(address minter_) ERC20("TCG-Referral", "TCGR") Ownable(msg.sender) {
        if (minter_ == address(0)) revert ZeroAddress();
        _minter = minter_;
        emit MinterUpdated(minter_);
        emit ConverterUpdated(address(0));
    }

    function minter() external view returns (address) {
        return _minter;
    }

    function converter() external view returns (address) {
        return _converter;
    }

    function referrerOf(address referee) external view returns (address) {
        return _referrerOf[referee];
    }

    function isBannedFromReferralProgram(address account) external view returns (bool) {
        return _bannedFromReferralProgram[account];
    }

    /// @notice Suspend referral rewards involving `account`: as **buyer** (no reward to their referrer) or as **referrer** (no rewards from any referee).
    function setBannedFromReferralProgram(address account, bool banned) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        _bannedFromReferralProgram[account] = banned;
        emit ReferralProgramBanUpdated(account, banned);
    }

    /**
     * @notice Set the only address allowed to record validated buys (e.g. TCGVaultBuyRouter).
     */
    function setMinter(address minter_) external onlyOwner {
        if (minter_ == address(0)) revert ZeroAddress();
        _minter = minter_;
        emit MinterUpdated(minter_);
    }

    /**
     * @notice Set the converter contract that can burn TCGR in exchange for TCGV.
     */
    function setConverter(address converter_) external onlyOwner {
        _converter = converter_;
        emit ConverterUpdated(converter_);
    }

    /**
     * @notice Attach to a referrer once. Cannot be changed or cleared. Cannot refer yourself.
     * @dev Durable sponsorship link at registration (whitepaper). No TCGR is minted here.
     */
    function setReferrer(address referrer) external {
        if (referrer == address(0)) revert ZeroAddress();
        if (referrer == msg.sender) revert SelfReferralNotAllowed();
        if (_referrerOf[msg.sender] != address(0)) revert ReferrerAlreadySet();
        _referrerOf[msg.sender] = referrer;
        emit ReferrerBound(msg.sender, referrer);
    }

    /**
     * @notice After a validated USDC buy via router: mint 0.5% of USDC value (6→18 decimals) to the buyer's referrer.
     * @dev Only minter. No-op if buyer or referrer is banned, buyer has no referrer, or amount rounds to zero.
     */
    function processValidatedBuy(address buyer, uint256 usdcAmount) external {
        if (msg.sender != _minter) revert OnlyMinter();
        if (usdcAmount == 0) return;
        if (_bannedFromReferralProgram[buyer]) return;
        address ref = _referrerOf[buyer];
        if (ref == address(0)) return;
        if (_bannedFromReferralProgram[ref]) return;
        uint256 amount = (usdcAmount * 1e12 * REFERRAL_BP) / 10000;
        if (amount == 0) return;
        _mint(ref, amount);
        emit ReferralRewarded(buyer, ref, amount);
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
}
