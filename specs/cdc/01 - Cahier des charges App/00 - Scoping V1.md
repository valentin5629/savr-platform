# Scoping V1 — Plateforme seule (MTS-1 + Everest)

**Date de fork** : 2026-06-05
**Source archive** : `01 - Cahier des charges App _ ARCHIVE V1+V2 2026-06-05/`
**Périmètre V1** : Plateforme Savr branchée sur **MTS-1 (API V3, dispatch Strike/Marathon)** + **Everest (A Toutes!, vélo cargo)** comme couches logistiques. Le **Savr TMS natif** (CDC `02 - Cahier des charges TMS/`) est intégralement reporté en **V2** (cutover TMS).

> Ce document compile les décisions de périmètre déjà prises dans le CDC (Index, §16 Roadmap, §03 Périmètre, §01 Vision). Il n'invente rien : il fige la frontière V1 et liste ce qui est développé / coupé / adapté.

---

## Modules KEEP V1 (à développer)

Tous les modules documentés §01→§15, soit :

- [ ] **6 rôles** : `admin_savr`, `traiteur_manager`, `traiteur_commercial`, `agence`, `gestionnaire_lieux`, `client_organisateur` (§09)
- [ ] **Auth + onboarding** : email/password Supabase, inscription self-service (SIRET INSEE + TVA VIES), rattachement orga par domaine email (§09)
- [ ] **Back-office Admin Savr** : CRUD orgas / users / lieux / événements / collectes, dashboard Admin, packs AG, brouillons factures, paramètres algo (§06.06)
- [ ] **Formulaire programmation collecte** : 3 étapes, ZD + AG event-centré, tarif ZD base+remises, vérif pack AG (§06.01)
- [ ] **Machine à états collecte unifiée** ZD+AG : `programmee → validee → en_cours → realisee → cloturee` (§05)
- [ ] **Intégration logistique V1** (voir MODIFY ci-dessous) : MTS-1 API V3 + Everest derrière l'abstraction `logistique_provider`
- [ ] **Génération PDF** : bordereau pesée ZD, rapport recyclage ZD, attestation don AG, batch J+1 6h, embargo H+24 (§06, §12)
- [ ] **Pennylane v2** : brouillons factures ZD (par collecte + mensuel groupé) + AG, **polling J+1** (webhook → V1.1) (§08)
- [ ] **Dashboards par rôle** : manager, commercial, gestionnaire lieux, agence, client organisateur (§11)
- [ ] **Reporting + exports CSV** tous profils (§12)
- [ ] **Registre réglementaire ZD-only** (Module 20 MVP), bordereaux + attestations batch J+1 (§06.03)
- [ ] **CO₂ ADEME modélisé** : ZD (induit/évité/net) + AG (évité seul, 2,5 kgCO₂e/repas FAO), snapshot figé (§04/§11/§12)
- [ ] **Migration Bubble** : ~1 500 collectes AG + ~175 ZD + lieux + orgas + users (§13)
- [ ] **Resend** : emails transactionnels (16 templates en seed DB)

---

## Modules EXCLUDE V2 / V1.1 (coupés du CDC V1)

> Périmètre logistique TMS natif : **entièrement dans `02 - Cahier des charges TMS/`** (app chauffeur M05, dispatch M02/M12, portail prestataire M03, tournées, pesées…). Non listé ici module par module : tout le CDC TMS = V2.

