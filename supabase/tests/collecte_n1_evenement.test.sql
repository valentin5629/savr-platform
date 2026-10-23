-- =============================================================================
-- pgTAP — l'événement garde le type d'événement et les contacts de sa collecte
-- n°1 (refonte du formulaire, lot B1 ; décision Val 2026-10-23, B1-Q2),
-- migration 20261023100000_plateforme_collecte_type_contacts_modifiables.sql
-- =============================================================================
-- Collecte n°1 = première collecte non annulée, Zéro-Déchet avant Anti-Gaspi,
-- puis par date, heure et création. Prouve :
--   • la copie suit la collecte n°1, et elle seule (une autre collecte modifiée
--     ne la change pas) ;
--   • une collecte n°1 annulée passe la main à la suivante ; sans Zéro-Déchet,
--     l'Anti-Gaspi la plus tôt ; sans collecte non annulée, la copie reste ;
--   • les fonctions de la copie ne sont exécutables par aucun rôle client.
-- =============================================================================

BEGIN;
SELECT plan(11);

-- ── Jeu d'essai : un événement, trois collectes aux dates maîtrisées ─────────
-- zd_tard : Zéro-Déchet à J+20 (celle du jeu d'essai commun, commandée) ;
-- zd_tot  : Zéro-Déchet à J+15 → collecte n°1 ;
-- ag_tot  : Anti-Gaspi à J+10 (plus tôt, mais Anti-Gaspi passe après).
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT tests.outbox_fixture_collecte('zd') AS zd_tard,
       NULL::uuid AS evt, NULL::uuid AS zd_tot, NULL::uuid AS ag_tot,
       NULL::uuid AS type_initial, NULL::uuid AS autre_type;
UPDATE t SET evt = c.evenement_id FROM plateforme.collectes c WHERE c.id = t.zd_tard;
UPDATE t SET type_initial = e.type_evenement_id FROM plateforme.evenements e WHERE e.id = t.evt;
UPDATE plateforme.collectes SET date_collecte = CURRENT_DATE + 20, heure_collecte = '20:00'
 WHERE id = (SELECT zd_tard FROM t);
UPDATE t SET zd_tot = plateforme.fn_creer_collecte(
  p_evenement_id := evt, p_type := 'zd',
  p_date_collecte := CURRENT_DATE + 15, p_heure_collecte := '20:00'::time, p_pax := 80);
UPDATE t SET ag_tot = plateforme.fn_creer_collecte(
  p_evenement_id := evt, p_type := 'ag',
  p_date_collecte := CURRENT_DATE + 10, p_heure_collecte := '20:00'::time, p_pax := 80);
INSERT INTO plateforme.types_evenements (code, libelle, created_at, updated_at)
VALUES ('LOT_B1_AUTRE_TYPE', 'Lot B1 autre type', now(), now())
ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle;
UPDATE t SET autre_type = (SELECT id FROM plateforme.types_evenements WHERE code = 'LOT_B1_AUTRE_TYPE');

CREATE FUNCTION pg_temp.copie() RETURNS text LANGUAGE sql AS $$
  SELECT e.contact_principal_nom || ' / ' || e.contact_principal_telephone
    FROM plateforme.evenements e, t WHERE e.id = t.evt
$$;
CREATE FUNCTION pg_temp.type_copie() RETURNS uuid LANGUAGE sql AS $$
  SELECT e.type_evenement_id FROM plateforme.evenements e, t WHERE e.id = t.evt
$$;
CREATE FUNCTION pg_temp.contact(p_collecte uuid, p_nom text, p_tel text) RETURNS void LANGUAGE sql AS $$
  SELECT plateforme.fn_modifier_collecte(p_collecte,
    jsonb_build_object('contact_principal_nom', p_nom, 'contact_principal_telephone', p_tel),
    ARRAY['contact_principal_nom', 'contact_principal_telephone']);
$$;

-- ── La copie suit la collecte n°1, et elle seule ────────────────────────────
SELECT pg_temp.contact((SELECT zd_tot FROM t), 'Nina Premiere', '0610000001');
SELECT is(pg_temp.copie(), 'Nina Premiere / 0610000001',
  'contacts de la collecte n°1 (Zéro-Déchet la plus tôt) : copiés sur l’événement');

SELECT pg_temp.contact((SELECT zd_tard FROM t), 'Tom Tardif', '0610000002');
SELECT is(pg_temp.copie(), 'Nina Premiere / 0610000001',
  'contacts d’une autre Zéro-Déchet : la copie ne bouge pas');

SELECT pg_temp.contact((SELECT ag_tot FROM t), 'Ana Gaspi', '0610000003');
SELECT is(pg_temp.copie(), 'Nina Premiere / 0610000001',
  'contacts d’une Anti-Gaspi plus tôt : la copie ne bouge pas (Zéro-Déchet d’abord)');

SELECT plateforme.fn_modifier_collecte((SELECT ag_tot FROM t),
  jsonb_build_object('type_evenement_id', (SELECT autre_type FROM t)), ARRAY['type_evenement_id']);
SELECT is(pg_temp.type_copie(), (SELECT type_initial FROM t),
  'type d’une collecte qui n’est pas la n°1 : la copie ne bouge pas');

SELECT plateforme.fn_modifier_collecte((SELECT zd_tot FROM t),
  jsonb_build_object('type_evenement_id', (SELECT autre_type FROM t)), ARRAY['type_evenement_id']);
SELECT is(pg_temp.type_copie(), (SELECT autre_type FROM t),
  'type de la collecte n°1 : copié sur l’événement');

-- ── Annulations : la suivante prend le relais ───────────────────────────────
SELECT plateforme.fn_modifier_collecte((SELECT zd_tot FROM t), '{"statut": "annulee"}'::jsonb, ARRAY['statut']);
SELECT is(pg_temp.copie(), 'Tom Tardif / 0610000002',
  'collecte n°1 annulée : la Zéro-Déchet suivante prend le relais');
SELECT is(pg_temp.type_copie(), (SELECT type_initial FROM t),
  'collecte n°1 annulée : le type de la suivante est copié');

UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = (SELECT zd_tard FROM t);
SELECT is(pg_temp.copie(), 'Ana Gaspi / 0610000003',
  'plus de Zéro-Déchet non annulée : l’Anti-Gaspi la plus tôt prend le relais');

UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = (SELECT ag_tot FROM t);
SELECT is(pg_temp.copie(), 'Ana Gaspi / 0610000003',
  'toutes les collectes annulées : la copie reste telle quelle');

-- ── Aucun rôle client n'exécute les fonctions de la copie ───────────────────
SELECT ok(NOT has_function_privilege('authenticated',
  'plateforme.fn_evenement_suit_collecte_n1(uuid)', 'EXECUTE'),
  'fn_evenement_suit_collecte_n1 : EXECUTE refusé à authenticated');
SELECT ok(NOT has_function_privilege('anon',
  'plateforme.fn_evenement_suit_collecte_n1(uuid)', 'EXECUTE'),
  'fn_evenement_suit_collecte_n1 : EXECUTE refusé à anon');

SELECT * FROM finish();
ROLLBACK;
