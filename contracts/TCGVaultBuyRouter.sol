// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPancakeRouter02 {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;
}

/// @notice Sent when buying with zero BNB.
error ZeroBNB();
/// @notice BNB transfer to vault failed.
error VaultTransferFailed();
/// @notice BNB transfer to marketing failed.
error MarketingTransferFailed();
/// @notice BNB transfer to burn address failed.
error BurnTransferFailed();
/// @notice No TCGV received from swap.
error NoTCGVReceived();
/// @notice Use buyTCGVWithBNB to send BNB.
error UseBuyTCGVWithBNB();

/**
 * @title TCGVaultBuyRouter
 * @notice Buy TCGV with BNB through this contract: fee is taken in BNB (15%), then remaining BNB is swapped for TCGV. User receives full TCGV from swap + 10% NEXUS cashback.
 * @dev Sets transient storage so TCGVaultToken does not charge TCGV-side fee on the pair→router transfer; fee is already taken in BNB.
 */
contract TCGVaultBuyRouter is Ownable {
    uint256 private constant FEE_EXEMPT_SLOT = 0;
    uint256 private constant BUY_TAX_BP = 1500; // 15%
    uint256 private constant VAULT_SHARE = 6667;   // 10% of total
    uint256 private constant MARKETING_SHARE = 2000; // 3% of total
    uint256 private constant BURN_SHARE = 1333;     // 2% of total

    address public immutable router;
    address public immutable tcgv;
    address public immutable weth;
    address public immutable vault;
    address public immutable marketing;
    address public constant BNB_BURN = 0x000000000000000000000000000000000000dEaD;

    event BuyWithBNB(address indexed buyer, uint256 bnbIn, uint256 feeBNB, uint256 tcgvOut);

    constructor(
        address _router,
        address _tcgv,
        address _vault,
        address _marketing
    ) Ownable(msg.sender) {
        router = _router;
        tcgv = _tcgv;
        weth = IPancakeRouter02(_router).WETH();
        vault = _vault;
        marketing = _marketing;
    }

    /**
     * @notice Buy TCGV with BNB. Fee (15%) is taken in BNB to vault/marketing/burn; rest is swapped for TCGV. You get full TCGV + 10% NEXUS cashback.
     */
    function buyTCGVWithBNB(uint256 amountOutMin, uint256 deadline) external payable {
        if (msg.value == 0) revert ZeroBNB();
        uint256 feeBNB = (msg.value * BUY_TAX_BP) / 10000;
        uint256 swapAmount = msg.value - feeBNB;

        uint256 vaultBNB = (feeBNB * VAULT_SHARE) / 10000;
        uint256 marketingBNB = (feeBNB * MARKETING_SHARE) / 10000;
        uint256 burnBNB = (feeBNB * BURN_SHARE) / 10000;

        if (vaultBNB > 0 && vault != address(0)) {
            (bool ok,) = payable(vault).call{value: vaultBNB}("");
            if (!ok) revert VaultTransferFailed();
        }
        if (marketingBNB > 0 && marketing != address(0)) {
            (bool ok,) = payable(marketing).call{value: marketingBNB}("");
            if (!ok) revert MarketingTransferFailed();
        }
        if (burnBNB > 0) {
            (bool ok,) = payable(BNB_BURN).call{value: burnBNB}("");
            if (!ok) revert BurnTransferFailed();
        }

        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = tcgv;

        assembly {
            tstore(FEE_EXEMPT_SLOT, 1)
        }
        IPancakeRouter02(router).swapExactETHForTokensSupportingFeeOnTransferTokens{value: swapAmount}(
            amountOutMin,
            path,
            address(this),
            deadline
        );
        assembly {
            tstore(FEE_EXEMPT_SLOT, 0)
        }

        uint256 tcgvBalance = IERC20(tcgv).balanceOf(address(this));
        if (tcgvBalance == 0) revert NoTCGVReceived();
        IERC20(tcgv).transfer(msg.sender, tcgvBalance);

        (bool success,) = tcgv.call(
            abi.encodeWithSignature("recordBuyAndMintCashback(address,uint256)", msg.sender, tcgvBalance)
        );
        if (!success) {
            // Cashback is best-effort; do not revert buy
        }

        emit BuyWithBNB(msg.sender, msg.value, feeBNB, tcgvBalance);
    }

    receive() external payable {
        revert UseBuyTCGVWithBNB();
    }
}
