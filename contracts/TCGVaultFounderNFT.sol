// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITCGNexusToken} from "./interfaces/ITCGNexusToken.sol";

/**
 * @title TCGVaultFounderNFT
 * @notice Founder Edition — 500 exemplaires vendus (whitepaper §7). Vague 1: 250 @ 200 USDC, Vague 2: 250 @ 350 USDC.
 *   Bonus: 30 % du montant en $TCGNEXUS à chaque achat. Déclenche le compte à rebours 120h de la prévente token au 243ème NFT vendu.
 *   USDC per mint: 30 % acquisitions physiques Vault, 60 % liquidité projet, 10 % opérations / écosystème (whitepaper; reste après arrondi).
 *
 * @dev Uses classic ReentrancyGuard so Anvil/other forks work with a plain --fork-url (no --hardfork cancun required).
 */
contract TCGVaultFounderNFT is ERC721, Ownable, ReentrancyGuard {
    IERC20 private immutable _usdc;
    ITCGNexusToken private immutable _nexusToken;

    /// @notice Wave 1: 250 NFTs at 200 USDC (5 reserved operationally for owner purchase at same price).
    uint256 public constant WAVE1_SIZE = 250;
    /// @notice Wave 2: 250 NFTs at 350 USDC (5 reserved operationally for owner purchase at same price).
    uint256 public constant WAVE2_SIZE = 250;
    /// @notice Total sold supply across both waves (no separate community mints): 500 Founder NFTs.
    uint256 public constant TOTAL_SALE = WAVE1_SIZE + WAVE2_SIZE; // 500

    uint256 public constant WAVE1_PRICE = 200 * 1e6;  // 200 USDC (6 decimals)
    uint256 public constant WAVE2_PRICE = 350 * 1e6;      // 350 USDC (6 decimals)
    /// @dev 30% of USDC amount (6 decimals) → NEXUS with 18 decimals: amount * 30/100 * 1e18/1e6
    uint256 private constant NEXUS_BONUS_BP = 3000;      // 30%
    /// @dev USDC split of mint price (basis points; 10% = remainder after vault + liquidity).
    uint256 private constant USDC_VAULT_ACQUISITIONS_BP = 3000;
    uint256 private constant USDC_LIQUIDITY_BP = 6000;

    uint256 private _nextTokenId;
    /// @notice Count of NFTs minted by the owner in wave 1 (max 5).
    uint256 private _ownerWave1Mints;
    /// @notice Count of NFTs minted by the owner in wave 2 (max 5).
    uint256 private _ownerWave2Mints;
    /// @notice Timestamp when the last NFT of wave 1 is sold (250th); starts the 120h presale countdown (whitepaper §6).
    uint256 private _wave2StartTimestamp;
    address private _vaultAcquisitionsRecipient;
    address private _liquidityRecipient;
    address private _opsRecipient;
    /// @notice Base URI for tokenURI (set by owner; used by explorers/marketplaces).
    string private _baseTokenURI;

    // External getters (private/external pattern)
    function usdc() external view returns (address) { return address(_usdc); }
    function nexusToken() external view returns (address) { return address(_nexusToken); }
    function wave2StartTimestamp() external view returns (uint256) { return _wave2StartTimestamp; }
    function vaultAcquisitionsRecipient() external view returns (address) { return _vaultAcquisitionsRecipient; }
    function liquidityRecipient() external view returns (address) { return _liquidityRecipient; }
    function opsRecipient() external view returns (address) { return _opsRecipient; }
    function ownerWave1Mints() external view returns (uint256) { return _ownerWave1Mints; }
    function ownerWave2Mints() external view returns (uint256) { return _ownerWave2Mints; }

    event UsdcRecipientsUpdated(address vaultAcquisitions, address liquidity, address ops);
    event BaseURIUpdated(string baseURI);

    constructor(
        address usdc_,
        address nexusToken_,
        address vaultAcquisitions_,
        address liquidity_,
        address ops_
    )
        ERC721("TCG-VAULT Founder", "TCGVF")
        Ownable(msg.sender)
    {
        if (
            nexusToken_ == address(0) ||
            vaultAcquisitions_ == address(0) ||
            liquidity_ == address(0) ||
            ops_ == address(0)
        ) revert ZeroAddress();
        _usdc = IERC20(usdc_);
        _nexusToken = ITCGNexusToken(nexusToken_);
        _vaultAcquisitionsRecipient = vaultAcquisitions_;
        _liquidityRecipient = liquidity_;
        _opsRecipient = ops_;
        emit UsdcRecipientsUpdated(vaultAcquisitions_, liquidity_, ops_);
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

    function setUsdcRecipients(address vaultAcquisitions_, address liquidity_, address ops_) external onlyOwner {
        if (vaultAcquisitions_ == address(0) || liquidity_ == address(0) || ops_ == address(0)) revert ZeroAddress();
        _vaultAcquisitionsRecipient = vaultAcquisitions_;
        _liquidityRecipient = liquidity_;
        _opsRecipient = ops_;
        emit UsdcRecipientsUpdated(vaultAcquisitions_, liquidity_, ops_);
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
        if (_nextTokenId >= TOTAL_SALE) revert ExceedsSupply();
        bool isWave1 = _nextTokenId < WAVE1_SIZE;
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
                uint256 remainingInWave1 = WAVE1_SIZE - _nextTokenId;
                uint256 ownerQuotaLeft1 = 5 - _ownerWave1Mints;
                if (remainingInWave1 <= ownerQuotaLeft1) revert ReservedForOwner();
            } else {
                uint256 remainingInWave2 = TOTAL_SALE - _nextTokenId;
                uint256 ownerQuotaLeft2 = 5 - _ownerWave2Mints;
                if (remainingInWave2 <= ownerQuotaLeft2) revert ReservedForOwner();
            }
        }
        uint256 price = currentPrice();
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        if (tokenId == WAVE1_SIZE - 1) _wave2StartTimestamp = block.timestamp; // 250th sold (0-indexed: 249)
        uint256 toVault = (price * USDC_VAULT_ACQUISITIONS_BP) / 10000;
        uint256 toLiquidity = (price * USDC_LIQUIDITY_BP) / 10000;
        uint256 toOps = price - toVault - toLiquidity;
        _usdc.transferFrom(msg.sender, _vaultAcquisitionsRecipient, toVault);
        _usdc.transferFrom(msg.sender, _liquidityRecipient, toLiquidity);
        _usdc.transferFrom(msg.sender, _opsRecipient, toOps);
        uint256 nexusAmount = (price * NEXUS_BONUS_BP * 1e18) / (10000 * 1e6);
        if (nexusAmount > 0) {
            _nexusToken.mintPresaleBonus(msg.sender, nexusAmount);
        }
        _safeMint(msg.sender, tokenId);
    }
    error ZeroAddress();
    error ExceedsSupply();
    error OwnerWaveQuotaExceeded();
    error ReservedForOwner();
}
