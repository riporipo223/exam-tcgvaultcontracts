// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ITCGVaultBasicNFT.sol";

/**
 * @title TCGVaultStakingVault
 * @notice ERC-4626 vault over TCGV. Used to gate Basic NFT: user must hold at least minStakeForBasicNFT (shares) to keep Basic NFT.
 *   On withdraw/redeem, if owner's share balance falls below minStakeForBasicNFT, their Basic NFT(s) are burned (whitepaper §7.2).
 */
contract TCGVaultStakingVault is ERC4626, Ownable {
    /// @notice Minimum shares required to hold a Basic NFT. Below this, Basic NFT is burned on withdraw.
    uint256 public minStakeForBasicNFT;
    /// @notice Basic NFT contract to call when stake drops below minimum.
    address public basicNFTContract;

    constructor(IERC20 asset_)
        ERC4626(asset_)
        ERC20("TCG-VAULT Staked TCGV", "sTCGV")
        Ownable(msg.sender)
    {}

    function setMinStakeForBasicNFT(uint256 minShares) external onlyOwner {
        minStakeForBasicNFT = minShares;
    }

    function setBasicNFTContract(address basicNFT_) external onlyOwner {
        basicNFTContract = basicNFT_;
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        super._withdraw(caller, receiver, owner, assets, shares);
        if (basicNFTContract != address(0) && minStakeForBasicNFT > 0 && balanceOf(owner) < minStakeForBasicNFT) {
            ITCGVaultBasicNFT(basicNFTContract).burnAllFor(owner);
        }
    }
}
