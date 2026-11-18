-- =============================================================================
-- pgTAP — Visibilité des collectes, flux et événements calculée par ensembles
-- Migration : 20261118120000_plateforme_collectes_visibilite_par_ensemble.sql
-- =============================================================================
-- Réécriture de col_select, cf_select et evt_gestionnaire_select pour la
-- performance (test de charge du 2026-11-18). Aucun accès ne doit changer.
--
-- ORACLE : `plateforme.f_collecte_visible`, inchangée, est l'ancienne règle.
-- Pour chaque jeton, ce que la RLS rend sous `authenticated` est comparé à ce
-- que rendait l'ancienne policy, recalculée hors RLS avec les mêmes claims :
--   collectes        ← f_collecte_visible(id), plus col_admin / col_ops ;
--   collecte_flux    ← f_collecte_visible(collecte_id), plus cf_admin ;
--   evenements (gestionnaire) ← l'ancienne evt_gestionnaire_select, son EXISTS
--                      sur collectes lu sous l'ancienne col_select.
--
--   1-11   collectes : 11 jetons (6 rôles clients, équipe Savr, sans
--          organisation), égalité avec l'oracle ;
--   12-22  collecte_flux : mêmes jetons ;
--   23-24  evenements : les deux gestionnaires ;
--   25-31  non-vacuité, en dur : les branches de la règle sont exercées
--          (programmateur, traiteur opérationnel, client organisateur, lieu
--          hors brouillon, lieu sans date, brouillon tiers, inconnu) ;
--   32-34  cliquets : plus aucun appel ligne à ligne de f_collecte_visible
--          dans col_select et cf_select ; aucune policy SELECT d'evenements ne
--          relit collectes dans une sous-requête (récursion de policies).
--
-- Fixture (organisations) : T1 programme E1 (traiteur opérationnel T2, client
-- organisateur CO, lieu L1) ; X, tiers, programme sur L1 (E2 daté, E3 sans
-- date, E6 brouillon seul) et sur L2 (E7) ; A (agence) programme E4 pour T1 sur
-- L2 ; G (gestionnaire de L1) programme E5 sur L2 ; G2 gestionnaire sans lieu.
-- =============================================================================

BEGIN;
SELECT plan(34);

CREATE OR REPLACE FUNCTION _vpe_claims(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', 'f7e10000-0000-0000-0000-00000000aaaa', 'role', 'authenticated',
    'user_role', p_role, 'organisation_id', p_org,
    'app_domain', 'plateforme')::text, true);
END $$;

