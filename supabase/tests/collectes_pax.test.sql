-- =============================================================================
-- pgTAP — pax porté par la collecte (décision Val 2026-10-20), migration
-- 20261021073000_plateforme_collectes_pax.sql
-- =============================================================================
-- Prouve :
--   • la colonne `collectes.pax` (NOT NULL, >= 0, défaut 0) ; un pax absent ou 0
--     à l'INSERT prend celui de la dernière collecte non annulée de l'événement,
--     sinon celui de l'événement (jamais la somme des jours) ;
--   • `fn_creer_collecte` / `fn_ajouter_collecte_evenement` écrivent `p_pax` et
--     refusent un pax < 1 ;
--   • le pax de l'événement est calculé depuis ses collectes non annulées
--     (règle C1 : par jour, le plus grand pax ; puis la somme des jours), y
--     compris après modification, annulation et ajout ; un événement sans
--     collecte non annulée garde son pax ;
--   • le volume de repas estimé AG = 10 % du pax de LA collecte ;
--   • `fn_modifier_collecte` modifie le pax (entier >= 1, refus sinon) et émet
--     son E2 quand une commande existe ; `fn_modifier_evenement` refuse le pax ;
--   • la suppression des collectes d'un événement passe ;
--   • un client n'exécute ni les fonctions de déclencheur, ni f_pax_evenement, ni les RPC.
-- =============================================================================

BEGIN;
SELECT plan(41);

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Jeu d'essai ──────────────────────────────────────────────────────────────
-- La fixture crée un événement (pax 100) et une collecte ZD commandée (J+30),
-- sans pax passé : elle prend celui de l'événement.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT tests.outbox_fixture_collecte('zd') AS commandee,
       NULL::uuid AS evt,
       NULL::uuid AS zd_a, NULL::uuid AS ag_a, NULL::uuid AS zd_b,
       NULL::uuid AS ajoutee, NULL::uuid AS evt_seul, NULL::uuid AS seule;
UPDATE t SET evt = (SELECT evenement_id FROM plateforme.collectes WHERE id = t.commandee);

CREATE FUNCTION pg_temp.collecte(p_evt uuid, p_type text, p_jours int, p_pax int) RETURNS uuid LANGUAGE sql AS $$
  SELECT plateforme.fn_creer_collecte(
    p_evenement_id   := p_evt,
    p_type           := p_type,
    p_date_collecte  := CURRENT_DATE + p_jours,
    p_heure_collecte := '22:00'::time,
    p_pax            := p_pax
  )
$$;
CREATE FUNCTION pg_temp.pax(p_id uuid) RETURNS integer LANGUAGE sql AS
  $$ SELECT pax FROM plateforme.collectes WHERE id = p_id $$;
CREATE FUNCTION pg_temp.pax_evt(p_id uuid) RETURNS integer LANGUAGE sql AS
  $$ SELECT pax FROM plateforme.evenements WHERE id = p_id $$;

-- ── Colonne ──────────────────────────────────────────────────────────────────
SELECT col_not_null('plateforme', 'collectes', 'pax', 'collectes.pax est NOT NULL');
SELECT col_default_is('plateforme', 'collectes', 'pax', '0', 'collectes.pax a 0 pour défaut (inconnu)');
SELECT throws_ok(
  $$ UPDATE plateforme.collectes SET pax = -1 WHERE id = (SELECT commandee FROM t) $$,
  '23514', NULL, 'un pax négatif est refusé (collectes_pax_positif)');

-- ── Pax absent : première collecte → celui de l'événement ; sinon la dernière ─
SELECT is(pg_temp.pax((SELECT commandee FROM t)), 100,
  'collecte créée sans pax : celui de l''événement');

INSERT INTO plateforme.collectes (evenement_id, type, date_collecte, heure_collecte, statut, statut_tms, pax)
SELECT evt, 'zero_dechet', CURRENT_DATE + 30, '23:00', 'programmee', 'non_envoye', 0 FROM t;
SELECT is(
  (SELECT pax FROM plateforme.collectes WHERE evenement_id = (SELECT evt FROM t) AND heure_collecte = '23:00'),
  100, 'collecte insérée avec pax 0 (défaut, inconnu) : celui de la dernière collecte (100)');
