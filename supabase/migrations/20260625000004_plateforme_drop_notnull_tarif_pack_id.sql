-- Fix back-office — pack AG `personnalise` impossible à créer (NOT NULL legacy)
-- ============================================================================
-- `plateforme.packs_antgaspi.tarif_pack_id` est une FK LEGACY (créée bloc5
-- 20260611171639) vers `tarifs_packs_ag`, encore NOT NULL. Le modèle convergé
-- (align M2.1b 20260615200000) a remplacé cette dépendance par un SNAPSHOT de
-- prix (`packs_antgaspi.prix_unitaire_ht` / `montant_total_ht`) — la colonne
-- `tarif_pack_id` n'a plus d'équivalent dans le DDL cible V2 et n'est lue par
-- AUCUNE logique métier (seuls les seeds la renseignent).
--
-- Conséquence du résidu NOT NULL : un pack `type_pack='personnalise'` (tarif
-- négocié libre, GL Events… §05 §3) n'a AUCUNE ligne `tarifs_packs_ag` à
-- référencer → l'INSERT de la route POST /api/v1/admin/packs-antgaspi viole la
-- contrainte (23502) → création de pack AG cassée au back-office.
--
-- Étape de dépréciation backward-compat (drop de la colonne = lot de
-- convergence ultérieur, à tracer DDL cible/Frontière) : on rend la colonne
-- nullable. Aucune donnée existante touchée ; les seeds qui la renseignent
-- restent valides ; les fixtures pgTAP qui l'omettent (ou la fournissent)
-- restent valides.
-- ============================================================================

ALTER TABLE plateforme.packs_antgaspi
  ALTER COLUMN tarif_pack_id DROP NOT NULL;
