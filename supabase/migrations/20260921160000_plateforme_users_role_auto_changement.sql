-- P0 SÉCURITÉ — escalade de privilège INTRA-ORGANISATION sur `plateforme.users` :
-- VOLET 3 — AUTO-CHANGEMENT DE RÔLE (un user change SON PROPRE `role`).
--
-- Suite directe de 20260903120000 (volets 1 et 2) : ce correctif avait fermé la
-- promotion vers un rôle STAFF (`admin_savr` / `ops_savr`) et épinglé les colonnes
-- structurantes (`id`, `organisation_id`, `email`, `deleted_at`, `actif` sur soi).
-- Il n'avait PAS épinglé `role` pour les cibles NON staff — le trou restant.
--
-- ---------------------------------------------------------------------------
-- MESURE (2026-09-21, base locale, rôle Postgres RÉEL `authenticated` + claims
-- JWT format prod `{role: authenticated, user_role: <métier>, organisation_id}`,
-- chaque cas dans sa PROPRE transaction avec sa propre fixture — cf.
-- [non-vacuité en isolation] : les cas antérieurs mutent l'état et faussent la
-- lecture s'ils sont enchaînés).
--
--   UPDATE plateforme.users SET role = '<cible>' WHERE id = auth.uid();
--
--   traiteur_commercial -> traiteur_manager    : UPDATE 1  ← LA FAILLE
--   traiteur_commercial -> gestionnaire_lieux  : UPDATE 1
--   traiteur_commercial -> agence              : UPDATE 1
--   traiteur_commercial -> client_organisateur : UPDATE 1
--   traiteur_commercial -> ops_savr            : 42501 (volet 1, OK)
--   traiteur_commercial -> admin_savr          : 42501 (volet 1, OK)
--   client_organisateur -> traiteur_manager    : UPDATE 1
--   agence              -> traiteur_manager    : UPDATE 1
--   gestionnaire_lieux  -> traiteur_manager    : UPDATE 1
--   traiteur_manager    -> gestionnaire_lieux  : UPDATE 1
--
-- CHAÎNE (4 maillons, tous vérifiés sur `main`) :
--   1. `usr_self_update` (R7 20260625000002 l.218-222) : `WITH CHECK (id = auth.uid())`
--      — AUCUNE colonne épinglée, `role` comprise. Idem `usr_agence_update_self`,
--      `usr_commercial_update_self`.
--   2. `GRANT … UPDATE ON ALL TABLES IN SCHEMA plateforme TO authenticated`
--      (0.4a 20260611180000 l.27), aucun REVOKE ultérieur sur `users`.
--   3. Le REVOKE COLONNE est inopérant par construction (R10b 20260629120000
--      l.15-18) : tous les users applicatifs partagent le MÊME rôle Postgres
--      `authenticated`, le rôle métier vivant dans le claim JWT `user_role`.
--      → la seule protection possible est le trigger.
--   4. `fn_users_block_role_escalation` (20260903120000 l.133-140) ne refusait
--      `role` que si `NEW.role IN ('admin_savr','ops_savr')`.
--
-- IMPACT : le hook `plateforme.fn_custom_access_token` RELIT `users.role` pour
-- fabriquer le claim `user_role`. Au refresh du token, un `traiteur_commercial`
-- devenu `traiteur_manager` ouvre les policies manager de SON organisation
-- (gestion d'équipe, écriture des paramètres de l'organisation, toutes les
-- collectes de l'org). Escalade INTRA-ORGANISATION : `organisation_id` est
-- épinglé depuis le volet 2, il n'y a pas de bascule cross-tenant ici.
--
-- ---------------------------------------------------------------------------
-- RÈGLE POSÉE : sous `authenticated`, hors `admin_savr`, PERSONNE ne change son
-- PROPRE rôle. Changer celui d'un TIERS reste possible là où la RLS l'autorise
-- déjà (`usr_manager_update`, `usr_gestionnaire_update`, own-org).
--
-- POURQUOI « sur soi-même » et pas « épingler `role` » tout court : le
-- recensement EXHAUSTIF des écritures de `users.role` (grep `from('users')` sur
-- packages/plateforme/src, 22 fichiers) donne UNE SEULE route qui écrit `role`
-- sous `authenticated` (`createSupabaseServerClient`) :
--   • `PATCH /api/v1/traiteur/equipe/[id]` — manager only, allowlist
--     {traiteur_commercial, traiteur_manager}, CDC §06.04 §6 « Modifier le rôle
--     d'un collaborateur ». Un épinglage global de `role` CASSERAIT la gestion
--     d'équipe du manager.
-- Toutes les autres écritures de `role` passent en `createAdminSupabaseClient`
-- (service_role → `current_user <> 'authenticated'` → exemptées) :
--   `auth/signup`, `auth/verify-email`, `traiteur/equipe/invitation`,
--   `traiteur/equipe/transfert`, `gestionnaire/mon-organisation/users` (POST),
--   `admin/users` + `admin/users/[id]`.
-- Et `PATCH /api/me/profil` exclut `role` de son allowlist (self-service PII).
--
-- CE QUE LA GARDE TOUCHE CÔTÉ PRODUIT (assumé, tracé) : le `<select>` de rôle de
-- « Mon organisation › Équipe » est rendu sur TOUTES les lignes, y compris celle
-- du manager connecté → un manager pouvait se RÉTROGRADER lui-même en
-- `traiteur_commercial`. Le CDC §06.04 §6 dit « Modifier le rôle d'UN
-- COLLABORATEUR » et ne prévoit pas le cas « sur soi ». La garde le ferme, par
-- cohérence avec l'anti-auto-suspension déjà posée sur `actif` (volet 2,
-- 20260903120000 : `NEW.actif IS DISTINCT FROM OLD.actif AND NEW.id = auth.uid()`)
-- et déjà dupliquée côté route (« Impossible de suspendre votre propre compte »).
-- → Divergence `type: ambigu` déposée : arbitrage Val sur la restitution éventuelle
--   d'une auto-rétrogradation (qui devrait alors passer par service_role, jamais
--   par un `role` réouvert sous `authenticated`).
--
-- CE QUE CETTE MIGRATION NE FERME PAS (mesuré, hors périmètre, signalé) :
-- l'allowlist {traiteur_commercial, traiteur_manager} de la route n'est PAS
-- rejouée en base. Mesuré en isolation : un `traiteur_manager` peut poser
-- `gestionnaire_lieux` ou `client_organisateur` sur un COLLÈGUE de son org en
-- PostgREST direct (UPDATE 1), et un `gestionnaire_lieux` peut poser
-- `traiteur_manager` sur un collègue. L'appelant n'y gagne AUCUN droit (ce n'est
-- pas une escalade, c'est un écart d'intégrité vs §06.04) et fermer réclame une
-- matrice appelant→cibles que le CDC ne pose que pour le cas traiteur : lot
-- distinct, décision Val. Mesuré aussi : `traiteur_commercial`, `agence` et
-- `client_organisateur` ne peuvent PAS écrire un collègue (UPDATE 0, RLS) — leur
-- seul vecteur était bien « sur soi », donc fermé ici.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plateforme.fn_users_block_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  -- Seules les requêtes applicatives (rôle Postgres `authenticated`) sont gardées.
  -- service_role (routes admin) et postgres (seed/migration) sont exemptés.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- admin_savr n'est bridé par aucun des volets (contrôle positif R10b).
  -- ⚠ CE POINT DE SORTIE EXEMPTE `admin_savr` DE TOUT CE QUI SUIT, par construction.
  -- Une garde ajoutée SOUS cette ligne ne s'appliquera donc JAMAIS à un admin_savr.
  -- Si une future garde doit valoir AUSSI pour l'admin (typiquement « personne
  -- n'écrit deleted_at hors de la RPC RGPD »), la placer AU-DESSUS de ce RETURN.
  IF plateforme.f_app_role() IS NOT DISTINCT FROM 'admin_savr' THEN
    RETURN NEW;
  END IF;

  -- VOLET 1 — escalade de RÔLE : aucune promotion vers un rôle staff.
  IF NEW.role::text IN ('admin_savr', 'ops_savr')
     AND (TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role) THEN
    RAISE EXCEPTION
      'Promotion vers le rôle staff % réservée à admin_savr (escalade de privilège refusée)',
      NEW.role::text
      USING ERRCODE = '42501';
  END IF;

  -- VOLET 2 — escalade de TENANT : colonnes structurantes immuables.
  IF TG_OP = 'UPDATE' THEN
    -- `id` = clé de jointure avec auth.uid() ET cible de 21 FK (audit_log,
    -- evenements.created_by, attributions_antgaspi.valide_par, shared.fichiers…).
    -- Trou RÉEL avant ce correctif, mesuré en isolation sous `authenticated` :
    -- `UPDATE users SET id = <autre> WHERE id = auth.uid()` par un traiteur_manager
    -- -> `UPDATE 1`. `usr_self_update` bloquerait seul (son WITH CHECK `id =
    -- auth.uid()` casse), mais les policies permissives se combinent en OR et
    -- `usr_manager_update` / `usr_gestionnaire_update` ne revérifient que rôle+org,
    -- jamais l'identité de la ligne — il suffit qu'UNE policy valide pour passer.
    -- Vaut pour son propre id comme pour celui d'un collègue.
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION
        'Changement d''id refusé (clé de jointure auth.uid() et cible de 21 FK)'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
      RAISE EXCEPTION
        'Changement d''organisation refusé (pivot cross-tenant : le claim organisation_id en dérive)'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION
        'Changement d''email refusé sous authenticated (capture de compte via reset de mot de passe)'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      RAISE EXCEPTION
        'Changement de deleted_at refusé sous authenticated (dé-anonymisation RGPD)'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.actif IS DISTINCT FROM OLD.actif AND NEW.id = auth.uid() THEN
      RAISE EXCEPTION
        'Modification de son propre statut actif refusée (auto-réactivation d''un compte suspendu)'
        USING ERRCODE = '42501';
    END IF;

    -- VOLET 3 (2026-09-21) — AUTO-CHANGEMENT DE RÔLE.
    -- Scopé `NEW.id = auth.uid()` exactement comme la garde `actif` juste au-dessus,
    -- et pour la même raison : NE PAS casser la gestion d'équipe du manager
    -- (`PATCH /api/v1/traiteur/equipe/[id]`, qui tourne sous `authenticated`).
    -- `IS DISTINCT FROM` : un self-update qui réécrit `role` à sa valeur courante
    -- (payload PostgREST complet) reste un no-op et ne s'arme pas.
    -- NB : `NEW.id = auth.uid()` est ici équivalent à `OLD.id = auth.uid()`, la
    -- garde `id` immuable ci-dessus ayant déjà imposé `NEW.id = OLD.id`.
    IF NEW.role IS DISTINCT FROM OLD.role AND NEW.id = auth.uid() THEN
      RAISE EXCEPTION
        'Changement de son propre rôle refusé (le claim user_role en dérive : escalade de privilège)'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-création idempotente du trigger : même définition qu'en R10b (20260629120000)
-- et 20260903120000. Rend la migration auto-portante — la garde ne dépend pas de
-- l'ordre d'application.
DROP TRIGGER IF EXISTS trg_users_block_role_escalation ON plateforme.users;
CREATE TRIGGER trg_users_block_role_escalation
  BEFORE INSERT OR UPDATE ON plateforme.users
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_users_block_role_escalation();

-- ROLLBACK (ré-applique la version 20260903120000 — REDEVIENT VULNÉRABLE au
-- volet 3) : ré-exécuter le corps de `fn_users_block_role_escalation()` tel qu'il
-- est écrit dans 20260903120000_plateforme_anti_escalade_role_staff.sql, c.-à-d.
-- sans le bloc « VOLET 3 » ci-dessus. Migration NON destructive : elle ne fait
-- que remplacer un corps de fonction (aucun DDL de table, aucun GRANT, aucune
-- policy touchée) et elle RESTREINT un accès (elle n'en ouvre aucun).
