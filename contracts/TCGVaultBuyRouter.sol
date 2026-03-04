// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/ITCGVaultToken.sol";
import "./interfaces/IPancakeV2.sol";

/// @notice Sent when buying with zero BNB.
error ZeroBNB();
/// @notice Sent when selling with zero TCGV.
error ZeroTCGV();
/// @notice BNB transfer to vault failed.
error VaultTransferFailed();
/// @notice BNB transfer to marketing failed.
error MarketingTransferFailed();
/// @notice BNB transfer to community failed.
error CommunityTransferFailed();
/// @notice BNB transfer to burn address failed.
error BurnTransferFailed();
/// @notice No TCGV received from swap.
error NoTCGVReceived();
/// @notice Use buyTCGVWithBNB to send BNB.
error UseBuyTCGVWithBNB();
/// @notice Invalid path - first token must be WETH.
error InvalidPath();
/// @notice Output amount is less than minimum required.
error InsufficientOutputAmount();
/// @notice Transaction deadline has passed.
error Expired();
/// @notice BNB transfer to user failed.
error UserTransferFailed();
/// @notice Router retained BNB or sweep failed.
error SweepFailed();
/// @notice Vault, marketing, and community must be non-zero (immutable).
error ZeroAddress();

/**
 * @title TCGVaultBuyRouter
 * @notice Buy TCGV with BNB: BNB fee 13% (10% vault, 3% marketing), then swap for TCGV; 2% of TCGV burned. User receives rest + NEXUS cashback (30% presale, 10% standard — whitepaper §6).
 * @dev This contract is excluded from fees in TCGVaultToken. Cashback rate is determined by TCGVaultToken (presaleActive).
 */
