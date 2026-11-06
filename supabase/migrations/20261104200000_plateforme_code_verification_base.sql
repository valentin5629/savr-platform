-- =============================================================================
-- Code de vérification de l'équipe Savr, exigé aussi par la base (2026-11-04)
-- =============================================================================
-- Décision Val du 2026-11-04 (questionnaire sécurité VIPARIS, exigence IAM1) :
-- une session de l'équipe Savr (admin_savr, ops_savr) qui n'a pas passé le code
-- de vérification ne lit ni n'écrit plus rien en base, même en appelant
-- directement l'API Supabase. Jusqu'ici, seule l'application le refusait (PR
-- #742) ; une session sans code (mot de passe saisi, ou lien « mot de passe
-- oublié » ouvert) gardait en base tous les droits de l'équipe Savr.
--
-- Règle unique : plateforme.f_code_verification_ok(). Elle rend FAUX, et
-- seulement dans ce cas, pour un jeton dont le rôle est admin_savr ou ops_savr,
-- dont le niveau n'est pas aal2, et dont le compte a un code ACTIVÉ (un facteur
-- vérifié dans auth.mfa_factors). Modèle Supabase « Enforce only for users that
-- have opted-in » (guides/auth/auth-mfa#database).
--
-- Pourquoi « code activé » : l'application ne demande le code qu'en production
-- (décision Val 2026-11-04) et y force son activation à la première connexion.
-- Sur dev, en local, sur les aperçus et en CI, personne n'active de code : rien
-- n'y change. En production, chaque membre a son code dès sa première
-- connexion ; la base refuse alors toute session sans code. Avant cette
-- activation, la base laisse passer, comme l'application laisse activer le
-- code (fenêtre décrite dans docs/claude/code-verification.md).
--
-- Trois points de contrôle, tous fermants (aucun droit ajouté) :
--   1. une policy RESTRICTIVE sur chaque table de plateforme et shared. Une
--      policy restrictive ne peut que retirer des droits : elle s'ajoute (ET)
--      aux policies existantes, sans en élargir aucune ;
--   2. la même règle au début de chaque fonction SECURITY DEFINER appelable par
--      authenticated (elles lisent les tables avec les droits de leur
--      propriétaire, sans passer par la RLS) ; health_ping (constante) exclue ;
--   3. la même règle dans le WHERE des 4 vues security_invoker = false lisibles
--      par authenticated (même raison).
-- Fonctions et vues : corps et options repris À L'IDENTIQUE de leur définition
-- en base (pg_get_functiondef / pg_get_viewdef sur une base rejouée depuis
-- toutes les migrations), une seule condition ajoutée. Droits d'exécution et de
-- lecture conservés par CREATE OR REPLACE.
--
-- Cliquets : supabase/tests/SECU__code_verification_base.test.sql échoue si une
-- table, une fonction SECURITY DEFINER ou une vue « droits du propriétaire »
-- arrive sans cette règle.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Règle unique, en deux fonctions
-- -----------------------------------------------------------------------------
-- f_code_verification_active() : le compte du jeton a-t-il un code activé ?
-- SECURITY DEFINER : authenticated ne lit pas auth.mfa_factors (mesuré sur
-- savr-dev le 2026-11-04 : SELECT refusé à authenticated, accordé à postgres).
-- Elle ne rend qu'un booléen sur le compte du jeton lui-même, que son titulaire
-- connaît déjà par l'API d'authentification (liste de ses facteurs). Jeton sans
-- titulaire : rendu comme « code activé », donc fermé (jamais émis par Supabase).
CREATE OR REPLACE FUNCTION plateforme.f_code_verification_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NULL
      OR EXISTS (
           SELECT 1
           FROM auth.mfa_factors f
           WHERE f.user_id = auth.uid()
             AND f.status = 'verified'
         )
$function$;

COMMENT ON FUNCTION plateforme.f_code_verification_active() IS
  'Vrai si le compte du jeton a un code de vérification activé (facteur vérifié dans auth.mfa_factors), ou si le jeton n''a pas de titulaire. Appelée par f_code_verification_ok, pour une session de l''équipe Savr sans code seulement (2026-11-04).';

REVOKE ALL ON FUNCTION plateforme.f_code_verification_active() FROM PUBLIC, anon;
-- service_role : une vue security_invoker = false appelle la règle avec les
-- droits de celui qui la lit, y compris le service_role des routes serveur.
GRANT EXECUTE ON FUNCTION plateforme.f_code_verification_active() TO authenticated, service_role;

-- f_code_verification_ok() : la règle elle-même. SECURITY INVOKER sans SET, en
-- SQL : Postgres l'intègre à la requête qui l'appelle. Évaluée de gauche à
-- droite, elle s'arrête au premier terme vrai : un client ou une session déjà
-- passée par le code ne déclenche aucune lecture de auth.mfa_factors. Aucun
-- terme ne vaut NULL. Pas de sous-requête `(SELECT …)` dans les policies : une
-- sous-requête dans la policy de `collectes` fait lever à Postgres « infinite
-- recursion detected in policy » sur le chemin collectes → evenements →
-- collectes (mesuré sur une base rejouée, 2026-11-04).
CREATE OR REPLACE FUNCTION plateforme.f_code_verification_ok()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT coalesce(auth.jwt() ->> 'user_role', '') NOT IN ('admin_savr', 'ops_savr')
      OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      OR NOT plateforme.f_code_verification_active()
$function$;

COMMENT ON FUNCTION plateforme.f_code_verification_ok() IS
  'Faux seulement pour une session admin_savr ou ops_savr sans code de vérification (aal différent de aal2) dont le compte a un code activé. Lue par la policy restrictive code_verification_equipe_savr de chaque table, et au début des fonctions SECURITY DEFINER et des vues security_invoker = false ouvertes à authenticated (2026-11-04).';

REVOKE ALL ON FUNCTION plateforme.f_code_verification_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION plateforme.f_code_verification_ok() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Policy restrictive sur chaque table de plateforme et shared
-- -----------------------------------------------------------------------------
-- Partitions comprises (audit_log_*, integrations_logs_*) : lues par leur table
-- mère, mais exposées aussi en direct.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_nom, c.relname AS table_nom
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('plateforme', 'shared')
      AND c.relkind IN ('r', 'p')
    ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'CREATE POLICY code_verification_equipe_savr ON %I.%I '
      'AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (plateforme.f_code_verification_ok()) '
      'WITH CHECK (plateforme.f_code_verification_ok())',
      r.schema_nom, r.table_nom);
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. Fonctions SECURITY DEFINER appelables par authenticated (13)
-- -----------------------------------------------------------------------------
-- plpgsql : refus 42501 avant toute lecture. sql : la règle en tête de
-- l'expression rendue (false, NULL, 0 ou aucune ligne, comme un appelant hors
-- périmètre).

