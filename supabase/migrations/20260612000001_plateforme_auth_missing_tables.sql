-- Module 0.5 — Auth : tables manquantes pour l'onboarding
-- Garde-fou 1 TMS-Ready : zéro table tms.*
-- Ne recrée aucune table existante depuis 0.3/0.4

-- ============================================================
-- plateforme.organisations_domaines_email
-- N-N : organisation ↔ domaines email reconnus.
-- Logique de rattachement automatique à l'inscription.
-- Un domaine ne peut être rattaché qu'à une seule organisation.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.organisations_domaines_email (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid        NOT NULL REFERENCES plateforme.organisations(id) ON DELETE CASCADE,
  domaine         text        NOT NULL,
  verifie_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_domaine_email UNIQUE (domaine)
);

CREATE INDEX IF NOT EXISTS idx_org_domaines_email_organisation
  ON plateforme.organisations_domaines_email (organisation_id);

CREATE INDEX IF NOT EXISTS idx_org_domaines_email_domaine
  ON plateforme.organisations_domaines_email (domaine);

ALTER TABLE plateforme.organisations_domaines_email ENABLE ROW LEVEL SECURITY;

-- Lecture : admin_savr/ops_savr tout + gestionnaire de sa propre org (pour affichage)
CREATE POLICY ode_admin ON plateforme.organisations_domaines_email
  FOR ALL USING (plateforme.f_is_staff())
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY ode_own_org_read ON plateforme.organisations_domaines_email
  FOR SELECT USING (organisation_id = (auth.jwt()->>'organisation_id')::uuid);

-- ============================================================
-- plateforme.domaines_email_publics
-- Référentiel des domaines email publics (gmail, outlook, etc.)
-- Un user sur un domaine public crée toujours une orga isolée.
-- Éditable Admin via seed DB / migration (UI = V1.1).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.domaines_email_publics (
  domaine    text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.domaines_email_publics ENABLE ROW LEVEL SECURITY;

-- Lecture : tous les rôles authentifiés (utilisé au signup via SERVICE_ROLE en pratique,
-- mais la route de signup lit via service_role — policy défensive)
CREATE POLICY dep_admin_write ON plateforme.domaines_email_publics
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- Seed : domaines publics les plus courants (liste minimale V1)
INSERT INTO plateforme.domaines_email_publics (domaine) VALUES
  ('gmail.com'),
  ('googlemail.com'),
  ('outlook.com'),
  ('hotmail.com'),
  ('hotmail.fr'),
  ('live.com'),
  ('live.fr'),
  ('yahoo.com'),
  ('yahoo.fr'),
  ('free.fr'),
  ('orange.fr'),
  ('laposte.net'),
  ('sfr.fr'),
  ('wanadoo.fr'),
  ('bbox.fr'),
  ('icloud.com'),
  ('me.com'),
  ('mac.com'),
  ('protonmail.com'),
  ('proton.me'),
  ('pm.me'),
  ('aol.com'),
  ('msn.com')
ON CONFLICT (domaine) DO NOTHING;