contract TCGVaultBuyRouter is Ownable {
    // Fee params (basis points) — defaults reflect current behavior, but are owner-modifiable.
    // Buy: BNB fee split + TCGV burn on output
    uint256 private _buyVaultBp = 1000; // 10% of BNB
    uint256 private _buyMarketingBp = 300; // 3% of BNB
    uint256 private _buyCommunityBp = 0; // 0% by default
    uint256 private _buyTcgvBurnBp = 200; // 2% of TCGV received is burned

    // Sell: fee in TCGV + distribution
    uint256 private _sellTaxBp = 1000; // 10%
    uint256 private _sellVaultShareBp = 4000; // basis points of totalFee
    uint256 private _sellAutolpShareBp = 3000;
    uint256 private _sellMarketingShareBp = 1000;
    uint256 private _sellCommunityShareBp = 1000;
    uint256 private _sellBurnShareBp = 1000;

    address private immutable _router;
    address private immutable _factory;
    ITCGVaultToken private immutable _tcgv;
    address private immutable _weth;
    address private immutable _vault;
    address private immutable _marketing;
    address private immutable _community;

    event BuyWithBNB(address indexed buyer, uint256 bnbIn, uint256 feeBNB, uint256 tcgvOut);
    event SellTCGVForBNB(address indexed seller, uint256 tcgvIn, uint256 feeTCGV, uint256 bnbOut);
    event BuyFeeParamsUpdated(uint256 vaultBp, uint256 marketingBp, uint256 communityBp, uint256 tcgvBurnBp);
    event SellFeeParamsUpdated(
        uint256 taxBp,
        uint256 vaultShareBp,
        uint256 autolpShareBp,
        uint256 marketingShareBp,
        uint256 communityShareBp,
        uint256 burnShareBp
    );

    struct SellFeeDistribution {
        uint256 vaultAmount;
        uint256 autolpAmount;
        uint256 marketingAmount;
        uint256 communityAmount;
        uint256 burnAmount;
    }

    // External getters (private/external pattern)
    function router() external view returns (address) { return _router; }
    function factory() external view returns (address) { return _factory; }
    function tcgv() external view returns (address) { return address(_tcgv); }
    function weth() external view returns (address) { return _weth; }
    function vault() external view returns (address) { return _vault; }
    function marketing() external view returns (address) { return _marketing; }
    function community() external view returns (address) { return _community; }

    function buyVaultBp() external view returns (uint256) { return _buyVaultBp; }
    function buyMarketingBp() external view returns (uint256) { return _buyMarketingBp; }
    function buyCommunityBp() external view returns (uint256) { return _buyCommunityBp; }
    function buyTcgvBurnBp() external view returns (uint256) { return _buyTcgvBurnBp; }

    function sellTaxBp() external view returns (uint256) { return _sellTaxBp; }
    function sellVaultShareBp() external view returns (uint256) { return _sellVaultShareBp; }
    function sellAutolpShareBp() external view returns (uint256) { return _sellAutolpShareBp; }
    function sellMarketingShareBp() external view returns (uint256) { return _sellMarketingShareBp; }
    function sellCommunityShareBp() external view returns (uint256) { return _sellCommunityShareBp; }
    function sellBurnShareBp() external view returns (uint256) { return _sellBurnShareBp; }

    constructor(
        address router_,
        ITCGVaultToken tcgv_,
        address vault_,
        address marketing_,
        address community_
    ) Ownable(msg.sender) {
        if (vault_ == address(0) || marketing_ == address(0) || community_ == address(0)) revert ZeroAddress();
        _router = router_;
        _factory = IPancakeRouter02(router_).factory();
        _tcgv = tcgv_;
        _weth = IPancakeRouter02(router_).WETH();
        _vault = vault_;
        _marketing = marketing_;
        _community = community_;
    }

    /**
     * @notice Update buy fee parameters (router mode).
     * @dev `vaultBp + marketingBp + communityBp` is taken from msg.value before swap. `tcgvBurnBp` is burned from received TCGV.
     */
    function setBuyFeeParams(
        uint256 vaultBp,
        uint256 marketingBp,
        uint256 communityBp,
        uint256 tcgvBurnBp
    ) external onlyOwner {
        if (vaultBp + marketingBp + communityBp > 10000) revert InvalidFeeParams();
        if (tcgvBurnBp > 10000) revert InvalidFeeParams();
        _buyVaultBp = vaultBp;
        _buyMarketingBp = marketingBp;
        _buyCommunityBp = communityBp;
        _buyTcgvBurnBp = tcgvBurnBp;
        emit BuyFeeParamsUpdated(vaultBp, marketingBp, communityBp, tcgvBurnBp);
    }

    /**
     * @notice Update sell fee parameters (router mode).
     * @dev Shares are basis points of the `totalFee` and must sum to 10000.
     */
    function setSellFeeParams(
        uint256 taxBp,
        uint256 vaultShareBp,
        uint256 autolpShareBp,
        uint256 marketingShareBp,
        uint256 communityShareBp,
        uint256 burnShareBp
    ) external onlyOwner {
        if (taxBp > 10000) revert InvalidFeeParams();
        if (vaultShareBp + autolpShareBp + marketingShareBp + communityShareBp + burnShareBp != 10000) {
            revert InvalidFeeParams();
        }
        _sellTaxBp = taxBp;
        _sellVaultShareBp = vaultShareBp;
        _sellAutolpShareBp = autolpShareBp;
        _sellMarketingShareBp = marketingShareBp;
        _sellCommunityShareBp = communityShareBp;
        _sellBurnShareBp = burnShareBp;
        emit SellFeeParamsUpdated(taxBp, vaultShareBp, autolpShareBp, marketingShareBp, communityShareBp, burnShareBp);
    }

    function _sweepBNB(address recipient) private {
        uint256 bal = address(this).balance;
        if (bal == 0) return;
        address to = recipient == address(0) ? msg.sender : recipient;
        (bool ok,) = payable(to).call{value: bal}("");
        if (!ok) revert SweepFailed();
    }

    /**
     * @notice Get pair address for two tokens
     */
    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pair = IPancakeFactory(_factory).getPair(token0, token1);
    }

    /**
     * @notice Get reserves for a pair, ordered by tokenA/tokenB
     */
    function _getReserves(address tokenA, address tokenB) internal view returns (uint256 reserveA, uint256 reserveB) {
        (address token0,) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        address pair = _pairFor(tokenA, tokenB);
        (uint112 reserve0, uint112 reserve1,) = IPancakePair(pair).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    /**
     * @notice Calculate output amount using PancakeSwap V2 formula (0.25% fee: 9975/10000)
     */
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256 amountOut) {
        require(amountIn > 0, "INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = amountIn * 9975;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 10000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /**
     * @notice Swap supporting fee-on-transfer tokens
     * @dev Calculates input amount from balance changes to handle fee-on-transfer tokens correctly
     */
    function _swapSupportingFeeOnTransferTokens(address[] memory path, address _to) internal {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = input < output ? (input, output) : (output, input);
            IPancakePair pair = IPancakePair(_pairFor(input, output));
            
            uint256 amountInput;
            uint256 amountOutput;
            {
                // Scope to avoid stack too deep errors
                // _getReserves(input, output) returns (reserve of input, reserve of output)
                (uint256 reserveInput, uint256 reserveOutput) = _getReserves(input, output);
                amountInput = IERC20(input).balanceOf(address(pair)) - reserveInput;
                amountOutput = _getAmountOut(amountInput, reserveInput, reserveOutput);
                // Apply 3% slippage so pair's K check never reverts (BSC pair fee/rounding can differ from our 9975/10000)
                amountOutput = (amountOutput * 9700) / 10000;
            }
            // amount0Out/amount1Out are in pair's token0/token1 order
            (uint256 amount0Out, uint256 amount1Out) = input == token0 ? (uint256(0), amountOutput) : (amountOutput, uint256(0));
            address to = i < path.length - 2 ? _pairFor(output, path[i + 2]) : _to;
            pair.swap(amount0Out, amount1Out, to, "");
        }
    }

    /**
     * @notice Buy TCGV with BNB. 13% BNB fee to vault (10%) + marketing (3%); rest swapped for TCGV. 2% of TCGV received is burned. You get rest + 10% NEXUS cashback.
     */
    function buyTCGVWithBNB(uint256 amountOutMin, uint256 deadline) external payable {
        if (msg.value == 0) revert ZeroBNB();
        if (deadline < block.timestamp) revert Expired();

        uint256 vaultBNB = (msg.value * _buyVaultBp) / 10000;
        uint256 marketingBNB = (msg.value * _buyMarketingBp) / 10000;
        uint256 communityBNB = (msg.value * _buyCommunityBp) / 10000;
        uint256 feeBNB = vaultBNB + marketingBNB + communityBNB;
        uint256 swapAmount = msg.value - feeBNB;

        if (vaultBNB > 0) {
            (bool ok,) = payable(_vault).call{value: vaultBNB}("");
            if (!ok) revert VaultTransferFailed();
        }
        if (marketingBNB > 0) {
            (bool ok,) = payable(_marketing).call{value: marketingBNB}("");
            if (!ok) revert MarketingTransferFailed();
        }
        if (communityBNB > 0) {
            (bool ok,) = payable(_community).call{value: communityBNB}("");
            if (!ok) revert CommunityTransferFailed();
        }

        // Build path [WETH, TCGV]
        address[] memory path = new address[](2);
        path[0] = _weth;
        path[1] = address(_tcgv);

        // Deposit ETH to WETH
        IWETH(_weth).deposit{value: swapAmount}();

        // Get pair address and transfer WETH to pair
        address pair = _pairFor(path[0], path[1]);
        IWETH(_weth).transfer(pair, swapAmount);

        // Record balance before swap
        uint256 balanceBefore = _tcgv.balanceOf(address(this));

        // Execute swap directly with pair
        _swapSupportingFeeOnTransferTokens(path, address(this));

        // Verify minimum output
        uint256 balanceAfter = _tcgv.balanceOf(address(this));
        uint256 tcgvReceived = balanceAfter - balanceBefore;
        if (tcgvReceived < amountOutMin) revert InsufficientOutputAmount();
        if (tcgvReceived == 0) revert NoTCGVReceived();

        // Burn configured % of received TCGV (burns from this contract, no transfer needed)
        uint256 burnAmount = (tcgvReceived * _buyTcgvBurnBp) / 10000;
        if (burnAmount > 0) {
            _tcgv.burn(burnAmount);
        }
        
        // Mint NEXUS cashback and transfer remaining TCGV to user
        // This transfer (this→user) is not taxed because this contract is excluded from fees
        uint256 tcgvToUser = tcgvReceived - burnAmount;
        _tcgv.recordBuyAndMintCashback(msg.sender, tcgvReceived);
        _tcgv.transfer(msg.sender, tcgvToUser);
        emit BuyWithBNB(msg.sender, msg.value, feeBNB, tcgvToUser);

        _sweepBNB(_vault);
    }

    /**
     * @notice Calculate sell fee distribution
     */
    function _calculateSellFees(uint256 totalFee) private view returns (SellFeeDistribution memory fees) {
        fees.vaultAmount = (totalFee * _sellVaultShareBp) / 10000;
        fees.autolpAmount = (totalFee * _sellAutolpShareBp) / 10000;
        fees.marketingAmount = (totalFee * _sellMarketingShareBp) / 10000;
        fees.communityAmount = (totalFee * _sellCommunityShareBp) / 10000;
        fees.burnAmount = (totalFee * _sellBurnShareBp) / 10000;
    }

    /**
     * @notice Distribute sell fees to recipients
     */
    function _distributeSellFees(SellFeeDistribution memory fees) private {
        if (fees.vaultAmount > 0) _tcgv.transfer(_vault, fees.vaultAmount);
        if (fees.marketingAmount > 0) _tcgv.transfer(_marketing, fees.marketingAmount);
        if (fees.communityAmount > 0) _tcgv.transfer(_community, fees.communityAmount);
        if (fees.burnAmount > 0) _tcgv.burn(fees.burnAmount);
    }

    /**
     * @notice Sell TCGV for BNB. Fee (10%) is taken in TCGV: 4% vault, 3% autolp (sent to vault for manual LP add), 1% marketing, 1% community, 1% burn.
     */
    function sellTCGVForBNB(uint256 amountIn, uint256 amountOutMin, uint256 deadline) external {
        if (amountIn == 0) revert ZeroTCGV();
        if (deadline < block.timestamp) revert Expired();

        // Pull TCGV from user
        _tcgv.transferFrom(msg.sender, address(this), amountIn);

        // Calculate sell fee and distribution
        uint256 totalFee = (amountIn * _sellTaxBp) / 10000;
        SellFeeDistribution memory fees = _calculateSellFees(totalFee);

        // Distribute fees (except autolpAmount which is kept for liquidity)
        _distributeSellFees(fees);

        // Build path [TCGV, WETH]
        address[] memory path = new address[](2);
        path[0] = address(_tcgv);
        path[1] = _weth;

        // Get pair address and transfer TCGV to pair (amountIn minus fee)
        address pair = _pairFor(path[0], path[1]);
        _tcgv.transfer(pair, amountIn - totalFee);

        // Execute swap and get WETH
        uint256 wethReceived = _swapTCGVForWETH(path);
        if (wethReceived == 0) revert InsufficientOutputAmount();

        // Withdraw WETH to BNB; send autolp TCGV to vault for manual LP, user gets all BNB
        uint256 userBnb = _processSellLiquidityAndPayment(fees.autolpAmount, wethReceived);
        
        // Verify minimum output and send BNB to user
        if (userBnb < amountOutMin) revert InsufficientOutputAmount();
        if (userBnb > 0) {
            (bool ok,) = payable(msg.sender).call{value: userBnb}("");
            if (!ok) revert UserTransferFailed();
        }

        emit SellTCGVForBNB(msg.sender, amountIn, totalFee, userBnb);

        _sweepBNB(_vault);
    }

    /**
     * @notice Swap TCGV for WETH and return amount received
     */
    function _swapTCGVForWETH(address[] memory path) private returns (uint256 wethReceived) {
        uint256 wethBalanceBefore = IWETH(_weth).balanceOf(address(this));
        _swapSupportingFeeOnTransferTokens(path, address(this));
        uint256 wethBalanceAfter = IWETH(_weth).balanceOf(address(this));
        wethReceived = wethBalanceAfter - wethBalanceBefore;
    }

    /**
     * @notice Send autolp TCGV to vault for manual liquidity add. User receives all BNB from the swap.
     * @dev Whitepaper: autoliquidity LP is not added automatically per sell; vault adds liquidity manually (e.g. via TCGVaultLiquidityWrapper).
     */
    function _processSellLiquidityAndPayment(uint256 autolpAmount, uint256 wethReceived) private returns (uint256 userBnb) {
        IWETH(_weth).withdraw(wethReceived);
        userBnb = address(this).balance;
        if (autolpAmount > 0) _tcgv.transfer(_vault, autolpAmount);
    }

    error InvalidFeeParams();

    /// @notice Accept BNB from WETH withdrawal and from user payments
    receive() external payable {}
}
