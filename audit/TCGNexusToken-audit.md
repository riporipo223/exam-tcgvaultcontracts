# Adversarial Security Audit — TCGNexusToken.sol

**Target:** `contracts/TCGNexusToken.sol` (TCG-NEXUS, BNB Chain)
**Compiler:** Solidity 0.8.27 · OpenZeppelin Contracts 5.6.1
**Commit:** `7e785d4` · **Date:** 2026-08-05
**Mode:** Adversarial bug-bounty hunt (Hunter → Skeptic → Referee)
**Frameworks applied:** `~/.claude/skills/bug-hunter/SKILL.md`, `~/.claude/skills/bug-bounty/SKILL.md`

---

## 1. Skill Loading Verification

| Skill | Path | Exists | Size | SHA-256 |
|---|---|---|---|---|
| `/bug-hunter` | `/Users/ripo/.claude/skills/bug-hunter/SKILL.md` | ✅ | 40,667 B / 754 lines | `06a5316c6f44bbe6…5685efe0` |
| `/bug-bounty` | `/Users/ripo/.claude/skills/bug-bounty/SKILL.md` | ✅ | 76,765 B / 1,609 lines | `f3db5dbed09310aa…3bfcfc3b` |

Both read in full from disk. Supporting skill `web3-audit` also loaded (10 DeFi bug classes, pre-dive kill signals).

**Note on Phase 3 doc paths.** `@docs/getting-started.md`, `@docs/usage-guide.md`, `@docs/cli-reference.md`, `@docs/how-it-works.md`, `@docs/troubleshooting.md`, `@docs/agent-installation.md`, `@modes/fix-pipeline.md` and `@CHANGELOG.md` do **not** exist in the audited repository — they belong to the `bug-hunter` skill package (`~/.claude/skills/bug-hunter/docs/`, `/modes/`). The TCG Vault repo has its own docs (`docs/FEE_REFERENCE.md`, `docs/PRODUCT_LIFECYCLE.md`, `docs/README.md`, `docs/IMPLEMENTATION_NOTES_FR.md`, `docs/WALLET_ADDRESSES.md`) and **no CHANGELOG**. The repo's own docs were used for protocol intent.

### How each framework was applied to Solidity

| Skill construct | Solidity translation used here |
|---|---|
| bug-hunter **Recon** | Repo map, inheritance graph, storage layout, privilege table, trust boundaries |
| bug-hunter **Hunter** | Per-function attack-surface sweep + the "read ALL sibling functions" rule (19% of Criticals) |
| bug-hunter **Skeptic** | Every finding attacked: intended behaviour? realistic attacker? would Immunefi reject it? |
| bug-hunter **Referee** | Valid / Invalid / Manual-review verdict; only Valid enters the report |
| bug-bounty **7-Question Gate** | "Can an attacker do this RIGHT NOW to a user who took no unusual action?" — theoretical findings killed |
| bug-bounty **A→B→C chaining** | Single-contract issues chained across FounderNFT → NEXUS → Router → Governance |
| bug-bounty **HTTP request** → | **Transaction sequence** (exact calls, exact state deltas) |
| bug-bounty **impact-first** | Findings ranked by funds/governance at risk, not by vuln class name |

---

## 2. Repository Understanding

```
contracts/
  TCGNexusToken.sol          ← AUDIT TARGET — soulbound ERC20Votes governance token
  TCGVaultToken.sol          ← TCGV: taxed ERC20, AccessControl, the immutable `_minter` of NEXUS
  TCGVaultBuyRouter.sol      ← USDC⇄TCGV portal; sole trigger of NEXUS cashback minting
  TCGVaultFounderNFT.sol     ← 500 NFT presale; NEXUS presale-bonus minter + clawback caller
  TCGVaultInitialLaunch.sol  ← 600M TCGV presale; NEXUS presale-bonus minter + clawback caller
  TCGRToken.sol              ← soulbound referral token (no NEXUS coupling — verified)
  TCGVaultStakingVault.sol / TCGVaultBasicNFT.sol / TCGVaultLiquidityWrapper.sol /
  TCGRToTCGVConverter.sol    ← no NEXUS coupling (verified by grep across all *.sol)
  interfaces/ libraries/ test/(mocks + Pancake V2 reference impls)
scripts/deployTCGVault.ts    ← wires NEXUS via nonce-predicted address + env vars
docs/                        ← FEE_REFERENCE, PRODUCT_LIFECYCLE, README, WALLET_ADDRESSES
```

Only **5 contracts** touch NEXUS: the token itself, TCGVaultToken, BuyRouter, FounderNFT, InitialLaunch. All five were read.

**Protocol intent (from docs + NatSpec):** NEXUS ("Jeton de Cœur") is a non-transferable membership/governance token for TCG-VAULT guild decisions on real-asset Vault acquisitions. Obtained two ways: (a) 30% presale bonus on FounderNFT/InitialLaunch purchases, (b) cashback on TCGV buys routed through the BuyRouter (30% while `presaleActive`, 3% after). MiCA cooling-off allows cancellation, which is supposed to claw the bonus back.

---

## 3. Contract Architecture

```
TCGNexusToken is ERC20Permit, ERC20Votes, Ownable2Step        (Solidity 0.8.27, OZ 5.6.1)
```

**Storage (all immutable, no mappings, no arrays):**
| Slot | Variable | Purpose |
|---|---|---|
| immutable | `_minter` | = TCGVaultToken. Sole caller of `mintCashback` |
| immutable | `_founderNFTPresaleBonus` | May mint bonus + burn from ANY holder |
| immutable | `_initialLaunchPresaleBonus` | May mint bonus + burn from ANY holder |
| OZ | ERC20 balances/allowances, ERC20Votes checkpoints, Nonces, Ownable2Step owner | |

**Privilege table:**
| Role | Powers | Cap | Revocable |
|---|---|---|---|
| `_minter` | `mintCashback(any, any)` | **none** | ❌ immutable |
| presale bonus ×2 | `mintPresaleBonus(any, any)` + `clawBackPresaleBonus(any, any)` | **none** | ❌ immutable |
| `owner` (Ownable2Step) | **nothing** — zero owner-gated functions | — | n/a |
| pauser / blacklister / upgrader | **do not exist** | — | — |

**State machine:** exactly two reachable transitions — `0 → holder` (mint), `holder → 0` (burn). `_update` reverts when `from != 0 && to != 0`. Balances are genuinely soulbound with no bypass.

