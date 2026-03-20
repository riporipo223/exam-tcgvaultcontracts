// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPancakeRouter} from "./interfaces/IPancakeV2.sol";
import {ITCGNexusToken} from "./interfaces/ITCGNexusToken.sol";
import {ITCGVaultInitialLaunch} from "./interfaces/ITCGVaultInitialLaunch.sol";

/// @notice Pair address cannot be zero.
error PairZeroAddress();
/// @notice Transfer amount below minimum for buy/sell; fees would be incorrect or zero.
error MinAmountNotMet(uint256 amount, uint256 minimum);
/// @notice Only the buy router can call this.
error OnlyBuyRouter();
/// @notice Only the presale finalizer (e.g. launch contract) can call this.
error OnlyPresaleFinalizer();
/// @notice Supply already recomputed (one-time).
error SupplyAlreadyRecomputed();
/// @notice Presale not finalized yet.
error PresaleNotFinalized();
/// @notice Allocation recipients (liquidity, team, ops) must be set before recomputeSupplyAndBurn.
error AllocationRecipientsNotSet();
/// @notice Fee recipient address cannot be zero.
error ZeroAddress();
/// @notice No team vesting amount available to claim.
error NoTeamVestingToClaim();
/// @notice No ops vesting amount available to claim.
error NoOpsVestingToClaim();
/// @notice Address is blacklisted (fraud, market manipulation, Sybil).
error Blacklisted();
/// @notice Contract is paused for security emergency.
error ContractPaused();
/// @notice Blacklist reason is required when enabling blacklist.
error EmptyBlacklistReason();

/**
 * @title TCGVaultToken (TCGV)
 * @notice Token A — le Moteur économique (whitepaper §4). BNB Chain, 1 milliard supply.
 * @dev Initial allocation (whitepaper §5): 60% Presale, 20% Liquidité, 4% Team (12mo cliff + 24mo vesting), 16% Ops (5% immediate + 11% over 36mo vesting).
 * @dev Taxe achat 15% (10% Vault, 3% Marketing, 2% burn). Cashback NEXUS: 30% pendant les Vagues 1 et 2 (prévente), 10% en période standard (whitepaper §6).
 * @dev Taxe vente 10%. Protocol admin is {AccessControl}-DEFAULT_ADMIN_ROLE (granted to deployer).
 */
