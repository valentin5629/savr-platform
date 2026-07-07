# 02 - Verticales d'exécution V1

> **Statut** : Validé Val 2026-06-08 (découpage tel quel)
> **Périmètre** : V1 Plateforme = MTS-1 (polling) + Everest. TMS natif = V2, hors roadmap.
> Source de vérité specs : `_DEV-FACING/`. Tests Gherkin : `01 - …/tests/`.
> Arbitrages de cadrage : 6 rôles livrés **avant** go-live (pas de décalage des profils secondaires) ; chiffrage coût Sonnet **et** Opus ; briefs détaillés N0 + V1, V2-V5 en squelette généré juste-à-temps.

---

## Principe

Une **verticale** = un cas d'usage client de bout en bout, démontrable. On code une verticale entière (toutes ses dépendances posées) avant de passer à la suivante. Le **Niveau 0** (foundations, fichier `00`) est fait une fois, en premier. Les **transverses émergents** (fichier `01`) sont posés au 1er usage dans `packages/shared`, pas avant.

Ordre d'exécution : **Niveau 0 → V1 → V2 → V3 → V4 → V5**. Audit dev senior (frère) recommandé à la fin du Niveau 0.

---

## Vue d'ensemble

| Verticale | Nom court | Démo de fin | Dépend de | Budget (≈) |
|---|---|---|---|---|
| **N0** | Foundations | 2 fronts vides mais sécurisés, CI verte | — | ~5,7M |
| **V1** | Cycle traiteur ZD complet | Collecte ZD programmée → MTS-1 → pesée → bordereau/rapport → brouillon Pennylane | N0 | ~6,5M |
| **V2** | Cycle traiteur AG | Programmation AG sur pack → algo top 3 → attestation 2041-GE → facture AG | N0, V1 | ~4,0M |
| **V3** | Espaces clients & dashboards par rôle | Login multi-rôles, chacun voit son périmètre (RLS) | N0, V1, V2 | ~3,3M |
| **V4** | Reporting, exports & registre ZD | Export registre R541-43 + CSV + reporting CO₂ | N0, V1, V2 | ~1,4M |
| **V5** | Migration Bubble + go-live | Migration échantillon réconciliée, double-run, bascule DNS | V1→V4 | ~1,8M |

> Budgets = chiffrage canonique `05 - Estimation tokens` (révisé 2026-06-11 : +0.11 mocks, M1.5 → 1,9M). Total V1 (N0→V5 + tests + buffer 30%) ≈ **32M tokens** (~142 € Sonnet / ~710 € Opus sans caching ; nettement moins avec caching).

---

## Verticale 1 — Cycle traiteur ZD complet

**Critère d'acceptation business** : un traiteur commercial programme une collecte ZD depuis l'UI ; l'ordre part vers MTS-1 (via outbox) ; le statut et les pesées remontent par polling ; le bordereau de pesée et le rapport de recyclage sont générés au batch J+1 ; un brouillon de facture ZD apparaît dans Pennylane après validation Admin.

**Périmètre fonctionnel CDC** :
- Plateforme : §06/06 (back-office Admin référentiel + collectes), §06/01 (formulaire ZD), §06/08 (facture), §06/02 (emails confirmation)
- Règles métier : §05 — machine à états `programmee → validee → en_cours → realisee → cloturee`, tarifs ZD versionnés, alerte pesée hors seuil ZD (in-app), outbox E1/E2/E3/E5
- Architecture : §07 + Frontière TMS-Ready (abstraction `logistique_provider`, adapter MTS-1 polling, garde-fous 2/3/4/5)
- API/intégrations : §08 (adapter MTS-1 polling `GET /v3/customerOrders`, `GET /v3/tours/{id}`, photos ; Pennylane v2 polling J+1)

**Hors périmètre verticale** : AG (packs, algo, attestation) → V2. Espaces clients secondaires + dashboards riches → V3. Exports/registre → V4. Course Everest → V2 (gated). Webhook entrant HMAC §08 S1-S11 → V2.

**Démo possible à la fin** : depuis un compte `traiteur_commercial`, créer une collecte ZD valide (lieu + pax + date) → vérifier `outbox_events` peuplée (E1) → l'adapter MTS-1 (mock en dev) renvoie statut + pesée → `statut_tms` synchronisé, alerte si pesée hors seuil → batch J+1 génère bordereau + rapport (embargo H+24) → Admin valide → brouillon Pennylane créé.

