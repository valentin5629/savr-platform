-- pgTAP R19b-P2 (M3.2) — GRANT colonne capacite_maximum sur lieux.
-- Régression P0 (revue data-model 2026-07-06) : la vue v_lieux_clients est
-- SECURITY INVOKER → PostgreSQL évalue les privilèges COLONNE de `authenticated`
-- sur tout le SELECT sous-jacent. Le fix P1 masquage (20260617170000) a REVOKE le
-- SELECT table-level puis GRANT une liste FIGÉE ; `capacite_maximum` (R17c) n'y
-- était pas → SELECT de la vue = « permission denied for table lieux » cassant
-- TOUTE la lecture v_lieux_clients (liste + fiche lieu gestionnaire).
-- Ce test échoue tant que le GRANT SELECT (capacite_maximum) n'est pas accordé —
-- angle mort des tests Vitest mockés (aucune requête SQL réelle).

BEGIN;
SELECT plan(2);

-- Le GRANT colonne existe pour authenticated.
SELECT ok(
  has_column_privilege(
    'authenticated',
    'plateforme.lieux',
    'capacite_maximum',
    'SELECT'
  ),
  'authenticated a le privilège SELECT sur lieux.capacite_maximum'
);

-- Chemin réel : lecture de la vue sous le rôle appelant (invoker). Sans le GRANT
-- colonne, PostgreSQL lève « permission denied for table lieux » ici.
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'user_role', 'gestionnaire_lieux',
    'organisation_id', gen_random_uuid()
  )::text,
  true
);
SET LOCAL role = 'authenticated';

SELECT lives_ok(
  'SELECT id, nom, capacite_maximum FROM plateforme.v_lieux_clients LIMIT 1',
  'v_lieux_clients reste lisible sous authenticated après ajout de capacite_maximum'
);

RESET role;
SELECT * FROM finish();
ROLLBACK;
