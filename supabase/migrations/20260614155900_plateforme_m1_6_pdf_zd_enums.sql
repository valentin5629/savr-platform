-- Migration précurseur M1.6 — ajout valeurs d'enum
-- DOIT être dans une transaction séparée de la migration principale :
-- ALTER TYPE ADD VALUE n'est pas visible dans la même transaction (PG erreur 55P04).

ALTER TYPE plateforme.serie_facturation_enum ADD VALUE IF NOT EXISTS 'BSAV';
ALTER TYPE plateforme.job_statut_enum        ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE plateforme.job_statut_enum        ADD VALUE IF NOT EXISTS 'dead';
