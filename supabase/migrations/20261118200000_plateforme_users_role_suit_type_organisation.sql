-- =============================================================================
-- Rôle d'un utilisateur ↔ type de son organisation (revue sécurité 2026-11-18)
-- =============================================================================
-- Règle (CDC §09 §2 « Profils utilisateurs », §05 §8 « Logique de rattachement »,
-- §04 `users`) : un rôle client n'existe que dans une organisation de son type.
--   traiteur            → traiteur_manager, traiteur_commercial
--   agence              → agence
--   gestionnaire_lieux  → gestionnaire_lieux
--   client_organisateur → client_organisateur
-- L'équipe Savr (admin_savr, ops_savr) n'est pas contrôlée ici : son
-- organisation de rattachement est un contournement déjà tracé (organisation
-- interne « Savr » de type agence, fiches M0.7 / M0.7b ; le CDC §04 la veut
-- sans organisation, colonne encore NOT NULL).
--
-- Constat mesuré le 2026-11-18 avant ce correctif : rien ne tenait la règle.
--   • routes Admin `POST /api/v1/admin/users` et `PATCH …/users/[id]` : liste
--     des rôles et réserve admin_savr seulement (service_role, RLS contournée) ;
--   • PostgREST sous `authenticated` : `usr_manager_update` et
--     `usr_gestionnaire_update` ne contrôlent que l'organisation, et
--     `trg_users_block_role_escalation` ne refuse que les rôles staff et le
--     changement de son propre rôle. Un manager traiteur pouvait donc passer un
--     collègue en gestionnaire_lieux, un gestionnaire passer un collègue en
--     traiteur_manager ;
--   • `PATCH /api/v1/admin/organisations/[id]` change le type sans regarder les
--     utilisateurs.
-- savr-dev : 2 écarts (comptes de démo traiteur_commercial dans « Savr »,
-- corrigés par le seed du même lot) ; savr-prod : aucun.
--
-- Deux déclencheurs :
--   1. `trg_users_role_suit_type_organisation` (BEFORE INSERT, UPDATE OF role,
--      organisation_id) refuse un rôle client hors de son type, QUEL QUE SOIT
--      l'appelant (service_role et postgres compris : les routes Admin passent
--      par service_role). Il ne se déclenche que si le rôle ou l'organisation
--      change : une ligne ancienne discordante reste modifiable sur ses autres
--      colonnes (connexion, profil).
--   2. `trg_organisations_type_reecrit_roles` (AFTER UPDATE OF type) réécrit,
--      dans la même transaction, le rôle des utilisateurs que le nouveau type
--      n'admet plus (arbitrage Val 2026-11-18) : vers traiteur → traiteur_manager,
--      vers un autre type → le rôle du même nom. La route Admin trace chaque
--      réécriture (`user_role_modifie`). Seuls service_role et postgres écrivent
--      `organisations.type` (aucun droit UPDATE pour `authenticated`, mesuré).
--
-- Fermeture stricte (CLAUDE.md §12 2bis) : aucun droit ouvert, aucune policy
-- touchée. Preuve : supabase/tests/SECU__users_role_type_organisation.test.sql.
-- =============================================================================

