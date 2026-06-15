-- A2 (M1.8) — Ajout 'rejetee_par_prestataire' à collecte_statut_enum.
-- ALTER TYPE ADD VALUE doit être dans sa propre transaction (PG erreur 55P04).
-- Décision Val 2026-06-15 : statut collecte distinct du statut TMS pour la visibilité dashboard.

ALTER TYPE plateforme.collecte_statut_enum ADD VALUE IF NOT EXISTS 'rejetee_par_prestataire';
