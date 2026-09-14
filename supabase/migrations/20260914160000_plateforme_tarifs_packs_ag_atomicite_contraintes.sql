-- =============================================================================
-- Tarifs packs AG — versionnement ATOMIQUE + contraintes recollées + invariant
-- « une seule ligne ouverte par type_pack »
-- =============================================================================
-- Trois défauts constatés sur POST /api/v1/admin/tarifs-packs-ag (revue
-- reviewer-rls-securite, hors périmètre de la PR #291 faute de migration) :
--
--  1. NON-ATOMICITÉ. Le handler fermait la ligne active (UPDATE valide_jusqu_au
--     = veille) puis insérait la nouvelle ligne en DEUX appels PostgREST. Un
--     INSERT en échec (CHECK violé, colonne NOT NULL manquante…) laissait le
--     type_pack avec ZÉRO ligne ouverte → plus aucun tarif AG actif pour ce
--     type, silencieusement (lecture `valide_jusqu_au IS NULL` de
--     lib/facturation/tarif-ag.ts → « Aucun tarif AG unitaire actif »).
--     Correctif : rpc_creer_tarif_pack_ag (SECURITY DEFINER) fait fermeture +
--     insertion dans UNE transaction, sur le modèle de rpc_creer_grille_zd
--     (20260704170000). REVOKE authenticated/anon/PUBLIC + GRANT service_role :
--     le schéma `plateforme` est exposé par PostgREST, une SECURITY DEFINER
--     laissée ouverte = RLS bypassée pour n'importe quel porteur de la clé anon
--     (faille P0 #263, migration 20260903130000). ACL verrouillée par pgTAP.
--
--  2. CONTRAINTES PERDUES AU PASSAGE LEGACY → CONVERGÉ. Le bloc 5
--     (20260611171639) portait `CHECK (nb_collectes > 0)`,
--     `CHECK (prix_ht >= 0)` et `CHECK (valide_jusqu IS NULL OR valide_jusqu >=
--     valide_du)`. L'align M2.1b (20260615200000) a créé les colonnes convergées
--     `credits` / `prix_unitaire_ht` / `valide_jusqu_au` avec le seul NOT NULL,
--     et le retrait des colonnes legacy (20260629000000) a emporté les CHECK
--     avec elles. Depuis : `credits = -5` ou `prix_unitaire_ht = -100` s'insèrent
--     SANS ERREUR et deviennent le tarif actif du référentiel (montant facturé
--     négatif en aval). Les trois CHECK sont recollés ici sur les colonnes
--     convergées, à l'identique (mêmes seuils, mêmes bornes).
--
--  3. PAS D'INVARIANT « UNE SEULE LIGNE OUVERTE PAR type_pack ». Rien
--     n'interdisait deux lignes `valide_jusqu_au IS NULL` pour le même
--     type_pack — c'est la seule raison pour laquelle le défaut corrigé en #291
--     (erreur de fermeture avalée) pouvait se matérialiser en silence :
--     référentiel de prix ambigu, `.single()` côté lecture tarif AG au petit
--     bonheur de l'ordre des lignes. Un index unique partiel le rend impossible
--     par construction, et sérialise au passage deux créations concurrentes
--     (la seconde sort en 23505 au lieu de dupliquer).
--
-- CDC : CLAUDE.md §4 « Tarifs versionnés, jamais modifiés rétroactivement » ;
-- `06 - Back-office Admin Savr.md` §9 Paramètres (modification d'un tarif =
-- fermeture de la ligne en vigueur + création d'une nouvelle).
--
-- ÉTAT DES DONNÉES VÉRIFIÉ AVANT POSE (prérequis des contraintes validées) —
-- dev (`savr-dev`), prod (`savr-prod`, lecture seule forcée) et base locale :
--   credits <= 0 : 0 ligne | prix_unitaire_ht < 0 : 0 | montant_total_ht < 0 : 0
--   valide_jusqu_au < valide_du : 0 | lignes ouvertes par type_pack : 1 partout
-- → les 3 CHECK et l'index unique passent sans NOT VALID ni nettoyage préalable.
--
-- Backward-compatible : aucune colonne ajoutée/renommée/supprimée, aucun type
-- modifié. Hors diff structurel G6 (schema-vs-cible compare les COLONNES ; le
-- DDL cible V2 n'embarque ni CHECK ni index — cf. specs/ddl-cible/README.md).
--
-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS plateforme.rpc_creer_tarif_pack_ag(text, integer, numeric, date, boolean, integer);
--   DROP INDEX IF EXISTS plateforme.uniq_tarif_pack_ag_ouvert_par_type;
--   ALTER TABLE plateforme.tarifs_packs_ag
--     DROP CONSTRAINT IF EXISTS chk_tarif_pack_ag_credits_positifs,
--     DROP CONSTRAINT IF EXISTS chk_tarif_pack_ag_prix_positif,
--     DROP CONSTRAINT IF EXISTS chk_tarif_pack_ag_bornes_validite;
--   ⚠ le rollback de la fonction seule casse le POST admin (le handler n'a plus
--     de chemin d'écriture) : rollbacker la migration ET revenir au handler
--     deux-appels, ou ne rien rollbacker du tout.
-- =============================================================================

-- ─── 1. CHECK recollés sur les colonnes convergées ───────────────────────────
-- Idempotents : `ADD CONSTRAINT` n'a pas d'IF NOT EXISTS, on absorbe le doublon.

DO $$ BEGIN
  ALTER TABLE plateforme.tarifs_packs_ag
    ADD CONSTRAINT chk_tarif_pack_ag_credits_positifs CHECK (credits > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE plateforme.tarifs_packs_ag
    ADD CONSTRAINT chk_tarif_pack_ag_prix_positif CHECK (prix_unitaire_ht >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE plateforme.tarifs_packs_ag
    ADD CONSTRAINT chk_tarif_pack_ag_bornes_validite
      CHECK (valide_jusqu_au IS NULL OR valide_jusqu_au >= valide_du);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. Invariant « une seule ligne ouverte par type_pack » ──────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tarif_pack_ag_ouvert_par_type
  ON plateforme.tarifs_packs_ag (type_pack)
  WHERE valide_jusqu_au IS NULL;

COMMENT ON INDEX plateforme.uniq_tarif_pack_ag_ouvert_par_type IS
  'Un seul tarif en vigueur (valide_jusqu_au IS NULL) par type_pack — le référentiel de prix AG ne peut pas être ambigu.';

-- ─── 3. Création versionnée atomique (fermeture + insertion) ─────────────────
-- La fonction ne re-valide PAS les valeurs déjà couvertes par les contraintes
-- de table (credits, prix, type_pack) : l'autorité reste la base, et une
-- violation survenant APRÈS la fermeture prouve l'atomicité (le rollback de
-- l'instruction rend la ligne fermée à son état ouvert). Elle ne valide que ce
-- que la base ne peut pas exprimer : l'ordre chronologique des versions.

CREATE OR REPLACE FUNCTION plateforme.rpc_creer_tarif_pack_ag(
  p_type_pack        text,
  p_credits          integer,
  p_prix_unitaire_ht numeric,
  p_valide_du        date,
  p_mensualisable    boolean DEFAULT false,
  p_nb_mensualites   integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
DECLARE
  v_ouverte_id        uuid;
  v_ouverte_valide_du date;
  v_row               jsonb;
BEGIN
  IF p_type_pack IS NULL OR length(trim(p_type_pack)) = 0 THEN
    RAISE EXCEPTION 'type_pack obligatoire' USING errcode = '22023';
  END IF;
  IF p_valide_du IS NULL THEN
    RAISE EXCEPTION 'valide_du obligatoire' USING errcode = '22023';
  END IF;

  -- Ligne en vigueur du type (au plus une — index uniq_tarif_pack_ag_ouvert_par_type).
  -- FOR UPDATE : deux créations concurrentes sur le même type_pack se sérialisent
  -- ici ; celle qui perd la course ne voit plus de ligne ouverte et sort en 23505
  -- sur l'INSERT (traité plus bas) — jamais deux lignes ouvertes.
  SELECT id, valide_du INTO v_ouverte_id, v_ouverte_valide_du
    FROM plateforme.tarifs_packs_ag
   WHERE type_pack = p_type_pack
     AND valide_jusqu_au IS NULL
   FOR UPDATE;

  IF v_ouverte_id IS NOT NULL THEN
    -- Jamais rétroactif : la nouvelle version prend effet APRÈS le début de
    -- celle qu'elle remplace (sinon la fermeture à `p_valide_du - 1` produirait
    -- un intervalle inversé — chk_tarif_pack_ag_bornes_validite).
    IF p_valide_du <= v_ouverte_valide_du THEN
      RAISE EXCEPTION
        'un tarif % est en vigueur depuis le % : valide_du doit lui être postérieur (versionnement non rétroactif)',
        p_type_pack, v_ouverte_valide_du
        USING errcode = '22023';
    END IF;

    UPDATE plateforme.tarifs_packs_ag
       SET valide_jusqu_au = p_valide_du - 1
     WHERE id = v_ouverte_id;
  END IF;

  BEGIN
    INSERT INTO plateforme.tarifs_packs_ag AS t
      (type_pack, credits, prix_unitaire_ht, montant_total_ht,
       mensualisable, nb_mensualites, valide_du)
    VALUES
      (p_type_pack, p_credits, p_prix_unitaire_ht,
       round(p_credits::numeric * p_prix_unitaire_ht, 2),
       COALESCE(p_mensualisable, false), p_nb_mensualites, p_valide_du)
    RETURNING to_jsonb(t.*) INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- Seul index unique en jeu : uniq_tarif_pack_ag_ouvert_par_type. Une
    -- création concurrente a ouvert une ligne pour ce type entre le SELECT
    -- FOR UPDATE et l'INSERT. On re-RAISE (donc tout est annulé, fermeture
    -- comprise) avec un message actionnable plutôt que le texte de l'index.
    RAISE EXCEPTION
      'un tarif % vient d''être créé en parallèle : réessayez', p_type_pack
      USING errcode = '40001';
  END;

  RETURN v_row;
END;
$fn$;

COMMENT ON FUNCTION plateforme.rpc_creer_tarif_pack_ag(text, integer, numeric, date, boolean, integer) IS
  'Crée une version de tarif pack AG : ferme la ligne en vigueur et insère la nouvelle dans la MÊME transaction (CLAUDE.md §4 — tarifs versionnés, jamais rétroactifs). service_role uniquement.';

REVOKE ALL ON FUNCTION
  plateforme.rpc_creer_tarif_pack_ag(text, integer, numeric, date, boolean, integer)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION
  plateforme.rpc_creer_tarif_pack_ag(text, integer, numeric, date, boolean, integer)
  TO service_role;
