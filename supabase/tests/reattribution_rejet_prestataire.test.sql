-- =============================================================================
-- Réattribution d'une collecte rejetée par le transporteur → retour `programmee`
-- =============================================================================
-- Source : §08 §3 V1 / §3bis.6 (refus transporteur → statut ET statut_tms =
-- rejetee_par_prestataire, retour file Ops-driven) + arbitrage Val 2026-09-17
-- (la réattribution remet la collecte en `programmee`).
-- Migration : 20260917130000_plateforme_reattribution_rejet_prestataire.sql
--
-- Oracle = le parcours complet après réattribution : sans le retour
-- `programmee`, le trigger fn_sync ne dérive jamais `validee` et
-- fn_agreger_terminal_collecte n'écrit jamais `realisee` (mesuré avant correctif).
-- Exécution : supabase test db (job CI pgtap-rls-outbox).
-- =============================================================================

BEGIN;
SELECT plan(13);

-- Collecte AG dispatchée (tournée + référence MTS-1, E1 émis par fn_creer_collecte).
CREATE TEMP TABLE t_rej ON COMMIT DROP AS
  SELECT tests.outbox_fixture_collecte('anti_gaspi') AS id;

-- Cinq collectes sœurs sur le même événement, une par état de départ.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
SELECT v.id, c.evenement_id, 'anti_gaspi', v.statut::plateforme.collecte_statut,
       v.statut_tms::plateforme.collecte_statut_tms, current_date + 30, '09:00', 1
FROM plateforme.collectes c
CROSS JOIN (VALUES
  ('e917a000-0000-0000-0000-000000000001'::uuid, 'programmee', 'rejetee_par_prestataire'),
  ('e917a000-0000-0000-0000-000000000002'::uuid, 'en_cours',   'rejetee_par_prestataire'),
  ('e917a000-0000-0000-0000-000000000003'::uuid, 'annulee',    'rejetee_par_prestataire'),
  ('e917a000-0000-0000-0000-000000000004'::uuid, 'programmee', 'attribuee_en_attente_acceptation'),
  ('e917a000-0000-0000-0000-000000000005'::uuid, 'validee',    'rejetee_par_prestataire')
) AS v(id, statut, statut_tms)
WHERE c.id = (SELECT id FROM t_rej);

-- Refus du transporteur, tel que l'écrivent l'adapter / le webhook / l'agrégation.
UPDATE plateforme.collectes
SET statut_tms = 'rejetee_par_prestataire', statut = 'rejetee_par_prestataire'
WHERE id = (SELECT id FROM t_rej);

-- ─── 1-3. Réattribution d'une collecte rejetée ────────────────────────────────
SELECT plateforme.fn_dispatcher_collecte((SELECT id FROM t_rej), NULL, NULL);

SELECT is(
  (SELECT statut::text FROM plateforme.collectes WHERE id = (SELECT id FROM t_rej)),
  'programmee',
  'réattribution d''une collecte rejetee_par_prestataire → statut programmee'
);

SELECT is(
  (SELECT statut_tms::text FROM plateforme.collectes WHERE id = (SELECT id FROM t_rej)),
  'non_envoye',
  'réattribution d''une collecte rejetée → statut_tms non_envoye (ordre pas encore reparti)'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = (SELECT id FROM t_rej) AND payload->>'dispatch_manuel' = 'true'),
  1,
  'la réattribution émet son event outbox dans la même transaction'
);

-- ─── 4-6. Parcours normal repris : acceptation → validee → realisee ──────────
UPDATE plateforme.collectes SET statut_tms = 'attribuee_en_attente_acceptation' WHERE id = (SELECT id FROM t_rej);
UPDATE plateforme.collectes SET statut_tms = 'acceptee' WHERE id = (SELECT id FROM t_rej);

SELECT is(
  (SELECT statut::text FROM plateforme.collectes WHERE id = (SELECT id FROM t_rej)),
  'validee',
  'après réattribution, l''acceptation du nouveau transporteur dérive validee (trigger fn_sync)'
);

UPDATE plateforme.tournees t
SET statut = 'terminee'
FROM plateforme.collecte_tournees ct
WHERE ct.tournee_id = t.id AND ct.collecte_id = (SELECT id FROM t_rej);

SELECT plateforme.fn_agreger_terminal_collecte((SELECT id FROM t_rej));

SELECT is(
  (SELECT statut::text FROM plateforme.collectes WHERE id = (SELECT id FROM t_rej)),
  'realisee',
  'après réattribution, l''agrégation terminale écrit realisee'
);

SELECT isnt(
  (SELECT realisee_at FROM plateforme.collectes WHERE id = (SELECT id FROM t_rej)),
  NULL,
  'après réattribution, realisee_at est posé (départ de l''embargo H+24)'
);

-- ─── 7-11. États de départ qui ne sont pas un rejet de la collecte ───────────
SELECT plateforme.fn_dispatcher_collecte('e917a000-0000-0000-0000-000000000001'::uuid, NULL, NULL);
SELECT plateforme.fn_dispatcher_collecte('e917a000-0000-0000-0000-000000000002'::uuid, NULL, NULL);
SELECT plateforme.fn_dispatcher_collecte('e917a000-0000-0000-0000-000000000003'::uuid, NULL, NULL);
SELECT plateforme.fn_dispatcher_collecte('e917a000-0000-0000-0000-000000000004'::uuid, NULL, NULL);
SELECT plateforme.fn_dispatcher_collecte('e917a000-0000-0000-0000-000000000005'::uuid, NULL, NULL);

SELECT is(
  (SELECT statut::text || '|' || statut_tms::text FROM plateforme.collectes
    WHERE id = 'e917a000-0000-0000-0000-000000000001'),
  'programmee|non_envoye',
  'programmee + statut_tms rejetee (rejet A Toutes! avant correctif) → statut_tms non_envoye'
);

SELECT is(
  (SELECT statut::text || '|' || statut_tms::text FROM plateforme.collectes
    WHERE id = 'e917a000-0000-0000-0000-000000000002'),
  'en_cours|rejetee_par_prestataire',
  'en_cours (un seul camion refusé) → dispatch ne touche ni statut ni statut_tms'
);

SELECT is(
  (SELECT statut::text || '|' || statut_tms::text FROM plateforme.collectes
    WHERE id = 'e917a000-0000-0000-0000-000000000003'),
  'annulee|rejetee_par_prestataire',
  'annulee → dispatch ne ressuscite pas la collecte'
);

SELECT is(
  (SELECT statut::text || '|' || statut_tms::text FROM plateforme.collectes
    WHERE id = 'e917a000-0000-0000-0000-000000000004'),
  'programmee|attribuee_en_attente_acceptation',
  'programmee en attente d''acceptation (pas de rejet) → dispatch ne touche pas statut_tms'
);

SELECT is(
  (SELECT statut::text || '|' || statut_tms::text FROM plateforme.collectes
    WHERE id = 'e917a000-0000-0000-0000-000000000005'),
  'validee|rejetee_par_prestataire',
  'validee (un seul camion refusé) → dispatch ne touche ni statut ni statut_tms'
);

-- ─── 12-13. Droits : fonction SECURITY DEFINER fermée ────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_dispatcher_collecte(uuid, uuid, text)', 'EXECUTE'),
  'authenticated n''exécute pas fn_dispatcher_collecte'
);

SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.fn_dispatcher_collecte(uuid, uuid, text)', 'EXECUTE'),
  'anon n''exécute pas fn_dispatcher_collecte'
);

SELECT * FROM finish();
ROLLBACK;
