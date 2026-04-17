// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ITCGVaultBasicNFT} from "./interfaces/ITCGVaultBasicNFT.sol";
import {ITCGVaultToken} from "./interfaces/ITCGVaultToken.sol";
import {IPancakeFactory, IPancakePair} from "./interfaces/IPancakeV2.sol";

/// @notice Share owner is blacklisted on the underlying TCGV token; withdraw and redeem are disabled for them.
error BlacklistedOwner();
/// @notice Only the underlying asset (`TCGVaultToken`) may call `forceWithdrawFromBlacklist`.
error OnlyAssetToken();
/// @notice Initial seeding deposit is below the required floor.
error InitialDepositTooSmall();
/// @notice Deposit would mint zero shares and trap assets in the vault.
error ZeroSharesDeposit();
/// @notice Buy router does not expose a valid TCGV/USDC pricing source for this vault.
error InvalidPricingSource();
/// @notice Stake amount must match the exact required threshold.
error ExactStakeRequired(uint256 requiredShares);
/// @notice Partial unstake is disabled; redeem/withdraw must remove the full position.
error FullUnstakeOnly();
/// @notice Vault shares are non-transferable; only mint (deposit) and burn (withdraw/redeem) are allowed.
error NonTransferableShares();

interface IBuyRouterForStaking {
    function factory() external view returns (address);
    function tcgv() external view returns (address);
    function usdc() external view returns (address);
}

/**
 * @title TCGVaultStakingVault
 * @notice ERC-4626 vault over TCGV. Used to gate Basic NFT: user must hold at least requiredStakeForBasicNFT (shares) to keep Basic NFT.
 *   On withdraw/redeem, if owner's share balance falls below requiredStakeForBasicNFT, their Basic NFT(s) are burned.
 *   Withdraw/redeem revert if the share `owner` is blacklisted on `ITCGVaultToken(asset())`. The asset token may call `forceWithdrawFromBlacklist` during blacklist to redeem all shares to the protocol vault.
 */