**OZ correctness verified:** `_update` override chain `(ERC20, ERC20Votes)` resolves correctly to `ERC20Votes._update → ERC20._update + _transferVotingUnits`; `nonces()` correctly disambiguates `ERC20Permit`/`Nonces`; EIP-712 domain is chain-id aware (no cross-chain replay); `_maxSupply()` uint208 guard intact.

**The structural weakness:** NEXUS enforces **no invariant of its own**. It exports three uncapped, unaccounted, unrevocable privileges and trusts external contracts completely. Every confirmed finding descends from that.

---

## 4. Attack Surface Map

```
                    ┌──────────── attacker (permissionless) ───────────┐
                    │                                                  │
         PancakeSwap USDC/TCGV pair                        TCGVaultFounderNFT
                    │ (donate USDC — unsynced)                         │ mint() → 60 NEXUS
                    ▼                                                  │ transfer NFT (ERC721, unrestricted)
         TCGVaultBuyRouter.buyTCGVWithUSDC(1 wei)                       ▼
                    │ amountInput = balanceOf(pair) − reserve          cancelFounderPurchase()
                    │ ← consumes the donation, 0% fee                   │ clawback truncated to balanceOf(msg.sender)=0
                    ▼                                                   ▼
         TCGVaultToken.recordBuyAndMintCashback         TCGNexusToken.clawBackPresaleBonus  ← NEVER CALLED
                    │ (gated on mutable `buyRouter`, ADMIN_ROLE EOA)
                    ▼
         TCGNexusToken.mintCashback(recipient, ANY AMOUNT)   ← no cap, no rate limit, no supply ceiling
                    │
                    ▼
              ERC20Votes checkpoints ──── delegate() / delegateBySig() ───► vote rental market
                    │
                    ▼
         OZ Governor / Tally ──► control of Vault real-asset acquisitions
```

**Highest-risk entry points:** `clawBackPresaleBonus` (L119), `mintCashback` (L95), `mintPresaleBonus` (L108), inherited `delegate`/`delegateBySig`, `constructor` (L41).

---

## 5. Confirmed Vulnerabilities

| ID | Severity | Title | Permissionless |
|---|---|---|---|
| **H-01** | **High** | Buy-fee bypass via direct pair donation feeds an uncapped NEXUS mint | ✅ |
| **H-02** | **High** | Presale-bonus clawback bypassable by transferring the Founder NFT | ✅ |
| **H-03** | **High** | Unbounded wash-tradeable cashback → governance capture at ~1% of legitimate cost | ✅ |
| **M-01** | Medium | `_minter` immutability is a false guarantee — one ADMIN EOA mints unlimited NEXUS | ❌ (admin) |
| **M-02** | Medium | `clawBackPresaleBonus` can burn any holder's entire balance, including cashback NEXUS | ❌ (presale ctr) |
| **M-03** | Medium | Soulbound guarantee does not cover voting power — `delegate()` enables vote rental | ✅ |
| **M-04** | Medium | Free-cancelled Founder NFT irreversibly starts the whole presale clock | ✅ |
| **L-01** | Low | Immutable privileged addresses unvalidated, from env vars + nonce prediction | ❌ (deploy) |

---

## H-01 — Buy-fee bypass via direct pair donation feeds an uncapped NEXUS mint

### Severity
**High** — permissionless, atomic, repeatable, unbounded theft of protocol fee revenue; simultaneously mints governance tokens against zero protocol income.

### Location
- **Root cause:** `contracts/TCGVaultBuyRouter.sol` — `_swapSupportingFeeOnTransferTokens()` **L213–235**, consumed by `_buyWithUSDC()` **L258–297**
- **Amplified by:** `contracts/TCGNexusToken.sol` — `mintCashback()` **L95–102** (no cap on the amount it accepts)

### Vulnerability Summary
The router charges its 5% buy fee on the USDC it *pulls from the caller*, but the swap it executes consumes **the pair's entire un-synced USDC balance**. An attacker who transfers USDC straight to the pair and then calls `buyTCGVWithUSDC` with 1 wei receives TCGV for the full donated amount having paid **zero** protocol fee — and `mintCashback` mints NEXUS on that entire untaxed output.

### Root Cause

```solidity
// TCGVaultBuyRouter.sol:213-235
function _swapSupportingFeeOnTransferTokens(address[] memory path, address _to) internal {
    ...
    (uint256 reserveInput, uint256 reserveOutput) = _getReserves(input, output);
    amountInput = IERC20(input).balanceOf(address(pair)) - reserveInput;  // ← EVERYTHING unsynced
    amountOutput = _getAmountOut(amountInput, reserveInput, reserveOutput);
    ...
    pair.swap(amount0Out, amount1Out, to, "");
}
```

`getReserves()` returns the **last-synced** reserves; a direct ERC20 transfer to the pair does not update them. So `amountInput` is `donation + swapAmount`, not `swapAmount`.

Meanwhile the fee is computed exclusively from the caller-supplied figure:

```solidity
// TCGVaultBuyRouter.sol:262-266
uint256 vaultUSDC    = (usdcAmount * _buyVaultBp) / 10000;      // 3% of usdcAmount ONLY
uint256 marketingUSDC= (usdcAmount * _buyMarketingBp) / 10000;  // 2% of usdcAmount ONLY
feeUSDC = vaultUSDC + marketingUSDC + communityUSDC;
uint256 swapAmount = usdcAmount - feeUSDC;
```

and the entire swap output — donation included — is credited to the caller and used as the cashback basis:

```solidity
// TCGVaultBuyRouter.sol:288-296
uint256 tcgvReceived = balanceAfter - balanceBefore;      // covers the donated USDC too
_tcgv.recordBuyAndMintCashback(msg.sender, tcgvReceived); // → NEXUS minted on untaxed volume
IERC20(address(_tcgv)).safeTransfer(msg.sender, tcgvToUser);
```

With `usdcAmount = 1`, integer division makes every fee leg exactly `0` — the fee is not merely reduced, it is **zero**.

The K-invariant still passes: the router's `_getAmountOut` uses `9975/10000`, exactly matching the pair's `balanceAdjusted = balance*10000 - amountIn*25` check (`test/PancakePair.sol:477–479`). The swap is a normal, valid PancakeSwap V2 swap.

### Attack Scenario

