-- =============================================================================
-- SÉCURITÉ — écriture PostgREST directe de `plateforme.organisations_domaines_email`
-- fermée, et backfill de `verifie_at`.
--
-- Migration prouvée : 20260923180000_plateforme_domaines_email_ecriture_client_fermee.
-- Suite de `collectes` (20260915160000), `evenements` (20260915190000),
-- `lieux` (20260921210000) et `factures` (20260923150000). CLAUDE.md §12 pt 2bis.
--
-- CE QUE CE FICHIER PROUVE, ET POURQUOI IL EXISTE
-- -----------------------------------------------
-- Cette table décide à quelle organisation un nouvel inscrit est rattaché
-- (CDC §05 §8). `api/auth/signup` ne rattache plus que sur `verifie_at IS NOT
-- NULL`, et `api/auth/verify-email` est le seul à poser cette marque.
--
-- Cette garde APPLICATIVE ne vaut que si le client ne peut pas écrire la colonne
-- lui-même. Or `20260705120000` avait posé `GRANT SELECT, INSERT, UPDATE, DELETE
-- … TO authenticated` (table-level = toutes colonnes) et `ode_manager_write` est
-- `FOR ALL` own-org : un traiteur_manager pouvait donc, par un seul appel
-- PostgREST direct avec la clé anon (publique par design, §07 l.289), poser
-- `verifie_at` sur sa propre revendication — et capturer ainsi les inscriptions
-- futures d'un domaine qu'il ne possède pas.
--
-- Mesuré AVANT la migration, sous rôle `authenticated` avec les claims d'un
-- traiteur_manager (transaction rollbackée) :
--     UPDATE … SET verifie_at = now() sur sa propre ligne   → UPDATE 1
--     INSERT … (organisation_id, domaine, verifie_at)       → INSERT 0 1
-- Les cas B1-B4 rejouent EXACTEMENT ces écritures et exigent un refus. La
-- contre-épreuve (ré-accorder le GRANT) les rend rouges : aucun n'est vacant.
--
-- ⚠ Tout se joue SOUS RÔLE `authenticated` (test_set_jwt pose `role`). Sous
-- service_role ou superuser, la RLS est bypassée ET les privilèges sont ceux d'un
-- autre rôle : le test passerait au vert quoi qu'il arrive. Les refus attendus
-- sont des 42501 levés AVANT l'évaluation RLS — c'est le privilège qui ferme, pas
-- la policy. Chaque refus asserte le MESSAGE « permission denied for table
-- organisations_domaines_email », pour qu'un 42501 levé ailleurs ne suffise pas.
--
-- ⚠ Le bloc D porte sur l'INVARIANT du backfill : une revendication SANS
-- utilisateur du domaine dans l'organisation (la signature exacte de la chaîne
-- de capture) reste NON prouvée, donc inerte pour le rattachement. Ce que ce
-- bloc NE teste PAS, et pourquoi, est expliqué à l'endroit même où il commence.
--
-- CONTRE-ÉPREUVE EXÉCUTÉE (base locale, migration appliquée puis
-- `GRANT INSERT, UPDATE, DELETE … TO authenticated` ré-accordé) : 11 rouges =
-- A1 A2 A3 A5 + B1 B2 B3 B4 + B5 D2 D3. Les huit premiers rougissent parce que
-- le privilège est de retour — ce sont les cas visés.
-- B5, D2 et D3 rougissent PAR RICOCHET, et c'est le signe que la mesure est
-- bonne : leurs comptes sont ABSOLUS, or sous contre-épreuve les écritures de
-- B1-B3 ABOUTISSENT au lieu de lever. B3 insère une 2e ligne (B5 compte 2 au
-- lieu de 1) et B1 pose `verifie_at` sur la ligne squattée (D2/D3 la voient
-- désormais marquée). Autrement dit, la contre-épreuve démontre aussi
-- l'enchaînement : dès que le privilège revient, le domaine squatté redevient
-- « prouvé » et recapture les inscriptions.
-- A4 A6 A7, B6 et tout le bloc C restent verts : ils portent sur ce que la
-- migration NE change PAS, et leur rôle est d'interdire la sur-fermeture.
-- =============================================================================

BEGIN;
SELECT plan(17);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Helpers JWT (idiome SECU__lieux_ecriture_client_fermee) ─────────────────
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

