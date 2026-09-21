-- =============================================================================
-- pgTAP — f_dechets_labo_estimes : NULL quand le coefficient n'est pas communiqué
-- Migration : 20260921190000_plateforme_dechets_labo_null_sans_coefficient.sql
-- =============================================================================
-- Divergence `clair` : _Divergences/M3.2_20260921_dechets-labo-coalesce-zero.md
--
-- Avant ce lot, le COALESCE(…, 0) de 20260611180000 rendait `0` dans TOUS les cas
-- dégradés : le gestionnaire lisait « 0.0 kg » — une estimation nulle affirmée —
-- là où §05 R_dechets_labo_estimes et §06.05 §2/§3 demandent « — » (inconnu).
--
-- ORACLES — les 3 cas exigés, plus leurs contrôles positifs :
--   1 valeur | 2 sans coefficient → NULL | 3 coefficient DÉCLARÉ à 0 → 0 (la
--   distinction que la règle pose) | 4 hors périmètre → NULL.
--   5 et 6 sont les contre-épreuves de non-vacuité : le MÊME événement rend une
--   valeur dès que la seule cause du NULL disparaît (coefficient inséré en 5,
--   appelant staff en 6). Sans elles, 2 et 4 passeraient aussi sur une fixture
--   cassée — un événement inexistant rend NULL lui aussi.
--   7-9 gardent les propriétés de sécurité que `CREATE OR REPLACE` peut défaire
--   en silence : il remplace `proconfig`, donc omettre le `SET search_path`
--   aurait annulé le durcissement CWE-426 de 20260622140000 sans un mot.
--
-- Non-distinguabilité CONSERVÉE : « sans coefficient » (2) et « hors périmètre »
-- (4) rendent tous deux NULL — ils valaient tous deux 0 avant. Aucun oracle
-- n'est créé pour l'appelant, la fonction en dit strictement moins.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(9);