contract TCGVaultStakingVault is ERC4626, Ownable2Step {
    /// @dev Require non-trivial seeding to reduce first-depositor manipulation surface.
    uint256 private constant MIN_INITIAL_DEPOSIT = 1 ether;
    /// @dev Target Basic NFT stake value in USDC units (6 decimals).
    uint256 private constant BASIC_NFT_TARGET_USDC = 25 * 1e6;

    /// @notice Fallback minimum shares required to hold a Basic NFT when dynamic pricing is unavailable.
    uint256 private _requiredStakeForBasicNFT;
    /// @notice Basic NFT contract to call when stake drops below minimum.
    address private _basicNFTContract;
    /// @notice Optional buy router used as pricing source (same pool as buys: TCGV/USDC on Pancake V2).
    address private _basicNFTPricingRouter;
    /// @notice USDC token for dynamic Basic NFT threshold quotes.
    address private _basicNFTPricingUsdc;

    event RequiredStakeForBasicNFTUpdated(uint256 requiredShares);
    event BasicNFTContractUpdated(address basicNFT);
    event BasicNFTPricingRouterUpdated(address buyRouter, address usdc);

    // External getters (private/external pattern)
    function requiredStakeForBasicNFT() external view returns (uint256) {
        return _currentRequiredStakeForBasicNFT();
    }

    function basicNFTContract() external view returns (address) {
        return _basicNFTContract;
    }

    function basicNFTPricingRouter() external view returns (address) {
        return _basicNFTPricingRouter;
    }

    function basicNFTPricingUsdc() external view returns (address) {
        return _basicNFTPricingUsdc;
    }

    constructor(IERC20 asset_)
        ERC4626(asset_)
        ERC20("TCG-VAULT Staked TCGV", "sTCGV")
        Ownable(msg.sender)
    {
    }

    function setRequiredStakeForBasicNFT(uint256 requiredShares) external onlyOwner {
        _requiredStakeForBasicNFT = requiredShares;
        emit RequiredStakeForBasicNFTUpdated(requiredShares);
    }

    function setBasicNFTContract(address basicNFT_) external onlyOwner {
        _basicNFTContract = basicNFT_;
        emit BasicNFTContractUpdated(basicNFT_);
    }

    /**
     * @notice Configure dynamic Basic NFT minimum stake using the same TCGV/USDC pool as the buy router.
     * @dev When set, requiredStakeForBasicNFT() returns the shares equivalent to ~25 USDC of TCGV at current pool reserves.
     *      If router/pair liquidity is unavailable, vault falls back to _requiredStakeForBasicNFT.
     */
    function setBasicNFTPricingRouter(address buyRouter_) external onlyOwner {
        if (buyRouter_ == address(0)) {
            _basicNFTPricingRouter = address(0);
            _basicNFTPricingUsdc = address(0);
            emit BasicNFTPricingRouterUpdated(address(0), address(0));
            return;
        }
        IBuyRouterForStaking router_ = IBuyRouterForStaking(buyRouter_);
        address tcgv_ = router_.tcgv();
        address usdc_ = router_.usdc();
        address factory_ = router_.factory();
        if (tcgv_ != asset() || usdc_ == address(0) || factory_ == address(0)) revert InvalidPricingSource();
        _basicNFTPricingRouter = buyRouter_;
        _basicNFTPricingUsdc = usdc_;
        emit BasicNFTPricingRouterUpdated(buyRouter_, usdc_);
    }

    function _currentRequiredStakeForBasicNFT() private view returns (uint256) {
        uint256 fallbackRequired = _requiredStakeForBasicNFT;
        if (_basicNFTPricingRouter == address(0) || _basicNFTPricingUsdc == address(0)) return fallbackRequired;

        address pair = IPancakeFactory(IBuyRouterForStaking(_basicNFTPricingRouter).factory()).getPair(
            asset(),
            _basicNFTPricingUsdc
        );
        if (pair == address(0)) return fallbackRequired;

        (uint112 reserve0, uint112 reserve1,) = IPancakePair(pair).getReserves();
        if (reserve0 == 0 || reserve1 == 0) return fallbackRequired;

        address token0 = IPancakePair(pair).token0();
        (uint256 reserveTcgv, uint256 reserveUsdc) = token0 == asset()
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));
        if (reserveUsdc == 0) return fallbackRequired;

        // Ceiling division to avoid underestimating the amount needed to reach the USD target.
        uint256 requiredAssets = (BASIC_NFT_TARGET_USDC * reserveTcgv + reserveUsdc - 1) / reserveUsdc;
        uint256 requiredShares = previewDeposit(requiredAssets);
        return requiredShares == 0 ? fallbackRequired : requiredShares;
    }

    function _sharesToStakeFor(address receiver) private view returns (uint256) {
        uint256 requiredStake = _currentRequiredStakeForBasicNFT();
        uint256 currentShares = balanceOf(receiver);
        if (requiredStake <= currentShares) revert ExactStakeRequired(requiredStake);
        return requiredStake - currentShares;
    }

    /**
     * @notice Redeem all shares of `account` and send underlying TCGV to the token's vault. Only `asset()` may call (used when blacklisting).
     * @dev Uses `super._withdraw` with `caller == owner == account` so no allowance is required. Does not apply the blacklist check on `owner`.
     */
    function forceWithdrawFromBlacklist(address account) external {
        if (msg.sender != asset()) revert OnlyAssetToken();
        uint256 shares = balanceOf(account);
        if (shares == 0) return;
        uint256 assets = previewRedeem(shares);
        _withdraw(account, account, account, assets, shares);
        uint256 requiredStake = _currentRequiredStakeForBasicNFT();
        if (_basicNFTContract != address(0) && requiredStake > 0 && balanceOf(account) < requiredStake) {
            ITCGVaultBasicNFT(_basicNFTContract).burnAllFor(account);
        }
    }

    /**
     * @notice Stake to the current required level for Basic NFT. The `assets` input is ignored.
     * @dev Avoids user-side quote race in volatile pools: contract computes required stake at execution time.
     */
    function deposit(uint256, address receiver) public virtual override returns (uint256) {
        uint256 shares = _sharesToStakeFor(receiver);
        super.mint(shares, receiver);
        return shares;
    }

    /**
     * @notice Stake to the current required level for Basic NFT. The `shares` input is ignored.
     * @dev Mirrors {deposit}: computes target shares on-chain at execution time.
     */
    function mint(uint256, address receiver) public virtual override returns (uint256) {
        uint256 shares = _sharesToStakeFor(receiver);
        return super.mint(shares, receiver);
    }

    /**
     * @notice Unstake everything from `owner`. The `assets` input is ignored.
     * @dev Full exit only to keep a single-position model.
     */
    function withdraw(uint256, address receiver, address owner) public virtual override returns (uint256) {
        uint256 shares = balanceOf(owner);
        if (shares == 0) return 0;
        return super.redeem(shares, receiver, owner);
    }

    /**
     * @notice Unstake everything from `owner`. The `shares` input is ignored.
     * @dev Full exit only to keep a single-position model.
     */
    function redeem(uint256, address receiver, address owner) public virtual override returns (uint256) {
        uint256 shares = balanceOf(owner);
        if (shares == 0) return 0;
        return super.redeem(shares, receiver, owner);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
        if (totalSupply() == 0 && assets < MIN_INITIAL_DEPOSIT) revert InitialDepositTooSmall();
        if (shares == 0) revert ZeroSharesDeposit();
        uint256 requiredStake = _currentRequiredStakeForBasicNFT();
        if (requiredStake > 0 && balanceOf(receiver) + shares != requiredStake) revert ExactStakeRequired(requiredStake);
        super._deposit(caller, receiver, assets, shares);
        if (_basicNFTContract != address(0) && requiredStake > 0 && balanceOf(receiver) >= requiredStake) {
            ITCGVaultBasicNFT(_basicNFTContract).mintFor(receiver);
        }
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        if (ITCGVaultToken(asset()).isBlacklisted(owner)) revert BlacklistedOwner();
        if (shares != balanceOf(owner)) revert FullUnstakeOnly();
        super._withdraw(caller, receiver, owner, assets, shares);
        uint256 requiredStake = _currentRequiredStakeForBasicNFT();
        if (_basicNFTContract != address(0) && requiredStake > 0 && balanceOf(owner) < requiredStake) {
            ITCGVaultBasicNFT(_basicNFTContract).burnAllFor(owner);
        }
    }

    /// @dev Shares are soulbound to staking position: block transfers while allowing mint (from=0) and burn (to=0).
    function _update(address from, address to, uint256 value) internal virtual override(ERC20) {
        if (from != address(0) && to != address(0)) revert NonTransferableShares();
        super._update(from, to, value);
    }

}
