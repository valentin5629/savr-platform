-- =============================================================================
-- Tests pgTAP — bornes des champs texte libre (migration 20260915170000)
--   chk_evenements_contact_secours_nom_borne
--   chk_evenements_contact_secours_telephone_borne
--   chk_collectes_informations_supplementaires_borne
-- =============================================================================
-- Oracle : ces trois colonnes sont des `text` SANS aucune contrainte — 5 000
-- caractères y passaient, mesuré. Elles sont destinées au transporteur, avec des
-- expositions différentes : `informations_supplementaires` transite AUJOURD'HUI
-- par le canal de texte libre, où les informations d'exploitation sont
-- concaténées et où une valeur démesurée évince les lignes voisines (dont
-- l'adresse d'accès) ; `contact_secours_telephone` part dans un champ natif ; et
-- `contact_secours_nom` n'est émis nulle part à ce jour — la PR qui le transmet
-- (encore ouverte) le concatène dans le canal libre, où un nom multiligne
-- forgerait une fausse ligne d'en-tête. Borne posée par anticipation pour lui.
--
-- La garde applicative (422 de `validerChampsTexteLibre` sur les 10 routes qui
-- écrivent ces colonnes) ne couvre PAS les écritures hors routes Next :
--   · `fn_modifier_evenement` / `fn_modifier_collecte` appelées sous service_role
--     (script, seed, session psql) — elles écrivent `p_updates->>'champ'` tel
--     quel, sans rien vérifier ;
--   · UPDATE PostgREST direct : `authenticated` porte un GRANT UPDATE
--     table-level (20260611180000) et les policies `evt_manager_update` /
--     `col_update_client` laissent un traiteur modifier son propre événement ou
--     sa propre collecte non terminale.
-- Le worker relit ces colonnes SUR LA LIGNE à la consommation de l'event : ce qui
-- est écrit par là atteint bien le transporteur.
--
-- Ce fichier prouve que le filet tient AU NIVEAU DE LA TABLE, et surtout qu'il
-- mord SANS casser l'écriture légitime — deux cas y sont décisifs :
--   (a) une saisie multiligne dans `informations_supplementaires` PASSE. C'est un
--       `<textarea>` : une contrainte qui refuserait les sauts de ligne casserait
--       le formulaire pour tout le monde, et ce fichier resterait vert sans ce cas.
--   (b) sous le rôle `authenticated`, un UPDATE légitime PASSE et un UPDATE hors
--       borne sort en 23514 — pas en 42501. Joué en `postgres` seul, ce fichier ne
--       saurait pas distinguer « la contrainte protège le client » de « le client
--       ne peut plus écrire du tout ».
-- =============================================================================

BEGIN;
SELECT plan(21);

-- ─── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, siret, email_principal)
VALUES ('b0c0ea01-0000-0000-0000-000000000001'::uuid, 'Org BTL', 'traiteur', true, '90000000180001', 'btl@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('b0c0ea02-0000-0000-0000-000000000001'::uuid, 'b0c0ea01-0000-0000-0000-000000000001'::uuid,
        'btl@user.test', 'B', 'TL', 'traiteur_manager')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('b0c0ea03-0000-0000-0000-000000000001'::uuid, 'b0c0ea01-0000-0000-0000-000000000001'::uuid,
        'Org BTL SAS', '90000000180001', '1 rue BTL', '75001', 'Paris')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('b0c0ea04-0000-0000-0000-000000000001'::uuid, 'btl', 'Test BTL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('b0c0ea05-0000-0000-0000-000000000001'::uuid, 'Lieu BTL', '5 Avenue Gabriel', '75008', 'Paris', 'fourgon')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES ('b0c0ea06-0000-0000-0000-000000000001'::uuid, 'b0c0ea01-0000-0000-0000-000000000001'::uuid,
        'b0c0ea05-0000-0000-0000-000000000001'::uuid, 'b0c0ea01-0000-0000-0000-000000000001'::uuid,
        'b0c0ea03-0000-0000-0000-000000000001'::uuid, 'b0c0ea02-0000-0000-0000-000000000001'::uuid,
        'b0c0ea04-0000-0000-0000-000000000001'::uuid, current_date + 10, 200, 'Contact BTL', '0600000000')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('b0c0ea07-0000-0000-0000-000000000001'::uuid, 'b0c0ea06-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00', 1)