**Modules** (briefs détaillés dans `03 - Modules par verticale/V1/`) :
- M1.1 — Back-office Admin : référentiel & gestion collectes (3 sous-lots a/b/c)
- M1.2 — Formulaire programmation collecte ZD (3 étapes)
- M1.3 — Tarification ZD (fonction versionnée base + remises)
- M1.4 — Machine à états collecte + Outbox events (E1/E2/E3/E5, émission seule)
- M1.5 — Adapter MTS-1 polling derrière `logistique_provider` (3 sous-lots a/b/c — lease/claim, multi-camions)
- M1.6 — Génération PDF ZD (bordereau + rapport recyclage, skip pesées incomplètes)
- M1.7 — Pennylane brouillons ZD (collecte + mensuel groupé)
- M1.8 — E2E cycle ZD complet (gate binaire de sortie de verticale, budget imputé ligne E2E)

**Ordre d'exécution (⚠ ≠ numérotation, M1.3 avant M1.2)** : M1.1 → M1.3 → M1.2 → M1.4 → M1.5 → M1.6 → M1.7 → M1.8.

**Dépend de** : Niveau 0 (toujours), y compris 0.11 (mocks MTS-1/Pennylane/Resend).

---

## Verticale 2 — Cycle traiteur AG

**Critère d'acceptation business** : un traiteur programme une collecte AG rattachée à un pack actif ; l'algo recommande le top 3 associations/transporteurs ; l'Admin valide (ou auto-accept) ; à la réalisation, l'attestation de don (Cerfa 2041-GE, avec/sans mention fiscale) est générée au batch J+1 ; une facture AG est produite.

**Périmètre fonctionnel CDC** :
- Plateforme : §06/01 (volet AG du formulaire), §06/06 (packs AG, paramètres algo), §06/09 (flux algo attribution AG), §06/08 (facture AG)
- Règles métier : §05 — pack FIFO strict sur `created_at`, débit crédit si annulation < 12h (`trg_pack_debit_annulation_tardive`), `realisee_sans_collecte` (AG only), attestation conditionnée `association.habilitee_fiscale`
- API : §08 — course Everest (A Toutes!, vélo cargo) **🔒 derrière le GATE Everest (CLAUDE.md §7)**

**Hors périmètre verticale** : ZD (fait en V1). Multi-vélo AG gros volume = manuel V1 (0 data model). Split auto = V2 produit.

**Démo possible à la fin** : compte traiteur → programmer AG avec pack actif (vérif crédit) → algo affiche top 3 asso/transporteurs → Admin valide → à `realisee`, attestation générée (mention 2041-GE si asso habilitée) → facture AG. Cas `realisee_sans_collecte` : badge + motif + photo + alerte Ops, facture tarif normal, pas d'attestation.

**Modules** (squelette ; briefs générés juste-à-temps avant exécution V2) :
- M2.1 — Packs AG (CRUD Admin, crédits, FIFO, trigger débit annulation tardive)
- M2.2 — Formulaire AG + vérif pack (volet AG du formulaire unifié)
- M2.3 — Algo attribution AG (recommandation top 3, auto-accept par combinaison)
- M2.4 — Attestation don AG (Cerfa 2041-GE, batch J+1, mention fiscale conditionnelle)
- M2.5 — Course Everest derrière `logistique_provider` (🔒 GATE Everest)
- M2.6 — Facturation AG (par collecte + achat pack)

**Dépend de** : Niveau 0, V1 (machine à états, outbox, PDF, Pennylane, back-office).

---

## Verticale 3 — Espaces clients & dashboards par rôle

**Critère d'acceptation business** : chacun des 6 rôles se connecte et ne voit que son périmètre (RLS), avec son dashboard et l'accès à ses documents. Les 6 rôles sont livrés avant go-live (arbitrage Val 2026-06-08).

**Périmètre fonctionnel CDC** :
- Plateforme : §06/04 (espace traiteur), §06/05 (gestionnaire de lieux), §06/11 (agence), §11 (dashboards par rôle), client organisateur (RSE)
- Règles métier : §05 — tarifs préférentiels gestionnaire, accès PDF + régénération manuelle (picto ⟳)
- Auth : §09 — RLS par rôle, cloisonnement org/lieux

**Hors périmètre verticale** : exports CSV + registre → V4. Lien partage public rapport → V1.1.

