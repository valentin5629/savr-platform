-- =============================================================================
-- Annulation tardive : marquée sur la collecte au passage à `annulee`
-- =============================================================================
-- Décision Val 2026-11-03 : les Revenus du Dashboard Admin (§11 §1.1 Bloc 2)
-- comptent les annulations tardives au montant plein de la prestation. Or
-- l'instant d'une annulation directe n'était stocké nulle part
-- (`annulation_demandee_at` ne vaut que pour une demande confirmée par
-- l'Admin) : après coup, on ne savait pas si une annulation était tardive.
--
-- `collectes.annulation_tardive` :
--   - true  : annulée moins de 4 h avant le créneau (heure de Paris, strict),
--             imputable au client ou sans incident ;
--   - false : annulée à 4 h ou plus, ou incident imputable à un autre que le
--             client, ou annulée depuis un statut où aucune prestation n'était
--             due (brouillon, refus du prestataire) ou déjà réalisée
--             (correction Admin) ;
--   - NULL  : collecte non annulée, ou annulée avant cette migration (non
--             reconstituable : l'instant de l'annulation n'a pas été gardé).
--
-- Règle : celle de fn_trg_pack_debit_annulation_tardive (20261102180000 §5),
-- recopiée à l'identique pour l'instant de référence, le seuil et l'incident,
-- valable pour AG et ZD. Le déclencheur pack n'est pas modifié.
--
-- Backward-compatible, non destructive : une colonne nullable sans défaut, une
-- fonction de déclencheur fermée, un déclencheur. Écriture de `collectes`
-- fermée à `authenticated` depuis 20260915160000 : seul service_role (et ce
-- déclencheur) écrit la colonne. Lecture : le SELECT table-level existant
-- couvre la nouvelle colonne, sous les mêmes policies (le client ne voit que
-- ses collectes). Aucune donnée reprise.
-- Retour arrière : DROP TRIGGER puis DROP FUNCTION ; la colonne reste (sans
-- usage) jusqu'à la release suivante.
-- =============================================================================

ALTER TABLE plateforme.collectes
  ADD COLUMN IF NOT EXISTS annulation_tardive boolean;

COMMENT ON COLUMN plateforme.collectes.annulation_tardive IS
  'Annulation tardive (Val 2026-11-03) : true = annulée moins de 4 h avant le créneau (heure de Paris, strict), imputable au client ou sans incident ; false = autre annulation ; NULL = non annulée ou annulée avant le 2026-11-03. Posée par trg_marquer_annulation_tardive. Comptée au montant plein dans les Revenus du Dashboard Admin.';

CREATE OR REPLACE FUNCTION plateforme.fn_trg_marquer_annulation_tardive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_reference timestamptz;
BEGIN
  IF NEW.statut <> 'annulee' THEN
    NEW.annulation_tardive := NULL;
    RETURN NEW;
  END IF;
  IF OLD.statut = 'annulee' THEN
    RETURN NEW;
  END IF;

  -- Aucune prestation due (brouillon, refus du prestataire) ou déjà réalisée
  -- (correction Admin) : jamais une annulation tardive.
  IF OLD.statut IN ('brouillon', 'rejetee_par_prestataire',
                    'realisee', 'realisee_sans_collecte', 'cloturee') THEN
    NEW.annulation_tardive := false;
    RETURN NEW;
  END IF;

  -- Instant de référence (Val 2026-10-15) : une demande confirmée par l'Admin
  -- se juge à sa réception ; toute autre annulation, à l'instant où elle est
  -- faite.
  v_reference := CASE
    WHEN OLD.statut = 'annulation_demandee'
      THEN COALESCE(OLD.annulation_demandee_at, now())
    ELSE now()
  END;

  -- < 4 h avant le créneau (heure de Paris, strict) ET imputable au client ou
  -- sans incident (RM-09).
  NEW.annulation_tardive := (
      NEW.incident_imputable_a IS NULL OR NEW.incident_imputable_a = 'client'
    ) AND (
      ((NEW.date_collecte + COALESCE(NEW.heure_collecte, '00:00:00'::time))
         AT TIME ZONE 'Europe/Paris')
      - INTERVAL '4 hours'
    ) < v_reference;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_trg_marquer_annulation_tardive()
  FROM authenticated, anon, PUBLIC;

DROP TRIGGER IF EXISTS trg_marquer_annulation_tardive ON plateforme.collectes;
CREATE TRIGGER trg_marquer_annulation_tardive
  BEFORE UPDATE OF statut ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_marquer_annulation_tardive();
