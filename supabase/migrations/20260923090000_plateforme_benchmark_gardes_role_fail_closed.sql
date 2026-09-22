-- =============================================================================
-- Sécurité — Benchmark : gardes de rôle FAIL-CLOSED (rôle absent = refus)
-- =============================================================================
-- MOTIF DE LA FAILLE (mesuré sur réplique locale à l'état HEAD, pas supposé)
-- -----------------------------------------------------------------------------
-- `plateforme.f_app_role()` (20260617180000 l.69-71) se réduit à
-- `SELECT auth.jwt()->>'user_role'` : elle rend **NULL**, et non une chaîne vide,
-- quand le jeton ne porte pas le claim `user_role`. Or les trois gardes ci-dessous
-- étaient écrites en `NOT IN (…)`, et la logique TERNAIRE de SQL fait que
-- `NULL NOT IN ('a','b')` vaut NULL — ni TRUE, ni FALSE. Un `IF` dont la condition
-- vaut NULL n'exécute PAS sa branche : le `RAISE EXCEPTION` n'était jamais atteint.
-- La garde, écrite en liste blanche (« si le rôle n'est pas dans ma liste, je
-- refuse »), était donc FAIL-OPEN sur le seul cas qu'elle aurait dû refuser en
-- premier : l'appelant sans rôle métier du tout.
--
-- Même mécanique sur `f_benchmark_single_collecte`, où la garde s'écrivait
-- `IF v_role NOT IN (…) AND v_org IS DISTINCT FROM … AND … THEN` : avec v_role
-- NULL, `NULL AND TRUE AND TRUE` vaut NULL ⇒ pas de RAISE.
--
-- CHEMIN D'ATTEINTE — ce n'est pas théorique. Les routes Next.js sont, elles,
-- déjà fermées (`requireUser`, api-auth.ts l.195-210 : 403 si le claim de rôle
-- manque, 403 si `organisation_id` manque). Mais le schéma `plateforme` est
-- exposé par PostgREST : un `POST /rest/v1/rpc/f_benchmark_traiteurs_parc`
-- portant un JWT valablement signé mais sans `user_role` court-circuite
-- ENTIÈREMENT les routes et parle à la fonction en direct. C'est ce chemin-là que
-- cette migration ferme. Un tel jeton est produit aujourd'hui pour un compte
-- présent dans `auth.users` mais absent de `plateforme.users` (le hook JWT
-- `fn_custom_access_token` n'a alors aucun rôle à poser) — hors périmètre ici,
-- cf. « RESTE OUVERT » en fin d'en-tête.
--
-- IMPACT MESURÉ (réplique locale, jeton `authenticated` sans `user_role`,
-- `organisation_id` sans lien avec la donnée) AVANT ce correctif :
--   • f_benchmark_traiteurs_parc  → rend la LISTE COMPLÈTE des traiteurs du parc.
--     C'est exactement l'information fermée aux rôles traiteur pour préservation
--     compétitive (motif posé en tête de 20260705140000 l.11-14).
--   • f_benchmark_lieux_parc      → rend la liste des lieux du parc.
--   • f_benchmark_single_collecte → rend le ratio kg/pax d'une collecte
--     appartenant à une AUTRE organisation.
-- Aucune de ces trois fuites ne laisse de trace exploitable : impossible de dire
-- après coup qui a lu quoi.
--
-- CORRECTIF — « rôle non reconnu = porte fermée », comme partout ailleurs dans le
-- schéma (CLAUDE.md §2 « RLS DENY ALL par défaut » ; CDC §09 l.19 « RLS
-- cross-schema deny par défaut »). Le principe opposable est le deny par défaut :
-- une liste blanche doit refuser ce qu'elle ne reconnaît pas, y compris l'absence.
-- (Le CDC §09 « Tout `entity_type` non listé → `false` (deny par défaut, fail-safe) » énonce
-- le même principe, mais sur le catalogue des types de FICHIERS : cité ici comme
-- ANALOGIE du principe, pas comme la règle qui couvrirait le cas des rôles.)
--
-- La garde NULL est posée en TÊTE, AVANT toute lecture de données, pour deux
-- raisons : (1) fail-fast ; (2) ne pas livrer à un appelant sans rôle un oracle
-- d'existence sur les `collecte_id` (sans cela, un id inexistant et un id d'une
-- autre organisation se distingueraient par le message reçu).
--
-- ⚠ MESSAGES DISTINCTS, ce n'est PAS cosmétique : `f_benchmark_single_collecte`
-- lève déjà 'Collecte not accessible' pour « collecte/événement introuvable »
-- (IF NOT FOUND). Sans un message distinct, aucun test ne pourrait distinguer
-- « refusé car rôle vide » de « refusé car la collecte n'existe pas » — et un
-- test écrit sur un uuid inventé serait vert SANS le correctif.
--
-- NOTE D'IMPACT sur l'API — la route
-- `packages/plateforme/src/app/api/v1/traiteur/collectes/[id]/benchmark/route.ts`
-- (l.62-67) mappe le message 'Collecte not accessible' en 404 ; les nouveaux
-- messages n'étant pas ce littéral, ils retomberont en 500 générique. Sans
-- conséquence mesurée : `requireUser` rend déjà 403 AVANT l'appel quand le rôle
-- ou l'organisation manque, donc aucune requête passant par la route ne peut
-- atteindre ces nouveaux RAISE. (Constat, pas supposition.)
--
-- APPELANTS — vérifié avant écriture, sur la réplique à l'état HEAD :
--   • TypeScript : les 3 seuls sites d'appel, répartis sur 2 fichiers (route
--     ci-dessus l.58 ; `loaders.ts` l.1346 et l.1349, via
--     `DbClient = ReturnType<typeof createSupabaseServerClient>`) passent tous
--     par la clé anon + cookies, donc un JWT utilisateur porteur du rôle.
--   • SQL : 0 fonction, 0 vue, 0 policy ne référence ces trois fonctions.
-- Aucun appelant `service_role` (pour lequel `auth.jwt()` est NULL et qui serait
-- désormais refusé) n'existe donc, ni côté applicatif ni côté base.
--
-- ACL — `CREATE OR REPLACE` PRÉSERVE l'ACL mais REMET `proconfig` À ZÉRO :
-- omettre `SET search_path` déferait le durcissement (CWE-426) EN SILENCE. D'où
-- la reconduction textuelle de SECURITY DEFINER + SET search_path, et le rejeu
-- explicite de REVOKE/GRANT ci-dessous.
-- ⚠ L'ensemble EFFECTIF des bénéficiaires d'EXECUTE des deux `_parc` est
-- `authenticated, postgres, service_role` — et non le seul `authenticated`
-- accordé en 20260705140000 l.37/62 : ces fonctions ayant été créées APRÈS
-- 20260617160000, elles héritent `service_role` de son
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA plateforme … GRANT EXECUTE ON FUNCTIONS`
-- (l.43-44). On reconduit ici les GRANT textuels de la migration d'origine ;
-- `CREATE OR REPLACE` conservant l'ACL et un GRANT ne retirant jamais rien,
-- l'ensemble des bénéficiaires est INCHANGÉ par cette migration — ce que le test
-- SECU__benchmark_garde_role_null asserte par `aclexplode` (et non par
-- `has_function_privilege`, vert aussi bien après un GRANT PUBLIC qu'après un
-- REVOKE).
--
-- Migration NON destructive et qui FERME un accès (aucun GRANT élargi, aucune
-- policy assouplie, aucun RLS désactivé, hook JWT non touché) : autorisée au
-- titre de CLAUDE.md §12 pt 2bis, sous GO `reviewer-rls-securite` ancré au SHA
-- et test pgTAP prouvant la fermeture.
--
-- RESTE OUVERT (à ne pas présenter comme soldé) :
--   • `plateforme.f_benchmark_kg_pax_zd` porte la MÊME faille — sa garde
--     compétitive `IF plateforme.f_app_role() IN ('traiteur_manager',
--     'traiteur_commercial') AND …` ne s'arme pas pour un rôle NULL, qui
--     n'appartient à aucune liste. Hors périmètre ici : une autre branche la
--     recrée (k-anonymat sur les acteurs) et la toucher écraserait ce correctif.
--     → lot de suite, à lancer une fois cette branche-là mergée.
--   • `plateforme.fn_custom_access_token` (hook JWT), qui fabrique le jeton sans
--     `user_role`, reste intact : le durcir peut empêcher des comptes légitimes de
--     se connecter et relève d'un arbitrage explicite (CLAUDE.md §12 pt 2bis).
--
-- ─── ROLLBACK (DoD « down-migration documentée ») ────────────────────────────
-- ⚠ Jouer ce rollback RÉOUVRE les trois fuites décrites ci-dessus. Il restaure
-- les définitions exactes d'avant (20260922100000 pour single_collecte,
-- 20260705140000 pour les deux `_parc`) — corps identiques, seules les gardes
-- reviennent à leur forme fail-open :
--   -- f_benchmark_single_collecte : remplacer le bloc de garde par
--   --   IF v_role NOT IN ('admin_savr', 'ops_savr')
--   --      AND v_org IS DISTINCT FROM v_evt_org
--   --      AND v_org IS DISTINCT FROM v_evt_top THEN
--   --     RAISE EXCEPTION 'Collecte not accessible';
--   --   END IF;
--   -- f_benchmark_lieux_parc / f_benchmark_traiteurs_parc : retirer le bloc
--   --   IF plateforme.f_app_role() IS NULL THEN … END IF;
-- puis rejouer, à l'identique, SECURITY DEFINER + SET search_path
-- + REVOKE EXECUTE … FROM PUBLIC + les GRANT ci-dessous.
-- =============================================================================

BEGIN;

-- ─── 1. f_benchmark_single_collecte ──────────────────────────────────────────
-- Corps recopié À L'IDENTIQUE de 20260922100000 (colonnes de sortie canoniques,
-- k-anonymat ≥5 hérité de f_benchmark_kg_pax_zd, grain flux × type × taille) :
-- SEUL le bloc de garde change. Le contrat de sortie ne bougeant pas, un
-- CREATE OR REPLACE suffit (pas de DROP + CREATE) et l'ACL est préservée.
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_single_collecte(p_collecte_id uuid)
 RETURNS TABLE(
   flux_code            text,
   taille_evenement     text,
   ratio_user           numeric,
   benchmark_kg_pax     numeric,
   nb_collectes_segment integer
 )
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
BEGIN
  -- Fail-closed : rôle métier absent du jeton ⇒ refus, AVANT toute lecture (ne
  -- pas livrer d'oracle d'existence sur p_collecte_id). `NOT IN` ne peut pas
  -- porter ce cas : NULL NOT IN (…) vaut NULL, donc ne déclenche aucun IF.
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;

  -- Vérification de visibilité (RLS répliquée — fail fast si non accessible)
  SELECT e.organisation_id, e.traiteur_operationnel_organisation_id, e.pax, e.type_evenement_id
    INTO v_evt_org, v_evt_top, v_pax, v_type
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
    IF v_org IS DISTINCT FROM v_evt_org
       AND v_org IS DISTINCT FROM v_evt_top THEN
      RAISE EXCEPTION 'Collecte not accessible';
    END IF;
  END IF;

  v_bracket := plateforme.taille_evenement_bracket(v_pax);

  RETURN QUERY
  WITH valeurs AS (
    -- ratio kg/pax de la collecte courante, par flux
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
END $function$;

REVOKE EXECUTE ON FUNCTION plateforme.f_benchmark_single_collecte(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_benchmark_single_collecte(uuid)
  TO authenticated, service_role;

-- ─── 2. f_benchmark_lieux_parc ───────────────────────────────────────────────
-- Corps recopié à l'identique de 20260705140000 : seule la garde NULL est ajoutée.
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_lieux_parc()
RETURNS TABLE (id uuid, nom text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  -- Fail-closed : sans ce test, NULL NOT IN (…) vaut NULL et la liste blanche
  -- ci-dessous laissait passer l'appelant sans rôle métier.
  IF plateforme.f_app_role() IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;
  IF plateforme.f_app_role() NOT IN
     ('gestionnaire_lieux', 'traiteur_manager', 'traiteur_commercial', 'admin_savr', 'ops_savr') THEN
    RAISE EXCEPTION 'Role non autorise pour la liste benchmark';
  END IF;
  RETURN QUERY
  SELECT l.id, l.nom
  FROM plateforme.lieux l
  WHERE l.actif IS DISTINCT FROM false
  ORDER BY l.nom;
END $$;

REVOKE EXECUTE ON FUNCTION plateforme.f_benchmark_lieux_parc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_benchmark_lieux_parc() TO authenticated;

COMMENT ON FUNCTION plateforme.f_benchmark_lieux_parc() IS
  'Liste id+nom des lieux du parc Savr pour le filtre encart benchmark (§06.05). SECURITY DEFINER, garde role fail-closed (role absent = refus).';

-- ─── 3. f_benchmark_traiteurs_parc ───────────────────────────────────────────
-- Corps recopié à l'identique de 20260705140000 : seule la garde NULL est ajoutée.
-- C'est la fonction la plus sensible des trois : elle rend la liste des traiteurs
-- du parc, fermée aux rôles traiteur pour préservation compétitive.
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_traiteurs_parc()
RETURNS TABLE (id uuid, nom text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  -- Fail-closed : sans ce test, NULL NOT IN (…) vaut NULL et un jeton sans rôle
  -- métier obtenait la liste complète des traiteurs concurrents.
  IF plateforme.f_app_role() IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;
  IF plateforme.f_app_role() NOT IN ('gestionnaire_lieux', 'admin_savr', 'ops_savr') THEN
    RAISE EXCEPTION 'Role non autorise pour la liste traiteurs benchmark';
  END IF;
  RETURN QUERY
  SELECT o.id, COALESCE(o.nom, o.raison_sociale) AS nom
  FROM plateforme.organisations o
  WHERE o.type = 'traiteur'
    AND o.actif IS DISTINCT FROM false
    AND o.est_shadow IS DISTINCT FROM true
  ORDER BY 2;
END $$;

REVOKE EXECUTE ON FUNCTION plateforme.f_benchmark_traiteurs_parc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_benchmark_traiteurs_parc() TO authenticated;

COMMENT ON FUNCTION plateforme.f_benchmark_traiteurs_parc() IS
  'Liste id+nom des traiteurs du parc Savr pour le filtre encart benchmark (§06.05). SECURITY DEFINER, garde role fail-closed (role absent = refus ; exclut les roles traiteur — competitif).';

COMMIT;
