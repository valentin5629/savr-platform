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
--   1-15   collectes : 15 jetons, égalité avec l'oracle ;
--   16-30  collecte_flux : mêmes jetons ;
--   31-32  evenements : les deux gestionnaires ;
--   33-42  non-vacuité, en dur : programmateur, traiteur opérationnel, client
--          organisateur, lieu hors brouillon pour un gestionnaire ET pour un
--          rôle non gestionnaire de la même organisation, lieu sans date,
--          brouillon tiers, sans organisation, équipe Savr sans son code, piège
--          de l'appel direct ;
--   43-45  appel direct (PostgREST /rpc) des trois fonctions : rien de plus
--          que ce que le jeton lit déjà (revue sécurité du 2026-11-18) ;
--   46-48  cliquets : plus aucun appel ligne à ligne de f_collecte_visible
--          dans col_select et cf_select ; aucune policy de lecture
--          d'evenements ni d'organisations_lieux ne relit collectes dans une
--          sous-requête (récursion de policies).
--
-- Fixture (organisations) : T1 programme E1 (traiteur opérationnel T2, client
-- organisateur CO, lieu L1) ; X, tiers, programme sur L1 (E2 daté, E3 sans
-- date, E6 brouillon seul) et sur L2 (E7) ; A (agence) programme E4 pour T1
-- sur L2 ; G (gestionnaire de L1) programme E5 sur L2 ;
-- G2 gestionnaire sans lieu ; E8 : événement de T1 SANS collecte, dont T2
-- (traiteur) est client organisateur.
-- Jetons du code de vérification : admin_savr en aal1 dont le compte a un
-- facteur vérifié (refusé) ; traiteur d'une organisation qui exige le code,
-- compte au code activé, en aal1 (refusé) puis en aal2 (admis).
-- Jeton 15 : rôle traiteur sur l'organisation du gestionnaire G. Atteignable
-- par une saisie du back-office : ni la base ni POST /api/v1/admin/users
-- n'imposent que le rôle suive le type de l'organisation (mesuré par la revue
-- sécurité du 2026-11-18) ; seul le rattachement à un lieu est réservé aux
-- gestionnaires (déclencheur). Fige que la branche « lieu » de la règle ne
-- dépend pas du rôle, comme dans f_collecte_visible.
-- =============================================================================

BEGIN;
SELECT plan(48);

-- ── Jetons ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _vpe_jetons (
  n int PRIMARY KEY, role text, org uuid, sub uuid, aal text, cv_obligatoire boolean, libelle text
) ON COMMIT DROP;
INSERT INTO _vpe_jetons VALUES
  (1,  'traiteur_manager',    'f7e10000-0000-0000-0000-0000000000a1', NULL, 'aal1', false, 'traiteur programmateur T1'),
  (2,  'traiteur_commercial', 'f7e10000-0000-0000-0000-0000000000a1', NULL, 'aal1', false, 'commercial de T1'),
  (3,  'traiteur_manager',    'f7e10000-0000-0000-0000-0000000000a2', NULL, 'aal1', false, 'traiteur opérationnel T2'),
  (4,  'client_organisateur', 'f7e10000-0000-0000-0000-0000000000a3', NULL, 'aal1', false, 'client organisateur CO'),
  (5,  'gestionnaire_lieux',  'f7e10000-0000-0000-0000-0000000000a4', NULL, 'aal1', false, 'gestionnaire G (lieu L1)'),
  (6,  'gestionnaire_lieux',  'f7e10000-0000-0000-0000-0000000000a5', NULL, 'aal1', false, 'gestionnaire G2 (sans lieu)'),
  (7,  'agence',              'f7e10000-0000-0000-0000-0000000000a6', NULL, 'aal1', false, 'agence A'),
  (8,  'traiteur_manager',    'f7e10000-0000-0000-0000-0000000000a7', NULL, 'aal1', false, 'traiteur tiers X'),
  (9,  'admin_savr',          NULL,                                   NULL, 'aal1', false, 'admin_savr sans code activé'),
  (10, 'ops_savr',            NULL,                                   NULL, 'aal1', false, 'ops_savr sans code activé'),
  (11, 'traiteur_manager',    NULL,                                   NULL, 'aal1', false, 'jeton sans organisation'),
  (12, 'admin_savr',          NULL, 'f7e10000-0000-0000-0000-00000000bbbb', 'aal1', false, 'admin_savr, code activé, session sans code'),
  (13, 'traiteur_manager',    'f7e10000-0000-0000-0000-0000000000a1', 'f7e10000-0000-0000-0000-00000000cccc', 'aal1', true,  'T1, code exigé et activé, session sans code'),
  (14, 'traiteur_manager',    'f7e10000-0000-0000-0000-0000000000a1', 'f7e10000-0000-0000-0000-00000000cccc', 'aal2', true,  'T1, code exigé et activé, session avec code'),
  (15, 'traiteur_manager',    'f7e10000-0000-0000-0000-0000000000a4', NULL, 'aal1', false, 'rôle traiteur sur l''organisation de G (saisie possible au back-office)');