| Fonctionnalité (App) | Section archive | Cible | Raison report |
|---|---|---|---|
| Module 12 — interface client benchmarks | §03 M12 | V2 | Data model créé V1, UI exposée V2 (seuil ~30 collectes/segment) |
| Module 13 — reporting REP/Citeo | §03 M13, §15 | V1.1/V2 | Export SQL sur données déjà collectées |
| Module 14 — app mobile native | §03 M14, §01 | V2 | App responsive suffit ; TMS a son app chauffeur en V1 |
| Module 15 — multi-langues | §03 M15 | V2 | Champs traduisibles anticipés data model |
| Module 16 — signature électronique | §03 M16 | V2 | — |
| Module 19 — import brief + impact enrichi | §03 M19, §04 N6 | V2 | 6 tables + 3 champs **non créés V1** (migration triviale V2) ; gating = recrutement chargé projet env. |
| 2FA | §09, §15 | V1.1 | Supabase Auth natif, 1 ligne de config |
| SSO SAML | §09, §15 | V2 | Archi JWT anticipée V1, activable sans migration |
| Trackdéchets (BSD officiels) | §01, §15 | V2 | Registre interne V1, renvoi Veolia en audit |
| Lien partage public rapport (90j) | §12, §15 | V1.1 | V1 : manager télécharge + transmet le PDF |
| QR code vérification PDF | §15 | V1.1 | Page publique de validation |
| Export PDF registre formaté | §06.03 | V1.1 | CSV + ZIP bordereaux couvrent R541-43 |
| UI édition templates emails + `version` | §06.02 | V1.1 | Templates en seed DB V1 |
| Coûts Veolia (auto-import Gmail) | §03 | V2 | Saisie manuelle exclue V1, factures mensuelles trop lourdes |
| Module scoring prestataires | §16 | V2 | Données collectées dès V1 |
| Déploiement multi-régions | §16 | V2 | Data model déjà agnostique |
| Notifications in-app / SMS | Index, §16 | V1.1 | V1 = email uniquement |
| Politique d'archivage > 3 ans | §14 | V2 | Aucune urgence V1 (DB < 4 GB) |

---

## Modules MODIFY V1 (adaptés à MTS-1 + Everest)

| Module | Modification V1 vs CDC complet | Détail |
|---|---|---|
| **Intégration logistique (§16 Phase 5/10, §08)** | Le « TMS Savr » cible du contrat §08 n'existe pas en V1. La Plateforme parle à **MTS-1 (= MyTroopers, API V3)** pour Strike/Marathon + **Everest** (A Toutes!), **derrière l'abstraction `logistique_provider`**. ⚠ **En V1 l'adapter MTS-1 fonctionne en POLLING** (cron qui interroge `GET /v3/customerOrders`, `GET /v3/tours/{id}`, télécharge les photos) — il **n'implémente PAS** le contrat webhook S1-S11 du §08, qui est la **cible V2** (TMS Savr natif, event-driven). L'adapter écrit dans les **mêmes tables Plateforme** que le TMS V2 alimentera. | cf. `Adapter MTS-1 (MyTroopers) — relevé as-built Bubble` ; `Frontière TMS-Ready V1.md` garde-fous 2 & 3 ; §08 §3bis (corrigé) |
| **Pilotage `statut_tms` (Index, §05)** | En V1, la **Plateforme** pilote `statut_tms` (dérivé des webhooks MTS-1 V3 traduits par l'adapter). En V2, le TMS Savr pilotera via les webhooks du contrat natif. | trigger `fn_sync_statut_collecte_from_tms` conservé |
| **Multi-camions ZD (Sujet 1, §04)** | Concept interne TMS → en V1 MTS-1 gère le dispatch terrain. Substrat data `collecte_tournees` N↔N **conservé** (schéma figé), mais alimenté via l'adapter MTS-1 (1 ordre = 1 course en nominal). | non-destructif V2 |
| **Multi-vélo AG gros volume (§06.09)** | V1 = **manuel** : Savr crée 1 course Everest, A Toutes! duplique la flotte côté Everest. V2 = split auto côté TMS. | 0 data model V1 |
| **Code transporteur MTS-1 (Index, §08)** | Champ `transporteurs.code_transporteur_mts1` + règle `R_code_mts1_requis` actifs V1 uniquement (pont vers MTS-1). Neutralisés au cutover V2. | external ref logistique neutre (garde-fou 5) |

---

## Checklist de cohérence V1

- [x] Aucun schéma data V1 divergent de l'archive (omissions seulement) — cf. garde-fou 1
- [x] Adapter MTS-1 V1 = polling MyTroopers → écrit dans les tables cibles (le contrat webhook §08 S1-S11 est la cible V2, pas un livrable V1) — cf. garde-fou 2
- [x] Abstraction `logistique_provider` obligatoire — cf. garde-fou 3
- [x] Events sortants persistés en `outbox_events` dès V1 — cf. garde-fou 4
- [x] Migration V1 non destructive pour V2 — cf. garde-fou 5
