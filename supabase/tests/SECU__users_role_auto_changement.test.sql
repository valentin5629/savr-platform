-- =============================================================================
-- Tests pgTAP — P0 sécurité : AUTO-CHANGEMENT DE RÔLE sur `plateforme.users`
-- Migration testée : 20260921170000_plateforme_users_role_auto_changement.sql
--                    (volet 3 de `fn_users_block_role_escalation`)
-- =============================================================================
-- Faille MESURÉE le 2026-09-21 sous le rôle Postgres RÉEL `authenticated` (chaque
-- cas dans sa propre transaction) :
--   UPDATE plateforme.users SET role = '<non staff>' WHERE id = auth.uid()
-- renvoyait `UPDATE 1` pour LES CINQ rôles clients. Seules les cibles STAFF
-- (`admin_savr`, `ops_savr`) étaient refusées — volets 1/2 de 20260903120000.
-- Le hook `fn_custom_access_token` relisant `users.role`, un `traiteur_commercial`
-- devenu `traiteur_manager` gagnait, au refresh du token, les droits manager de
-- son organisation. Escalade INTRA-organisation (`organisation_id` épinglé
-- depuis le volet 2).
--
-- Ces tests tournent sous le VRAI rôle Postgres `authenticated` + claim JWT
-- `user_role` (jamais le claim `role` pour le métier — cf. f_app_role()). Sous
-- service_role la RLS est bypassée ET le trigger s'exempte : un test à ce niveau
-- ne prouverait RIEN.
--
-- ⚠ `throws_ok` — le SQLSTATE 42501 est rendu À LA FOIS par une violation de
-- `WITH CHECK` RLS et par le `RAISE` du trigger. Asserter le seul code laisserait
-- des cas vacuous. On assert donc le MESSAGE : un BEFORE ROW parle avant
-- l'évaluation du WITH CHECK, c'est bien le trigger qu'on mesure.
--
-- Prouve que :
--   FERMETURE (1-8)  aucun des 5 rôles clients ne change son propre rôle, vers
--                    aucune cible — y compris l'auto-RÉTROGRADATION d'un manager
--                    (cas 8, le seul geste produit que la garde retire) ;
--   NON-RÉGRESSION (9-15) volet 1 intact ; la gestion d'équipe du manager (CDC
--                    §06.04 §6 « Modifier le rôle d'un collaborateur ») passe
--                    toujours ; suspension d'un collègue, no-op, édition de
--                    profil, exemption `admin_savr` et exemption service_role ;
--   PREUVE (16-19)   les colonnes de preuve (`cgu_accepte_le`, `cgu_version`,
--                    `created_at`) sont immuables sous `authenticated` — pour
--                    TOUTE ligne et pour TOUT appelant, `admin_savr` compris
--                    (le cas 19 tient ce placement) ;
--   UPSERT (20)      `INSERT … ON CONFLICT DO UPDATE` ne contourne pas la garde ;
--   MUTANT (21)      la moitié `cgu_accepte_le` de la garde de preuve est tenue
--                    (sans ce cas, la retirer laissait les 20 autres verts).
--
-- ⚠ CE QUE CE FICHIER NE PROUVE PAS : que `users.role` soit intégralement
-- verrouillé. Mesuré le 2026-09-21, AVEC cette migration : un `traiteur_manager`
-- (ou un `gestionnaire_lieux`) crée une seconde identité `traiteur_manager` dans
-- son org (`usr_manager_insert` ne contraint ni `id` ni `role`) et s'en sert pour
-- changer son propre rôle en deux temps. Le scope « sur soi » ferme donc le P0
-- signalé (`traiteur_commercial`, `agence`, `client_organisateur` — mesuré :
-- leur INSERT est refusé par la RLS) mais n'est qu'un ralentisseur pour les deux
-- rôles qui écrivent leurs collègues. Fermeture = allowlist dans le `WITH CHECK`
-- des policies INSERT : lot distinct, arbitrage Val (divergence M3.1_20260921).
-- =============================================================================

BEGIN;
SELECT plan(21);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', 'authenticated',   -- claim réservé PostgREST (format prod)
    'user_role', p_role,       -- rôle métier, lu par plateforme.f_app_role()
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

-- =====================================================================
-- FIXTURE — 1 organisation, 1 user par rôle client + 1 admin_savr.
-- UUID/SIRET improbables : aucune collision avec la seed.
-- =====================================================================
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES ('0e5ca1ad-9021-0000-0000-0000000000a1'::uuid, 'Org auto-role', 'traiteur',
        true, false, '77711960000001', 'autorole@test.invalid');

