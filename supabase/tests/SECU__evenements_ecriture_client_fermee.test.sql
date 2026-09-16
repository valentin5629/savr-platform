-- =============================================================================
-- SÉCURITÉ — écriture PostgREST directe de `plateforme.evenements` fermée aux
-- clients + bornes EN BASE des deux contacts PRINCIPAUX (les deux contacts de
-- SECOURS l'ont été par #322, `20260915180000` ; ce fichier ne les re-teste pas —
-- voir `bornes_texte_libre.test.sql`).
--
-- Migration prouvée : 20260915190000_plateforme_evenements_ecriture_client_fermee.
-- (renumérotée depuis 20260915170000 : #322 a atterri sur `main` pendant ce lot avec
-- la migration 20260915180000 — une migration au timestamp ANTÉRIEUR serait sautée
-- par `supabase db push`.)
-- Suite de #318, qui a fermé `collectes` sans toucher `evenements` (revue sécurité
-- de la PR « contact de secours », 2026-09-15). CLAUDE.md §12 pt 2bis.
--
-- ⚠ Tout se joue SOUS RÔLE `authenticated` (test_set_jwt pose `role`) : sous
-- service_role ou via le MCP Supabase, la RLS est bypassée ET les privilèges sont
-- ceux d'un autre rôle — le test passerait au vert quoi qu'il arrive. Les refus
-- attendus sont des 42501 (insufficient_privilege), levés AVANT même l'évaluation
-- RLS : c'est le privilège qui ferme, pas la policy.
--
-- Le CHECK, lui, s'applique à TOUT écrivain (service_role inclus) — il est donc
-- exercé sous superuser, ce qui est ici le cas le plus exigeant : c'est le seul
-- verrou qui couvre le trou réellement atteignable par un utilisateur nominal
-- (un nom de 5 000 caractères saisi dans le formulaire).
--
-- CONTRE-ÉPREUVES (base jetable, 133 migrations rejouées sur base vierge) — chaque
-- verrou est porté par un sous-ensemble DISJOINT, aucun cas n'est vacant :
--   • sans le REVOKE (GRANT ré-accordé)      : 11 rouges = A1 A2 A3 A5 + B1-B7.
--   • sans les DEUX CHECK de ce lot (droppés) :  8 rouges = C1 C2 C3 C5 C6 C7 C8 C9.
--     C4 reste VERT, et c'est voulu : il porte sur la borne du téléphone de SECOURS,
--     posée par #322 — dropper les contraintes de ce lot ne la touche pas.
--   • dans les deux cas, C10-C13 (non-vacuité), B8 (lecture) et D1-D3 restent verts.
-- ⚠ B1 est le seul cas couvert par les DEUX verrous (le vecteur du brief est à la
-- fois hors privilège et hors bornes) : il rougit sur la contre-épreuve A avec un
-- 23514 au lieu du 42501 attendu. La fermeture par privilège seule est prouvée par
-- B2-B7, dont les valeurs sont toutes DANS les bornes.
-- =============================================================================

