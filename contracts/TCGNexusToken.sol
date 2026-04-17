// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/**
 * @title TCGNexusToken (TCG-NEXUS)
 * @notice Jeton de Cœur — gouvernance et appartenance à la Guilde TCG-VAULT (whitepaper §4, §5).
 * @dev Soulbound (non transférable). Droit de vote : participation aux décisions d'acquisition du Vault.
 *      ERC-5805 / ERC20Votes for Tally.xyz and OZ Governor compatibility. EIP712 via ERC20Permit for delegateBySig.
 *      Obtention : cashback TCGV (minter) + bonus 30% prévente (immutable FounderNFT + InitialLaunch only).
 */
contract TCGNexusToken is ERC20Permit, ERC20Votes, Ownable2Step {
    /// @notice TCGVaultToken contract; only it can mint cashback. Set at deployment, immutable.
    address private immutable _minter;
    /// @notice Only these contracts may mint/burn the 30% presale NEXUS bonus (whitepaper §6, §7). Immutable.
    address private immutable _founderNFTPresaleBonus;
    address private immutable _initialLaunchPresaleBonus;

    event CashbackMinted(address recipient, uint256 amount);
    event PresaleBonusMinted(address recipient, uint256 amount);
    event OwnerMinted(address to, uint256 amount);
    event PresaleBonusClawedBack(address holder, uint256 amount);

    /// @notice Minter can only be the TCGVaultToken contract.
    error OnlyMinter();
    /// @notice Caller is neither FounderNFT nor InitialLaunch presale bonus contract.
    error OnlyPresaleBonusContract();
    /// @notice Recipient cannot be the zero address.
    error ZeroAddress();
    /// @notice Amount must be greater than zero.
    error ZeroAmount();
    /// @notice Nexus is Soulbound; transfers between accounts are not allowed (whitepaper).
    error SoulboundTransferNotAllowed();

    constructor(
        address minter_,
        address founderNFTPresaleBonus_,
        address initialLaunchPresaleBonus_
    ) ERC20("TCG-NEXUS", "NEXUS") ERC20Permit("TCG-NEXUS") Ownable(msg.sender) {
        if (minter_ == address(0)) revert ZeroAddress();
        if (founderNFTPresaleBonus_ == address(0)) revert ZeroAddress();
        if (initialLaunchPresaleBonus_ == address(0)) revert ZeroAddress();
        _minter = minter_;
        _founderNFTPresaleBonus = founderNFTPresaleBonus_;
        _initialLaunchPresaleBonus = initialLaunchPresaleBonus_;
    }

    modifier onlyPresaleBonusContract() {
        if (msg.sender != _founderNFTPresaleBonus && msg.sender != _initialLaunchPresaleBonus) {
            revert OnlyPresaleBonusContract();
        }
        _;
    }

    // External getters (private/external pattern)
    function minter() external view returns (address) {
        return _minter;
    }

    function founderNFTPresaleBonus() external view returns (address) {
        return _founderNFTPresaleBonus;
    }

    function initialLaunchPresaleBonus() external view returns (address) {
        return _initialLaunchPresaleBonus;
    }

    function isPresaleBonusContract(address account) external view returns (bool) {
        return account == _founderNFTPresaleBonus || account == _initialLaunchPresaleBonus;
    }

    /// @dev Resolve nonces() conflict between ERC20Permit and Votes (both use Nonces).
    function nonces(address owner) public view virtual override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    /**
     * @notice Soulbound: only mint/burn allowed; no transfers. Updates voting checkpoints on mint/burn (ERC20Votes).
     */
    function _update(address from, address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        if (from != address(0) && to != address(0)) revert SoulboundTransferNotAllowed();
        super._update(from, to, amount);
    }

    /**
     * @notice Mint tokens for cashback.
     * @dev Access: only minter (TCGVaultToken, set at deployment).
     */
    function mintCashback(address recipient, uint256 amount) external {
        if (msg.sender != _minter) revert OnlyMinter();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        _mint(recipient, amount);
        emit CashbackMinted(recipient, amount);
    }

    /**
     * @notice Mint 30% NEXUS bonus during presale (whitepaper §6, §7).
     * @dev Access: immutable FounderNFT or InitialLaunch only.
     */
    function mintPresaleBonus(address recipient, uint256 amount) external onlyPresaleBonusContract {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(recipient, amount);
        emit PresaleBonusMinted(recipient, amount);
    }

    /**
     * @notice Claw back presale bonus from a holder (MiCA cooling-off cancellations).
     * @dev Access: immutable FounderNFT or InitialLaunch only.
     */
    function clawBackPresaleBonus(address holder, uint256 amount) external onlyPresaleBonusContract {
        if (holder == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _burn(holder, amount);
        emit PresaleBonusClawedBack(holder, amount);
    }
}
