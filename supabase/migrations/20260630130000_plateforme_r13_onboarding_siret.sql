-- R13 Onboarding — BL-P1-ONB-02 (file revalidation SIRET) + BL-P1-ONB-03 (unicité SIRET).
-- Réf CDC : §15 §2.6 l.69 (doublon SIRET/domaine bloqué) + l.73 (INSEE down → en_attente
--           + job async 3 paliers 15 min / 1 h / 24 h ; gating facturation = siret_verification='verifie').
--
-- Frontière TMS-Ready (G1) : la table `file_revalidation_siret` et l'index UNIQUE partiel sur
-- `entites_facturation.siret` ne figurent pas dans le DDL cible V2 (specs/ddl-cible) → divergence
-- structurelle V1-only TRACÉE dans _Divergences/M0.4_20260630.md (convergence V2 : ajout au DDL cible).
-- Schema-vs-cible reste en mode rapport (non ratché) jusqu'à convergence Cowork.

-- ============================================================
-- 1. BL-P1-ONB-03 — unicité SIRET (détection doublon à l'inscription)
-- ============================================================
-- Partielle WHERE siret <> '' : les entités créées sans SIRET renseigné (orga incomplète
-- créée par Admin §06.06, ou état legacy) portent siret='' et ne doivent jamais entrer en
-- collision entre elles. Une violation sur un SIRET réel est mappée en 409 par le signup.
-- ⚠ Prérequis prod (revue manuelle Val + frère) : aucun doublon de SIRET non vide préexistant
--   (sinon CREATE UNIQUE INDEX échoue). Dev/seed : SIRET distincts par construction.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_entites_facturation_siret
  ON plateforme.entites_facturation (siret)
  WHERE siret <> '';

-- ============================================================
-- 2. BL-P1-ONB-02 — file de revalidation SIRET (job async, INSEE down)
-- ============================================================
-- Une ligne est créée quand INSEE est injoignable au signup (verifySiret → 'down') : l'entité
-- reste `en_attente` et le cron `revalidation-siret` re-tente selon 3 paliers (15 min / 1 h / 24 h).
-- Sortie : 'resolu' (verifie/echec tranché) ou 'epuise' (INSEE toujours down après 3 tentatives
-- → alerte Admin in-app, l'entité reste en_attente, action manuelle).
CREATE TABLE IF NOT EXISTS plateforme.file_revalidation_siret (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entite_facturation_id  uuid        NOT NULL
                           CONSTRAINT file_revalidation_siret_entite_fkey
                           REFERENCES plateforme.entites_facturation(id),
  statut                 text        NOT NULL DEFAULT 'en_attente'
                           CONSTRAINT file_revalidation_siret_statut_chk
                           CHECK (statut IN ('en_attente', 'resolu', 'epuise')),
  tentatives             integer     NOT NULL DEFAULT 0,
  prochaine_tentative_le timestamptz NOT NULL DEFAULT now(),
  derniere_erreur        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Une seule revalidation active par entité (idempotence de l'enqueue au signup).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_file_revalidation_siret_active
  ON plateforme.file_revalidation_siret (entite_facturation_id)
  WHERE statut = 'en_attente';

-- Index de scan du cron : lignes dues à retenter.
CREATE INDEX IF NOT EXISTS idx_file_revalidation_siret_due
  ON plateforme.file_revalidation_siret (prochaine_tentative_le)
  WHERE statut = 'en_attente';

-- RLS DENY ALL par défaut. File interne : écriture = service_role (bypass RLS) au signup
-- (enqueue) et au cron (worker). Lecture staff pour visibilité back-office (cf. outbox_admin_read).
ALTER TABLE plateforme.file_revalidation_siret ENABLE ROW LEVEL SECURITY;

CREATE POLICY frs_staff_select ON plateforme.file_revalidation_siret
  FOR SELECT TO public
  USING (plateforme.f_is_staff());

-- GRANT explicite : le blanket grant TO authenticated n'est pas rétroactif (table post-0.4a).
-- service_role couvert par ALTER DEFAULT PRIVILEGES.
GRANT SELECT, INSERT, UPDATE, DELETE ON plateforme.file_revalidation_siret TO authenticated;

-- ============================================================
-- Contrôle PRÉ-PROD (à exécuter par Val + frère AVANT application en prod) :
-- l'index UNIQUE partiel échoue si des SIRET non vides en double préexistent.
-- Doit renvoyer 0 ligne ; sinon, dédupliquer manuellement avant d'appliquer.
--   SELECT siret, COUNT(*) FROM plateforme.entites_facturation
--   WHERE siret <> '' GROUP BY siret HAVING COUNT(*) > 1;
--
-- Rollback (down-migration) — cette migration est purement additive (création table +
-- index, aucune perte de donnée). Pour l'annuler : retirer la table
-- plateforme.file_revalidation_siret et l'index uniq_entites_facturation_siret
-- (DDL inverses des CREATE ci-dessus). Procédure générale : RUNBOOK_INCIDENT.md §3.
-- ============================================================
