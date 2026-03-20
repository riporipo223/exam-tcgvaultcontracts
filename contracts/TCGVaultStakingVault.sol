// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITCGVaultBasicNFT} from "./interfaces/ITCGVaultBasicNFT.sol";

/**
 * @title TCGVaultStakingVault
 * @notice ERC-4626 vault over TCGV. Used to gate Basic NFT: user must hold at least minStakeForBasicNFT (shares) to keep Basic NFT.
 *   On withdraw/redeem, if owner's share balance falls below minStakeForBasicNFT, their Basic NFT(s) are burned (whitepaper §7.2).
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
        super._withdraw(caller, receiver, owner, assets, shares);
        if (_basicNFTContract != address(0) && _minStakeForBasicNFT > 0 && balanceOf(owner) < _minStakeForBasicNFT) {
            ITCGVaultBasicNFT(_basicNFTContract).burnAllFor(owner);
        }
    }
}
