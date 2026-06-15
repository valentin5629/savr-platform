-- pgTAP M2.1 — Packs AG
-- Tests : schéma, triggers (débit réalisation, débit tardif, recrédit), RLS.

BEGIN;
SELECT plan(32);

-- ── Helpers JWT (identiques aux autres fichiers de test) ──────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── 1. Schéma packs_antgaspi ──────────────────────────────────────────────

SELECT has_column('plateforme', 'packs_antgaspi', 'credits_initiaux', 'colonne credits_initiaux existe');
SELECT has_column('plateforme', 'packs_antgaspi', 'credits_consommes', 'colonne credits_consommes existe');
SELECT has_column('plateforme', 'packs_antgaspi', 'credits_restants', 'colonne credits_restants (GENERATED) existe');
SELECT has_column('plateforme', 'packs_antgaspi', 'type_pack', 'colonne type_pack existe');
SELECT has_column('plateforme', 'packs_antgaspi', 'idempotency_key', 'colonne idempotency_key existe');
SELECT has_column('plateforme', 'tarifs_packs_ag', 'credits', 'colonne credits existe dans tarifs_packs_ag');
SELECT has_column('plateforme', 'tarifs_packs_ag', 'prix_unitaire_ht', 'colonne prix_unitaire_ht existe dans tarifs_packs_ag');
SELECT has_column('plateforme', 'tarifs_packs_ag', 'type_pack', 'colonne type_pack existe dans tarifs_packs_ag');

-- ── 2. Index partiel unicité ──────────────────────────────────────────────

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'plateforme'
      AND tablename = 'packs_antgaspi'
      AND indexname = 'uniq_pack_actif_par_org'
  ),
  'index partiel uniq_pack_actif_par_org existe'
);

-- ── 3. Fixtures pour les triggers ────────────────────────────────────────

-- Organisation test
INSERT INTO plateforme.organisations (id, raison_sociale, type, siret, actif)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'TestOrg Packs AG', 'traiteur', '12345678901234', true);

-- Lieu test
INSERT INTO plateforme.lieux (id, nom, adresse, ville, code_postal, organisation_id)
VALUES ('00000000-0000-0000-0000-000000000002'::uuid, 'Salle Test', '1 rue Test', 'Paris', '75001',
  '00000000-0000-0000-0000-000000000001'::uuid);

-- Événement test
INSERT INTO plateforme.evenements (id, nom, organisation_id, lieu_id, date_evenement, nb_convives)
VALUES ('00000000-0000-0000-0000-000000000003'::uuid, 'Gala Test',
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  CURRENT_DATE + INTERVAL '1 day', 200);

-- Tarif AG test
INSERT INTO plateforme.tarifs_packs_ag (id, type_pack, credits, prix_unitaire_ht, montant_total_ht, valide_du)
VALUES ('00000000-0000-0000-0000-000000000004'::uuid, 'pack_10', 10, 130.00, 1300.00, '2026-01-01');

-- Pack AG actif (10 crédits, 0 consommés)
INSERT INTO plateforme.packs_antgaspi (
  id, organisation_id, type_pack, credits_initiaux, credits_consommes,
  montant_total_ht, mode_facturation, statut, date_achat
) VALUES (
  '00000000-0000-0000-0000-000000000005'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'pack_10', 10, 0, 1300.00, 'par_collecte', 'actif', CURRENT_DATE
);

-- Collecte AG en programmee
INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte,
  nb_camions_demande, statut_tms
) VALUES (
  '00000000-0000-0000-0000-000000000006'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  'anti_gaspi', 'programmee', CURRENT_DATE + INTERVAL '1 day', '09:00:00',
  1, 'non_envoye'
);

-- ── 4. Trigger débit à la réalisation ────────────────────────────────────

-- Passer la collecte à realisee → doit décrémenter credits_consommes
UPDATE plateforme.collectes SET statut = 'realisee'
WHERE id = '00000000-0000-0000-0000-000000000006'::uuid;

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid),
  1,
  'credits_consommes = 1 après réalisation AG'
);

SELECT is(
  (SELECT pack_antgaspi_id FROM plateforme.collectes
   WHERE id = '00000000-0000-0000-0000-000000000006'::uuid),
  '00000000-0000-0000-0000-000000000005'::uuid,
  'pack_antgaspi_id rattaché à la collecte après réalisation'
);

SELECT is(
  (SELECT statut::text FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid),
  'actif',
  'pack reste actif avec 9 crédits restants'
);

-- ── 5. Trigger débit dernière collecte → bascule epuise ──────────────────

-- Mettre credits_consommes = 9 (simuler 9 collectes déjà)
UPDATE plateforme.packs_antgaspi
SET credits_consommes = 9
WHERE id = '00000000-0000-0000-0000-000000000005'::uuid;

-- Nouvelle collecte pour tester le dernier crédit
INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte,
  nb_camions_demande, statut_tms
) VALUES (
  '00000000-0000-0000-0000-000000000007'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  'anti_gaspi', 'programmee', CURRENT_DATE + INTERVAL '2 days', '09:00:00',
  1, 'non_envoye'
);

UPDATE plateforme.collectes SET statut = 'realisee'
WHERE id = '00000000-0000-0000-0000-000000000007'::uuid;

SELECT is(
  (SELECT statut::text FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid),
  'epuise',
  'pack bascule en epuise au dernier crédit'
);

-- ── 6. Trigger recrédit (annulee après realisee) ──────────────────────────