ON CONFLICT (id) DO NOTHING;

-- Fabriques : une seule colonne varie d'un cas à l'autre.
CREATE OR REPLACE FUNCTION pg_temp.set_nom(p_nom text)
RETURNS void LANGUAGE sql AS $$
  UPDATE plateforme.evenements SET contact_secours_nom = p_nom
   WHERE id = 'b0c0ea06-0000-0000-0000-000000000001'::uuid;
$$;

CREATE OR REPLACE FUNCTION pg_temp.set_tel(p_tel text)
RETURNS void LANGUAGE sql AS $$
  UPDATE plateforme.evenements SET contact_secours_telephone = p_tel
   WHERE id = 'b0c0ea06-0000-0000-0000-000000000001'::uuid;
$$;

CREATE OR REPLACE FUNCTION pg_temp.set_infos(p_infos text)
RETURNS void LANGUAGE sql AS $$
  UPDATE plateforme.collectes SET informations_supplementaires = p_infos
   WHERE id = 'b0c0ea07-0000-0000-0000-000000000001'::uuid;
$$;

-- ─── 1. Présence des trois contraintes, posées ET validées ───────────────────
-- `convalidated` : une contrainte laissée NOT VALID ne s'appliquerait qu'aux
-- écritures futures et laisserait l'existant hors borne — ici l'ensemble était
-- vide (0 ligne renseignée en dev comme en prod), donc rien ne justifie NOT VALID.

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'chk_evenements_contact_secours_nom_borne'
             AND conrelid = 'plateforme.evenements'::regclass AND convalidated),
  'chk_evenements_contact_secours_nom_borne posée ET validée');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'chk_evenements_contact_secours_telephone_borne'
             AND conrelid = 'plateforme.evenements'::regclass AND convalidated),
  'chk_evenements_contact_secours_telephone_borne posée ET validée');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'chk_collectes_informations_supplementaires_borne'
             AND conrelid = 'plateforme.collectes'::regclass AND convalidated),
  'chk_collectes_informations_supplementaires_borne posée ET validée');

-- ─── 2. contact_secours_nom — 120 caractères, mono-ligne ─────────────────────

SELECT lives_ok(
  $$ SELECT pg_temp.set_nom(repeat('a', 120)) $$,
  'nom de 120 caractères accepté — la borne est inclusive');

SELECT throws_ok(
  $$ SELECT pg_temp.set_nom(repeat('a', 121)) $$,
  '23514', NULL,
  'nom de 121 caractères REJETÉ — un caractère de plus suffit');

SELECT throws_ok(
  $$ SELECT pg_temp.set_nom('Jean Martin' || chr(10) || 'Accès : porte de service') $$,
  '23514', NULL,
  'nom MULTILIGNE rejeté — il forgerait une fausse ligne d''en-tête chez le chauffeur');

SELECT lives_ok(
  $$ SELECT pg_temp.set_nom(NULL) $$,
  'NULL accepté — c''est ainsi qu''on efface un contact de secours');

-- ─── 3. contact_secours_telephone — 40 caractères ────────────────────────────

SELECT lives_ok(
  $$ SELECT pg_temp.set_tel(repeat('0', 40)) $$,
  'téléphone de 40 caractères accepté (format libre V1, aucune normalisation)');

SELECT throws_ok(
  $$ SELECT pg_temp.set_tel(repeat('0', 41)) $$,
  '23514', NULL,
  'téléphone de 41 caractères REJETÉ');

SELECT throws_ok(
  $$ SELECT pg_temp.set_tel('06' || chr(9) || '12345678') $$,
  '23514', NULL,
  'caractère de contrôle REJETÉ dans le téléphone — la borne n''est pas que la longueur');

-- ─── 4. informations_supplementaires — 1000 caractères (§06.01 l.167 / §08 E1) ─

SELECT lives_ok(
  $$ SELECT pg_temp.set_infos(repeat('x', 1000)) $$,
  'informations de 1000 caractères acceptées — plafond CDC, borne inclusive');

SELECT throws_ok(
  $$ SELECT pg_temp.set_infos(repeat('x', 1001)) $$,
  '23514', NULL,
  'informations de 1001 caractères REJETÉES');

