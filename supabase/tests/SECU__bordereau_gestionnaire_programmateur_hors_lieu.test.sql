-- =============================================================================
-- pgTAP — Numéro de bordereau dans les rapports PDF (décision Val 2026-10-27,
-- CDC §12 §1.7 « Numéro de bordereau »)
-- =============================================================================
-- Les rapports (rapport d'une collecte @3, rapport cumulé d'un événement) lisent
-- leurs mesures en service-role et n'impriment le numéro du bordereau que si le
-- demandeur lit ce bordereau sous SA RLS (`bord_*_select`) — lecture faite par
-- `lireBordereauxVisibles` (packages/plateforme/src/lib/pdf/bordereaux-visibles.ts).
-- Ce fichier fige le cas qui motive la règle : un gestionnaire qui a programmé
-- un événement sur un lieu NON rattaché à son organisation voit la collecte
-- (régime « programmé par moi ») mais pas son bordereau (bord_gestionnaire_select
-- ne regarde que les lieux rattachés).
--
--   1   contrôle positif : GA lit la collecte qu'il a programmée sur L2 ;
--   2   GA ne lit pas le bordereau de cette collecte → « — » dans le PDF ;
--   3   GB, gestionnaire de L2, lit ce bordereau (la policy n'est pas vide) ;
--   4   GA lit le bordereau d'une collecte tenue sur son lieu L1 ;
--   5   requête exacte du code (`collecte_id IN (…)`) : seul le bordereau de L1.
--
-- Fixture : gestionnaires GA (lieu L1) et GB (lieu L2), traiteur T. Les
-- programmations passent par `fn_enregistrer_programmation` sous service_role.
-- JWT au format PRODUCTION (claim `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(5);

CREATE OR REPLACE FUNCTION _bgp_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(), 'role', 'authenticated', 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION _bgp_su()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Le niveau événement d'une programmation.
CREATE OR REPLACE FUNCTION _bgp_evt(p_org uuid, p_traiteur uuid, p_entite uuid, p_user uuid, p_lieu uuid, p_nom text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'organisation_id', p_org, 'traiteur_operationnel_organisation_id', p_traiteur,
    'entite_facturation_id', p_entite, 'lieu_id', p_lieu,
    'created_by', p_user, 'nom_evenement', p_nom)
$$;

CREATE OR REPLACE FUNCTION _bgp_carte(p_date date)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'type', 'zd', 'type_evenement_id', 'b7e80000-0000-0000-0000-000000000bee',
    'date_collecte', p_date, 'heure_collecte', '20:00', 'pax', 150,
    'contact_principal_nom', 'Contact', 'contact_principal_telephone', '0600000000')
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
  ('b7e80000-0000-0000-0000-00000000000a', 'BGP Gest A',   'BGP Gest A SA',     'gestionnaire_lieux', '96800000000001', true, 0),
  ('b7e80000-0000-0000-0000-00000000000b', 'BGP Gest B',   'BGP Gest B SA',     'gestionnaire_lieux', '96800000000002', true, 0),
  ('b7e80000-0000-0000-0000-00000000000c', 'BGP Traiteur', 'BGP Traiteur SARL', 'traiteur',           '96800000000003', true, 0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  ('b7e80000-0000-0000-0000-000000000a01', 'b7e80000-0000-0000-0000-00000000000a', 'ga@bgp.test', 'G', 'A', 'gestionnaire_lieux', true),
  ('b7e80000-0000-0000-0000-000000000c01', 'b7e80000-0000-0000-0000-00000000000c', 't@bgp.test',  'T', 'T', 'traiteur_manager',   true);

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('b7e80000-0000-0000-0000-0000000000fa', 'b7e80000-0000-0000-0000-00000000000a', 'BGP Gest A SA',     '96800000000001', '1 rue', '75001', 'Paris'),
  ('b7e80000-0000-0000-0000-0000000000fc', 'b7e80000-0000-0000-0000-00000000000c', 'BGP Traiteur SARL', '96800000000003', '3 rue', '75003', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('b7e80000-0000-0000-0000-000000000b01', 'BGP Lieu 1', '1 av BGP', '75008', 'Paris', 'camionnette'),
  ('b7e80000-0000-0000-0000-000000000b02', 'BGP Lieu 2', '2 av BGP', '75009', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('b7e80000-0000-0000-0000-00000000000a', 'b7e80000-0000-0000-0000-000000000b01'),
  ('b7e80000-0000-0000-0000-00000000000b', 'b7e80000-0000-0000-0000-000000000b02');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('b7e80000-0000-0000-0000-000000000bee', 'GALA_BGP', 'Gala BGP', 1, true);

CREATE TEMP TABLE _bgp_ids (k text PRIMARY KEY, col uuid) ON COMMIT DROP;
GRANT SELECT ON _bgp_ids TO authenticated;
GRANT SELECT, INSERT ON _bgp_ids TO service_role;

SET LOCAL ROLE service_role;
-- GA programme sur L2, lieu de GB, non rattaché à son organisation.
INSERT INTO _bgp_ids SELECT 'ga_sur_l2', (r->'collecte_ids'->>0)::uuid
FROM plateforme.fn_enregistrer_programmation(
  _bgp_evt('b7e80000-0000-0000-0000-00000000000a', 'b7e80000-0000-0000-0000-00000000000c',
           'b7e80000-0000-0000-0000-0000000000fa', 'b7e80000-0000-0000-0000-000000000a01',
           'b7e80000-0000-0000-0000-000000000b02', 'Gala GA sur L2'),
  jsonb_build_array(_bgp_carte('2026-11-20')), true) r;
-- Le traiteur T programme sur L1, lieu de GA.
INSERT INTO _bgp_ids SELECT 't_sur_l1', (r->'collecte_ids'->>0)::uuid
FROM plateforme.fn_enregistrer_programmation(
  _bgp_evt('b7e80000-0000-0000-0000-00000000000c', 'b7e80000-0000-0000-0000-00000000000c',
           'b7e80000-0000-0000-0000-0000000000fc', 'b7e80000-0000-0000-0000-000000000c01',
           'b7e80000-0000-0000-0000-000000000b01', 'Gala T sur L1'),
  jsonb_build_array(_bgp_carte('2026-11-21')), true) r;
RESET ROLE;

INSERT INTO plateforme.bordereaux_savr (collecte_id, numero, producteur_raison_sociale, statut)
SELECT col, 'BSAV-BGP-' || k, 'BGP Traiteur SARL', 'emis' FROM _bgp_ids;

-- ── GA, gestionnaire de L1 ──────────────────────────────────────────────────
SELECT _bgp_jwt('gestionnaire_lieux', 'b7e80000-0000-0000-0000-00000000000a');

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes
    WHERE id = (SELECT col FROM _bgp_ids WHERE k = 'ga_sur_l2')),
  1,
  'contrôle positif : le gestionnaire lit la collecte qu’il a programmée sur un lieu non rattaché'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.bordereaux_savr
    WHERE collecte_id = (SELECT col FROM _bgp_ids WHERE k = 'ga_sur_l2')),
  0,
  'bord_gestionnaire_select refuse le bordereau de cette collecte : le rapport imprime « — »'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.bordereaux_savr
    WHERE collecte_id = (SELECT col FROM _bgp_ids WHERE k = 't_sur_l1')),
  1,
  'le bordereau d’une collecte tenue sur son lieu rattaché reste lu'
);

SELECT is(
  ARRAY(SELECT numero FROM plateforme.bordereaux_savr
         WHERE collecte_id IN (SELECT col FROM _bgp_ids) ORDER BY numero),
  ARRAY['BSAV-BGP-t_sur_l1']::text[],
  'requête des rapports (collecte_id IN …) : seul le bordereau lisible remonte'
);

-- ── GB, gestionnaire de L2 ──────────────────────────────────────────────────
SELECT _bgp_jwt('gestionnaire_lieux', 'b7e80000-0000-0000-0000-00000000000b');

SELECT is(
  (SELECT count(*)::int FROM plateforme.bordereaux_savr
    WHERE collecte_id = (SELECT col FROM _bgp_ids WHERE k = 'ga_sur_l2')),
  1,
  'le gestionnaire du lieu L2 lit ce bordereau : la policy n’est pas vide'
);

SELECT _bgp_su();
SELECT * FROM finish();
ROLLBACK;
