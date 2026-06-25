-- pgTAP — back-office : INSERT des routes admin tarifs-packs-ag & packs-antgaspi
-- ============================================================================
-- Deux routes back-office étaient cassées au runtime par des colonnes legacy
-- NOT NULL non droppées (jamais testées car pas de test sur ces POST) :
--   - tarifs-packs-ag POST omettait nb_collectes / prix_ht  → 23502
--   - packs-antgaspi POST omettait tarif_pack_id (+ nb_collectes/date_achat) → 23502
-- Fix : la migration 20260625000004 rend tarif_pack_id nullable (un pack
-- `personnalise` n'a aucune ligne tarifs_packs_ag à référencer), et les routes
-- fournissent désormais les colonnes legacy dérivables. Ce test reproduit le
-- shape EXACT des INSERT des routes corrigées.
-- ============================================================================

BEGIN;
SELECT plan(4);

-- Bypass RLS pour tester les contraintes (pas la sécurité).
SET LOCAL role postgres;

-- Organisation test (FK packs_antgaspi.organisation_id)
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('00000000-0000-0000-0000-0000000000aa'::uuid, 'Org Test Routes', 'Org Test Routes', 'traiteur', '99988877766655', true);

-- ── 1. Route tarifs-packs-ag POST (shape corrigé : legacy nb_collectes/prix_ht fournis) ──
SELECT lives_ok($$
  INSERT INTO plateforme.tarifs_packs_ag
    (type_pack, credits, prix_unitaire_ht, montant_total_ht, mensualisable, nb_mensualites, valide_du, nb_collectes, prix_ht)
  VALUES ('pack_30', 30, 460.00, 13800.00, true, 3, CURRENT_DATE, 30, 460.00)
$$, 'tarifs-packs-ag POST : INSERT avec colonnes legacy (nb_collectes/prix_ht) réussit');

-- ── 2. L'ancien shape (sans nb_collectes/prix_ht) reste rejeté → prouve qu'il fallait les fournir ──
SELECT throws_ok($$
  INSERT INTO plateforme.tarifs_packs_ag
    (type_pack, credits, prix_unitaire_ht, montant_total_ht, mensualisable, valide_du)
  VALUES ('pack_60', 60, 390.00, 23400.00, true, CURRENT_DATE)
$$, '23502', NULL,
  'tarifs-packs-ag : omettre nb_collectes/prix_ht viole toujours NOT NULL (legacy non droppées)');

-- ── 3. Route packs-antgaspi POST (pack `personnalise`, shape corrigé : SANS tarif_pack_id) ──
SELECT lives_ok($$
  INSERT INTO plateforme.packs_antgaspi
    (organisation_id, type_pack, credits_initiaux, credits_consommes, statut,
     prix_unitaire_ht, montant_total_ht, mode_facturation, idempotency_key,
     nb_collectes, date_achat)
  VALUES ('00000000-0000-0000-0000-0000000000aa'::uuid, 'personnalise', 25, 0, 'actif',
     520.00, 13000.00, 'globale_achat', 'idem-test-routes-001',
     25, CURRENT_DATE)
$$, 'packs-antgaspi POST : création pack personnalise SANS tarif_pack_id réussit (FK nullable)');

-- ── 4. tarif_pack_id est désormais nullable (migration 20260625000004) ──
SELECT col_is_null('plateforme', 'packs_antgaspi', 'tarif_pack_id',
  'packs_antgaspi.tarif_pack_id est nullable (legacy FK dépréciée)');

SELECT * FROM finish();
ROLLBACK;