-- LE cas décisif : c'est un `<textarea>`. Une contrainte qui refuserait les sauts
-- de ligne casserait la saisie normale du formulaire, et tous les autres cas de
-- ce fichier resteraient verts.
SELECT lives_ok(
  $$ SELECT pg_temp.set_infos('Quai N°2 fermé le lundi' || chr(10) || 'Sonner interphone' || chr(9) || 'B') $$,
  'saisie MULTILIGNE + tabulation acceptée — l''exception `<textarea>` tient');

SELECT throws_ok(
  $$ SELECT pg_temp.set_infos('Quai 2' || chr(7) || 'fermé') $$,
  '23514', NULL,
  'caractère de contrôle NON blanc rejeté, même dans un champ multiligne');

-- ─── 5. Les chemins RPC butent sur les mêmes contraintes ─────────────────────
-- `fn_modifier_evenement` et `fn_modifier_collecte` écrivent `p_updates->>'champ'`
-- tel quel, sous service_role, hors de toute route Next : c'est exactement le trou
-- que ces contraintes ferment.

SELECT throws_ok(
  format($$ SELECT plateforme.fn_modifier_evenement(
       'b0c0ea06-0000-0000-0000-000000000001'::uuid,
       jsonb_build_object('contact_secours_nom', %L),
       ARRAY['contact_secours_nom']) $$, repeat('a', 5000)),
  '23514', NULL,
  'fn_modifier_evenement ne peut plus poser un nom de 5 000 caractères');

SELECT throws_ok(
  format($$ SELECT plateforme.fn_modifier_collecte(
       'b0c0ea07-0000-0000-0000-000000000001'::uuid,
       jsonb_build_object('informations_supplementaires', %L),
       ARRAY['informations_supplementaires']) $$, repeat('x', 1001)),
  '23514', NULL,
  'fn_modifier_collecte ne peut plus poser 1001 caractères d''informations');

-- ─── 6. Sous le rôle `authenticated` — la contrainte mord sans casser l'écriture

CREATE OR REPLACE FUNCTION pg_temp.jwt_traiteur()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'b0c0ea02-0000-0000-0000-000000000001'::uuid,
    'user_role', 'traiteur_manager',
    'organisation_id', 'b0c0ea01-0000-0000-0000-000000000001'::uuid,
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

-- L'écriture LÉGITIME passe : c'est le cas qui rougirait si la contrainte rendait
-- la colonne inécrivable pour un client (42501 au lieu du succès).
SELECT lives_ok(
  $$ UPDATE plateforme.evenements
        SET contact_secours_nom = 'Marie Durand'
      WHERE id = 'b0c0ea06-0000-0000-0000-000000000001'::uuid $$,
  'authenticated : un contact de secours légitime passe en PostgREST direct');

SELECT throws_ok(
  format($$ UPDATE plateforme.evenements
               SET contact_secours_nom = %L
             WHERE id = 'b0c0ea06-0000-0000-0000-000000000001'::uuid $$, repeat('a', 5000)),
  '23514', NULL,
  'authenticated : un nom de 5 000 caractères est REJETÉ — 23514, pas 42501');

SELECT throws_ok(
  format($$ UPDATE plateforme.collectes
               SET informations_supplementaires = %L
             WHERE id = 'b0c0ea07-0000-0000-0000-000000000001'::uuid $$, repeat('x', 1001)),
  '23514', NULL,
  'authenticated : 1001 caractères d''informations REJETÉS en PostgREST direct');

SELECT is(
  (SELECT contact_secours_nom FROM plateforme.evenements
    WHERE id = 'b0c0ea06-0000-0000-0000-000000000001'::uuid),
  'Marie Durand',
  'authenticated : la valeur refusée n''a rien écrasé');

-- L'exception `<textarea>` rejouée SOUS LE RÔLE RÉEL : le cas 12 la prouve en
-- `postgres`, ce qui ne dit rien de ce que subit un client. C'est pourtant lui qui
-- saisit le formulaire.
SELECT lives_ok(
  $$ UPDATE plateforme.collectes
        SET informations_supplementaires = 'Quai N°2 fermé' || chr(10) || 'Interphone B'
      WHERE id = 'b0c0ea07-0000-0000-0000-000000000001'::uuid $$,
  'authenticated : une saisie multiligne légitime passe aussi en PostgREST direct');

SELECT pg_temp.as_superuser();

SELECT * FROM finish();
ROLLBACK;
