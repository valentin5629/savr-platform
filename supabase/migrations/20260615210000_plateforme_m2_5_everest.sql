-- M2.5 — Adapter Everest (A Toutes!) : table de suivi des missions.
-- Gate levée 2026-06-15 (CLAUDE.md §7). Statuts miroir M14 (TMS V2) — même enum,
-- mêmes transitions, pour que le swap V2 soit trivial (garde-fou 2).

DO $$ BEGIN
  CREATE TYPE plateforme.statut_mission_everest AS ENUM (
    'created',
    'assigned',
    'in_progress',
    'completed',
    'completed_incomplete',
    'creation_failed',
    'failed',
    'cancelled',
    'cancelled_externally',
    'created_manually'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS plateforme.everest_missions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 1 mission = 1 tournée (V1 ; multi-vélo = V2 M14)
  tournee_id            uuid        NOT NULL UNIQUE REFERENCES plateforme.tournees(id),
  collecte_id           uuid        NOT NULL REFERENCES plateforme.collectes(id),
  everest_mission_id    text,
  everest_service_id    integer     NOT NULL,
  statut_everest        plateforme.statut_mission_everest NOT NULL DEFAULT 'creation_failed',
  coursier_nom          text,
  coursier_telephone    text,
  vehicule_type_everest text,
  cout_everest_ht       numeric(10,2),
  preuve_course_url     text,
  payload_latest_update jsonb,
  cree_at               timestamptz NOT NULL DEFAULT now(),
  derniere_sync_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_everest_missions_collecte
  ON plateforme.everest_missions (collecte_id);
CREATE INDEX IF NOT EXISTS idx_everest_missions_mission_id
  ON plateforme.everest_missions (everest_mission_id)
  WHERE everest_mission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_everest_missions_statut
  ON plateforme.everest_missions (statut_everest, cree_at DESC);

ALTER TABLE plateforme.everest_missions ENABLE ROW LEVEL SECURITY;

-- Blanket grant (règle post-M0.4a : toute table créée après migration 0.4a)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON plateforme.everest_missions TO authenticated;
