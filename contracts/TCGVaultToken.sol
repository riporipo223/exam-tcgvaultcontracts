// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IPancakeV2.sol";
import "./interfaces/ITCGNexusToken.sol";
import "./interfaces/ITCGVaultInitialLaunch.sol";

/// @notice Pair address cannot be zero.
error PairZeroAddress();
/// @notice Transfer amount below minimum for buy/sell; fees would be incorrect or zero.
error MinAmountNotMet(uint256 amount, uint256 minimum);
/// @notice Only the buy router can call this.
error OnlyBuyRouter();
/// @notice Only the liquidity wrapper can call setTransientFeeExempt.
error OnlyLiquidityWrapper();
/// @notice Only the presale finalizer (e.g. launch contract) can call this.
error OnlyPresaleFinalizer();
/// @notice Supply already recomputed (one-time).
error SupplyAlreadyRecomputed();
/// @notice Presale not finalized yet.
error PresaleNotFinalized();
/// @notice Presale finalizer can only be set once.
error PresaleFinalizerAlreadySet();
/// @notice Allocation recipients (liquidity, team, ops) must be set before recomputeSupplyAndBurn.
error AllocationRecipientsNotSet();
/// @notice Fee recipient address cannot be zero.
error ZeroAddress();

/**
 * @title TCGVaultToken (TCGV)
 * @notice Token A — le Moteur économique (whitepaper §4). BNB Chain, 1 milliard supply.
 * @dev Initial allocation (whitepaper §5): 60% Presale, 20% Liquidité, 4% Vesting & Équipe, 5% Ops/Marketing immédiat, 11% Ops/Marketing vesting.
 * @dev Taxe achat 15% (10% Vault, 3% Marketing, 2% burn). Cashback NEXUS: 30% pendant les Vagues 1 et 2 (prévente), 10% en période standard (whitepaper §6).
 * @dev Taxe vente 10%.
 */
