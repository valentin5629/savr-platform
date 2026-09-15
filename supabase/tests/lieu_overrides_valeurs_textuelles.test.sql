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
SELECT plan(17);

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

-- RECALÉ par 20260915140000 : la seconde contrainte
-- `collectes_lieu_overrides_valide_chk` connaît les CLÉS, et refuse `null` sur les
-- trois champs NOT NULL de `plateforme.lieux` (`adresse_acces`, `code_postal`,
-- `ville`) — un override qui efface l'adresse produit exactement l'adresse
-- impossible que tout ceci cherche à empêcher. `null` reste accepté sur les champs
-- FACULTATIFS (cas suivant) : c'est là qu'il veut dire « pas de surcharge ».
-- La route le refusait déjà (#308, `obligatoire: true`) ; la base s'aligne.
SELECT throws_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-000000000004'::uuid,
       '{"ville": null}'::jsonb) $$,
  '23514', NULL,
  'null REFUSÉ sur un champ obligatoire — effacer l''adresse n''est pas une surcharge');

SELECT lives_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-00000000000a'::uuid,
       '{"acces_details": null}'::jsonb) $$,
  'null accepté sur un champ facultatif — ignoré en aval, jamais une surcharge');

SELECT lives_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-000000000005'::uuid, NULL) $$,
  'absence totale d''override acceptée');

-- RECALÉ par 20260915140000. Ce cas documentait une décision de conception —
-- « la base borne la STRUCTURE, l'applicatif borne les VALEURS », pour éviter le
-- drift entre deux jeux de bornes. L'arbitrage Val du 2026-09-15 a tranché
-- l'inverse : les bornes sont AUSSI en base, parce que la validation applicative
-- est contournable et que `fetchCollecte` relit la ligne courante.
--
-- ⚠ Le risque de drift nommé ici était réel et s'est matérialisé une fois : le
-- CHECK s'appuie sur `[[:cntrl:]]`, qui couvre C1 (U+0080-U+009F), quand le filtre
-- applicatif s'arrêtait à C0+DEL — un U+0085 sortait en 500 au lieu de 422
-- (corrigé dans le même lot). Le sens du drift importe : applicatif PLUS strict
-- que la base est sans conséquence, l'inverse produit un 500. C'est `[[:cntrl:]]`
-- qui fait foi.
SELECT throws_ok(
  $$ SELECT pg_temp.ins_lov('10ac0c01-0000-0000-0000-000000000006'::uuid,
       jsonb_build_object('adresse_acces', repeat('a', 5000))) $$,
  '23514', NULL,
  'la borne de longueur est AUSSI en base (arbitrage Val 2026-09-15)');

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

-- ─── 5. Sous un rôle NON-superuser — la contrainte mord sans casser l'écriture
-- RECALÉ par 20260915140000. Ce volet visait `authenticated`, qui portait alors un
-- GRANT UPDATE table-level sur `plateforme.collectes` (20260611180000) + la policy
-- `col_update_client` (20260617180000) : un traiteur pouvait modifier sa collecte
-- en PostgREST direct. Ce chemin est FERMÉ (REVOKE UPDATE, INSERT) — on l'asserte
-- désormais en 42501 plus bas, et le détail par rôle vit dans
-- SECU__collectes_ecriture_client_fermee.test.sql.
--
-- Le cliquet, lui, garde tout son sens et migre sur `service_role` : c'est le rôle
-- sous lequel les routes API écrivent réellement, et il n'est PAS superuser
-- (`rolsuper = false`, seulement `rolbypassrls`) — un REVOKE « d'hygiène » sur
-- l'EXECUTE du prédicat le ferait donc bien rougir en 42501, ce qu'un run sous
-- `postgres` ne verrait jamais. C'est exactement le faux-vert que ce volet existe
-- pour attraper ; seul le rôle change, pas la propriété prouvée.

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

-- Le chemin que ce volet exerçait est désormais fermé au client : c'est le
-- privilège qui refuse, avant même d'atteindre la contrainte.
SELECT pg_temp.jwt_traiteur();

SELECT throws_ok(
  $$ UPDATE plateforme.collectes
        SET lieu_overrides = '{"adresse_acces": "Entrée livraisons"}'::jsonb
      WHERE id = '10ac0c01-0000-0000-0000-000000000001'::uuid $$,
  '42501', NULL,
  'authenticated : l''UPDATE PostgREST direct est refusé par le privilège (20260915140000)');

SELECT pg_temp.as_superuser();

-- Le cliquet EXECUTE, reporté sur le rôle qui écrit vraiment.
SET LOCAL ROLE service_role;

-- L'écriture LÉGITIME passe. C'est l'assertion qui rougirait si l'EXECUTE de
-- `f_lieu_overrides_textuel` (ou de `f_lieu_overrides_valide`) était retiré :
-- 42501 au lieu du succès, la contrainte devenant inatteignable plutôt que
-- protectrice.
SELECT lives_ok(
  $$ UPDATE plateforme.collectes
        SET lieu_overrides = '{"adresse_acces": "Entrée livraisons"}'::jsonb
      WHERE id = '10ac0c01-0000-0000-0000-000000000001'::uuid $$,
  'service_role : un override textuel légitime passe (EXECUTE des prédicats conservé)');

SELECT throws_ok(
  $$ UPDATE plateforme.collectes
        SET lieu_overrides = '{"adresse_acces": {"a": 1}}'::jsonb
      WHERE id = '10ac0c01-0000-0000-0000-000000000001'::uuid $$,
  '23514',
  NULL,
  'service_role : un override non textuel est REJETÉ — 23514, pas 42501');

SELECT is(
  (SELECT lieu_overrides->>'adresse_acces'
     FROM plateforme.collectes
    WHERE id = '10ac0c01-0000-0000-0000-000000000001'::uuid),
  'Entrée livraisons',
  'service_role : la valeur refusée n''a rien écrasé');

RESET ROLE;
SELECT pg_temp.as_superuser();

SELECT * FROM finish();
ROLLBACK;