DELETE FROM plateforme.collectes WHERE evenement_id = (SELECT evt FROM t) AND heure_collecte = '23:00';

-- ── fn_creer_collecte : p_pax ────────────────────────────────────────────────
-- Jour A (J+40) : une ZD et une AG à 1 800 ; jour B (J+41) : une ZD à 1 200.
UPDATE t SET zd_a = pg_temp.collecte(evt, 'zd', 40, 1800),
             ag_a = pg_temp.collecte(evt, 'ag', 40, 1800),
             zd_b = pg_temp.collecte(evt, 'zd', 41, 1200);
SELECT is(ARRAY[pg_temp.pax((SELECT zd_a FROM t)), pg_temp.pax((SELECT ag_a FROM t)), pg_temp.pax((SELECT zd_b FROM t))],
  ARRAY[1800, 1800, 1200], 'fn_creer_collecte écrit le pax passé');
SELECT throws_ok(
  $$ SELECT pg_temp.collecte((SELECT evt FROM t), 'zd', 42, 0) $$,
  'P0001', 'PAX_INVALIDE: le nombre de convives doit être un entier >= 1 (reçu 0)',
  'fn_creer_collecte refuse un pax < 1');

-- ── Volume AG : 10 % du pax de la collecte ───────────────────────────────────
SELECT is(
  (SELECT volume_estime_repas FROM plateforme.collectes WHERE id = (SELECT ag_a FROM t)),
  180, 'volume de repas estimé AG = 10 % du pax de la collecte (1 800), pas de l''événement');

-- ── Pax de l'événement (règle C1) ────────────────────────────────────────────
-- J+30 : 100 ; J+40 : max(1 800, 1 800) ; J+41 : 1 200 → 3 100.
SELECT is(plateforme.f_pax_evenement((SELECT evt FROM t)), 3100,
  'pax_par_collecte_evenement_calcule — f_pax_evenement : par jour le plus grand pax, puis la somme des jours');
SELECT is(pg_temp.pax_evt((SELECT evt FROM t)), 3100,
  'evenements.pax recalculé à la création des collectes');

-- ── Pax absent à l'INSERT : la dernière collecte, pas la somme des jours ────
-- La dernière collecte (J+41) porte 1 200 ; l'événement, 3 100. Une collecte
-- créée sans pax à J+42 prend 1 200 : avec le pax de l'événement, elle prendrait
-- 3 100, puis la suivante 7 400 (le pax gonflerait à chaque ajout).
SELECT is(pg_temp.pax(pg_temp.collecte((SELECT evt FROM t), 'zd', 42, NULL)), 1200,
  'collecte créée sans pax : celui de la dernière collecte de l''événement, pas la somme des jours');
SELECT is(pg_temp.pax_evt((SELECT evt FROM t)), 4300,
  'evenements.pax compte la collecte ajoutée sans pax pour 1 200 (100 + 1 800 + 1 200 + 1 200)');
DELETE FROM plateforme.collectes
 WHERE evenement_id = (SELECT evt FROM t) AND date_collecte = CURRENT_DATE + 42;
SELECT is(pg_temp.pax_evt((SELECT evt FROM t)), 3100,
  'evenements.pax recalculé à la suppression de la collecte');

-- ── fn_modifier_collecte : le pax ────────────────────────────────────────────
SELECT plateforme.fn_modifier_collecte((SELECT ag_a FROM t), '{"pax": 2000}'::jsonb, ARRAY['pax']);
SELECT is(pg_temp.pax((SELECT ag_a FROM t)), 2000, 'fn_modifier_collecte modifie le pax');
SELECT is(
  (SELECT volume_estime_repas FROM plateforme.collectes WHERE id = (SELECT ag_a FROM t)),
  200, 'le volume AG suit le pax modifié de la collecte');
SELECT is(pg_temp.pax_evt((SELECT evt FROM t)), 3300,
  'evenements.pax recalculé après modification (100 + 2 000 + 1 200)');
SELECT is(pg_temp.pax((SELECT zd_a FROM t)), 1800,
  'modifier le pax d''une collecte ne touche pas celui de sa voisine du même jour');

SELECT throws_ok(
  $$ SELECT plateforme.fn_modifier_collecte((SELECT zd_a FROM t), '{"pax": 0}'::jsonb, ARRAY['pax']) $$,
  'P0001', NULL, 'fn_modifier_collecte refuse un pax à 0');
