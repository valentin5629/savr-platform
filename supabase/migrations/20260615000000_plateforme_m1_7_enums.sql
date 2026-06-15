-- M1.7 — Pennylane : enums séparés (ALTER TYPE ADD VALUE hors transaction obligatoire)
-- Nouveaux ENUMs créés ici ; ADD VALUE sur enums existants ne peuvent pas
-- être utilisés dans la même transaction (PG erreur 55P04).

-- 1. Nouveaux statuts facture
ALTER TYPE plateforme.facture_statut_enum ADD VALUE IF NOT EXISTS 'en_attente_pennylane';
ALTER TYPE plateforme.facture_statut_enum ADD VALUE IF NOT EXISTS 'emise';

-- 2. Nouvelles séries facturation (FZD/FAG/FPK/AV)
ALTER TYPE plateforme.serie_facturation_enum ADD VALUE IF NOT EXISTS 'FZD';
ALTER TYPE plateforme.serie_facturation_enum ADD VALUE IF NOT EXISTS 'FAG';
ALTER TYPE plateforme.serie_facturation_enum ADD VALUE IF NOT EXISTS 'FPK';
ALTER TYPE plateforme.serie_facturation_enum ADD VALUE IF NOT EXISTS 'AV';

-- 3. Nouveaux types (CREATE TYPE peut aller dans une tx mais on les met ici
--    pour qu'ils soient visibles dans la migration principale)
DO $$ BEGIN
  CREATE TYPE plateforme.facture_type AS ENUM (
    'zero_dechet', 'achat_pack_antigaspi', 'collecte_antigaspi', 'avoir'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.facture_mode AS ENUM (
    'par_collecte', 'mensuelle', 'globale_pack'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.tarif_source AS ENUM (
    'zd_grille', 'ag_unitaire', 'libre'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
