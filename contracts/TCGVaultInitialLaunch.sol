// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "./interfaces/ITCGVaultFounderNFT.sol";
import "./interfaces/ITCGNexusToken.sol";

/**
 * @title TCGVaultInitialLaunch
 * @notice Prévente (whitepaper §6): TCGV contre USDC. Vague 1: 0,005 $/TCGV jusqu'au 245ème NFT Founder.
 *   Vague 2: 0,008 $/TCGV, compte à rebours 120h puis clôture. Bonus 30 % en $TCGNEXUS. Cap 4 %/wallet, hard cap 600M TCGV.
 *   Vesting: 10 % TGE, puis 10 %/mois sur 9 mois.
 */
contract TCGVaultInitialLaunch is Ownable, ReentrancyGuardTransient {
    IERC20 public immutable tcgv;
    IERC20 public immutable usdc;
    ITCGVaultFounderNFT public immutable founderNFT;
    ITCGNexusToken public immutable nexusToken;

    uint256 public constant PRICE_WAVE1 = 0.005e6;   // 0,005 USDC (6 decimals) per TCGV
    uint256 public constant PRICE_WAVE2 = 0.008e6;    // 0,008 USDC (6 decimals) per TCGV
    uint256 public constant FOUNDER_NFT_WAVE1_CAP = 245;
    uint256 public constant PRESALE_COUNTDOWN_HOURS = 120;
    uint256 public constant HARD_CAP_TCGV = 600_000_000 * 1e18;
    uint256 public constant MAX_PER_WALLET_BP = 400; // 4 %
    uint256 private constant NEXUS_BONUS_BP = 3000;  // 30 %

    uint256 public totalTCGVAllocated;
    uint256 public tgeTimestamp;
    address public treasury;

    struct UserAllocation {
        uint256 tcgvAllocated;
        uint256 tcgvClaimed;
    }
    mapping(address => UserAllocation) public allocations;

    event Bought(address indexed user, uint256 usdcAmount, uint256 tcgvAllocated);
    event Claimed(address indexed user, uint256 amount);
    event Finalized(uint256 tgeTimestamp);

    constructor(address tcgv_, address usdc_, address founderNFT_, address nexusToken_, address treasury_) Ownable(msg.sender) {
        tcgv = IERC20(tcgv_);
        usdc = IERC20(usdc_);
        founderNFT = ITCGVaultFounderNFT(founderNFT_);
        nexusToken = ITCGNexusToken(nexusToken_);
        treasury = treasury_ != address(0) ? treasury_ : msg.sender;
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = treasury_;
    }

    /// @notice End of presale: 120h after the 245th Founder NFT sold (whitepaper §6 — compte à rebours 120h).
    function presaleEndTime() public view returns (uint256) {
        uint256 w2 = founderNFT.wave2StartTimestamp();
        if (w2 == 0) return type(uint256).max;
        return w2 + (PRESALE_COUNTDOWN_HOURS * 1 hours);
    }

    function currentPrice() public view returns (uint256) {
        return founderNFT.soldCount() < FOUNDER_NFT_WAVE1_CAP ? PRICE_WAVE1 : PRICE_WAVE2;
    }

    function maxPerWallet() public pure returns (uint256) {
        return (HARD_CAP_TCGV * MAX_PER_WALLET_BP) / 10000;
    }

    /**
     * @notice Buy TCGV with USDC. Buyer receives 30 % of amount in $TCGNEXUS. Reverts after 120h countdown (wave 2).
     */
    function buy(uint256 usdcAmount) external nonReentrant {
        if (tgeTimestamp != 0) revert PresaleEnded();
        if (block.timestamp > presaleEndTime()) revert PresaleCountdownEnded();
        if (usdcAmount == 0) revert ZeroAmount();
        uint256 price = currentPrice();
        uint256 tcgvAmount = (usdcAmount * 1e18) / price;
        if (totalTCGVAllocated + tcgvAmount > HARD_CAP_TCGV) revert ExceedsHardCap();
        UserAllocation storage u = allocations[msg.sender];
        if (u.tcgvAllocated + tcgvAmount > maxPerWallet()) revert ExceedsWalletCap();

        totalTCGVAllocated += tcgvAmount;
        u.tcgvAllocated += tcgvAmount;

        uint256 nexusAmount = (usdcAmount * NEXUS_BONUS_BP * 1e18) / (10000 * 1e6);
        if (nexusAmount > 0 && address(nexusToken) != address(0)) {
            nexusToken.mintPresaleBonus(msg.sender, nexusAmount);
        }

        usdc.transferFrom(msg.sender, treasury, usdcAmount);
        emit Bought(msg.sender, usdcAmount, tcgvAmount);
    }

    /// @notice Finalize presale and set TGE for vesting. Owner may call anytime; others only after 120h countdown or hard cap.
    function finalize() external {
        if (tgeTimestamp != 0) revert AlreadyFinalized();
        if (msg.sender != owner()) {
            if (block.timestamp < presaleEndTime() && totalTCGVAllocated < HARD_CAP_TCGV) revert PresaleNotEnded();
        }
        tgeTimestamp = block.timestamp;
        emit Finalized(tgeTimestamp);
    }

    function releasable(address user) public view returns (uint256) {
        if (tgeTimestamp == 0) return 0;
        UserAllocation storage u = allocations[user];
        uint256 total = u.tcgvAllocated;
        if (total == 0) return 0;
        uint256 claimed = u.tcgvClaimed;
        uint256 elapsed = block.timestamp - tgeTimestamp;
        uint256 monthsElapsed = elapsed / (30 days);
        if (monthsElapsed >= 9) return total - claimed;
        uint256 vested = (total * (10 + monthsElapsed * 10)) / 100;
        if (vested > total) vested = total;
        return vested > claimed ? vested - claimed : 0;
    }

    function claim() external nonReentrant {
        if (tgeTimestamp == 0) revert NotFinalized();
        uint256 amount = releasable(msg.sender);
        if (amount == 0) revert NothingToClaim();
        allocations[msg.sender].tcgvClaimed += amount;
        tcgv.transfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function basicNFTSoldCount(address basicNFTContract) external view returns (uint256) {
        if (basicNFTContract == address(0)) return 0;
        (bool ok, bytes memory data) = basicNFTContract.staticcall(abi.encodeWithSignature("totalSupply()"));
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    error PresaleEnded();
    error PresaleCountdownEnded();
    error PresaleNotEnded();
    error ZeroAmount();
    error ExceedsHardCap();
    error ExceedsWalletCap();
    error AlreadyFinalized();
    error NotFinalized();
    error NothingToClaim();
}
