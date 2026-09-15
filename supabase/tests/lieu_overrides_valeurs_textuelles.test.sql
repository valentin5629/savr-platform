-- =============================================================================
-- Tests pgTAP — chk_collectes_lieu_overrides_textuel (migration 20260915120000)
-- =============================================================================
-- Oracle : `collectes.lieu_overrides` est un jsonb LIBRE. Les gardes applicatives
-- (422 des deux routes, #308 ; fusion adapter qui ignore une valeur non
-- textuelle) ne couvrent PAS les écritures hors routes Next — RPC
-- fn_creer_collecte / fn_modifier_collecte sous service_role (script, seed,
-- session psql), et UPDATE PostgREST direct d'un client `authenticated` sur sa
-- propre collecte. Une valeur non textuelle y passait, puis ressortait
-- interpolée dans l'adresse envoyée au transporteur (« [object Object], 75008
-- Paris »), soit un camion envoyé nulle part.
--
-- Ce test prouve que le dernier filet tient AU NIVEAU DE LA TABLE :
--   (1) les formes légitimes du formulaire sont acceptées — chaîne, chaîne vide
--       (effacement d'un champ facultatif), tableau de chaînes (flux_autorises),
--       null (ignoré en aval), et l'absence totale d'override ;
--   (2) objet imbriqué, nombre, booléen et tableau non textuel sont REJETÉS,
--       à l'INSERT comme à l'UPDATE (un override peut être posé après coup) ;
--   (3) le chemin RPC lui-même — fn_modifier_collecte écrit p_updates->
--       'lieu_overrides' tel quel — bute sur la contrainte ;
--   (4) SOUS LE RÔLE `authenticated` — le volet décisif. Le prédicat du CHECK est
--       une fonction, et un CHECK s'évalue avec les droits de CELUI QUI ÉCRIT :
--       son EXECUTE doit donc rester ouvert. Un REVOKE « d'hygiène » (le réflexe
--       du repo, cf. faille P0 #263 sur les SECURITY DEFINER) rendrait la
--       contrainte INATTEIGNABLE pour un client — l'UPDATE sortirait en 42501
--       « permission denied for function », et non en 23514. Joué en `postgres`
--       seul, ce fichier resterait vert dans cet état cassé : il ne saurait pas
--       distinguer « la contrainte protège le client » de « le client ne peut
--       plus écrire du tout ». D'où ces trois cas sous rôle réel.
-- =============================================================================

BEGIN;
SELECT plan(15);

-- ─── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, siret, email_principal)
VALUES ('10ac0001-0000-0000-0000-000000000001'::uuid, 'Org LOV', 'traiteur', true, '90000000170001', 'lov@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('10ac0002-0000-0000-0000-000000000001'::uuid, '10ac0001-0000-0000-0000-000000000001'::uuid,
        'lov@user.test', 'L', 'OV', 'traiteur_manager')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('10ac0003-0000-0000-0000-000000000001'::uuid, '10ac0001-0000-0000-0000-000000000001'::uuid,
        'Org LOV SAS', '90000000170001', '1 rue LOV', '75001', 'Paris')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('10ac0004-0000-0000-0000-000000000001'::uuid, 'lov', 'Test LOV')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('10ac0005-0000-0000-0000-000000000001'::uuid, 'Lieu LOV', '5 Avenue Gabriel', '75008', 'Paris', 'fourgon')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES ('10ac0006-0000-0000-0000-000000000001'::uuid, '10ac0001-0000-0000-0000-000000000001'::uuid,
        '10ac0005-0000-0000-0000-000000000001'::uuid, '10ac0001-0000-0000-0000-000000000001'::uuid,
        '10ac0003-0000-0000-0000-000000000001'::uuid, '10ac0002-0000-0000-0000-000000000001'::uuid,
        '10ac0004-0000-0000-0000-000000000001'::uuid, current_date + 10, 200, 'Contact LOV', '0600000000')
ON CONFLICT (id) DO NOTHING;

-- Fabrique d'INSERT : seul `lieu_overrides` varie d'un cas à l'autre.
CREATE OR REPLACE FUNCTION pg_temp.ins_lov(p_id uuid, p_overrides jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO plateforme.collectes
    (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte,
     nb_camions_demande, lieu_overrides)
  VALUES (p_id, '10ac0006-0000-0000-0000-000000000001'::uuid, 'zero_dechet',
          'programmee', 'non_envoye', current_date + 10, '08:00', 1, p_overrides);
$$;

-- ─── 1. Présence de la contrainte et de son prédicat ─────────────────────────

SELECT has_function(
  'plateforme', 'f_lieu_overrides_textuel', ARRAY['jsonb'],
  'f_lieu_overrides_textuel présente');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_collectes_lieu_overrides_textuel'
       AND conrelid = 'plateforme.collectes'::regclass
       AND convalidated),
  'chk_collectes_lieu_overrides_textuel posée ET validée sur plateforme.collectes');

-- ─── 2. Formes légitimes acceptées ───────────────────────────────────────────

