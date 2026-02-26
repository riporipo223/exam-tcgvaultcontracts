# Rapport — Points non précisés ou ambigus du White Paper TCG-VAULT (Version Finale)

Document destiné au fondateur du projet. Ce rapport liste les éléments du white paper qui ne sont pas explicitement définis ou qui nécessitent une clarification technique ou juridique pour l’implémentation des smart contracts et des processus.

---

## 1. Token $TCGNEXUS — Définition technique

- **« 30 % du montant » en $TCGNEXUS**  
  Le white paper indique un bonus de 30 % en $TCGNEXUS (prévente, NFT Founder). Il ne précise pas :
  - La **décimalisation** du token $TCGNEXUS (ex. 18 décimales).
  - La **règle de conversion** : 30 % du montant en USDC converti en quantité de NEXUS. En l’absence de cours NEXUS/USD, l’implémentation actuelle interprète « 30 % du montant » comme : *montant_USDC × 30 %*, exprimé en unités NEXUS avec 18 décimales (équivalent à un ratio 1:1 USDC → NEXUS pour la part bonus). À confirmer ou ajuster si une autre règle est souhaitée.

- **Soulbound**  
  Le caractère non transférable est bien prévu ; toute précision sur d’éventuelles **exceptions** (blocage, réattribution en cas d’abus, migration) serait utile pour la doc et la conformité.

---

## 2. Prévente token (Initial Launch) — Comportement et acteurs

- **Déclenchement de la vague 2**  
  Le texte indique que la vague 2 (0,008 $/TCGV) démarre « après le 245ème NFT » Founder. Il est implémenté comme : *début du compte à rebours 120h à la vente du 245ème NFT Founder*. À valider : le 245ème correspond bien au **dernier NFT de la vague 1** (pas au premier de la vague 2).

- **Clôture après 120h**  
  Le white paper prévoit un compte à rebours de 120h après le 245ème NFT. Il ne précise pas :
  - Si la prévente doit aussi s’arrêter en cas d’**atteinte du hard cap 600M TCGV** avant la fin des 120h (implémenté : oui, `buy` revert si cap atteint).
  - Qui peut appeler une éventuelle fonction de **clôture manuelle** (ex. `finalize`) et à quelles conditions (uniquement après 120h, ou aussi en cas de cap ?). À préciser pour la gouvernance et l’audit.

- **Vesting — TGE**  
  « TGE : 10 % des tokens immédiatement disponibles ». Il n’est pas précisé à quelle **date** la TGE est considérée comme réalisée (date d’appel à `finalize`, date de listing DEX, autre). L’implémentation utilise l’appel à `finalize()` comme date de TGE pour le calcul du vesting.

---

## 3. NFT Founder Edition

- **Token IDs des 10 NFT réservés communauté**  
  Le white paper indique 10 NFT offerts pour l’animation. Il ne précise pas si ces 10 NFT font partie des 500 (IDs 490–499 dans l’implémentation actuelle) ou s’ils sont comptés à part. Actuellement : 490 payants (245 + 245) + 10 communautaires = 500 au total, IDs 490–499 pour les communautaires.

- **« Mint gratuit » du NFT Basique**  
  Le NFT Basique est « mint gratuit (vous ne payez que les frais de réseau) » avec activation par staking de 25 $ en $TCGV. Le white paper ne précise pas :
  - Le **contrat** (ou l’interface) qui gère ce mint et le staking.
  - La **règle exacte** en cas d’unstake (burn du NFT immédiat, délai, possibilité de restake).

---

## 4. Dynamic Burn — Prévente

- **Moment du recalcul**  
  « Si la prévente ne vend pas la totalité de son allocation, la supply totale est recalculée automatiquement à la clôture. » Il n’est pas précisé :
  - Où et **comment** ce recalcul est exécuté (on-chain à la clôture, script, multisig).
  - Si le **burn du surplus** est effectué en une seule transaction à la clôture ou selon un autre calendrier.

- **Ratios après recalcul**  
  L’exemple donne 60/20/20 (marché/liquidité/équipe). Le white paper ne dit pas explicitement si les 20 % « liquidité » et « équipe » restent en pourcentage de la **nouvelle** supply ou s’il faut recalculer aussi les montants absolus (ex. liquidité déjà injectée). À clarifier pour éviter tout écart entre texte et implémentation.

---

## 5. Sécurité et trésorerie

- **Multisig**  
  « Validation 2/3 » pour la trésorerie est mentionnée. À confirmer : les adresses des signataires, la politique de rotation et si certaines opérations (ex. clôture prévente, migration LP) doivent passer par la même multisig ou une procédure spécifique.

- **Proof of Reserve**  
  « Hash/timestamp pour garantir l’intégrité » du rapport : le format exact (hash de quoi, stockage on-chain ou publication externe) n’est pas détaillé. Utile pour la doc technique et la reproductibilité.

---

## 6. Utilisation des fonds levés (prévente)

- **60 % liquidité, 30 % Vault, 10 % opérations**  
  Les pourcentages sont clairs. Le white paper ne précise pas :
  - **Quand** la liquidité est injectée (progressivement, à la clôture, au TGE).
  - Si les 30 % Vault sont convertis en actifs physiques **avant** ou **après** le listing DEX.

---

## 7. Taxes et flux on-chain

- **Conversion en USDC pour le Vault**  
  « 10 % [buy tax] convertis en USDC pour financer les acquisitions. » Il n’est pas précisé si cette conversion est **automatique** (ex. swap dans le même bloc ou via un routeur dédié) ou **batch** (retrait BNB/TCGV puis conversion périodique par la structure). L’implémentation actuelle dépend du routeur / du flux de trésorerie ; une phrase dans le white paper lèverait l’ambiguïté.

- **Récompenses (1 % sell)**  
  « Alimente le budget giveaways. » À préciser : le flux est-il envoyé vers une **adresse dédiée** (wallet ou contrat) ou vers la même trésorerie que le marketing, avec répartition interne hors chaîne ?

---

## 8. Résumé des actions recommandées

| Sujet | Action suggérée |
|-------|------------------|
| NEXUS : 30 % du montant | Définir officiellement décimales et formule (ex. « 30 % du montant en USDC, en unités NEXUS 18 décimales »). |
| Clôture prévente | Préciser qui peut appeler `finalize` et dans quelles conditions (120h écoulées, cap atteint, ou les deux). |
| Dynamic Burn | Décrire le processus de recalcul et de burn (on-chain vs hors chaîne, moment, acteur). |
| Liquidité prévente | Indiquer le calendrier d’injection (progressif, TGE, etc.). |
| NFT Basique | Préciser le contrat / mécanisme de mint + staking et la règle d’unstake (burn, délai). |
| Conversion Vault (buy tax) | Préciser si la conversion en USDC est automatique on-chain ou traitée en batch. |
| Multisig / Proof of Reserve | Documenter les procédures et formats pour audit et communauté. |

---

*Rapport généré à partir de l’analyse du white paper et de l’implémentation actuelle des contrats. À faire valider par l’équipe juridique et technique avant publication ou mise à jour du white paper.*
