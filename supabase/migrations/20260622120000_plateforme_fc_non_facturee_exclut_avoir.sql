-- =============================================================================
-- Fix Lot B — M4 : une collecte redevient facturable après annulation par avoir
-- =============================================================================
-- Remplace fn_trg_fc_collecte_non_facturee de 20260611171639 (corps VERBATIM,
-- seule la clause EXISTS change).
--
-- Contexte : un avoir (type='avoir') porte des lignes `factures_collectes` avec
-- le `collecte_id` d'origine (traçabilité, montants négatifs) et passe à 'emise'.
-- Le trigger ne considérait « active » que `statut NOT IN ('annulee')` → après
-- un avoir, la ligne d'avoir (statut='emise') faisait croire que la collecte
-- était encore facturée → toute re-facturation (régénération du brouillon après
-- annulation) levait « déjà rattachée à une facture active ».
--
-- Fix : un avoir n'est PAS une facture active pour la collecte → exclure
-- `type='avoir'` de la garde. Aligne le trigger sur la sémantique « non facturée »
-- = aucune ligne sur une facture statut≠annulee ET type≠avoir (spec §06.08 Reco B).
-- (Le batch de génération applique la même définition côté lecture — cf.
--  packages/plateforme/src/lib/facturation/batch-brouillons.ts.)
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_fc_collecte_non_facturee()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.collecte_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM plateforme.factures_collectes fc
      JOIN plateforme.factures f ON f.id = fc.facture_id
      WHERE fc.collecte_id = NEW.collecte_id
        AND f.statut NOT IN ('annulee')
        AND f.type <> 'avoir'           -- M4 : un avoir n'est pas une facture active
        AND fc.id != NEW.id
    ) THEN
      RAISE EXCEPTION 'La collecte % est déjà rattachée à une facture active', NEW.collecte_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