CREATE OR REPLACE FUNCTION test_as_service_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- ── Fixtures (UUID improbables, pas de collision avec la seed) ──────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('d0e00000-0000-0000-0000-000000000001'::uuid, 'Traiteur DOM A', 'traiteur', true, false, 'D0E00000000001', 'a@dom.internal'),
  ('d0e00000-0000-0000-0000-000000000002'::uuid, 'Traiteur DOM B', 'traiteur', true, false, 'D0E00000000002', 'b@dom.internal');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('d0e00000-0000-0000-0000-0000000000a1'::uuid, 'd0e00000-0000-0000-0000-000000000001'::uuid, 'mgr@doma.test', 'Mgr', 'DomA', 'traiteur_manager'),
  ('d0e00000-0000-0000-0000-0000000000a2'::uuid, 'd0e00000-0000-0000-0000-000000000002'::uuid, 'mgr@domb.test', 'Mgr', 'DomB', 'traiteur_manager');

-- d1 : ligne de l'org A, cible des écritures directes (B1/B2).
-- d2 : ligne de l'org B, cible du DELETE cross-org (B4).
INSERT INTO plateforme.organisations_domaines_email (id, organisation_id, domaine, verifie_at) VALUES
  ('d0e00000-0000-0000-0000-0000000001a1'::uuid, 'd0e00000-0000-0000-0000-000000000001'::uuid, 'squatte-par-a.test', NULL),
  ('d0e00000-0000-0000-0000-0000000001b1'::uuid, 'd0e00000-0000-0000-0000-000000000002'::uuid, 'domb.test', NULL);

-- =============================================================================
-- A. PRIVILÈGES — le GRANT table-level de 20260705120000 est amputé
-- =============================================================================
SELECT test_as_superuser();

SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.organisations_domaines_email', 'INSERT'),
  'A1 authenticated n''a plus INSERT table-level sur organisations_domaines_email'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.organisations_domaines_email', 'UPDATE'),
  'A2 authenticated n''a plus UPDATE table-level sur organisations_domaines_email'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.organisations_domaines_email', 'DELETE'),
  'A3 authenticated n''a plus DELETE table-level sur organisations_domaines_email'
);

-- A4 ASSERTION POSITIVE — le SELECT est CONSERVÉ. « Mon organisation » affiche la
-- liste des domaines : une sur-fermeture casserait cet écran sans rien gagner.
SELECT ok(
  has_table_privilege('authenticated', 'plateforme.organisations_domaines_email', 'SELECT'),
  'A4 authenticated CONSERVE SELECT (lecture own-org par ode_own_org_read)'
);

-- A5 cliquet colonne-level : un REVOKE table-level ne doit pas laisser derrière
-- lui un GRANT colonne qui rouvrirait l'écriture (piège vécu #306).
SELECT is(
  (SELECT count(*)::int FROM information_schema.column_privileges
    WHERE grantee = 'authenticated'
      AND table_schema = 'plateforme' AND table_name = 'organisations_domaines_email'
      AND privilege_type IN ('INSERT', 'UPDATE')),
  0,
  'A5 aucun privilège INSERT/UPDATE colonne-level résiduel pour authenticated'
);

-- A6 anon n'écrit pas non plus.
SELECT ok(
  NOT has_table_privilege('anon', 'plateforme.organisations_domaines_email', 'UPDATE'),
  'A6 anon n''a pas UPDATE sur organisations_domaines_email'
);

-- A7 NON-RÉGRESSION — service_role conserve tout : c'est le canal des routes.
SELECT ok(
  has_table_privilege('service_role', 'plateforme.organisations_domaines_email', 'INSERT')
  AND has_table_privilege('service_role', 'plateforme.organisations_domaines_email', 'UPDATE')
  AND has_table_privilege('service_role', 'plateforme.organisations_domaines_email', 'DELETE'),
  'A7 service_role conserve INSERT/UPDATE/DELETE'
);

-- =============================================================================
-- B. LES ÉCRITURES QUI ABOUTISSAIENT AVANT SONT REFUSÉES
--    (mesurées AVANT la migration : UPDATE 1 et INSERT 0 1)
-- =============================================================================
SELECT test_set_jwt('traiteur_manager', 'd0e00000-0000-0000-0000-000000000001'::uuid,
                    'd0e00000-0000-0000-0000-0000000000a1'::uuid);

-- B1 — LE cas de la chaîne : le manager se décerne la preuve de contrôle.
SELECT throws_ok(
  $$UPDATE plateforme.organisations_domaines_email
       SET verifie_at = now()
     WHERE id = 'd0e00000-0000-0000-0000-0000000001a1'::uuid$$,
  '42501',
  'permission denied for table organisations_domaines_email',
  'B1 le manager ne peut plus poser verifie_at lui-même (la garde du signup devient autoritaire)'
);