Single atomic transaction from an attacker contract:

1. Attacker holds 100,000 USDC.
2. `USDC.transfer(pair, 100_000e6)` — a plain ERC20 transfer to the PancakeSwap USDC/TCGV pair. Permissionless; reserves are now stale.
3. `router.buyTCGVWithUSDC(1, 0, block.timestamp)`:
   - Router pulls **1 wei** USDC. `vaultUSDC = 1*300/10000 = 0`, `marketingUSDC = 0` → **`feeUSDC = 0`**.
   - Router forwards 1 wei to the pair.
   - `amountInput = pairBalance − reserve = 100,000 USDC + 1 wei`.
   - Router receives TCGV for the **full 100,000 USDC**.
   - `recordBuyAndMintCashback(attacker, tcgvReceived)` → `mintCashback` mints NEXUS on the full amount.
   - Router `safeTransfer`s **all** the TCGV to the attacker.
4. Attacker ends with ~5% more TCGV than any honest buyer spending the same USDC, plus full NEXUS cashback, having paid the protocol **nothing**.
5. Repeat without limit. Atomicity prevents anyone front-running the donation.

### Exploitability
- **Attacker requirements:** USDC and gas. No role, no whitelist, no approval beyond the 1 wei.
- **Complexity: low.** Two calls, wrappable in a 20-line contract. No flash loan required (though it composes with one).
- **Permissionless:** yes. **Requires compromised privileges:** no.
- **Detection:** buys appear as `BuyWithUSDC(buyer, 1, 0, <huge tcgvOut>)` — glaring in the event log, but nothing on-chain prevents it.

### Impact
- **Total loss of buy-side protocol revenue.** Every USDC routed this way pays 0% instead of 5% (3% vault + 2% structure). Against a hypothetical $10M of routed buy volume that is **$500,000** of fees never collected by the vault and structure wallets.
- **Honest users are systematically disadvantaged** — they pay 5% for the same swap.
- **NEXUS governance tokens are minted against zero protocol income**, directly amplifying H-03: the round-trip cost of farming voting power drops from ~10% to ~4.5% (sell fee + pool fees only), because the buy leg becomes free.
- Unbounded and repeatable; no cap anywhere in the path.

### Recommended Fix

**Primary — measure the input the router actually contributed (`TCGVaultBuyRouter.sol`):**

```solidity
error PairBalanceDesync();

function _swapExact(address input, address output, uint256 amountIn, address to) internal {
    IPancakePair pair = IPancakePair(_pairFor(input, output));
    (uint256 reserveInput, uint256 reserveOutput) = _getReserves(input, output);

    // Only swap what THIS router just sent. Never consume an unsynced donation.
    uint256 unsynced = IERC20(input).balanceOf(address(pair)) - reserveInput;
    if (unsynced != amountIn) revert PairBalanceDesync();   // hard-fail on donation front-running

    uint256 amountOutput = _getAmountOut(amountIn, reserveInput, reserveOutput);
    (address token0,) = input < output ? (input, output) : (output, input);
    (uint256 a0, uint256 a1) = input == token0 ? (uint256(0), amountOutput) : (amountOutput, uint256(0));
    pair.swap(a0, a1, to, "");
}
```

If tolerating donations is preferred over reverting, charge the fee on the **realised** input instead of the declared one:

```solidity
uint256 actualIn = IERC20(input).balanceOf(pair) - reserveInput;
uint256 feeUSDC  = (actualIn * (_buyVaultBp + _buyMarketingBp + _buyCommunityBp)) / 10000;
// …and deduct feeUSDC worth of output, or require(actualIn == swapAmount).
```

Neither TCGV nor USDC is fee-on-transfer (TCGV excludes the router from fees), so the `SupportingFeeOnTransferTokens` pattern is unnecessary here and should be dropped in favour of the exact-input form.

