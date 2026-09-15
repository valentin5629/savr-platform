-- =============================================================================
-- SÉCURITÉ — écriture PostgREST directe de `plateforme.collectes` fermée aux
-- clients + `lieu_overrides` borné EN BASE.
--
-- Migration prouvée : 20260915120000_plateforme_collectes_ecriture_client_fermee.
-- Dette P1 laissée ouverte par #308 (validerLieuOverrides borne les deux ROUTES
-- applicatives, pas la COLONNE). Arbitrage Val 2026-09-15 : fermeture totale
-- UPDATE + INSERT sans re-GRANT, policies conservées.
--
-- ⚠ Tout se joue SOUS RÔLE `authenticated` (test_set_jwt pose `role`) : sous
-- service_role ou via le MCP Supabase, la RLS est bypassée ET les privilèges sont
-- ceux d'un autre rôle — le test passerait au vert quoi qu'il arrive. Les refus
-- attendus sont des 42501 (insufficient_privilege), levés AVANT même l'évaluation
-- RLS : c'est le privilège qui ferme, pas la policy.
--
-- Le CHECK, lui, s'applique à TOUT écrivain (service_role inclus) — il est donc
-- exercé sous superuser, ce qui est ici le cas le plus exigeant.
-- =============================================================================

BEGIN;
SELECT plan(27);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Helpers JWT (cf. edition_evenement / rls_0_4_smoke) ──────────────────────
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
  ('5ec00000-0000-0000-0000-000000000001'::uuid, 'Traiteur SECU', 'traiteur', true, false, '5EC00000000001', 'secu-t@test.com'),
  ('5ec00000-0000-0000-0000-000000000002'::uuid, 'Agence SECU', 'agence', true, false, '5EC00000000002', 'secu-a@test.com'),
  ('5ec00000-0000-0000-0000-000000000003'::uuid, 'Gestionnaire SECU', 'gestionnaire_lieux', true, false, '5EC00000000003', 'secu-g@test.com');

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('5ec00000-0000-0000-0000-00000000007e'::uuid, 'cocktail_secu', 'Cocktail SECU');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('5ec00000-0000-0000-0000-0000000000a1'::uuid, '5ec00000-0000-0000-0000-000000000001'::uuid, 'mgr@secu.test', 'Mgr', 'Secu', 'traiteur_manager'),
  ('5ec00000-0000-0000-0000-0000000000a2'::uuid, '5ec00000-0000-0000-0000-000000000001'::uuid, 'com@secu.test', 'Com', 'Secu', 'traiteur_commercial'),
  ('5ec00000-0000-0000-0000-0000000000a3'::uuid, '5ec00000-0000-0000-0000-000000000002'::uuid, 'ag@secu.test', 'Ag', 'Secu', 'agence'),
  ('5ec00000-0000-0000-0000-0000000000a4'::uuid, '5ec00000-0000-0000-0000-000000000003'::uuid, 'ges@secu.test', 'Ges', 'Secu', 'gestionnaire_lieux');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('5ec00000-0000-0000-0000-0000000000f0'::uuid, '5ec00000-0000-0000-0000-000000000001'::uuid, 'Traiteur SECU SARL', '5EC00000000001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('5ec00000-0000-0000-0000-00000000011e'::uuid, 'Salle SECU', '1 rue', '75001', 'Paris', 'fourgon');

-- Un événement par rôle testé : chacun est DANS le périmètre de son rôle, donc la
-- RLS (col_update_client / col_update_commercial / col_insert) l'AUTORISERAIT.
-- Le refus attendu ne peut donc venir que du privilège retiré — c'est le point.
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone, reference_affaire
) VALUES
  ('5ec00000-0000-0000-0000-0000000000e1'::uuid, '5ec00000-0000-0000-0000-000000000001'::uuid, '5ec00000-0000-0000-0000-00000000011e'::uuid, '5ec00000-0000-0000-0000-000000000001'::uuid, '5ec00000-0000-0000-0000-0000000000f0'::uuid, '5ec00000-0000-0000-0000-0000000000a2'::uuid, '5ec00000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 100, 'Alice', '0601', 'secu-T'),
  ('5ec00000-0000-0000-0000-0000000000e2'::uuid, '5ec00000-0000-0000-0000-000000000002'::uuid, '5ec00000-0000-0000-0000-00000000011e'::uuid, '5ec00000-0000-0000-0000-000000000001'::uuid, '5ec00000-0000-0000-0000-0000000000f0'::uuid, '5ec00000-0000-0000-0000-0000000000a3'::uuid, '5ec00000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 70, 'Carl', '0603', 'secu-A'),
  ('5ec00000-0000-0000-0000-0000000000e3'::uuid, '5ec00000-0000-0000-0000-000000000003'::uuid, '5ec00000-0000-0000-0000-00000000011e'::uuid, '5ec00000-0000-0000-0000-000000000001'::uuid, '5ec00000-0000-0000-0000-0000000000f0'::uuid, '5ec00000-0000-0000-0000-0000000000a4'::uuid, '5ec00000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 80, 'Dina', '0604', 'secu-G');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte) VALUES
  ('5ec00000-0000-0000-0000-0000000000c1'::uuid, '5ec00000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00'),
  ('5ec00000-0000-0000-0000-0000000000c2'::uuid, '5ec00000-0000-0000-0000-0000000000e2'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00'),
  ('5ec00000-0000-0000-0000-0000000000c3'::uuid, '5ec00000-0000-0000-0000-0000000000e3'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00');

-- =============================================================================
-- A. PRIVILÈGES — le GRANT table-level 0.4a est bien amputé
-- =============================================================================
SELECT test_as_superuser();

SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.collectes', 'UPDATE'),
  'A1 authenticated n''a plus UPDATE table-level sur collectes'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.collectes', 'INSERT'),
  'A2 authenticated n''a plus INSERT table-level sur collectes'
);

-- Non-régression : SELECT (col_select) et DELETE (col_delete_brouillon) sont hors
-- périmètre de l'arbitrage — les retirer casserait la lecture et la suppression
-- de brouillon.
SELECT ok(
  has_table_privilege('authenticated', 'plateforme.collectes', 'SELECT'),
  'A3 SELECT reste accorde (col_select — lecture des ecrans clients)'
);
SELECT ok(
  has_table_privilege('authenticated', 'plateforme.collectes', 'DELETE'),
  'A4 DELETE reste accorde (col_delete_brouillon — suppression de son brouillon)'
);

-- Cliquet : interdit de ré-ouvrir par la porte colonne-level. Un
-- `GRANT UPDATE (une_colonne)` rendrait A1 toujours vrai (has_table_privilege
-- reste faux) tout en ré-autorisant une écriture directe.
SELECT is(
  (SELECT count(*)::int FROM information_schema.column_privileges
    WHERE grantee = 'authenticated'
      AND table_schema = 'plateforme' AND table_name = 'collectes'
      AND privilege_type IN ('UPDATE', 'INSERT')),
  0,
  'A5 aucun GRANT colonne-level UPDATE/INSERT residuel sur collectes'
);

-- Non-régression : les routes API écrivent sous service_role, qui doit rester intact.
SELECT ok(
  has_table_privilege('service_role', 'plateforme.collectes', 'UPDATE')
  AND has_table_privilege('service_role', 'plateforme.collectes', 'INSERT'),
  'A6 service_role conserve UPDATE + INSERT (les routes API ecrivent toujours)'
);

-- Cliquet d'arbitrage : les policies sont CONSERVÉES (décision Val) — inertes tant
-- que le privilège n'est pas ré-accordé, mais prêtes si un besoin JWT-scopé revient.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'collectes'
      AND policyname IN ('col_update_client', 'col_update_commercial', 'col_insert')),
  3,
  'A7 col_update_client / col_update_commercial / col_insert conservees (inertes)'
);

-- =============================================================================
-- B. FERMETURE SOUS RÔLE — le PATCH/POST PostgREST direct du brief est refusé
-- =============================================================================
-- Chaque rôle vise une collecte de SON périmètre, en statut `programmee` : la RLS
-- l'autoriserait. Le 42501 prouve que c'est le privilège qui ferme.

-- B1 le vecteur exact du brief : lieu_overrides empoisonné par PATCH direct.
SELECT test_set_jwt('traiteur_manager', '5ec00000-0000-0000-0000-000000000001'::uuid, '5ec00000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.collectes
      SET lieu_overrides = '{"adresse_acces":{"$ne":1},"ville":["a","b"],"code_postal":123}'::jsonb
    WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '42501', NULL,
  'B1 traiteur_manager : PATCH direct de lieu_overrides refuse (42501)'
);

-- B2 agence, sur une collecte de son orga.
SELECT test_set_jwt('agence', '5ec00000-0000-0000-0000-000000000002'::uuid, '5ec00000-0000-0000-0000-0000000000a3'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET notes_internes = 'ag-direct'
     WHERE id = '5ec00000-0000-0000-0000-0000000000c2'::uuid$$,
  '42501', NULL,
  'B2 agence : UPDATE direct refuse (42501) malgre col_update_client'
);

-- B3 gestionnaire de lieux, sur une collecte de son orga.
SELECT test_set_jwt('gestionnaire_lieux', '5ec00000-0000-0000-0000-000000000003'::uuid, '5ec00000-0000-0000-0000-0000000000a4'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET notes_internes = 'ges-direct'
     WHERE id = '5ec00000-0000-0000-0000-0000000000c3'::uuid$$,
  '42501', NULL,
  'B3 gestionnaire_lieux : UPDATE direct refuse (42501) malgre col_update_client'
);

-- B4 commercial, sur une collecte d'un événement qu'il a créé (col_update_commercial).
SELECT test_set_jwt('traiteur_commercial', '5ec00000-0000-0000-0000-000000000001'::uuid, '5ec00000-0000-0000-0000-0000000000a2'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET notes_internes = 'com-direct'
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '42501', NULL,
  'B4 traiteur_commercial : UPDATE direct refuse (42501) malgre col_update_commercial'
);

-- B5 le contournement par INSERT : sans ce verrou, fermer UPDATE ne servirait à
-- rien — il suffirait de CRÉER une collecte portant l'override empoisonné.
SELECT test_set_jwt('traiteur_manager', '5ec00000-0000-0000-0000-000000000001'::uuid, '5ec00000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$INSERT INTO plateforme.collectes
      (evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, lieu_overrides)
    VALUES ('5ec00000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'programmee',
            'non_envoye', current_date + 10, '08:00',
            '{"adresse_acces":{"$ne":1}}'::jsonb)$$,
  '42501', NULL,
  'B5 traiteur_manager : INSERT direct refuse (42501) malgre col_insert'
);

-- B6 non-régression : la lecture de ses propres collectes fonctionne toujours.
SELECT test_set_jwt('traiteur_manager', '5ec00000-0000-0000-0000-000000000001'::uuid, '5ec00000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes
    WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid),
  1,
  'B6 non-regression : le client lit toujours sa collecte (col_select intact)'
);

-- =============================================================================
-- C. CHECK `lieu_overrides` — s'applique à TOUT écrivain, service_role compris
-- =============================================================================
-- 23514 = check_violation. Testé sous superuser : c'est le cas le plus exigeant
-- (aucun privilège ne peut l'esquiver) et c'est le seul verrou qui protège une
-- future route qui oublierait d'appeler `validerLieuOverrides`.
SELECT test_as_superuser();

-- C1 le payload exact du brief, dans son intégralité.
SELECT throws_ok(
  $$UPDATE plateforme.collectes
      SET lieu_overrides = '{"adresse_acces":{"$ne":1},"ville":["a","b"],"code_postal":123}'::jsonb
    WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL,
  'C1 CHECK : le payload empoisonne du brief est refuse meme sous service_role'
);

-- C2 objet là où une chaîne est attendue → « [object Object] » chez l'adapter.
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '{"adresse_acces":{}}'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL, 'C2 CHECK : objet refuse sur un champ texte'
);

-- C3 tableau là où une chaîne est attendue → « a,b » chez l'adapter.
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '{"ville":["a","b"]}'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL, 'C3 CHECK : tableau refuse sur un champ texte'
);