SELECT throws_ok(
  $$ SELECT plateforme.fn_modifier_collecte((SELECT zd_a FROM t), '{"pax": 12.5}'::jsonb, ARRAY['pax']) $$,
  'P0001', NULL, 'fn_modifier_collecte refuse un pax décimal');
SELECT throws_ok(
  $$ SELECT plateforme.fn_modifier_collecte((SELECT zd_a FROM t), '{"pax": "800"}'::jsonb, ARRAY['pax']) $$,
  'P0001', NULL, 'fn_modifier_collecte refuse un pax qui n''est pas un nombre');
SELECT throws_ok(
  $$ SELECT plateforme.fn_modifier_collecte((SELECT zd_a FROM t), '{"pax": null}'::jsonb, ARRAY['pax']) $$,
  'P0001', NULL, 'fn_modifier_collecte refuse un pax vide');

-- E2 : la collecte commandée reçoit un ordre de modification qui nomme le pax.
SELECT plateforme.fn_modifier_collecte((SELECT commandee FROM t), '{"pax": 150}'::jsonb, ARRAY['pax']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = (SELECT commandee FROM t)
      AND event_type = 'collecte.modifiee'
      AND payload->'champs_modifies' = '["pax"]'::jsonb),
  1, 'collecte commandée : modifier son pax émet un E2 qui nomme le pax');
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id IN (SELECT unnest(ARRAY[zd_a, ag_a, zd_b]) FROM t)
      AND event_type = 'collecte.modifiee'),
  0, 'collectes sans commande : pas d''E2 sur leur pax');

-- ── Annulation : la collecte annulée ne compte plus ──────────────────────────
SELECT plateforme.fn_modifier_collecte((SELECT zd_b FROM t), '{"statut": "annulee"}'::jsonb, ARRAY['statut']);
SELECT is(pg_temp.pax_evt((SELECT evt FROM t)), 2150,
  'evenements.pax recalculé à l''annulation (150 + 2 000)');
-- La collecte annulée (J+41, 1 200) est la plus tardive : une collecte créée
-- sans pax prend celui d'une collecte non annulée de J+40 (1 800 ou 2 000,
-- même date et même heure), jamais le sien.
SELECT ok(pg_temp.pax(pg_temp.collecte((SELECT evt FROM t), 'zd', 42, NULL)) IN (1800, 2000),
  'collecte créée sans pax : jamais celui d''une collecte annulée');
DELETE FROM plateforme.collectes
 WHERE evenement_id = (SELECT evt FROM t) AND date_collecte = CURRENT_DATE + 42;
SELECT is(pg_temp.pax_evt((SELECT evt FROM t)), 2150,
  'evenements.pax revenu à 2 150 après suppression de la collecte ajoutée');
-- Une collecte au pax inconnu (0, reprise Bubble), la plus tardive, n'est pas
-- prise non plus : une collecte créée sans pax prend celui de J+40.
ALTER TABLE t ADD COLUMN inconnue uuid;
UPDATE t SET inconnue = pg_temp.collecte(evt, 'zd', 44, 500);
UPDATE plateforme.collectes SET pax = 0 WHERE id = (SELECT inconnue FROM t);
SELECT ok(pg_temp.pax(pg_temp.collecte((SELECT evt FROM t), 'zd', 45, NULL)) IN (1800, 2000),
  'collecte créée sans pax : jamais le pax inconnu (0) d''une collecte existante');
DELETE FROM plateforme.collectes
 WHERE evenement_id = (SELECT evt FROM t) AND date_collecte IN (CURRENT_DATE + 44, CURRENT_DATE + 45);
SELECT is(pg_temp.pax_evt((SELECT evt FROM t)), 2150,
  'evenements.pax revenu à 2 150 après suppression des deux collectes ajoutées');

-- ── fn_ajouter_collecte_evenement : p_pax ────────────────────────────────────
UPDATE t SET ajoutee = plateforme.fn_ajouter_collecte_evenement(
  p_evenement_id := evt, p_type := 'zd', p_date_collecte := CURRENT_DATE + 43,
  p_heure_collecte := '21:00'::time, p_pax := 650);
SELECT is(pg_temp.pax((SELECT ajoutee FROM t)), 650,
  'fn_ajouter_collecte_evenement écrit le pax passé');