**Démo possible à la fin** : login successif `traiteur_manager`, `traiteur_commercial`, `gestionnaire_lieux`, `agence`, `client_organisateur` → chacun voit uniquement ses données (test RLS), son dashboard, ses PDFs (avec régén manuelle). Tarif préférentiel gestionnaire appliqué automatiquement.

**Modules** (squelette) :
- M3.1 — Espace traiteur (dashboards manager + commercial, accès PDF + régén)
- M3.2 — Espace gestionnaire de lieux (multi-lieux, tarifs préférentiels)
- M3.3 — Espace agence
- M3.4 — Espace client organisateur (RSE, impact, rapports)
- M3.5 — Dashboards par rôle (§11) — couche commune

**Dépend de** : Niveau 0, V1, V2 (données ZD + AG à afficher).

---

## Verticale 4 — Reporting, exports & registre réglementaire ZD

**Critère d'acceptation business** : exports CSV disponibles pour tous les profils ; registre réglementaire ZD-only (collectes `cloturee` seules) exportable (CSV/ZIP) ; reporting CO₂ ADEME (ZD induit/évité/net + AG évité) avec snapshot figé.

**Périmètre fonctionnel CDC** :
- Plateforme : §12 (reporting et exports), §06/03 (registre réglementaire UX)
- Règles métier : §05 — registre = `cloturee` + ZD only, CO₂ ADEME (2,5 kgCO₂e/repas AG), snapshot figé
- Transverse émergent : D (exports CSV/Excel) — 1er usage réel ici

**Hors périmètre verticale** : export PDF registre formaté → V1.1. Reporting REP/Citeo → V1.1/V2. Benchmark client (UI) → V2.

**Démo possible à la fin** : Admin et clients exportent leurs collectes/événements/pesées/factures en CSV ; export registre ZD (CSV + ZIP bordereaux) conforme R541-43 ; tableau CO₂ avec valeurs figées au snapshot.

**Modules** (squelette) :
- M4.1 — Exports CSV (transverse D, tous profils)
- M4.2 — Registre réglementaire ZD (UX + export CSV/ZIP)
- M4.3 — Reporting CO₂ ADEME (snapshot figé)

**Dépend de** : Niveau 0, V1, V2.

---

## Verticale 5 — Migration Bubble + go-live

**Critère d'acceptation business** : l'historique Bubble (~1 500 collectes AG + ~175 ZD + lieux + orgas + users) est migré et réconcilié ; période de test parallèle sans régression ; bascule DNS `app.gosavr.io` réalisée.

**Périmètre fonctionnel CDC** :
- Migration : `04 - Migration/` (inventaire, mappings, ordre, transformations, checks réconciliation SQL, rollback), §13
- Cutover : à raffiner via skill `cdc-cutover-plan` (post-roadmap)

**Hors périmètre verticale** : migration MTS-1 native → V2 (cutover TMS). `code_transporteur_mts1` neutralisé au cutover V2 (garde-fou 5).

**Démo possible à la fin** : exécution scripts de migration sur échantillon → checks de réconciliation SQL verts → double-run Bubble + Plateforme 2-4 semaines → email pré-bascule J-15 → bascule DNS → go-live.

**Modules** (squelette) :
- M5.1 — Scripts extraction Bubble + mapping
- M5.2 — Transformation + import Supabase
- M5.3 — Checks réconciliation SQL + rollback
- M5.4 — Double-run + bascule DNS + go-live

**Dépend de** : V1→V4 (le modèle doit être complet pour importer l'historique). **Pré-requis go-live** : gate Everest tranché, ✅ DNS `gosavr.io` identifié (OVH, levé 2026-06-11), validation juriste RSE/RGPD (CLAUDE.md §7).

---

## Gates et dépendances critiques (rappel)

- 🔒 **GATE Everest** : bloque M2.5 (course Everest). Réponse dev Everest attendue (mail Val 2026-06-07).
- ✅ **DNS `gosavr.io`** : **LEVÉE 2026-06-11** — registrar = OVH, contacts transférés (demande 4468362). CNAME à configurer Phase 1 infra.
- 🔒 **Licence MTS-1** : la date d'échéance conditionne la date de cutover (go-live ≥ échéance − 1 mois double-run).
- 🔒 **Juridique RSE/RGPD** : validation juriste avant go-live (V5).
