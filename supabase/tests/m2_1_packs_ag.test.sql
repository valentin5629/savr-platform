-- pgTAP M2.1 — Packs AG
-- Tests : schéma, triggers (débit réalisation, débit tardif, recrédit), RLS.

BEGIN;
SELECT plan(26);

-- ── Helpers JWT (identiques aux autres fichiers de test) ──────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
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
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'TestOrg Packs AG', 'TestOrg Packs AG', 'traiteur', '12345678901234', true);

-- Type événement test
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('00000000-0000-0000-0000-000000000009'::uuid, 'GALA_TEST', 'Gala Test', 1, true);

-- Lieu test
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('00000000-0000-0000-0000-000000000002'::uuid, 'Salle Test', '1 rue Test', 'Paris', '75001', 'camionnette');

-- User test (pour created_by)
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('00000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000001'::uuid,
  'admin@test-packs.test', 'Admin', 'Test', 'admin_savr');

-- Entité de facturation test
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('00000000-0000-0000-0000-000000000011'::uuid, '00000000-0000-0000-0000-000000000001'::uuid,
  'TestOrg Packs AG SARL', '12345678901234', '1 rue Test', '75001', 'Paris');

-- Événement test
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000010'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000009'::uuid,
  CURRENT_DATE + INTERVAL '1 day', 200, 'Contact Test', '0600000001'
);

-- Tarif AG test
INSERT INTO plateforme.tarifs_packs_ag (id, valide_du, type_pack, credits, prix_unitaire_ht, montant_total_ht)
VALUES ('00000000-0000-0000-0000-000000000004'::uuid, '2026-01-01', 'pack_10', 10, 130.00, 1300.00);

-- Pack AG actif (10 crédits, 0 consommés)
INSERT INTO plateforme.packs_antgaspi (
  id, organisation_id,
  type_pack, credits_initiaux, credits_consommes,
  montant_total_ht, mode_facturation, statut, date_achat
) VALUES (
  '00000000-0000-0000-0000-000000000005'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'pack_10', 10, 0,
  1300.00, 'par_collecte', 'actif', CURRENT_DATE
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

-- Avant annulation : credits_consommes = 9 (après recrédit test 6)
-- Annuler collecte 8 (validee → annulee, date CURRENT_DATE 08h = < 12h) → débit tardif → 10
UPDATE plateforme.collectes SET statut = 'annulee'
WHERE id = '00000000-0000-0000-0000-000000000008'::uuid;

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid),
  10,
  'credits_consommes = 10 après annulation tardive (< 12h, validee→annulee)'
);

-- ── 8. Protection : triggers 2 et 3 mutuellement exclusifs ───────────────
-- Avant : credits_consommes = 10 (après débit tardif test 7)
-- Annuler collecte 7 (realisee → annulee) : trigger 3 seul se déclenche → recrédit → 9
-- Trigger 2 ne se déclenche PAS car OLD.statut = 'realisee' (condition exclue)
UPDATE plateforme.collectes SET statut = 'annulee'
WHERE id = '00000000-0000-0000-0000-000000000007'::uuid;

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid),
  9,
  'exclusion mutuelle trigger 2/3 : credits_consommes=9 (trigger 3 seul, pas de double mouvement)'
);

-- ── 8bis. Seuil 12h ancré Europe/Paris (fix E2) ──────────────────────────
-- Bornes déterministes quel que soit le fuseau de la session de test : on
-- construit date_collecte/heure_collecte comme l'heure murale de Paris à
-- now()+11h59 (doit débiter, < 12h) puis now()+12h01 (ne doit pas débiter,
-- ≥ 12h). Avant le fix (cast naïf interprété en UTC) le seuil était décalé de
-- 1-2h et ces deux cas tombaient du mauvais côté de la frontière.
SELECT test_as_superuser();

-- Org + pack frais (évite le conflit uniq_pack_actif_par_org avec le pack 005)
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('00000000-0000-0000-0000-000000000031'::uuid, 'Org E2 TZ', 'Org E2 TZ', 'traiteur', '99999999900099', true);

INSERT INTO plateforme.packs_antgaspi (
  id, organisation_id,
  type_pack, credits_initiaux, credits_consommes,
  montant_total_ht, mode_facturation, statut, date_achat
) VALUES (
  '00000000-0000-0000-0000-000000000030'::uuid,
  '00000000-0000-0000-0000-000000000031'::uuid,
  'pack_10', 10, 0,
  1300.00, 'par_collecte', 'actif', CURRENT_DATE
);

-- Collecte A : heure murale Paris = now() + 11h59 → < 12h → DOIT débiter.
-- statut_tms='non_envoye' neutralise la condition « mandat prestataire » → on
-- isole strictement la condition de délai.
INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte,
  nb_camions_demande, statut_tms, pack_antgaspi_id
) VALUES (
  '00000000-0000-0000-0000-000000000040'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  'anti_gaspi', 'validee',
  ((now() AT TIME ZONE 'Europe/Paris') + INTERVAL '11 hours 59 minutes')::date,
  ((now() AT TIME ZONE 'Europe/Paris') + INTERVAL '11 hours 59 minutes')::time,
  1, 'non_envoye',
  '00000000-0000-0000-0000-000000000030'::uuid
);

