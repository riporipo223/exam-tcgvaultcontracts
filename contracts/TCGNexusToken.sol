// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";

/**
 * @title TCGNexusToken (TCG-NEXUS)
 * @notice Jeton de Cœur — gouvernance et appartenance à la Guilde TCG-VAULT (whitepaper §4, §5).
 * @dev Soulbound (non transférable). Droit de vote : participation aux décisions d'acquisition du Vault.
 *      ERC-5805 / ERC20Votes for Tally.xyz and OZ Governor compatibility. EIP712 via ERC20Permit for delegateBySig.
 *      Obtention : cashback TCGV (minter) + bonus 30% prévente (allowedPresaleMinters).
 */
contract TCGNexusToken is ERC20Permit, ERC20Votes, Ownable {
    /// @notice Minter can only be the TCGVaultToken contract.
    error OnlyMinter();
    /// @notice Caller not allowed to mint presale bonus.
    error OnlyPresaleMinter();
    /// @notice Recipient cannot be the zero address.
    error ZeroAddress();
    /// @notice Amount must be greater than zero.
    error ZeroAmount();
    /// @notice Nexus is Soulbound; transfers between accounts are not allowed (whitepaper).
    error SoulboundTransferNotAllowed();

    /// @notice TCGVaultToken contract; only it can mint cashback. Set at deployment, immutable.
    address private immutable _minter;
    /// @notice Contracts allowed to mint 30% NEXUS during presale (Founder NFT, Initial Launch).
    mapping(address => bool) private _allowedPresaleMinters;

    // External getters (private/external pattern)
    function minter() external view returns (address) {
        return _minter;
    }

    function allowedPresaleMinters(address account) external view returns (bool) {
        return _allowedPresaleMinters[account];
    }

    event CashbackMinted(address indexed recipient, uint256 amount);
    event PresaleBonusMinted(address indexed recipient, uint256 amount);

    constructor(address minter_) ERC20("TCG-NEXUS", "NEXUS") ERC20Permit("TCG-NEXUS") Ownable(msg.sender) {
        if (minter_ == address(0)) revert ZeroAddress();
        _minter = minter_;
    }

    function setPresaleMinter(address account, bool allowed) external onlyOwner {
        _allowedPresaleMinters[account] = allowed;
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
     * @dev Access: only addresses in allowedPresaleMinters (set via setPresaleMinter by owner).
     */
    function mintPresaleBonus(address recipient, uint256 amount) external {
        if (!_allowedPresaleMinters[msg.sender]) revert OnlyPresaleMinter();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(recipient, amount);
        emit PresaleBonusMinted(recipient, amount);
    }

    /**
     * @notice Mint tokens (only owner, for airdrops or community).
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        _mint(to, amount);
    }
}
