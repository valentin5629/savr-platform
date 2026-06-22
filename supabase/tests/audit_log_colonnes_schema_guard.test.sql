-- pgTAP — Garde anti-récurrence « colonne inexistante » pour plateforme.audit_log.
--
-- Contexte : plusieurs routes API inséraient dans audit_log avec les clés `old_data`
-- / `new_data` (colonnes INEXISTANTES) au lieu de `old_values` / `new_values`. L'insert
-- était awaité sans contrôle d'erreur → l'opération métier réussissait mais la ligne
-- d'audit n'était JAMAIS écrite (perte de traçabilité RGPD silencieuse).
--
-- Les tests unitaires (Supabase mocké) ne valident pas le schéma → ce garde exécute en
-- LIMIT 0 EXACTEMENT les colonnes écrites par les routes contre le schéma réel, et
-- vérifie explicitement que `old_data`/`new_data` n'existent PAS.
--
-- ⚠ À maintenir en miroir des .from('audit_log').insert({...}) des routes API
--    (admin/transporteurs, associations, lieux, collectes, dispatch, parametres/co2-divers,
--     traiteur/collectes).

BEGIN;
SELECT plan(4);

-- Les colonnes réellement écrites par les routes existent (action, table_name,
-- record_id, user_id, old_values, new_values).
SELECT lives_ok(
  $$ SELECT id, user_id, role, action, table_name, record_id,
            old_values, new_values, created_at
     FROM plateforme.audit_log LIMIT 0 $$,
  'audit_log : colonnes écrites par les routes existent (old_values/new_values)'
);

-- Anti-récurrence : les anciens noms fautifs ne doivent PAS exister.
SELECT throws_ok(
  $$ SELECT old_data FROM plateforme.audit_log LIMIT 0 $$,
  '42703', -- undefined_column
  NULL,
  'audit_log : old_data n''existe pas (clé fautive — doit être old_values)'
);

SELECT throws_ok(
  $$ SELECT new_data FROM plateforme.audit_log LIMIT 0 $$,
  '42703', -- undefined_column
  NULL,
  'audit_log : new_data n''existe pas (clé fautive — doit être new_values)'
);

-- L'insert réel des routes (clés correctes) passe le schéma (RLS bypass : rôle postgres).
SELECT lives_ok(
  $$ INSERT INTO plateforme.audit_log
       (action, table_name, record_id, user_id, old_values, new_values)
     VALUES ('UPDATE', 'collectes', NULL, NULL,
             '{"a":1}'::jsonb, '{"b":2}'::jsonb) $$,
  'audit_log : INSERT avec old_values/new_values réussit (forme exacte des routes)'
);

SELECT * FROM finish();
ROLLBACK;
