// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "./interfaces/ITCGNexusToken.sol";

/**
 * @title TCGVaultFounderNFT
 * @notice Founder Edition — 500 exemplaires (whitepaper §7). Vague 1: 245 @ 200 USDC, Vague 2: 245 @ 350 USDC, 10 réservés communauté.
 *   Bonus: 30 % du montant en $TCGNEXUS à chaque achat. Déclenche le compte à rebours 120h de la prévente token au 245ème NFT vendu.
 */
contract TCGVaultFounderNFT is ERC721, Ownable, ReentrancyGuardTransient {
    IERC20 private immutable _usdc;
    ITCGNexusToken private immutable _nexusToken;

    uint256 public constant WAVE1_SIZE = 245;
    uint256 public constant WAVE2_SIZE = 245;
    uint256 public constant TOTAL_SALE = WAVE1_SIZE + WAVE2_SIZE; // 490
    uint256 public constant RESERVED_COMMUNITY = 10;
    uint256 public constant TOTAL_SUPPLY = TOTAL_SALE + RESERVED_COMMUNITY; // 500

    uint256 public constant WAVE1_PRICE = 200 * 1e6;  // 200 USDC (6 decimals)
    uint256 public constant WAVE2_PRICE = 350 * 1e6;      // 350 USDC (6 decimals)
    /// @dev 30% of USDC amount (6 decimals) → NEXUS with 18 decimals: amount * 30/100 * 1e18/1e6
    uint256 private constant NEXUS_BONUS_BP = 3000;      // 30%

    uint256 private _nextTokenId;
    uint256 private _communityMinted;
    /// @notice Timestamp when the 245th Founder NFT was sold; starts the 120h presale countdown (whitepaper §6).
    uint256 private _wave2StartTimestamp;
    address private _treasury;
    /// @notice Base URI for tokenURI (set by owner; used by explorers/marketplaces).
    string private _baseTokenURI;

    // External getters (private/external pattern)
    function usdc() external view returns (address) { return address(_usdc); }
    function nexusToken() external view returns (address) { return address(_nexusToken); }
    function nextTokenId() external view returns (uint256) { return _nextTokenId; }
    function communityMinted() external view returns (uint256) { return _communityMinted; }
    function wave2StartTimestamp() external view returns (uint256) { return _wave2StartTimestamp; }
    function treasury() external view returns (address) { return _treasury; }

    constructor(address usdc_, address nexusToken_, address treasury_)
        ERC721("TCG-VAULT Founder", "TCGVF")
        Ownable(msg.sender)
    {
        _usdc = IERC20(usdc_);
        _nexusToken = ITCGNexusToken(nexusToken_);
        _treasury = treasury_ != address(0) ? treasury_ : msg.sender;
    }

    /// @notice Number of Founder NFTs sold (paid mints). Drives presale price wave and 120h countdown.
    function soldCount() external view returns (uint256) {
        return _nextTokenId;
    }

    function currentWave() external view returns (uint256) {
        return _nextTokenId < WAVE1_SIZE ? 1 : 2;
    }

    function currentPrice() public view returns (uint256) {
        return _nextTokenId < WAVE1_SIZE ? WAVE1_PRICE : WAVE2_PRICE;
    }

    function setTreasury(address treasury_) external onlyOwner {
        _treasury = treasury_;
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    /**
     * @notice Mint one Founder NFT. Pay in USDC; buyer receives 30% of price in $TCGNEXUS (whitepaper §7).
     */
    function mint() external nonReentrant {
        if (_nextTokenId >= TOTAL_SALE) revert ExceedsSupply();
        uint256 price = currentPrice();
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        if (tokenId == WAVE1_SIZE - 1) _wave2StartTimestamp = block.timestamp; // 245th sold (0-indexed: 244)

        _usdc.transferFrom(msg.sender, _treasury, price);

        uint256 nexusAmount = (price * NEXUS_BONUS_BP * 1e18) / (10000 * 1e6);
        if (nexusAmount > 0 && address(_nexusToken) != address(0)) {
            _nexusToken.mintPresaleBonus(msg.sender, nexusAmount);
        }

        _safeMint(msg.sender, tokenId);
    }

    /**
     * @notice Mint the 10 Founder NFTs réservés communauté (whitepaper §7 — offerts pour l'animation au lancement).
     */
    function mintCommunity(address to) external onlyOwner {
        if (_communityMinted >= RESERVED_COMMUNITY) revert ExceedsReserved();
        _communityMinted++;
        uint256 tokenId = TOTAL_SALE + _communityMinted - 1;
        _safeMint(to, tokenId);
    }

    error ExceedsSupply();
    error ExceedsReserved();
}
