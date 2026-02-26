// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ITCGVaultStakingVault.sol";

/**
 * @title TCGVaultBasicNFT
 * @notice Édition basique — ticket d'entrée (whitepaper §7.2). Soulbound, non-transferable.
 *   Minted automatically when user has >= minStake (e.g. ~25$ TCGV) staked; burned when stake drops below (via staking vault).
 */
contract TCGVaultBasicNFT is ERC721, Ownable {
    ITCGVaultStakingVault public stakingVault;
    uint256 public nextTokenId;
    /// @notice Base URI for tokenURI (set by owner; used by explorers/marketplaces).
    string private _baseTokenURI;

    /// @dev One Basic NFT per wallet (whitepaper: "mint gratuit" + staking requirement).
    mapping(address => uint256) public ownerToTokenId;

    constructor(address stakingVault_) ERC721("TCG-VAULT Basic", "TCGVB") Ownable(msg.sender) {
        stakingVault = ITCGVaultStakingVault(stakingVault_);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function setStakingVault(address stakingVault_) external onlyOwner {
        stakingVault = ITCGVaultStakingVault(stakingVault_);
    }

    /// @notice Total number of Basic NFTs ever minted (sold). Used by Initial Launch for tracking.
    function totalSupply() external view returns (uint256) {
        return nextTokenId;
    }

    /// @notice Minimum stake (shares) required to hold a Basic NFT. Set to represent ~25 USD in TCGV at launch price.
    function minStakeRequired() public view returns (uint256) {
        return stakingVault.minStakeForBasicNFT();
    }

    /// @notice Called by staking vault when a user's stake reaches or exceeds minimum. Mints one Basic NFT for the account if eligible.
    /// @dev Access: only stakingVault. Idempotent: no-op if account already has a Basic NFT or stake is below minimum.
    function mintFor(address account) external {
        if (msg.sender != address(stakingVault)) revert OnlyStakingVault();
        if (stakingVault.balanceOf(account) < minStakeRequired()) return; // not enough stake, no-op
        if (ownerToTokenId[account] != 0) return; // already has Basic NFT, no-op
        uint256 tokenId = nextTokenId++;
        ownerToTokenId[account] = tokenId + 1; // store 1-based so tokenId 0 is stored as 1
        _safeMint(account, tokenId);
    }

    /// @notice Called by staking vault when user's stake drops below minimum. Burns all Basic NFTs held by owner.
    /// @dev Access: only stakingVault (set via setStakingVault by owner). ownerToTokenId stores tokenId + 1 (1-based).
    function burnAllFor(address owner) external {
        if (msg.sender != address(stakingVault)) revert OnlyStakingVault();
        uint256 idPlusOne = ownerToTokenId[owner];
        if (idPlusOne != 0) {
            uint256 tokenId = idPlusOne - 1;
            if (_ownerOf(tokenId) == owner) {
                ownerToTokenId[owner] = 0;
                _burn(tokenId);
            }
        }
    }

    /// @dev Soulbound: only mint (from==0) and burn (to==0) allowed; transfers revert.
    function _update(address to, uint256 tokenId, address auth)
        internal
        virtual
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        if (from != address(0)) ownerToTokenId[from] = 0;
        if (to != address(0)) ownerToTokenId[to] = tokenId + 1; // 1-based so 0 = not minted
        return super._update(to, tokenId, auth);
    }

    error OnlyStakingVault();
    error Soulbound();
}
