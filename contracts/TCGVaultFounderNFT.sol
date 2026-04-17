// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITCGNexusToken} from "./interfaces/ITCGNexusToken.sol";

/**
 * @title TCGVaultFounderNFT
 * @notice Founder Edition — 500 exemplaires vendus (whitepaper §7). Vague 1: 200 USDC (up to 250 NFTs) pendant 7 jours,
 *   puis vague 2: 350 USDC (remaining supply), avec bascule anticipée si la vague 1 est sold out.
 *   Bonus: 30 % du montant en $TCGNEXUS à chaque achat.
 *   USDC per mint: 30 % acquisitions physiques Vault, 60 % liquidité projet, 10 % opérations / écosystème (whitepaper; reste après arrondi).
 *
 * @dev Uses classic ReentrancyGuard so Anvil/other forks work with a plain --fork-url (no --hardfork cancun required).
 */
contract TCGVaultFounderNFT is ERC721, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 private immutable _usdc;
    ITCGNexusToken private immutable _nexusToken;

    /// @notice Wave 1 target size: 250 NFTs at 200 USDC (5 reserved operationally for owner purchase at same price).
    uint256 public constant WAVE1_SIZE = 250;
    /// @notice Wave 2 remaining supply priced at 350 USDC (5 owner mints max in wave 2).
    uint256 public constant WAVE2_SIZE = 250;
    /// @notice Total sold supply across both waves (no separate community mints): 500 Founder NFTs.
    uint256 public constant TOTAL_SALE = WAVE1_SIZE + WAVE2_SIZE; // 500

    uint256 public constant WAVE1_PRICE = 200 * 1e6;  // 200 USDC (6 decimals)
    uint256 public constant WAVE2_PRICE = 350 * 1e6;      // 350 USDC (6 decimals)
    uint256 public constant WAVE1_DURATION = 7 days;
    /// @dev 30% of USDC amount (6 decimals) → NEXUS with 18 decimals: amount * 30/100 * 1e18/1e6
    uint256 private constant NEXUS_BONUS_BP = 3000;      // 30%

    uint256 private _nextTokenId;
    uint256 private _activeSoldCount;
    /// @notice Count of NFTs minted by the owner in wave 1 (max 5).
    uint256 private _ownerWave1Mints;
    /// @notice Count of NFTs minted by the owner in wave 2 (max 5).
    uint256 private _ownerWave2Mints;
    /// @notice Effective wave-2 start timestamp (time-based default, accelerated on wave-1 sellout).
    uint256 private _wave2StartTimestamp;
    address private _caspUsdcRecipient;
    /// @notice Base URI for tokenURI (set by owner; used by explorers/marketplaces).
    string private _baseTokenURI;

    uint256 private constant CANCEL_WINDOW = 14 days;
    mapping(uint256 => uint256) private _purchasedAt;
    mapping(uint256 => uint256) private _usdcPriceForToken;
    mapping(uint256 => uint256) private _nexusBonusForToken;
    mapping(uint256 => bool) private _cancelled;
    mapping(uint256 => bool) private _ownerMinted;
    mapping(uint256 => bool) private _ownerMintedInWave1;

    event CaspUsdcRecipientUpdated(address caspUsdcRecipient);
    event BaseURIUpdated(string baseURI);
    event FounderMinted(address buyer, uint256 tokenId, uint256 usdcAmount, uint256 nexusAmount, uint256 purchasedAt);
    event FounderPurchaseCancelled(address buyer, uint256 tokenId, uint256 usdcRefundDue, uint256 nexusClawedBack);

    error Unauthorized();
    error AlreadyCancelled();
    error NotPurchasable();
    error CancellationWindowEnded();
    error ZeroAddress();
    error ExceedsSupply();
    error OwnerWaveQuotaExceeded();
    error ReservedForOwner();

    constructor(address usdc_, address nexusToken_, address caspUsdcRecipient_)
        ERC721("TCG-VAULT Founder", "TCGVF")
        Ownable(msg.sender)
    {
        if (
            nexusToken_ == address(0) ||
            caspUsdcRecipient_ == address(0)
        ) revert ZeroAddress();
        _usdc = IERC20(usdc_);
        _nexusToken = ITCGNexusToken(nexusToken_);
        _caspUsdcRecipient = caspUsdcRecipient_;
        emit CaspUsdcRecipientUpdated(caspUsdcRecipient_);
    }

    // External getters (private/external pattern)
    function usdc() external view returns (address) { return address(_usdc); }
    function nexusToken() external view returns (address) { return address(_nexusToken); }
    function wave2StartTimestamp() external view returns (uint256) { return _wave2StartTimestamp; }
    function caspUsdcRecipient() external view returns (address) { return _caspUsdcRecipient; }
    function ownerWave1Mints() external view returns (uint256) { return _ownerWave1Mints; }
    function ownerWave2Mints() external view returns (uint256) { return _ownerWave2Mints; }

    /// @notice Number of active Founder NFTs sold (non-cancelled paid mints). Drives wave/price/countdown.
    function soldCount() external view returns (uint256) {
        return _activeSoldCount;
    }

    function currentWave() external view returns (uint256) {
        if (_wave2StartTimestamp == 0) return 1;
        return block.timestamp < _wave2StartTimestamp ? 1 : 2;
    }

    function currentPrice() public view returns (uint256) {
        if (_wave2StartTimestamp == 0) return WAVE1_PRICE;
        return block.timestamp < _wave2StartTimestamp ? WAVE1_PRICE : WAVE2_PRICE;
    }

    function setCaspUsdcRecipient(address caspUsdcRecipient_) external onlyOwner {
        if (caspUsdcRecipient_ == address(0)) revert ZeroAddress();
        _caspUsdcRecipient = caspUsdcRecipient_;
        emit CaspUsdcRecipientUpdated(caspUsdcRecipient_);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    /**
     * @notice Mint one Founder NFT. Pay in USDC; buyer receives 30% of price in $TCGNEXUS (whitepaper §7).
     */
    function mint() external nonReentrant {
        if (_activeSoldCount >= TOTAL_SALE) revert ExceedsSupply();
        if (_wave2StartTimestamp == 0) {
            _wave2StartTimestamp = block.timestamp + WAVE1_DURATION;
        }
        bool isWave1 = block.timestamp < _wave2StartTimestamp;
        if (msg.sender == owner()) {
            // Owner: enforce per-wave quota but allow minting at any time.
            if (isWave1) {
                if (_ownerWave1Mints >= 5) revert OwnerWaveQuotaExceeded();
                _ownerWave1Mints++;
            } else {
                if (_ownerWave2Mints >= 5) revert OwnerWaveQuotaExceeded();
                _ownerWave2Mints++;
            }
        } else {
            // Non-owner: always leave enough remaining supply in the wave for the owner to reach 5 mints.
            if (isWave1) {
                uint256 remainingInWave1 = WAVE1_SIZE - _activeSoldCount;
                uint256 ownerQuotaLeft1 = 5 - _ownerWave1Mints;
                if (remainingInWave1 <= ownerQuotaLeft1) revert ReservedForOwner();
            } else {
                uint256 remainingInWave2 = TOTAL_SALE - _activeSoldCount;
                uint256 ownerQuotaLeft2 = 5 - _ownerWave2Mints;
                if (remainingInWave2 <= ownerQuotaLeft2) revert ReservedForOwner();
            }
        }
        uint256 price = currentPrice();
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;
        _activeSoldCount++;

        if (_activeSoldCount == WAVE1_SIZE && block.timestamp < _wave2StartTimestamp) {
            _wave2StartTimestamp = block.timestamp;
        }
        // MiCA: forward 100% of USDC mint price to an arbitrary CASP address.
        _usdc.safeTransferFrom(msg.sender, _caspUsdcRecipient, price);

        uint256 nexusAmount = (price * NEXUS_BONUS_BP * 1e18) / (10000 * 1e6);

        if (nexusAmount > 0) _nexusToken.mintPresaleBonus(msg.sender, nexusAmount);

        _purchasedAt[tokenId] = block.timestamp;
        _usdcPriceForToken[tokenId] = price;
        _nexusBonusForToken[tokenId] = nexusAmount;
        if (msg.sender == owner()) {
            _ownerMinted[tokenId] = true;
            _ownerMintedInWave1[tokenId] = isWave1;
        }

        _safeMint(msg.sender, tokenId);

        emit FounderMinted(msg.sender, tokenId, price, nexusAmount, block.timestamp);
    }

    /// @notice MiCA cooling-off cancellation: burn NFT + claw back minted NEXUS bonus.
    /// @dev USDC refund is off-chain (CASP rails). This contract emits refundDue amounts for indexing.
    function cancelFounderPurchase(uint256 tokenId) external nonReentrant {
        if (msg.sender != ownerOf(tokenId)) revert Unauthorized();
        if (_cancelled[tokenId]) revert AlreadyCancelled();

        uint256 purchasedAt = _purchasedAt[tokenId];
        if (purchasedAt == 0) revert NotPurchasable();
        if (block.timestamp > purchasedAt + CANCEL_WINDOW) revert CancellationWindowEnded();

        _cancelled[tokenId] = true;

        uint256 usdcRefundDue = _usdcPriceForToken[tokenId];
        uint256 nexusClawedBack = _nexusBonusForToken[tokenId];
        uint256 actualNexusBurned;

        _burn(tokenId);

        if (nexusClawedBack > 0) {
            uint256 nexusBalance = IERC20(address(_nexusToken)).balanceOf(msg.sender);
            actualNexusBurned = nexusClawedBack > nexusBalance ? nexusBalance : nexusClawedBack;
            if (actualNexusBurned > 0) _nexusToken.clawBackPresaleBonus(msg.sender, actualNexusBurned);
        }

        _activeSoldCount--;

        if (_ownerMinted[tokenId]) {
            if (_ownerMintedInWave1[tokenId]) {
                _ownerWave1Mints--;
            } else {
                _ownerWave2Mints--;
            }
            delete _ownerMinted[tokenId];
            delete _ownerMintedInWave1[tokenId];
        }

        delete _purchasedAt[tokenId];
        delete _usdcPriceForToken[tokenId];
        delete _nexusBonusForToken[tokenId];

        emit FounderPurchaseCancelled(msg.sender, tokenId, usdcRefundDue, actualNexusBurned);
    }
}
