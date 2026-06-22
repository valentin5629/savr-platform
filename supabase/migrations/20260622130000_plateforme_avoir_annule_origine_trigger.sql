-- =============================================================================
-- Fix Lot B — M9(b) : la facture d'origine n'est annulée qu'au succès du push
-- =============================================================================
-- Avant : creerAvoir() passait la facture d'origine à 'annulee' AVANT le push
-- Pennylane du credit_note. Si le push échouait (4xx), l'origine restait bloquée
-- 'annulee' et l'avoir restait un brouillon jamais poussé (le worker retry ne
-- traite que 'en_attente_pennylane') → incohérence.
--
-- Fix robuste et centralisé : l'annulation de l'origine est déclenchée par un
-- trigger quand l'AVOIR atteint 'emise' (credit note effectivement poussé). Ça
-- couvre les DEUX chemins de succès — creerAvoir() directe ET le retry worker
-- (renvoyerFacture) — sans dupliquer la logique. Tant que l'avoir n'est pas
-- 'emise', l'origine reste active (donc retentable / re-facturable).
--
-- Idempotent (garde OLD.statut), pas de récursion (l'origine n'est jamais de
-- type 'avoir'). L'UPDATE dans creerAvoir() est retiré côté TS (cf. avoirs.ts).
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_avoir_annule_origine()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
BEGIN
  IF NEW.type = 'avoir'
     AND NEW.statut = 'emise'
     AND OLD.statut IS DISTINCT FROM 'emise'
     AND NEW.facture_origine_id IS NOT NULL THEN
    UPDATE plateforme.factures
    SET statut = 'annulee', updated_at = now()
    WHERE id = NEW.facture_origine_id
      -- defense-in-depth (SECURITY DEFINER) : l'origine partage toujours l'org de
      -- l'avoir par construction (creerAvoir dérive org+entité de l'origine, et
      -- l'INSERT factures est admin-only). Cette garde transforme l'invariant
      -- applicatif en garantie DB → jamais d'annulation cross-organisation.
      AND organisation_id = NEW.organisation_id
      AND statut <> 'annulee';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_avoir_annule_origine ON plateforme.factures;
CREATE TRIGGER trg_avoir_annule_origine
  AFTER UPDATE OF statut ON plateforme.factures
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_avoir_annule_origine();
