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
