-- M2.5 correctifs — suite revue conformite-spec (E1, E2, E3, E5).
-- Colonnes manquantes (manual_acceptance_* + payload_create + push_create_at + everest_client_id),
-- type smallint, CHECK constraints, RLS policies.

-- 1. Colonnes manquantes
ALTER TABLE plateforme.everest_missions
  ADD COLUMN IF NOT EXISTS everest_client_id             text,
  ADD COLUMN IF NOT EXISTS payload_create                jsonb,
  ADD COLUMN IF NOT EXISTS push_create_at                timestamptz,
  ADD COLUMN IF NOT EXISTS manual_acceptance_at          timestamptz,
  ADD COLUMN IF NOT EXISTS manual_acceptance_by_user_id  uuid,
  ADD COLUMN IF NOT EXISTS manual_acceptance_contact     text,
  ADD COLUMN IF NOT EXISTS manual_acceptance_commentaire text;

-- 2. everest_service_id : integer → smallint (alignement DDL cible V2, garde-fou 1)
ALTER TABLE plateforme.everest_missions
  ALTER COLUMN everest_service_id TYPE smallint;

-- 3. derniere_sync_at : NOT NULL DEFAULT now() (DDL cible V2)
UPDATE plateforme.everest_missions SET derniere_sync_at = now() WHERE derniere_sync_at IS NULL;
ALTER TABLE plateforme.everest_missions
  ALTER COLUMN derniere_sync_at SET NOT NULL,
  ALTER COLUMN derniere_sync_at SET DEFAULT now();

-- 4. CHECK valeurs service_id autorisées (74 = ex-75 per DIV-1 _Divergences/M2.5_20260615.md)
ALTER TABLE plateforme.everest_missions
  ADD CONSTRAINT chk_everest_service_id_values
    CHECK (everest_service_id IN (71, 74, 91));

-- 5. CHECK : created_manually exige les 3 champs de traçabilité (FLOUE #3 tranchée Val)
ALTER TABLE plateforme.everest_missions
  ADD CONSTRAINT chk_everest_created_manually
    CHECK (
      (statut_everest = 'created_manually') =
      (manual_acceptance_at IS NOT NULL
       AND manual_acceptance_by_user_id IS NOT NULL
       AND manual_acceptance_contact IS NOT NULL)
    );

-- 6. CHECK : everest_mission_id NOT NULL hors états d'échec (DDL cible V2)
ALTER TABLE plateforme.everest_missions
  ADD CONSTRAINT chk_everest_mission_id_presence
    CHECK (
      (statut_everest IN ('creation_failed', 'created_manually'))
      OR everest_mission_id IS NOT NULL
    );

-- 7. RLS policies — seul admin_savr accède à everest_missions en rôle authenticated.
--    (workers, webhook route, adapter = service_role → bypass RLS)
CREATE POLICY "admin_savr_select_everest_missions"
  ON plateforme.everest_missions
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM plateforme.users WHERE id = auth.uid()) = 'admin_savr'
  );

CREATE POLICY "admin_savr_insert_everest_missions"
  ON plateforme.everest_missions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM plateforme.users WHERE id = auth.uid()) = 'admin_savr'
  );

CREATE POLICY "admin_savr_update_everest_missions"
  ON plateforme.everest_missions
  FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM plateforme.users WHERE id = auth.uid()) = 'admin_savr'
  );
