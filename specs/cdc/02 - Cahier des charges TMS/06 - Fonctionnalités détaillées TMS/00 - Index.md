# 06 - Fonctionnalités détaillées TMS

**Objectif** : spécifier, module par module, les écrans, parcours, workflows, edge cases et règles d'affichage du Savr TMS. Ce dossier descend d'un cran sous [[../03 - Périmètre fonctionnel TMS]] (qui reste la vue d'ensemble macro).


**Mise à jour 2026-04-25 — Revue de sobriété M11 Bloc 2 appliqué (A2 E5 + A3 E3 + A4+A12 E6)** : retrait E5 (Suivi comportemental chauffeurs — analytique 30/60/90j + drill-down + CSV), retrait E3 (Vue historique par code — graphique évolution + KPI temps moyen), retrait E6 (Préférences utilisateur — toggle canaux, tri/filtres, sonore). Réactivation V1.1+ si besoin avéré. Données brutes restent dans `tms.alertes`, exploitation via export Supabase Studio à la demande. Index DB `idx_alertes_code_date` conservé (utilisé par E1 KPI agrégés). 6 fichiers TMS modifiés : M11, §03, §05, M09, M10, sub-index §06. Solde M11 : 6 écrans → 3 (E1 dashboard, E2 drawer simplifié, E4 catalogue).

**Mise à jour antérieure 2026-04-25 — Revue de sobriété M11 Bloc 1 appliqué (A6 Slack + A8 Flood)** : retrait Slack infra dormante V1 (paramètres `m11_slack_active/_webhook_url/_criticite_min`, route entrante boutons, format Block Kit, secret Vault `slack_webhook_alerting`, enum service `secrets_metadata.service`) + retrait flood protection (R_M11.9, cron `m11_flood_watcher`, alerte méta `m11_flood_suspect`, paramètre `m11.flood_seuil_occurrences`, valeur enum log `flood_detecte`). 11 fichiers Vault TMS modifiés : M11, §04, §05, §07, §15, §03, §09, M13, M14, M01, sub-index §06. Cross-CDC : aucun impact Plateforme. Solde M11 : 12 paramètres → 8, 5 crons → 4, 6 codes seed M11 méta → 5, enum `secrets_metadata.service` 7 → 6 valeurs.

**Mise à jour antérieure 2026-04-25 — M13 Administration TMS V1 rédigée** — 9 écrans E1-E9 + 4 sous-écrans, 12 workflows W1-W12, 18 edge cases EC1-EC18, 20 règles R_M13.1-R_M13.20, 15 décisions D1-D15, 17 paramètres `m13_*`, 10 codes alertes M11 catalogue. **Décisions structurantes** : D1 hub navigation + écrans propres transverses, D2 override criticité codes alertes runtime, D3 CRUD users + impersonation V1 avec audit double acteur, D4 secrets API Supabase Vault + Edge Function (deprecation `m11_slack_webhook_url` migré), D5 audit_logs strictement immutable, D6 cache 60s params côté Edge, D7 soft delete user V1, D8 wizard onboarding 4 étapes E7, D9 replay manuel events `echec_final` admin only, D10 session 30j glissantes admin + ops + zéro re-MFA actions sensibles (risque assumé), D11 MFA TOTP admin 1ère fois device, D12 flag `requires_redeploy`, D13 bandeau impersonation persistant, D14 cap 3 devices trusted/user, D15 audit double acteur impersonation. **Propagations 2026-04-25 (M13)** : §04 TMS (4 tables nouvelles `users_tms_devices_trusted`/`alertes_codes_overrides`/`secrets_metadata`/`impersonation_sessions` + colonnes `requires_redeploy`/`deprecated` sur `parametres_tms` + colonnes `desactivee_at/par/raison`/`mfa_active` sur `users_tms`), §05 (R_M13.1-R_M13.20), §03 (M13 statut "À démarrer" → "V1 rédigée"), §07 (12 Edge Functions M13), §09 (RLS 4 tables + politique session 30j + helper `auth.is_impersonating()`), §15 (Vault secrets + impersonation tracing), M11 (catalogue +10 codes `m13_*`). **Bug index corrigé** : statut M03 "À démarrer" → "V1 rédigée 2026-04-24". Historique précédent (M10 v2 2026-04-25 + M11 + M07 + M08 + M12 + autres) conservé dans audit-log.

---

## Ordre de traitement

| # | Module | Persona principal | Statut | Priorité |
|---|--------|-------------------|--------|----------|
| 1 | [[M02 - Dispatch Ops Savr]] | Ops Savr | **V1 rédigée** (pilote — template validé) | Fondation |
| 2 | [[M01 - Réception ordres de collecte]] | Système + Admin TMS (supervision) | **V1 rédigée** — 10 décisions, 4 flags `collectes_tms`, DLQ + polling rattrapage | Fondation |
| 3 | [[M04 - Gestion des tournées]] | Ops Savr + Manager prestataire | **V1 rédigée** | Fondation |
| 4 | [[M06 - Référentiel prestataires]] | Admin TMS + Ops Savr | **V1 rédigée** — 9 écrans, 7 workflows, 14 edge cases, 13 décisions (split M03/M06/M13, seed manuel, V1 sans alertes échéance docs) | Fondation |
| 5 | [[M12 - Attribution transporteur]] | Système + Ops Savr + Admin TMS | **V1 rédigée** (2026-04-24) — 5 triggers, 7 branches R1, 16 décisions, dashboard M13, cache Everest 7j | Cœur métier |
| 6 | [[M05 - App mobile chauffeur]] | Chauffeur + Équipier | **V1 rédigée** (2026-04-24 + revue sobriété 2026-04-30 A1 — W13 supprimé + W3 étape 8-bis supprimée — plus aucune intégration M10) | Fondation |
| 7 | [[M03 - Portail prestataire self-service]] | Manager prestataire | **V1 rédigée** (2026-04-24) — 16 sections, 15 décisions, alertes M11 émises, addendum auth password + rate limit | Fondation |
| 8 | [[M07 - Pilotage financier logistique]] | Admin TMS + Ops Savr | **V1 rédigée** (2026-04-24) — 9 écrans, 7 workflows, 15 edge cases, 15 décisions, seuil ajustement 15%, figement post-clôture, grilles versionnées non rétroactives | Cœur métier |
| 9 | [[M08 - Facturation prestataires]] | Ops Savr + Manager prestataire | **V1 rédigée** (2026-04-24) — 9 écrans, 12 workflows, 14 notifications, 20 edge cases, 12 décisions | Cœur métier |
| 10 | [[M13 - Administration TMS]] | Admin TMS | **V1 rédigée** (2026-04-25) — 9 écrans E1-E9 (dashboard, params, users, audit, secrets Vault, monitoring intégrations, wizard onboarding, codes alertes overrides, impersonation), 12 workflows, 18 edge cases, 20 règles R_M13, 15 décisions D1-D15, 17 paramètres `m13_*`, 10 codes alertes catalogue | Fondation |
| 11 | [[M11 - Alerting transverse]] | Ops Savr | **V1 rédigée** (2026-04-24) — 13 décisions, **3 écrans V1** (E1 dashboard, E2 drawer, E4 catalogue), 10 workflows, catalogue 40+ codes seed, fonction unique `tms.alerte_emit`. **Revue sobriété 2026-04-25 Blocs 1 + 2 appliqués** : A6 Slack dégagé V1, A8 flood protection dégagée V1, A2 E5 comportemental dégagée V1, A3 E3 historique par code dégagée V1, A4+A12 E6 préférences user + sonore dégagées V1 | Cœur métier |
| 12 | [[M09 - Stock matériel Savr]] | Ops Savr + Admin TMS | **V1 rédigée** (2026-04-25) — 5 écrans E1-E5 (dashboard stocks, détail traiteur, modal recompte, référentiel types_contenants M13, paramétrage paliers M13), 4 workflows W1-W4 (update à clôture collecte ZD, recompte Ops, paliers prep tournée M04, update tare), 12 edge cases, 10 décisions D1-D10 (D1 frontière documentaire option e avec M10), R4.1-R4.4 + R_M09.5-R_M09.8 nouvelles, 7 codes alertes M09 (`m09_stock_bas` corrigé V1, +6 nouveaux). Inventaire trimestriel reporté V1.1 | Cœur métier |
| 13 | [[M10 - Gestion exutoires Veolia]] | Ops Savr | **V2 sobre 2026-04-30** (revue de sobriété) — 15 décisions D1-D15 reformulées v3, 8 écrans E1-E8 (E5b supprimé), 10 workflows W1-W10 (W11/W12 supprimés), 13 edge cases (EC11 supprimé), R5.1-R5.8 (R5.4 v3 reset à déclaration + R5.4 bis/R5.9/R5.10 supprimées), 5 paramètres `m10_*` (3 délais escalade supprimés), 7 codes alertes (5 supprimés : `m10_bac_remplissage_85` fusion B3, `m10_passage_realise_non_confirme_*` corollaire A2/A4, `m10_passage_auto_confirmee_j7` corollaire A3, `m10_chauffeur_signale_bacs_pleins` corollaire A1). Déclaration `realise` Ops vaut désormais confirmation effective + reset total stock immédiat | Cœur métier |
| 14 | [[M14 - Intégration Everest]] | Système + Ops Savr (supervision) + Admin TMS (replay + monitoring) | **V1 rédigée** (2026-04-25) — 10 décisions D1-D10, 5 écrans (E1-E4 page `/everest` + E5 sous-écran M13 E6), 8 workflows W1-W8, 12 edge cases EC1-EC12, 8 règles R_M14.1-R_M14.8, 13 codes alertes catalogue M11, 6 paramètres `m14_*`, 1 trigger DB cascade annulation, 1 fonction SQL helper. Filet sécurité webhook = token header par défaut V1 (HMAC à confirmer dev Everest Q2). 2 QO critiques pré-go-live (Q1 endpoint course incomplète, Q2 HMAC) | Cœur métier |
| 15 | [[M15 - Optimisation tournées (routing)]] | (V2) | Hors scope V1 | V2 |
| 16 | [[M16 - BSD Trackdéchets]] | (V2) | Hors scope V1 | V2 |

---

## Template uniforme par module

Chaque fichier module suit la même trame :

1. **Objectif métier** — à quoi sert ce module, pour qui, à quelle fréquence
2. **Personas et contexte d'usage** — qui utilise, dans quelles conditions (bureau, terrain, mobile, 4G)
3. **Architecture des écrans** — liste des écrans et navigation
4. **Écran par écran** — layout, champs, actions, états, données affichées, RLS appliquée
5. **Workflows détaillés** — step-by-step avec decision points, flux alternatifs, erreurs
6. **Règles métier appliquées** — renvois explicites vers §05 R1-R6 et §03 M12
7. **Edge cases** — que se passe-t-il si réseau coupé, prestataire refuse, lieu introuvable, etc.
8. **États et transitions** — diagramme statuts + transitions autorisées par rôle
9. **Notifications** — emails, SMS, push mobile, in-app (acteur, condition, template)
10. **Performance cibles** — temps de chargement, pagination, cache
11. **Décisions structurantes prises** — avec alternatives écartées et pourquoi
12. **Questions ouvertes**
13. **Liens** — §04 Data Model, §05 Règles, §08 API, §09 Auth, CDC Plateforme

---

## Règles de cohérence

- Tout écran qui écrit des données → préciser quelles tables §04 sont mutées et quelle policy RLS §09 s'applique.
- Tout workflow qui implique la Plateforme → expliciter l'endpoint §08 appelé et le payload.
- Toute règle métier mentionnée → renvoi textuel "cf. §05 R1.2" (pas de duplication de règle).
- Tout cas terrain (coupure réseau, offline, device cassé) → traité dans "Edge cases".

---

## Liens

- [[../03 - Périmètre fonctionnel TMS]] — vue macro des 14 modules V1 + 2 V2
- [[../04 - Data Model TMS]] — schéma DB
- [[../05 - Règles métier TMS]] — R1 à R6
- [[../08 - Contrat API Plateforme-TMS]] — endpoints
- [[../09 - Authentification et permissions TMS]] — RLS, rôles
