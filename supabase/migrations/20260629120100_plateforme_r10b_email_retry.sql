-- R10b · BL-P1-API-05 — Resend : état persistant du retry (3 paliers) + variables.
--
-- CONTEXTE (CDC §08 §4 « Service email — Resend », « Gestion des échecs d'envoi ») :
-- l'état du retry email était absent (`plateforme.emails_envoyes` BLOC7 n'avait ni
-- `tentative_numero` ni `variables_jsonb`). Ces 2 colonnes existent dans le DDL cible
-- V2 (`emails_envoyes` : `tentative_numero integer NOT NULL DEFAULT 1`, `variables_jsonb
-- jsonb NOT NULL`) → leur ajout est une CONVERGENCE vers la cible (réduit la divergence
-- BLOC7 tracée), pas une nouvelle divergence.
--
--   • `tentative_numero` : numéro de la tentative courante (1 = envoi initial, 2-4 = retries).
--   • `variables_jsonb`   : variables du rendu, indispensables pour ré-émettre l'email
--     depuis le cron de retry (`/api/cron/email-retry`).
--
-- Cadence retry = retry policy UNIFIÉE 5 min / 1h / 24h (arbitrage Val 2026-06-29 R10b,
-- alignement sur §08 §1/§2/§3bis ; cf. _Divergences/M0.5_20260629.md). La prochaine
-- tentative est DÉRIVÉE de `created_at` + offset cumulatif par `tentative_numero` (aucune
-- colonne d'ordonnancement inventée). Échec final (tentative 4) → `statut='failed'`
-- (= echec terminal) + ligne `integrations_logs`.

ALTER TABLE plateforme.emails_envoyes
  ADD COLUMN IF NOT EXISTS tentative_numero integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS variables_jsonb  jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- Index de balayage du worker de retry : lignes en échec non épuisées.
CREATE INDEX IF NOT EXISTS idx_emails_retry
  ON plateforme.emails_envoyes (created_at)
  WHERE statut = 'failed' AND tentative_numero < 4;

-- ROLLBACK (additif, réversible sans perte — colonnes de convergence DDL cible) :
--   DROP INDEX IF EXISTS plateforme.idx_emails_retry;
--   ALTER TABLE plateforme.emails_envoyes
--     DROP COLUMN IF EXISTS variables_jsonb,
--     DROP COLUMN IF EXISTS tentative_numero;