BEGIN;
SELECT plan(31);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Helpers JWT (cf. SECU__collectes_ecriture_client_fermee) ─────────────────
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

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- UUID/SIRET improbables pour ne pas collisionner avec une seed existante.
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('5e4e0000-0000-0000-0000-000000000001'::uuid, 'Traiteur EVT', 'traiteur', true, false, '5E4E0000000001', 'evt-t@test.internal'),
  ('5e4e0000-0000-0000-0000-000000000002'::uuid, 'Agence EVT', 'agence', true, false, '5E4E0000000002', 'evt-a@test.internal'),
  ('5e4e0000-0000-0000-0000-000000000003'::uuid, 'Gestionnaire EVT', 'gestionnaire_lieux', true, false, '5E4E0000000003', 'evt-g@test.internal');

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('5e4e0000-0000-0000-0000-00000000007e'::uuid, 'cocktail_evt', 'Cocktail EVT');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('5e4e0000-0000-0000-0000-0000000000a1'::uuid, '5e4e0000-0000-0000-0000-000000000001'::uuid, 'mgr@evt.test', 'Mgr', 'Evt', 'traiteur_manager'),
  ('5e4e0000-0000-0000-0000-0000000000a2'::uuid, '5e4e0000-0000-0000-0000-000000000001'::uuid, 'com@evt.test', 'Com', 'Evt', 'traiteur_commercial'),
  ('5e4e0000-0000-0000-0000-0000000000a3'::uuid, '5e4e0000-0000-0000-0000-000000000002'::uuid, 'ag@evt.test', 'Ag', 'Evt', 'agence'),
  ('5e4e0000-0000-0000-0000-0000000000a4'::uuid, '5e4e0000-0000-0000-0000-000000000003'::uuid, 'ges@evt.test', 'Ges', 'Evt', 'gestionnaire_lieux');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('5e4e0000-0000-0000-0000-0000000000f0'::uuid, '5e4e0000-0000-0000-0000-000000000001'::uuid, 'Traiteur EVT SARL', '5E4E0000000001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('5e4e0000-0000-0000-0000-00000000011e'::uuid, 'Salle EVT', '1 rue', '75001', 'Paris', 'fourgon');

INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut) VALUES
  ('5e4e0000-0000-0000-0000-0000000000d0'::uuid, 'Presta EVT', 'EVTSECU', ARRAY['zd','ag'], 'manuel', 'actif');

-- Le transporteur qui porte ce prestataire. Depuis #327, le gate d'émission E2
-- (`fn_collecte_commandee_chez_provider`) ne tient une collecte pour commandée
-- que si le prestataire de la collecte ET celui de sa tournée résolvent, via
-- leur transporteur, au MÊME `type_tms`. Sans ce rattachement — qu'un dispatch
-- réel ne laisse jamais absent —, D2 n'émet rien et D3 devient vacuous.
INSERT INTO plateforme.transporteurs (
  id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
  code_transporteur_mts1, contact_nom, contact_email, contact_telephone,
  prestataire_logistique_id
) VALUES (
  '5e4e0000-0000-0000-0000-0000000000d1'::uuid, 'Transporteur EVT', '999000555',
  '1 rue', '75001', 'Paris', ARRAY['fourgon'], 'mts1', 'EVTSECU-CODE',
  'Ops EVT', 'ops-evt@test.internal', '0600000000',
  '5e4e0000-0000-0000-0000-0000000000d0'::uuid
);

