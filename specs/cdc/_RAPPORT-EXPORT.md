# Rapport export dev-facing — 2026-06-15

Mode : AGGRESSIVE (T1 barré + T2 lignes méta pures Statut/MAJ + traçabilité isolée).
Régénération **dest-driven** : chaque fichier de _DEV-FACING ré-écrit depuis sa source
(chemin miroir, sinon basename dans le sous-arbre CDC). Vault source intact.

## Bilan
- Fichiers régénérés : **165**
- Fichiers sans source (conservés tels quels) : 0
- Octets : 6 450 961 -> 6 119 465 (**-331 496  -5.1 %**)
- Tokens estimés (après) : ~1 529 866

## Invariants (bloquants)
- Barré résiduel (~~) dans l'export : **0**  ✅
- Erreurs invariant : 0
- Aucun bloc Addendum daté supprimé (politique zéro risque respectée)

## Sentinelles anti-régression
- 10 - Design System.md : présent ✅
- Adapter MTS-1 (MyTroopers) — relevé as-built Bubble.md : présent ✅
- M14 - Intégration Everest.md : présent ✅
- 08 - APIs et intégrations.md : présent ✅

---

## Régénération partielle 2026-07-06 (run cdc-patch-divergences — revue adversariale concurrence)

9 fichiers régénérés (sources modifiées par le patch du jour), reste de l'export inchangé (sources intactes) :
`02 - CDC TMS/04 - Data Model TMS.md` (+ table `tms.outbox_events`, + `collecte_tournees.statut_execution`, triggers de garde, trigger dérivation FOR UPDATE), `05 - Règles métier TMS.md`, `08 - Contrat API Plateforme-TMS.md` (§2bis émission outbox, S5 (c) étendu, 409 `collecte_sur_tournee_active`), `M03`, `M04`, `M05`, `M04-gestion-tournees-scenarios.md` (52 scénarios), `M05-app-mobile-chauffeur-scenarios.md` (52 scénarios), `01 - CDC App/05 - Espace client gestionnaire de lieux.md` (M3.2 : colonne Type retirée, nav 9 sections).
Invariant 0 barré : vérifié sur les 9. Moteur : réimplémentation fidèle de `strip_devfacing.py` (T1 + multiligne + T2 aggressive lignes méta), fidélité validée par diff sur fichier témoin non modifié (§09 TMS, 30 lignes d'écart, toutes = nettoyages supplémentaires légitimes).

---

## Régénération partielle 2026-07-06 bis (audit coherence-inter-cdc post-patch)

6 fichiers régénérés (sources modifiées par l'audit de cohérence, moteur `strip_devfacing.py` mode aggressive), reste inchangé :
`01 - CDC App/05 - Règles métier.md` (typo S4, refus TMS 409 §4, correction auto V2 §6), `01 - CDC App/08 - APIs et intégrations.md` (S5 `type`, effet correction, 2 codes 409, payload+effet S9), `01 - CDC App/12 - Reporting et exports.md` (régénération auto V2 ×2), `02 - CDC TMS/08 - Contrat API Plateforme-TMS.md` (S9 motif unique + effet Plateforme, code `collecte_non_modifiable`), `02 - CDC TMS/06 - Fonctionnalités détaillées TMS/M04 - Gestion des tournées.md` + copie aplatie `02 - CDC TMS/M04 - Gestion des tournées.md` (statut_tournee `terminee` 1:1).
Invariant 0 barré : vérifié sur les 6. Ajv re-run : 21/21 (schemas non modifiés).
