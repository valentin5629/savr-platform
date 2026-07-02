-- R17c (décision Val 2026-07-02, revue visuelle) — champ « Capacité maximum » sur
-- les lieux, DISTINCT de volume_max_bacs (nombre de bacs) : arbitrage Val « nouvelle
-- colonne dédiée ». Format nombre, non obligatoire. Affiché dans la fiche lieu + la
-- vue liste (à droite de l'adresse).
--
-- Frontière garde-fou 1 : colonne ajoutée aussi au DDL cible V2 → V1 ⊆ cible.

ALTER TABLE plateforme.lieux
  ADD COLUMN IF NOT EXISTS capacite_maximum integer;