-- B2 — même chose en un seul appel, marque posée dès l'INSERT.
SELECT throws_ok(
  $$INSERT INTO plateforme.organisations_domaines_email (organisation_id, domaine, verifie_at)
    VALUES ('d0e00000-0000-0000-0000-000000000001'::uuid, 'grandtraiteur.test', now())$$,
  '42501',
  'permission denied for table organisations_domaines_email',
  'B2 le manager ne peut plus revendiquer un domaine DÉJÀ marqué comme prouvé'
);

-- B3 — la revendication simple (sans verifie_at) passe désormais par la route.
SELECT throws_ok(
  $$INSERT INTO plateforme.organisations_domaines_email (organisation_id, domaine)
    VALUES ('d0e00000-0000-0000-0000-000000000001'::uuid, 'autre.test')$$,
  '42501',
  'permission denied for table organisations_domaines_email',
  'B3 l''INSERT direct est fermé (l''écriture passe par la route, sous service_role)'
);

-- B4 — le DELETE aussi. Le refus est ici un 42501 de privilège, plus un filtrage
-- RLS silencieux : l'échec est franc.
SELECT throws_ok(
  $$DELETE FROM plateforme.organisations_domaines_email
     WHERE id = 'd0e00000-0000-0000-0000-0000000001b1'::uuid$$,
  '42501',
  'permission denied for table organisations_domaines_email',
  'B4 le DELETE direct est fermé, y compris cross-organisation'
);

-- B5 NON-RÉGRESSION — la lecture own-org fonctionne toujours.
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations_domaines_email
    WHERE organisation_id = 'd0e00000-0000-0000-0000-000000000001'::uuid),
  1,
  'B5 le manager lit toujours les domaines de SON organisation'
);

-- B6 NON-RÉGRESSION — et ne voit pas ceux des autres (cloisonnement inchangé).
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations_domaines_email
    WHERE organisation_id = 'd0e00000-0000-0000-0000-000000000002'::uuid),
  0,
  'B6 le manager ne voit pas les domaines d''une autre organisation'
);

-- =============================================================================
-- C. service_role écrit toujours — sinon les routes seraient cassées
-- =============================================================================
SELECT test_as_service_role();

SELECT lives_ok(
  $$INSERT INTO plateforme.organisations_domaines_email (organisation_id, domaine)
    VALUES ('d0e00000-0000-0000-0000-000000000001'::uuid, 'via-route.test')$$,
  'C1 service_role insère toujours (POST …/mon-organisation/domaines-email)'
);

SELECT lives_ok(
  $$UPDATE plateforme.organisations_domaines_email
       SET verifie_at = now()
     WHERE domaine = 'via-route.test'$$,
  'C2 service_role pose verifie_at (api/auth/verify-email)'
);

-- =============================================================================
-- D. BACKFILL — les rattachements déjà prouvés survivent, les autres restent inertes
-- =============================================================================
SELECT test_as_superuser();

-- ⚠ CE QUE CE BLOC NE PEUT PAS TESTER, ET POURQUOI. Le backfill est une
-- opération PONCTUELLE, jouée une fois à l'application de la migration. Les
-- fixtures ci-dessus sont insérées APRÈS, donc aucune assertion de ce fichier ne
-- peut observer son effet sur elles — une première version de ce test prétendait
-- le faire et rougissait, à juste titre. Rejouer ici la requête `UPDATE` de la
-- migration ne prouverait rien non plus : le test recopierait l'oracle qu'il est
-- censé vérifier. L'effet du backfill est donc mesuré à la main, avant/après, et
-- rapporté dans la PR ; ce qui est épinglé DURABLEMENT ici, c'est son invariant :
-- une revendication non prouvée reste inerte, aujourd'hui comme demain.

-- D2 : l'org A n'a AUCUN utilisateur @squatte-par-a.test → la revendication reste
-- NULL. C'est la signature exacte de la chaîne de capture : elle ne doit pas être
-- blanchie par le backfill.
SELECT is(
  (SELECT verifie_at FROM plateforme.organisations_domaines_email
    WHERE id = 'd0e00000-0000-0000-0000-0000000001a1'::uuid),
  NULL,
  'D2 backfill : une revendication sans utilisateur du domaine reste NON prouvée'
);

-- D3 : conséquence directe, et c'est ce que lit `api/auth/signup`. Une recherche
-- de rattachement sur ce domaine ne rend rien → l'inscrit n'est pas capturé.
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations_domaines_email
    WHERE domaine = 'squatte-par-a.test' AND verifie_at IS NOT NULL),
  0,
  'D3 la requête de rattachement du signup ne trouve rien pour un domaine squatté'
);

SELECT * FROM finish();
ROLLBACK;