GRANT SELECT ON _vpe_jetons TO authenticated;

CREATE OR REPLACE FUNCTION _vpe_claims(p_n int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM _vpe_jetons WHERE n = p_n;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', coalesce(r.sub, 'f7e10000-0000-0000-0000-00000000aaaa'::uuid),
    'role', 'authenticated', 'aal', r.aal,
    'user_role', r.role, 'organisation_id', r.org,
    'code_verification_obligatoire', r.cv_obligatoire,
    'app_domain', 'plateforme')::text, true);
END $$;

CREATE OR REPLACE FUNCTION _vpe_jwt(p_n int)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM _vpe_claims(p_n);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION _vpe_su()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Comptes de l'admin (jeton 12) et du traiteur de T1 (jetons 13-14), chacun
-- avec un facteur vérifié : leur code est activé (la base ne l'exige que
-- d'un compte qui l'a activé).
INSERT INTO auth.users (id, email) VALUES
  ('f7e10000-0000-0000-0000-00000000bbbb', 'admin@vpe.test'),
  ('f7e10000-0000-0000-0000-00000000cccc', 'traiteur@vpe.test');
INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) VALUES
  ('f7e10000-0000-0000-0000-00000000bbbf', 'f7e10000-0000-0000-0000-00000000bbbb', 'Code VPE', 'totp', 'verified', now(), now()),
  ('f7e10000-0000-0000-0000-00000000cccf', 'f7e10000-0000-0000-0000-00000000cccc', 'Code VPE', 'totp', 'verified', now(), now());

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
  ('f7e10000-0000-0000-0000-0000000000a1', 'VPE T1', 'VPE T1 SAS', 'traiteur',            '96710000000001', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a2', 'VPE T2', 'VPE T2 SAS', 'traiteur',            '96710000000002', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a3', 'VPE CO', 'VPE CO SA',  'client_organisateur', '96710000000003', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a4', 'VPE G',  'VPE G SA',   'gestionnaire_lieux',  '96710000000004', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a5', 'VPE G2', 'VPE G2 SA',  'gestionnaire_lieux',  '96710000000005', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a6', 'VPE A',  'VPE A SAS',  'agence',              '96710000000006', true, 0),
  ('f7e10000-0000-0000-0000-0000000000a7', 'VPE X',  'VPE X SAS',  'traiteur',            '96710000000007', true, 0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('f7e10000-0000-0000-0000-0000000000b1', 'f7e10000-0000-0000-0000-0000000000a1', 't1@vpe.test', 'T', 'Un', 'traiteur_manager'),
  ('f7e10000-0000-0000-0000-0000000000b4', 'f7e10000-0000-0000-0000-0000000000a4', 'g@vpe.test',  'G', 'G',  'gestionnaire_lieux'),
  ('f7e10000-0000-0000-0000-0000000000b6', 'f7e10000-0000-0000-0000-0000000000a6', 'a@vpe.test',  'A', 'A',  'agence'),
  ('f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000a7', 'x@vpe.test',  'X', 'X',  'traiteur_manager');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('f7e10000-0000-0000-0000-0000000000c1', 'f7e10000-0000-0000-0000-0000000000a1', 'VPE T1 SAS', '96710000000001', '1 rue', '75001', 'Paris'),
  ('f7e10000-0000-0000-0000-0000000000c4', 'f7e10000-0000-0000-0000-0000000000a4', 'VPE G SA',   '96710000000004', '4 rue', '75004', 'Paris'),
  ('f7e10000-0000-0000-0000-0000000000c6', 'f7e10000-0000-0000-0000-0000000000a6', 'VPE A SAS',  '96710000000006', '6 rue', '75006', 'Paris'),
  ('f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000a7', 'VPE X SAS',  '96710000000007', '7 rue', '75007', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('f7e10000-0000-0000-0000-0000000000d1', 'VPE Lieu 1', '1 av VPE', '75008', 'Paris', 'camionnette'),
  ('f7e10000-0000-0000-0000-0000000000d2', 'VPE Lieu 2', '2 av VPE', '75009', 'Paris', 'camionnette');

-- G gère L1.
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('f7e10000-0000-0000-0000-0000000000a4', 'f7e10000-0000-0000-0000-0000000000d1');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('f7e10000-0000-0000-0000-0000000000ee', 'GALA_VPE', 'Gala VPE', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, client_organisateur_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
SELECT v.id::uuid, v.org::uuid, v.trop::uuid, v.cli::uuid, v.ent::uuid, v.auteur::uuid, v.lieu::uuid,
       'f7e10000-0000-0000-0000-0000000000ee', CURRENT_DATE + 30, 100, 'Contact', '0600000000'
FROM (VALUES
  -- (événement, programmateur, traiteur opérationnel, client organisateur, entité, auteur, lieu)
  ('f7e10000-0000-0000-0000-0000000000e1', 'f7e10000-0000-0000-0000-0000000000a1', 'f7e10000-0000-0000-0000-0000000000a2', 'f7e10000-0000-0000-0000-0000000000a3',
   'f7e10000-0000-0000-0000-0000000000c1', 'f7e10000-0000-0000-0000-0000000000b1', 'f7e10000-0000-0000-0000-0000000000d1'),
  ('f7e10000-0000-0000-0000-0000000000e2', 'f7e10000-0000-0000-0000-0000000000a7', 'f7e10000-0000-0000-0000-0000000000a7', NULL,
   'f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000d1'),
  ('f7e10000-0000-0000-0000-0000000000e3', 'f7e10000-0000-0000-0000-0000000000a7', 'f7e10000-0000-0000-0000-0000000000a7', NULL,
   'f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000d1'),
  ('f7e10000-0000-0000-0000-0000000000e4', 'f7e10000-0000-0000-0000-0000000000a6', 'f7e10000-0000-0000-0000-0000000000a1', NULL,
   'f7e10000-0000-0000-0000-0000000000c6', 'f7e10000-0000-0000-0000-0000000000b6', 'f7e10000-0000-0000-0000-0000000000d2'),
  ('f7e10000-0000-0000-0000-0000000000e5', 'f7e10000-0000-0000-0000-0000000000a4', 'f7e10000-0000-0000-0000-0000000000a1', NULL,
   'f7e10000-0000-0000-0000-0000000000c4', 'f7e10000-0000-0000-0000-0000000000b4', 'f7e10000-0000-0000-0000-0000000000d2'),
  ('f7e10000-0000-0000-0000-0000000000e6', 'f7e10000-0000-0000-0000-0000000000a7', 'f7e10000-0000-0000-0000-0000000000a7', NULL,
   'f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000d1'),
  ('f7e10000-0000-0000-0000-0000000000e7', 'f7e10000-0000-0000-0000-0000000000a7', 'f7e10000-0000-0000-0000-0000000000a7', NULL,
   'f7e10000-0000-0000-0000-0000000000c7', 'f7e10000-0000-0000-0000-0000000000b7', 'f7e10000-0000-0000-0000-0000000000d2'),
  ('f7e10000-0000-0000-0000-0000000000e8', 'f7e10000-0000-0000-0000-0000000000a1', 'f7e10000-0000-0000-0000-0000000000a1', 'f7e10000-0000-0000-0000-0000000000a2',
   'f7e10000-0000-0000-0000-0000000000c1', 'f7e10000-0000-0000-0000-0000000000b1', 'f7e10000-0000-0000-0000-0000000000d2')
) AS v(id, org, trop, cli, ent, auteur, lieu);

-- Collectes ZD (id, événement, statut). E8 n'en a aucune.
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
CREATE TEMP TABLE _vpe_att_col  (n int, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE _vpe_att_flux (n int, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE _vpe_att_evt  (n int, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE _vpe_rpc_hors (n int, fonction text, id uuid) ON COMMIT DROP;
GRANT SELECT ON _vpe_att_col, _vpe_att_flux, _vpe_att_evt TO authenticated;
GRANT SELECT, INSERT ON _vpe_rpc_hors TO authenticated;

CREATE OR REPLACE FUNCTION _vpe_oracle(p_n int)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM _vpe_claims(p_n);
  INSERT INTO _vpe_att_col
    SELECT p_n, c.id FROM plateforme.collectes c
    WHERE c.id::text LIKE 'f7e10000-%'
      AND (plateforme.f_collecte_visible(c.id)
           -- col_admin, col_ops (permissives) ; restrictive : code de vérification
           OR (plateforme.f_app_role() IN ('admin_savr', 'ops_savr')
               AND plateforme.f_code_verification_ok()));
  INSERT INTO _vpe_att_flux
    SELECT p_n, f.id FROM plateforme.collecte_flux f
    WHERE f.collecte_id::text LIKE 'f7e10000-%'
      AND (plateforme.f_collecte_visible(f.collecte_id)
           OR (plateforme.f_app_role() = 'admin_savr' AND plateforme.f_code_verification_ok()));
  INSERT INTO _vpe_att_evt
    SELECT p_n, e.id FROM plateforme.evenements e
    WHERE e.id::text LIKE 'f7e10000-%'
      AND plateforme.f_code_verification_ok()
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

SELECT _vpe_oracle(n) FROM _vpe_jetons ORDER BY n;

-- Lecture RLS sous `authenticated`, pour le jeton n.
CREATE OR REPLACE FUNCTION _vpe_vu(p_table text, p_n int)
RETURNS SETOF uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM _vpe_jwt(p_n);
  IF p_table = 'collectes' THEN
    RETURN QUERY SELECT c.id FROM plateforme.collectes c WHERE c.id::text LIKE 'f7e10000-%';
  ELSIF p_table = 'collecte_flux' THEN
    RETURN QUERY SELECT f.id FROM plateforme.collecte_flux f WHERE f.collecte_id::text LIKE 'f7e10000-%';
  ELSE
    RETURN QUERY SELECT e.id FROM plateforme.evenements e WHERE e.id::text LIKE 'f7e10000-%';
  END IF;
  PERFORM _vpe_su();
END $$;

-- Appel direct des trois fonctions, sous `authenticated`, pour chaque jeton :
-- garde ce qui dépasse ce que le jeton lit (événements lisibles et événements
-- des collectes lisibles ; collectes lisibles).
CREATE OR REPLACE FUNCTION _vpe_appels_directs()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n FROM _vpe_jetons ORDER BY n LOOP
    PERFORM _vpe_jwt(r.n);
    INSERT INTO _vpe_rpc_hors
      SELECT r.n, 'f_evenements_visibles_organisation', x
      FROM plateforme.f_evenements_visibles_organisation() x
      WHERE x::text LIKE 'f7e10000-%'
        AND x NOT IN (SELECT e.id FROM plateforme.evenements e
                      UNION SELECT c.evenement_id FROM plateforme.collectes c);
    INSERT INTO _vpe_rpc_hors
      SELECT r.n, 'f_evenements_visibles_lieux', x
      FROM plateforme.f_evenements_visibles_lieux() x
      WHERE x::text LIKE 'f7e10000-%'
        AND x NOT IN (SELECT e.id FROM plateforme.evenements e
                      UNION SELECT c.evenement_id FROM plateforme.collectes c);
    INSERT INTO _vpe_rpc_hors
      SELECT r.n, 'f_collectes_visibles_client', x
      FROM plateforme.f_collectes_visibles_client() x
      WHERE x::text LIKE 'f7e10000-%'
        AND x NOT IN (SELECT c.id FROM plateforme.collectes c);
    PERFORM _vpe_su();
  END LOOP;
END $$;

SELECT _vpe_appels_directs();

-- ── collectes, collecte_flux, evenements : égalité avec l'oracle ────────────
SELECT set_eq(
  format('SELECT * FROM _vpe_vu(%L, %s)', 'collectes', n),
  format('SELECT id FROM _vpe_att_col WHERE n = %s', n),
  format('collectes : même ensemble que f_collecte_visible — jeton %s, %s', n, libelle))
FROM _vpe_jetons ORDER BY n;

SELECT set_eq(
  format('SELECT * FROM _vpe_vu(%L, %s)', 'collecte_flux', n),
  format('SELECT id FROM _vpe_att_flux WHERE n = %s', n),
  format('collecte_flux : même ensemble que l''ancienne cf_select — jeton %s, %s', n, libelle))
FROM _vpe_jetons ORDER BY n;

SELECT set_eq(
  format('SELECT * FROM _vpe_vu(%L, %s)', 'evenements', n),
  format('SELECT id FROM _vpe_att_evt WHERE n = %s', n),
  format('evenements : même ensemble que l''ancienne evt_gestionnaire_select — jeton %s, %s', n, libelle))
FROM _vpe_jetons WHERE n IN (5, 6) ORDER BY n;

-- ── Non-vacuité (les branches sont exercées) ────────────────────────────────
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('collectes', 1)$$,
  $$VALUES ('f7e10000-0000-0000-0000-000000000c01'::uuid), ('f7e10000-0000-0000-0000-000000000c02'),
           ('f7e10000-0000-0000-0000-000000000c06'), ('f7e10000-0000-0000-0000-000000000c07')$$,
  'T1 : ses collectes (brouillon compris) et celles dont il est traiteur opérationnel');
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('collectes', 3)$$,
  $$VALUES ('f7e10000-0000-0000-0000-000000000c01'::uuid), ('f7e10000-0000-0000-0000-000000000c02')$$,
  'T2 : les collectes de l''événement dont il est traiteur opérationnel');
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('collectes', 4)$$,
  $$VALUES ('f7e10000-0000-0000-0000-000000000c01'::uuid), ('f7e10000-0000-0000-0000-000000000c02')$$,
  'CO : les collectes de l''événement dont il est client organisateur');
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('collectes', 5)$$,
  $$VALUES ('f7e10000-0000-0000-0000-000000000c01'::uuid), ('f7e10000-0000-0000-0000-000000000c03'),
           ('f7e10000-0000-0000-0000-000000000c07')$$,
  'G : hors brouillon sur son lieu daté, plus son propre brouillon ; ni brouillon tiers, ni événement sans date');
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('collectes', 15)$$,
  $$VALUES ('f7e10000-0000-0000-0000-000000000c01'::uuid), ('f7e10000-0000-0000-0000-000000000c03'),
           ('f7e10000-0000-0000-0000-000000000c07')$$,
  'rôle traiteur sur l''organisation de G : mêmes collectes que G (branche « lieu » indépendante du rôle)');
SELECT is_empty(
  $$SELECT * FROM _vpe_vu('collectes', 6)$$,
  'G2 (sans lieu) : aucune collecte');
SELECT is_empty(
  $$SELECT * FROM _vpe_vu('collectes', 11)$$,
  'jeton sans organisation : aucune collecte');
SELECT is_empty(
  $$SELECT * FROM _vpe_vu('collectes', 12) UNION ALL SELECT * FROM _vpe_vu('collectes', 13)$$,
  'session sans code d''un compte au code activé (admin_savr ; traiteur dont l''organisation exige le code) : aucune collecte');
SELECT set_eq(
  $$SELECT * FROM _vpe_vu('evenements', 5)$$,
  $$VALUES ('f7e10000-0000-0000-0000-0000000000e1'::uuid), ('f7e10000-0000-0000-0000-0000000000e2'),
           ('f7e10000-0000-0000-0000-0000000000e5')$$,
  'G, evenements : lieu daté avec collecte hors brouillon, plus les siens ; ni E3 (sans date) ni E6 (brouillon seul)');
SELECT is_empty(
  $$SELECT * FROM _vpe_vu('evenements', 3)
    INTERSECT SELECT 'f7e10000-0000-0000-0000-0000000000e8'::uuid$$,
  'piège de l''appel direct : T2 ne lit pas E8 (sans collecte, T2 n''y est que client organisateur)');

-- ── Appel direct : rien de plus que ce que le jeton lit ─────────────────────
SELECT is_empty(
  $$SELECT n, id FROM _vpe_rpc_hors WHERE fonction = 'f_evenements_visibles_organisation'$$,
  'appel direct de f_evenements_visibles_organisation : aucun événement que le jeton ne lit pas (15 jetons)');
SELECT is_empty(
  $$SELECT n, id FROM _vpe_rpc_hors WHERE fonction = 'f_evenements_visibles_lieux'$$,
  'appel direct de f_evenements_visibles_lieux : aucun événement que le jeton ne lit pas (15 jetons)');
SELECT is_empty(
  $$SELECT n, id FROM _vpe_rpc_hors WHERE fonction = 'f_collectes_visibles_client'$$,
  'appel direct de f_collectes_visibles_client : aucune collecte que le jeton ne lit pas (15 jetons)');

-- ── Cliquets ────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'collectes' AND policyname = 'col_select')
    NOT LIKE '%f_collecte_visible%',
  'col_select n''appelle plus f_collecte_visible ligne à ligne');
SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'collecte_flux' AND policyname = 'cf_select')
    NOT LIKE '%f_collecte_visible%',
  'cf_select n''appelle plus f_collecte_visible ligne à ligne');
SELECT is_empty(
  $$SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename IN ('evenements', 'organisations_lieux')
      AND cmd IN ('SELECT', 'ALL')
      AND qual ~ 'plateforme\.collectes\M'$$,
  'aucune policy de lecture d''evenements ni d''organisations_lieux ne relit collectes (récursion collectes → evenements → collectes)');

SELECT * FROM finish();
ROLLBACK;