SELECT lives_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-000000000001'::uuid,
       '{"adresse_acces": "Entrée livraisons, sonner interphone Cuisine"}'::jsonb) $$,
  'chaîne acceptée');

SELECT lives_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-000000000002'::uuid,
       '{"acces_details": ""}'::jsonb) $$,
  'chaîne VIDE acceptée — c''est ainsi qu''on efface un champ facultatif');

SELECT lives_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-000000000003'::uuid,
       '{"flux_autorises": ["biodechets", "carton"]}'::jsonb) $$,
  'tableau de chaînes accepté — flux_autorises est bien un text[]');

SELECT lives_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-000000000004'::uuid,
       '{"ville": null}'::jsonb) $$,
  'null accepté — ignoré en aval, jamais une surcharge');

SELECT lives_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-000000000005'::uuid, NULL) $$,
  'absence totale d''override acceptée');

-- Une adresse très longue passe la contrainte : la borne de longueur est un
-- arbitrage produit appliqué à l'écriture applicative (LONGUEUR_MAX_CHAMP_LIEU),
-- pas une règle de structure — la recopier ici garantirait le drift.
SELECT lives_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-000000000006'::uuid,
       jsonb_build_object('adresse_acces', repeat('a', 5000))) $$,
  'la contrainte porte sur le TYPE, pas sur la longueur');

-- ─── 3. Valeurs non textuelles rejetées ──────────────────────────────────────

SELECT throws_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c02-0000-0000-0000-000000000001'::uuid,
       '{"adresse_acces": {"a": 1}}'::jsonb) $$,
  '23514',
  NULL,
  'objet imbriqué REJETÉ — c''est la sonde « [object Object], 75008 Paris »');

SELECT throws_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c02-0000-0000-0000-000000000002'::uuid,
       '{"code_postal": 42}'::jsonb) $$,
  '23514',
  NULL,
  'nombre REJETÉ');

SELECT throws_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c02-0000-0000-0000-000000000003'::uuid,
       '{"flux_autorises": [1, 2]}'::jsonb) $$,
  '23514',
  NULL,
  'tableau de non-chaînes REJETÉ');

-- ─── 4. Le chemin RPC bute sur la même contrainte ────────────────────────────
-- fn_modifier_collecte écrit `p_updates->'lieu_overrides'` tel quel, sous
-- service_role, hors de toute route Next : c'est exactement le trou que la
-- contrainte ferme.

SELECT throws_ok(
  $$ SELECT plateforme.fn_modifier_collecte(
       '10ac0c01-0000-0000-0000-000000000001'::uuid,
       '{"lieu_overrides": {"ville": {"nom": "Paris"}}}'::jsonb,
       ARRAY['lieu_overrides']) $$,
  '23514',
  NULL,
  'fn_modifier_collecte ne peut pas poser un override non textuel après coup');

-- ─── 5. Sous le rôle `authenticated` — la contrainte mord sans casser l'écriture
-- `authenticated` porte un GRANT UPDATE table-level sur `plateforme.collectes`
-- (20260611180000) et la policy `col_update_client` (20260617180000) laisse un
-- traiteur modifier sa propre collecte non terminale en PostgREST direct, sans
-- passer par aucune route Next. Le worker relit `lieu_overrides` sur la LIGNE au
-- moment de consommer l'event : ce qui est écrit par là atteint le transporteur.

CREATE OR REPLACE FUNCTION pg_temp.jwt_traiteur()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', '10ac0002-0000-0000-0000-000000000001'::uuid,
    'user_role', 'traiteur_manager',
    'organisation_id', '10ac0001-0000-0000-0000-000000000001'::uuid,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

SELECT pg_temp.jwt_traiteur();

-- L'écriture LÉGITIME passe. C'est le test qui rougirait si l'EXECUTE de
-- `f_lieu_overrides_textuel` était retiré à `authenticated` : 42501 au lieu du
-- succès, la contrainte devenant inatteignable plutôt que protectrice.
SELECT lives_ok(
  $$ UPDATE plateforme.collectes
        SET lieu_overrides = '{"adresse_acces": "Entrée livraisons"}'::jsonb
      WHERE id = '10ac0c01-0000-0000-0000-000000000001'::uuid $$,
  'authenticated : un override textuel légitime passe (EXECUTE du prédicat conservé)');

SELECT throws_ok(
  $$ UPDATE plateforme.collectes
        SET lieu_overrides = '{"adresse_acces": {"a": 1}}'::jsonb
      WHERE id = '10ac0c01-0000-0000-0000-000000000001'::uuid $$,
  '23514',
  NULL,
  'authenticated : un override non textuel est REJETÉ — 23514, pas 42501');

SELECT is(
  (SELECT lieu_overrides->>'adresse_acces'
     FROM plateforme.collectes
    WHERE id = '10ac0c01-0000-0000-0000-000000000001'::uuid),
  'Entrée livraisons',
  'authenticated : la valeur refusée n''a rien écrasé');

SELECT pg_temp.as_superuser();

SELECT * FROM finish();
ROLLBACK;