-- Un événement par rôle testé, chacun DANS le périmètre de son rôle : la RLS
-- (evt_manager_update / evt_agence_update / evt_gestionnaire_update /
-- evt_commercial_update) l'AUTORISERAIT. Le refus attendu ne peut donc venir que
-- du privilège retiré — c'est le point.
--
-- ⚠ PIÈGE DE LECTURE : les trois événements portent volontairement
-- `traiteur_operationnel_organisation_id` = l'org du traiteur. Ce fichier ne
-- prouve RIEN sur le cloisonnement inter-organisations (qui vit dans
-- rls_0_4_smoke T10 et m3_2_gestionnaire_lieux T1-T3) : il porte sur la fermeture
-- par privilège et sur les bornes de colonnes.
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone, reference_affaire
) VALUES
  ('5e4e0000-0000-0000-0000-0000000000e1'::uuid, '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-00000000011e'::uuid, '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-0000000000f0'::uuid, '5e4e0000-0000-0000-0000-0000000000a2'::uuid, '5e4e0000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 100, 'Alice', '0601', 'evt-T'),
  ('5e4e0000-0000-0000-0000-0000000000e2'::uuid, '5e4e0000-0000-0000-0000-000000000002'::uuid, '5e4e0000-0000-0000-0000-00000000011e'::uuid, '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-0000000000f0'::uuid, '5e4e0000-0000-0000-0000-0000000000a3'::uuid, '5e4e0000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 70, 'Carl', '0603', 'evt-A'),
  ('5e4e0000-0000-0000-0000-0000000000e3'::uuid, '5e4e0000-0000-0000-0000-000000000003'::uuid, '5e4e0000-0000-0000-0000-00000000011e'::uuid, '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-0000000000f0'::uuid, '5e4e0000-0000-0000-0000-0000000000a4'::uuid, '5e4e0000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 80, 'Dina', '0604', 'evt-G'),
  -- e4 : SANS collecte → c'est le seul cas où un DELETE direct aboutirait
  -- aujourd'hui (la FK collectes_evenement_id_fkey, sans CASCADE, bloque les
  -- autres). Il sert le cas B6.
  ('5e4e0000-0000-0000-0000-0000000000e4'::uuid, '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-00000000011e'::uuid, '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-0000000000f0'::uuid, '5e4e0000-0000-0000-0000-0000000000a1'::uuid, '5e4e0000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 60, 'Eve', '0605', 'evt-D');

-- c1 porte le prestataire posé par son dispatch (fn_dispatcher_collecte) ; c2/c3,
-- jamais dispatchées, n'en ont pas.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, prestataire_logistique_id) VALUES
  ('5e4e0000-0000-0000-0000-0000000000c1'::uuid, '5e4e0000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'validee', 'acceptee', current_date + 10, '08:00', '5e4e0000-0000-0000-0000-0000000000d0'::uuid),
  ('5e4e0000-0000-0000-0000-0000000000c2'::uuid, '5e4e0000-0000-0000-0000-0000000000e2'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00', NULL),
  ('5e4e0000-0000-0000-0000-0000000000c3'::uuid, '5e4e0000-0000-0000-0000-0000000000e3'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00', NULL);

-- c1 est COMMANDÉE chez un prestataire : l'état que l'adapter produit réellement au
-- dispatch (une `tournees` portant `external_ref_commande`, liée par
-- `collecte_tournees`). Jamais `collectes.tms_reference`, que rien n'écrit en
-- production (#315). C'est ce qui ouvre le gate d'émission E2 — indispensable au
-- bloc D.
INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut, external_ref_commande) VALUES
  ('5e4e0000-0000-0000-0000-0000000000b1'::uuid, 'EVTSECU-T1', current_date + 10, 'nuit', '5e4e0000-0000-0000-0000-0000000000d0'::uuid, 'en_cours', 'CMD-EVTSECU-1');

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
  ('5e4e0000-0000-0000-0000-0000000000c1'::uuid, '5e4e0000-0000-0000-0000-0000000000b1'::uuid, 1);

-- =============================================================================
-- A. PRIVILÈGES — le GRANT table-level 0.4a est bien amputé
-- =============================================================================
SELECT test_as_superuser();

SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.evenements', 'UPDATE'),
  'A1 authenticated n''a plus UPDATE table-level sur evenements'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.evenements', 'INSERT'),
  'A2 authenticated n''a plus INSERT table-level sur evenements'
);
-- DELETE est retiré AUSSI (là où #318 l'avait conservé sur `collectes`) : aucun
-- usage applicatif — la suppression de brouillon passe par fn_supprimer_brouillon,
-- SECURITY DEFINER appelée en service_role — et evt_manager_delete n'a AUCUNE garde
-- d'ÉTAT, là où le §06.01 borne la suppression au brouillon. Son périmètre rôle/org,
-- lui, coïncide avec la matrice §09 (cf. le ⚠ de la migration).
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.evenements', 'DELETE'),
  'A3 authenticated n''a plus DELETE table-level sur evenements'
);

-- Non-régression : SELECT est HORS périmètre. Le retirer casserait quatre lectures
-- réelles sous JWT client (gestionnaire/evenements, .../[id], .../export-csv,
-- dashboards/synthese-pdf/filtres) plus la lecture de cloisonnement en tête du
-- PATCH programmation.
SELECT ok(
  has_table_privilege('authenticated', 'plateforme.evenements', 'SELECT'),
  'A4 SELECT reste accorde (lectures gestionnaire + filtres synthese PDF)'
);

-- Cliquet : interdit de ré-ouvrir par la porte colonne-level. Un
-- `GRANT UPDATE (contact_secours_nom)` laisserait A1 vrai (has_table_privilege
-- reste faux) tout en ré-autorisant l'écriture directe visée par ce fichier.
SELECT is(
  (SELECT count(*)::int FROM information_schema.column_privileges
    WHERE grantee = 'authenticated'
      AND table_schema = 'plateforme' AND table_name = 'evenements'
      AND privilege_type IN ('UPDATE', 'INSERT')),
  0,
  'A5 aucun GRANT colonne-level UPDATE/INSERT residuel sur evenements'
);

-- Non-régression : les routes API écrivent sous service_role, qui doit rester intact.
SELECT ok(
  has_table_privilege('service_role', 'plateforme.evenements', 'UPDATE')
  AND has_table_privilege('service_role', 'plateforme.evenements', 'INSERT')
  AND has_table_privilege('service_role', 'plateforme.evenements', 'DELETE'),
  'A6 service_role conserve UPDATE + INSERT + DELETE (les routes API ecrivent toujours)'
);

-- Cliquet d'arbitrage : les policies sont CONSERVÉES (même décision qu'en #318) —
-- inertes tant que le privilège n'est pas ré-accordé, mais prêtes si un besoin
-- JWT-scopé revient.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'evenements'
      AND policyname IN ('evt_manager_update', 'evt_commercial_update',
                         'evt_agence_update', 'evt_gestionnaire_update',
                         'evt_manager_insert', 'evt_manager_delete')),
  6,
  'A7 policies evt_*_update / _insert / _delete conservees (inertes)'
);

-- =============================================================================
-- B. FERMETURE SOUS RÔLE — le PATCH/POST/DELETE PostgREST direct est refusé
-- =============================================================================
-- Chaque rôle vise un événement de SON périmètre : la RLS l'autoriserait. Le 42501
-- prouve que c'est le privilège qui ferme.

-- B1 le vecteur exact du brief : contact_secours_nom à 5 000 caractères.
SELECT test_set_jwt('traiteur_manager', '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  format($$UPDATE plateforme.evenements SET contact_secours_nom = %L
            WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$, repeat('X', 5000)),
  '42501', NULL,
  'B1 traiteur_manager : PATCH direct de contact_secours_nom refuse (42501)'
);

-- B2 agence, sur un événement de son orga.
SELECT test_set_jwt('agence', '5e4e0000-0000-0000-0000-000000000002'::uuid, '5e4e0000-0000-0000-0000-0000000000a3'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.evenements SET contact_principal_telephone = '0000000000'
     WHERE id = '5e4e0000-0000-0000-0000-0000000000e2'::uuid$$,
  '42501', NULL,
  'B2 agence : UPDATE direct refuse (42501) malgre evt_agence_update'
);

-- B3 gestionnaire de lieux, sur un événement de son orga.
SELECT test_set_jwt('gestionnaire_lieux', '5e4e0000-0000-0000-0000-000000000003'::uuid, '5e4e0000-0000-0000-0000-0000000000a4'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.evenements SET notes_internes = 'ges-direct'
     WHERE id = '5e4e0000-0000-0000-0000-0000000000e3'::uuid$$,
  '42501', NULL,
  'B3 gestionnaire_lieux : UPDATE direct refuse (42501) malgre evt_gestionnaire_update'
);

-- B4 commercial, sur un événement qu'il a créé (evt_commercial_update).
SELECT test_set_jwt('traiteur_commercial', '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-0000000000a2'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.evenements SET contact_principal_nom = 'com-direct'
     WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
  '42501', NULL,
  'B4 traiteur_commercial : UPDATE direct refuse (42501) malgre evt_commercial_update'
);

-- B5 le contournement par INSERT : sans ce verrou, fermer UPDATE ne servirait à
-- rien — il suffirait de CRÉER un événement portant le contact empoisonné.
SELECT test_set_jwt('traiteur_manager', '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$INSERT INTO plateforme.evenements
      (organisation_id, lieu_id, traiteur_operationnel_organisation_id,
       entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
       contact_principal_nom, contact_principal_telephone)
    VALUES ('5e4e0000-0000-0000-0000-000000000001'::uuid,
            '5e4e0000-0000-0000-0000-00000000011e'::uuid,
            '5e4e0000-0000-0000-0000-000000000001'::uuid,
            '5e4e0000-0000-0000-0000-0000000000f0'::uuid,
            '5e4e0000-0000-0000-0000-0000000000a1'::uuid,
            '5e4e0000-0000-0000-0000-00000000007e'::uuid,
            current_date + 10, 50, 'Injecte', '0699')$$,
  '42501', NULL,
  'B5 traiteur_manager : INSERT direct refuse (42501) malgre evt_manager_insert'
);

-- B6 le DELETE direct : sur e4 (sans collecte), la FK ne protège pas — seule la
-- fermeture du privilège empêche une suppression qu'aucune garde d'état ne borne
-- (evt_manager_delete ne connaît pas le statut brouillon, cf. §06.01).
SELECT throws_ok(
  $$DELETE FROM plateforme.evenements
     WHERE id = '5e4e0000-0000-0000-0000-0000000000e4'::uuid$$,
  '42501', NULL,
  'B6 traiteur_manager : DELETE direct refuse (42501) malgre evt_manager_delete'
);

-- B7 la fermeture est TOTALE, pas seulement « côté client » : `admin_savr` et
-- `ops_savr` sont des claims JWT, le rôle Postgres reste `authenticated`. Leurs
-- policies evt_admin / evt_ops_write sont donc inertes elles aussi — le staff écrit
-- via les routes API sous service_role, jamais en PostgREST direct.
SELECT test_set_jwt('admin_savr', NULL, '5e4e0000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.evenements SET notes_internes = 'admin-direct'
     WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
  '42501', NULL,
  'B7 admin_savr : UPDATE direct refuse (42501) — la fermeture est totale, pas client-only'
);

-- B8 non-régression : la lecture de ses propres événements fonctionne toujours.
SELECT test_set_jwt('traiteur_manager', '5e4e0000-0000-0000-0000-000000000001'::uuid, '5e4e0000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements
    WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid),
  1,
  'B8 non-regression : le client lit toujours son evenement (evt_manager_select intact)'
);

-- =============================================================================
-- C. CHECK de bornes — s'applique à TOUT écrivain, service_role compris
-- =============================================================================
-- 23514 = check_violation. Testé sous superuser : c'est le cas le plus exigeant, et
-- c'est le seul verrou qui couvre le trou atteignable NOMINALEMENT — un nom
-- démesuré saisi dans le formulaire, écrit par la route sous service_role.
SELECT test_as_superuser();

-- C1 le vecteur du brief, cette fois par la porte service_role, sur le champ que
-- CE lot borne : le nom du contact PRINCIPAL (celui de secours l'est par #322).
SELECT throws_ok(
  format($$UPDATE plateforme.evenements SET contact_principal_nom = %L
            WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$, repeat('X', 5000)),
  '23514', NULL,
  'C1 CHECK : contact_principal_nom de 5000 car. refuse meme sous service_role'
);

-- C2 la borne exacte : 121 refusé, 120 accepté (cf. C10).
SELECT throws_ok(
  format($$UPDATE plateforme.evenements SET contact_principal_nom = %L
            WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$, repeat('n', 121)),
  '23514', NULL, 'C2 CHECK : contact_principal_nom a 121 car. refuse (borne 120)'
);

-- C3 téléphone : 41 refusé, 40 accepté (cf. C10). Même borne que le téléphone de
-- secours (#322) : un couple nom/téléphone n'est pas borné différemment selon
-- qu'il est principal ou de secours.
SELECT throws_ok(
  format($$UPDATE plateforme.evenements SET contact_principal_telephone = %L
            WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$, repeat('0', 41)),
  '23514', NULL, 'C3 CHECK : contact_principal_telephone a 41 car. refuse (borne 40)'
);
-- C4 non-régression : la borne de #322 sur le téléphone de SECOURS tient toujours
-- (la contrainte de ce lot ne l'a ni remplacée ni relâchée).
SELECT throws_ok(
  format($$UPDATE plateforme.evenements SET contact_secours_telephone = %L
            WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$, repeat('0', 41)),
  '23514', NULL, 'C4 non-regression : borne #322 du telephone de secours intacte (41 car. refuse)'
);

-- C5 saut de ligne dans le nom principal : il part dans un champ NATIF de la
-- commande, où une valeur multiligne est une donnée aberrante transmise telle quelle.
SELECT throws_ok(
  $$UPDATE plateforme.evenements SET contact_principal_nom = E'Jean\nDupont'
     WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
  '23514', NULL, 'C5 CHECK : saut de ligne refuse dans contact_principal_nom'
);

-- C6 C1 (U+0085, NEL) : couvert par `[[:cntrl:]]`, donc par le filtre applicatif
-- aussi — les deux périmètres doivent coïncider, sinon la route rend un 500 (23514)
-- là où elle doit rendre un 422.
SELECT throws_ok(
  $$UPDATE plateforme.evenements SET contact_principal_nom = E'JeanDupont'
     WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
  '23514', NULL, 'C6 CHECK : caractere de controle C1 (U+0085) refuse'
);

-- C7 contact principal vidé : un chauffeur sans personne à appeler.
SELECT throws_ok(
  $$UPDATE plateforme.evenements SET contact_principal_nom = '   '
     WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
  '23514', NULL, 'C7 CHECK : contact_principal_nom blanc refuse (champ obligatoire)'
);
SELECT throws_ok(
  $$UPDATE plateforme.evenements SET contact_principal_telephone = ''
     WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
  '23514', NULL, 'C8 CHECK : contact_principal_telephone vide refuse (champ obligatoire)'
);

-- C9 le CHECK couvre aussi l'INSERT, pas seulement l'UPDATE.
SELECT throws_ok(
  format($$INSERT INTO plateforme.evenements
      (organisation_id, lieu_id, traiteur_operationnel_organisation_id,
       entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
       contact_principal_nom, contact_principal_telephone)
    VALUES ('5e4e0000-0000-0000-0000-000000000001'::uuid,
            '5e4e0000-0000-0000-0000-00000000011e'::uuid,
            '5e4e0000-0000-0000-0000-000000000001'::uuid,
            '5e4e0000-0000-0000-0000-0000000000f0'::uuid,
            '5e4e0000-0000-0000-0000-0000000000a1'::uuid,
            '5e4e0000-0000-0000-0000-00000000007e'::uuid,
            current_date + 10, 50, %L, '0699')$$, repeat('n', 121)),
  '23514', NULL, 'C9 CHECK : INSERT hors bornes refuse aussi'
);

-- ── Non-vacuité : ce que le CHECK doit LAISSER passer ────────────────────────
-- Sans ces cas, un CHECK qui refuserait tout ferait passer C1-C9 au vert.

-- C10 la saisie nominale, aux bornes exactes (120 / 40).
SELECT lives_ok(
  format($$UPDATE plateforme.evenements SET
             contact_principal_nom = %L, contact_principal_telephone = %L,
             contact_secours_nom = 'Jean-Baptiste de La Tour du Pin',
             contact_secours_telephone = '+33 (0)6 12 34 56 78 p42'
           WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
         repeat('n', 120), repeat('0', 40)),
  'C10 non-vacuite : saisie nominale aux bornes exactes (120 / 40) acceptee'
);

-- C11 pas de contact de secours = NULL sur les deux colonnes.
SELECT lives_ok(
  $$UPDATE plateforme.evenements
      SET contact_secours_nom = NULL, contact_secours_telephone = NULL
    WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
  'C11 non-vacuite : NULL accepte sur les contacts de secours'
);

-- C12 asymétrie voulue : la chaîne vide reste acceptée EN BASE sur un contact de
-- SECOURS (#322 ne la refuse pas — la route la normalise en `null` en amont), alors
-- que C7/C8 la refusent sur les contacts PRINCIPAUX, qui sont NOT NULL et exigés
-- « renseignés » (§06.01 l.320). C'est le seul écart entre les deux paires de
-- contraintes, et il est intentionnel.
SELECT lives_ok(
  $$UPDATE plateforme.evenements
      SET contact_secours_nom = '', contact_secours_telephone = ''
    WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
  'C12 non-vacuite : chaine vide toujours acceptee sur un contact de secours (asymetrie voulue)'
);

-- C13 accents et apostrophes : un CHECK trop zélé sur les caractères non-ASCII
-- refuserait la moitié des noms français.
SELECT lives_ok(
  $$UPDATE plateforme.evenements
      SET contact_principal_nom = 'Élodie Nguyên-O''Brien'
    WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid$$,
  'C13 non-vacuite : accents et apostrophe acceptes dans un nom'
);

-- =============================================================================
-- D. LE MOTIF — l'écriture directe était SILENCIEUSE côté outbox
-- =============================================================================
-- Ce que la fermeture protège vraiment : le chemin nominal émet un E2
-- `collecte.modifiee` par collecte encore commandée chez un provider ; l'UPDATE
-- direct n'en émettait aucun. R22c a explicitement écarté un trigger `dirty_tms`
-- sur `evenements` (double push E2) — rien ne rattrape ce chemin.
--
-- c1 est commandée chez son provider : une tournée avec external_ref_commande,
-- ET la collecte comme la tournée résolvent, via leur transporteur, au même
-- type_tms (gate provider-aware depuis #327). Le gate d'émission est donc
-- ouvert. Mesuré sous superuser, la RLS de `outbox_events` ne masquant alors rien.
SELECT test_as_superuser();

SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = '5e4e0000-0000-0000-0000-0000000000c1'::uuid
      AND event_type = 'collecte.modifiee'),
  0,
  'D1 aucun E2 avant modification (etat de depart)'
);

-- D2 le chemin NOMINAL (route → RPC) émet bien : c'est ce que l'écriture directe
-- contournait. Sans cette assertion, D1/D3 seraient compatibles avec « E2 n'est
-- jamais émis de toute façon » — le test ne prouverait rien.
SELECT plateforme.fn_modifier_evenement(
  '5e4e0000-0000-0000-0000-0000000000e1'::uuid,
  '{"contact_secours_nom": "Nom de secours corrige"}'::jsonb,
  ARRAY['contact_secours_nom']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = '5e4e0000-0000-0000-0000-0000000000c1'::uuid
      AND event_type = 'collecte.modifiee'),
  1,
  'D2 le chemin nominal (fn_modifier_evenement) emet bien un E2'
);

-- D3 l'UPDATE direct sous service_role, lui, reste muet : la RPC est le SEUL
-- chemin émetteur, et depuis la migration c'est le seul chemin ouvert au client.
UPDATE plateforme.evenements SET contact_secours_nom = 'Nom pose en direct'
 WHERE id = '5e4e0000-0000-0000-0000-0000000000e1'::uuid;
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = '5e4e0000-0000-0000-0000-0000000000c1'::uuid
      AND event_type = 'collecte.modifiee'),
  1,
  'D3 un UPDATE direct n''emet AUCUN E2 (toujours 1, celui de D2) — le motif de la fermeture'
);

SELECT * FROM finish();
ROLLBACK;
