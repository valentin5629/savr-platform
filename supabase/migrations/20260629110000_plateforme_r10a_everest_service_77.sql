-- R10a / BL-P1-API-04 — Everest service 77 (camion express last-minute).
-- Le CHECK chk_everest_service_id_values (migration 20260615220000) limitait
-- everest_service_id à IN (71, 74, 91) → le dispatch de la branche
-- `ag_everest_camion_express` (service 77, que l'algo M2.3 produit déjà) échouait
-- au CHECK. On élargit le domaine aux 4 services actifs V1 (§08 §3 l.269/279,
-- DIV-3 décision Val 2026-06-15). Convergent avec le DDL cible (garde-fou 1).

ALTER TABLE plateforme.everest_missions
  DROP CONSTRAINT IF EXISTS chk_everest_service_id_values;

ALTER TABLE plateforme.everest_missions
  ADD CONSTRAINT chk_everest_service_id_values
    CHECK (everest_service_id IN (71, 74, 77, 91));