CREATE OR REPLACE FUNCTION _vpe_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM _vpe_claims(p_role, p_org);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION _vpe_su()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
  ('f7e10000-0000-0000-0000-0000000000a1', 'VPE T1', 'VPE T1 SAS', 'traiteur',            '96710000000001', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a2', 'VPE T2', 'VPE T2 SAS', 'traiteur',            '96710000000002', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a3', 'VPE CO', 'VPE CO SA',  'client_organisateur', '96710000000003', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a4', 'VPE G',  'VPE G SA',   'gestionnaire_lieux',  '96710000000004', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a5', 'VPE G2', 'VPE G2 SA',  'gestionnaire_lieux',  '96710000000005', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a6', 'VPE A',  'VPE A SAS',  'agence',              '96710000000006', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a7', 'VPE X',  'VPE X SAS',  'traiteur',            '96710000000007', true, 0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('f7e10000-0000-0000-0000-0000000000b1', 'f7e10000-0000-0000-0000-0000000000a1', 't1@vpe.test', 'T', 'Un',   'traiteur_manager'),
  ('f7e10000-0000-0000-0000-0000000000b4', 'f7e10000-0000-0000-0000-0000000000a4', 'g@vpe.test',  'G', 'G',    'gestionnaire_lieux'),
  ('f7e10000-0000-0000-0000-0000000000b6', 'f7e10000-0000-0000-0000-0000000000a6', 'a@vpe.test',  'A', 'A',    'agence'),
  ('f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000a7', 'x@vpe.test',  'X', 'X',    'traiteur_manager');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('f7e10000-0000-0000-0000-0000000000c1', 'f7e10000-0000-0000-0000-0000000000a1', 'VPE T1 SAS', '96710000000001', '1 rue', '75001', 'Paris'),
  ('f7e10000-0000-0000-0000-0000000000c4', 'f7e10000-0000-0000-0000-0000000000a4', 'VPE G SA',   '96710000000004', '4 rue', '75004', 'Paris'),
  ('f7e10000-0000-0000-0000-0000000000c6', 'f7e10000-0000-0000-0000-0000000000a6', 'VPE A SAS',  '96710000000006', '6 rue', '75006', 'Paris'),
  ('f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000a7', 'VPE X SAS',  '96710000000007', '7 rue', '75007', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('f7e10000-0000-0000-0000-0000000000d1', 'VPE Lieu 1', '1 av VPE', '75008', 'Paris', 'camionnette'),
  ('f7e10000-0000-0000-0000-0000000000d2', 'VPE Lieu 2', '2 av VPE', '75009', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('f7e10000-0000-0000-0000-0000000000a4', 'f7e10000-0000-0000-0000-0000000000d1');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('f7e10000-0000-0000-0000-0000000000ee', 'GALA_VPE', 'Gala VPE', 1, true);

-- Événements : (id, programmateur, traiteur opérationnel, client organisateur,
-- entité, auteur, lieu).
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, client_organisateur_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES
  ('f7e10000-0000-0000-0000-0000000000e1', 'f7e10000-0000-0000-0000-0000000000a1', 'f7e10000-0000-0000-0000-0000000000a2', 'f7e10000-0000-0000-0000-0000000000a3',
   'f7e10000-0000-0000-0000-0000000000c1', 'f7e10000-0000-0000-0000-0000000000b1', 'f7e10000-0000-0000-0000-0000000000d1', 'f7e10000-0000-0000-0000-0000000000ee',
   CURRENT_DATE + 30, 100, 'Contact', '0600000000'),
  ('f7e10000-0000-0000-0000-0000000000e2', 'f7e10000-0000-0000-0000-0000000000a7', 'f7e10000-0000-0000-0000-0000000000a7', NULL,
   'f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000d1', 'f7e10000-0000-0000-0000-0000000000ee',
   CURRENT_DATE + 31, 100, 'Contact', '0600000000'),
  ('f7e10000-0000-0000-0000-0000000000e3', 'f7e10000-0000-0000-0000-0000000000a7', 'f7e10000-0000-0000-0000-0000000000a7', NULL,
   'f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000d1', 'f7e10000-0000-0000-0000-0000000000ee',
   CURRENT_DATE + 32, 100, 'Contact', '0600000000'),
  ('f7e10000-0000-0000-0000-0000000000e4', 'f7e10000-0000-0000-0000-0000000000a6', 'f7e10000-0000-0000-0000-0000000000a1', NULL,
   'f7e10000-0000-0000-0000-0000000000c6', 'f7e10000-0000-0000-0000-0000000000b6', 'f7e10000-0000-0000-0000-0000000000d2', 'f7e10000-0000-0000-0000-0000000000ee',
   CURRENT_DATE + 33, 100, 'Contact', '0600000000'),
  ('f7e10000-0000-0000-0000-0000000000e5', 'f7e10000-0000-0000-0000-0000000000a4', 'f7e10000-0000-0000-0000-0000000000a1', NULL,
   'f7e10000-0000-0000-0000-0000000000c4', 'f7e10000-0000-0000-0000-0000000000b4', 'f7e10000-0000-0000-0000-0000000000d2', 'f7e10000-0000-0000-0000-0000000000ee',
   CURRENT_DATE + 34, 100, 'Contact', '0600000000'),
  ('f7e10000-0000-0000-0000-0000000000e6', 'f7e10000-0000-0000-0000-0000000000a7', 'f7e10000-0000-0000-0000-0000000000a7', NULL,
   'f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000d1', 'f7e10000-0000-0000-0000-0000000000ee',
   CURRENT_DATE + 35, 100, 'Contact', '0600000000'),
  ('f7e10000-0000-0000-0000-0000000000e7', 'f7e10000-0000-0000-0000-0000000000a7', 'f7e10000-0000-0000-0000-0000000000a7', NULL,
   'f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000d2', 'f7e10000-0000-0000-0000-0000000000ee',
   CURRENT_DATE + 36, 100, 'Contact', '0600000000');

-- Collectes ZD (id, événement, statut).
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte)
SELECT v.id::uuid, v.evt::uuid, 'zero_dechet', v.statut::plateforme.collecte_statut, CURRENT_DATE + 30, '20:00'
FROM (VALUES
  ('f7e10000-0000-0000-0000-000000000c01', 'f7e10000-0000-0000-0000-0000000000e1', 'programmee'),
  ('f7e10000-0000-0000-0000-000000000c02', 'f7e10000-0000-0000-0000-0000000000e1', 'brouillon'),
  ('f7e10000-0000-0000-0000-000000000c03', 'f7e10000-0000-0000-0000-0000000000e2', 'validee'),
  ('f7e10000-0000-0000-0000-000000000c04', 'f7e10000-0000-0000-0000-0000000000e2', 'brouillon'),
  ('f7e10000-0000-0000-0000-000000000c05', 'f7e10000-0000-0000-0000-0000000000e3', 'programmee'),
  ('f7e10000-0000-0000-0000-000000000c06', 'f7e10000-0000-0000-0000-0000000000e4', 'programmee'),
  ('f7e10000-0000-0000-0000-000000000c07', 'f7e10000-0000-0000-0000-0000000000e5', 'brouillon'),
  ('f7e10000-0000-0000-0000-000000000c08', 'f7e10000-0000-0000-0000-0000000000e6', 'brouillon'),
  ('f7e10000-0000-0000-0000-000000000c09', 'f7e10000-0000-0000-0000-0000000000e7', 'programmee')
) AS v(id, evt, statut);

-- Deux flux par collecte.
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT c.id, f.id, 10
FROM plateforme.collectes c
CROSS JOIN (SELECT id FROM plateforme.flux_dechets ORDER BY code LIMIT 2) f
WHERE c.id::text LIKE 'f7e10000-0000-0000-0000-000000000c0%';

-- E3 sans date : la date d'événement est posée par les collectes (et reposée à
-- chaque écriture d'une collecte), on la retire en dernier (branche « lieu » :
-- date obligatoire).
UPDATE plateforme.evenements SET date_evenement = NULL
 WHERE id = 'f7e10000-0000-0000-0000-0000000000e3';

-- ── Oracle : l'ancienne règle, hors RLS, sous les claims de chaque jeton ────
CREATE TEMP TABLE _vpe_jetons (n int PRIMARY KEY, role text, org uuid, libelle text) ON COMMIT DROP;
INSERT INTO _vpe_jetons VALUES
  (1,  'traiteur_manager',    'f7e10000-0000-0000-0000-0000000000a1', 'traiteur programmateur T1'),
  (2,  'traiteur_commercial', 'f7e10000-0000-0000-0000-0000000000a1', 'commercial de T1'),
  (3,  'traiteur_manager',    'f7e10000-0000-0000-0000-0000000000a2', 'traiteur opérationnel T2'),
  (4,  'client_organisateur', 'f7e10000-0000-0000-0000-0000000000a3', 'client organisateur CO'),
  (5,  'gestionnaire_lieux',  'f7e10000-0000-0000-0000-0000000000a4', 'gestionnaire G (lieu L1)'),
  (6,  'gestionnaire_lieux',  'f7e10000-0000-0000-0000-0000000000a5', 'gestionnaire G2 (sans lieu)'),
  (7,  'agence',              'f7e10000-0000-0000-0000-0000000000a6', 'agence A'),
  (8,  'traiteur_manager',    'f7e10000-0000-0000-0000-0000000000a7', 'traiteur tiers X'),
  (9,  'admin_savr',          NULL,                                   'admin_savr'),
  (10, 'ops_savr',            NULL,                                   'ops_savr'),
  (11, 'traiteur_manager',    NULL,                                   'jeton sans organisation');

CREATE TEMP TABLE _vpe_att_col  (n int, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE _vpe_att_flux (n int, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE _vpe_att_evt  (n int, id uuid) ON COMMIT DROP;
GRANT SELECT ON _vpe_jetons, _vpe_att_col, _vpe_att_flux, _vpe_att_evt TO authenticated;

CREATE OR REPLACE FUNCTION _vpe_oracle(p_n int, p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM _vpe_claims(p_role, p_org);
  INSERT INTO _vpe_att_col
    SELECT p_n, c.id FROM plateforme.collectes c
    WHERE c.id::text LIKE 'f7e10000-%'
      AND (plateforme.f_collecte_visible(c.id)
           OR plateforme.f_app_role() IN ('admin_savr', 'ops_savr'));
  INSERT INTO _vpe_att_flux
    SELECT p_n, f.id FROM plateforme.collecte_flux f
    WHERE f.collecte_id::text LIKE 'f7e10000-%'
      AND (plateforme.f_collecte_visible(f.collecte_id)
           OR plateforme.f_app_role() = 'admin_savr');
  INSERT INTO _vpe_att_evt
    SELECT p_n, e.id FROM plateforme.evenements e
    WHERE e.id::text LIKE 'f7e10000-%'
      AND plateforme.f_app_role() = 'gestionnaire_lieux'
      AND (   e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
           OR (    e.date_evenement IS NOT NULL
               AND e.lieu_id IN (SELECT ol.lieu_id FROM plateforme.organisations_lieux ol
                                 WHERE ol.organisation_id = (auth.jwt()->>'organisation_id')::uuid)
               AND EXISTS (SELECT 1 FROM plateforme.collectes c
                           WHERE c.evenement_id = e.id AND c.statut <> 'brouillon'
                             AND plateforme.f_collecte_visible(c.id))));
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

SELECT _vpe_oracle(n, role, org) FROM _vpe_jetons ORDER BY n;

-- Compare, sous `authenticated`, la lecture RLS à l'oracle du jeton n.
CREATE OR REPLACE FUNCTION _vpe_vu(p_table text, p_n int)
RETURNS SETOF uuid LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM _vpe_jetons WHERE n = p_n;
  PERFORM _vpe_jwt(r.role, r.org);
  IF p_table = 'collectes' THEN
    RETURN QUERY SELECT c.id FROM plateforme.collectes c WHERE c.id::text LIKE 'f7e10000-%' ORDER BY 1;
  ELSIF p_table = 'collecte_flux' THEN
    RETURN QUERY SELECT f.id FROM plateforme.collecte_flux f WHERE f.collecte_id::text LIKE 'f7e10000-%' ORDER BY 1;
  ELSE
    RETURN QUERY SELECT e.id FROM plateforme.evenements e WHERE e.id::text LIKE 'f7e10000-%' ORDER BY 1;
  END IF;
  PERFORM _vpe_su();
END $$;

-- ── 1-11 : collectes ────────────────────────────────────────────────────────
SELECT set_eq(
  format('SELECT * FROM _vpe_vu(%L, %s)', 'collectes', n),
  format('SELECT id FROM _vpe_att_col WHERE n = %s', n),
  format('%s. collectes : même ensemble que f_collecte_visible — %s', n, libelle))
FROM _vpe_jetons ORDER BY n;

-- ── 12-22 : collecte_flux ───────────────────────────────────────────────────
SELECT set_eq(
  format('SELECT * FROM _vpe_vu(%L, %s)', 'collecte_flux', n),
  format('SELECT id FROM _vpe_att_flux WHERE n = %s', n),
  format('%s. collecte_flux : même ensemble que l''ancienne cf_select — %s', n + 11, libelle))
FROM _vpe_jetons ORDER BY n;

-- ── 23-24 : evenements, gestionnaires ───────────────────────────────────────
SELECT set_eq(
  format('SELECT * FROM _vpe_vu(%L, %s)', 'evenements', n),
  format('SELECT id FROM _vpe_att_evt WHERE n = %s', n),
  format('%s. evenements : même ensemble que l''ancienne evt_gestionnaire_select — %s',
         CASE n WHEN 5 THEN 23 ELSE 24 END, libelle))
FROM _vpe_jetons WHERE n IN (5, 6) ORDER BY n;

-- ── 25-31 : non-vacuité (les branches sont exercées) ────────────────────────
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('collectes', 1)$$,
  $$VALUES ('f7e10000-0000-0000-0000-000000000c01'::uuid), ('f7e10000-0000-0000-0000-000000000c02'),
           ('f7e10000-0000-0000-0000-000000000c06'), ('f7e10000-0000-0000-0000-000000000c07')$$,
  '25. T1 : ses collectes (brouillon compris) et celles dont il est traiteur opérationnel');
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('collectes', 3)$$,
  $$VALUES ('f7e10000-0000-0000-0000-000000000c01'::uuid), ('f7e10000-0000-0000-0000-000000000c02')$$,
  '26. T2 : les collectes de l''événement dont il est traiteur opérationnel');
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('collectes', 4)$$,
  $$VALUES ('f7e10000-0000-0000-0000-000000000c01'::uuid), ('f7e10000-0000-0000-0000-000000000c02')$$,
  '27. CO : les collectes de l''événement dont il est client organisateur');
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('collectes', 5)$$,
  $$VALUES ('f7e10000-0000-0000-0000-000000000c01'::uuid), ('f7e10000-0000-0000-0000-000000000c03'),
           ('f7e10000-0000-0000-0000-000000000c07')$$,
  '28. G : hors brouillon sur son lieu daté, plus son propre brouillon ; ni brouillon tiers, ni événement sans date');
