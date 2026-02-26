// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ITCGVaultStakingVault.sol";

/**
 * @title TCGVaultBasicNFT
 * @notice Édition basique — ticket d'entrée (whitepaper §7.2). Mint gratuit si 25$ en TCGV stakés.
 *   En cas d'unstake, le NFT est brûlé (via callback from staking vault).
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

    /// @notice Minimum stake (shares) required to mint. Set to represent ~25 USD in TCGV at launch price.
    function minStakeRequired() public view returns (uint256) {
        return stakingVault.minStakeForBasicNFT();
    }

    /// @notice Mint one Basic NFT if caller has at least minStakeRequired() shares in the staking vault. Free (no USDC).
    function mint() external {
        if (stakingVault.balanceOf(msg.sender) < minStakeRequired()) revert InsufficientStake();
        if (ownerToTokenId[msg.sender] != 0) revert AlreadyMinted(); // 1-based in mapping so 0 = not minted
        uint256 tokenId = nextTokenId++;
        ownerToTokenId[msg.sender] = tokenId + 1; // store 1-based so tokenId 0 is stored as 1
        _safeMint(msg.sender, tokenId);
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

    function _update(address to, uint256 tokenId, address auth)
        internal
        virtual
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0)) ownerToTokenId[from] = 0;
        if (to != address(0)) ownerToTokenId[to] = tokenId + 1; // 1-based so 0 = not minted
        return super._update(to, tokenId, auth);
    }

    error InsufficientStake();
    error AlreadyMinted();
    error OnlyStakingVault();
}
