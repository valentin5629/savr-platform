-- =============================================================================
-- P0 SÉCURITÉ — RPC SECURITY DEFINER internes exposées à authenticated/anon
-- =============================================================================
-- Le schéma `plateforme` est exposé par PostgREST (supabase/config.toml l.14).
-- Toute fonction du schéma exécutable par `authenticated` (ou `anon`) est donc
-- appelable par n'importe quel compte client via POST /rest/v1/rpc/<nom>.
-- Une fonction SECURITY DEFINER s'exécute avec les droits du owner → la RLS est
-- bypassée : sans garde de rôle interne, l'exposition = fuite cross-organisation.
--
-- Reproduit en base (JWT traiteur_manager, rôle Postgres authenticated) :
--   [RLS] SELECT direct sur plateforme.outbox_events       -> 0 ligne  (OK)
--   [RPC] fn_claim_outbox_batch(10, '2 minutes'::interval) -> 3 lignes (FUITE)
--
-- Double impact sur l'outbox : (1) fuite des payloads E1/E2/E3/E5 de TOUTES les
-- organisations (collecte_id, association_id, transporteur_id…) ; (2) DoS de la
-- chaîne logistique MTS-1 — un client peut claim en boucle ou passer les events
-- à `dead`, empêchant le dispatch des collectes.
--
-- Cause : ces fonctions n'ont jamais reçu de REVOKE, donc elles ont conservé le
-- défaut PostgreSQL `EXECUTE TO PUBLIC` (proacl `=X/postgres`). Le contre-exemple
-- correct est fn_admin_requeue/skip/resolve_outbox (migration 20260629100000) :
-- REVOKE ALL FROM PUBLIC + GRANT au seul service_role.
--
-- Fonctions corrigées ici (toutes n'ont AUCUNE garde de rôle interne et ne sont
-- appelées, en exécution réelle, que par un client service_role ou par un
-- SECURITY DEFINER appelant — jamais par un client authenticated) :
--
--  1. fn_claim_outbox_batch / fn_result_outbox / fn_reap_outbox_claims
--     → packages/adapters/src/outbox-worker.ts (runOutboxWorker), atteint
--       uniquement depuis /api/cron/outbox-worker, dont withCronObservability
--       injecte createAdminSupabaseClient() = service_role.
--
--  2. fn_calculer_algo_attribution_ag(uuid)  [GRANT authenticated explicite,
--     migrations 20260615240000 puis 20260630120000]
--     → retourne le top 3 associations (nom, email de contact, distance) et les
--       transporteurs recommandés pour N'IMPORTE QUELLE collecte AG passée en
--       paramètre : pivot cross-organisation sur simple uuid. Appelants réels :
--       lib/attribution-ag/algo.ts (createAdminSupabaseClient) depuis 2 routes
--       admin, et rpc_valider_attribution_ag (elle-même SECURITY DEFINER, donc
--       insensible à ce REVOKE).
--
--  3. f_next_numero_attestation(integer)  [GRANT service_role posé sans REVOKE
--     PUBLIC préalable, migration 20260615250000 l.116 → PUBLIC conservé]
--     → MUTATION : incrémente la séquence gapless `sequences_facturation`
--       (série ATTDON). Appelable en boucle par un client → trous dans la
--       numérotation réglementaire des attestations de don. Appelants réels :
--       lib/pdf/batch-pdf-j1-ag.ts (cron batch-pdf-j1, service_role) et le
--       trigger fn_trg_regenerer_attestation (SECURITY DEFINER → owner).
--
-- Restent VOLONTAIREMENT exécutables par authenticated (balayage complet du
-- même critère sur plateforme + shared, cf. test securite_rpc_definer_exposees) :
--   - helpers appelés DEPUIS les policies RLS sous le rôle de l'appelant — les
--     révoquer casserait la RLS elle-même (permission denied dans la policy) :
--     f_collecte_visible, f_collecte_editable, f_volume_repas_realise,
--     f_traiteur_intervenu_lieux_gestionnaire, shared.f_fichier_visible ;
--   - fonctions à garde de rôle interne explicite : f_benchmark_kg_pax_zd,
--     f_benchmark_lieux_parc, f_benchmark_traiteurs_parc,
--     f_benchmark_single_collecte, f_completer_siret_shadow,
--     f_dechets_labo_estimes, f_mes_acces_compte (scopée auth.uid()) ;
--   - health_ping() (retourne 1, aucune donnée).
--   - les fonctions `RETURNS trigger` : PostgreSQL interdit leur appel direct
--     (« trigger functions can only be called as triggers ») et PostgREST ne les
--     expose pas → non exploitables, laissées telles quelles.
--
-- Backward-compatible et non destructive : aucun objet créé/supprimé/renommé,
-- uniquement des privilèges. Hors périmètre du diff structurel DDL cible V2.
-- =============================================================================

-- ─── 1. Worker outbox (lease/claim) — service_role uniquement ────────────────

REVOKE EXECUTE ON FUNCTION plateforme.fn_claim_outbox_batch(integer, interval)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_claim_outbox_batch(integer, interval)
  TO service_role;

REVOKE EXECUTE ON FUNCTION plateforme.fn_result_outbox(uuid, text, text, text, timestamptz, boolean)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_result_outbox(uuid, text, text, text, timestamptz, boolean)
  TO service_role;

REVOKE EXECUTE ON FUNCTION plateforme.fn_reap_outbox_claims()
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_reap_outbox_claims()
  TO service_role;

-- ─── 2. Moteur algo attribution AG — service_role uniquement ─────────────────

REVOKE EXECUTE ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid)
  TO service_role;

-- ─── 3. Séquence gapless attestations de don — service_role uniquement ───────

REVOKE EXECUTE ON FUNCTION plateforme.f_next_numero_attestation(integer)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_next_numero_attestation(integer)
  TO service_role;
