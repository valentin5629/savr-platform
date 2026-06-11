-- Module 0.3 — Bloc 7 : Intégrations, Outbox, Jobs, Email, Audit
-- integrations_logs, integrations_inbox, outbox_events, jobs_pdf,
-- email_templates, emails_envoyes, audit_log, config_auto_accept_ag
-- RLS DENY ALL sur chaque table.

-- ============================================================
-- ENUMS Bloc 7
-- ============================================================

DO $$ BEGIN
  CREATE TYPE plateforme.outbox_statut_enum AS ENUM (
    'pending', 'processing', 'done', 'failed', 'dead'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.job_statut_enum AS ENUM (
    'queued', 'processing', 'done', 'failed', 'retrying'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.email_statut_enum AS ENUM (
    'queued', 'sent', 'delivered', 'bounced', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- plateforme.integrations_logs
-- Logs bruts des appels entrants/sortants vers les prestataires.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.integrations_logs (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  integration    text        NOT NULL,
  direction      text        NOT NULL CHECK (direction IN ('entrant', 'sortant')),
  methode        text,
  endpoint       text,
  statut_http    integer,
  payload_in     jsonb,
  payload_out    jsonb,
  duree_ms       integer,
  correlation_id text,
  erreur         text,
  -- created_at inclus dans la PK : obligatoire pour table partitionnée (PG contrainte)
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partition courante (V1 : une seule partition, ajout mensuel en production par ops)
CREATE TABLE IF NOT EXISTS plateforme.integrations_logs_2026
  PARTITION OF plateforme.integrations_logs
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE INDEX IF NOT EXISTS idx_integrations_logs_integration
  ON plateforme.integrations_logs (integration, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integrations_logs_correlation
  ON plateforme.integrations_logs (correlation_id) WHERE correlation_id IS NOT NULL;

ALTER TABLE plateforme.integrations_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.integrations_inbox
-- Événements entrants depuis les prestataires (avant dispatch).
-- Dédup sur event_id_externe.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.integrations_inbox (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text        NOT NULL,
  event_type        text        NOT NULL,
  event_id_externe  text,
  payload           jsonb       NOT NULL,
  traite            boolean     NOT NULL DEFAULT false,
  traite_at         timestamptz,
  erreur            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_inbox_event_externe
  ON plateforme.integrations_inbox (source, event_id_externe)
  WHERE event_id_externe IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_traite
  ON plateforme.integrations_inbox (traite, created_at) WHERE traite = false;

ALTER TABLE plateforme.integrations_inbox ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.outbox_events
-- Transactional outbox — pattern lease/claim (revue adversariale 2026-06-11).
-- Ordre garanti par seq bigserial.
-- txid bigint : garde de visibilité (pg_snapshot_xmin) — jamais DEFAULT NULL.
-- claimed_until : lock temporaire pour l'adapter (lease pattern).
-- requires_reconciliation : set par reaper si claim expiré.
-- head-of-line blocking : ORDER BY seq + skip si pending sur même aggregate_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.outbox_events (
  id                      uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                     bigserial                       NOT NULL UNIQUE,
  -- txid : visibilité de commit (txid_current() au moment de l'INSERT)
  txid                    bigint                          NOT NULL DEFAULT txid_current(),
  aggregate_type          text                            NOT NULL,
  aggregate_id            uuid                            NOT NULL,
  event_type              text                            NOT NULL,
  payload                 jsonb                           NOT NULL,
  consumer                text,
  statut                  plateforme.outbox_statut_enum   NOT NULL DEFAULT 'pending',
  -- Lease/claim : claimed_until défini lors du claim, reset à NULL après résultat
  claimed_until           timestamptz,
  attempts                integer                         NOT NULL DEFAULT 0,
  -- requires_reconciliation : set par reaper si claim expiré, reset avant re-POST
  requires_reconciliation boolean                         NOT NULL DEFAULT false,
  last_error              text,
  created_at              timestamptz                     NOT NULL DEFAULT now(),
  processed_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON plateforme.outbox_events (seq)
  WHERE statut IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
  ON plateforme.outbox_events (aggregate_type, aggregate_id, seq);

CREATE INDEX IF NOT EXISTS idx_outbox_claimed_until
  ON plateforme.outbox_events (claimed_until)
  WHERE statut = 'processing' AND claimed_until IS NOT NULL;

ALTER TABLE plateforme.outbox_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.jobs_pdf
-- Queue de génération PDF (Railway/Puppeteer).
-- Retry : 15 min / 4h (§2 Architecture).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.jobs_pdf (
  id             uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  type_document  text                          NOT NULL,
  entity_type    text                          NOT NULL,
  entity_id      uuid                          NOT NULL,
  statut         plateforme.job_statut_enum    NOT NULL DEFAULT 'queued',
  tentatives     integer                       NOT NULL DEFAULT 0,
  prochaine_tentative_at timestamptz,
  resultat_fichier_id uuid                     REFERENCES shared.fichiers(id),
  erreur_detail  text,
  created_at     timestamptz                   NOT NULL DEFAULT now(),
  updated_at     timestamptz                   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_pdf_queued
  ON plateforme.jobs_pdf (prochaine_tentative_at)
  WHERE statut IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS idx_jobs_pdf_entity
  ON plateforme.jobs_pdf (entity_type, entity_id);

ALTER TABLE plateforme.jobs_pdf ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.email_templates
-- 19 templates actifs seed V1 (catalogue §06.02, corrigé 2026-06-11).
-- Vouvoiement, FR, 0 emoji, signature « L'équipe Savr ».
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.email_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text        NOT NULL UNIQUE,
  sujet        text        NOT NULL,
  corps_html   text        NOT NULL,
  corps_texte  text,
  actif        boolean     NOT NULL DEFAULT true,
  description  text,
  variables    text[],
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.email_templates ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.emails_envoyes
-- Historique des envois Resend.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.emails_envoyes (
  id              uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code   text                          NOT NULL,
  destinataire    text                          NOT NULL,
  sujet           text                          NOT NULL,
  statut          plateforme.email_statut_enum  NOT NULL DEFAULT 'queued',
  resend_id       text,
  entity_type     text,
  entity_id       uuid,
  erreur          text,
  envoye_at       timestamptz,
  created_at      timestamptz                   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emails_entity
  ON plateforme.emails_envoyes (entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emails_statut
  ON plateforme.emails_envoyes (statut);

ALTER TABLE plateforme.emails_envoyes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.audit_log
-- Trace immuable des écritures sensibles (§13 Observabilité §06 Audit trail).
-- Conforme §15 Sécurité (RGPD, pas de stockage données sensibles brutes).
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS plateforme.audit_log_id_seq;

CREATE TABLE IF NOT EXISTS plateforme.audit_log (
  -- bigserial sur table partitionnée : séquence externe + NOT NULL (PK doit inclure created_at)
  id          bigint      NOT NULL DEFAULT nextval('plateforme.audit_log_id_seq'),
  user_id     uuid        REFERENCES plateforme.users(id),
  role        text,
  action      text        NOT NULL,
  table_name  text        NOT NULL,
  record_id   uuid,
  old_values  jsonb,
  new_values  jsonb,
  ip_address  inet,
  user_agent  text,
  -- created_at inclus dans la PK : obligatoire pour table partitionnée (PG contrainte)
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partition courante (V1 : une partition initiale)
CREATE TABLE IF NOT EXISTS plateforme.audit_log_2026
  PARTITION OF plateforme.audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE INDEX IF NOT EXISTS idx_audit_log_user
  ON plateforme.audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record
  ON plateforme.audit_log (table_name, record_id) WHERE record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_date
  ON plateforme.audit_log (created_at DESC);

ALTER TABLE plateforme.audit_log ENABLE ROW LEVEL SECURITY;

-- FK shared.fichiers.created_by → plateforme.users (circulaire)
ALTER TABLE shared.fichiers
  ADD CONSTRAINT fk_fichiers_created_by
  FOREIGN KEY (created_by) REFERENCES plateforme.users(id);

-- ============================================================
-- plateforme.config_auto_accept_ag
-- Paramètres de l'auto-accept par association/transporteur (algo AG V1).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.config_auto_accept_ag (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      uuid        NOT NULL REFERENCES plateforme.organisations(id),
  association_id       uuid        REFERENCES plateforme.associations(id),
  transporteur_id      uuid        REFERENCES plateforme.transporteurs(id),
  auto_accept_actif    boolean     NOT NULL DEFAULT false,
  seuil_pax_min        integer,
  seuil_pax_max        integer,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_config_auto_accept_org
  ON plateforme.config_auto_accept_ag (organisation_id);

ALTER TABLE plateforme.config_auto_accept_ag ENABLE ROW LEVEL SECURITY;