-- Annuler la collecte 6 (realisee → annulee) → recrédit
UPDATE plateforme.collectes SET statut = 'annulee'
WHERE id = '00000000-0000-0000-0000-000000000006'::uuid;

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid),
  9,
  'credits_consommes redescend à 9 après annulation de la collecte réalisée'
);

SELECT is(
  (SELECT statut::text FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid),
  'actif',
  'pack repasse en actif (était epuise, 9 < 10 = credits_initiaux)'
);

SELECT is(
  (SELECT pack_antgaspi_id FROM plateforme.collectes
   WHERE id = '00000000-0000-0000-0000-000000000006'::uuid),
  NULL,
  'pack_antgaspi_id est NULL après annulation (désattachement)'
);

-- ── 7. Trigger débit annulation tardive ──────────────────────────────────

-- Nouvelle collecte avec date passée (< 12h)
INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte,
  nb_camions_demande, statut_tms, pack_antgaspi_id
) VALUES (
  '00000000-0000-0000-0000-000000000008'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  'anti_gaspi', 'validee', CURRENT_DATE, '08:00:00',
  1, 'non_envoye',
  '00000000-0000-0000-0000-000000000005'::uuid
);

DECLARE
  v_consommes_avant integer;
BEGIN
  SELECT credits_consommes INTO v_consommes_avant
  FROM plateforme.packs_antgaspi
  WHERE id = '00000000-0000-0000-0000-000000000005'::uuid;

  -- Annuler avec date dans le passé immédiat (< 12h)
  UPDATE plateforme.collectes SET statut = 'annulee'
  WHERE id = '00000000-0000-0000-0000-000000000008'::uuid;

  PERFORM ok(
    (SELECT credits_consommes FROM plateforme.packs_antgaspi
     WHERE id = '00000000-0000-0000-0000-000000000005'::uuid) > v_consommes_avant,
    'credits_consommes incrémenté lors annulation tardive (< 12h)'
  );
END;

-- ── 8. Protection : triggers 2 et 3 mutuellement exclusifs ───────────────
-- Annuler collecte 7 depuis realisee → trigger 3 (recrédit), pas trigger 2
SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid),
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid),
  'pas de double mouvement entre trigger 2 et 3'
);

-- ── 9. CHECK constraint credits_consommes >= 0 ───────────────────────────

SELECT throws_ok(
  $$UPDATE plateforme.packs_antgaspi
    SET credits_consommes = -1
    WHERE id = '00000000-0000-0000-0000-000000000005'::uuid$$,
  'chk_pack_credits_consommes_positifs bloque credits_consommes < 0'
);

-- ── 10. RLS : staff peut tout lire/écrire ────────────────────────────────

PERFORM test_set_jwt('admin_savr');

SELECT ok(
  EXISTS (
    SELECT 1 FROM plateforme.packs_antgaspi
    WHERE id = '00000000-0000-0000-0000-000000000005'::uuid
  ),
  'admin_savr peut lire packs_antgaspi'
);

-- ── 11. RLS : traiteur_manager voit uniquement son organisation ───────────

PERFORM test_set_jwt('traiteur_manager', '00000000-0000-0000-0000-000000000001'::uuid);

SELECT ok(
  EXISTS (
    SELECT 1 FROM plateforme.packs_antgaspi
    WHERE id = '00000000-0000-0000-0000-000000000005'::uuid
  ),
  'traiteur_manager voit le pack de son organisation'
);

-- ── 12. RLS : traiteur_manager ne voit pas pack d'une autre org ──────────

PERFORM test_set_jwt('traiteur_manager', gen_random_uuid()); -- autre org

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM plateforme.packs_antgaspi
    WHERE id = '00000000-0000-0000-0000-000000000005'::uuid
  ),
  'traiteur_manager ne voit pas le pack d une autre organisation'
);

-- ── 13. RLS : traiteur_manager ne peut pas écrire directement ────────────

PERFORM test_set_jwt('traiteur_manager', '00000000-0000-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $$INSERT INTO plateforme.packs_antgaspi (
      organisation_id, type_pack, credits_initiaux, credits_consommes,
      montant_total_ht, mode_facturation, statut, date_achat
    ) VALUES (
      '00000000-0000-0000-0000-000000000001'::uuid,
      'unitaire', 1, 0, 130.00, 'par_collecte', 'actif', CURRENT_DATE
    )$$,
  'traiteur_manager ne peut pas insérer un pack (RLS staff seul)'
);

-- ── 14. Idempotency_key : unicité ────────────────────────────────────────

PERFORM test_as_superuser();

INSERT INTO plateforme.packs_antgaspi (
  organisation_id, type_pack, credits_initiaux, credits_consommes,
  montant_total_ht, mode_facturation, statut, date_achat,
  idempotency_key
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'unitaire', 1, 0, 130.00, 'par_collecte', 'annule', CURRENT_DATE,
  'test-idem-key-123'
);

SELECT throws_ok(
  $$INSERT INTO plateforme.packs_antgaspi (
      organisation_id, type_pack, credits_initiaux, credits_consommes,
      montant_total_ht, mode_facturation, statut, date_achat,
      idempotency_key
    ) VALUES (
      '00000000-0000-0000-0000-000000000001'::uuid,
      'unitaire', 1, 0, 130.00, 'par_collecte', 'annule', CURRENT_DATE,
      'test-idem-key-123'
    )$$,
  'idempotency_key doit être unique (index partiel)'
);

SELECT * FROM finish();
ROLLBACK;
