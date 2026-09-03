-- =============================================================================
-- pgTAP P0 SÉCURITÉ — RPC SECURITY DEFINER internes NON exposées aux clients
-- =============================================================================
-- Le schéma `plateforme` est exposé par PostgREST : toute fonction exécutable
-- par `authenticated` est appelable via POST /rest/v1/rpc/<nom>. En SECURITY
-- DEFINER la RLS est bypassée → sans garde de rôle interne, l'exposition vaut
-- fuite cross-organisation (et, pour l'outbox, DoS de la chaîne logistique).
--
-- Couvre la migration 20260903120000_plateforme_securite_revoke_rpc_definer_interne.
--
-- NON-VACUITÉ (vérifiée sans la migration) : les 5 throws_ok tombent en `not ok`
-- car chaque RPC s'exécute alors normalement sous authenticated —
-- fn_claim_outbox_batch rend les events de toutes les orgas, fn_result_outbox et
-- fn_reap_outbox_claims mutent l'état, f_next_numero_attestation incrémente la
-- séquence gapless ATTDON, et fn_calculer_algo_attribution_ag lève P0030 (code
-- ≠ 42501, donc échec de l'assertion elle aussi).
-- =============================================================================

BEGIN;
SELECT plan(17);

-- ─── Helpers (mêmes conventions que les autres suites RLS) ───────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'user_role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- =============================================================================
-- T1-T5 — Un client authenticated (JWT traiteur_manager) se voit refuser
--         l'EXECUTE : 42501 insufficient_privilege, AVANT exécution du corps.
-- =============================================================================

SELECT test_set_jwt(
  'traiteur_manager',
  '0a9e0001-0000-0000-0000-000000000001'::uuid,
  '059e0001-0000-0000-0000-000000000001'::uuid
);

SELECT throws_ok(
  $$ SELECT * FROM plateforme.fn_claim_outbox_batch(10, interval '2 minutes') $$,
  '42501', NULL::text,
  'T1 authenticated — fn_claim_outbox_batch : permission denied (plus de fuite des payloads outbox cross-orga)'
);

SELECT throws_ok(
  $$ SELECT plateforme.fn_result_outbox('00000000-0000-0000-0000-0000000000ff'::uuid, 'done') $$,
  '42501', NULL::text,
  'T2 authenticated — fn_result_outbox : permission denied (plus de DoS par passage à dead/done)'
);

SELECT throws_ok(
  $$ SELECT plateforme.fn_reap_outbox_claims() $$,
  '42501', NULL::text,
  'T3 authenticated — fn_reap_outbox_claims : permission denied (plus de requeue global)'
);

SELECT throws_ok(
  $$ SELECT plateforme.fn_calculer_algo_attribution_ag('00000000-0000-0000-0000-0000000000ff'::uuid) $$,
  '42501', NULL::text,
  'T4 authenticated — fn_calculer_algo_attribution_ag : permission denied (plus de pivot sur une collecte AG tierce)'
);

SELECT throws_ok(
  $$ SELECT plateforme.f_next_numero_attestation(2099) $$,
  '42501', NULL::text,
  'T5 authenticated — f_next_numero_attestation : permission denied (plus de trous dans la séquence gapless ATTDON)'
);

SELECT test_as_superuser();

-- =============================================================================
-- T6-T10 — anon (clé publique embarquée dans le front) n'a pas davantage accès.
-- =============================================================================

SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.fn_claim_outbox_batch(integer, interval)', 'EXECUTE'),
  'T6 anon — aucun EXECUTE sur fn_claim_outbox_batch'
);
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.fn_result_outbox(uuid, text, text, text, timestamptz, boolean)', 'EXECUTE'),
  'T7 anon — aucun EXECUTE sur fn_result_outbox'
);
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.fn_reap_outbox_claims()', 'EXECUTE'),
  'T8 anon — aucun EXECUTE sur fn_reap_outbox_claims'
);
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.fn_calculer_algo_attribution_ag(uuid)', 'EXECUTE'),
  'T9 anon — aucun EXECUTE sur fn_calculer_algo_attribution_ag'
);
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.f_next_numero_attestation(integer)', 'EXECUTE'),
  'T10 anon — aucun EXECUTE sur f_next_numero_attestation'
);