-- C4 nombre là où une chaîne est attendue.
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '{"code_postal":123}'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL, 'C4 CHECK : nombre refuse sur un champ texte'
);

-- C5 clé hors allowlist : ni un champ du lieu, ni un champ admin-only.
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '{"commentaire_lieu":"admin only"}'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL, 'C5 CHECK : cle hors allowlist refusee (champ admin-only du lieu)'
);

-- C6 adresse vidée : l'adresse impossible que tout ceci cherche à empêcher.
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '{"adresse_acces":"   "}'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL, 'C6 CHECK : adresse_acces vide/blanche refusee (champ NOT NULL en base)'
);

-- C7 `null` sur un champ NOT NULL en base = effacement de l'adresse → refusé.
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '{"ville":null}'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL, 'C7 CHECK : null refuse sur un champ obligatoire'
);

-- C8 borne de longueur (adresse_acces max 200).
SELECT throws_ok(
  format($$UPDATE plateforme.collectes SET lieu_overrides = %L::jsonb
            WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
         jsonb_build_object('adresse_acces', repeat('a', 201))::text),
  '23514', NULL, 'C8 CHECK : depassement de la borne de longueur refuse'
);

-- C9 valeur hors enum.
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '{"type_vehicule_max":"fusee"}'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL, 'C9 CHECK : valeur hors enum refusee (type_vehicule_max)'
);

