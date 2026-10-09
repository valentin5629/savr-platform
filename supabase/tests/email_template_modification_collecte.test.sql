-- =============================================================================
-- pgTAP — template email « admin_modification_collecte_traiteur » (CDC §06.02 n°19)
-- =============================================================================
-- Scénario `email_modification_rendu` (couche db), demande Val 2026-10-09 :
-- après toutes les migrations (seed 20260705100000, corps 20261009160000, lieu et
-- lien 20261009190000), l'email de modification liste les champs modifiés avec
-- leurs valeurs, nomme le lieu, le programmateur et le statut, porte un lien
-- vers la fiche, et ne garde de la priorité qu'une ligne ATTENTION
-- conditionnelle.
--
-- Sous rôle (revue sécurité) : le corps porte désormais un bloc HTML construit
-- par le code, l'email historise des téléphones dans `emails_envoyes`, et les
-- valeurs « avant » de l'événement sont relues dans `audit_log`. Les quatre
-- rôles qui déclenchent l'email (traiteur manager et commercial, agence,
-- gestionnaire de lieux) ne lisent ni les gabarits ni les emails envoyés, et ne
-- peuvent pas forger la ligne d'audit relue ; `admin_savr` sert de témoin (les
-- « 0 ligne » sont des refus, pas des tables vides).
-- =============================================================================

BEGIN;
SELECT plan(36);

-- Helpers de rôle, signatures de rls_0_4_smoke.test.sql.
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
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

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.email_templates
   WHERE code = 'admin_modification_collecte_traiteur' AND actif = true),
  1,
  'admin_modification_collecte_traiteur : 1 template actif'
);

SELECT is(
  (SELECT variables FROM plateforme.email_templates
   WHERE code = 'admin_modification_collecte_traiteur'),
  ARRAY['organisation_nom','date_initiale','pax_initial','lieu_nom','liste_modifications','programmateur','statut_collecte','priorite_urgence','lien_fiche']::text[],
  'admin_modification_collecte_traiteur : variables du corps, lieu et lien compris'
);

SELECT ok(
  (SELECT corps_html LIKE '%L''organisation {{organisation_nom}} a modifié la collecte initialement prévue le {{date_initiale}}%'
      AND corps_html LIKE '%{{liste_modifications}}%'
      AND corps_html LIKE '%Le statut actuel de la collecte est « {{statut_collecte}} ».%'
      AND corps_html LIKE '%L''équipe Savr%'
   FROM plateforme.email_templates WHERE code = 'admin_modification_collecte_traiteur'),
  'admin_modification_collecte_traiteur : organisation, date d''origine, liste des modifications, statut, signature'
);

SELECT ok(
  (SELECT corps_html LIKE '%{{#if pax_initial}} pour {{pax_initial}} pax{{/if}}{{#if lieu_nom}} (lieu : {{lieu_nom}}){{/if}}.</p>%'
      AND corps_html LIKE '%{{#if programmateur}}<p>Le programmateur est {{programmateur}}.</p>%'
      AND corps_html LIKE '%{{#if priorite_urgence}}<p>ATTENTION : modification effectuée moins de 12h avant le créneau de collecte.%'
      AND corps_html LIKE '%{{#if lien_fiche}}<p><a href="{{lien_fiche}}">Ouvrir la fiche de la collecte</a></p>%'
   FROM plateforme.email_templates WHERE code = 'admin_modification_collecte_traiteur'),
  'admin_modification_collecte_traiteur : pax, lieu, programmateur, ligne ATTENTION et lien en blocs conditionnels'
);

SELECT ok(
  (SELECT corps_html NOT LIKE '%{{collecte_ref}}%'
      AND corps_html NOT LIKE '%{{demandeur_nom}}%'
      AND corps_html NOT LIKE '%{{champs_modifies}}%'
      AND corps_html NOT LIKE '%Priorité de traitement%'
   FROM plateforme.email_templates WHERE code = 'admin_modification_collecte_traiteur'),
  'admin_modification_collecte_traiteur : plus d''identifiant technique ni de ligne « Priorité de traitement »'
);

SELECT is(
  (SELECT ARRAY(SELECT DISTINCT m[1]
                  FROM regexp_matches(t.corps_html, '\{\{(?:#if\s+)?(\w+)\}\}', 'g') AS m
                 ORDER BY 1)
   FROM plateforme.email_templates t WHERE t.code = 'admin_modification_collecte_traiteur'),
  (SELECT ARRAY(SELECT v FROM unnest(t.variables) AS v ORDER BY 1)
   FROM plateforme.email_templates t WHERE t.code = 'admin_modification_collecte_traiteur'),
  'admin_modification_collecte_traiteur : toute variable du corps est déclarée, toute variable déclarée est dans le corps'
);