-- ⚠ `cgu_accepte_le` / `cgu_version` sont renseignées À DESSEIN, mais PAS pour la
-- raison qu'on croit. MESURÉ (fixture remise à NULL, migration appliquée) :
--   not ok 16 · ok 17 · ok 18 · ok 19
-- Le cas 16 ÉCHOUE BRUYAMMENT — il ne devient pas vacuous : il écrit NULL sur NULL,
-- la garde `IS DISTINCT FROM` ne s'arme pas, et le `throws_ok` rougit. Les cas 17
-- et 19 restent verts LÉGITIMEMENT (ils écrivent 'v0.0' par-dessus NULL, ce qui est
-- bien un changement : la garde s'arme pour de bon).
-- La vraie raison de l'enrichissement : sans lui, le cas 16 teste un no-op au lieu
-- de modéliser l'attaque réelle — effacer une preuve de consentement QUI EXISTE.
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif,
                              cgu_accepte_le, cgu_version)
VALUES
  ('0e5ca1ad-9021-0000-0000-000000000001'::uuid, '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
   'com@autorole.invalid',  'C', 'OM', 'traiteur_commercial', true, now(), 'v1.0'),
  ('0e5ca1ad-9021-0000-0000-000000000002'::uuid, '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
   'mgr@autorole.invalid',  'M', 'GR', 'traiteur_manager',    true, now(), 'v1.0'),
  ('0e5ca1ad-9021-0000-0000-000000000003'::uuid, '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
   'gest@autorole.invalid', 'G', 'ES', 'gestionnaire_lieux',  true, now(), 'v1.0'),
  ('0e5ca1ad-9021-0000-0000-000000000004'::uuid, '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
   'agc@autorole.invalid',  'A', 'GC', 'agence',              true, now(), 'v1.0'),
  ('0e5ca1ad-9021-0000-0000-000000000005'::uuid, '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
   'clo@autorole.invalid',  'C', 'LO', 'client_organisateur', true, now(), 'v1.0'),
  ('0e5ca1ad-9021-0000-0000-000000000006'::uuid, '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
   'adm@autorole.invalid',  'A', 'DM', 'admin_savr',          true, now(), 'v1.0'),
  -- collègue dédié aux contrôles positifs 10-11 (jamais muté par les cas 1-9)
  ('0e5ca1ad-9021-0000-0000-000000000007'::uuid, '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
   'col@autorole.invalid',  'C', 'OL', 'traiteur_commercial', true, now(), 'v1.0');

-- =====================================================================
-- 1-4 — LA FAILLE : un traiteur_commercial s'auto-attribue n'importe quel
--       rôle non staff. Le cas 1 (→ traiteur_manager) est l'escalade réelle :
--       gestion d'équipe + écriture des paramètres de son organisation.
-- =====================================================================
SELECT test_set_jwt('traiteur_commercial', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = auth.uid() $$,
  '42501',
  'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)',
  'P0 — traiteur_commercial NE PEUT PAS s''auto-promouvoir traiteur_manager (la faille corrigée)'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'gestionnaire_lieux' WHERE id = auth.uid() $$,
  '42501',
  'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)',
  'P0 — traiteur_commercial NE PEUT PAS s''auto-attribuer gestionnaire_lieux'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'agence' WHERE id = auth.uid() $$,
  '42501',
  'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)',
  'P0 — traiteur_commercial NE PEUT PAS s''auto-attribuer agence'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'client_organisateur' WHERE id = auth.uid() $$,
  '42501',
  'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)',
  'P0 — traiteur_commercial NE PEUT PAS s''auto-attribuer client_organisateur'
);

-- =====================================================================
-- 5-7 — Même vecteur depuis les trois autres rôles clients. Mesuré : leur
--       SEUL chemin d'écriture est « sur soi » (`usr_*_update_self` /
--       `usr_self_update`) — un client_organisateur ou une agence ne peut pas
--       écrire un collègue (UPDATE 0, RLS). Fermer le self ferme donc tout
--       pour eux.
-- =====================================================================
SELECT test_set_jwt('client_organisateur', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000005'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = auth.uid() $$,
  '42501',
  'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)',
  'P0 — client_organisateur NE PEUT PAS s''auto-promouvoir traiteur_manager'
);