-- La correspondance, en un seul endroit. IMMUTABLE et sans lecture : sûre à
-- appeler par tout rôle. Équipe Savr : toujours vrai (cf. en-tête).
CREATE OR REPLACE FUNCTION plateforme.f_role_compatible_type_organisation(
  p_role plateforme.user_role,
  p_type plateforme.organisation_type
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_role::text
    WHEN 'admin_savr' THEN true
    WHEN 'ops_savr' THEN true
    WHEN 'traiteur_manager' THEN p_type::text = 'traiteur'
    WHEN 'traiteur_commercial' THEN p_type::text = 'traiteur'
    ELSE p_type::text = p_role::text
  END
$$;

COMMENT ON FUNCTION plateforme.f_role_compatible_type_organisation(plateforme.user_role, plateforme.organisation_type) IS
  'Vrai si le rôle est admis dans une organisation de ce type (traiteur : traiteur_manager, traiteur_commercial ; agence, gestionnaire_lieux, client_organisateur : le rôle du même nom ; admin_savr, ops_savr : toujours). NULL si le type est NULL. CDC §09 §2, §05 §8 (2026-11-18).';

-- 1. Garde à l'écriture d'un utilisateur.
--
-- SECURITY DEFINER pour LIRE le type de l'organisation : sous `authenticated`,
-- la RLS d'`organisations` cache les autres organisations, et la garde
-- parlerait alors à la place de la RLS (refus 23514 au lieu de 42501 sur une
-- écriture inter-organisations). Elle n'écrit rien et ne rend que NEW.
-- Fonction de déclencheur : exclue du cliquet du code de vérification, qui ne
-- recense que les fonctions appelables (`pg_get_function_result <> 'trigger'`).
--
-- Rôle ou organisation absents, organisation inexistante : la garde laisse
-- passer, parce que la contrainte NOT NULL ou la clé étrangère (non
-- différable) refusent la ligne juste après. Elle ne tranche que sur un type lu.
CREATE OR REPLACE FUNCTION plateforme.fn_users_role_suit_type_organisation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type plateforme.organisation_type;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.organisation_id IS NOT DISTINCT FROM OLD.organisation_id THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS NULL OR NEW.organisation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.type INTO v_type
  FROM plateforme.organisations o
  WHERE o.id = NEW.organisation_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF plateforme.f_role_compatible_type_organisation(NEW.role, v_type) IS NOT TRUE THEN
    RAISE EXCEPTION 'Rôle % refusé dans une organisation de type % (CDC §09 §2)',
      NEW.role::text, v_type::text
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_users_role_suit_type_organisation() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plateforme.fn_users_role_suit_type_organisation() IS
  'Déclencheur BEFORE INSERT / UPDATE OF role, organisation_id sur plateforme.users : refuse (23514) un rôle client dans une organisation d''un autre type, pour tout appelant. Revue sécurité 2026-11-18.';

DROP TRIGGER IF EXISTS trg_users_role_suit_type_organisation ON plateforme.users;
CREATE TRIGGER trg_users_role_suit_type_organisation
  BEFORE INSERT OR UPDATE OF role, organisation_id ON plateforme.users
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_users_role_suit_type_organisation();

-- 2. Changement de type d'une organisation : les rôles suivent.
--
-- SECURITY INVOKER : seuls service_role et postgres écrivent
-- `organisations.type`. Si un droit UPDATE était un jour ouvert à
-- `authenticated`, la réécriture passerait par la RLS et par
-- `trg_users_block_role_escalation` de l'appelant (un client ne réécrirait pas
-- son propre rôle).
CREATE OR REPLACE FUNCTION plateforme.fn_organisations_type_reecrit_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE plateforme.users u
     SET role = (CASE NEW.type::text
                   WHEN 'traiteur' THEN 'traiteur_manager'
                   ELSE NEW.type::text
                 END)::plateforme.user_role
   WHERE u.organisation_id = NEW.id
     AND plateforme.f_role_compatible_type_organisation(u.role, NEW.type) IS NOT TRUE;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_organisations_type_reecrit_roles() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plateforme.fn_organisations_type_reecrit_roles() IS
  'Déclencheur AFTER UPDATE OF type sur plateforme.organisations : réécrit le rôle des utilisateurs que le nouveau type n''admet plus (vers traiteur : traiteur_manager ; sinon le rôle du même nom). Arbitrage Val 2026-11-18.';

DROP TRIGGER IF EXISTS trg_organisations_type_reecrit_roles ON plateforme.organisations;
CREATE TRIGGER trg_organisations_type_reecrit_roles
  AFTER UPDATE OF type ON plateforme.organisations
  FOR EACH ROW
  WHEN (NEW.type IS DISTINCT FROM OLD.type)
  EXECUTE FUNCTION plateforme.fn_organisations_type_reecrit_roles();