-- C10 liste : élément non-string.
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '{"flux_autorises":["bio",7]}'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL, 'C10 CHECK : element non-string refuse dans flux_autorises'
);

-- C11 racine non-objet.
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '["a"]'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  '23514', NULL, 'C11 CHECK : racine non-objet refusee'
);

-- ── Non-vacuité : ce que le CHECK doit LAISSER passer ────────────────────────
-- Sans ces trois cas, un CHECK qui refuserait tout ferait passer C1-C11 au vert.

-- C12 la surcharge nominale du formulaire de programmation.
SELECT lives_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = '{
      "adresse_acces":"12 rue du Quai, porte B",
      "code_postal":"75011",
      "ville":"Paris",
      "acces_details":"Sonner a l''interphone 4B",
      "contraintes_horaires":"Livraison avant 7h",
      "stationnement":"difficile",
      "acces_office":"facile",
      "type_vehicule_max":"camionnette",
      "flux_autorises":["biodechets","carton"]
    }'::jsonb
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  'C12 non-vacuite : la surcharge nominale complete est acceptee'
);

-- C13 `null` sur un champ facultatif = « pas de surcharge » (voie d'effacement).
SELECT lives_ok(
  $$UPDATE plateforme.collectes
      SET lieu_overrides = '{"acces_details":null,"stationnement":null,"flux_autorises":null}'::jsonb
    WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  'C13 non-vacuite : null accepte sur un champ facultatif (effacement de surcharge)'
);

-- C14 absence de surcharge.
SELECT lives_ok(
  $$UPDATE plateforme.collectes SET lieu_overrides = NULL
     WHERE id = '5ec00000-0000-0000-0000-0000000000c1'::uuid$$,
  'C14 non-vacuite : NULL accepte (aucune surcharge)'
);

SELECT * FROM finish();
ROLLBACK;