SELECT is(
  (SELECT (length(corps_html) - length(replace(corps_html, '{{#if', ''))) / length('{{#if')
   FROM plateforme.email_templates WHERE code = 'admin_modification_collecte_traiteur'),
  (SELECT (length(corps_html) - length(replace(corps_html, '{{/if}}', ''))) / length('{{/if}}')
   FROM plateforme.email_templates WHERE code = 'admin_modification_collecte_traiteur'),
  'admin_modification_collecte_traiteur : autant de blocs conditionnels ouverts que fermés'
);

-- ── Sous rôle ────────────────────────────────────────────────────────────────
-- Fixture : un envoi de ce template, tel que le code l'historise (téléphone du
-- programmateur dans les variables).
INSERT INTO plateforme.emails_envoyes (template_code, destinataire, sujet, statut, variables_jsonb)
VALUES ('admin_modification_collecte_traiteur', 'contact@gosavr.io', 'Modification d''une collecte à venir',
        'sent', '{"programmateur":"Julie Martin, joignable au 0601020304"}'::jsonb);

-- traiteur_manager
SELECT test_set_jwt('traiteur_manager', '0b9e5700-0000-0000-0000-000000000001'::uuid);
SELECT is((SELECT count(*)::int FROM plateforme.email_templates), 0,
  'traiteur_manager ne lit aucun gabarit');
SELECT throws_ok(
  $$INSERT INTO plateforme.email_templates (code, sujet, corps_html) VALUES ('sonde_role', 'x', '<p>x</p>')$$,
  '42501', NULL, 'traiteur_manager ne crée pas de gabarit');
WITH maj AS (UPDATE plateforme.email_templates SET corps_html = '<p>détourné</p>' RETURNING 1)
SELECT is((SELECT count(*)::int FROM maj), 0, 'traiteur_manager ne réécrit aucun gabarit');
WITH sup AS (DELETE FROM plateforme.email_templates RETURNING 1)
SELECT is((SELECT count(*)::int FROM sup), 0, 'traiteur_manager ne supprime aucun gabarit');
SELECT is((SELECT count(*)::int FROM plateforme.emails_envoyes), 0,
  'traiteur_manager ne lit aucun email envoyé (variables : téléphones)');
SELECT throws_ok(
  $$INSERT INTO plateforme.audit_log (id, table_name, record_id, action, user_id, old_values, new_values)
    VALUES (9000000000000002, 'evenements', gen_random_uuid(), 'UPDATE', gen_random_uuid(),
            '{"pax":"<b>forgé</b>"}', '{"updates":{"pax":1}}')$$,
  '42501', NULL, 'traiteur_manager ne forge pas la ligne d''audit que l''email relit');

-- traiteur_commercial
SELECT test_set_jwt('traiteur_commercial', '0b9e5700-0000-0000-0000-000000000001'::uuid);
SELECT is((SELECT count(*)::int FROM plateforme.email_templates), 0,
  'traiteur_commercial ne lit aucun gabarit');
SELECT throws_ok(
  $$INSERT INTO plateforme.email_templates (code, sujet, corps_html) VALUES ('sonde_role', 'x', '<p>x</p>')$$,
  '42501', NULL, 'traiteur_commercial ne crée pas de gabarit');
WITH maj AS (UPDATE plateforme.email_templates SET corps_html = '<p>détourné</p>' RETURNING 1)
SELECT is((SELECT count(*)::int FROM maj), 0, 'traiteur_commercial ne réécrit aucun gabarit');
WITH sup AS (DELETE FROM plateforme.email_templates RETURNING 1)
SELECT is((SELECT count(*)::int FROM sup), 0, 'traiteur_commercial ne supprime aucun gabarit');
SELECT is((SELECT count(*)::int FROM plateforme.emails_envoyes), 0,
  'traiteur_commercial ne lit aucun email envoyé (variables : téléphones)');
SELECT throws_ok(
  $$INSERT INTO plateforme.audit_log (id, table_name, record_id, action, user_id, old_values, new_values)
    VALUES (9000000000000003, 'evenements', gen_random_uuid(), 'UPDATE', gen_random_uuid(),
            '{"pax":"<b>forgé</b>"}', '{"updates":{"pax":1}}')$$,
  '42501', NULL, 'traiteur_commercial ne forge pas la ligne d''audit que l''email relit');

