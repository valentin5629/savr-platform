-- M2.4 — Tests pgTAP RLS attestations_don
-- Source : §09 matrice attestations_don + spec 11-12 scénarios attestations_don_org_scoped
-- Couche : db
-- Priorité : P1-critique

BEGIN;

SELECT plan(9);

-- ─── Fixtures ──────────────────────────────────────────────────────────────

-- Organisations
INSERT INTO plateforme.organisations (id, nom, type, siret, actif)
VALUES
  ('org-rls-a', 'Org A', 'traiteur', '11111111100001', true),
  ('org-rls-b', 'Org B', 'traiteur', '22222222200002', true);

-- Utilisateurs
INSERT INTO auth.users (id, email)
VALUES
  ('user-mgr-a',  'mgr-a@test.fr'),
  ('user-mgr-b',  'mgr-b@test.fr'),
  ('user-admin',  'admin@savr.fr');

INSERT INTO plateforme.profils (user_id, organisation_id, role)
VALUES
  ('user-mgr-a',  'org-rls-a', 'traiteur_manager'),
  ('user-mgr-b',  'org-rls-b', 'traiteur_manager'),
  ('user-admin',  null,        'admin_savr');

-- Lieux
INSERT INTO plateforme.lieux (id, nom, organisation_id, adresse_acces, code_postal, ville, actif)
VALUES ('lieu-rls-1', 'Salle A', 'org-rls-a', '1 rue Test', '75001', 'Paris', true);

-- Événements
INSERT INTO plateforme.evenements (id, organisation_id, lieu_id, nom_evenement, date_evenement, nb_pax, statut)
VALUES
  ('ev-rls-a', 'org-rls-a', 'lieu-rls-1', 'Gala A', '2026-06-01', 100, 'programme'),
  ('ev-rls-b', 'org-rls-b', 'lieu-rls-1', 'Gala B', '2026-06-02', 80,  'programme');

-- Collectes
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, realisee_at, cloturee_at, created_by)
VALUES
  ('col-rls-a', 'ev-rls-a', 'anti_gaspi', 'cloturee',
   now() - interval '26h', now() - interval '25h', 'user-mgr-a'),
  ('col-rls-b', 'ev-rls-b', 'anti_gaspi', 'cloturee',
   now() - interval '26h', now() - interval '25h', 'user-mgr-b');

-- Association
INSERT INTO plateforme.associations (id, nom, habilitee_attestation_fiscale, actif)
VALUES ('asso-rls-1', 'Asso Test', true, true);

-- Attestations (une par org)
INSERT INTO plateforme.attestations_don (
  id, collecte_id, association_id, mention_fiscale_2041ge,
  numero, date_emission, date_collecte,
  donateur_raison_sociale, donateur_siret,
  association_nom, association_habilitation,
  volume_repas, version, statut
) VALUES
  ('att-rls-a', 'col-rls-a', 'asso-rls-1', true,
   'ATT-DON-2026-00101', '2026-06-02', '2026-06-01',
   'Org A', '11111111100001', 'Asso Test', 'habilitee',
   120, 1, 'emise'),
  ('att-rls-b', 'col-rls-b', 'asso-rls-1', true,
   'ATT-DON-2026-00102', '2026-06-03', '2026-06-02',
   'Org B', '22222222200002', 'Asso Test', 'habilitee',
   80, 1, 'emise');

-- ─── Tests ─────────────────────────────────────────────────────────────────

-- T1 : traiteur_manager org A voit uniquement son attestation
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"user-mgr-a","role":"authenticated","app_role":"traiteur_manager","org_id":"org-rls-a"}';

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don),
  1,
  'T1 : traiteur_manager org A voit 1 attestation (la sienne)'
);

SELECT is(
  (SELECT id FROM plateforme.attestations_don LIMIT 1),
  'att-rls-a',
  'T1b : l''attestation visible est celle de org A'
);

-- T2 : traiteur_manager org B ne voit pas l'attestation de org A
SET LOCAL request.jwt.claims = '{"sub":"user-mgr-b","role":"authenticated","app_role":"traiteur_manager","org_id":"org-rls-b"}';

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don),
  1,
  'T2 : traiteur_manager org B voit 1 attestation (attestations_don_org_scoped)'
);

SELECT is(
  (SELECT id FROM plateforme.attestations_don LIMIT 1),
  'att-rls-b',
  'T2b : org B voit uniquement att-rls-b'
);

-- T3 : INSERT direct par traiteur_manager → deny
SELECT throws_ok(
  $$INSERT INTO plateforme.attestations_don (
      collecte_id, association_id, mention_fiscale_2041ge,
      numero, date_emission, date_collecte,
      donateur_raison_sociale, donateur_siret,
      association_nom, association_habilitation,
      volume_repas, version, statut
    ) VALUES (
      'col-rls-b', 'asso-rls-1', false,
      'ATT-DON-2026-99999', '2026-06-15', '2026-06-14',
      'Hack', '00000000000000', 'Asso X', 'non_habilitee',
      10, 1, 'en_attente'
    )$$,
  '42501',
  'T3 : INSERT attestations_don par traiteur_manager → deny RLS (regeneration_bordereau_et_attestation_interdites_traiteur)'
);

-- T4 : admin_savr voit toutes les attestations
SET LOCAL request.jwt.claims = '{"sub":"user-admin","role":"authenticated","app_role":"admin_savr","org_id":null}';

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don),
  2,
  'T4 : admin_savr voit toutes les attestations (2)'
);

-- T5 : admin_savr peut UPDATE (ex: correction statut)
SELECT lives_ok(
  $$UPDATE plateforme.attestations_don SET statut = 'corrigee' WHERE id = 'att-rls-a'$$,
  'T5 : admin_savr peut UPDATE attestations_don'
);

SELECT is(
  (SELECT statut::text FROM plateforme.attestations_don WHERE id = 'att-rls-a'),
  'corrigee',
  'T5b : statut mis à jour à corrigee'
);

-- T6 : traiteur_commercial voit ses attestations (lecture seule)
INSERT INTO plateforme.profils (user_id, organisation_id, role)
VALUES ('user-com-a', 'org-rls-a', 'traiteur_commercial');

SET LOCAL request.jwt.claims = '{"sub":"user-com-a","role":"authenticated","app_role":"traiteur_commercial","org_id":"org-rls-a"}';

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don),
  1,
  'T6 : traiteur_commercial org A voit 1 attestation'
);

SELECT * FROM finish();
ROLLBACK;