SELECT is(pg_temp.pax_evt((SELECT evt FROM t)), 2800,
  'evenements.pax recalculé à l''ajout d''une collecte (150 + 2 000 + 650)');

-- ── fn_modifier_evenement : le pax n'est plus un champ de l'événement ───────
SELECT throws_ok(
  $$ SELECT plateforme.fn_modifier_evenement((SELECT evt FROM t), '{"pax": 999}'::jsonb, ARRAY['pax']) $$,
  'P0001', 'PAX_SUR_COLLECTE: le nombre de convives se modifie sur chaque collecte',
  'fn_modifier_evenement refuse le pax');
SELECT is(pg_temp.pax_evt((SELECT evt FROM t)), 2800, 'le pax de l''événement est inchangé après le refus');

-- ── Événement sans collecte non annulée : son pax est gardé ──────────────────
WITH e AS (
  INSERT INTO plateforme.evenements (
    organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
    lieu_id, created_by, type_evenement_id, nom_evenement, pax,
    contact_principal_nom, contact_principal_telephone
  )
  SELECT organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
         lieu_id, created_by, type_evenement_id, 'Événement seul', 300,
         contact_principal_nom, contact_principal_telephone
    FROM plateforme.evenements WHERE id = (SELECT evt FROM t)
  RETURNING id
)
UPDATE t SET evt_seul = (SELECT id FROM e);
UPDATE t SET seule = pg_temp.collecte(evt_seul, 'zd', 45, 250);
SELECT is(pg_temp.pax_evt((SELECT evt_seul FROM t)), 250,
  'un événement à une seule collecte prend son pax');
SELECT plateforme.fn_modifier_collecte((SELECT seule FROM t), '{"statut": "annulee"}'::jsonb, ARRAY['statut']);
SELECT is(pg_temp.pax_evt((SELECT evt_seul FROM t)), 250,
  'toutes ses collectes annulées : l''événement garde son dernier pax');

-- ── Suppression des collectes d'un événement ─────────────────────────────────
-- La dernière collecte supprimée laisse l'événement sans collecte : son pax est
-- gardé, sans erreur ; l'événement se supprime ensuite.
SELECT lives_ok(
  $$ DELETE FROM plateforme.collectes WHERE evenement_id = (SELECT evt_seul FROM t) $$,
  'supprimer toutes les collectes d''un événement passe (le recalcul du pax ne gêne pas)');
DELETE FROM plateforme.evenements WHERE id = (SELECT evt_seul FROM t);

-- ── Sous rôle client : ni fonctions de déclencheur ni RPC ────────────────────
GRANT SELECT ON t TO authenticated;
SELECT test_set_jwt(
  'traiteur_manager',
  (SELECT e.organisation_id FROM plateforme.evenements e WHERE e.id = (SELECT evt FROM t))
);
SELECT throws_ok(
  $$ SELECT plateforme.fn_set_pax_evenement() $$,
  '42501', NULL, 'traiteur_manager n''exécute pas fn_set_pax_evenement');
SELECT throws_ok(
  $$ SELECT plateforme.fn_collectes_pax_par_defaut() $$,
  '42501', NULL, 'traiteur_manager n''exécute pas fn_collectes_pax_par_defaut');
SELECT throws_ok(
  $$ SELECT plateforme.fn_modifier_collecte((SELECT zd_a FROM t), '{"pax": 10}'::jsonb, ARRAY['pax']) $$,
  '42501', NULL, 'traiteur_manager n''appelle pas fn_modifier_collecte (service_role seul)');

SELECT test_as_superuser();

-- ── Droits : aucune fonction du lot n'est exécutable par un rôle client ─────
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.f_pax_evenement(uuid)', 'execute'),
  'f_pax_evenement : EXECUTE refusé à authenticated');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.f_pax_evenement(uuid)', 'execute'),
  'f_pax_evenement : EXECUTE refusé à anon');
SELECT ok(NOT has_function_privilege('authenticated',
  'plateforme.fn_ajouter_collecte_evenement(uuid, text, date, time, boolean, text, integer)', 'execute'),
  'fn_ajouter_collecte_evenement (avec p_pax) : EXECUTE refusé à authenticated');

SELECT * FROM finish();
ROLLBACK;