SELECT test_set_jwt('agence', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000004'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = auth.uid() $$,
  '42501',
  'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)',
  'P0 — agence NE PEUT PAS s''auto-promouvoir traiteur_manager'
);

SELECT test_set_jwt('gestionnaire_lieux', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000003'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = auth.uid() $$,
  '42501',
  'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)',
  'P0 — gestionnaire_lieux NE PEUT PAS s''auto-promouvoir traiteur_manager'
);

-- =====================================================================
-- 8 — Auto-RÉTROGRADATION du manager : fermée aussi. C'est LE seul geste
--     produit que la garde retire (le <select> de rôle de « Mon organisation ›
--     Équipe » est rendu sur toutes les lignes, y compris celle du manager
--     connecté). Volontaire et tracé : le CDC §06.04 §6 dit « Modifier le rôle
--     d'UN COLLABORATEUR » et ne prévoit pas le cas « sur soi ». Cohérent avec
--     l'anti-auto-suspension déjà posée sur `actif`. Divergence `type: ambigu`
--     déposée — si Val restitue le geste, il passera par service_role, jamais
--     par une réouverture de `role` sous `authenticated`.
-- =====================================================================
SELECT test_set_jwt('traiteur_manager', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000002'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_commercial' WHERE id = auth.uid() $$,
  '42501',
  'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)',
  'traiteur_manager NE PEUT PAS se rétrograder lui-même (geste retiré, tracé en divergence)'
);

-- =====================================================================
-- 9 — NON-RÉGRESSION volet 1 (20260903120000) : la cible STAFF reste refusée
--     par le volet 1, qui s'arme AVANT le volet 3 — le message le prouve.
-- =====================================================================
SELECT test_set_jwt('traiteur_commercial', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'ops_savr' WHERE id = auth.uid() $$,
  '42501',
  'Promotion vers le rôle staff ops_savr réservée à admin_savr (escalade de privilège refusée)',
  'non-régression volet 1 — la cible staff reste refusée PAR LE VOLET 1 (message distinct)'
);

-- =====================================================================
-- 10-11 — LE contrôle qui compte : la gestion d'équipe du manager n'est pas
--         cassée. `PATCH /api/v1/traiteur/equipe/[id]` tourne en
--         createSupabaseServerClient (donc sous `authenticated`) — une garde
--         globale sur `role` aurait tué la fonctionnalité CDC §06.04 §6.
-- =====================================================================
SELECT test_set_jwt('traiteur_manager', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000002'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager'
     WHERE id = '0e5ca1ad-9021-0000-0000-000000000007'::uuid $$,
  'un manager PEUT toujours changer le rôle d''un COLLABORATEUR (CDC §06.04 §6)'
);

SELECT lives_ok(
  $$ UPDATE plateforme.users SET actif = false
     WHERE id = '0e5ca1ad-9021-0000-0000-000000000007'::uuid $$,
  'non-régression volet 2 — un manager PEUT toujours suspendre un collaborateur'
);

-- =====================================================================
-- 12-13 — Anti-faux-positif : `IS DISTINCT FROM` ne doit pas s'armer sur un
--         no-op (payload PostgREST qui renvoie la ligne complète), ni sur une
--         édition de profil qui ne touche pas `role` (`PATCH /api/me/profil`).
-- =====================================================================
SELECT test_set_jwt('traiteur_commercial', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000001'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_commercial' WHERE id = auth.uid() $$,
  'réécrire son rôle à sa valeur COURANTE reste un no-op (pas de faux positif)'
);

SELECT lives_ok(
  $$ UPDATE plateforme.users SET prenom = 'Camille' WHERE id = auth.uid() $$,
  'un client PEUT toujours éditer son profil sans toucher role (/api/me/profil)'
);

-- =====================================================================
-- 14 — La garde est bien SOUS le `RETURN NEW` d'exemption `admin_savr` :
--      un admin_savr authentifié reste libre de changer les rôles, le sien
--      compris (piège de placement documenté dans 20260903120000).
-- =====================================================================
SELECT test_set_jwt('admin_savr', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000006'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = auth.uid() $$,
  'admin_savr n''est PAS bridé par le volet 3 (garde placée sous son exemption)'
);

-- =====================================================================
-- 15 — Exemption service_role / postgres : c'est par là que le back-office
--      Admin (`createAdminSupabaseClient`) et les flux d'invitation /
--      transfert écrivent légitimement `users.role`.
-- =====================================================================
SELECT test_as_superuser();
SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager'
     WHERE id = '0e5ca1ad-9021-0000-0000-000000000001'::uuid $$,
  'service_role/postgres PEUT toujours écrire users.role (routes admin, invitation)'
);