UPDATE plateforme.collectes SET statut = 'annulee'
WHERE id = '00000000-0000-0000-0000-000000000040'::uuid;

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000030'::uuid),
  1,
  'E2 : annulation à H-11h59 (heure de Paris) < 12h → débit (credits_consommes=1)'
);

-- Collecte B : heure murale Paris = now() + 12h01 → ≥ 12h → NE DOIT PAS débiter.
INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte,
  nb_camions_demande, statut_tms, pack_antgaspi_id
) VALUES (
  '00000000-0000-0000-0000-000000000041'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  'anti_gaspi', 'validee',
  ((now() AT TIME ZONE 'Europe/Paris') + INTERVAL '12 hours 1 minute')::date,
  ((now() AT TIME ZONE 'Europe/Paris') + INTERVAL '12 hours 1 minute')::time,
  1, 'non_envoye',
  '00000000-0000-0000-0000-000000000030'::uuid
);

UPDATE plateforme.collectes SET statut = 'annulee'
WHERE id = '00000000-0000-0000-0000-000000000041'::uuid;

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0000-000000000030'::uuid),
  1,
  'E2 : annulation à H-12h01 (heure de Paris) ≥ 12h → pas de débit (credits_consommes reste 1)'
);

-- ── 9. CHECK constraint credits_consommes >= 0 ───────────────────────────
-- Testé via INSERT (pas UPDATE) pour éviter tout effet de bord de l'état
-- de la ligne pack 005 après les tests de triggers précédents.

SELECT test_as_superuser();

SELECT throws_ok(
  $$INSERT INTO plateforme.packs_antgaspi (
      organisation_id,
      type_pack, credits_initiaux, credits_consommes,
      montant_total_ht, mode_facturation, statut, date_achat
    ) VALUES (
      '00000000-0000-0000-0000-000000000001'::uuid,
      'unitaire', 5, -1,
      130.00, 'par_collecte', 'annule', CURRENT_DATE
    )$$,
  '23514',
  NULL,
  'chk_pack_credits_consommes_positifs bloque credits_consommes < 0'
);

-- ── 10. RLS : staff peut tout lire/écrire ────────────────────────────────

SELECT test_set_jwt('admin_savr');

SELECT ok(
  EXISTS (
    SELECT 1 FROM plateforme.packs_antgaspi
    WHERE id = '00000000-0000-0000-0000-000000000005'::uuid
  ),
  'admin_savr peut lire packs_antgaspi'
);

-- ── 11. RLS : traiteur_manager voit uniquement son organisation ───────────

SELECT test_set_jwt('traiteur_manager', '00000000-0000-0000-0000-000000000001'::uuid);

SELECT ok(
  EXISTS (
    SELECT 1 FROM plateforme.packs_antgaspi
    WHERE id = '00000000-0000-0000-0000-000000000005'::uuid
  ),
  'traiteur_manager voit le pack de son organisation'
);

-- ── 12. RLS : traiteur_manager ne voit pas pack d'une autre org ──────────

SELECT test_set_jwt('traiteur_manager', gen_random_uuid()); -- autre org

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM plateforme.packs_antgaspi
    WHERE id = '00000000-0000-0000-0000-000000000005'::uuid
  ),
  'traiteur_manager ne voit pas le pack d une autre organisation'
);

-- ── 13. RLS : traiteur_manager ne peut pas écrire directement ────────────
-- statut='annule' pour éviter un conflit avec l'index uniq_pack_actif_par_org
-- (pack 005 est actif) — on teste ici UNIQUEMENT la policy RLS INSERT.

SELECT test_set_jwt('traiteur_manager', '00000000-0000-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $$INSERT INTO plateforme.packs_antgaspi (
      organisation_id,
      type_pack, credits_initiaux, credits_consommes,
      montant_total_ht, mode_facturation, statut, date_achat
    ) VALUES (
      '00000000-0000-0000-0000-000000000001'::uuid,
      'unitaire', 1, 0, 130.00, 'par_collecte', 'annule', CURRENT_DATE
    )$$,
  '42501',
  NULL,
  'traiteur_manager ne peut pas insérer un pack (RLS staff seul)'
);

-- ── 14. Idempotency_key : unicité ────────────────────────────────────────

SELECT test_as_superuser();

INSERT INTO plateforme.packs_antgaspi (
  organisation_id,
  type_pack, credits_initiaux, credits_consommes,
  montant_total_ht, mode_facturation, statut, date_achat,
  idempotency_key
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'unitaire', 1, 0, 130.00, 'par_collecte', 'annule', CURRENT_DATE,
  'test-idem-key-123'
);

SELECT throws_ok(
  $$INSERT INTO plateforme.packs_antgaspi (
      organisation_id,
      type_pack, credits_initiaux, credits_consommes,
      montant_total_ht, mode_facturation, statut, date_achat,
      idempotency_key
    ) VALUES (
      '00000000-0000-0000-0000-000000000001'::uuid,
      'unitaire', 1, 0, 130.00, 'par_collecte', 'annule', CURRENT_DATE,
      'test-idem-key-123'
    )$$,
  '23505',
  NULL,
  'idempotency_key doit être unique (index partiel)'
);

SELECT * FROM finish();
ROLLBACK;
