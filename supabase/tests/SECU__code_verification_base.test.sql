-- =============================================================================
-- Tests pgTAP — Code de vérification de l'équipe Savr exigé par la base
-- Migration : 20261104200000_plateforme_code_verification_base.sql
-- =============================================================================
-- Faille fermée : une session admin_savr ou ops_savr sans code de vérification
-- (aal1 : mot de passe saisi, ou lien « mot de passe oublié » ouvert) gardait en
-- base tous les droits de l'équipe Savr. L'application la refusait (PR #742),
-- pas la base : un appel direct à l'API Supabase passait.
--
-- Règle (plateforme.f_code_verification_ok) : refus pour un jeton admin_savr ou
-- ops_savr dont le niveau n'est pas aal2 ET dont le compte a un code activé
-- (facteur `verified` dans auth.mfa_factors). Sans code activé, rien ne change :
-- c'est l'état de dev, du local et de la CI (l'application ne demande le code
-- qu'en production). Toute la suite existante, jouée sans code activé, prouve
-- donc que rien ne change ailleurs.
--
-- Trois contextes pour un même compte A (seul le statut de son facteur bouge) :
--   « sans code activé » (facteur unverified, aal1) = comportement d'avant ;
--   « avec code, aal2 »  = session qui a passé le code : doit être identique ;
--   « avec code, aal1 »  = session sans code : tout refusé.
--
-- Oracle :
--   1-11  la règle, cas par cas (jamais NULL) ;
--   12-18 cliquets de structure : chaque table porte la policy restrictive,
--         chaque fonction SECURITY DEFINER et chaque vue « droits du
--         propriétaire » ouvertes à authenticated portent la règle, droits
--         d'exécution exacts des deux fonctions ;
--   19-30 balayage de TOUTES les tables de plateforme et shared, pour
--         admin_savr puis ops_savr : lecture (comptage) et écriture (INSERT,
--         UPDATE, DELETE, annulés aussitôt) ; non-vacuité mesurée ;
--   31-34 écriture refusée nommément (INSERT associations), miroir aal2 ;
--   35-104 les 13 fonctions et les 4 vues, pour admin_savr puis ops_savr :
--         non-vacuité, refus sans code, résultat identique avec code.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`,
-- `aal`, `sub`, `organisation_id`). Le compte A a une organisation (type
-- agence), comme les comptes de l'équipe Savr de savr-dev : les policies qui ne
-- regardent que l'organisation du jeton sont donc exercées elles aussi.
-- =============================================================================

BEGIN;
SELECT plan(104);

-- Identifiants ----------------------------------------------------------------
-- A = membre de l'équipe Savr (compte de test unique, rôle porté par le jeton)
-- S = son organisation ; P = traiteur ; T = utilisateur du traiteur ;
-- L = lieu ; E = événement ; C1 = collecte ZD clôturée ; C2 = collecte AG programmée.
CREATE OR REPLACE FUNCTION test_cv_id(p_nom text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE p_nom
    WHEN 'A'  THEN 'c0de0001-0000-0000-0000-0000000000a1'
    WHEN 'T'  THEN 'c0de0001-0000-0000-0000-0000000000a2'
    WHEN 'F'  THEN 'c0de0002-0000-0000-0000-0000000000a1'
    WHEN 'S'  THEN 'c0de0010-0000-0000-0000-0000000000a1'
    WHEN 'P'  THEN 'c0de0010-0000-0000-0000-0000000000a2'
    WHEN 'EF' THEN 'c0de0020-0000-0000-0000-0000000000a1'
    WHEN 'L'  THEN 'c0de0030-0000-0000-0000-0000000000a1'
    WHEN 'TE' THEN 'c0de0040-0000-0000-0000-0000000000a1'
    WHEN 'E'  THEN 'c0de0050-0000-0000-0000-0000000000a1'
    WHEN 'C1' THEN 'c0de0060-0000-0000-0000-0000000000a1'
    WHEN 'C2' THEN 'c0de0060-0000-0000-0000-0000000000a2'
    WHEN 'AS' THEN 'c0de0070-0000-0000-0000-0000000000a1'
  END)::uuid
$$;

-- Helpers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_cv_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Jeton libre (cas de la règle) : chaque clé NULL est absente de l'objet.
CREATE OR REPLACE FUNCTION test_cv_jwt(p_role text, p_aal text, p_sub uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', p_sub,
    'role', 'authenticated',
    'user_role', p_role,
    'aal', p_aal,
    'organisation_id', test_cv_id('S'),
    'app_domain', 'plateforme'))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- Contexte du compte A : statut de son facteur, puis son jeton.
CREATE OR REPLACE FUNCTION test_cv_contexte(p_role text, p_aal text, p_code_actif boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM test_cv_superuser();
  UPDATE auth.mfa_factors
     SET status = (CASE WHEN p_code_actif THEN 'verified' ELSE 'unverified' END)::auth.factor_status
   WHERE id = test_cv_id('F');
  PERFORM test_cv_jwt(p_role, p_aal, test_cv_id('A'));
END $$;

-- Lignes lisibles d'une table sous le rôle courant ; -1 = pas même le droit SELECT.
CREATE OR REPLACE FUNCTION test_cv_compter(p_table text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM %s', p_table) INTO n;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN -1;
END $$;

-- Issue de INSERT (valeurs par défaut), UPDATE (première colonne sur elle-même)
-- et DELETE sous le rôle courant, chacun annulé aussitôt (sous-transaction).
-- « lignes=N » = N lignes touchées ; « refus:<SQLSTATE> » = l'écriture a échoué.
CREATE OR REPLACE FUNCTION test_cv_ecrire(p_table text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_col    text;
  v_op     text;
  v_sql    text;
  v_n      bigint;
  v_issue  text;
  v_bilan  text := '';
BEGIN
  SELECT a.attname INTO v_col
    FROM pg_attribute a
   WHERE a.attrelid = p_table::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attgenerated = '' AND a.attidentity = ''
   ORDER BY a.attnum LIMIT 1;
  FOREACH v_op IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
    v_sql := CASE v_op
      WHEN 'INSERT' THEN format('INSERT INTO %s DEFAULT VALUES', p_table)
      WHEN 'UPDATE' THEN format('UPDATE %s SET %I = %I', p_table, v_col, v_col)
      ELSE format('DELETE FROM %s', p_table)
    END;
    BEGIN
      EXECUTE v_sql;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_issue := 'lignes=' || v_n;
      RAISE EXCEPTION USING ERRCODE = 'P0C01';  -- annule l'écriture
    EXCEPTION
      WHEN SQLSTATE 'P0C01' THEN NULL;
      WHEN OTHERS THEN v_issue := 'refus:' || SQLSTATE;
    END;
    v_bilan := v_bilan || v_op || '=' || v_issue || ' ';
  END LOOP;
  RETURN rtrim(v_bilan);
END $$;

-- Balayage de toutes les tables pour un rôle : 6 assertions.
CREATE OR REPLACE FUNCTION test_cv_balayage(p_role text)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  v_tables text[];
  l_sans bigint[] := '{}'; l_aal2 bigint[] := '{}'; l_aal1 bigint[] := '{}';
  e_sans text[]   := '{}'; e_aal2 text[]   := '{}'; e_aal1 text[]   := '{}';
  idx int;
  n_lisibles bigint;
  n_ecrites bigint;
BEGIN
  PERFORM test_cv_superuser();
  SELECT array_agg(format('%I.%I', n.nspname, c.relname) ORDER BY n.nspname, c.relname)
    INTO v_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('plateforme', 'shared') AND c.relkind IN ('r', 'p');

  PERFORM test_cv_contexte(p_role, 'aal1', false);
  FOR idx IN 1 .. cardinality(v_tables) LOOP
    l_sans := l_sans || test_cv_compter(v_tables[idx]);
    e_sans := e_sans || test_cv_ecrire(v_tables[idx]);
  END LOOP;
  PERFORM test_cv_contexte(p_role, 'aal2', true);
  FOR idx IN 1 .. cardinality(v_tables) LOOP
    l_aal2 := l_aal2 || test_cv_compter(v_tables[idx]);
    e_aal2 := e_aal2 || test_cv_ecrire(v_tables[idx]);
  END LOOP;
  PERFORM test_cv_contexte(p_role, 'aal1', true);
  FOR idx IN 1 .. cardinality(v_tables) LOOP
    l_aal1 := l_aal1 || test_cv_compter(v_tables[idx]);
    e_aal1 := e_aal1 || test_cv_ecrire(v_tables[idx]);
  END LOOP;
  PERFORM test_cv_superuser();

  RETURN NEXT is(
    (SELECT coalesce(array_agg(v_tables[i] || ' (' || l_aal1[i] || ')'), '{}')
       FROM generate_subscripts(v_tables, 1) i WHERE l_aal1[i] > 0),
    '{}'::text[],
    p_role || ' sans code : aucune ligne lisible, sur aucune table');
  RETURN NEXT is(
    (SELECT coalesce(array_agg(v_tables[i] || ' : ' || e_aal1[i]), '{}')
       FROM generate_subscripts(v_tables, 1) i WHERE e_aal1[i] ~ 'lignes=[1-9]'),
    '{}'::text[],
    p_role || ' sans code : aucune écriture (INSERT, UPDATE, DELETE) ne touche une ligne, sur aucune table');
  RETURN NEXT is(
    (SELECT coalesce(array_agg(v_tables[i] || ' : ' || e_aal1[i]), '{}')
       FROM generate_subscripts(v_tables, 1) i WHERE e_aal1[i] ~ 'INSERT=lignes'),
    '{}'::text[],
    p_role || ' sans code : tout INSERT est refusé, sur toutes les tables');
  RETURN NEXT is(
    (SELECT coalesce(array_agg(v_tables[i] || ' (' || l_sans[i] || ' → ' || l_aal2[i] || ')'), '{}')
       FROM generate_subscripts(v_tables, 1) i WHERE l_aal2[i] IS DISTINCT FROM l_sans[i]),
    '{}'::text[],
    p_role || ' avec code (aal2) : lecture identique à celle d''avant, table par table');
  RETURN NEXT is(
    (SELECT coalesce(array_agg(v_tables[i] || ' (' || e_sans[i] || ' → ' || e_aal2[i] || ')'), '{}')
       FROM generate_subscripts(v_tables, 1) i WHERE e_aal2[i] IS DISTINCT FROM e_sans[i]),
    '{}'::text[],
    p_role || ' avec code (aal2) : écritures identiques à celles d''avant, table par table');
  -- Non-vacuité : sans elle, « aucune ligne » serait vrai d'une base vide.
  SELECT count(*) INTO n_lisibles FROM generate_subscripts(v_tables, 1) i WHERE l_sans[i] > 0;
  SELECT count(*) INTO n_ecrites FROM generate_subscripts(v_tables, 1) i
   WHERE e_sans[i] ~ '(UPDATE|DELETE)=lignes=[1-9]';
  -- Seuils sous les valeurs mesurées le 2026-11-04 (admin_savr : 23 et 17 ;
  -- ops_savr, qui écrit moins de tables : 21 et 4).
  RETURN NEXT ok(n_lisibles >= 20 AND n_ecrites >= 3,
    format('%s non-vacuité : avant, au moins 20 tables lisibles et 3 écrites (mesuré : %s et %s)',
           p_role, n_lisibles, n_ecrites));
END $$;

-- Fonctions et vues pour un rôle : 35 assertions.
CREATE OR REPLACE FUNCTION test_cv_fonctions(p_role text)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  -- r = sans code activé (avant), a = avec code aal2, b = avec code aal1
  r_visible boolean; a_visible boolean; b_visible boolean;
  r_editable boolean; a_editable boolean; b_editable boolean;
  r_fichier boolean; a_fichier boolean; b_fichier boolean;
  r_dechets numeric; a_dechets numeric; b_dechets numeric;
  r_mes bigint; a_mes bigint; b_mes bigint;
  r_tarif numeric; a_tarif numeric; b_tarif numeric;
  r_intervenu boolean; a_intervenu boolean; b_intervenu boolean;
  r_volume numeric; a_volume numeric; b_volume numeric;
  r_lieux bigint; a_lieux bigint;
  r_traiteurs bigint; a_traiteurs bigint;
  r_kgpax bigint; a_kgpax bigint;
  r_single bigint; a_single bigint;
  r_siret text; a_siret text;
  r_v_ref bigint; a_v_ref bigint; b_v_ref bigint;
  r_v_reg bigint; a_v_reg bigint; b_v_reg bigint;
  r_v_attr bigint; a_v_attr bigint; b_v_attr bigint;
  r_v_trait bigint; a_v_trait bigint; b_v_trait bigint;
  v_ctx text;
BEGIN
  FOREACH v_ctx IN ARRAY ARRAY['r', 'a'] LOOP
    IF v_ctx = 'r' THEN
      PERFORM test_cv_contexte(p_role, 'aal1', false);
    ELSE
      PERFORM test_cv_contexte(p_role, 'aal2', true);
    END IF;
    BEGIN
      PERFORM plateforme.f_completer_siret_shadow(test_cv_id('P'), '12345678900011');
      a_siret := 'aucun refus';
    EXCEPTION WHEN OTHERS THEN
      a_siret := SQLSTATE || ' ' || SQLERRM;
    END;
    IF v_ctx = 'r' THEN
      r_siret := a_siret;
      r_visible   := plateforme.f_collecte_visible(test_cv_id('C1'));
      r_editable  := plateforme.f_collecte_editable(test_cv_id('E'));
      r_fichier   := shared.f_fichier_visible('plateforme.collectes', test_cv_id('C1'));
      r_dechets   := plateforme.f_dechets_labo_estimes(test_cv_id('E'));
      r_mes       := (SELECT count(*) FROM plateforme.f_mes_acces_compte());
      r_tarif     := plateforme.f_tarif_refacture_pax_zd(test_cv_id('P'));
      r_intervenu := plateforme.f_traiteur_intervenu_lieux_gestionnaire(test_cv_id('P'));
      r_volume    := plateforme.f_volume_repas_realise(test_cv_id('C2'));
      r_lieux     := (SELECT count(*) FROM plateforme.f_benchmark_lieux_parc());
      r_traiteurs := (SELECT count(*) FROM plateforme.f_benchmark_traiteurs_parc());
      r_kgpax     := (SELECT count(*) FROM plateforme.f_benchmark_kg_pax_zd());
      r_single    := (SELECT count(*) FROM plateforme.f_benchmark_single_collecte(test_cv_id('C1')));
      r_v_ref     := (SELECT count(*) FROM plateforme.v_referentiel_traiteurs);
      r_v_reg     := (SELECT count(*) FROM plateforme.v_registre_dechets);
      r_v_attr    := (SELECT count(*) FROM plateforme.v_attributions_gestionnaire);
      r_v_trait   := (SELECT count(*) FROM plateforme.v_traiteurs_gestionnaire);
    ELSE
      a_visible   := plateforme.f_collecte_visible(test_cv_id('C1'));
      a_editable  := plateforme.f_collecte_editable(test_cv_id('E'));
      a_fichier   := shared.f_fichier_visible('plateforme.collectes', test_cv_id('C1'));
      a_dechets   := plateforme.f_dechets_labo_estimes(test_cv_id('E'));
      a_mes       := (SELECT count(*) FROM plateforme.f_mes_acces_compte());
      a_tarif     := plateforme.f_tarif_refacture_pax_zd(test_cv_id('P'));
      a_intervenu := plateforme.f_traiteur_intervenu_lieux_gestionnaire(test_cv_id('P'));
      a_volume    := plateforme.f_volume_repas_realise(test_cv_id('C2'));
      a_lieux     := (SELECT count(*) FROM plateforme.f_benchmark_lieux_parc());
      a_traiteurs := (SELECT count(*) FROM plateforme.f_benchmark_traiteurs_parc());
      a_kgpax     := (SELECT count(*) FROM plateforme.f_benchmark_kg_pax_zd());
      a_single    := (SELECT count(*) FROM plateforme.f_benchmark_single_collecte(test_cv_id('C1')));
      a_v_ref     := (SELECT count(*) FROM plateforme.v_referentiel_traiteurs);
      a_v_reg     := (SELECT count(*) FROM plateforme.v_registre_dechets);
      a_v_attr    := (SELECT count(*) FROM plateforme.v_attributions_gestionnaire);
      a_v_trait   := (SELECT count(*) FROM plateforme.v_traiteurs_gestionnaire);
    END IF;
  END LOOP;

  PERFORM test_cv_contexte(p_role, 'aal1', true);
  b_visible   := plateforme.f_collecte_visible(test_cv_id('C1'));
  b_editable  := plateforme.f_collecte_editable(test_cv_id('E'));
  b_fichier   := shared.f_fichier_visible('plateforme.collectes', test_cv_id('C1'));
  b_dechets   := plateforme.f_dechets_labo_estimes(test_cv_id('E'));
  b_mes       := (SELECT count(*) FROM plateforme.f_mes_acces_compte());
  b_tarif     := plateforme.f_tarif_refacture_pax_zd(test_cv_id('P'));
  b_intervenu := plateforme.f_traiteur_intervenu_lieux_gestionnaire(test_cv_id('P'));
  b_volume    := plateforme.f_volume_repas_realise(test_cv_id('C2'));
  b_v_ref     := (SELECT count(*) FROM plateforme.v_referentiel_traiteurs);
  b_v_reg     := (SELECT count(*) FROM plateforme.v_registre_dechets);
  b_v_attr    := (SELECT count(*) FROM plateforme.v_attributions_gestionnaire);
  b_v_trait   := (SELECT count(*) FROM plateforme.v_traiteurs_gestionnaire);

  -- Refus des 5 fonctions plpgsql, sous la session sans code (rôle courant).
  RETURN NEXT throws_ok(
    'SELECT count(*) FROM plateforme.f_benchmark_lieux_parc()',
    '42501', 'Code de vérification requis',
    p_role || ' sans code : f_benchmark_lieux_parc refusée');
  RETURN NEXT throws_ok(
    'SELECT count(*) FROM plateforme.f_benchmark_traiteurs_parc()',
    '42501', 'Code de vérification requis',
    p_role || ' sans code : f_benchmark_traiteurs_parc refusée');
  RETURN NEXT throws_ok(
    'SELECT count(*) FROM plateforme.f_benchmark_kg_pax_zd()',
    '42501', 'Code de vérification requis',
    p_role || ' sans code : f_benchmark_kg_pax_zd refusée');
  RETURN NEXT throws_ok(
    format('SELECT count(*) FROM plateforme.f_benchmark_single_collecte(%L)', test_cv_id('C1')),
    '42501', 'Code de vérification requis',
    p_role || ' sans code : f_benchmark_single_collecte refusée, sur une collecte réelle');
  RETURN NEXT throws_ok(
    format('SELECT plateforme.f_completer_siret_shadow(%L, %L)', test_cv_id('P'), '12345678900011'),
    '42501', 'Code de vérification requis',
    p_role || ' sans code : f_completer_siret_shadow refusée avant sa garde de rôle');
  PERFORM test_cv_superuser();

  -- Non-vacuité : avant, les fonctions et vues rendaient bien quelque chose.
  RETURN NEXT ok(
    r_visible AND r_editable AND r_fichier AND r_dechets IS NOT NULL AND r_mes = 1
    AND r_tarif IS NOT NULL AND r_lieux > 0 AND r_traiteurs > 0 AND r_single > 0
    AND r_v_ref > 0 AND r_v_reg > 0,
    p_role || ' non-vacuité : avant, collecte visible, événement modifiable, fichier visible, déchets estimés, accès, tarif, lieux, traiteurs, repère, référentiel et registre non vides');

  -- Sans code : rien ne sort des 8 fonctions sql ni des 4 vues.
  RETURN NEXT is(b_visible, false, p_role || ' sans code : f_collecte_visible rend false');
  RETURN NEXT is(b_editable, false, p_role || ' sans code : f_collecte_editable rend false');
  RETURN NEXT is(b_fichier, false, p_role || ' sans code : f_fichier_visible rend false');
  RETURN NEXT is(b_dechets, NULL, p_role || ' sans code : f_dechets_labo_estimes rend NULL');
  RETURN NEXT is(b_mes, 0::bigint, p_role || ' sans code : f_mes_acces_compte ne rend aucune ligne');
  RETURN NEXT is(b_tarif, NULL, p_role || ' sans code : f_tarif_refacture_pax_zd rend NULL');
  RETURN NEXT is(b_intervenu, false, p_role || ' sans code : f_traiteur_intervenu_lieux_gestionnaire rend false');
  RETURN NEXT is(b_volume, 0::numeric, p_role || ' sans code : f_volume_repas_realise rend 0');
  RETURN NEXT is(b_v_ref, 0::bigint, p_role || ' sans code : v_referentiel_traiteurs vide');
  RETURN NEXT is(b_v_reg, 0::bigint, p_role || ' sans code : v_registre_dechets vide');
  RETURN NEXT is(b_v_attr, 0::bigint, p_role || ' sans code : v_attributions_gestionnaire vide');
  RETURN NEXT is(b_v_trait, 0::bigint, p_role || ' sans code : v_traiteurs_gestionnaire vide');

  -- Avec code (aal2) : exactement le résultat d'avant.
  RETURN NEXT is(a_visible, r_visible, p_role || ' avec code : f_collecte_visible inchangée');
  RETURN NEXT is(a_editable, r_editable, p_role || ' avec code : f_collecte_editable inchangée');
  RETURN NEXT is(a_fichier, r_fichier, p_role || ' avec code : f_fichier_visible inchangée');
  RETURN NEXT is(a_dechets, r_dechets, p_role || ' avec code : f_dechets_labo_estimes inchangée');
  RETURN NEXT is(a_mes, r_mes, p_role || ' avec code : f_mes_acces_compte inchangée');
  RETURN NEXT is(a_tarif, r_tarif, p_role || ' avec code : f_tarif_refacture_pax_zd inchangée');
  RETURN NEXT is(a_intervenu, r_intervenu, p_role || ' avec code : f_traiteur_intervenu_lieux_gestionnaire inchangée');
  RETURN NEXT is(a_volume, r_volume, p_role || ' avec code : f_volume_repas_realise inchangée');
  RETURN NEXT is(a_lieux, r_lieux, p_role || ' avec code : f_benchmark_lieux_parc inchangée');
  RETURN NEXT is(a_traiteurs, r_traiteurs, p_role || ' avec code : f_benchmark_traiteurs_parc inchangée');
  RETURN NEXT is(a_kgpax, r_kgpax, p_role || ' avec code : f_benchmark_kg_pax_zd inchangée');
  RETURN NEXT is(a_single, r_single, p_role || ' avec code : f_benchmark_single_collecte inchangée');
  RETURN NEXT is(a_siret, r_siret, p_role || ' avec code : f_completer_siret_shadow inchangée (même refus de rôle)');
  RETURN NEXT is(a_v_ref, r_v_ref, p_role || ' avec code : v_referentiel_traiteurs inchangée');
  RETURN NEXT is(a_v_reg, r_v_reg, p_role || ' avec code : v_registre_dechets inchangée');
  RETURN NEXT is(a_v_attr, r_v_attr, p_role || ' avec code : v_attributions_gestionnaire inchangée');
  RETURN NEXT is(a_v_trait, r_v_trait, p_role || ' avec code : v_traiteurs_gestionnaire inchangée');
END $$;

-- Fixture ---------------------------------------------------------------------
SELECT test_cv_superuser();

INSERT INTO auth.users (id, email) VALUES
  (test_cv_id('A'), 'equipe@code-verification.test'),
  (test_cv_id('T'), 'traiteur@code-verification.test');

-- Facteur TOTP du compte A ; son statut est basculé par test_cv_contexte.
INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
VALUES (test_cv_id('F'), test_cv_id('A'), 'Code de test', 'totp', 'unverified', now(), now());

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, tarif_refacture_pax_zd) VALUES
  (test_cv_id('S'), 'CV Equipe', 'agence',   true, false, DEFAULT),
  (test_cv_id('P'), 'CV Traiteur', 'traiteur', true, false, 1.50);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES (test_cv_id('EF'), test_cv_id('P'), 'CV Traiteur SAS', '11122233300099',
        '1 rue CV', '75001', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  (test_cv_id('A'), test_cv_id('S'), 'equipe@code-verification.test', 'CV', 'Equipe', 'admin_savr'),
  (test_cv_id('T'), test_cv_id('P'), 'traiteur@code-verification.test', 'CV', 'Traiteur', 'traiteur_manager');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif)
VALUES (test_cv_id('L'), 'CV Lieu', '2 rue CV', '75002', 'Paris', 'fourgon', true);

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES (test_cv_id('TE'), 'cv_cocktail', 'CV Cocktail');

INSERT INTO plateforme.evenements
  (id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, lieu_id,
   created_by, type_evenement_id, pax, contact_principal_nom, contact_principal_telephone)
VALUES (test_cv_id('E'), test_cv_id('P'), test_cv_id('P'), test_cv_id('EF'), test_cv_id('L'),
        test_cv_id('T'), test_cv_id('TE'), 300, 'CV Contact', '0600000000');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte) VALUES
  (test_cv_id('C1'), test_cv_id('E'), 'zero_dechet', 'cloturee',   current_date - 1, '06:00'),
  (test_cv_id('C2'), test_cv_id('E'), 'anti_gaspi',  'programmee', current_date + 3, '22:00');

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT test_cv_id('C1'), fd.id, 42.0 FROM plateforme.flux_dechets fd WHERE fd.code = 'verre';

INSERT INTO plateforme.coefficients_perte_labo
  (organisation_id, annee_reference, coefficient_kg_couvert, saisi_par)
SELECT test_cv_id('P'), EXTRACT(YEAR FROM e.date_evenement)::integer - 1, 0.25, test_cv_id('A')
  FROM plateforme.evenements e WHERE e.id = test_cv_id('E');

INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact)
VALUES (test_cv_id('AS'), 'CV Asso', '3 rue CV', 'idf', 'Paris', 'asso@code-verification.test',
        'Association de test du code de vérification.');

INSERT INTO plateforme.alertes_admin (code, titre, entity_type, entity_id)
VALUES ('cv_test', 'Alerte de test', 'collectes', test_cv_id('C1'));

INSERT INTO plateforme.audit_log (user_id, action, table_name, record_id, new_values)
VALUES (test_cv_id('A'), 'impersonation_session', 'users', test_cv_id('A'), '{}');

-- Garde anti-fixture-vide : le flux 'verre' et la date de l'événement existent.
DO $$ BEGIN
  IF (SELECT count(*) FROM plateforme.collecte_flux WHERE collecte_id = test_cv_id('C1')) <> 1
     OR (SELECT count(*) FROM plateforme.coefficients_perte_labo WHERE organisation_id = test_cv_id('P')) <> 1 THEN
    RAISE EXCEPTION 'Fixture invalide : flux verre ou date de l''événement absents';
  END IF;
END $$;

-- =============================================================================
-- 1-11. La règle, cas par cas
-- =============================================================================
SELECT test_cv_contexte('traiteur_manager', 'aal1', true);
SELECT is(plateforme.f_code_verification_ok(), true,
  '1. client, aal1, compte avec un code activé : passe (la règle ne vise que l''équipe Savr)');
SELECT test_cv_jwt(NULL, NULL, test_cv_id('A'));
SELECT is(plateforme.f_code_verification_ok(), true,
  '2. jeton sans rôle métier : passe');
SELECT test_cv_contexte('admin_savr', 'aal1', false);
SELECT is(plateforme.f_code_verification_ok(), true,
  '3. admin_savr, aal1, code pas encore activé (facteur unverified) : passe, comme avant');
SELECT test_cv_superuser();
UPDATE auth.mfa_factors SET user_id = test_cv_id('T') WHERE id = test_cv_id('F');
SELECT test_cv_jwt('admin_savr', 'aal1', test_cv_id('A'));
SELECT is(plateforme.f_code_verification_ok(), true,
  '4. admin_savr, aal1, aucun facteur : passe, comme avant');
SELECT test_cv_superuser();
UPDATE auth.mfa_factors SET user_id = test_cv_id('A') WHERE id = test_cv_id('F');
SELECT test_cv_contexte('admin_savr', 'aal1', true);
SELECT is(plateforme.f_code_verification_ok(), false,
  '5. admin_savr, aal1, code activé : REFUS');
SELECT test_cv_contexte('ops_savr', 'aal1', true);
SELECT is(plateforme.f_code_verification_ok(), false,
  '6. ops_savr, aal1, code activé : REFUS');
SELECT test_cv_contexte('admin_savr', 'aal2', true);
SELECT is(plateforme.f_code_verification_ok(), true,
  '7. admin_savr, aal2, code activé : passe');
SELECT test_cv_contexte('ops_savr', 'aal2', true);
SELECT is(plateforme.f_code_verification_ok(), true,
  '8. ops_savr, aal2, code activé : passe');
SELECT test_cv_contexte('admin_savr', NULL, true);
SELECT is(plateforme.f_code_verification_ok(), false,
  '9. admin_savr, claim aal absent, code activé : REFUS');
SELECT test_cv_superuser();
SELECT test_cv_jwt('admin_savr', 'aal1', NULL);
SELECT is(plateforme.f_code_verification_ok(), false,
  '10. admin_savr sans sub (titulaire inconnu) : REFUS');
SELECT test_cv_jwt('ops_savr', 'aal3', test_cv_id('A'));
SELECT is(plateforme.f_code_verification_ok(), false,
  '11. ops_savr, aal inattendu (ni aal1 ni aal2), code activé : REFUS');

-- =============================================================================
-- 12-18. Cliquets de structure
-- =============================================================================
SELECT test_cv_superuser();

SELECT is_empty(
  $$
  SELECT n.nspname || '.' || c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('plateforme', 'shared') AND c.relkind IN ('r', 'p')
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = n.nspname AND p.tablename = c.relname
          AND p.policyname = 'code_verification_equipe_savr'
          AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL'
          AND p.roles = '{authenticated}'
          AND p.qual = 'plateforme.f_code_verification_ok()'
          AND p.with_check = 'plateforme.f_code_verification_ok()')
  $$,
  '12. cliquet : chaque table de plateforme et shared porte la policy restrictive code_verification_equipe_savr (nouvelle table : la poser, cf. docs/claude/code-verification.md)');

SELECT ok(
  (SELECT count(*) FROM pg_policies
    WHERE policyname = 'code_verification_equipe_savr' AND schemaname IN ('plateforme', 'shared')) >= 60,
  '13. non-vacuité : la policy restrictive est posée sur au moins 60 tables');

SELECT is_empty(
  $$
  SELECT n.nspname || '.' || p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('plateforme', 'shared')
     AND p.prosecdef
     AND pg_get_function_result(p.oid) <> 'trigger'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND p.proname NOT IN ('health_ping', 'f_code_verification_active')
     AND p.prosrc NOT LIKE '%plateforme.f_code_verification_ok()%'
  $$,
  '14. cliquet : chaque fonction SECURITY DEFINER ouverte à authenticated appelle f_code_verification_ok (health_ping : constante)');

SELECT is_empty(
  $$
  SELECT c.oid::regclass::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('plateforme', 'shared') AND c.relkind IN ('v', 'm')
     AND has_table_privilege('authenticated', c.oid, 'SELECT')
     AND coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions)
                    WHERE option_name = 'security_invoker'), 'false') NOT IN ('true', 'on', '1')
     AND pg_get_viewdef(c.oid) NOT LIKE '%plateforme.f_code_verification_ok()%'
  $$,
  '15. cliquet : chaque vue security_invoker = false lisible par authenticated appelle f_code_verification_ok');

SELECT ok(
  NOT p.prosecdef AND p.proconfig IS NULL AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
  AND p.provolatile = 's',
  '16. f_code_verification_ok : sql STABLE, SECURITY INVOKER, sans SET (intégrée à la requête, aucune lecture pour un client)')
FROM pg_proc p WHERE p.oid = 'plateforme.f_code_verification_ok()'::regprocedure;

SELECT ok(
  p.prosecdef AND p.proconfig = ARRAY['search_path=""'],
  '17. f_code_verification_active : SECURITY DEFINER, search_path vide')
FROM pg_proc p WHERE p.oid = 'plateforme.f_code_verification_active()'::regprocedure;

-- Ensemble EXACT des bénéficiaires d'EXECUTE (aclexplode) : has_function_privilege
-- serait vert aussi après un GRANT à PUBLIC.
SELECT is(
  (SELECT array_agg(DISTINCT p.proname || ':' || coalesce(r.rolname, 'PUBLIC') ORDER BY p.proname || ':' || coalesce(r.rolname, 'PUBLIC'))
     FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(p.proacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.oid IN ('plateforme.f_code_verification_ok()'::regprocedure,
                    'plateforme.f_code_verification_active()'::regprocedure)
      AND a.privilege_type = 'EXECUTE'),
  ARRAY['f_code_verification_active:authenticated', 'f_code_verification_active:postgres',
        'f_code_verification_active:service_role',
        'f_code_verification_ok:authenticated', 'f_code_verification_ok:postgres',
        'f_code_verification_ok:service_role'],
  '18. EXECUTE des deux fonctions : authenticated, service_role et le propriétaire seulement (ni anon ni PUBLIC)');

-- =============================================================================
-- 19-30. Balayage de toutes les tables (lecture et écriture), par rôle
-- =============================================================================
SELECT * FROM test_cv_balayage('admin_savr');
SELECT * FROM test_cv_balayage('ops_savr');

-- =============================================================================
-- 31-34. Écriture refusée nommément : création d'une association
-- =============================================================================
SELECT test_cv_contexte('admin_savr', 'aal1', true);
SELECT throws_ok(
  $$INSERT INTO plateforme.associations (nom, adresse, region, ville, contact_email, description_rapport_impact)
    VALUES ('CV Asso 2', '4 rue CV', 'idf', 'Paris', 'asso2@code-verification.test',
            'Association de test du code de vérification.')$$,
  '42501', 'new row violates row-level security policy "code_verification_equipe_savr" for table "associations"',
  '31. admin_savr sans code : création d''une association refusée par la policy restrictive');
SELECT test_cv_contexte('admin_savr', 'aal2', true);
SELECT lives_ok(
  $$INSERT INTO plateforme.associations (nom, adresse, region, ville, contact_email, description_rapport_impact)
    VALUES ('CV Asso 3', '5 rue CV', 'idf', 'Paris', 'asso3@code-verification.test',
            'Association de test du code de vérification.')$$,
  '32. admin_savr avec code : création d''une association acceptée (miroir)');
SELECT test_cv_contexte('ops_savr', 'aal1', true);
SELECT results_eq(
  $$WITH m AS (UPDATE plateforme.associations SET ville = 'Lyon' WHERE id = test_cv_id('AS') RETURNING 1)
    SELECT count(*)::int FROM m$$,
  $$VALUES (0)$$,
  '33. ops_savr sans code : modification d''une association, 0 ligne touchée');
SELECT test_cv_contexte('ops_savr', 'aal2', true);
SELECT results_eq(
  $$WITH m AS (UPDATE plateforme.associations SET ville = 'Lyon' WHERE id = test_cv_id('AS') RETURNING 1)
    SELECT count(*)::int FROM m$$,
  $$VALUES (1)$$,
  '34. ops_savr avec code : modification d''une association, 1 ligne touchée (miroir)');

-- =============================================================================
-- 35-104. Fonctions SECURITY DEFINER et vues « droits du propriétaire », par rôle
-- =============================================================================
SELECT test_cv_superuser();
UPDATE plateforme.associations SET ville = 'Paris' WHERE id = test_cv_id('AS');
SELECT * FROM test_cv_fonctions('admin_savr');
SELECT * FROM test_cv_fonctions('ops_savr');

SELECT * FROM finish();
ROLLBACK;