**Defence in depth — cap the mint in `TCGNexusToken` (see H-03 fix #1)** so a manipulated `tcgvAmount` can never translate into unbounded NEXUS.

---

## H-02 — Presale-bonus clawback bypassable by transferring the Founder NFT

### Severity
**High** — permanent, free, unlimited governance-token issuance plus a full USDC refund. Infinitely repeatable.

### Location
- **File:** `contracts/TCGNexusToken.sol` · **Function:** `clawBackPresaleBonus()` **L119–124**
- **Reachable via:** `contracts/TCGVaultFounderNFT.sol` — `cancelFounderPurchase()` **L185–215**

### Vulnerability Summary
NEXUS keeps no record of which holder received which presale bonus, so it cannot enforce reclamation. The caller compensates by truncating the clawback to the canceller's balance. Because the bonus is soulbound to the **buyer** while the Founder NFT is a freely transferable ERC721 and cancellation is authorised purely by current ownership, the address that owes the bonus and the address that is charged for it can be trivially separated.

### Root Cause

```solidity
// TCGNexusToken.sol:108-124 — no per-holder bonus accounting on either side
function mintPresaleBonus(address recipient, uint256 amount) external onlyPresaleBonusContract {
    _mint(recipient, amount);      // nothing recorded
}
function clawBackPresaleBonus(address holder, uint256 amount) external onlyPresaleBonusContract {
    _burn(holder, amount);         // no check that `holder` ever received a bonus
}
```

```solidity
// TCGVaultFounderNFT.sol:202-206 — silent truncation instead of revert
uint256 nexusBalance = IERC20(address(_nexusToken)).balanceOf(msg.sender);
actualNexusBurned = nexusClawedBack > nexusBalance ? nexusBalance : nexusClawedBack;
if (actualNexusBurned > 0) _nexusToken.clawBackPresaleBonus(msg.sender, actualNexusBurned);
```

Two enabling facts:
1. The bonus is minted to the buyer (`TCGVaultFounderNFT.sol:157`) and is **soulbound — it can never move**.
2. `TCGVaultFounderNFT is ERC721, Ownable2Step, ReentrancyGuard` (**L20**) with **no `_update`/transfer override anywhere in the file** — the NFT is freely transferable — and cancellation checks only `if (msg.sender != ownerOf(tokenId)) revert Unauthorized();` (**L186**).

### Attack Scenario

Attacker controls wallets **A** and **B** (B fresh, 0 NEXUS).

1. **A** calls `mint()` — pays 200 USDC (wave 1), receives NFT `#id` and `200e6 * 3000 * 1e18 / (10000 * 1e6)` = **60 NEXUS**, soulbound to A.
2. **A** calls `transferFrom(A, B, id)` — unrestricted.
3. **B** calls `cancelFounderPurchase(id)` inside the 14-day `CANCEL_WINDOW`:
   - `ownerOf(id) == B` → authorised.
   - NFT burned; `_cancelled[id] = true`.
   - `nexusClawedBack = 60e18`, `balanceOf(B) == 0` → `actualNexusBurned = 0` → **`clawBackPresaleBonus` is never called**.
   - `_activeSoldCount--` (**L208**) returns the mint slot to supply.
   - `FounderPurchaseCancelled(B, id, 200e6, 0)` emitted.
4. The CASP refund engine consumes that event — the contract explicitly delegates refunds off-chain ("*USDC refunds are handled off-chain by the CASP. This contract only emits refundDue amounts for indexing*") — and pays out **200 USDC** against a recorded `actualNexusBurned = 0`.
5. **A still holds 60 NEXUS.** Net cost: gas.
6. `_activeSoldCount--` recycles the slot → repeat with a fresh wallet pair, without limit.

**Variant needing no second wallet (secondary-market arbitrage):** Alice legitimately mints and receives 60 NEXUS, then sells the NFT on any marketplace for 190 USDC. Bob cancels and collects the 200 USDC refund. Alice keeps 60 free NEXUS and nets −10 USDC; Bob nets +10 USDC; the CASP absorbs the full 200 with nothing reclaimed. The refund obligation is transferable; the bonus obligation is not.

### Exploitability
- **Permissionless.** No role required.
- **Complexity: trivial** — one extra `transferFrom`. No flash loan, no MEV, no race.
- **Prerequisites:** 200 USDC working capital per cycle (refunded), 14-day window.
- **Not covered by tests:** `test/TCGVaultFounderNFTAndLaunch.test.ts` cancels only from the original minter (lines 220, 314, 378). No test transfers the NFT first.

### Impact
- **Unlimited free governance power** over Vault real-asset acquisition decisions.
- **USDC loss to the CASP/treasury** — full refund paid while the 30% bonus is never returned.
- **Broken MiCA cooling-off guarantee** — the on-chain record asserts reclamation that did not occur. A compliance failure, not only an economic one.
- **Permanent.** NEXUS has no user burn, no pause, no admin recovery. Illegitimately minted NEXUS can never be removed.

### Recommended Fix

**1. Make NEXUS enforce its own invariant (primary):**

```solidity
mapping(address => uint256) private _presaleBonusOf;
error InsufficientPresaleBonus(uint256 outstanding, uint256 requested);

function presaleBonusOf(address holder) external view returns (uint256) {
    return _presaleBonusOf[holder];
}

function mintPresaleBonus(address recipient, uint256 amount) external onlyPresaleBonusContract {
    if (recipient == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();
    _presaleBonusOf[recipient] += amount;
    _mint(recipient, amount);
    emit PresaleBonusMinted(recipient, amount);
}

function clawBackPresaleBonus(address holder, uint256 amount) external onlyPresaleBonusContract {
    if (holder == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();
    uint256 outstanding = _presaleBonusOf[holder];
    // Revert, never truncate: a cancellation that cannot reclaim the bonus must not succeed.
    if (amount > outstanding) revert InsufficientPresaleBonus(outstanding, amount);
    _presaleBonusOf[holder] = outstanding - amount;
    _burn(holder, amount);
    emit PresaleBonusClawedBack(holder, amount);
}
```

This simultaneously fixes **M-02** (clawback can no longer reach cashback-earned NEXUS).

**2. Remove the truncation in both callers** (`TCGVaultFounderNFT.sol:202-206`, `TCGVaultInitialLaunch.sol:207-211`):

```solidity
if (nexusClawedBack > 0) {
    _nexusToken.clawBackPresaleBonus(msg.sender, nexusClawedBack);  // reverts if not reclaimable
    actualNexusBurned = nexusClawedBack;
}
```

**3. Bind cancellation to the original buyer** in `TCGVaultFounderNFT`:

```solidity
mapping(uint256 => address) private _originalBuyer;    // set in mint()
...
if (msg.sender != _originalBuyer[tokenId]) revert Unauthorized();
if (msg.sender != ownerOf(tokenId)) revert Unauthorized();   // must still hold it
```

---

## H-03 — Unbounded wash-tradeable cashback minting → governance capture at ~1% of legitimate cost

### Severity
**High** — economic manipulation leading to hostile governance capture of the Vault treasury.

### Location
- **File:** `contracts/TCGNexusToken.sol` · **Function:** `mintCashback()` **L95–102**
- **Reachable via:** `TCGVaultToken.recordBuyAndMintCashback()` (`TCGVaultToken.sol:599–606`) ← `TCGVaultBuyRouter._buyWithUSDC()` (`TCGVaultBuyRouter.sol:295`)

### Root Cause

`mintCashback` has no ceiling of any kind — no supply cap, no per-recipient cap, no rate limit:

```solidity
function mintCashback(address recipient, uint256 amount) external {
    if (msg.sender != _minter) revert OnlyMinter();
    if (recipient == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();
    _mint(recipient, amount);        // arbitrary amount, unlimited frequency
}
```

The `amount` it blindly accepts derives from an **AMM spot output**, not from value paid:

```solidity
uint256 tcgvReceived = balanceAfter - balanceBefore;        // router
uint256 cashbackAmount = (tcgvAmount * getCashbackRate()) / 10000;   // TCGVaultToken.sol:602
```

Two consequences:
1. **Cashback is paid on volume, not on holdings.** Nothing binds the NEXUS to *retained* TCGV; the buyer can sell the TCGV back in the same transaction and keep the NEXUS permanently (soulbound, no user burn path).
2. **Cashback scales with token *quantity*, so it scales inversely with TCGV price.** Depressing the pool price before the buy multiplies the NEXUS minted per USDC.

`amountOutMin` is caller-supplied (set to `0`); there is no maximum-output check, no TWAP, no reference oracle.

### Attack Scenario

**Baseline wash-farm (post-presale, 3% rate, TCGV ≈ $0.008):**

1. `buyTCGVWithUSDC(100_000e6, 0, deadline)` → 5% router fee → ~95,000 USDC swapped → ~11,875,000 TCGV → **356,250 NEXUS minted**. The router is `isExcludedFromFees`, so TCGV's own 6%/5% tax never applies.
2. `sellTCGVForUSDC(11_875_000e18, 0, deadline)` → 4% fee → ~91,000 USDC returned.
3. **Net cost ≈ 9,000–12,000 USDC for 356,250 permanent, soulbound NEXUS.**
4. Repeat, or run 1–2 atomically inside a flash loan — the loop is self-financing, so capital is not the constraint, only the ~10% friction.

| Path | USDC spent | NEXUS obtained | Cost per NEXUS |
|---|---|---|---|
| Presale buyer (`InitialLaunch.buy`) | 100,000 (fully spent, vested) | 30,000 | **3.33 USDC** |
| Wash-farm cycle | ~10,000 (net) | 356,250 | **0.028 USDC** |

→ Governance weight is **~120× cheaper** for an attacker than for the users the token represents.

**Amplifier 1 — H-01.** Chaining the pair-donation fee bypass removes the 5% buy leg entirely: net friction falls to ~4.5%, roughly **270×** cheaper than a presale buyer.

**Amplifier 2 — price manipulation.** Because cashback tracks TCGV *count*, dumping TCGV into the pair first (optionally flash-borrowed) means the same USDC buys several times more TCGV and mints several times more NEXUS. Reversing costs only pool fees.

**Amplifier 3 — presale window.** While `presaleActive == true`, `getCashbackRate()` returns **3000 bp (30%)**. Any period in which pair liquidity is live while `presaleActive` is still set makes the farm **10× more efficient**.

**Governance endgame.** `ERC20Votes` uses the default `clock()` (`block.number`); OZ Governor snapshots at `proposalSnapshot`. An attacker who sees a proposal enter its voting delay can, inside that window, run the loop, `delegate()` to itself, and hold decisive weight by the snapshot block — then vote on treasury-funded asset acquisitions.

### Exploitability
Permissionless; two public router calls; flash-loan and manipulation amplifiers are standard BNB Chain tooling. Requires live pair liquidity with depth such that per-cycle slippage stays below the value of the NEXUS extracted.

### Impact
- **Hostile governance capture** — Vault acquisition decisions become controllable by whoever burns the most trading fees.
- **Permanent uncapped inflation** of the governance token; every honest holder is irreversibly diluted.
- **The soulbound design is neutralised** — non-transferability was the mechanism meant to prevent vote accumulation.
- No accounting alarm fires: fee recipients *receive* the wash-trading fees, so the attack resembles healthy volume.

### Recommended Fix

**1. Caps and rate limiting inside NEXUS (in-scope, primary):**

```solidity
uint256 public constant MAX_CASHBACK_SUPPLY   = 100_000_000e18;  // per tokenomics
uint256 public constant MAX_CASHBACK_PER_EPOCH= 100_000e18;
uint256 public constant EPOCH = 1 days;

uint256 private _cashbackMinted;
mapping(address => mapping(uint256 => uint256)) private _epochCashback;
error CashbackCapExceeded();

function mintCashback(address recipient, uint256 amount) external {
    if (msg.sender != _minter) revert OnlyMinter();
    if (recipient == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();

    if (_cashbackMinted + amount > MAX_CASHBACK_SUPPLY) revert CashbackCapExceeded();
    uint256 epoch = block.timestamp / EPOCH;
    if (_epochCashback[recipient][epoch] + amount > MAX_CASHBACK_PER_EPOCH) revert CashbackCapExceeded();

    _cashbackMinted += amount;
    _epochCashback[recipient][epoch] += amount;
    _mint(recipient, amount);
    emit CashbackMinted(recipient, amount);
}
```

**2. Denominate cashback in USDC paid, not TCGV received** (`TCGVaultBuyRouter.sol:295`) — removes the price-manipulation amplifier:

```solidity
_tcgv.recordBuyAndMintCashback(msg.sender, swapAmount);   // 6-dec USDC, scaled in TCGVaultToken
```

**3. Break the wash loop** — accrue the entitlement at buy time and mint NEXUS only after a minimum holding period during which the buyer's TCGV balance never drops below the purchased amount; forfeit on early sell.

**4. Ensure liquidity cannot be live while `presaleActive == true`**, or drop `CASHBACK_RATE_PRESALE` on the router path.

---

## M-01 — `_minter` immutability is a false guarantee

### Severity
**Medium** — privilege escalation from one compromised key to unlimited governance issuance. **Critical impact** if that key is compromised.

### Location
`contracts/TCGNexusToken.sol` **L20, L95–102** · escalation via `TCGVaultToken.setBuyRouter()` **L582–595**

### Root Cause
NEXUS hard-codes `_minter` as `immutable` and documents this as the control ("*only it can mint cashback. Set at deployment, immutable*"). But `_minter` is `TCGVaultToken`, which forwards mint authority to a **mutable** address:

```solidity
function setBuyRouter(address _buyRouter) external onlyRole(ADMIN_ROLE) { ... }        // L582
function recordBuyAndMintCashback(address recipient, uint256 tcgvAmount) external {    // L599
    if (msg.sender != buyRouter) revert OnlyBuyRouter();
    ITCGNexusToken(_nexusToken).mintCashback(recipient, cashbackAmount);
}
```

`ADMIN_ROLE` is granted to the **deployer EOA** at construction (`TCGVaultToken.sol:206`). The immutability protects nothing: the effective minter is whatever a single EOA points `buyRouter` at.

### Attack Scenario
1. Attacker obtains the deployer/admin key (phishing, CI compromise, leaked keystore — a single EOA, not a multisig).
2. `setBuyRouter(attackerEOA)`.
3. `recordBuyAndMintCashback(attackerWallet, huge)` — mints arbitrary NEXUS with no USDC, no swap, no pair interaction. Repeat up to the `uint208` safe-supply ceiling.
4. Unassailable voting majority. NEXUS has **no pause, no blacklist, no admin burn, no upgrade path** — permanent and unremediable.

### Impact
Complete permanent governance capture; unlimited inflation; zero recovery mechanism.

### Recommended Fix
- Move `ADMIN_ROLE` and `DEFAULT_ADMIN_ROLE` to a timelocked multisig before liquidity goes live; renounce the deployer EOA.
- Apply the H-03 caps so even a compromised admin cannot mint without bound.
- Timelock + loud event on `setBuyRouter`.
- Correct the `_minter` NatSpec — it asserts a guarantee the architecture does not deliver.

---

## M-02 — `clawBackPresaleBonus` can burn any holder's entire balance

### Severity
**Medium** — unbounded burn authority over every holder, with no accounting boundary.

### Location
`contracts/TCGNexusToken.sol` — `clawBackPresaleBonus()` **L119–124**

### Root Cause
Named and documented as a *presale bonus* clawback, the function is in fact an **unrestricted burn-from-anyone primitive**: no check that `holder` ever received a bonus, no cap at the amount minted, no separation between bonus-minted and cashback-minted NEXUS. The only thing between every holder's balance and a full burn is the discipline of two external contracts that NEXUS can never revoke.

### Attack Scenario
1. A bug or key compromise in `TCGVaultFounderNFT` or `TCGVaultInitialLaunch` yields an arbitrary call from that contract.
2. `clawBackPresaleBonus(victim, balanceOf(victim))` for every holder opposing a proposal — including cashback-earned NEXUS the presale contracts have no claim to.
3. Quorum and outcomes rewritten at will; burned NEXUS can never be reissued (mint paths are gated to other actors and conditions). Victims cannot exit (soulbound) or be protected (no pause).

### Impact
Selective destruction of governance power; permanent uncompensated loss of a non-transferable membership asset; ability to manufacture a governance outcome by eliminating opposing voters.

### Recommended Fix
Adopt the `_presaleBonusOf` accounting from **H-02** — it caps every burn at the bonus that address actually received and makes cashback-earned NEXUS structurally unreachable.

---

## M-03 — Soulbound guarantee does not extend to voting power

### Severity
**Medium** — the economic property the token exists to enforce is circumventable.

### Location
`contracts/TCGNexusToken.sol` **L18** (inherits `ERC20Votes`), **L86–89** (`_update`)

### Root Cause
`_update` makes **balances** soulbound, but `ERC20Votes` exposes `delegate(address)` and `delegateBySig(...)`, neither overridden. Voting units move freely even though tokens cannot:

```solidity
nexus.delegate(buyerOfVotes);   // full voting weight transferred, revocable, renewable
```

Non-transferability of the *balance* is irrelevant to an attacker who only wants the *vote*.

### Attack Scenario
1. Attacker pays NEXUS holders (USDC, off-chain or via escrow) to call `delegate(attacker)` before a proposal snapshot.
2. Holders keep tokens and "membership", pocket the payment, re-delegate afterwards. No penalty, no lockup.
3. Attacker accumulates decisive weight without acquiring a single NEXUS.
4. `delegateBySig` makes this fully automatable — signatures collected off-chain, submitted in one batch immediately before the snapshot block, leaving no reaction window.

Combined with **H-03**, an attacker can mint *and* rent voting power in the same block.

### Impact
A vote-buying market on a token explicitly designed to prevent one; governance over real-asset acquisitions becomes purchasable.

### Recommended Fix

```solidity
error DelegationNotAllowed();

function delegate(address delegatee) public virtual override {
    if (delegatee != _msgSender()) revert DelegationNotAllowed();
    super.delegate(delegatee);
}

function delegateBySig(address, uint256, uint256, uint8, bytes32, bytes32) public virtual override {
    revert DelegationNotAllowed();
}

// Auto-delegate on mint so holders actually have voting power:
function _update(address from, address to, uint256 amount) internal override(ERC20, ERC20Votes) {
    if (from != address(0) && to != address(0)) revert SoulboundTransferNotAllowed();
    super._update(from, to, amount);
    if (to != address(0) && delegates(to) == address(0)) _delegate(to, to);
}
```

If delegation must remain for Tally/Governor compatibility, constrain it (registered-delegate allowlist, or a delegation lock spanning snapshots) and document that voting power is transferable while tokens are not.

**Live usability trap in the same code path:** as written, NEXUS minted to a holder carries **zero voting power** until that holder manually calls `delegate(self)`. Most recipients never will, so the effective electorate is far smaller than supply — which lowers the cost of the H-03 capture attack further. The auto-delegate line above closes this.

---

## M-04 — A free-cancelled Founder NFT irreversibly starts the entire presale clock

### Severity
**Medium** — permissionless, irreversible griefing of the protocol's launch timeline at zero cost.

### Location
`contracts/TCGVaultFounderNFT.sol` — `mint()` **L141–143**, `cancelFounderPurchase()` **L185–215**; consumed by `TCGVaultInitialLaunch.presaleCountdownStartTime()` **L122–126** and `presaleEndTime()` **L129–133**

### Root Cause
The first-ever `mint()` starts the wave-2 clock:

```solidity
if (_wave2StartTimestamp == 0) { _wave2StartTimestamp = block.timestamp + WAVE1_DURATION; }
```

`cancelFounderPurchase` reverses `_activeSoldCount` and every token mapping but **never resets `_wave2StartTimestamp`** (L194–214). That single timestamp drives the whole downstream schedule:

```solidity
presaleCountdownStartTime() = wave2Start + 10 days
presaleEndTime()            = countdownStart + 120 hours   // after which InitialLaunch.buy() reverts
currentPrice()              = PRICE_WAVE2 once wave2Start passes
```

### Attack Scenario
1. Attacker calls `TCGVaultFounderNFT.mint()` on day 0 — pays 200 USDC. `_wave2StartTimestamp` is set permanently.
2. Attacker immediately calls `cancelFounderPurchase(id)` — NFT burned, `_activeSoldCount` back to 0, and (via **H-02**) the 60 NEXUS is retained while the CASP refunds the 200 USDC.
3. The clock keeps running. 7 days later Founder pricing jumps to 350 USDC with **zero** NFTs actually sold; 10 days after that the InitialLaunch 120-hour countdown starts and then **permanently expires**, making `TCGVaultInitialLaunch.buy()` revert with `PresaleCountdownEnded`.
4. Net cost to the attacker: gas.

### Exploitability
Permissionless, single transaction pair, no privileges. Irreversible — no setter resets `_wave2StartTimestamp`. The only backstop is `emergencyFinalize()` (owner-only, and only after `MAX_PRESALE_DURATION`), which *ends* the presale rather than restoring it.

### Impact
An unfunded attacker dictates the launch timetable of both the Founder sale and the 600M-TCGV public presale, can force premature wave-2 pricing before any genuine demand, and can burn the 120-hour public presale window entirely. Fundraising is denied; the schedule cannot be recovered without redeploying.

### Recommended Fix
Reset the clock when the cancellation empties the sale, and derive the wave from real sales rather than a one-shot timestamp:

```solidity
function cancelFounderPurchase(uint256 tokenId) external nonReentrant {
    ...
    _activeSoldCount--;
    if (_activeSoldCount == 0 && _strategicReserveMinted == 0) {
        _wave2StartTimestamp = 0;      // no genuine sale ever happened — restore the pre-launch state
    }
    ...
}
```

Better still, gate the clock on a *settled* sale (past the 14-day cancellation window), so a cancellable purchase can never move protocol-wide state.

---

## L-01 — Immutable privileged addresses unvalidated, from env vars + nonce prediction

### Severity
**Low** (operational) — but unrecoverable if it lands wrong.

### Location
`contracts/TCGNexusToken.sol` **L41–52** (constructor) · `scripts/deployTCGVault.ts:114–156`

### Root Cause
The constructor validates only non-zero:

```solidity
if (minter_ == address(0)) revert ZeroAddress();
if (founderNFTPresaleBonus_ == address(0)) revert ZeroAddress();
if (initialLaunchPresaleBonus_ == address(0)) revert ZeroAddress();
```

while the deploy script sources these from unvalidated operator input and address prediction:

```ts
const nexusPresaleFounder = process.env.NEXUS_PRESALE_BONUS_FOUNDER_NFT?.trim();
const nexusPresaleLaunch  = process.env.NEXUS_PRESALE_BONUS_INITIAL_LAUNCH?.trim();
const futureTcgvAddress   = getContractAddress({ from: deployer.account.address, nonce: nonce + 1n });
await viem.deployContract("TCGNexusToken", [futureTcgvAddress, nexusPresaleFounder, nexusPresaleLaunch], ...);
```

All failure modes are **permanent** (immutable fields, powerless owner, no upgrade path):
- An **EOA** in either presale slot → that EOA holds unlimited `mintPresaleBonus` and unlimited burn-from-any-holder (M-02) forever.
- A stale/typo'd env address → same, or a permanently dead mint path.
- The `nonce + 1` prediction breaks if any other transaction from the deployer lands between the two deploys (replacement tx, nonce gap, mempool reorder) → `_minter` points at an address TCGV does not occupy and **cashback minting is bricked for the life of the token**.

### Recommended Fix

```solidity
error NotAContract();
error DuplicatePresaleBonusContract();

constructor(address minter_, address founderNFTPresaleBonus_, address initialLaunchPresaleBonus_) ... {
    if (minter_ == address(0)) revert ZeroAddress();
    if (founderNFTPresaleBonus_ == address(0)) revert ZeroAddress();
    if (initialLaunchPresaleBonus_ == address(0)) revert ZeroAddress();
    if (founderNFTPresaleBonus_ == initialLaunchPresaleBonus_) revert DuplicatePresaleBonusContract();
    if (founderNFTPresaleBonus_.code.length == 0) revert NotAContract();
    if (initialLaunchPresaleBonus_.code.length == 0) revert NotAContract();
    ...
}
```

`minter_` is a predicted CREATE address and cannot be code-checked at construction — deploy NEXUS with **CREATE2** (or deploy TCGV first and pass NEXUS afterwards) to eliminate the nonce dependency, and assert `nexus.minter() == tcgvAddress` in the script before any further step.

Also remove the **dead `OwnerMinted` event** (L27) — never emitted, implies an owner mint path that does not exist. Either drop `Ownable2Step` (it gates nothing) or give the owner a genuine minimal emergency control.

---

## 6. False Positive Analysis (Skeptic kills — reported for transparency, not submitted)

| Hypothesis | Skeptic verdict | Reason |
|---|---|---|
| `presaleActive` can be stuck at 30% forever, locking the 10× cashback rate | **DISMISSED** | `emergencyFinalize()` (`TCGVaultInitialLaunch.sol:247`) is an owner backstop after `MAX_PRESALE_DURATION` even when wave 2 never starts. Retained only as an H-03 amplifier during the live-liquidity window. |
| Same clawback-truncation leak on the `InitialLaunch` path | **DISMISSED** | Orders are bound to `o.buyer` and cannot be transferred. Traced every ordering of Founder+Launch cancellations: burns always total exactly what was minted. NEXUS is soulbound with no user burn, so a holder cannot lower their balance below what they owe. Only the NFT path decouples payer from owner. |
| ERC20Votes `uint208` safe-supply cap → permanent mint DoS | **DISMISSED** | Reaching 2²⁰⁸ requires ~1.4e28 TCGV of buy volume; total TCGV supply is bounded far below. Unreachable without M-01, which is already terminal. |
| `permit`/`delegateBySig` shared `Nonces` counter → signature griefing | **DISMISSED** | Requires a victim-signed permit, which cannot be forged; permits are useless on a soulbound token so none will exist. No impact. |
| `_safeMint` reentrancy in `TCGVaultFounderNFT.mint()` | **DISMISSED** | `nonReentrant`, and all state (`_purchasedAt`, `_usdcPriceForToken`, `_nexusBonusForToken`, counters) is written **before** the `onERC721Received` callback. Cross-contract re-entry into `InitialLaunch.buy()` is possible but the attacker pays full price — no invariant broken, and the wave transition only moves prices **up**. |
| Sell-fee bypass mirroring H-01 (donate TCGV to pair, sell 1 wei) | **DISMISSED** | The sell fee is charged on **measured output** (`usdcReceived`), not on the declared input — the donation is taxed at the normal 4%. The asymmetry (buy fee on declared input, sell fee on measured output) is precisely why only the buy leg is exploitable. |
| Theft of protocol funds left unsynced in the pair via the H-01 primitive | **DISMISSED** | Checked `executePendingAutolp()` (`TCGVaultToken.sol:714`, moves TCGV to `vaultAddress`, never to the pair) and `TCGVaultLiquidityWrapper.addLiquidity()` (uses `IRouter.addLiquidity`, atomic transferFrom+mint). No protocol flow leaves tokens unsynced. This is why H-01 is High, not Critical. |
| Soulbound bypass via `transferFrom`, `permit`, or an ERC20Votes path | **DISMISSED** | `_update` blocks every account-to-account move; all transfer entry points route through it. Verified against the OZ 5.6.1 `ERC20Votes._update` override chain. |
| Dust-buy rounding creates free NEXUS | **DISMISSED** | Both bonus formulas are exactly proportional; 1-wei USDC yields 3e11 wei NEXUS. No rounding gain. Zero-amount reverts are guarded by `if (nexusAmount > 0)` in both callers, so no revert-DoS either. |

**Low-level classes checked and found clean in the target contract:** reentrancy (no external calls), integer overflow/underflow (0.8.27, no `unchecked`), precision/decimal handling, EIP-712 domain and chain-id (OZ dynamic recompute — no cross-chain replay), nonce management, unbounded loops, storage-growth DoS, proxy/upgrade issues (not upgradeable), `_update`/`nonces` override resolution.

---

## 7. Manual Review Checklist (for the team)

- [ ] Confirm with the CASP whether the off-chain refund engine keys on the `FounderPurchaseCancelled` event recipient or on the original payer — H-02 pays out either way, but the loss attribution differs.
- [ ] Confirm the intended NEXUS total-supply target so the H-03 `MAX_CASHBACK_SUPPLY` cap can be set to a real number.
- [ ] Decide the delegation policy (M-03): self-delegation only, or an allowlisted-delegate model for Tally.
- [ ] Confirm whether pair liquidity can ever be live while `presaleActive == true`; if yes, the 30% rate is exposed to the open AMM.
- [ ] Verify the production owner of `ADMIN_ROLE`/`DEFAULT_ADMIN_ROLE` on `TCGVaultToken` is a timelocked multisig, not the deployer EOA (M-01).
- [ ] Verify `NEXUS_PRESALE_BONUS_*` env values on the production deploy are the real deployed contracts, and assert `nexus.minter() == tcgv` post-deploy (L-01).
- [ ] Re-audit `TCGVaultBuyRouter` after the H-01 fix — the `SupportingFeeOnTransferTokens` pattern is unnecessary here and should be replaced with exact-input swaps.

### Regression tests to add (none currently exist for these paths)
1. Mint Founder NFT from A → transfer to B → `cancelFounderPurchase` from B → **assert revert**, or `balanceOf(A)` drops by the full bonus.
2. Donate USDC directly to the pair → `buyTCGVWithUSDC(1, 0, …)` → **assert revert** (or that fees collected equal 5% of the realised input).
3. `buyTCGVWithUSDC` → `sellTCGVForUSDC` in one transaction → **assert no NEXUS minted** (or capped/forfeited).
4. Manipulate pair reserves → buy with fixed USDC → **assert minted NEXUS is invariant to spot price**.
5. `clawBackPresaleBonus` for more than the recipient's recorded bonus → **assert revert**.
6. `clawBackPresaleBonus` against a holder whose balance is entirely cashback-derived → **assert revert**.
7. Mint one Founder NFT → cancel it → **assert `wave2StartTimestamp() == 0`** and `InitialLaunch.presaleEndTime()` back to `type(uint256).max`.

---

## 8. Critical Risk Assessment

`TCGNexusToken` is small and, at the OpenZeppelin level, correct. The `_update` and `nonces` override chains resolve properly, soulbound balance enforcement has no bypass, and the contract is free of the usual low-level defects — no reentrancy surface, no arithmetic issues under 0.8.27, no signature-replay exposure, no unbounded loops, no proxy risk.

**The risk is entirely architectural.** The token enforces no invariant of its own: it exports three unrevocable, uncapped, unaccounted privileges to external contracts and trusts them absolutely. Two of the three trusted paths are already broken in the deployed design — H-02 proves the presale contracts do not honour the clawback contract, and H-01 proves the router does not honour its own fee contract before feeding the mint. Neither requires any privilege.

The compounding risk is what makes this severe: H-01 makes H-03 cheaper, H-03 makes governance capture affordable, M-03 makes captured weight rentable, and H-02 supplies free voting power on the side. With no pause, no cap, no blacklist, no burn authority and no upgrade path, **every one of these outcomes is permanent**.

**Highest-risk functions:**

| Rank | Function | Why |
|---|---|---|
| 1 | `clawBackPresaleBonus` (L119) | Bypassable today (H-02); unbounded burn-from-anyone (M-02) |
| 2 | `mintCashback` (L95) | Uncapped mint fed by a manipulable, fee-bypassable AMM output (H-01, H-03, M-01) |
| 3 | `mintPresaleBonus` (L108) | Uncapped, unaccounted — the missing half of the clawback invariant |
| 4 | `delegate` / `delegateBySig` (inherited) | Unoverridden voting-power transfer (M-03) |
| 5 | `constructor` (L41) | Three permanent, unvalidated privilege grants (L-01) |

**Missing security controls:** per-holder presale-bonus accounting; max supply cap; per-recipient/per-epoch mint rate limiting; hold requirement binding cashback to retained TCGV; USDC-denominated (not AMM-output-denominated) cashback basis; delegation restriction; auto-delegation on mint; contract-code validation on constructor arguments; and any emergency control whatsoever — no pause, no revocation, no recovery.

---

## 9. Recommended Priority Fixes

| Priority | Fix | Addresses |
|---|---|---|
| **P0 — before any USDC moves through the router** | Replace `_swapSupportingFeeOnTransferTokens` with an exact-input swap that reverts on pair desync (or charge fees on realised input) | H-01 |
| **P0 — before any further presale sales** | Add `_presaleBonusOf` accounting; make `clawBackPresaleBonus` revert instead of truncate; remove caller-side truncation; bind `cancelFounderPurchase` to the original buyer | H-02, M-02 |
| **P0 — before liquidity goes live** | Cap and rate-limit `mintCashback`; denominate cashback in USDC spent; add a hold requirement; ensure `presaleActive` is false whenever the pair is live | H-03 |
| **P1 — before mainnet handover** | Move `ADMIN_ROLE`/`DEFAULT_ADMIN_ROLE` to a timelocked multisig; renounce the deployer EOA; timelock `setBuyRouter` | M-01 |
| **P1** | Decide and enforce the delegation policy; auto-delegate on mint | M-03 |
| **P1** | Reset `_wave2StartTimestamp` when cancellation empties the sale, or gate the clock on settled (post-window) sales | M-04 |
| **P2** | Constructor `code.length` checks + CREATE2 (or reordered) deployment with a post-deploy `minter()` assertion; remove the dead `OwnerMinted` event | L-01 |
