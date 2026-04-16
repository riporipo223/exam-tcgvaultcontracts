# Notes d’implémentation (contrats)

Description **factuelle** du comportement actuel des smart contracts dans ce dépôt. Pour les frais et rôles détaillés (bps, chemins pool vs routeur USDC), voir [**FEE_REFERENCE.md**](FEE_REFERENCE.md).

## Frais et cashback

- **Paire DEX (`TCGVaultToken`) :** taxe d’achat par défaut **6 %** en TCGV (tiers vault / marketing / `pendingAutolp`) ; taxe de vente **5 %** avec répartition par défaut sur la part taxe (**40 % / 40 % / 20 % / 0 %** vault / autolp / marketing / communauté). Pas de burn de supply lié aux frais de swap sur ce chemin.
- **Routeur USDC (`TCGVaultBuyRouter`) :** frais d’achat en USDC (défaut **5 %** : **3 %** vault + **2 %** marketing) puis échange ; **100 %** du TCGV reçu pour l’acheteur. Vente : frais par défaut **4 %** sur l’USDC sortant, répartition documentée en **FEE_REFERENCE.md** §2.2.
- **Cashback NEXUS :** sur les achats uniquement — **30 %** du montant en TCGV tant que la prévente est active sur le token, **10 %** après finalisation (`TCGVaultToken`).
- **Paramètres modifiables :** `setBuyFeeParams` / `setSellFeeParams` sur le token (`ADMIN_ROLE`) et sur le routeur (`onlyOwner`), plafond **`MAX_FEE_BP = 25 %`**.

## NEXUS (`TCGNexusToken`)

- Décimales **18** ; minter = adresse `TCGVaultToken` (immutable).
- Soulbound : pas de transfert entre comptes.

## NFT Founder (`TCGVaultFounderNFT`)

- **500** unités : vague 1 **250** × **200 USDC** ; vague 2 **250** × **350 USDC**.
- Répartition USDC à chaque mint payant : **30 %** vault / **60 %** liquidité / **10 %** ops (arrondis vers ops si besoin).
- L’acheteur reçoit **30 %** du prix en USDC en **NEXUS** (calcul dans le contrat).
- Réserve propriétaire : jusqu’à **5** mints par vague au même prix ; revert `ReservedForOwner` si le public épuiserait la réserve.

## Prévente token (`TCGVaultInitialLaunch`)

- Prix : **0,005** USDC / 1 TCGV (vague 1) et **0,008** (vague 2 selon `founderNFT.soldCount()`).
- Compte à rebours **120 h** : déclenché quand le Founder NFT vend le **dernier** slot de vague 1 (`wave2StartTimestamp`).
- Plafond dur **600 M** TCGV ; plafond par wallet **4 %** du hard cap.
- Bonus NEXUS : **30 %** de l’USDC engagé (style Founder).
- Finalisation : `finalize()` après la fin du compte à rebours ; pas de finalisation anticipée au seul hard cap.
- Après `finalize()` : **TGE 10 %**, puis **10 % / mois** pendant **9** mois (`releasable()` / `claim()`).

## Post-TGE — routeur et token

- Routeur USDC : adresse exclue des frais sur `TCGVaultToken` pour éviter la double taxation sur ce parcours.
- Voir [**PRODUCT_LIFECYCLE.md**](PRODUCT_LIFECYCLE.md) (résumé cycle de vie) et les sources Solidity.

## Staking et NFT Basique

- Vault **ERC-4626** sur le TCGV ; seuil `minStakeForBasicNFT` pour mint du NFT Basique au **receiver** ; retrait sous le minimum **brûle** le NFT Basique du wallet.
- NFT Basique **soulbound**.
