-- M2.4 — Enums (migration séparée, isolation tx PostgreSQL)
-- ALTER TYPE ... ADD VALUE doit vivre dans une migration distincte de celle qui
-- l'utilise (convention repo, leçon M1.6 / M1.7 enums) : un nouveau label d'enum
-- ne peut pas être consommé dans la même transaction que son ajout.

-- Série de numérotation gapless des attestations de don AG (ATT-DON-YYYY-NNNNN).
ALTER TYPE plateforme.serie_facturation_enum ADD VALUE IF NOT EXISTS 'ATTDON';
