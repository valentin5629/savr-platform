-- =============================================================================
-- Agrégation terminale : rejet transporteur gardé sur les collectes en exécution
-- =============================================================================
-- Source : §05 R_statut_collecte_multi_tournees (tous tours CANCELED/KO →
-- rejetee_par_prestataire, jamais de régression d'un terminal) + arbitrage Val
-- 2026-09-17 (`annulation_demandee` conservée, ni écriture ni alerte).
-- Migration : 20260917150000_plateforme_agreger_rejet_garde_annulee.sql
--
-- Oracle = le statut relu et l'alerte Admin, par état de départ. Avant correctif
-- (mesuré) : `annulee` et `annulation_demandee` passaient en
-- rejetee_par_prestataire avec l'alerte « réattribution requise ».
-- Exécution : supabase test db (job CI pgtap-rls-outbox).
-- =============================================================================

BEGIN;
SELECT plan(22);

-- Événement + prestataire réels (helper G4), réutilisés par les collectes du test.
CREATE TEMP TABLE t_fixture ON COMMIT DROP AS
  SELECT tests.outbox_fixture_collecte('zd') AS id;

CREATE TEMP TABLE t_base ON COMMIT DROP AS
  SELECT c.evenement_id, t.prestataire_logistique_id
  FROM plateforme.collectes c
  JOIN plateforme.collecte_tournees ct ON ct.collecte_id = c.id
  JOIN plateforme.tournees t ON t.id = ct.tournee_id
  WHERE c.id = (SELECT id FROM t_fixture);

-- Une collecte par état de départ, un camion demandé, son unique tour CANCELED/KO.
CREATE TEMP TABLE t_cas ON COMMIT DROP AS
  SELECT * FROM (VALUES
    ('a9917000-0000-0000-0000-000000000001'::uuid, 'annulee'),
    ('a9917000-0000-0000-0000-000000000002'::uuid, 'annulation_demandee'),
    ('a9917000-0000-0000-0000-000000000003'::uuid, 'realisee'),
    ('a9917000-0000-0000-0000-000000000004'::uuid, 'realisee_sans_collecte'),
    ('a9917000-0000-0000-0000-000000000005'::uuid, 'cloturee'),
    ('a9917000-0000-0000-0000-000000000006'::uuid, 'programmee'),
    ('a9917000-0000-0000-0000-000000000007'::uuid, 'validee'),
    ('a9917000-0000-0000-0000-000000000008'::uuid, 'en_cours'),
    ('a9917000-0000-0000-0000-000000000009'::uuid, 'rejetee_par_prestataire')
  ) AS v(id, statut);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
SELECT v.id, b.evenement_id, 'zero_dechet', v.statut::plateforme.collecte_statut,
       'en_attente_execution', current_date + 30, '09:00', 1
FROM t_cas v CROSS JOIN t_base b;

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, chauffeur_nom, statut)
SELECT ('b9917000-0000-0000-0000-00000000000' || right(v.id::text, 1))::uuid,
       'T-A9917-' || right(v.id::text, 1), current_date + 30, 'matin',
       b.prestataire_logistique_id, 'Ch', 'annulee'
FROM t_cas v CROSS JOIN t_base b;

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang)
SELECT v.id, ('b9917000-0000-0000-0000-00000000000' || right(v.id::text, 1))::uuid, 1
FROM t_cas v;

SELECT plateforme.fn_agreger_terminal_collecte(id) FROM t_cas;

-- Alerte « réattribution requise » posée pour cette collecte ?
CREATE FUNCTION pg_temp.nb_alertes(p_id uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM plateforme.alertes_admin
  WHERE code = 'collecte_rejetee_par_prestataire' AND entity_id = p_id
$$;

CREATE FUNCTION pg_temp.statut(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT statut::text FROM plateforme.collectes WHERE id = p_id
$$;

-- ─── 1-4. Annulée / demande d'annulation : ni requalifiée, ni alerte ─────────
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000001'), 'annulee',
  'collecte annulee + tous tours CANCELED/KO → reste annulee');
SELECT is(pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000001'), 0,
  'collecte annulee → aucune alerte « réattribution requise »');
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000002'), 'annulation_demandee',
  'annulation_demandee + tous tours CANCELED/KO → la demande est conservée (arbitrage Val 2026-09-17)');
SELECT is(pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000002'), 0,
  'annulation_demandee → aucune alerte « réattribution requise »');

-- ─── 5-10. États terminaux : jamais de régression ────────────────────────────
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000003'), 'realisee',
  'realisee → pas de régression en rejetee_par_prestataire');
SELECT is(pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000003'), 0,
  'realisee → aucune alerte');
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000004'), 'realisee_sans_collecte',
  'realisee_sans_collecte → pas de régression');
SELECT is(pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000004'), 0,
  'realisee_sans_collecte → aucune alerte');
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000005'), 'cloturee',
  'cloturee → pas de régression');
SELECT is(pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000005'), 0,
  'cloturee → aucune alerte');

-- ─── 11-16. Collecte en exécution : rejet + alerte (comportement conservé) ───
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000006'), 'rejetee_par_prestataire',
  'programmee + tous tours CANCELED/KO → rejetee_par_prestataire');
SELECT is(pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000006'), 1,
  'programmee rejetée → alerte « réattribution requise »');
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000007'), 'rejetee_par_prestataire',
  'validee + tous tours CANCELED/KO → rejetee_par_prestataire');
SELECT is(pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000007'), 1,
  'validee rejetée → alerte « réattribution requise »');
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000008'), 'rejetee_par_prestataire',
  'en_cours + tous tours CANCELED/KO → rejetee_par_prestataire');
SELECT is(pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000008'), 1,
  'en_cours rejetée → alerte « réattribution requise »');

-- ─── 17-18. Déjà rejetée : idempotent, pas de ré-alerte ──────────────────────
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000009'), 'rejetee_par_prestataire',
  'rejetee_par_prestataire → inchangée');
SELECT is(pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000009'), 0,
  'rejetee_par_prestataire déjà posée → pas de nouvelle alerte');

-- ─── 19. Rejeu sur la collecte annulée : toujours rien ───────────────────────
SELECT plateforme.fn_agreger_terminal_collecte('a9917000-0000-0000-0000-000000000001'::uuid);
SELECT is(pg_temp.statut('a9917000-0000-0000-0000-000000000001') || '|' ||
          pg_temp.nb_alertes('a9917000-0000-0000-0000-000000000001')::text,
  'annulee|0', 'poll suivant sur la collecte annulee → toujours annulee, sans alerte');

-- ─── 20-22. Droits : fonction SECURITY DEFINER fermée ────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_agreger_terminal_collecte(uuid)', 'EXECUTE'),
  'authenticated n''exécute pas fn_agreger_terminal_collecte');
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.fn_agreger_terminal_collecte(uuid)', 'EXECUTE'),
  'anon n''exécute pas fn_agreger_terminal_collecte');
SELECT ok(
  has_function_privilege('service_role', 'plateforme.fn_agreger_terminal_collecte(uuid)', 'EXECUTE'),
  'service_role (adapter) exécute fn_agreger_terminal_collecte');

SELECT * FROM finish();
ROLLBACK;
