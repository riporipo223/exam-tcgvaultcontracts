// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITCGVaultBasicNFT} from "./interfaces/ITCGVaultBasicNFT.sol";
import {ITCGVaultToken} from "./interfaces/ITCGVaultToken.sol";

/// @notice Share owner is blacklisted on the underlying TCGV token; withdraw and redeem are disabled for them.
error BlacklistedOwner();
/// @notice Only the underlying asset (`TCGVaultToken`) may call `forceWithdrawFromBlacklist`.
error OnlyAssetToken();

/**
 * @title TCGVaultStakingVault
 * @notice ERC-4626 vault over TCGV. Used to gate Basic NFT: user must hold at least minStakeForBasicNFT (shares) to keep Basic NFT.
 *   On withdraw/redeem, if owner's share balance falls below minStakeForBasicNFT, their Basic NFT(s) are burned.
 *   Withdraw/redeem revert if the share `owner` is blacklisted on `ITCGVaultToken(asset())`. The asset token may call `forceWithdrawFromBlacklist` during blacklist to redeem all shares to the protocol vault.
 */
contract TCGVaultStakingVault is ERC4626, Ownable {
    event MinStakeForBasicNFTUpdated(uint256 minShares);
    event BasicNFTContractUpdated(address basicNFT);
    /// @notice Minimum shares required to hold a Basic NFT. Below this, Basic NFT is burned on withdraw.
    uint256 private _minStakeForBasicNFT;
    /// @notice Basic NFT contract to call when stake drops below minimum.
    address private _basicNFTContract;

    // External getters (private/external pattern)
    function minStakeForBasicNFT() external view returns (uint256) {
        return _minStakeForBasicNFT;
    }

    function basicNFTContract() external view returns (address) {
        return _basicNFTContract;
    }

    constructor(IERC20 asset_)
        ERC4626(asset_)
        ERC20("TCG-VAULT Staked TCGV", "sTCGV")
        Ownable(msg.sender)
    {
    }

    function setMinStakeForBasicNFT(uint256 minShares) external onlyOwner {
        _minStakeForBasicNFT = minShares;
        emit MinStakeForBasicNFTUpdated(minShares);
    }

    function setBasicNFTContract(address basicNFT_) external onlyOwner {
        _basicNFTContract = basicNFT_;
        emit BasicNFTContractUpdated(basicNFT_);
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
        if (_basicNFTContract != address(0) && _minStakeForBasicNFT > 0 && balanceOf(account) < _minStakeForBasicNFT) {
            ITCGVaultBasicNFT(_basicNFTContract).burnAllFor(account);
        }
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual override {
        super._deposit(caller, receiver, assets, shares);
        if (_basicNFTContract != address(0) && _minStakeForBasicNFT > 0 && balanceOf(receiver) >= _minStakeForBasicNFT) {
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
        super._withdraw(caller, receiver, owner, assets, shares);
        if (_basicNFTContract != address(0) && _minStakeForBasicNFT > 0 && balanceOf(owner) < _minStakeForBasicNFT) {
            ITCGVaultBasicNFT(_basicNFTContract).burnAllFor(owner);
        }
    }
}
