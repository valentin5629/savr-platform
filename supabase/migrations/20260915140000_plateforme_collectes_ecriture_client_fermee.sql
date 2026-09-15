-- =============================================================================
-- Intégrité de `plateforme.collectes` : fermer l'écriture PostgREST directe des
-- clients + borner `lieu_overrides` EN BASE.
--
-- Source : dette P1 laissée ouverte par #308 (validerLieuOverrides borne les deux
-- ROUTES applicatives, pas la COLONNE). Arbitrage Val 2026-09-15 (CLAUDE.md §12
-- pt 2bis — migration de FERMETURE, périmètre tranché avant codage).
--
-- LE DÉFAUT
-- ---------
-- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plateforme TO
-- authenticated` (0.4a) est table-level : la RLS filtre les LIGNES, jamais les
-- COLONNES. Un client authentifié légitime peut donc, avec la clé anon (publique)
-- et son propre JWT, écrire directement :
--
--   PATCH /rest/v1/collectes?id=eq.<sa-collecte>   (policy col_update_client)
--   POST  /rest/v1/collectes                        (policy col_insert)
--
-- et poser n'importe quelle valeur dans n'importe quelle colonne — dont
-- `lieu_overrides`, qui n'a aucun schéma. La valeur atteint le transporteur :
-- `fetchCollecte` (packages/adapters/src/outbox-worker.ts) relit `lieu_overrides`
-- sur la LIGNE COURANTE au moment de consommer l'event, jamais dans le payload —
-- donc tout E1/E2 ultérieur repart avec l'override empoisonné.
--
-- Ce n'est PAS une fuite cross-organisation (le cloisonnement par org tient, le
-- statut est borné) : c'est un défaut d'INTÉGRITÉ de la donnée transmise au
-- transporteur.
--
-- LA FERMETURE (deux verrous indépendants, volontairement redondants)
-- ------------------------------------------------------------------
-- 1. CHECK sur la colonne : borne `lieu_overrides` quel que soit l'écrivain —
--    y compris service_role et un futur worker. Le CHECK est le seul verrou qui
--    survit à une route nouvelle qui oublierait d'appeler `validerLieuOverrides`.
-- 2. REVOKE UPDATE + INSERT : recentre TOUTE écriture sur les routes applicatives,
--    qui seules émettent l'outbox (E1/E2), tracent l'audit_log et posent
--    `dirty_tms` / la ré-acceptation.
--
-- Le verrou 2 couvre plus que `lieu_overrides` : un PATCH direct sur
-- `date_collecte` n'émet PAS E2, donc le transporteur garderait l'ancienne date.
-- Recensement exhaustif préalable (52 fichiers touchant `collectes`) : AUCUN
-- chemin applicatif n'écrit `collectes` sous JWT client — 100 % des mutations
-- passent par des routes API sous `createAdminSupabaseClient` (service_role, non
-- concerné par un REVOKE sur `authenticated`). `createBrowserSupabaseClient` n'est
-- utilisé que pour `auth.*` (zéro `.from(...)` navigateur). La liste blanche de
-- colonnes ré-accordées est donc VIDE : aucun écran ne peut casser.
--
-- NON TOUCHÉ (délibéré) :
--   • SELECT et DELETE restent accordés (`col_select`, `col_delete_brouillon` —
--     suppression de son propre brouillon, bornée par #297).
--   • Les policies `col_update_client` / `col_update_commercial` / `col_insert`
--     sont CONSERVÉES (arbitrage Val) : la fermeture se fait au niveau privilège,
--     pas RLS. Elles redeviendraient actives si un besoin JWT-scopé réapparaissait.
-- =============================================================================

-- COEXISTENCE AVEC #312 (`20260915120000_plateforme_lieu_overrides_valeurs_textuelles`)
-- ------------------------------------------------------------------------------
-- Une session parallèle a livré `chk_collectes_lieu_overrides_textuel` sur la même
-- colonne (prédicat `f_lieu_overrides_textuel`) : elle borne les TYPES (string /
-- null / array de string) sans connaître les clés. L'en-tête de cette migration-là
-- annonçait explicitement que « restreindre le GRANT UPDATE d'`authenticated` à une
-- liste blanche de colonnes relève de l'arbitrage Val §12 pt 2bis » — c'est
-- précisément l'objet de la présente migration, qui en est la suite.
--
-- Les deux contraintes COEXISTENT volontairement. Celle-ci est un sur-ensemble
-- strict (mêmes types, PLUS l'allowlist des 9 clés, les bornes par champ et les
-- valeurs d'enum) : tout ce qu'elle accepte est déjà accepté par #312, donc aucune
-- écriture légitime ne peut être refusée par l'une et pas par l'autre. On ne
-- supprime pas #312 pour autant : son fichier pgTAP (219 lignes) porte un cliquet
-- utile — un UPDATE légitime rejoué sous rôle `authenticated`, qui attrape le cas
-- où un REVOKE sur le prédicat rendrait la contrainte inatteignable (42501 au lieu
-- de 23514). La supprimer ferait rougir ce cliquet pour un gain nul : deux appels
-- de fonction pure par écriture.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CHECK `lieu_overrides` — miroir en base de l'allowlist applicative
-- ─────────────────────────────────────────────────────────────────────────────
-- Miroir exact de `CHAMPS_LIEU_OVERRIDABLES`
-- (packages/plateforme/src/lib/programmation/lieu-override.ts, CDC §06.01 l.104-106) :
-- tous les champs du lieu éditables à la programmation, sauf le nom (identifiant)
-- et les champs admin/ops-only (`commentaire_lieu`, `siren`, `email_gestionnaire`,
-- `reference_citeo`).
--
-- Les bornes de longueur sont APPLICATIVES (les colonnes de `plateforme.lieux` sont
-- des `text` sans contrainte) : elles n'existent que pour borner ce qui part au
-- transporteur. Les trois enums reprennent les VALEURS des types Postgres
-- correspondants sous forme de littéraux texte — jamais le type lui-même, pour ne
-- pas dépendre d'un nom d'enum susceptible d'avoir été renommé.
--
-- `null` est accepté partout sauf sur les trois champs NOT NULL en base
-- (`adresse_acces`, `code_postal`, `ville`) : un override qui EFFACE l'adresse
-- produirait exactement l'adresse impossible que l'on cherche à empêcher. Côté
-- fusion, un `null` n'écrase jamais la valeur de référence du lieu — « non
-- renseigné » veut donc bien dire « pas de surcharge ».
--
-- Fonction dédiée (et non expression inline) parce qu'un CHECK ne peut pas contenir
-- de sous-requête : `jsonb_each` / `jsonb_array_elements` ne sont accessibles qu'à
-- travers un appel de fonction. IMMUTABLE (obligatoire dans un CHECK), et non
-- SECURITY DEFINER — c'est une fonction pure, sans aucun accès aux données, donc
-- l'EXECUTE par défaut à PUBLIC est sans conséquence ET nécessaire : le CHECK doit
-- pouvoir s'évaluer sous le rôle de l'écrivain, quel qu'il soit.
CREATE OR REPLACE FUNCTION plateforme.f_lieu_overrides_valide(p_overrides jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT p_overrides IS NULL
      OR jsonb_typeof(p_overrides) = 'null'
      OR (
        jsonb_typeof(p_overrides) = 'object'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_each(p_overrides) AS e(cle, val)
          WHERE NOT CASE e.cle
            -- Champs NOT NULL en base : chaîne non vide obligatoire.
            WHEN 'adresse_acces' THEN
              jsonb_typeof(e.val) = 'string'
              AND length(e.val #>> '{}') <= 200
              AND btrim(e.val #>> '{}') <> ''
              AND (e.val #>> '{}') !~ '[[:cntrl:]]'
            WHEN 'code_postal' THEN
              jsonb_typeof(e.val) = 'string'
              AND length(e.val #>> '{}') <= 16
              AND btrim(e.val #>> '{}') <> ''
              AND (e.val #>> '{}') !~ '[[:cntrl:]]'
            WHEN 'ville' THEN
              jsonb_typeof(e.val) = 'string'
              AND length(e.val #>> '{}') <= 120
              AND btrim(e.val #>> '{}') <> ''
              AND (e.val #>> '{}') !~ '[[:cntrl:]]'

            -- Champs facultatifs : `null` = effacement de la surcharge.
            WHEN 'acces_details' THEN
              jsonb_typeof(e.val) = 'null'
              OR (jsonb_typeof(e.val) = 'string'
                  AND length(e.val #>> '{}') <= 1000
                  AND (e.val #>> '{}') !~ '[[:cntrl:]]')
            WHEN 'contraintes_horaires' THEN
              jsonb_typeof(e.val) = 'null'
              OR (jsonb_typeof(e.val) = 'string'
                  AND length(e.val #>> '{}') <= 500
                  AND (e.val #>> '{}') !~ '[[:cntrl:]]')

            -- Enums (valeurs de `difficulte_acces` / `type_vehicule`, en littéraux).
            WHEN 'stationnement' THEN
              jsonb_typeof(e.val) = 'null'
              OR (e.val #>> '{}') = ANY (ARRAY['facile', 'difficile', 'tres_difficile'])
            WHEN 'acces_office' THEN
              jsonb_typeof(e.val) = 'null'
              OR (e.val #>> '{}') = ANY (ARRAY['facile', 'difficile', 'tres_difficile'])
            WHEN 'type_vehicule_max' THEN
              jsonb_typeof(e.val) = 'null'
              OR (e.val #>> '{}') = ANY (ARRAY['velo_cargo', 'camionnette', 'fourgon', 'vul', 'poids_lourd'])

            -- `lieux.flux_autorises` est un `text[]` → liste de chaînes non vides.
            WHEN 'flux_autorises' THEN
              jsonb_typeof(e.val) = 'null'
              OR (
                jsonb_typeof(e.val) = 'array'
                AND jsonb_array_length(e.val) <= 20
                AND NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(e.val) AS a(item)
                  WHERE jsonb_typeof(a.item) <> 'string'
                     OR length(a.item #>> '{}') > 64
                     OR btrim(a.item #>> '{}') = ''
                     OR (a.item #>> '{}') ~ '[[:cntrl:]]'
                )
              )

            -- Toute autre clé est refusée (allowlist stricte).
            ELSE false
          END
        )
      )
$$;

COMMENT ON FUNCTION plateforme.f_lieu_overrides_valide(jsonb) IS
  'Prédicat du CHECK collectes_lieu_overrides_valide_chk. Miroir en base de l''allowlist applicative CHAMPS_LIEU_OVERRIDABLES (§06.01) : clés autorisées, types, bornes de longueur, valeurs d''enum. Pure et IMMUTABLE (utilisable dans un CHECK), jamais SECURITY DEFINER.';

-- Audit préalable des lignes existantes (lecture seule, 2026-09-15) : dev = 653
-- collectes dont 0 avec `lieu_overrides`, prod = 0 collecte. Aucune ligne à
-- régulariser → la contrainte est posée VALIDE d'emblée, sans le détour
-- `NOT VALID` + `VALIDATE CONSTRAINT`.
ALTER TABLE plateforme.collectes
  DROP CONSTRAINT IF EXISTS collectes_lieu_overrides_valide_chk;
ALTER TABLE plateforme.collectes
  ADD CONSTRAINT collectes_lieu_overrides_valide_chk
  CHECK (plateforme.f_lieu_overrides_valide(lieu_overrides));

COMMENT ON COLUMN plateforme.collectes.lieu_overrides IS
  'Surcharge per-collecte des champs du lieu saisie à la programmation (§06.01). Borné par collectes_lieu_overrides_valide_chk : clés ⊆ allowlist, valeurs string / liste de string / null, longueurs bornées. Lu par l''adapter sur la LIGNE COURANTE au moment de consommer l''outbox — donc toute valeur stockée atteint le transporteur.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REVOKE UPDATE + INSERT sur `collectes` pour `authenticated`
-- ─────────────────────────────────────────────────────────────────────────────
-- Même pattern que M3.1 sur `organisations` (20260616130000), à la différence près
-- qu'ici la liste blanche ré-accordée est VIDE : aucun chemin applicatif n'écrit
-- `collectes` sous JWT client.
--
-- ⚠ Un REVOKE sur une seule colonne serait INOPÉRANT tant que le privilège
-- table-level subsiste (le grant table couvre toutes les colonnes et prime) : on
-- retire donc le privilège table-level, et on ne re-GRANT rien.
--
-- service_role n'est pas concerné (privilèges séparés) : les routes API continuent
-- d'écrire normalement. `anon` n'a jamais rien reçu (0.4a).
REVOKE UPDATE, INSERT ON plateforme.collectes FROM authenticated;

COMMENT ON TABLE plateforme.collectes IS
  'Collecte des invendus (AG / ZD). Écriture FERMÉE à `authenticated` depuis 2026-09-15 : UPDATE et INSERT retirés du GRANT table-level 0.4a, sans re-GRANT — toute écriture passe par les routes API (service_role), seules à émettre l''outbox E1/E2, tracer l''audit_log et poser dirty_tms. Les policies col_update_client / col_update_commercial / col_insert sont conservées mais INERTES pour PostgREST direct tant que le privilège n''est pas ré-accordé. SELECT et DELETE (col_delete_brouillon) restent accordés.';
