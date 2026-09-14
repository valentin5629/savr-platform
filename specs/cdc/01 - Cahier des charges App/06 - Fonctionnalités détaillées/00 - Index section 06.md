# 06 - Fonctionnalités détaillées — Index


---

## Principe

Section 06 = détails UX et fonctionnels module par module. Complète [[03 - Périmètre fonctionnel global]] (macro) et [[05 - Règles métier]] (logique) avec les specs d'interface.

---

## Sous-pages

| # | Nom | Statut |
|---|-----|--------|
| 01 | [[01 - Formulaire de programmation de collecte]] | Validé V1 (refonte formulaire unique événement-centré 2026-05-21) |
| 02 | [[02 - Templates emails V1]] | Validé V1 |
| 03 | [[03 - Registre réglementaire (UX)]] | Validé V1 |
| 04 | [[04 - Espace client traiteur]] | Validé V1 (notif info-only programmation tiers 2026-05-07) |
| 05 | [[05 - Espace client gestionnaire de lieux]] | Validé V1 (extension transactionnelle 2026-05-07 ; test-scenarios 2026-06-07 — 6 floues tranchées F1-F6 dont 2 bloquantes RLS users/factures, cf. `tests/06.05-espace-gestionnaire-lieux-scenarios.md`) |
| 06 | [[06 - Back-office Admin Savr]] | Validé V1 (fusion ex-07 dans §8 + §9 — 2026-05-08) |
| 07 | — fusionné dans [[06 - Back-office Admin Savr]] §8 onglet Packs AG (UI) + §9 Tarifs Anti-Gaspi (publics) + [[05 - Règles métier#3. Packs Anti-Gaspi — Décrémentation et blocage]] (règles métier) — 2026-05-08 | Supprimé |
| 08 | [[08 - Génération et édition facture (Admin)]] | Validé V1 |
| 09 | [[09 - Flux algo attribution AG (Admin)]] | Validé V1 (clarification décompte programmateur 2026-05-07) |
| 10 | Intégration import brief (Module 19) | À reporter V2 |
| 11 | [[11 - Espace client agence]] | Validé V1 + scénarios de test (lot ⑨ 2026-06-07 — 45 scénarios, floues F1-F6 tranchées Val ; revue sobriété 2026-06-03 — réplique stricte §06.04, parité absolue) |

---

## Chantiers suivants

- Pré go-live facturation électronique (voir [[08 - Génération et édition facture (Admin)]] §Actions critiques pré go-live) — validation écrite Pennylane, test bout en bout, plan de continuité
- Module 20 Traçabilité réglementaire (voir [[20 - Traçabilité réglementaire]])
- Revue transverse cohérence data model ↔ sous-pages UX
- Cadrage V1.1 : achat en ligne pack AG, Citeo export, avoir partiel sur facture mensuelle (relances factures = gérées directement dans Pennylane, pas dans Savr — décision 2026-04-28 / refonte 2026-05-08)

---

## Dépendances croisées clés

| Sous-page | Dépend de | Alimente |
|---|---|---|
| 01 Formulaire de collecte | 04 Data Model (evenements, collectes ; `collecte_partages` reporté V1.1 A4 2026-05-25) | 04 Espace traiteur, 06 Back-office, 09 Algo AG |
| 04 Espace traiteur | 01 Formulaire, 02 Templates emails, 06 Back-office §8 Packs AG, 12 Reporting | 06 Back-office, 08 Facturation |
| 05 Espace gestionnaire lieux | 04 Data Model (organisations_lieux), 12 Reporting §1.6 | 06 Back-office (action Rattachement lieu) |
| 06 Back-office Admin | Toutes les autres sous-pages (vue consolidée) + 05 Règles métier §3 Packs AG | 08 Facturation, 09 Algo AG |
| 08 Facturation | Pennylane API v2, 05 Règles métier §Facturation, 06 Back-office §8 Packs AG | 06 Back-office |
| 09 Algo AG | 05 Règles métier §Algorithme AG + §3 Packs AG, 04 Data Model (attributions_antgaspi) | 06 Back-office §8 Packs AG |
| 11 Espace agence | 04 Espace traiteur (composants réutilisés), 04 Data Model (`organisations.est_shadow`, `evenements.traiteur_operationnel_organisation_id`), 12 Reporting | 06 Back-office, 09 Algo AG (décompte pack programmateur) |
