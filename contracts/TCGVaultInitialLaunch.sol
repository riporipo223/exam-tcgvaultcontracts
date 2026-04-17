// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITCGVaultFounderNFT} from "./interfaces/ITCGVaultFounderNFT.sol";
import {ITCGNexusToken} from "./interfaces/ITCGNexusToken.sol";
import {ITCGVaultToken} from "./interfaces/ITCGVaultToken.sol";

/**
 * @title TCGVaultInitialLaunch
 * @notice Prévente (whitepaper §6): TCGV contre USDC. Vague 1: 0,005 $/TCGV jusqu'au 245ème NFT Founder.
 *   Vague 2: 0,008 $/TCGV, compte à rebours 120h puis clôture. Bonus 30 % en $TCGNEXUS. Cap 4 %/wallet, hard cap 600M TCGV.
 *   Vesting: 10 % TGE, puis 10 %/mois sur 9 mois.
 *
 * @dev Uses classic ReentrancyGuard instead of ReentrancyGuardTransient for compatibility
 *      with chains (e.g. BSC) that do not yet support EIP-1153 transient storage opcodes.
 */
contract TCGVaultInitialLaunch is Ownable2Step, ReentrancyGuard {
    IERC20 private immutable _tcgv;
    IERC20 private immutable _usdc;
    ITCGVaultFounderNFT private immutable _founderNFT;
    ITCGNexusToken private immutable _nexusToken;

    uint256 public constant PRICE_WAVE1 = 0.005e6;   // 0,005 USDC (6 decimals) per TCGV
    uint256 public constant PRICE_WAVE2 = 0.008e6;    // 0,008 USDC (6 decimals) per TCGV
    /// @notice Wave-1 price applies until 250 Founder NFTs are sold.
    uint256 public constant FOUNDER_NFT_WAVE1_CAP = 250;
    uint256 public constant PRESALE_COUNTDOWN_HOURS = 120;
    uint256 public constant HARD_CAP_TCGV = 600_000_000 * 1e18;
    uint256 public constant MAX_PER_WALLET_BP = 400; // 4 %
    uint256 private constant NEXUS_BONUS_BP = 3000;  // 30 %

    uint256 private _totalTCGVAllocated;
    uint256 private _tgeTimestamp;
    address private _treasury;

    uint256 private constant CANCEL_WINDOW = 14 days;
    uint256 private constant FINALIZE_DELAY_AFTER_PRESALE_END = 20 days;

    struct UserAllocation {
        uint256 tcgvAllocated;
        uint256 tcgvClaimed;
    }
    mapping(address => UserAllocation) private _allocations;

    struct Order {
        address buyer;
        uint256 usdcAmount;
        uint256 tcgvAmount;
        uint256 nexusAmount;
        uint256 purchasedAt;
        bool cancelled;
    }
    uint256 private _nextOrderId;
    mapping(uint256 => Order) private _orders;

    // External getters (private/external pattern)
    function tcgv() external view returns (address) { return address(_tcgv); }
    function usdc() external view returns (address) { return address(_usdc); }
    function founderNFT() external view returns (address) { return address(_founderNFT); }
    function nexusToken() external view returns (address) { return address(_nexusToken); }

    function totalTCGVAllocated() external view returns (uint256) { return _totalTCGVAllocated; }
    function tgeTimestamp() external view returns (uint256) { return _tgeTimestamp; }
    function treasury() external view returns (address) { return _treasury; }

    function allocations(address user) external view returns (uint256 tcgvAllocated, uint256 tcgvClaimed) {
        UserAllocation storage u = _allocations[user];
        return (u.tcgvAllocated, u.tcgvClaimed);
    }

    event Bought(address user, uint256 usdcAmount, uint256 tcgvAllocated, uint256 orderId, uint256 purchasedAt);
    event Claimed(address user, uint256 amount);
    event PresaleOrderCancelled(address user, uint256 orderId, uint256 usdcRefundDue, uint256 tcgvBurned, uint256 nexusClawedBack);
    event Finalized(uint256 tgeTimestamp);
    event TreasuryUpdated(address treasury);

    constructor(address tcgv_, address usdc_, address founderNFT_, address nexusToken_, address treasury_) Ownable(msg.sender) {
        if (nexusToken_ == address(0)) revert ZeroNexusToken();
        _tcgv = IERC20(tcgv_);
        _usdc = IERC20(usdc_);
        _founderNFT = ITCGVaultFounderNFT(founderNFT_);
        _nexusToken = ITCGNexusToken(nexusToken_);
        _treasury = treasury_ != address(0) ? treasury_ : msg.sender;
        emit TreasuryUpdated(_treasury);
    }

    function setTreasury(address treasury_) external onlyOwner {
        _treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    /// @notice End of presale: 120h after the 245th Founder NFT sold (whitepaper §6 — compte à rebours 120h).
    function presaleEndTime() public view returns (uint256) {
        uint256 w2 = _founderNFT.wave2StartTimestamp();
        if (w2 == 0) return type(uint256).max;
        return w2 + (PRESALE_COUNTDOWN_HOURS * 1 hours);
    }

    function currentPrice() public view returns (uint256) {
        return _founderNFT.soldCount() < FOUNDER_NFT_WAVE1_CAP ? PRICE_WAVE1 : PRICE_WAVE2;
    }

    function maxPerWallet() public pure returns (uint256) {
        return (HARD_CAP_TCGV * MAX_PER_WALLET_BP) / 10000;
    }

    /**
     * @notice Buy TCGV with USDC. Buyer receives 30 % of amount in $TCGNEXUS. Reverts after 120h countdown (wave 2).
     */
    function buy(uint256 usdcAmount) external nonReentrant {
        if (_tgeTimestamp != 0) revert PresaleEnded();
        if (block.timestamp > presaleEndTime()) revert PresaleCountdownEnded();
        if (usdcAmount == 0) revert ZeroAmount();
        uint256 price = currentPrice();
        uint256 tcgvAmount = (usdcAmount * 1e18) / price;
        if (_totalTCGVAllocated + tcgvAmount > HARD_CAP_TCGV) revert ExceedsHardCap();
        UserAllocation storage u = _allocations[msg.sender];
        if (u.tcgvAllocated + tcgvAmount > maxPerWallet()) revert ExceedsWalletCap();

        uint256 orderId = _nextOrderId;
        _nextOrderId = orderId + 1;

        _totalTCGVAllocated += tcgvAmount;
        u.tcgvAllocated += tcgvAmount;

        uint256 nexusAmount = (usdcAmount * NEXUS_BONUS_BP * 1e18) / (10000 * 1e6);
        _orders[orderId] = Order({
            buyer: msg.sender,
            usdcAmount: usdcAmount,
            tcgvAmount: tcgvAmount,
            nexusAmount: nexusAmount,
            purchasedAt: block.timestamp,
            cancelled: false
        });

        // Mint TCGV to this contract (vested and claimed by buyer later)
        ITCGVaultToken(address(_tcgv)).mintPresale(address(this), tcgvAmount);

        if (nexusAmount > 0) {
            _nexusToken.mintPresaleBonus(msg.sender, nexusAmount);
        }

        _usdc.transferFrom(msg.sender, _treasury, usdcAmount);
        emit Bought(msg.sender, usdcAmount, tcgvAmount, orderId, block.timestamp);
    }

    /// @notice MiCA cooling-off cancellation: burn TCGV + claw back NEXUS bonus.
    /// @dev USDC refunds are handled off-chain by the CASP. This contract only emits refundDue amounts for indexing.
    function cancelOrder(uint256 orderId) external nonReentrant {
        if (_tgeTimestamp != 0) revert AlreadyFinalized();
        Order storage o = _orders[orderId];
        if (o.buyer == address(0)) revert InvalidOrder();
        if (o.cancelled) revert OrderAlreadyCancelled();
        if (msg.sender != o.buyer) revert Unauthorized();
        if (block.timestamp > o.purchasedAt + CANCEL_WINDOW) revert CancellationWindowEnded();

        o.cancelled = true;

        uint256 tcgvAmount = o.tcgvAmount;
        UserAllocation storage u = _allocations[msg.sender];
        u.tcgvAllocated -= tcgvAmount;
        _totalTCGVAllocated -= tcgvAmount;

        // Burn tokens held by this contract.
        ITCGVaultToken(address(_tcgv)).burnPresaleAllocation(address(this), tcgvAmount);

        if (o.nexusAmount > 0) {
            _nexusToken.clawBackPresaleBonus(msg.sender, o.nexusAmount);
        }

        emit PresaleOrderCancelled(
            msg.sender,
            orderId,
            o.usdcAmount,
            tcgvAmount,
            o.nexusAmount
        );
    }

    /// @notice Finalize presale and set TGE for vesting. Callable only after the 120h countdown (no early close by owner; no early close when hard cap is reached). Notifies TCGVaultToken to switch cashback from 30% to 10% and recompute supply (whitepaper §6).
    function finalize() external {
        if (_tgeTimestamp != 0) revert AlreadyFinalized();
        if (block.timestamp < presaleEndTime() + FINALIZE_DELAY_AFTER_PRESALE_END) revert PresaleNotEnded();
        _tgeTimestamp = block.timestamp;
        // Hard requirement: presale finalization and supply recompute must succeed; otherwise finalize reverts.
        ITCGVaultToken(address(_tcgv)).finalizePresaleAndRecompute();
        emit Finalized(_tgeTimestamp);
    }

    function releasable(address user) public view returns (uint256) {
        if (_tgeTimestamp == 0) return 0;
        UserAllocation storage u = _allocations[user];
        uint256 total = u.tcgvAllocated;
        if (total == 0) return 0;
        uint256 claimed = u.tcgvClaimed;
        uint256 elapsed = block.timestamp - _tgeTimestamp;
        uint256 monthsElapsed = elapsed / (30 days);
        if (monthsElapsed >= 9) return total - claimed;
        uint256 vested = (total * (10 + monthsElapsed * 10)) / 100;
        return vested > claimed ? vested - claimed : 0;
    }

    function claim() external nonReentrant {
        if (_tgeTimestamp == 0) revert NotFinalized();
        uint256 amount = releasable(msg.sender);
        if (amount == 0) revert NothingToClaim();
        _allocations[msg.sender].tcgvClaimed += amount;
        _tcgv.transfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    error ZeroNexusToken();
    error PresaleEnded();
    error PresaleCountdownEnded();
    error PresaleNotEnded();
    error ZeroAmount();
    error ExceedsHardCap();
    error ExceedsWalletCap();
    error AlreadyFinalized();
    error NotFinalized();
    error NothingToClaim();
    error InvalidOrder();
    error OrderAlreadyCancelled();
    error Unauthorized();
    error CancellationWindowEnded();
}
