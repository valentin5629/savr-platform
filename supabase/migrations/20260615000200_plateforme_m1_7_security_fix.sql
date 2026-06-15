-- M1.7 Security fix — REVOKE EXECUTE FROM PUBLIC sur fonctions SECURITY DEFINER
-- + fix trigger fn_trg_fc_collecte_non_facturee : exclure les avoirs du check double-facturation
-- Reproduit le pattern B1/B2 de 20260614000002_plateforme_rpc_security_hardening.sql

-- ── B1 : REVOKE EXECUTE FROM PUBLIC ──────────────────────────────────────────
-- Sans ce REVOKE, tout rôle 'authenticated' (traiteur, gestionnaire, agence…)
-- peut appeler ces fonctions SECURITY DEFINER via PostgREST et corrompre
-- la séquence de numérotation fiscale gapless cross-org.

REVOKE EXECUTE ON FUNCTION plateforme.f_next_numero_facture(
  plateforme.serie_facturation_enum, smallint
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION plateforme.f_attribuer_numero_facture(
  plateforme.serie_facturation_enum, smallint
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION plateforme.f_next_numero_bordereau(integer) FROM PUBLIC;

-- ── B2 : SET search_path figé (CWE-426) ──────────────────────────────────────

ALTER FUNCTION plateforme.f_next_numero_facture(
  plateforme.serie_facturation_enum, smallint
) SET search_path = plateforme, public;

ALTER FUNCTION plateforme.f_attribuer_numero_facture(
  plateforme.serie_facturation_enum, smallint
) SET search_path = plateforme, public;

ALTER FUNCTION plateforme.f_next_numero_bordereau(integer)
  SET search_path = plateforme, public;

-- ── Fix D-I : trigger fn_trg_fc_collecte_non_facturee — exclure les avoirs ──
-- Un avoir (type='avoir') rattaché à une collecte ne doit pas bloquer la
-- re-facturation de cette collecte après annulation de la facture d'origine.
-- Avant ce fix : la présence d'un avoir actif (statut='emise') bloquait
-- tout nouvel INSERT dans factures_collectes pour la même collecte_id.

CREATE OR REPLACE FUNCTION plateforme.fn_trg_fc_collecte_non_facturee()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.collecte_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM plateforme.factures_collectes fc
      JOIN plateforme.factures f ON f.id = fc.facture_id
      WHERE fc.collecte_id = NEW.collecte_id
        AND f.statut NOT IN ('annulee')
        AND f.type != 'avoir'
        AND fc.id != NEW.id
    ) THEN
      RAISE EXCEPTION 'La collecte % est déjà rattachée à une facture active', NEW.collecte_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