-- =====================================================================
-- 16-19 — GARDES D'INTÉGRITÉ DE PREUVE (bloc placé AU-DESSUS de l'exemption
--         `admin_savr`). Ouverture mesurée le 2026-09-21 sous `authenticated` :
--         `UPDATE users SET cgu_accepte_le=NULL, cgu_version=NULL WHERE id=auth.uid()`
--         et `UPDATE users SET created_at='2000-01-01' …` passaient tous deux.
--         Les CGU sont la preuve opposable du consentement (Art. 11/22) :
--         pouvoir l'effacer, c'est pouvoir le répudier.
-- =====================================================================
SELECT test_set_jwt('traiteur_commercial', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET cgu_accepte_le = NULL, cgu_version = NULL
     WHERE id = auth.uid() $$,
  '42501',
  'Modification de la preuve d''acceptation des CGU refusée sous authenticated',
  'un user NE PEUT PAS effacer la preuve de son acceptation des CGU (répudiation du consentement)'
);

SELECT test_set_jwt('traiteur_manager', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000002'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET cgu_version = 'v0.0'
     WHERE id = '0e5ca1ad-9021-0000-0000-000000000001'::uuid $$,
  '42501',
  'Modification de la preuve d''acceptation des CGU refusée sous authenticated',
  'un manager NE PEUT PAS réécrire la version de CGU acceptée par un collègue'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET created_at = '2000-01-01T00:00:00Z' WHERE id = auth.uid() $$,
  '42501',
  'Changement de created_at refusé sous authenticated (intégrité d''audit)',
  'un user NE PEUT PAS antidater son created_at (intégrité d''audit)'
);

-- 19 — LE cas qui TIENT le placement : la garde de preuve vaut AUSSI pour
--      `admin_savr`, parce qu'elle est AU-DESSUS de son exemption. Redescendre
--      le bloc sous le `RETURN NEW` fait rougir ce cas, et lui seul (sonde
--      mesurée le 2026-09-21).
SELECT test_set_jwt('admin_savr', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000006'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET cgu_version = 'v0.0' WHERE id = auth.uid() $$,
  '42501',
  'Modification de la preuve d''acceptation des CGU refusée sous authenticated',
  'même un admin_savr NE PEUT PAS réécrire une preuve d''acceptation des CGU (placement)'
);

-- =====================================================================
-- 20 — Chemin UPSERT : PostgREST expose `Prefer: resolution=merge-duplicates`,
--      qui émet `INSERT … ON CONFLICT DO UPDATE`. Le BEFORE UPDATE s'arme bien
--      (mesuré), mais rien ne le figeait — ce cas ferme l'angle mort.
-- =====================================================================
SELECT test_set_jwt('traiteur_manager', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000002'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
     VALUES ('0e5ca1ad-9021-0000-0000-000000000002'::uuid,
             '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
             'mgr@autorole.invalid', 'M', 'GR', 'traiteur_commercial', true)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role $$,
  '42501',
  'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)',
  'l''UPSERT (Prefer: resolution=merge-duplicates) ne contourne pas la garde'
);

-- =====================================================================
-- 21 — MUTANT SURVIVANT relevé par reviewer-rls-securite, et re-mesuré :
--      en retirant la sous-condition `NEW.cgu_accepte_le IS DISTINCT FROM
--      OLD.cgu_accepte_le` de la garde, les 20 cas précédents restaient VERTS.
--      Le cas 16 écrit les DEUX colonnes : la branche `OR cgu_version` suffit à
--      l'armer, donc rien n'épinglait l'horodatage. Ce cas-ci écrit
--      `cgu_accepte_le` SEUL — sous le mutant, il passe (`UPDATE 1`, preuve
--      effacée, `cgu_version` intacte). Les deux moitiés sont désormais tenues.
-- =====================================================================
SELECT test_set_jwt('traiteur_commercial', '0e5ca1ad-9021-0000-0000-0000000000a1'::uuid,
                    '0e5ca1ad-9021-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET cgu_accepte_le = NULL WHERE id = auth.uid() $$,
  '42501',
  'Modification de la preuve d''acceptation des CGU refusée sous authenticated',
  'un user NE PEUT PAS effacer le SEUL horodatage d''acceptation des CGU (moitié non tenue)'
);

SELECT * FROM finish();
ROLLBACK;