SELECT is_empty(
  $$SELECT * FROM _vpe_vu('collectes', 6)$$,
  '29. G2 (sans lieu) : aucune collecte');
SELECT is_empty(
  $$SELECT * FROM _vpe_vu('collectes', 11)$$,
  '30. jeton sans organisation : aucune collecte');
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('evenements', 5)$$,
  $$VALUES ('f7e10000-0000-0000-0000-0000000000e1'::uuid), ('f7e10000-0000-0000-0000-0000000000e2'),
           ('f7e10000-0000-0000-0000-0000000000e5')$$,
  '31. G, evenements : lieu daté avec collecte hors brouillon, plus les siens ; ni E3 (sans date) ni E6 (brouillon seul)');

-- ── 32-34 : cliquets ────────────────────────────────────────────────────────
SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'collectes' AND policyname = 'col_select')
    NOT LIKE '%f_collecte_visible%',
  '32. col_select n''appelle plus f_collecte_visible ligne à ligne');
SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'collecte_flux' AND policyname = 'cf_select')
    NOT LIKE '%f_collecte_visible%',
  '33. cf_select n''appelle plus f_collecte_visible ligne à ligne');
SELECT is_empty(
  $$SELECT policyname FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'evenements' AND cmd IN ('SELECT', 'ALL')
      AND qual ~ 'plateforme\.collectes\M'$$,
  '34. aucune policy de lecture d''evenements ne relit collectes (récursion collectes → evenements → collectes)');

SELECT * FROM finish();
ROLLBACK;