-- =============================================================================
-- T11-T15 — CONTRÔLE POSITIF : service_role (createAdminSupabaseClient, seul
--           appelant réel : cron outbox-worker, cron batch-pdf-j1, routes admin)
--           conserve son EXECUTE. Une régression ici casserait le dispatch MTS-1.
-- =============================================================================

SELECT ok(
  has_function_privilege('service_role', 'plateforme.fn_claim_outbox_batch(integer, interval)', 'EXECUTE'),
  'T11 service_role — EXECUTE conservé sur fn_claim_outbox_batch (worker outbox)'
);
SELECT ok(
  has_function_privilege('service_role', 'plateforme.fn_result_outbox(uuid, text, text, text, timestamptz, boolean)', 'EXECUTE'),
  'T12 service_role — EXECUTE conservé sur fn_result_outbox (worker outbox)'
);
SELECT ok(
  has_function_privilege('service_role', 'plateforme.fn_reap_outbox_claims()', 'EXECUTE'),
  'T13 service_role — EXECUTE conservé sur fn_reap_outbox_claims (worker outbox)'
);
SELECT ok(
  has_function_privilege('service_role', 'plateforme.fn_calculer_algo_attribution_ag(uuid)', 'EXECUTE'),
  'T14 service_role — EXECUTE conservé sur fn_calculer_algo_attribution_ag (routes admin)'
);
SELECT ok(
  has_function_privilege('service_role', 'plateforme.f_next_numero_attestation(integer)', 'EXECUTE'),
  'T15 service_role — EXECUTE conservé sur f_next_numero_attestation (batch PDF J+1 AG)'
);

-- =============================================================================
-- T16 — CONTRÔLE POSITIF D'EXÉCUTION : sous le rôle service_role, l'appel réel
--       passe toujours (le privilège seul ne prouve pas que le corps s'exécute).
-- =============================================================================

SELECT set_config('role', 'service_role', true);
SELECT lives_ok(
  $$ SELECT plateforme.fn_reap_outbox_claims() $$,
  'T16 service_role — fn_reap_outbox_claims s''exécute réellement (worker non cassé)'
);
SELECT test_as_superuser();

-- =============================================================================
-- T17 — CLIQUET ANTI-RÉGRESSION : aucune AUTRE fonction SECURITY DEFINER de
--       plateforme/shared ne doit devenir exécutable par authenticated hors de
--       l'allowlist justifiée ci-dessous. Toute nouvelle RPC DEFINER exposée
--       fait échouer ce test tant que sa garde n'a pas été arbitrée.
--
--       Allowlist — 2 familles seulement :
--        (a) helpers appelés DEPUIS les policies RLS sous le rôle de l'appelant
--            (les révoquer casserait la RLS : permission denied dans la policy) ;
--        (b) fonctions à garde de rôle interne explicite (f_app_role/f_is_staff/
--            appartenance organisation), plus health_ping qui ne rend aucune donnée.
--       Les fonctions `RETURNS trigger` sont exclues du critère : PostgreSQL
--       interdit leur appel direct et PostgREST ne les expose pas.
--
--       L'allowlist couvre l'état de `main` toutes migrations appliquées, y
--       compris f_mes_acces_compte (20260710130000) qui projette les seuls accès
--       de auth.uid() — un `NOT IN` sur un nom absent reste sans effet, la liste
--       est donc valable quel que soit l'avancement des migrations.
-- =============================================================================

SELECT is_empty(
  $$
  SELECT n.nspname || '.' || p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('plateforme', 'shared')
    AND p.prosecdef
    AND pg_get_function_result(p.oid) <> 'trigger'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.proname NOT IN (
      -- (a) helpers RLS
      'f_collecte_visible',
      'f_collecte_editable',
      'f_volume_repas_realise',
      'f_traiteur_intervenu_lieux_gestionnaire',
      'f_fichier_visible',
      -- (b) garde de rôle interne explicite
      'f_benchmark_kg_pax_zd',
      'f_benchmark_lieux_parc',
      'f_benchmark_traiteurs_parc',
      'f_benchmark_single_collecte',
      'f_completer_siret_shadow',
      'f_dechets_labo_estimes',
      'f_mes_acces_compte',
      'health_ping'
    )
  $$,
  'T17 balayage — aucune RPC SECURITY DEFINER hors allowlist n''est exposée à authenticated'
);

SELECT * FROM finish();
ROLLBACK;