-- Helpers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_set_jwt_prod(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', 'authenticated',
    'user_role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Fixture ---------------------------------------------------------------------
-- G  = gestionnaire_lieux rattaché au lieu L_IN (et à lui seul)
-- TA = traiteur AVEC coefficient 0.1500 · TS = traiteur SANS aucun coefficient
-- TZ = traiteur déclarant une perte NULLE (coefficient 0.0000)
-- E_AVEC / E_SANS / E_ZERO sur L_IN (dans le périmètre de G)
-- E_HORS = même traiteur TA, mais sur L_OUT (hors périmètre de G)
-- Tous les événements portent pax = 300 : la seule variable est le coefficient.
SELECT test_as_superuser();

INSERT INTO plateforme.organisations
  (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd)
VALUES
  ('dc1a000a-0000-0000-0000-00000000dc1a'::uuid, 'DLB Gest',    'DLB Gest SA',    'gestionnaire_lieux', '88810000000001', true, 0),
  ('dc1a000c-0000-0000-0000-00000000dc1a'::uuid, 'DLB TraitA',  'DLB TraitA SAS', 'traiteur',           '88810000000002', true, 1.50),
  ('dc1a000d-0000-0000-0000-00000000dc1a'::uuid, 'DLB TraitS',  'DLB TraitS SAS', 'traiteur',           '88810000000003', true, 1.50),
  ('dc1a000e-0000-0000-0000-00000000dc1a'::uuid, 'DLB TraitZ',  'DLB TraitZ SAS', 'traiteur',           '88810000000004', true, 1.50);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES
  ('dc1a0a01-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000c-0000-0000-0000-00000000dc1a'::uuid,
   'chef@dlb-traita.test', 'Chef', 'A', 'traiteur_manager', true),
  ('dc1a0a02-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000a-0000-0000-0000-00000000dc1a'::uuid,
   'admin@dlb-savr.test',  'Admin', 'S', 'admin_savr',      true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('dc1aef01-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000c-0000-0000-0000-00000000dc1a'::uuid,
        'DLB TraitA SAS', '88810000000002', '2 rue TraitA', '75002', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES
  ('dc1a1001-0000-0000-0000-00000000dc1a'::uuid, 'DLB Lieu IN',  '3 rue Dedans', '75003', 'Paris', 'camionnette'),
  ('dc1a1002-0000-0000-0000-00000000dc1a'::uuid, 'DLB Lieu OUT', '4 rue Dehors', '75004', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('dc1a000a-0000-0000-0000-00000000dc1a'::uuid, 'dc1a1001-0000-0000-0000-00000000dc1a'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('dc1a7e01-0000-0000-0000-00000000dc1a'::uuid, 'DLB_LABO', 'DLB déchets labo', 1, true);

-- Coefficients : TA en a un, TZ en a un à ZÉRO, TS n'en a aucun (c'est le sujet).
INSERT INTO plateforme.coefficients_perte_labo
  (id, organisation_id, annee_reference, coefficient_kg_couvert, saisi_par)
VALUES
  ('dc1ac001-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000c-0000-0000-0000-00000000dc1a'::uuid,
   2025, 0.1500, 'dc1a0a02-0000-0000-0000-00000000dc1a'::uuid),
  ('dc1ac002-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000e-0000-0000-0000-00000000dc1a'::uuid,
   2025, 0.0000, 'dc1a0a02-0000-0000-0000-00000000dc1a'::uuid);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by,
  lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  -- E_AVEC : traiteur TA (coefficient 0.1500) sur le lieu de G
  ('dc1aee01-0000-0000-0000-00000000dc1a'::uuid,
   'dc1a000c-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000c-0000-0000-0000-00000000dc1a'::uuid,
   'dc1aef01-0000-0000-0000-00000000dc1a'::uuid, 'dc1a0a01-0000-0000-0000-00000000dc1a'::uuid,
   'dc1a1001-0000-0000-0000-00000000dc1a'::uuid, 'dc1a7e01-0000-0000-0000-00000000dc1a'::uuid,
   'DLB Avec coefficient', '2026-06-15', 300, 'Contact', '0600000031'),
  -- E_SANS : traiteur TS (aucun coefficient) sur le lieu de G
  ('dc1aee02-0000-0000-0000-00000000dc1a'::uuid,
   'dc1a000c-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000d-0000-0000-0000-00000000dc1a'::uuid,
   'dc1aef01-0000-0000-0000-00000000dc1a'::uuid, 'dc1a0a01-0000-0000-0000-00000000dc1a'::uuid,
   'dc1a1001-0000-0000-0000-00000000dc1a'::uuid, 'dc1a7e01-0000-0000-0000-00000000dc1a'::uuid,
   'DLB Sans coefficient', '2026-06-16', 300, 'Contact', '0600000032'),
  -- E_ZERO : traiteur TZ (coefficient déclaré à 0) sur le lieu de G
  ('dc1aee03-0000-0000-0000-00000000dc1a'::uuid,
   'dc1a000c-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000e-0000-0000-0000-00000000dc1a'::uuid,
   'dc1aef01-0000-0000-0000-00000000dc1a'::uuid, 'dc1a0a01-0000-0000-0000-00000000dc1a'::uuid,
   'dc1a1001-0000-0000-0000-00000000dc1a'::uuid, 'dc1a7e01-0000-0000-0000-00000000dc1a'::uuid,
   'DLB Coefficient zero', '2026-06-17', 300, 'Contact', '0600000033'),
  -- E_HORS : traiteur TA (donc coefficient présent) mais lieu hors périmètre de G
  ('dc1aee04-0000-0000-0000-00000000dc1a'::uuid,
   'dc1a000c-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000c-0000-0000-0000-00000000dc1a'::uuid,
   'dc1aef01-0000-0000-0000-00000000dc1a'::uuid, 'dc1a0a01-0000-0000-0000-00000000dc1a'::uuid,
   'dc1a1002-0000-0000-0000-00000000dc1a'::uuid, 'dc1a7e01-0000-0000-0000-00000000dc1a'::uuid,
   'DLB Hors perimetre', '2026-06-18', 300, 'Contact', '0600000034');

-- =============================================================================
-- 1-4 — les 3 cas du CDC, vus par le gestionnaire (+ le cas « zéro déclaré »)
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', 'dc1a000a-0000-0000-0000-00000000dc1a'::uuid);

-- 1. Cas nominal : la valeur reste calculée (contrat de T10 de m3_2, conservé).
SELECT is(
  (SELECT plateforme.f_dechets_labo_estimes('dc1aee01-0000-0000-0000-00000000dc1a'::uuid)),
  45.0000::numeric,
  '1. avec coefficient : 300 pax × 0.1500 = 45.0000 kg');

-- 2. LE CAS DU LOT : aucun coefficient communiqué → NULL, plus 0.
SELECT is(
  (SELECT plateforme.f_dechets_labo_estimes('dc1aee02-0000-0000-0000-00000000dc1a'::uuid)),
  NULL::numeric,
  '2. sans coefficient : NULL (et non 0) → l''UI affiche « — », jamais « 0.0 kg »');

-- 3. Coefficient DÉCLARÉ à zéro : 0 kg, distinct de NULL (§05 cas particuliers).
--    C'est ce cas qui rend le retrait du COALESCE nécessaire plutôt que cosmétique :
--    un 0 affiché doit rester une information du traiteur, pas un trou de données.
SELECT is(
  (SELECT plateforme.f_dechets_labo_estimes('dc1aee03-0000-0000-0000-00000000dc1a'::uuid)),
  0.0000::numeric,
  '3. coefficient déclaré à 0 : rend 0 kg — distinct du NULL de « non communiqué »');

-- 4. Hors périmètre : NULL aussi → indistinguable de 2 (aucun oracle créé).
SELECT is(
  (SELECT plateforme.f_dechets_labo_estimes('dc1aee04-0000-0000-0000-00000000dc1a'::uuid)),
  NULL::numeric,
  '4. événement hors périmètre : NULL — même réponse que 2, aucune fuite de périmètre');

-- =============================================================================
-- 5-6 — contre-épreuves de non-vacuité : 2 et 4 ne passent PAS par accident
-- =============================================================================
-- 5. On donne un coefficient à TS : le MÊME événement rend désormais une valeur.
--    Prouve que le NULL de 2 venait du coefficient absent, pas d'un événement
--    invisible ou d'une fixture cassée.
SELECT test_as_superuser();
INSERT INTO plateforme.coefficients_perte_labo
  (id, organisation_id, annee_reference, coefficient_kg_couvert, saisi_par)
VALUES ('dc1ac003-0000-0000-0000-00000000dc1a'::uuid, 'dc1a000d-0000-0000-0000-00000000dc1a'::uuid,
        2025, 0.2000, 'dc1a0a02-0000-0000-0000-00000000dc1a'::uuid);

SELECT test_set_jwt_prod('gestionnaire_lieux', 'dc1a000a-0000-0000-0000-00000000dc1a'::uuid);
SELECT is(
  (SELECT plateforme.f_dechets_labo_estimes('dc1aee02-0000-0000-0000-00000000dc1a'::uuid)),
  60.0000::numeric,
  '5. non-vacuité de 2 : coefficient inséré → le même événement rend 300 × 0.2000 = 60.0000');

-- 6. Le même E_HORS, vu par un staff : la valeur existe. Prouve que le NULL de 4
--    venait de la garde de périmètre, pas d'un coefficient manquant.
SELECT test_set_jwt_prod('admin_savr', NULL);
SELECT is(
  (SELECT plateforme.f_dechets_labo_estimes('dc1aee04-0000-0000-0000-00000000dc1a'::uuid)),
  45.0000::numeric,
  '6. non-vacuité de 4 : le staff obtient 45.0000 sur le même événement');

-- =============================================================================
-- 7-9 — propriétés de sécurité que CREATE OR REPLACE peut défaire en silence
-- =============================================================================
SELECT test_as_superuser();

-- 7. SECURITY DEFINER conservé (sans lui, la lecture de coefficients_perte_labo
--    échouerait sous RLS et le gestionnaire ne verrait plus rien).
SELECT is(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_dechets_labo_estimes'),
  true,
  '7. SECURITY DEFINER conservé');

-- 8. search_path toujours verrouillé — `CREATE OR REPLACE` REMPLACE proconfig :
--    sans le SET explicite, le durcissement CWE-426 de 20260622140000 sautait.
SELECT ok(
  (SELECT 'search_path=plateforme, pg_catalog' = ANY(coalesce(p.proconfig, '{}'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_dechets_labo_estimes'),
  '8. search_path = plateforme, pg_catalog toujours verrouillé sur la fonction');

-- 9. ACL inchangée — ni ouverte, ni fermée par ce lot. On compare l'ENSEMBLE
--    des grantees, pas un booléen par rôle : `has_function_privilege('authenticated',
--    …)` répond `true` via le grant PUBLIC hérité du CREATE FUNCTION, donc il
--    reste VERT après un `REVOKE … FROM authenticated` comme après un
--    `GRANT … TO <autre rôle>` — il ne mord dans aucun sens (mesuré, revue
--    sécurité 2026-09-21). L'égalité d'ensemble mord des deux côtés.
--    ⚠ La présence de PUBLIC est PRÉEXISTANTE (EXECUTE implicite du CREATE
--    FUNCTION de 20260611180000, jamais révoqué ; 20260903130000 a laissé cette
--    fonction exécutable par arbitrage, garde de rôle interne). Elle est figée
--    ici en l'état pour que ce lot prouve « rien n'a bougé » — la refermer est
--    un autre lot, qui devra mettre cette attente à jour sciemment.
SELECT is(
  (SELECT string_agg(DISTINCT coalesce(r.rolname, 'PUBLIC'), ','
                     ORDER BY coalesce(r.rolname, 'PUBLIC'))
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL aclexplode(p.proacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'plateforme'
      AND p.proname = 'f_dechets_labo_estimes'
      AND a.privilege_type = 'EXECUTE'),
  'PUBLIC,anon,authenticated,postgres,service_role',
  '9. ensemble des grantees EXECUTE inchangé (ni ouvert, ni fermé par ce lot)');

SELECT * FROM finish();
ROLLBACK;
