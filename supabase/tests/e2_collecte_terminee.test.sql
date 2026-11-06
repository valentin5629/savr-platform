-- =============================================================================
-- pgTAP — aucun ordre de modification (E2) pour une collecte terminée ou annulée
-- (décision Val 2026-10-22, §05 « Cascade TMS », §08 « Déclencheur » E2),
-- migration 20261022200000_plateforme_e2_aucun_ordre_collecte_terminee.sql
-- =============================================================================
-- Prouve, sur des collectes dont la commande existe chez le prestataire
-- (tests.outbox_fixture_collecte, puis le même geste sur le même événement) :
--   • fn_modifier_collecte n'écrit aucun `collecte.modifiee` pour une collecte
--     realisee, realisee_sans_collecte, cloturee ou annulee ;
--   • ni quand la modification ROUVRE une collecte terminée, ni quand elle en
--     CLÔT une d'office (statut avant OU après) ;
--   • une collecte programmée ou en cours reçoit toujours son E2 (non-vacuité) ;
--   • la transition vers `annulee` émet toujours son E3, jamais d'E2.
-- `fn_modifier_evenement` ne parcourt que les collectes programmee / validee /
-- en_cours : prouvé par r22c_evenement_e2_en_cours (R22c-6, collecte clôturée).
-- =============================================================================

BEGIN;
SELECT plan(10);

-- Le jeu d'essai partagé ne s'appelle qu'une fois par transaction (adresse
-- email fixe) : il fournit l'événement, le prestataire et une première
-- collecte commandée ; les autres sont commandées de la même façon.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT tests.outbox_fixture_collecte('zd') AS programmee,
       NULL::uuid AS evt, NULL::uuid AS presta,
       NULL::uuid AS realisee, NULL::uuid AS cloturee, NULL::uuid AS annulee,
       NULL::uuid AS sans_collecte, NULL::uuid AS en_cours, NULL::uuid AS rouverte,
       NULL::uuid AS close, NULL::uuid AS a_annuler;
UPDATE t SET evt = c.evenement_id, presta = c.prestataire_logistique_id
  FROM plateforme.collectes c WHERE c.id = t.programmee;

-- Collecte commandée sur l'événement du jeu d'essai : même geste que le jeu
-- d'essai (prestataire posé, tournée portant une commande, lien de rang 1).
CREATE FUNCTION pg_temp.commandee(p_evt uuid, p_presta uuid, p_type text, p_jours int) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_tournee uuid;
  v_suffixe text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  v_id := plateforme.fn_creer_collecte(
    p_evenement_id := p_evt, p_type := p_type,
    p_date_collecte := CURRENT_DATE + p_jours, p_heure_collecte := '21:00'::time,
    p_pax := 100);
  UPDATE plateforme.collectes SET prestataire_logistique_id = p_presta WHERE id = v_id;
  INSERT INTO plateforme.tournees (
    reference_interne, date_tournee, creneau, prestataire_logistique_id,
    statut, external_ref_commande, created_at, updated_at
  ) VALUES (
    'Q1-' || v_suffixe, CURRENT_DATE + p_jours, 'nuit', p_presta,
    'en_cours', 'Q1-CMD-' || v_suffixe, now(), now()
  ) RETURNING id INTO v_tournee;
  INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang, created_at, updated_at)
  VALUES (v_id, v_tournee, 1, now(), now());
  RETURN v_id;
END $$;

UPDATE t SET realisee      = pg_temp.commandee(evt, presta, 'zd', 31),
             cloturee      = pg_temp.commandee(evt, presta, 'zd', 32),
             annulee       = pg_temp.commandee(evt, presta, 'zd', 33),
             sans_collecte = pg_temp.commandee(evt, presta, 'ag', 34),
             en_cours      = pg_temp.commandee(evt, presta, 'zd', 35),
             rouverte      = pg_temp.commandee(evt, presta, 'zd', 36),
             close         = pg_temp.commandee(evt, presta, 'zd', 37),
             a_annuler     = pg_temp.commandee(evt, presta, 'zd', 38);

