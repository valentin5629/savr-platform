-- P0 SÉCURITÉ — escalade de privilège sur `plateforme.users`, 2 volets :
--   • VOLET 1 : auto-promotion en `ops_savr` (escalade de RÔLE)
--   • VOLET 2 : auto-rattachement à une autre organisation (escalade de TENANT)
-- Les deux donnent une prise de contrôle cross-organisation depuis un simple
-- compte client, et partagent la même cause racine n°2 (policies de self-update
-- sans restriction de colonne). Volet 2 trouvé par la revue sécurité du volet 1.
--
-- CONTEXTE (relevé en marge de la PR #246, reproduit en base réelle sous le rôle
-- Postgres `authenticated` avec un JWT client légitime) :
--
--   UPDATE plateforme.users SET role = 'ops_savr'  WHERE id = auth.uid();  -- PASSAIT (UPDATE 1)
--   UPDATE plateforme.users SET role = 'admin_savr' WHERE id = auth.uid();  -- refusé (42501)
--
-- N'IMPORTE QUEL user client authentifié (traiteur_manager, traiteur_commercial, …)
-- pouvait donc s'auto-promouvoir `ops_savr`. Au refresh du token, le claim
-- `user_role='ops_savr'` lui ouvrait les policies staff `evt_ops_select` / `evt_ops_write`
-- (FOR ALL) et `col_ops` → LECTURE + ÉCRITURE CROSS-ORGANISATION totale sur
-- `plateforme.evenements` et `plateforme.collectes`. C'est une prise de contrôle
-- inter-tenant à partir d'un simple compte client.
--
-- CAUSE RACINE (2 défauts qui se combinent) :
--   1. `plateforme.fn_users_block_role_escalation()` (migration R10b 20260629120000)
--      ne bloquait QUE la cible `admin_savr` — `ops_savr` n'était pas couvert, alors
--      que c'est AUSSI un rôle staff (`StaffRole` dans packages/plateforme/src/lib/api-auth.ts
--      = 'admin_savr' | 'ops_savr', vérifié à date) donnant accès aux policies `*_ops_*`.
--   2. Les policies de self-update de `users` (`usr_self_update`, `usr_agence_update_self`,
--      `usr_commercial_update_self`, définies en dernier par R7 20260625000002) n'ont
--      AUCUNE restriction de colonne : `WITH CHECK (id = auth.uid())` laisse écrire `role`.
--
-- CORRECTIF — on ferme au niveau du TRIGGER, pas des policies. C'est le point unique
-- et robuste : le trigger se déclenche sur le CHANGEMENT DE RÔLE RÉEL, quelle que soit
-- la policy qui a laissé passer l'UPDATE (self-update, `usr_manager_update` sur un
-- collègue de son org, `usr_ops_write`, `usr_*_insert`…). Une garde en policy serait
-- à la fois incomplète (une policy oubliée = trou) et malcommode : un `WITH CHECK` RLS
-- ne peut pas comparer OLD/NEW colonne par colonne, il ne verrait pas la différence
-- entre « je ne touche pas à role » et « je l'écris à sa valeur actuelle ».
-- → Les policies restent INCHANGÉES (aucun DROP/CREATE : backward-compatible, les gardes
--   `deleted_at IS NULL` de R7 restent intactes).
--
-- RÈGLE POSÉE : un appelant `authenticated` dont `f_app_role() <> 'admin_savr'` ne peut
-- promouvoir PERSONNE (ni lui-même, ni un autre) vers AUCUN rôle staff — c'est-à-dire
-- ni `admin_savr`, ni `ops_savr`. Conforme à la matrice §09 (promotion staff = admin only).
--
-- CE QUI CONTINUE DE PASSER (non-régression, prouvé par les tests pgTAP) :
--   • Exemption `service_role` / `postgres` CONSERVÉE (`current_user <> 'authenticated'`) :
--     c'est par là que l'Admin crée/promeut légitimement un `ops_savr` via les routes
--     back-office (`createAdminSupabaseClient`, service_role) et que tournent seeds/migrations.
--   • Les no-op : un `ops_savr` déjà en place qui édite son propre profil (prénom, téléphone…)
--     sans toucher `role` → `NEW.role IS NOT DISTINCT FROM OLD.role`, la garde ne s'arme pas.
--   • Un `admin_savr` authentifié qui promeut (contrôle positif R10b, pas de sur-blocage).
--
-- NB `NEW.role::text` (et non un cast vers le nom du type) : conservé de R10b. Le rôle
-- `authenticated` n'a pas USAGE pour résoudre le type enum par nom dans une fonction
-- SECURITY INVOKER. Bonus : ça immunise la fonction contre les renommages de type
-- (le type est aujourd'hui `plateforme.user_role`, ex-`user_role_enum` — renommé par
-- 20260623100000_plateforme_converge_enums_noms_cible.sql).