contract TCGVaultToken is ERC20, AccessControl, ReentrancyGuard {
    /// @notice Hard cap for configurable buy/sell tax rates (25%).
    uint256 public constant MAX_FEE_BP = 2500;
    // Fee parameters (basis points, 10000 = 100%) — whitepaper defaults; owner-modifiable for pool/router modes
    uint256 public BUY_TAX = 1500; // 15%
    uint256 public SELL_TAX = 1000; // 10%
    /// @notice Standard-period cashback in NEXUS (after presale). Whitepaper §6: 10% — immutable.
    uint256 private constant CASHBACK_RATE = 1000; // 10%
    /// @notice Presale cashback (Vagues 1 et 2). Whitepaper §6: BONUS PIONNIER 30% — immutable.
    uint256 private constant CASHBACK_RATE_PRESALE = 3000; // 30%
    /// @notice Seconds per month for vesting (30 days).
    uint256 private constant SECONDS_PER_MONTH = 30 * 24 * 3600;
    /// @notice When true, cashback uses 30%; when false (after presale finalize), uses 10%. Only set when presale finalizer calls finalizePresaleAndRecompute().
    bool public presaleActive = true;

    // Buy tax distribution (basis points of buy feeAmount)
    uint256 public BUY_VAULT_SHARE = 6667; // 10% of total = 66.67% of 15%
    uint256 public BUY_MARKETING_SHARE = 2000; // 3% of total = 20% of 15%
    uint256 public BUY_BURN_SHARE = 1333; // 2% of total = 13.33% of 15%

    // Sell tax distribution (basis points of sell feeAmount)
    uint256 public SELL_VAULT_SHARE = 4000; // 4% of total = 40% of 10%
    uint256 public SELL_AUTOLP_SHARE = 3000; // 3% of total = 30% of 10%
    uint256 public SELL_MARKETING_SHARE = 1000; // 1% of total = 10% of 10%
    uint256 public SELL_COMMUNITY_SHARE = 1000; // 1% of total = 10% of 10%
    uint256 public SELL_BURN_SHARE = 1000; // 1% of total = 10% of 10%
    
    /// @notice Registered Uniswap V2–style DEX routers for metadata / integrations; `factory == address(0)` means not registered.
    mapping(address => address) public dexFactoryForRouter;
    address public vaultAddress;
    address public marketingAddress;
    address public communityAddress;
    /// @notice TCG-NEXUS for cashback (immutable; set once in constructor).
    address private immutable _nexusToken;
    /// @notice When set, buys through this router charge fee in BNB (router path); only this address can call recordBuyAndMintCashback.
    address public buyRouter;
    /// @notice Only this address can call finalizePresaleAndRecompute() and mintPresale(). Set once in constructor.
    address public immutable presaleFinalizer;
    /// @notice True after recomputeSupplyAndBurn has been called (one-time; mints 20% liquidity, 4% team vesting, 5% ops direct, 11% ops vesting).
    bool public supplyRecomputed;
    /// @notice Recipients for post-presale mint (whitepaper §5: 20% liquidity, 4% team vesting, 16% ops). Set by owner before presale end.
    address public liquidityRecipient;
    address public teamRecipient;
    address public opsRecipient;

    // Team vesting: 4% of final supply; 12-month freeze, then 24 monthly claims (full 4% by month 36).
    uint256 public teamVestingTotal;
    uint256 public teamVestingClaimed;
    uint256 public teamVestingCliffEnd; // timestamp after which vesting starts
    uint256 public teamVestingEnd;      // timestamp when full amount is vested

    // Ops vesting: 11% of final supply; no freeze, 36 monthly unlocks (full 11% by month 36). 5% is sent directly at finalize.
    uint256 public opsVestingTotal;
    uint256 public opsVestingClaimed;
    uint256 public opsVestingStart;
    uint256 public opsVestingEnd;

    // State variables
    bool public feesEnabled = true;
    bool public cashbackEnabled = true;
    /// @notice Minimum transfer amount for buy; below this, fee computation is unreliable.
    uint256 public minBuyAmount;
    /// @notice Minimum transfer amount for sell; below this, fee computation is unreliable.
    uint256 public minSellAmount;
    mapping(address => bool) public isExcludedFromFees;
    mapping(address => bool) public isPair;
    /// @notice Accumulated sell-fee autolp tokens; add to LP via executePendingAutolp() to avoid updating pair reserves during sell transfer (fixes router INSUFFICIENT_INPUT_AMOUNT).
    uint256 public pendingAutolp;
    /// @notice Blacklist: when true, address cannot send nor receive TCGV (fraud, market manipulation, Sybil).
    mapping(address => bool) public isBlacklisted;
    /// @notice When true, all transfers (and thus buy/sell/mint via _update) are blocked for security emergency.
    bool public paused;

    // Events
    event FeesEnabledUpdated(bool enabled);
    event CashbackEnabledUpdated(bool enabled);
    event PresaleActiveUpdated(bool active);
    event MinAmountsUpdated(uint256 minBuyAmount, uint256 minSellAmount);
    event FeesDistributed(
        uint256 vaultAmount,
        uint256 marketingAmount,
        uint256 communityAmount,
        uint256 burnAmount,
        uint256 lpAmount
    );
    event CashbackDistributed(address recipient, uint256 amount);
    event LiquidityAdded(uint256 tokenAmount, uint256 ethAmount);
    event BuyFeeParamsUpdated(uint256 buyTaxBp, uint256 vaultShareBp, uint256 marketingShareBp, uint256 burnShareBp);
    event SellFeeParamsUpdated(
        uint256 sellTaxBp,
        uint256 vaultShareBp,
        uint256 autolpShareBp,
        uint256 marketingShareBp,
        uint256 communityShareBp,
        uint256 burnShareBp
    );
    event PresaleFinalized();
    event SupplyRecomputed(uint256 presaleSold, uint256 finalTotalSupply, uint256 mintedLiquidity, uint256 mintedTeamVesting, uint256 mintedOpsDirect, uint256 mintedOpsVesting);
    event TeamVestingClaimed(address recipient, uint256 amount);
    event PendingAutolpExecuted(uint256 amount);
    event OpsVestingClaimed(address recipient, uint256 amount);
    event BlacklistUpdated(address account, bool status, bytes32 reasonHash, string reason);
    event BlacklistTokensSeized(address account, address vault, uint256 amount);
    event Paused(address account);
    event Unpaused(address account);
    event FeeRecipientsUpdated(address vault, address marketing, address community);
    /// @notice A V2 pool was registered or removed for buy/sell fee routing (`isPair`).
    event PairActiveUpdated(address pair, bool active);
    /// @notice Fee exclusion flag for `account` (`isExcludedFromFees`). Emitted on admin setters and on deployment defaults.
    event ExcludedFromFeesUpdated(address account, bool excluded);
    /// @notice A DEX router was added (`active == true`, `factory` from `router.factory()`) or removed (`active == false`).
    event DexRouterUpdated(address router, address factory, bool active);
    /// @notice Post-presale mint recipients (liquidity / team vesting / ops).
    event AllocationRecipientsUpdated(address liquidity, address team, address ops);
    /// @notice BNB-path buy router (`recordBuyAndMintCashback` / `burn`); `address(0)` clears.
    event BuyRouterUpdated(address buyRouter);

    /// @notice Whitepaper §4.1: TCG-VAULT Token, TCGV, 1 milliard supply, BNB Chain.
    /// @param dexRouter_ Initial Uniswap V2–style router (read-only `factory()`, fee-excluded). Add more via `setDexRouter`; register pools with `setPair`.
    constructor(
        address dexRouter_,
        address _vaultAddress,
        address _marketingAddress,
        address _communityAddress,
        address nexusToken_,
        address presaleFinalizer_
    ) ERC20("TCG-VAULT Token", "TCGV") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        if (_vaultAddress == address(0) || _marketingAddress == address(0) || _communityAddress == address(0)) {
            revert ZeroAddress();
        }
        if (nexusToken_ == address(0)) revert ZeroAddress();
        if (dexRouter_ == address(0)) revert ZeroAddress();
        if (presaleFinalizer_ == address(0)) revert ZeroAddress();
        vaultAddress = _vaultAddress;
        marketingAddress = _marketingAddress;
        communityAddress = _communityAddress;
        _nexusToken = nexusToken_;
        presaleFinalizer = presaleFinalizer_;

        emit FeeRecipientsUpdated(_vaultAddress, _marketingAddress, _communityAddress);

        // Exclude the token contract itself so internal accounting transfers (vesting, fee accounting, etc.)
        // do not accidentally trigger buy/sell fee logic.
        isExcludedFromFees[address(this)] = true;
        emit ExcludedFromFeesUpdated(address(this), true);

        _setDexRouter(dexRouter_, true);

        minBuyAmount = 10_000;
        minSellAmount = 10_000;
        emit MinAmountsUpdated(minBuyAmount, minSellAmount);

        // Initial fee / flag state (matches storage defaults) so subgraph has a full snapshot at deploy.
        emit FeesEnabledUpdated(feesEnabled);
        emit CashbackEnabledUpdated(cashbackEnabled);
        emit PresaleActiveUpdated(presaleActive);
        emit BuyFeeParamsUpdated(BUY_TAX, BUY_VAULT_SHARE, BUY_MARKETING_SHARE, BUY_BURN_SHARE);
        emit SellFeeParamsUpdated(
            SELL_TAX,
            SELL_VAULT_SHARE,
            SELL_AUTOLP_SHARE,
            SELL_MARKETING_SHARE,
            SELL_COMMUNITY_SHARE,
            SELL_BURN_SHARE
        );

        // No initial mint. Supply is minted during presale (mintPresale by launch contract) and at presale end (finalizePresaleAndRecompute mints 20% liquidity, 4% team vesting, 5% ops direct, 11% ops vesting — whitepaper §5).
    }

    /// @notice NEXUS token used for buy cashback (same address for the life of the contract).
    function nexusToken() external view returns (address) {
        return _nexusToken;
    }

    /**
     * @notice Register (`active == true`) or remove (`active == false`) a Uniswap V2–style router: stores `factory` from `router.factory()`, fee-excludes the router.
     */
    function setDexRouter(address router, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setDexRouter(router, active);
    }

    function _setDexRouter(address router, bool active) private {
        if (router == address(0)) revert ZeroAddress();
        if (active) {
            address factory_ = IPancakeRouter(router).factory();
            if (factory_ == address(0)) revert ZeroAddress();
            dexFactoryForRouter[router] = factory_;
            isExcludedFromFees[router] = true;
            emit DexRouterUpdated(router, factory_, true);
            emit ExcludedFromFeesUpdated(router, true);
        } else {
            dexFactoryForRouter[router] = address(0);
            isExcludedFromFees[router] = false;
            emit DexRouterUpdated(router, address(0), false);
            emit ExcludedFromFeesUpdated(router, false);
        }
    }

    /**
     * @notice Register (`active == true`) or disable (`active == false`) a V2 pool for taxed buys/sells.
     * @dev Fee logic uses only `isPair`. Call after the pool exists. Use one address per pool (e.g. TCGV/USDC).
     */
    function setPair(address pair, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pair == address(0)) revert PairZeroAddress();
        isPair[pair] = active;
        emit PairActiveUpdated(pair, active);
    }

    /**
     * @notice Update vault, marketing, and community fee recipients (NEXUS stays fixed from constructor).
     */
    function setAddresses(
        address _vaultAddress,
        address _marketingAddress,
        address _communityAddress
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_vaultAddress == address(0) || _marketingAddress == address(0) || _communityAddress == address(0)) {
            revert ZeroAddress();
        }
        vaultAddress = _vaultAddress;
        marketingAddress = _marketingAddress;
        communityAddress = _communityAddress;
        emit FeeRecipientsUpdated(_vaultAddress, _marketingAddress, _communityAddress);
    }

    /**
     * @notice Exclude or include address from fees
     */
    function setExcludedFromFees(address account, bool excluded) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isExcludedFromFees[account] = excluded;
        emit ExcludedFromFeesUpdated(account, excluded);
    }

    /**
     * @notice Enable or disable fees
     */
    function setFeesEnabled(bool _enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feesEnabled = _enabled;
        emit FeesEnabledUpdated(_enabled);
    }

    /**
     * @notice Enable or disable cashback
     */
    function setCashbackEnabled(bool _enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        cashbackEnabled = _enabled;
        emit CashbackEnabledUpdated(_enabled);
    }

    /**
     * @notice Set minimum amounts for buy/sell so fee computation is meaningful.
     */
    function setMinAmounts(uint256 _minBuyAmount, uint256 _minSellAmount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minBuyAmount = _minBuyAmount;
        minSellAmount = _minSellAmount;
        emit MinAmountsUpdated(_minBuyAmount, _minSellAmount);
    }

    /**
     * @notice Blacklist an address (fraud, market manipulation, Sybil). When enabling, confiscates entire TCGV balance to `vaultAddress` first; blacklisted addresses cannot send nor receive after.
     */
    function setBlacklisted(address account, bool status, string calldata reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        bytes memory reasonBytes = bytes(reason);
        if (status && reasonBytes.length == 0) revert EmptyBlacklistReason();
        bytes32 reasonHash = reasonBytes.length == 0 ? bytes32(0) : keccak256(reasonBytes);
        if (status) {
            uint256 bal = balanceOf(account);
            if (bal > 0 && account != vaultAddress) {
                // Direct balance move: bypass fees, blacklist, and pause checks in this contract's _update.
                super._update(account, vaultAddress, bal);
                emit BlacklistTokensSeized(account, vaultAddress, bal);
            }
        }
        isBlacklisted[account] = status;
        emit BlacklistUpdated(account, status, reasonHash, reason);
    }

    /**
     * @notice Pause all transfers (emergency security). When paused, buy/sell/transfer/mintPresale (via _update) are blocked.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @notice Unpause the contract.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @notice Update buy fee parameters (pool mode).
     * @dev Shares are basis points of the buy feeAmount and must sum to 10000.
     */
    function setBuyFeeParams(
        uint256 buyTaxBp,
        uint256 vaultShareBp,
        uint256 marketingShareBp,
        uint256 burnShareBp
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (buyTaxBp > MAX_FEE_BP) revert InvalidFeeParams();
        if (vaultShareBp + marketingShareBp + burnShareBp != 10000) revert InvalidFeeParams();
        BUY_TAX = buyTaxBp;
        BUY_VAULT_SHARE = vaultShareBp;
        BUY_MARKETING_SHARE = marketingShareBp;
        BUY_BURN_SHARE = burnShareBp;
        emit BuyFeeParamsUpdated(buyTaxBp, vaultShareBp, marketingShareBp, burnShareBp);
    }

    /**
     * @notice Update sell fee parameters (pool mode).
     * @dev Shares are basis points of the sell feeAmount and must sum to 10000.
     */
    function setSellFeeParams(
        uint256 sellTaxBp,
        uint256 vaultShareBp,
        uint256 autolpShareBp,
        uint256 marketingShareBp,
        uint256 communityShareBp,
        uint256 burnShareBp
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (sellTaxBp > MAX_FEE_BP) revert InvalidFeeParams();
        if (vaultShareBp + autolpShareBp + marketingShareBp + communityShareBp + burnShareBp != 10000) {
            revert InvalidFeeParams();
        }
        SELL_TAX = sellTaxBp;
        SELL_VAULT_SHARE = vaultShareBp;
        SELL_AUTOLP_SHARE = autolpShareBp;
        SELL_MARKETING_SHARE = marketingShareBp;
        SELL_COMMUNITY_SHARE = communityShareBp;
        SELL_BURN_SHARE = burnShareBp;
        emit SellFeeParamsUpdated(
            sellTaxBp,
            vaultShareBp,
            autolpShareBp,
            marketingShareBp,
            communityShareBp,
            burnShareBp
        );
    }

    /**
     * @notice Set recipients for post-presale mint (whitepaper §5: 20% liquidity, 4% team vesting, 16% ops). Must be set before finalizePresaleAndRecompute().
     */
    function setAllocationRecipients(address _liquidity, address _team, address _ops) external onlyRole(DEFAULT_ADMIN_ROLE) {
        liquidityRecipient = _liquidity;
        teamRecipient = _team;
        opsRecipient = _ops;
        emit AllocationRecipientsUpdated(_liquidity, _team, _ops);
    }

    /**
     * @notice Mint TCGV during presale; only callable by presale finalizer (e.g. launch contract on each buy).
     * @dev Separate from finalizePresaleAndRecompute: this is called many times (per purchase); finalize is called once at presale end to switch cashback and mint allocation buckets.
     */
    function mintPresale(address to, uint256 amount) external {
        if (msg.sender != presaleFinalizer) revert OnlyPresaleFinalizer();
        if (to == address(0)) return;
        if (amount == 0) return;
        _mint(to, amount);
    }

    /**
     * @notice Finalize presale and recompute supply in a single call.
     * @dev Only callable by presaleFinalizer (e.g. InitialLaunch.finalize). Switches cashback from 30% to 10%, then mints: 20% liquidity (direct), 4% team (vesting: 12mo cliff + 24mo monthly), 5% ops (direct), 11% ops (vesting: 36mo monthly, no cliff). Called once at presale end.
     */
    function finalizePresaleAndRecompute() external {
        if (msg.sender != presaleFinalizer) revert OnlyPresaleFinalizer();
        if (supplyRecomputed) revert SupplyAlreadyRecomputed();
        if (!presaleActive) revert PresaleNotFinalized();
        if (liquidityRecipient == address(0) || teamRecipient == address(0) || opsRecipient == address(0)) revert AllocationRecipientsNotSet();

        // Finalize presale: switch cashback 30% -> 10%
        presaleActive = false;
        emit PresaleActiveUpdated(false);
        emit PresaleFinalized();

        uint256 presaleSold = ITCGVaultInitialLaunch(presaleFinalizer).totalTCGVAllocated();
        supplyRecomputed = true;

        if (presaleSold == 0) {
            emit SupplyRecomputed(0, 0, 0, 0, 0, 0);
            return;
        }

        uint256 finalSupply = (presaleSold * 10000) / 6000;
        uint256 currentSupply = totalSupply();
        uint256 toMint = finalSupply - currentSupply;

        // 20% liquidity, 4% team vesting, 5% ops direct, 11% ops vesting = 40%
        uint256 liquidityAmount = (finalSupply * 2000) / 10000;   // 20%
        uint256 teamVestingAmount = (finalSupply * 400) / 10000;  // 4%
        uint256 opsDirectAmount = (finalSupply * 500) / 10000;    // 5%
        uint256 opsVestingAmount = (finalSupply * 1100) / 10000;   // 11%
        uint256 sum = liquidityAmount + teamVestingAmount + opsDirectAmount + opsVestingAmount;

        if (sum > toMint && sum > 0) {
            liquidityAmount = (liquidityAmount * toMint) / sum;
            teamVestingAmount = (teamVestingAmount * toMint) / sum;
            opsDirectAmount = (opsDirectAmount * toMint) / sum;
            opsVestingAmount = toMint - liquidityAmount - teamVestingAmount - opsDirectAmount;
        }

        if (liquidityAmount > 0) _mint(liquidityRecipient, liquidityAmount);
        if (opsDirectAmount > 0) _mint(opsRecipient, opsDirectAmount);

        uint256 t = block.timestamp;
        if (teamVestingAmount > 0) {
            _mint(address(this), teamVestingAmount);
            teamVestingTotal = teamVestingAmount;
            teamVestingCliffEnd = t + 12 * SECONDS_PER_MONTH;
            teamVestingEnd = t + 36 * SECONDS_PER_MONTH; // 12mo cliff + 24mo vesting
        }
        if (opsVestingAmount > 0) {
            _mint(address(this), opsVestingAmount);
            opsVestingTotal = opsVestingAmount;
            opsVestingStart = t;
            opsVestingEnd = t + 36 * SECONDS_PER_MONTH;
        }

        emit SupplyRecomputed(presaleSold, finalSupply, liquidityAmount, teamVestingAmount, opsDirectAmount, opsVestingAmount);
    }

    /**
     * @notice Claim available team vesting. 4% of final supply: 12-month freeze, then linear vest over 24 months. Callable by anyone; tokens sent to teamRecipient.
     */
    function claimTeam() external nonReentrant {
        uint256 claimable = _teamVestingClaimable();
        if (claimable == 0) revert NoTeamVestingToClaim();
        teamVestingClaimed += claimable;
        super._update(address(this), teamRecipient, claimable);
        emit TeamVestingClaimed(teamRecipient, claimable);
    }

    /**
     * @notice Claim available ops vesting. 11% of final supply: linear vest over 36 months (no freeze). Callable by anyone; tokens sent to opsRecipient.
     */
    function claimOps() external nonReentrant {
        uint256 claimable = _opsVestingClaimable();
        if (claimable == 0) revert NoOpsVestingToClaim();
        opsVestingClaimed += claimable;
        super._update(address(this), opsRecipient, claimable);
        emit OpsVestingClaimed(opsRecipient, claimable);
    }

    /// @dev Returns claimable team vesting amount (linear from cliff end to teamVestingEnd).
    function _teamVestingClaimable() private view returns (uint256) {
        if (teamVestingTotal == 0 || block.timestamp < teamVestingCliffEnd) return 0;
        uint256 vestDuration = teamVestingEnd - teamVestingCliffEnd;
        uint256 elapsed = block.timestamp > teamVestingEnd ? vestDuration : (block.timestamp - teamVestingCliffEnd);
        uint256 vested = (teamVestingTotal * elapsed) / vestDuration;
        return vested > teamVestingClaimed ? vested - teamVestingClaimed : 0;
    }

    /// @dev Returns claimable ops vesting amount (linear from opsVestingStart to opsVestingEnd).
    function _opsVestingClaimable() private view returns (uint256) {
        if (opsVestingTotal == 0 || block.timestamp <= opsVestingStart) return 0;
        uint256 vestDuration = opsVestingEnd - opsVestingStart;
        uint256 elapsed = block.timestamp >= opsVestingEnd ? vestDuration : (block.timestamp - opsVestingStart);
        uint256 vested = (opsVestingTotal * elapsed) / vestDuration;
        if (vested > opsVestingClaimed) return vested - opsVestingClaimed;
        return 0;
    }

    /// @notice View: claimable team vesting amount (for teamRecipient).
    function teamVestingClaimable() external view returns (uint256) {
        return _teamVestingClaimable();
    }

    /// @notice View: claimable ops vesting amount (for opsRecipient).
    function opsVestingClaimable() external view returns (uint256) {
        return _opsVestingClaimable();
    }

    /// @notice Effective cashback rate: 30% during presale (Vagues 1 et 2), 10% in standard period (whitepaper §6). Rates are constants.
    function getCashbackRate() public view returns (uint256) {
        return presaleActive ? CASHBACK_RATE_PRESALE : CASHBACK_RATE;
    }

    /**
     * @notice Set the buy router (fee in BNB path). Only this contract can call recordBuyAndMintCashback.
     */
    function setBuyRouter(address _buyRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address previous = buyRouter;
        if (previous != address(0) && previous != _buyRouter) {
            isExcludedFromFees[previous] = false;
            emit ExcludedFromFeesUpdated(previous, false);
        }
        buyRouter = _buyRouter;
        emit BuyRouterUpdated(_buyRouter);
        if (_buyRouter != address(0)) {
            isExcludedFromFees[_buyRouter] = true;
            emit ExcludedFromFeesUpdated(_buyRouter, true);
        }
    }

    /**
     * @notice Called by buy router after swapping BNB → TCGV: mints NEXUS cashback to recipient (30% presale, 10% standard). Only callable by buyRouter.
     */
    function recordBuyAndMintCashback(address recipient, uint256 tcgvAmount) external {
        if (msg.sender != buyRouter) revert OnlyBuyRouter();
        if (!cashbackEnabled) return;
        uint256 cashbackAmount = (tcgvAmount * getCashbackRate()) / 10000;
        if (cashbackAmount == 0) return;
        ITCGNexusToken(_nexusToken).mintCashback(recipient, cashbackAmount);
        emit CashbackDistributed(recipient, cashbackAmount);
    }

    /**
     * @notice Burn TCGV from caller. Only callable by buyRouter.
     * @dev Burns from msg.sender (router) so router does not need to transfer first — saves gas.
     */
    function burn(uint256 amount) external {
        if (msg.sender != buyRouter) revert OnlyBuyRouter();
        if (amount == 0) return;
        _burn(msg.sender, amount);
    }

    /**
     * @notice Override transfer to apply fees
     * @dev Detects buys (from pair) and sells (to pair). Liquidity helpers should be `isExcludedFromFees` and receive withdrawals before forwarding to users.
     */
    function _update(address from, address to, uint256 amount) internal override {
        if (amount == 0) {
            super._update(from, to, 0);
            return;
        }
        if (paused) revert ContractPaused();
        if (isBlacklisted[from] || isBlacklisted[to]) revert Blacklisted();

        // Skip fees for excluded addresses
        if (isExcludedFromFees[from] || isExcludedFromFees[to] || !feesEnabled) {
            super._update(from, to, amount);
            return;
        }

        bool isBuy = isPair[from];
        bool isSell = isPair[to];

        // Apply fees only for buy or sell (enforce minimum so fees compute correctly)
        if (isBuy) {
            if (amount < minBuyAmount) revert MinAmountNotMet(amount, minBuyAmount);
            _handleBuy(from, to, amount);
        } else if (isSell) {
            if (amount < minSellAmount) revert MinAmountNotMet(amount, minSellAmount);
            _handleSell(from, to, amount);
        } else {
            // Regular transfer, no fees
            super._update(from, to, amount);
        }
    }

    /**
     * @notice Handle buy transaction with fees. Fees are taken from the buyer (to), not from the pair, for Pancake compatibility.
     */
    function _handleBuy(address from, address to, uint256 amount) private {
        uint256 feeAmount = (amount * BUY_TAX) / 10000;

        // Pair sends full amount to buyer; then buyer pays fees to vault/marketing/burn.
        super._update(from, to, amount);
        if (feeAmount > 0) _distributeBuyFeesFrom(to, feeAmount);
        _distributeCashback(to, amount);
    }

    /**
     * @notice Handle sell transaction with fees. Fees are distributed directly from the seller (from); autolp share is accumulated on this contract for manual liquidity add.
     */
    function _handleSell(address from, address to, uint256 amount) private nonReentrant {
        uint256 feeAmount = (amount * SELL_TAX) / 10000;
        uint256 transferAmount = amount - feeAmount;

        super._update(from, to, transferAmount);
        if (feeAmount > 0) _distributeSellFeesFrom(from, feeAmount);
    }

    /**
     * @notice Distribute buy fees directly from buyer (to).
     */
    function _distributeBuyFeesFrom(address from, uint256 totalFee) private {
        uint256 vaultAmount = (totalFee * BUY_VAULT_SHARE) / 10000;
        uint256 marketingAmount = (totalFee * BUY_MARKETING_SHARE) / 10000;
        uint256 burnAmount = (totalFee * BUY_BURN_SHARE) / 10000;

        if (vaultAmount > 0) super._update(from, vaultAddress, vaultAmount);
        if (marketingAmount > 0) super._update(from, marketingAddress, marketingAmount);
        if (burnAmount > 0) _burn(from, burnAmount);
        emit FeesDistributed(vaultAmount, marketingAmount, 0, burnAmount, 0);
    }

    /**
     * @notice Distribute sell fees directly from source (seller). Autolp share is sent to this contract and accumulated in pendingAutolp for manual liquidity add by owner.
     */
    function _distributeSellFeesFrom(address from, uint256 totalFee) private {
        uint256 vaultAmount = (totalFee * SELL_VAULT_SHARE) / 10000;
        uint256 autolpAmount = (totalFee * SELL_AUTOLP_SHARE) / 10000;
        uint256 marketingAmount = (totalFee * SELL_MARKETING_SHARE) / 10000;
        uint256 communityAmount = (totalFee * SELL_COMMUNITY_SHARE) / 10000;
        uint256 burnAmount = (totalFee * SELL_BURN_SHARE) / 10000;

        if (vaultAmount > 0) super._update(from, vaultAddress, vaultAmount);
        if (autolpAmount > 0) {
            super._update(from, address(this), autolpAmount);
            pendingAutolp += autolpAmount;
        }
        if (marketingAmount > 0) super._update(from, marketingAddress, marketingAmount);
        if (communityAmount > 0) super._update(from, communityAddress, communityAmount);
        if (burnAmount > 0) _burn(from, burnAmount);
        emit FeesDistributed(vaultAmount, marketingAmount, communityAmount, burnAmount, autolpAmount);
    }

    /**
     * @notice Distribute cashback in TCGNexus tokens (30% presale, 10% standard). Reverts if mint fails.
     */
    function _distributeCashback(address recipient, uint256 purchaseAmount) private {
        if (!cashbackEnabled) return;
        uint256 cashbackAmount = (purchaseAmount * getCashbackRate()) / 10000;
        if (cashbackAmount == 0) return;

        ITCGNexusToken(_nexusToken).mintCashback(recipient, cashbackAmount);
        emit CashbackDistributed(recipient, cashbackAmount);
    }

    /**
     * @notice Execute pending autolp (sell-fee portion).
     * @dev Liquidity is handled manually by the designated wallet off-chain. This function
     *      simply transfers the accumulated autolp tokens to the vault/liquidity wallet so
     *      it can add liquidity directly on PancakeSwap.
     */
    function executePendingAutolp() external {
        uint256 amount = pendingAutolp;
        if (amount == 0) return;
        pendingAutolp = 0;
        super._update(address(this), vaultAddress, amount);
        emit PendingAutolpExecuted(amount);
    }

    error InvalidFeeParams();
}