CREATE OR REPLACE FUNCTION plateforme.f_benchmark_kg_pax_zd(p_flux_id uuid DEFAULT NULL::uuid, p_type_evenement_ids uuid[] DEFAULT NULL::uuid[], p_taille_evenement_codes text[] DEFAULT NULL::text[], p_periode_debut date DEFAULT NULL::date, p_periode_fin date DEFAULT NULL::date, p_lieu_ids uuid[] DEFAULT NULL::uuid[], p_traiteur_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(flux_id uuid, flux_code text, type_evenement_id uuid, taille_evenement text, kg_par_pax_moyen numeric, nb_collectes_segment integer, nb_organisations_distinctes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  -- Code de vérification (20261104200000) : session de l'équipe Savr sans code
  -- alors que son code est activé = refus, avant toute lecture.
  IF NOT plateforme.f_code_verification_ok() THEN
    RAISE EXCEPTION 'Code de vérification requis' USING ERRCODE = '42501';
  END IF;

  -- Garde compétitive (§04) : un rôle traiteur, l'agence ou le client organisateur
  -- ne peut cibler des traiteurs nommés (sinon il déduirait, par différence entre
  -- deux appels, la performance individuelle d'un traiteur).
  IF plateforme.f_app_role() IN ('traiteur_manager', 'traiteur_commercial',
                                 'agence', 'client_organisateur')
     AND p_traiteur_ids IS NOT NULL
     AND array_length(p_traiteur_ids, 1) > 0 THEN
    RAISE EXCEPTION
      'Filtre traiteur_ids interdit pour le role traiteur (preservation competitive)';
  END IF;

  -- Garde de périmètre (§06.05, décision Val 2026-10-06) : un gestionnaire ne nomme
  -- que ses lieux rattachés et les traiteurs que `v_traiteurs_gestionnaire` lui
  -- rend. Un tableau NULL ou vide ne nomme rien et passe la garde : NULL laisse le
  -- repère sur tout le parc ; vide ne rend aucun segment, comme avant
  -- (`= ANY('{}')`). Un élément NULL est refusé. Un jeton sans organisation
  -- (absente ou vide) est refusé dès qu'il nomme un lieu ou un traiteur ; s'il ne
  -- nomme rien, il reçoit le repère « tout le parc », comme avant.
  -- Les deux messages commencent par « Filtre lieu_ids hors » / « Filtre
  -- traiteur_ids hors » : `loadBenchmark` les reconnaît à ce début pour rendre un
  -- 403 (tout autre 42501, droit d'exécution retiré par exemple, reste un 500).
  IF plateforme.f_app_role() = 'gestionnaire_lieux' THEN
    v_org := NULLIF(auth.jwt()->>'organisation_id', '')::uuid;
    IF EXISTS (
      SELECT 1
      FROM unnest(p_lieu_ids) AS demande(lieu_demande)
      WHERE NOT EXISTS (
        SELECT 1
        FROM plateforme.organisations_lieux ol
        WHERE ol.lieu_id = demande.lieu_demande
          AND ol.organisation_id = v_org)
    ) THEN
      RAISE EXCEPTION 'Filtre lieu_ids hors des lieux rattaches au gestionnaire'
        USING ERRCODE = '42501';
    END IF;
    IF cardinality(p_traiteur_ids) > 0 THEN
      -- Sans organisation, la vue ne peut rien rendre : refus posé d'abord, dans
      -- un IF séquentiel, pour ne jamais l'évaluer avec un jeton incomplet.
      IF v_org IS NULL THEN
        RAISE EXCEPTION
          'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire'
          USING ERRCODE = '42501';
      ELSIF EXISTS (
        SELECT 1
        FROM unnest(p_traiteur_ids) AS demande(traiteur_demande)
        WHERE NOT EXISTS (
          SELECT 1
          FROM plateforme.v_traiteurs_gestionnaire t
          WHERE t.id = demande.traiteur_demande)
      ) THEN
        RAISE EXCEPTION
          'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- Grain de sortie CDC §04 « Colonnes exposées » : un tuple par
  -- (flux × type d'événement × taille). Les paramètres p_* sont des FILTRES.
  -- Type et taille sont ceux de la COLLECTE (lot C1, C3 / C4) : chaque collecte
  -- est rangée et divisée par ses propres convives, jamais par le total de
  -- l'événement.
  RETURN QUERY
  SELECT
    fd.id,
    fd.code,
    c.type_evenement_id,
    plateforme.taille_evenement_bracket(c.pax) AS taille_evenement,
    -- Moyenne pondérée par tonnage : Σ poids du flux / Σ pax du segment
    -- (collectes plus lourdes pèsent proportionnellement plus — §04 Data Model).
    -- `uniq_collecte_flux` (collecte_id, flux_id) : chaque collecte compte son pax
    -- une fois par flux.
    (SUM(cf.poids_reel_kg) / NULLIF(SUM(c.pax), 0))::numeric AS kg_par_pax_moyen,
    COUNT(DISTINCT c.id)::integer AS nb_collectes_segment,
    -- Organisations programmatrices du segment. Depuis le durcissement 2026-09-22,
    -- c'est une GARDE (cf. HAVING), plus seulement une colonne d'audit.
    COUNT(DISTINCT e.organisation_id)::integer AS nb_organisations_distinctes
  FROM plateforme.collectes c
  JOIN plateforme.evenements e     ON e.id = c.evenement_id
  JOIN plateforme.collecte_flux cf ON cf.collecte_id = c.id
  JOIN plateforme.flux_dechets fd  ON fd.id = cf.flux_id
  WHERE c.statut = 'cloturee'
    AND c.type = 'zero_dechet'
    AND cf.poids_reel_kg IS NOT NULL
    -- Convives inconnus (0, reprise Bubble) : la collecte sort du parc — poids,
    -- convives et nombre de collectes (décision Val 2026-10-24, Q4).
    AND c.pax > 0
    AND (p_flux_id IS NULL OR fd.id = p_flux_id)
    AND (p_type_evenement_ids IS NULL
         OR c.type_evenement_id = ANY (p_type_evenement_ids))
    AND (p_taille_evenement_codes IS NULL
         OR plateforme.taille_evenement_bracket(c.pax) = ANY (p_taille_evenement_codes))
    AND (p_periode_debut IS NULL OR c.date_collecte >= p_periode_debut)
    AND (p_periode_fin   IS NULL OR c.date_collecte <= p_periode_fin)
    AND (p_lieu_ids IS NULL OR e.lieu_id = ANY (p_lieu_ids))
    AND (p_traiteur_ids IS NULL
         OR e.traiteur_operationnel_organisation_id = ANY (p_traiteur_ids))
  GROUP BY fd.id, fd.code, c.type_evenement_id, taille_evenement
  -- k-anonymat (§04, durci 2026-09-22) : segment masqué s'il porte moins de 5 collectes
  -- OU moins de 3 acteurs distincts, de part ET d'autre (programmateur / opérationnel).
  HAVING COUNT(DISTINCT c.id) >= 5
     AND COUNT(DISTINCT e.organisation_id) >= 3
     AND COUNT(DISTINCT e.traiteur_operationnel_organisation_id) >= 3;
END $function$
;

CREATE OR REPLACE FUNCTION plateforme.f_benchmark_lieux_parc()
 RETURNS TABLE(id uuid, nom text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
BEGIN
  -- Code de vérification (20261104200000) : session de l'équipe Savr sans code
  -- alors que son code est activé = refus, avant toute lecture.
  IF NOT plateforme.f_code_verification_ok() THEN
    RAISE EXCEPTION 'Code de vérification requis' USING ERRCODE = '42501';
  END IF;
  IF plateforme.f_app_role() IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;
  IF plateforme.f_app_role() NOT IN
     ('traiteur_manager', 'traiteur_commercial', 'agence',
      'admin_savr', 'ops_savr') THEN
    RAISE EXCEPTION 'Role non autorise pour la liste benchmark';
  END IF;
  RETURN QUERY
  SELECT l.id, l.nom
  FROM plateforme.lieux l
  WHERE l.actif IS DISTINCT FROM false
  ORDER BY l.nom;
END $function$
;

CREATE OR REPLACE FUNCTION plateforme.f_benchmark_single_collecte(p_collecte_id uuid)
 RETURNS TABLE(flux_code text, taille_evenement text, ratio_user numeric, benchmark_kg_pax numeric, nb_collectes_segment integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
DECLARE
  v_role    text := plateforme.f_app_role();
  v_org     uuid := (auth.jwt()->>'organisation_id')::uuid;
  v_evt_org uuid;
  v_evt_top uuid;
  v_pax     integer;
  v_bracket text;
  v_type    uuid;
  v_lieu    uuid;
  v_date    date;
  v_statut  plateforme.collecte_statut;
  -- Gestionnaire dont l'organisation est rattachée au lieu d'un événement daté,
  -- sur une collecte hors brouillon : même borne que f_collecte_visible.
  v_gestionnaire_du_lieu boolean;
BEGIN
  -- Code de vérification (20261104200000) : session de l'équipe Savr sans code
  -- alors que son code est activé = refus, avant toute lecture.
  IF NOT plateforme.f_code_verification_ok() THEN
    RAISE EXCEPTION 'Code de vérification requis' USING ERRCODE = '42501';
  END IF;

  -- Fail-closed : rôle métier absent du jeton ⇒ refus, AVANT toute lecture (ne
  -- pas livrer d'oracle d'existence sur p_collecte_id). `NOT IN` ne peut pas
  -- porter ce cas : NULL NOT IN (…) vaut NULL, donc ne déclenche aucun IF.
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;

  -- Vérification de visibilité (RLS répliquée — fail fast si non accessible).
  -- Pax et type : ceux de la COLLECTE (lot C1, 2026-10-24) ; organisations, lieu
  -- et date restent ceux de l'événement (contrôle d'accès inchangé).
  SELECT e.organisation_id, e.traiteur_operationnel_organisation_id, c.pax, c.type_evenement_id,
         e.lieu_id, e.date_evenement, c.statut
    INTO v_evt_org, v_evt_top, v_pax, v_type, v_lieu, v_date, v_statut
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  WHERE c.id = p_collecte_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte not accessible';
  END IF;

  -- admin_savr / ops_savr voient tout le parc : `organisation_id` n'a pour eux
  -- aucun sens et ne doit donc PAS être exigé (un test NULL en bloc, en tête,
  -- les refuserait à tort). Le contrôle d'organisation reste cantonné aux rôles
  -- clients, sous lesquels une organisation absente est désormais un refus
  -- EXPLICITE : `IS DISTINCT FROM` le fermait déjà (il est NULL-safe et rend
  -- TRUE face à NULL), mais l'invariant reposait alors sur cette subtilité au
  -- lieu d'être énoncé — et le message reçu ne disait pas la vraie cause.
  IF v_role NOT IN ('admin_savr', 'ops_savr') THEN
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'Organisation applicative absente (acces refuse)';
    END IF;
    -- Rôle et organisation sont non NULL ici : chaque terme est un booléen
    -- défini, jamais NULL (une garde qui vaudrait NULL ne lèverait pas).
    v_gestionnaire_du_lieu :=
      v_role = 'gestionnaire_lieux'
      AND v_date IS NOT NULL
      AND v_statut <> 'brouillon'
      AND EXISTS (
        SELECT 1
          FROM plateforme.organisations_lieux ol
         WHERE ol.organisation_id = v_org
           AND ol.lieu_id = v_lieu
      );
    IF v_org IS DISTINCT FROM v_evt_org
       AND v_org IS DISTINCT FROM v_evt_top
       AND v_gestionnaire_du_lieu IS NOT TRUE THEN
      RAISE EXCEPTION 'Collecte not accessible';
    END IF;
  END IF;

  v_bracket := plateforme.taille_evenement_bracket(v_pax);

  RETURN QUERY
  WITH valeurs AS (
    -- ratio kg/pax de la collecte courante, par flux (NULL si pax = 0 : convives
    -- inconnus, pas de point « Vous » — Q4 Val 2026-10-24)
    SELECT fd.code AS flux_code,
           cf.poids_reel_kg / NULLIF(v_pax, 0) AS ratio_user
    FROM plateforme.collecte_flux cf
    JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = p_collecte_id
      AND cf.poids_reel_kg IS NOT NULL
  )
  SELECT
    v.flux_code,
    v_bracket,
    v.ratio_user,
    -- Filtre type + taille de la collecte ⇒ 1 segment par flux (grain CDC flux×type×taille).
    -- b.kg_par_pax_moyen = moyenne pondérée parc, k-anonymat ≥5 appliqué dans
    -- f_benchmark_kg_pax_zd : segment trop petit ⇒ pas de ligne ⇒ NULL ici (le
    -- front masque alors le repère parc, cf. §06.04 « Données insuffisantes »).
    b.kg_par_pax_moyen,
    COALESCE(b.nb_collectes_segment, 0)
  FROM valeurs v
  LEFT JOIN plateforme.f_benchmark_kg_pax_zd(
              p_type_evenement_ids     => ARRAY[v_type],
              p_taille_evenement_codes => ARRAY[v_bracket]) b
         ON b.flux_code = v.flux_code;
END $function$
;

CREATE OR REPLACE FUNCTION plateforme.f_benchmark_traiteurs_parc()
 RETURNS TABLE(id uuid, nom text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
BEGIN
  -- Code de vérification (20261104200000) : session de l'équipe Savr sans code
  -- alors que son code est activé = refus, avant toute lecture.
  IF NOT plateforme.f_code_verification_ok() THEN
    RAISE EXCEPTION 'Code de vérification requis' USING ERRCODE = '42501';
  END IF;
  -- Fail-closed : sans ce test, NULL NOT IN (…) vaut NULL et un jeton sans rôle
  -- métier obtenait la liste complète des traiteurs concurrents.
  IF plateforme.f_app_role() IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;
  IF plateforme.f_app_role() NOT IN ('admin_savr', 'ops_savr') THEN
    RAISE EXCEPTION 'Role non autorise pour la liste traiteurs benchmark';
  END IF;
  RETURN QUERY
  SELECT o.id, COALESCE(o.nom, o.raison_sociale) AS nom
  FROM plateforme.organisations o
  WHERE o.type = 'traiteur'
    AND o.actif IS DISTINCT FROM false
    AND o.est_shadow IS DISTINCT FROM true
  ORDER BY 2;
END $function$
;

CREATE OR REPLACE FUNCTION plateforme.f_collecte_editable(p_evenement_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
  -- Code de vérification (20261104200000) : false pour une session de l'équipe
  -- Savr sans code alors que son code est activé.
  SELECT plateforme.f_code_verification_ok() AND EXISTS (
    SELECT 1 FROM plateforme.collectes
    WHERE evenement_id = p_evenement_id
      AND statut IN ('brouillon','programmee','validee')
  )
$function$
;

CREATE OR REPLACE FUNCTION plateforme.f_collecte_visible(p_collecte_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
  -- Code de vérification (20261104200000) : false pour une session de l'équipe
  -- Savr sans code alors que son code est activé.
  SELECT plateforme.f_code_verification_ok() AND EXISTS (
    SELECT 1
    FROM plateforme.collectes c
    JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE c.id = p_collecte_id
      AND (
        plateforme.f_app_role() IN ('admin_savr','ops_savr')
        OR e.organisation_id                         = (auth.jwt()->>'organisation_id')::uuid
        OR e.traiteur_operationnel_organisation_id   = (auth.jwt()->>'organisation_id')::uuid
        OR e.client_organisateur_organisation_id     = (auth.jwt()->>'organisation_id')::uuid
        OR (
          e.date_evenement IS NOT NULL  -- garde anti-fuite brouillons tiers (B-2)
          AND c.statut <> 'brouillon'   -- un brouillon a une date : garde réelle (2026-10-24)
          AND e.lieu_id IN (
            SELECT lieu_id FROM plateforme.organisations_lieux
            WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
          )
        )
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION plateforme.f_completer_siret_shadow(p_org_id uuid, p_siret text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
DECLARE
  v_role       text := plateforme.f_app_role();
  v_caller_org uuid := (auth.jwt()->>'organisation_id')::uuid;
  v_org        plateforme.organisations;
BEGIN
  -- Code de vérification (20261104200000) : session de l'équipe Savr sans code
  -- alors que son code est activé = refus, avant toute lecture.
  IF NOT plateforme.f_code_verification_ok() THEN
    RAISE EXCEPTION 'Code de vérification requis' USING ERRCODE = '42501';
  END IF;

  -- Garde 1 — rôle agence uniquement
  IF v_role IS DISTINCT FROM 'agence' THEN
    RAISE EXCEPTION 'Action réservée au rôle agence' USING ERRCODE = '42501';
  END IF;

  -- Garde 2 — format SIRET : 14 chiffres exactement
  IF p_siret IS NULL OR p_siret !~ '^[0-9]{14}$' THEN
    RAISE EXCEPTION 'Format SIRET invalide (14 chiffres requis)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org FROM plateforme.organisations WHERE id = p_org_id;

  -- Garde 3 — la cible existe et est une fiche shadow
  IF NOT FOUND OR v_org.est_shadow IS NOT TRUE THEN
    RAISE EXCEPTION 'Organisation cible introuvable ou non shadow' USING ERRCODE = '22023';
  END IF;

  -- Garde 4 — fiche créée par l'organisation appelante
  IF v_org.cree_par_organisation_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'Fiche shadow non créée par votre organisation' USING ERRCODE = '42501';
  END IF;

  -- Garde 5 — écrasement interdit
  IF v_org.siret IS NOT NULL THEN
    RAISE EXCEPTION 'SIRET déjà renseigné' USING ERRCODE = '22023';
  END IF;

  UPDATE plateforme.organisations
  SET siret = p_siret, updated_at = now()
  WHERE id = p_org_id;

  -- Notification Admin in-app (F3) — dédupliquée, sans email
  PERFORM plateforme.f_upsert_alerte_admin(
    'shadow_siret_complete',
    'SIRET complété sur fiche traiteur shadow',
    format(
      'Le SIRET de la fiche traiteur shadow « %s » a été renseigné par l''agence.',
      COALESCE(v_org.raison_sociale, v_org.nom)
    ),
    'organisations',
    p_org_id
  );
END $function$
;

CREATE OR REPLACE FUNCTION plateforme.f_dechets_labo_estimes(p_evenement_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
  -- NULL (et non 0) quand le pax de l'événement vaut 0, quand le traiteur
  -- opérationnel n'a pas de coefficient pour l'année de l'événement − 1, quand
  -- l'appelant n'est ni staff ni gestionnaire de lieux, ou quand l'événement
  -- est hors du périmètre du gestionnaire. Aussi NULL pour une session de
  -- l'équipe Savr sans code alors que son code est activé (20261104200000).
  SELECT e.pax * c.coefficient_kg_couvert
  FROM plateforme.evenements e
  JOIN plateforme.coefficients_perte_labo c
    ON c.organisation_id = e.traiteur_operationnel_organisation_id
   AND c.annee_reference = EXTRACT(YEAR FROM e.date_evenement)::integer - 1
  WHERE plateforme.f_code_verification_ok()
    AND e.id = p_evenement_id
    AND e.pax > 0
    AND (
      plateforme.f_is_staff()
      OR (
        plateforme.f_app_role() = 'gestionnaire_lieux'
        AND (
          e.lieu_id IN (
            SELECT lieu_id FROM plateforme.organisations_lieux
            WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
          )
          OR e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
        )
      )
    )
$function$
;

CREATE OR REPLACE FUNCTION shared.f_fichier_visible(p_entity_type text, p_entity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'shared', 'plateforme', 'pg_catalog'
AS $function$
  -- Code de vérification (20261104200000) : false pour une session de l'équipe
  -- Savr sans code alors que son code est activé.
  SELECT plateforme.f_code_verification_ok() AND CASE p_entity_type
    WHEN 'plateforme.collectes' THEN
      plateforme.f_collecte_visible(p_entity_id)

    WHEN 'plateforme.bordereaux_savr' THEN
      plateforme.f_collecte_visible(
        (SELECT collecte_id FROM plateforme.bordereaux_savr WHERE id = p_entity_id))

    WHEN 'plateforme.attestations_don' THEN
      plateforme.f_collecte_visible(
        (SELECT collecte_id FROM plateforme.attestations_don WHERE id = p_entity_id))

    WHEN 'plateforme.rapports_rse' THEN
      plateforme.f_collecte_visible(
        (SELECT collecte_id FROM plateforme.rapports_rse WHERE id = p_entity_id))

    WHEN 'plateforme.organisations' THEN
      p_entity_id = (auth.jwt()->>'organisation_id')::uuid

    WHEN 'plateforme.lieux' THEN
      p_entity_id IN (
        SELECT lieu_id FROM plateforme.organisations_lieux
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
        UNION
        SELECT lieu_id FROM plateforme.evenements
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
      )

    WHEN 'plateforme.evenements' THEN
      EXISTS (
        SELECT 1 FROM plateforme.evenements e WHERE e.id = p_entity_id
          AND (
            e.organisation_id                         = (auth.jwt()->>'organisation_id')::uuid
            OR e.traiteur_operationnel_organisation_id = (auth.jwt()->>'organisation_id')::uuid
            OR e.client_organisateur_organisation_id   = (auth.jwt()->>'organisation_id')::uuid
            OR e.lieu_id IN (
              SELECT lieu_id FROM plateforme.organisations_lieux
              WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
            )
          )
      )

    WHEN 'plateforme.factures' THEN
      -- Scope strict : org-scoped + rôles clients uniquement (jamais client_organisateur)
      EXISTS (
        SELECT 1 FROM plateforme.factures f WHERE f.id = p_entity_id
          AND f.organisation_id = (auth.jwt()->>'organisation_id')::uuid
          AND plateforme.f_app_role() IN (
            'traiteur_manager','traiteur_commercial','agence','gestionnaire_lieux'
          )
      )

    WHEN 'plateforme.documents_generaux_savr' THEN
      EXISTS (
        SELECT 1 FROM plateforme.documents_generaux_savr d
        WHERE d.id = p_entity_id AND d.statut = 'genere'
      )

    ELSE false  -- fail-safe : tout entity_type non listé = deny
  END
$function$
;

CREATE OR REPLACE FUNCTION plateforme.f_mes_acces_compte()
 RETURNS TABLE(accede_le timestamp with time zone, type_acces text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_temp'
AS $function$
  -- Code de vérification (20261104200000) : aucune ligne pour une session de
  -- l'équipe Savr sans code alors que son code est activé.
  SELECT
    al.created_at                    AS accede_le,
    'acces_administrateur'::text     AS type_acces
  FROM plateforme.audit_log al
  WHERE plateforme.f_code_verification_ok()
    AND al.user_id = auth.uid()
    AND al.action = 'impersonation_session'
  ORDER BY al.created_at DESC
  LIMIT 100;
$function$
;

CREATE OR REPLACE FUNCTION plateforme.f_tarif_refacture_pax_zd(p_organisation_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
  -- Code de vérification (20261104200000) : NULL pour une session de l'équipe
  -- Savr sans code alors que son code est activé.
  SELECT o.tarif_refacture_pax_zd
    FROM plateforme.organisations o
   WHERE plateforme.f_code_verification_ok()
     AND o.id = p_organisation_id
     AND (
       plateforme.f_app_role() IN ('admin_savr', 'ops_savr')
       OR (
         plateforme.f_app_role() IN ('traiteur_manager', 'traiteur_commercial')
         AND o.id = (auth.jwt()->>'organisation_id')::uuid
       )
     )
$function$
;

CREATE OR REPLACE FUNCTION plateforme.f_traiteur_intervenu_lieux_gestionnaire(p_traiteur_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
  -- Code de vérification (20261104200000) : false pour une session de l'équipe
  -- Savr sans code alors que son code est activé.
  SELECT plateforme.f_code_verification_ok() AND EXISTS (
    SELECT 1
    FROM plateforme.evenements e
    JOIN plateforme.organisations_lieux ol ON ol.lieu_id = e.lieu_id
    WHERE e.traiteur_operationnel_organisation_id = p_traiteur_id
      AND ol.organisation_id = (auth.jwt()->>'organisation_id')::uuid
      AND e.date_evenement IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM plateforme.collectes c
        WHERE c.evenement_id = e.id
          AND c.statut <> 'brouillon'
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION plateforme.f_volume_repas_realise(p_collecte_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
  -- Code de vérification (20261104200000) : 0 pour une session de l'équipe Savr
  -- sans code alors que son code est activé, comme une collecte hors périmètre.
  SELECT CASE
    WHEN plateforme.f_code_verification_ok()
         AND plateforme.f_collecte_visible(p_collecte_id) THEN
      COALESCE((
        SELECT SUM(aa.volume_repas_realise)
        FROM plateforme.attributions_antgaspi aa
        WHERE aa.collecte_id = p_collecte_id
      ), 0)
    ELSE 0
  END
$function$
;

-- -----------------------------------------------------------------------------
-- 4. Vues security_invoker = false lisibles par authenticated (4)
-- -----------------------------------------------------------------------------
-- Définition reprise de pg_get_viewdef, options explicites : CREATE OR REPLACE
-- VIEW remplace les options par celles qu'il porte.

CREATE OR REPLACE VIEW plateforme.v_attributions_gestionnaire
WITH (security_invoker = false, security_barrier = true) AS
 SELECT aa.collecte_id,
    aa.volume_repas_realise,
    aa.association_id,
    a.nom AS association_nom,
    a.ville AS association_ville
   FROM plateforme.attributions_antgaspi aa
     JOIN plateforme.associations a ON a.id = aa.association_id
  WHERE plateforme.f_app_role() = 'gestionnaire_lieux'::text AND (EXISTS ( SELECT 1
           FROM plateforme.collectes c
             JOIN plateforme.evenements e ON e.id = c.evenement_id
             JOIN plateforme.organisations_lieux ol ON ol.lieu_id = e.lieu_id
          WHERE c.id = aa.collecte_id AND e.date_evenement IS NOT NULL AND ol.organisation_id = ((auth.jwt() ->> 'organisation_id'::text)::uuid)))
    -- Code de vérification (20261104200000)
    AND plateforme.f_code_verification_ok();

CREATE OR REPLACE VIEW plateforme.v_referentiel_traiteurs
WITH (security_invoker = false, security_barrier = true) AS
 SELECT id,
    COALESCE(NULLIF(btrim(nom), ''::text), raison_sociale) AS nom
   FROM plateforme.organisations o
  WHERE type = 'traiteur'::plateforme.organisation_type AND est_shadow = false AND actif = true
    -- Code de vérification (20261104200000)
    AND plateforme.f_code_verification_ok();

CREATE OR REPLACE VIEW plateforme.v_traiteurs_gestionnaire
WITH (security_invoker = false, security_barrier = true) AS
 SELECT id,
    nom,
    logo_url
   FROM plateforme.organisations o
  WHERE plateforme.f_app_role() = 'gestionnaire_lieux'::text AND type = 'traiteur'::plateforme.organisation_type AND plateforme.f_traiteur_intervenu_lieux_gestionnaire(id)
    -- Code de vérification (20261104200000)
    AND plateforme.f_code_verification_ok();

CREATE OR REPLACE VIEW plateforme.v_registre_dechets WITH (security_invoker = false) AS
SELECT
  c.id                                            AS collecte_id,
  c.evenement_id,
  e.date_evenement,
  c.date_collecte,
  e.nom_evenement                                 AS evenement_nom,
  c.pax,
  plateforme.taille_evenement_bracket(c.pax)      AS taille_bracket,
  c.type_evenement_id,
  e.lieu_id,
  l.nom                                           AS lieu_nom,
  l.adresse_acces                                 AS lieu_adresse,
  e.organisation_id                               AS programmateur_organisation_id,
  e.traiteur_operationnel_organisation_id,
  -- Traiteur opérationnel = producteur juridique du déchet (F4), fiches shadow
  -- incluses (raison sociale sans SIRET) ; fallback nom si raison_sociale NULL.
  COALESCE(top.raison_sociale, top.nom)           AS traiteur_raison_sociale,
  c.prestataire_logistique_id,
  sp.nom                                          AS transporteur_nom,
  b.exutoire_nom,
  COALESCE(agg.poids_total_kg, 0)::numeric(12, 3) AS poids_total_kg,
  COALESCE(agg.flux_codes, ARRAY[]::text[])       AS flux_codes,
  c.taux_recyclage,
  c.co2_induit_kg,
  c.co2_evite_kg,
  c.co2_net_kg,
  b.id                                            AS bordereau_id,
  b.numero                                        AS bordereau_numero,
  b.statut                                        AS bordereau_statut,
  b.pdf_fichier_id                                AS bordereau_pdf_fichier_id,
  b.date_emission                                 AS bordereau_date_emission,
  b.version                                       AS bordereau_version,
  c.historique_partiel,
  c.realisee_at,
  c.created_at,
  l.code_site_viparis                             AS lieu_code_site_viparis,
  e.code_affaire_viparis                          AS evenement_code_affaire_viparis
FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  JOIN plateforme.lieux l ON l.id = e.lieu_id
  LEFT JOIN plateforme.organisations top
    ON top.id = e.traiteur_operationnel_organisation_id
  LEFT JOIN shared.prestataires sp ON sp.id = c.prestataire_logistique_id
  LEFT JOIN plateforme.bordereaux_savr b ON b.collecte_id = c.id
  LEFT JOIN LATERAL (
    -- Poids total = SUM de TOUTES les pesées de la collecte (multi-pesées
    -- d'un même flux agrégées) ; flux_codes = badges distincts triés.
    SELECT
      SUM(cf.poids_reel_kg)                                AS poids_total_kg,
      array_agg(DISTINCT fd.code ORDER BY fd.code)         AS flux_codes
    FROM plateforme.collecte_flux cf
      JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = c.id
  ) agg ON true
WHERE c.statut = 'cloturee'::plateforme.collecte_statut
  AND c.type   = 'zero_dechet'::plateforme.collecte_type
  -- Exclusion agence (F6 2026-06-07) : donneuse d'ordre, non productrice → 0 ligne.
  AND plateforme.f_app_role() IS DISTINCT FROM 'agence'
  -- Cloisonnement par organisation (miroir policy collectes) : staff full,
  -- programmateur, traiteur opérationnel, client organisateur, gestionnaire
  -- de lieux via organisations_lieux. Source unique : f_collecte_visible.
  AND plateforme.f_collecte_visible(c.id)
  -- Code de vérification (20261104200000)
  AND plateforme.f_code_verification_ok();