-- agence et gestionnaire de lieux déclenchent le même email (Val 2026-10-09).
SELECT test_set_jwt('agence', '0b9e5700-0000-0000-0000-000000000002'::uuid);
SELECT is((SELECT count(*)::int FROM plateforme.email_templates), 0,
  'agence ne lit aucun gabarit');
SELECT throws_ok(
  $$INSERT INTO plateforme.email_templates (code, sujet, corps_html) VALUES ('sonde_role', 'x', '<p>x</p>')$$,
  '42501', NULL, 'agence ne crée pas de gabarit');
WITH maj AS (UPDATE plateforme.email_templates SET corps_html = '<p>détourné</p>' RETURNING 1)
SELECT is((SELECT count(*)::int FROM maj), 0, 'agence ne réécrit aucun gabarit');
WITH sup AS (DELETE FROM plateforme.email_templates RETURNING 1)
SELECT is((SELECT count(*)::int FROM sup), 0, 'agence ne supprime aucun gabarit');
SELECT is((SELECT count(*)::int FROM plateforme.emails_envoyes), 0,
  'agence ne lit aucun email envoyé (variables : téléphones)');
SELECT throws_ok(
  $$INSERT INTO plateforme.audit_log (id, table_name, record_id, action, user_id, old_values, new_values)
    VALUES (9000000000000004, 'evenements', gen_random_uuid(), 'UPDATE', gen_random_uuid(),
            '{"pax":"<b>forgé</b>"}', '{"updates":{"pax":1}}')$$,
  '42501', NULL, 'agence ne forge pas la ligne d''audit que l''email relit');

SELECT test_set_jwt('gestionnaire_lieux', '0b9e5700-0000-0000-0000-000000000003'::uuid);
SELECT is((SELECT count(*)::int FROM plateforme.email_templates), 0,
  'gestionnaire_lieux ne lit aucun gabarit');
SELECT throws_ok(
  $$INSERT INTO plateforme.email_templates (code, sujet, corps_html) VALUES ('sonde_role', 'x', '<p>x</p>')$$,
  '42501', NULL, 'gestionnaire_lieux ne crée pas de gabarit');
WITH maj AS (UPDATE plateforme.email_templates SET corps_html = '<p>détourné</p>' RETURNING 1)
SELECT is((SELECT count(*)::int FROM maj), 0, 'gestionnaire_lieux ne réécrit aucun gabarit');
WITH sup AS (DELETE FROM plateforme.email_templates RETURNING 1)
SELECT is((SELECT count(*)::int FROM sup), 0, 'gestionnaire_lieux ne supprime aucun gabarit');
SELECT is((SELECT count(*)::int FROM plateforme.emails_envoyes), 0,
  'gestionnaire_lieux ne lit aucun email envoyé (variables : téléphones)');
SELECT throws_ok(
  $$INSERT INTO plateforme.audit_log (id, table_name, record_id, action, user_id, old_values, new_values)
    VALUES (9000000000000005, 'evenements', gen_random_uuid(), 'UPDATE', gen_random_uuid(),
            '{"pax":"<b>forgé</b>"}', '{"updates":{"pax":1}}')$$,
  '42501', NULL, 'gestionnaire_lieux ne forge pas la ligne d''audit que l''email relit');

-- ops_savr : les emails envoyés lui sont fermés aussi (données personnelles).
SELECT test_set_jwt('ops_savr', NULL);
SELECT is((SELECT count(*)::int FROM plateforme.emails_envoyes), 0,
  'ops_savr ne lit aucun email envoyé');

-- Témoins de non-vacuité : admin_savr lit, donc les « 0 » ci-dessus sont des refus.
SELECT test_set_jwt('admin_savr', NULL);
SELECT is((SELECT count(*)::int FROM plateforme.email_templates
            WHERE code = 'admin_modification_collecte_traiteur'), 1,
  'témoin : admin_savr lit le gabarit');
SELECT is((SELECT count(*)::int FROM plateforme.emails_envoyes
            WHERE template_code = 'admin_modification_collecte_traiteur'
              AND variables_jsonb ? 'programmateur'), 1,
  'témoin : admin_savr lit l''email envoyé et ses variables');

SELECT test_as_superuser();
SELECT is((SELECT count(*)::int FROM plateforme.email_templates WHERE corps_html = '<p>détourné</p>'), 0,
  'aucun gabarit réécrit');
SELECT is((SELECT count(*)::int FROM plateforme.email_templates
            WHERE code = 'admin_modification_collecte_traiteur'), 1,
  'le gabarit de l''email n''a pas été supprimé');

SELECT * FROM finish();
ROLLBACK;
