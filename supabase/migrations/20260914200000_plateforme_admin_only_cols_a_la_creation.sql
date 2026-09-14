-- Colonnes admin-only : fermeture du volet CRÉATION (INSERT)
--
-- CONTEXTE (revue reviewer-rls-securite sur la PR #299, colonne associations.numero_rup) :
-- les colonnes « édition admin-only » du CDC (§09 matrice ops l.397/402-403/407,
-- §06.06 §5) n'étaient protégées que sur l'UPDATE — `trg_ops_immutable_cols` est un
-- BEFORE UPDATE (migrations 20260629120000 / 20260702020100), donc muet à l'INSERT.
-- Audit des 3 tables qui portent ce trigger, chemin par chemin :
--
--   • plateforme.associations — ops n'a AUCUNE policy INSERT (asso_ops_select +
--     asso_ops_update seulement, 20260611180000 / 20260617180000) : l'INSERT PostgREST
--     d'un JWT ops est déjà refusé par la RLS. Étendre le trigger à l'INSERT serait du
--     code mort (il s'exempte en plus dès que f_app_role() n'est pas 'ops_savr', donc
--     sous service_role). Le vrai trou était côté route (POST /api/v1/admin/associations
--     gardé par requireStaff seul, écriture service_role) — fermé applicativement dans
--     le même commit. Invariant RLS désormais ÉPINGLÉ par pgTAP, assertions 1 à 3 de
--     supabase/tests/SECU__admin_only_cols_insert.test.sql (le jeu de policies ouvrant
--     l'INSERT y est comparé à {asso_admin}) : si une policy INSERT apparaît un jour,
--     le test rougit et la décision redevient explicite.
--
--   • plateforme.factures — idem, ops n'a que fac_ops_select + fac_ops_update ;
--     l'avoir/la facture passent par la route admin service_role. Épinglé de la même
--     façon, assertions 4 et 5 du même fichier ({fac_admin}).
--
--   • plateforme.organisations — SEUL trou DB réel, et il est ouvert à un rôle CLIENT,
--     pas à ops : `org_agence_insert_shadow` (20260611180000) autorise une `agence` à
--     INSÉRER une fiche traiteur shadow, et `authenticated` a le privilège INSERT
--     table-level (GRANT 0.4a l.27). Le durcissement colonne de M3.1 (20260616130000)
--     ne porte QUE sur l'UPDATE (REVOKE UPDATE + GRANT UPDATE liste blanche) : à
--     l'INSERT, une agence pouvait donc poser elle-même `tarif_refacture_pax_zd`
--     (§09 l.407 + §06.04 : écriture admin-only — c'est le tarif que Savr refacture,
--     il alimente le KPI Marge), ainsi que `grille_tarifaire_zd_id`, `notes_internes`,
--     `actif` et `mode_facturation_zd` — toutes hors liste blanche M3.1 (donc
--     staff-only à l'UPDATE) et toutes présentes dans les champs éditables de la route
--     back-office staff. → C'est ce trou que cette migration ferme.
--     Les 3 autres colonnes sensibles de la table (`type`, `est_shadow`,
--     `cree_par_organisation_id`) sont déjà épinglées par le WITH CHECK de
--     `org_agence_insert_shadow` : rien à ajouter ici.
--     NB `mode_facturation_zd` a été ajoutée après M3.1 (migration 20260619150000) et
--     ne figure donc pas dans le commentaire de liste blanche cité plus haut — c'est
--     pour cela qu'elle n'avait jamais été reconsidérée (relevé reviewer-rls-securite).
--
-- Pattern : garde de VALEUR à l'INSERT, sur le modèle de fn_ops_block_facture_annulation
-- (même migration 20260629120000) — et NON une extension de fn_ops_block_column_change,
-- qui compare OLD/NEW et casserait sur INSERT (OLD n'est pas assigné). On ne touche pas
-- cette fonction partagée : aucune régression possible sur les gardes UPDATE existantes.
--
-- Exemption : f_app_role() NULL = écriture service_role (routes admin / route shadow
-- /api/v1/programmation/organisations/shadow) ou postgres (seed, migration) → non gardé,
-- comme toutes les autres gardes de cette famille. Seul un JWT applicatif non-admin est
-- concerné, c'est-à-dire exactement le chemin PostgREST direct.
--
-- Non destructif : création d'une fonction + d'un trigger, aucune donnée touchée, aucun
-- GRANT, aucune policy. FERME un accès (jamais ne l'élargit) — CLAUDE.md §12-2bis.

CREATE OR REPLACE FUNCTION plateforme.fn_block_org_staff_cols_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_role text := plateforme.f_app_role();
BEGIN
  -- service_role (routes) et postgres (seed/migration) → f_app_role() NULL : exemptés.
  -- admin_savr écrit légitimement ces colonnes (§09 l.407).
  IF v_role IS NULL OR v_role = 'admin_savr' THEN
    RETURN NEW;
  END IF;

  -- Valeurs « neutres » = les défauts déclarés des colonnes (`1.50`, `true`,
  -- `'par_collecte'`, NULL). Laisser la colonne à son défaut est autorisé ; POSER une
  -- valeur ne l'est pas. Ces 3 constantes en dur sont épinglées par pgTAP
  -- (`col_default_is`) ET par le contrôle positif « fiche shadow créable » : si un
  -- défaut dérivait, le test rougirait avant que la garde ne se mette à refuser
  -- silencieusement toutes les créations légitimes.
  IF NEW.tarif_refacture_pax_zd IS DISTINCT FROM 1.50 THEN
    RAISE EXCEPTION
      'Seul admin_savr peut fixer organisations.tarif_refacture_pax_zd (§09 l.407)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.grille_tarifaire_zd_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Seul admin_savr peut affecter organisations.grille_tarifaire_zd_id (§09 l.137)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.notes_internes IS NOT NULL THEN
    RAISE EXCEPTION
      'Seul le staff Savr peut écrire organisations.notes_internes'
      USING ERRCODE = '42501';
  END IF;

  -- `actif` : la désactivation (comme l'activation) d'une organisation est une action
  -- staff (hors liste blanche M3.1). Une création doit laisser le défaut `true`.
  IF NEW.actif IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'Seul le staff Savr peut fixer organisations.actif à la création'
      USING ERRCODE = '42501';
  END IF;

  -- `mode_facturation_zd` : paramètre de facturation (§06.08), staff-only. Comparaison
  -- via ::text sur une valeur DÉJÀ typée : le rôle `authenticated` n'a pas USAGE pour
  -- résoudre `plateforme.mode_facturation_zd_enum` par NOM dans une fonction
  -- SECURITY INVOKER (même précaution que fn_users_block_role_escalation, 20260629120000).
  IF NEW.mode_facturation_zd::text IS DISTINCT FROM 'par_collecte' THEN
    RAISE EXCEPTION
      'Seul le staff Savr peut fixer organisations.mode_facturation_zd à la création'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_org_staff_cols_insert ON plateforme.organisations;
CREATE TRIGGER trg_block_org_staff_cols_insert
  BEFORE INSERT ON plateforme.organisations
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_block_org_staff_cols_insert();

-- ROLLBACK (purement additif — garde de sécurité, aucune donnée touchée) :
--   DROP TRIGGER IF EXISTS trg_block_org_staff_cols_insert ON plateforme.organisations;
--   DROP FUNCTION IF EXISTS plateforme.fn_block_org_staff_cols_insert();