-- ---------------------------------------------------------------------------
-- VOLET 2 — ESCALADE DE TENANT (même cause racine n°2, trouvée par la revue
-- sécurité de ce correctif et reproduite en base réelle).
--
-- `usr_self_update` ne restreint AUCUNE colonne : fermer `role` ne suffisait pas.
-- Sous `authenticated`, avec un JWT client parfaitement légitime :
--
--   UPDATE plateforme.users SET organisation_id = '<org_victime>' WHERE id = auth.uid();
--
-- passait. Or le hook JWT `plateforme.fn_custom_access_token` RELIT
-- `users.organisation_id` pour fabriquer le claim `organisation_id` → au refresh
-- du token, le compte bascule de tenant. Mesuré : l'attaquant passe de 0 à 2 users
-- de l'organisation victime, et comme TOUTES les policies client sont scopées par
-- `organisation_id = auth.jwt()->>'organisation_id'`, la bascule se propage en
-- cascade à `evenements`, `collectes`, `factures`, `lieux`, `packs_antgaspi`…
-- Aucun rôle staff requis : c'est un compte client lambda. Même gravité que le
-- volet 1, donc fermé ici (décision Val).
--
-- Colonnes rendues immuables sous `authenticated` (hors admin_savr) :
--   • `id` — clé de jointure avec `auth.uid()` et cible de 21 FK (re-binding
--     d'identité / répudiation d'audit, intra-org).
--   • `organisation_id` — le pivot ci-dessus.
--   • `email` — le hook Auth de reset de mot de passe s'appuie dessus : réécrire
--     l'email d'un tiers permet de capter son compte (un `ops_savr` pouvait ainsi
--     viser un `admin_savr`). Jamais éditable sous authenticated de toute façon :
--     `me/profil` l'exclut explicitement (PII gérée par le flux Auth).
--   • `deleted_at` — DÉFENSE EN PROFONDEUR uniquement, et c'est mesuré : la RLS
--     refuse DÉJÀ toute écriture de cette colonne par un client (self comme
--     collègue → « new row violates row-level security policy »), les policies de
--     R7 étant gatées `deleted_at IS NULL`. Le garde ne ferme donc rien qui soit
--     ouvert aujourd'hui ; il prend le relais si une policy est assouplie plus tard.
--     L'anonymisation légitime passe par `fn_anonymize_user` (SECURITY DEFINER,
--     GRANT service_role seul → `current_user` = owner → exempté).
--   • `actif` MAIS uniquement sur SOI-MÊME (`NEW.id = auth.uid()`) : sinon un
--     compte suspendu se réactive tout seul. Le garde est volontairement scopé
--     pour NE PAS casser la suspension d'un collaborateur par son manager ou son
--     gestionnaire — `traiteur/equipe/[id]` et `gestionnaire/mon-organisation/users/[id]`
--     tournent en `createSupabaseServerClient` (donc sous `authenticated`), vérifié.
--
-- Aucun flux légitime cassé (recensement exhaustif des routes écrivant `users`) :
-- toutes celles qui touchent ces colonnes tournent en `createAdminSupabaseClient`
-- (service_role, exempté) ou ne les écrivent pas du tout.
--
-- NB le nom `fn_users_block_role_escalation` est conservé (CREATE OR REPLACE =
-- backward-compatible, aucun renommage à propager) : les deux volets relèvent bien
-- de l'escalade de privilège — escalade de RÔLE (volet 1) et de TENANT (volet 2).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Anti-escalade : promotion vers un RÔLE STAFF (admin_savr OU ops_savr)
-- réservée à admin_savr (volet 1) + colonnes structurantes immuables (volet 2).
-- Couvre INSERT et UPDATE, soi-même comme autrui.
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

  -- admin_savr n'est bridé par aucun des deux volets (contrôle positif R10b).
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
    -- Portée : intra-org (`organisation_id` est verrouillé juste en dessous) et les
    -- FK sont en ON UPDATE NO ACTION (l'écriture échoue dès qu'il y a un
    -- historique) — mais le résiduel est un re-binding d'identité et une
    -- répudiation d'audit. Aucune route n'UPDATE `users.id` : rien de légitime cassé.
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
  END IF;

  RETURN NEW;
END;
$$;

-- Re-création idempotente du trigger : même définition qu'en R10b (20260629120000).
-- Rend la migration auto-portante — la garde ne dépend pas de l'ordre d'application.
DROP TRIGGER IF EXISTS trg_users_block_role_escalation ON plateforme.users;
CREATE TRIGGER trg_users_block_role_escalation
  BEFORE INSERT OR UPDATE ON plateforme.users
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_users_block_role_escalation();

-- ROLLBACK (ré-applique la version R10b — REDEVIENT VULNÉRABLE aux DEUX volets) :
--   ré-exécuter le corps de `fn_users_block_role_escalation()` tel qu'il est écrit
--   dans 20260629120000_plateforme_r10b_rls_ops_column_level.sql (l.35-62).
