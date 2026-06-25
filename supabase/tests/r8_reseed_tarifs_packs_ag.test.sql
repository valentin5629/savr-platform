-- pgTAP R8 / BL-P1-FACT-04 — Valeurs canoniques du référentiel tarifs_packs_ag
-- ============================================================================
-- Le seed bloc8 + la dérivation type_pack de l'align M2.1b avaient produit des
-- credits ET des prix faux. La migration 20260625000003 re-seed les 4 lignes de
-- référence actives aux valeurs CDC (05 - Règles métier §3 / 04 - Data Model).
-- Ce test assert les valeurs facturables — un placeholder qui ré-apparaît rougit.
-- ============================================================================

BEGIN;
SELECT plan(16);

-- ── credits (nombre de collectes par pack) ──────────────────────────────────
SELECT is(
  (SELECT credits FROM plateforme.tarifs_packs_ag WHERE type_pack='unitaire' AND valide_jusqu_au IS NULL),
  1, 'unitaire : 1 collecte');
SELECT is(
  (SELECT credits FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_10' AND valide_jusqu_au IS NULL),
  10, 'pack_10 : 10 collectes');
SELECT is(
  (SELECT credits FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_30' AND valide_jusqu_au IS NULL),
  30, 'pack_30 : 30 collectes');
SELECT is(
  (SELECT credits FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_60' AND valide_jusqu_au IS NULL),
  60, 'pack_60 : 60 collectes');

-- ── prix_unitaire_ht (PU par collecte) ──────────────────────────────────────
SELECT is(
  (SELECT prix_unitaire_ht FROM plateforme.tarifs_packs_ag WHERE type_pack='unitaire' AND valide_jusqu_au IS NULL),
  590.00::numeric, 'unitaire : PU 590 €');
SELECT is(
  (SELECT prix_unitaire_ht FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_10' AND valide_jusqu_au IS NULL),
  500.00::numeric, 'pack_10 : PU 500 €');
SELECT is(
  (SELECT prix_unitaire_ht FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_30' AND valide_jusqu_au IS NULL),
  460.00::numeric, 'pack_30 : PU 460 €');
SELECT is(
  (SELECT prix_unitaire_ht FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_60' AND valide_jusqu_au IS NULL),
  390.00::numeric, 'pack_60 : PU 390 €');

-- ── montant_total_ht (= credits × prix_unitaire_ht) ─────────────────────────
SELECT is(
  (SELECT montant_total_ht FROM plateforme.tarifs_packs_ag WHERE type_pack='unitaire' AND valide_jusqu_au IS NULL),
  590.00::numeric, 'unitaire : total 590 €');
SELECT is(
  (SELECT montant_total_ht FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_10' AND valide_jusqu_au IS NULL),
  5000.00::numeric, 'pack_10 : total 5 000 €');
SELECT is(
  (SELECT montant_total_ht FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_30' AND valide_jusqu_au IS NULL),
  13800.00::numeric, 'pack_30 : total 13 800 €');
SELECT is(
  (SELECT montant_total_ht FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_60' AND valide_jusqu_au IS NULL),
  23400.00::numeric, 'pack_60 : total 23 400 €');

-- ── mensualisable / nb_mensualites (indication contractuelle) ───────────────
SELECT is(
  (SELECT mensualisable FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_30' AND valide_jusqu_au IS NULL),
  true, 'pack_30 : mensualisable');
SELECT is(
  (SELECT nb_mensualites FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_30' AND valide_jusqu_au IS NULL),
  3, 'pack_30 : 3 mensualités');
SELECT is(
  (SELECT mensualisable FROM plateforme.tarifs_packs_ag WHERE type_pack='unitaire' AND valide_jusqu_au IS NULL),
  false, 'unitaire : non mensualisable');

-- ── legacy V1 (NOT NULL) maintenu cohérent ──────────────────────────────────
SELECT is(
  (SELECT nb_collectes = credits AND prix_ht = prix_unitaire_ht
     FROM plateforme.tarifs_packs_ag WHERE type_pack='pack_30' AND valide_jusqu_au IS NULL),
  true, 'pack_30 : colonnes legacy (nb_collectes/prix_ht) alignées sur credits/prix_unitaire_ht');

SELECT * FROM finish();
ROLLBACK;
