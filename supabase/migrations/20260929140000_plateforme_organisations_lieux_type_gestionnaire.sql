-- =============================================================================
-- organisations_lieux : seule une organisation `gestionnaire_lieux` peut être
-- rattachée à un lieu (INSERT et UPDATE refusés sinon).
-- =============================================================================
--
-- SOURCE. 04 - Data Model, table `organisations_lieux`, note V1 2026-05-07 :
--   « utilisé uniquement pour les gestionnaires de lieux ». Arbitrage Val
--   2026-09-29 (divergence SECU-RLS_20260929) : un traiteur n'a PAS de « lieux
--   à lui » ; l'invariant est imposé en base (option B).
--
-- POURQUOI. `f_collecte_visible` (source unique de la visibilité collecte,
-- §09 3ter) ouvre les collectes DATÉES d'un lieu à toute organisation
-- rattachée, sans garde de rôle ; la branche 1 de la policy `lieux` aussi.
-- Mesuré en local (2026-09-29) : un traiteur rattaché par erreur lit la
-- collecte d'un autre traiteur sur ce lieu (`notes_internes` comprises) et le
-- lieu. Les routes admin lieux refusent déjà ce rattachement en 422 ; ce
-- trigger ferme les autres chemins (PostgREST sous JWT admin, SQL, scripts de
-- migration V5, seeds).
--
-- CE QUE LE TRIGGER NE FAIT PAS. Il ne touche pas aux lignes déjà présentes
-- (un trigger de ligne ne revalide pas l'existant) : leur mesure et leur
-- nettoyage en dev/prod sont une étape séparée. Il ne couvre pas non plus le
-- changement de `organisations.type` d'une organisation déjà rattachée
-- (garde serveur sur PATCH /admin/organisations/{id}, lot suivant).
--
-- SECURITY DEFINER : la lecture de `organisations.type` ne doit pas dépendre
-- des privilèges colonne de l'appelant (SELECT liste blanche, 20260918100000).
-- EXECUTE retiré à tous (P0 #263) — un trigger s'exécute sans ce droit.
--
-- NATURE. Fermante et non destructive : aucun DROP de table ou de colonne,
-- aucun RENAME ni backfill, aucun GRANT, aucune policy ; seule fonction
-- SECURITY DEFINER = celle du trigger, fermée.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_organisations_lieux_type_gestionnaire()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM plateforme.organisations o
     WHERE o.id = NEW.organisation_id
       AND o.type = 'gestionnaire_lieux'
  ) THEN
    RAISE EXCEPTION
      'organisations_lieux : seule une organisation de type gestionnaire_lieux peut être rattachée à un lieu'
      USING ERRCODE = 'P0047';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_trg_organisations_lieux_type_gestionnaire()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_organisations_lieux_type_gestionnaire ON plateforme.organisations_lieux;
CREATE TRIGGER trg_organisations_lieux_type_gestionnaire
  BEFORE INSERT OR UPDATE OF organisation_id ON plateforme.organisations_lieux
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_trg_organisations_lieux_type_gestionnaire();

COMMENT ON FUNCTION plateforme.fn_trg_organisations_lieux_type_gestionnaire() IS
  'Refuse (P0047) le rattachement à un lieu d''une organisation qui n''est pas de type gestionnaire_lieux — CDC §04 organisations_lieux, arbitrage Val 2026-09-29.';