-- Statuts posés directement (hors machine à états) : seul le point de départ
-- compte ici.
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes SET statut = 'realisee'               WHERE id IN (SELECT realisee FROM t UNION ALL SELECT rouverte FROM t);
UPDATE plateforme.collectes SET statut = 'cloturee'               WHERE id = (SELECT cloturee FROM t);
UPDATE plateforme.collectes SET statut = 'annulee'                WHERE id = (SELECT annulee FROM t);
UPDATE plateforme.collectes SET statut = 'realisee_sans_collecte' WHERE id = (SELECT sans_collecte FROM t);
UPDATE plateforme.collectes SET statut = 'en_cours'               WHERE id IN (SELECT en_cours FROM t UNION ALL SELECT close FROM t);
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.e2(p_id uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM plateforme.outbox_events
   WHERE aggregate_id = p_id AND event_type = 'collecte.modifiee'
$$;
CREATE FUNCTION pg_temp.e3(p_id uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM plateforme.outbox_events
   WHERE aggregate_id = p_id AND event_type = 'collecte.annulee'
$$;

-- ── Collecte terminée ou annulée : aucun E2 ─────────────────────────────────
SELECT plateforme.fn_modifier_collecte(realisee, '{"pax": 150}'::jsonb, ARRAY['pax']) FROM t;
SELECT is(pg_temp.e2((SELECT realisee FROM t)), 0,
  'collecte realisee commandée : modifier son pax n''écrit aucun E2');
SELECT plateforme.fn_modifier_collecte(cloturee, '{"heure_collecte": "21:30"}'::jsonb, ARRAY['heure_collecte']) FROM t;
SELECT is(pg_temp.e2((SELECT cloturee FROM t)), 0,
  'collecte cloturee commandée : modifier son heure n''écrit aucun E2');
SELECT plateforme.fn_modifier_collecte(annulee, '{"informations_supplementaires": "Accès quai B"}'::jsonb, ARRAY['informations_supplementaires']) FROM t;
SELECT is(pg_temp.e2((SELECT annulee FROM t)), 0,
  'collecte annulee commandée : modifier ses informations n''écrit aucun E2');
SELECT plateforme.fn_modifier_collecte(sans_collecte, '{"pax": 90}'::jsonb, ARRAY['pax']) FROM t;
SELECT is(pg_temp.e2((SELECT sans_collecte FROM t)), 0,
  'collecte realisee_sans_collecte commandée : modifier son pax n''écrit aucun E2');

-- ── Statut avant OU après : rouvrir ou clore d'office ne relance rien ───────
SELECT plateforme.fn_modifier_collecte(rouverte, '{"statut": "en_cours", "pax": 150}'::jsonb, ARRAY['statut', 'pax']) FROM t;
SELECT is(pg_temp.e2((SELECT rouverte FROM t)), 0,
  'collecte realisee rouverte en en_cours avec un pax modifié : aucun E2 (statut avant terminal)');
SELECT plateforme.fn_modifier_collecte(close, '{"statut": "realisee", "pax": 150}'::jsonb, ARRAY['statut', 'pax']) FROM t;
SELECT is(pg_temp.e2((SELECT close FROM t)), 0,
  'collecte en_cours passée en realisee avec un pax modifié : aucun E2 (statut après terminal)');

-- ── Non-vacuité : une collecte active reçoit toujours son E2 ────────────────
SELECT plateforme.fn_modifier_collecte(programmee, '{"pax": 150}'::jsonb, ARRAY['pax']) FROM t;
SELECT is(pg_temp.e2((SELECT programmee FROM t)), 1,
  'collecte programmee commandée : modifier son pax écrit un E2');
SELECT plateforme.fn_modifier_collecte(en_cours, '{"pax": 150}'::jsonb, ARRAY['pax']) FROM t;
SELECT is(pg_temp.e2((SELECT en_cours FROM t)), 1,
  'collecte en_cours commandée : modifier son pax écrit un E2');

-- ── Annulation : E3, jamais E2 (inchangé) ───────────────────────────────────
SELECT plateforme.fn_modifier_collecte(a_annuler, '{"statut": "annulee"}'::jsonb, ARRAY['statut']) FROM t;
SELECT is(pg_temp.e3((SELECT a_annuler FROM t)), 1,
  'annuler une collecte commandée écrit son E3');
SELECT is(pg_temp.e2((SELECT a_annuler FROM t)), 0,
  'annuler une collecte commandée n''écrit aucun E2');

SELECT * FROM finish();
ROLLBACK;
