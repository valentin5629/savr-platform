-- =============================================================================
-- `collectes.lieu_overrides` — les valeurs doivent être du TEXTE
-- =============================================================================
-- Défaut relevé par le reviewer sécurité en marge de #307 (pré-existant à #304),
-- dont #308 a fermé le volet applicatif. Cette migration ferme le volet base,
-- qui y est explicitement laissé ouvert (« Reste ouvert », P1).
--
-- `lieu_overrides` est un jsonb LIBRE : aucun schéma, aucun CHECK. La fusion côté
-- adapter bornait les CLÉS (allowlist fermée) mais pas le TYPE des valeurs, si
-- bien qu'une valeur non textuelle finissait interpolée dans l'adresse envoyée
-- au transporteur :
--
--   {"adresse_acces": {"a": 1}}      → "[object Object], 75008 Paris"
--   {"adresse_acces": ["x","y"]}     → "x,y, 75008 Paris"
--   {"adresse_acces": 42}            → "42, 75008 Paris"
--
-- Pas d'injection (le corps part en JSON.stringify, un CRLF est échappé), mais
-- une adresse-poubelle transmise au transporteur — donc un camion envoyé nulle
-- part, de nuit.
--
-- Le correctif porte à trois niveaux, et celui-ci est le dernier :
--   1. ÉCRITURE applicative — `validerLieuOverrides` (#308) refuse en 422 sur
--      les deux routes qui écrivent ce champ ;
--   2. LECTURE — fusion adapter (`lieuChampSurcharge`) : une valeur non
--      textuelle n'est pas une surcharge, le transporteur reçoit l'adresse
--      officielle du lieu plutôt qu'un artefact de coercition ;
--   3. CETTE CONTRAINTE → le seul niveau qui tienne les écritures ne passant par
--      AUCUNE route Next :
--        · `fn_creer_collecte` / `fn_modifier_collecte` appelées directement
--          sous service_role (script, seed, migration, session psql) ;
--        · PostgREST direct — `authenticated` porte un `GRANT UPDATE` sur
--          `plateforme.collectes` (20260611180000) et la policy
--          `col_update_client` (20260617180000) laisse un traiteur modifier sa
--          propre collecte non terminale. Le worker relit `lieu_overrides` sur
--          la ligne au moment de consommer l'event : la valeur ainsi écrite
--          atteint donc bien le transporteur.
--      Cette migration NE touche AUCUN GRANT ni aucune policy : restreindre le
--      GRANT UPDATE d'`authenticated` à une liste blanche de colonnes relève de
--      l'arbitrage Val (CLAUDE.md §12 pt 2bis) et exige un recensement des
--      colonnes réellement écrites en PostgREST direct. La contrainte, elle, est
--      purement additive et vaut pour tous les rôles.
--
-- PÉRIMÈTRE : le TYPE des valeurs, pas leur longueur ni leurs clés.
--   - longueurs : bornées par champ à l'écriture par #308 (200 / 16 / 120 /
--     1000 / 500) et plafonnées à la lecture par `LONGUEUR_MAX_SURCHARGE_LUE`
--     (packages/adapters). Les recopier ici garantirait le drift entre des
--     nombres SQL et des nombres TS, pour des valeurs applicatives appelées à
--     bouger quand MTS-1 aura donné sa vraie limite ;
--   - clés : l'allowlist d'entrée (#308) et celle de fusion sont fermées, chacune
--     dans son package ; les figer une troisième fois en SQL ferait qu'ajouter un
--     champ éditable au formulaire exigerait une migration.
--
-- Types admis, calés sur ce que le formulaire produit réellement
-- (`computeLieuOverrides`, lieu-champs-editables.tsx) et sur ce que #308 accepte :
-- chaîne (y compris vide — le « Non renseigné » des selects), tableau de chaînes
-- (`flux_autorises`, colonne `lieux.flux_autorises` text[]), et `null` (ignoré en
-- aval). La contrainte est donc strictement plus permissive que la validation
-- d'entrée : elle ne peut pas refuser une écriture que #308 a laissée passer.
--
-- ÉTAT DES DONNÉES VÉRIFIÉ AVANT POSE — dev (`savr-dev`) et prod (`savr-prod`,
-- lecture seule forcée `default_transaction_read_only=on`) :
--   collectes avec lieu_overrides non NULL : 0 en dev, 0 en prod
--   dont valeur non textuelle : 0
-- → la contrainte est posée VALIDÉE, sans NOT VALID ni nettoyage préalable.
--
-- Backward-compatible / purement additive : aucune colonne ajoutée, renommée ou
-- supprimée, aucun type modifié, aucun accès ouvert ni élargi (la fonction est
-- SECURITY INVOKER, ne lit aucune table, et son EXECUTE à PUBLIC est REQUIS —
-- un CHECK s'évalue avec les droits de celui qui écrit, un REVOKE casserait
-- l'INSERT pour `authenticated`). Hors diff structurel G6 (schema-vs-cible
-- compare les COLONNES ; le DDL cible V2 n'embarque ni CHECK ni index).
--
-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
--   ALTER TABLE plateforme.collectes
--     DROP CONSTRAINT IF EXISTS chk_collectes_lieu_overrides_textuel;
--   DROP FUNCTION IF EXISTS plateforme.f_lieu_overrides_textuel(jsonb);
-- =============================================================================

-- ─── 1. Prédicat ─────────────────────────────────────────────────────────────
-- Une fonction et non une expression inline : un CHECK n'admet pas de
-- sous-requête, et « chaque valeur de l'objet » en exige une (jsonb_each).
-- IMMUTABLE (pure, aucune lecture), search_path épinglé à pg_catalog pour que
-- la résolution des fonctions ne dépende pas du search_path de l'appelant.

CREATE OR REPLACE FUNCTION plateforme.f_lieu_overrides_textuel(p_overrides jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT p_overrides IS NULL
      OR (
        jsonb_typeof(p_overrides) = 'object'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_each(p_overrides) AS e
          WHERE jsonb_typeof(e.value) NOT IN ('string', 'null', 'array')
             OR (
               jsonb_typeof(e.value) = 'array'
               AND EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements(e.value) AS a
                 WHERE jsonb_typeof(a) <> 'string'
               )
             )
        )
      );
$$;

COMMENT ON FUNCTION plateforme.f_lieu_overrides_textuel(jsonb) IS
  'Vrai si lieu_overrides ne contient que des valeurs textuelles (chaîne, tableau de chaînes, null). Prédicat du CHECK chk_collectes_lieu_overrides_textuel.';

-- ─── 2. Contrainte ───────────────────────────────────────────────────────────
-- `ADD CONSTRAINT` n'a pas d'IF NOT EXISTS : on absorbe le doublon pour rester
-- rejouable.

DO $$ BEGIN
  ALTER TABLE plateforme.collectes
    ADD CONSTRAINT chk_collectes_lieu_overrides_textuel
    CHECK (plateforme.f_lieu_overrides_textuel(lieu_overrides));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