contract TCGVaultToken is ERC20, Ownable, ReentrancyGuard {
    // Fee parameters (basis points, 10000 = 100%) — whitepaper defaults; owner-modifiable for pool/router modes
    uint256 public BUY_TAX = 1500; // 15%
    uint256 public SELL_TAX = 1000; // 10%
    /// @notice Standard-period cashback in NEXUS (after presale). Whitepaper §6: 10% — immutable.
    uint256 private constant CASHBACK_RATE = 1000; // 10%
    /// @notice Presale cashback (Vagues 1 et 2). Whitepaper §6: BONUS PIONNIER 30% — immutable.
    uint256 private constant CASHBACK_RATE_PRESALE = 3000; // 30%
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

    // Addresses
    address public pancakeRouter;
    address public pancakeFactory;
    address public pancakePair;
    address public vaultAddress;
    address public marketingAddress;
    address public communityAddress;
    address public nexusToken; // TCG-NEXUS token for cashback (Soulbound)
    /// @notice When set, buys through this router charge fee in BNB (router path); only this address can call recordBuyAndMintCashback.
    address public buyRouter;
    /// @notice Liquidity wrapper allowed to set transient fee-exempt slot (EIP-1153 is per-contract; only this contract's tstore is visible in _update).
    address public liquidityWrapper;
    /// @notice Only this address can call finalizePresaleAndRecompute() and mintPresale(). Set to launch contract (e.g. TCGVaultInitialLaunch).
    address public presaleFinalizer;
    /// @notice True after recomputeSupplyAndBurn has been called (one-time; mints 20% liquidity, 15% team, 5% ops per whitepaper §5).
    bool public supplyRecomputed;
    /// @notice Recipients for post-presale mint (whitepaper §5: 20% Liquidité, 15% Équipe, 5% Ops/Marketing). Set by owner before presale end.
    address public liquidityRecipient;
    address public teamRecipient;
    address public opsRecipient;

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

    // Events
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
    event SupplyRecomputed(uint256 presaleSold, uint256 finalTotalSupply, uint256 mintedLiquidity, uint256 mintedTeam, uint256 mintedOps);
    event PendingAutolpExecuted(uint256 amount);

    /// @notice Whitepaper §4.1: TCG-VAULT Token, TCGV, 1 milliard supply, BNB Chain.
    constructor(
        address _pancakeRouter,
        address _vaultAddress,
        address _marketingAddress,
        address _communityAddress,
        address _nexusToken
    ) ERC20("TCG-VAULT Token", "TCGV") Ownable(msg.sender) {
        if (_vaultAddress == address(0) || _marketingAddress == address(0) || _communityAddress == address(0)) {
            revert ZeroAddress();
        }
        pancakeRouter = _pancakeRouter;
        pancakeFactory = IPancakeRouter(_pancakeRouter).factory();
        vaultAddress = _vaultAddress;
        marketingAddress = _marketingAddress;
        communityAddress = _communityAddress;
        nexusToken = _nexusToken;

        pancakePair = IPancakeFactory(pancakeFactory).getPair(address(this), IPancakeRouter(_pancakeRouter).WETH());

        isExcludedFromFees[msg.sender] = true;
        isExcludedFromFees[address(this)] = true;
        isExcludedFromFees[pancakeRouter] = true;

        minBuyAmount = 10_000;
        minSellAmount = 10_000;

        // No initial mint. Supply is minted during presale (mintPresale by launch contract) and at presale end (recomputeSupplyAndBurn mints 20% liquidity, 15% team, 5% ops — whitepaper §5).
    }

    /**
     * @notice Set PancakeSwap pair address
     * @dev Call this after liquidity is added to set the pair address
     */
    function setPair(address _pair) external onlyOwner {
        if (_pair == address(0)) revert PairZeroAddress();
        pancakePair = _pair;
        isPair[_pair] = true;
        // Do not exclude pair from fees: buys (pair -> user) and sells (user -> pair) must be taxed
    }

    /**
     * @notice Add or remove pair address
     */
    function setPairStatus(address _pair, bool _status) external onlyOwner {
        isPair[_pair] = _status;
    }

    /**
     * @notice Set the liquidity wrapper that may call setTransientFeeExempt (for add/remove liquidity without fees).
     */
    function setLiquidityWrapper(address _wrapper) external onlyOwner {
        liquidityWrapper = _wrapper;
    }

    /**
     * @notice Set transient fee-exempt flag (EIP-1153). Only callable by liquidityWrapper. Wrapper must call with 1 before add/remove liquidity and 0 after, so _update sees the flag in the same tx.
     * @dev Transient storage is per-contract: only this contract's tstore is visible in this contract's tload. The wrapper cannot set our slot from its contract; it must call this.
     */
    function setTransientFeeExempt(uint256 value) external {
        if (msg.sender != liquidityWrapper) revert OnlyLiquidityWrapper();
        assembly {
            tstore(0, value)
        }
    }

    /**
     * @notice Set addresses for fee distribution
     */
    function setAddresses(
        address _vaultAddress,
        address _marketingAddress,
        address _communityAddress,
        address _nexusToken
    ) external onlyOwner {
        if (_vaultAddress == address(0) || _marketingAddress == address(0) || _communityAddress == address(0)) {
            revert ZeroAddress();
        }
        vaultAddress = _vaultAddress;
        marketingAddress = _marketingAddress;
        communityAddress = _communityAddress;
        nexusToken = _nexusToken;
    }

    /**
     * @notice Exclude or include address from fees
     */
    function setExcludedFromFees(address account, bool excluded) external onlyOwner {
        isExcludedFromFees[account] = excluded;
    }

    /**
     * @notice Enable or disable fees
     */
    function setFeesEnabled(bool _enabled) external onlyOwner {
        feesEnabled = _enabled;
    }

    /**
     * @notice Enable or disable cashback
     */
    function setCashbackEnabled(bool _enabled) external onlyOwner {
        cashbackEnabled = _enabled;
    }

    /**
     * @notice Set minimum amounts for buy/sell so fee computation is meaningful.
     */
    function setMinAmounts(uint256 _minBuyAmount, uint256 _minSellAmount) external onlyOwner {
        minBuyAmount = _minBuyAmount;
        minSellAmount = _minSellAmount;
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
    ) external onlyOwner {
        if (buyTaxBp > 10000) revert InvalidFeeParams();
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
    ) external onlyOwner {
        if (sellTaxBp > 10000) revert InvalidFeeParams();
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
     * @notice Set the presale finalizer (e.g. TCGVaultInitialLaunch) once. Only this address can call finalizePresaleAndRecompute() and mintPresale(). Cannot be changed after first set.
     */
    function setPresaleFinalizer(address _presaleFinalizer) external onlyOwner {
        if (presaleFinalizer != address(0)) revert PresaleFinalizerAlreadySet();
        presaleFinalizer = _presaleFinalizer;
    }

    /**
     * @notice Set recipients for post-presale mint (whitepaper §5: 20% liquidity, 15% team, 5% ops). Must be set before recomputeSupplyAndBurn().
     */
    function setAllocationRecipients(address _liquidity, address _team, address _ops) external onlyOwner {
        liquidityRecipient = _liquidity;
        teamRecipient = _team;
        opsRecipient = _ops;
    }

    /**
     * @notice Mint TCGV during presale; only callable by presale finalizer (e.g. launch contract on each buy).
     * @dev Separate from finalizePresaleAndRecompute: this is called many times (per purchase); finalize is called once at presale end to switch cashback and mint allocation buckets.
     */
    function mintPresale(address to, uint256 amount) external {
        if (msg.sender != presaleFinalizer) revert OnlyPresaleFinalizer();
        if (to == address(0) || amount == 0) return;
        _mint(to, amount);
    }

    /**
     * @notice Finalize presale and recompute supply in a single call.
     * @dev Only callable by presaleFinalizer (e.g. InitialLaunch.finalize). Switches cashback from 30% to 10%, then mints 20%/15%/5% per whitepaper §5. Called once at presale end (mintPresale is per-buy).
     */
    function finalizePresaleAndRecompute() external {
        if (msg.sender != presaleFinalizer) revert OnlyPresaleFinalizer();
        if (supplyRecomputed) revert SupplyAlreadyRecomputed();
        if (!presaleActive) revert PresaleNotFinalized();
        if (liquidityRecipient == address(0) || teamRecipient == address(0) || opsRecipient == address(0)) revert AllocationRecipientsNotSet();

        // Finalize presale: switch cashback 30% -> 10%
        presaleActive = false;
        emit PresaleFinalized();

        // Recompute supply and mint allocations
        uint256 presaleSold = ITCGVaultInitialLaunch(presaleFinalizer).totalTCGVAllocated();
        supplyRecomputed = true;

        if (presaleSold == 0) {
            emit SupplyRecomputed(0, 0, 0, 0, 0);
            return;
        }

        uint256 finalSupply = (presaleSold * 10000) / 6000;
        uint256 currentSupply = totalSupply();

        uint256 toMint = finalSupply - currentSupply;
        uint256 liquidityAmount = (finalSupply * 2000) / 10000; // 20%
        uint256 teamAmount = (finalSupply * 1500) / 10000;      // 15%
        uint256 opsAmount = (finalSupply * 500) / 10000;         // 5%
        uint256 sum = liquidityAmount + teamAmount + opsAmount;
        if (sum > toMint && sum > 0) {
            liquidityAmount = (liquidityAmount * toMint) / sum;
            teamAmount = (teamAmount * toMint) / sum;
            opsAmount = toMint - liquidityAmount - teamAmount;
        }

        if (liquidityAmount > 0) _mint(liquidityRecipient, liquidityAmount);
        if (teamAmount > 0) _mint(teamRecipient, teamAmount);
        if (opsAmount > 0) _mint(opsRecipient, opsAmount);

        emit SupplyRecomputed(presaleSold, finalSupply, liquidityAmount, teamAmount, opsAmount);
    }

    /// @notice Effective cashback rate: 30% during presale (Vagues 1 et 2), 10% in standard period (whitepaper §6). Rates are constants.
    function getCashbackRate() public view returns (uint256) {
        return presaleActive ? CASHBACK_RATE_PRESALE : CASHBACK_RATE;
    }

    /**
     * @notice Set the buy router (fee in BNB path). Only this contract can call recordBuyAndMintCashback.
     */
    function setBuyRouter(address _buyRouter) external onlyOwner {
        buyRouter = _buyRouter;
        if (_buyRouter != address(0)) {
            isExcludedFromFees[_buyRouter] = true;
        }
    }

    /**
     * @notice Called by buy router after swapping BNB → TCGV: mints NEXUS cashback to recipient (30% presale, 10% standard). Only callable by buyRouter.
     */
    function recordBuyAndMintCashback(address recipient, uint256 tcgvAmount) external {
        if (msg.sender != buyRouter) revert OnlyBuyRouter();
        if (nexusToken == address(0) || !cashbackEnabled) return;
        uint256 cashbackAmount = (tcgvAmount * getCashbackRate()) / 10000;
        if (cashbackAmount == 0) return;
        ITCGNexusToken(nexusToken).mintCashback(recipient, cashbackAmount);
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

    /// @dev Transient storage slot for liquidity wrapper: when set, add/remove liquidity transfers are exempt from fees (EIP-1153).
    uint256 private constant FEE_EXEMPT_SLOT = 0;

    /**
     * @notice Override transfer to apply fees
     * @dev Detects buys (from pair) and sells (to pair). Skips fees when FEE_EXEMPT_SLOT is set (liquidity add/remove via wrapper).
     */
    function _update(address from, address to, uint256 amount) internal override {
        if (amount == 0) {
            super._update(from, to, 0);
            return;
        }

        // Skip fees when liquidity wrapper set transient storage (add/remove liquidity)
        uint256 exempt;
        assembly {
            exempt := tload(FEE_EXEMPT_SLOT)
        }
        if (exempt != 0) {
            super._update(from, to, amount);
            return;
        }

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
        if (cashbackEnabled && nexusToken != address(0)) _distributeCashback(to, amount);
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
        if (nexusToken == address(0) || !cashbackEnabled || recipient == address(0)) return;

        uint256 cashbackAmount = (purchaseAmount * getCashbackRate()) / 10000;
        if (cashbackAmount == 0) return;

        ITCGNexusToken(nexusToken).mintCashback(recipient, cashbackAmount);
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
