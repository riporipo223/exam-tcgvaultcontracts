// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IPancakeV2.sol";
import "./interfaces/ITCGNexusToken.sol";

/// @notice Pair address cannot be zero.
error PairZeroAddress();
/// @notice Transfer amount below minimum for buy/sell; fees would be incorrect or zero.
error MinAmountNotMet(uint256 amount, uint256 minimum);
/// @notice Only the buy router can call this.
error OnlyBuyRouter();

/**
 * @title TCGVaultToken (TCGV)
 * @notice Token A — le Moteur économique (whitepaper §4.1). BNB Chain, 1 milliard supply.
 * @dev Taxe achat 15% (10% Vault, 3% Marketing, 2% burn) + 10% cashback NEXUS. Taxe vente 10%.
 */
contract TCGVaultToken is ERC20, Ownable, ReentrancyGuard {
    // Fee parameters (basis points, 10000 = 100%) — whitepaper defaults; owner-modifiable for pool/router modes
    uint256 public BUY_TAX = 1500; // 15%
    uint256 public SELL_TAX = 1000; // 10%
    uint256 public CASHBACK_RATE = 1000; // 10% cashback in TCG-NEXUS (sells don't generate cashback)

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
    address public stablecoin; // USDC for vault allocation (whitepaper: converti en stablecoin)
    /// @notice When set, buys through this router charge fee in BNB (router path); only this address can call recordBuyAndMintCashback.
    address public buyRouter;

    // State variables
    bool public feesEnabled = true;
    bool public cashbackEnabled = true;
    /// @notice Minimum transfer amount for buy; below this, fee computation is unreliable.
    uint256 public minBuyAmount;
    /// @notice Minimum transfer amount for sell; below this, fee computation is unreliable.
    uint256 public minSellAmount;
    mapping(address => bool) public isExcludedFromFees;
    mapping(address => bool) public isPair;

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
    event CashbackRateUpdated(uint256 cashbackRateBp);

    /// @notice Whitepaper §4.1: TCG-VAULT Token, TCGV, 1 milliard supply, BNB Chain.
    constructor(
        address _pancakeRouter,
        address _vaultAddress,
        address _marketingAddress,
        address _communityAddress,
        address _nexusToken,
        address _stablecoin
    ) ERC20("TCG-VAULT Token", "TCGV") Ownable(msg.sender) {
        pancakeRouter = _pancakeRouter;
        pancakeFactory = IPancakeRouter(_pancakeRouter).factory();
        vaultAddress = _vaultAddress;
        marketingAddress = _marketingAddress;
        communityAddress = _communityAddress;
        nexusToken = _nexusToken;
        stablecoin = _stablecoin;

        pancakePair = IPancakeFactory(pancakeFactory).getPair(address(this), IPancakeRouter(_pancakeRouter).WETH());

        isExcludedFromFees[msg.sender] = true;
        isExcludedFromFees[address(this)] = true;
        isExcludedFromFees[pancakeRouter] = true;

        minBuyAmount = 10_000;
        minSellAmount = 10_000;

        _mint(msg.sender, 1_000_000_000 * 10 ** 18);
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
     * @notice Set addresses for fee distribution
     */
    function setAddresses(
        address _vaultAddress,
        address _marketingAddress,
        address _communityAddress,
        address _nexusToken,
        address _stablecoin
    ) external onlyOwner {
        vaultAddress = _vaultAddress;
        marketingAddress = _marketingAddress;
        communityAddress = _communityAddress;
        nexusToken = _nexusToken;
        stablecoin = _stablecoin;
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
     * @notice Update cashback rate for buy transactions (pool mode).
     */
    function setCashbackRate(uint256 cashbackRateBp) external onlyOwner {
        if (cashbackRateBp > 10000) revert InvalidFeeParams();
        CASHBACK_RATE = cashbackRateBp;
        emit CashbackRateUpdated(cashbackRateBp);
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
     * @notice Called by buy router after swapping BNB → TCGV: mints 10% NEXUS cashback to recipient. Only callable by buyRouter.
     */
    function recordBuyAndMintCashback(address recipient, uint256 tcgvAmount) external {
        if (msg.sender != buyRouter) revert OnlyBuyRouter();
        if (nexusToken == address(0) || !cashbackEnabled) return;
        uint256 cashbackAmount = (tcgvAmount * CASHBACK_RATE) / 10000;
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
     * @notice Handle buy transaction with fees
     */
    function _handleBuy(address from, address to, uint256 amount) private {
        uint256 feeAmount = (amount * BUY_TAX) / 10000;
        uint256 transferAmount = amount - feeAmount;

        // Transfer tokens to recipient (minus fees)
        super._update(from, to, transferAmount);

        // Distribute buy fees
        if (feeAmount > 0) {
            super._update(from, address(this), feeAmount);
            _distributeBuyFees(feeAmount);
        }

        // Distribute cashback
        if (cashbackEnabled && nexusToken != address(0)) {
            _distributeCashback(to, amount);
        }
    }

    /**
     * @notice Handle sell transaction with fees
     */
    function _handleSell(address from, address to, uint256 amount) private nonReentrant {
        uint256 feeAmount = (amount * SELL_TAX) / 10000;
        uint256 transferAmount = amount - feeAmount;

        // Transfer tokens to pair (minus fees)
        super._update(from, to, transferAmount);

        // Distribute sell fees
        if (feeAmount > 0) {
            super._update(from, address(this), feeAmount);
            _distributeSellFees(feeAmount);
        }
    }

    /**
     * @notice Distribute buy fees
     */
    function _distributeBuyFees(uint256 totalFee) private {
        uint256 vaultAmount = (totalFee * BUY_VAULT_SHARE) / 10000;
        uint256 marketingAmount = (totalFee * BUY_MARKETING_SHARE) / 10000;
        uint256 burnAmount = (totalFee * BUY_BURN_SHARE) / 10000;

        // Transfer to vault (will be converted to stablecoin externally)
        if (vaultAmount > 0 && vaultAddress != address(0)) {
            super._update(address(this), vaultAddress, vaultAmount);
        }

        // Transfer to marketing
        if (marketingAmount > 0 && marketingAddress != address(0)) {
            super._update(address(this), marketingAddress, marketingAmount);
        }

        // Burn tokens
        if (burnAmount > 0) {
            _burn(address(this), burnAmount);
        }

        emit FeesDistributed(vaultAmount, marketingAmount, 0, burnAmount, 0);
    }

    /**
     * @notice Distribute sell fees
     */
    function _distributeSellFees(uint256 totalFee) private {
        uint256 vaultAmount = (totalFee * SELL_VAULT_SHARE) / 10000;
        uint256 autolpAmount = (totalFee * SELL_AUTOLP_SHARE) / 10000;
        uint256 marketingAmount = (totalFee * SELL_MARKETING_SHARE) / 10000;
        uint256 communityAmount = (totalFee * SELL_COMMUNITY_SHARE) / 10000;
        uint256 burnAmount = (totalFee * SELL_BURN_SHARE) / 10000;

        // Transfer to vault
        if (vaultAmount > 0 && vaultAddress != address(0)) {
            super._update(address(this), vaultAddress, vaultAmount);
        }

        // Add to liquidity pool
        if (autolpAmount > 0) {
            _addLiquidity(autolpAmount);
        }

        // Transfer to marketing
        if (marketingAmount > 0 && marketingAddress != address(0)) {
            super._update(address(this), marketingAddress, marketingAmount);
        }

        // Transfer to community rewards
        if (communityAmount > 0 && communityAddress != address(0)) {
            super._update(address(this), communityAddress, communityAmount);
        }

        // Burn tokens
        if (burnAmount > 0) {
            _burn(address(this), burnAmount);
        }

        emit FeesDistributed(vaultAmount, marketingAmount, communityAmount, burnAmount, autolpAmount);
    }

    /**
     * @notice Distribute cashback in TCGNexus tokens. Reverts if mint fails.
     */
    function _distributeCashback(address recipient, uint256 purchaseAmount) private {
        if (nexusToken == address(0) || !cashbackEnabled) return;

        uint256 cashbackAmount = (purchaseAmount * CASHBACK_RATE) / 10000;
        if (cashbackAmount == 0) return;

        ITCGNexusToken(nexusToken).mintCashback(recipient, cashbackAmount);
        emit CashbackDistributed(recipient, cashbackAmount);
    }

    /**
     * @notice Add liquidity to PancakeSwap pair
     */
    function _addLiquidity(uint256 tokenAmount) private {
        if (pancakeRouter == address(0) || pancakePair == address(0)) return;

        // Approve router to spend tokens
        _approve(address(this), pancakeRouter, tokenAmount);

        // Get ETH balance for adding liquidity
        uint256 ethAmount = address(this).balance;

        if (ethAmount == 0) {
            // If no ETH, just transfer tokens to pair for future liquidity addition
            super._update(address(this), pancakePair, tokenAmount);
            try IPancakePair(pancakePair).sync() {
                // Sync pair
            } catch {
                // Ignore errors
            }
            return; 
        }

        // Add liquidity via router
        try IPancakeRouter(pancakeRouter).addLiquidityETH{value: ethAmount}(
            address(this),
            tokenAmount,
            0, // slippage tolerance
            0, // slippage tolerance
            address(this),
            block.timestamp + 300
        ) {
            emit LiquidityAdded(tokenAmount, ethAmount);
        } catch {
            // If adding liquidity fails, transfer tokens to pair
            super._update(address(this), pancakePair, tokenAmount);
            try IPancakePair(pancakePair).sync() {
                // Sync pair
            } catch {
                // Ignore errors
            }
        }
    }

    error InvalidFeeParams();
}
