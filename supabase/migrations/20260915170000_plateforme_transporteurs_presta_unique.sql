-- =============================================================================
-- transporteurs.prestataire_logistique_id : 1 prestataire = AU PLUS 1 transporteur
-- =============================================================================
-- POURQUOI
-- Les adapters résolvent le provider d'une tournée par
-- `tournees.prestataire_logistique_id` → `transporteurs.type_tms` : l'adapter
-- MTS-1 ne pousse qu'aux prestataires `type_tms='mts1'`, l'adapter Everest qu'aux
-- `a_toutes`. Ce cloisonnement suppose le lien 1:1.
--
-- Rien ne l'imposait : la migration 20260625000000 ne pose qu'un INDEX simple.
-- DEUX lignes transporteur pointant le MÊME prestataire avec des `type_tms`
-- différents remettraient ce prestataire dans les deux ensembles à la fois — un
-- id de mission Everest repartirait vers MTS-1, CI verte et sans un test rouge.
--
-- Le reste du code assume déjà ce 1:1 : `fetchTransporteur`
-- (packages/adapters/src/outbox-worker.ts) fait `.single()`, qui ERREUR sur
-- doublon — l'invariant était supposé, jamais garanti.
--
-- NATURE DE LA MIGRATION
-- Fermante et non destructive : aucun DROP, aucun RENAME, aucun backfill, aucune
-- ouverture d'accès (ni GRANT, ni policy, ni SECURITY DEFINER). Elle ne peut
-- échouer que si des doublons existent déjà.
--
-- CONTRÔLE DES DONNÉES AVANT POSE (2026-09-15)
--   dev  (savr-dev)  : 5 transporteurs, 4 avec prestataire, 4 distincts → 0 doublon
--   prod (savr-prod) : table vide (0 ligne), lecture seule forcée
--                      (`SET default_transaction_read_only = on`)
--
-- INDEX REDONDANT ASSUMÉ
-- `idx_transporteurs_prestataire_logistique` (index simple, migration R5) est
-- conservé : le retirer serait un DROP, et une migration prod destructive est
-- interdite sans arbitrage Val (CLAUDE.md §12 point 2). Nettoyage à faire dans un
-- lot dédié — le coût est une entrée d'index sur une table de quelques lignes.
-- =============================================================================

-- Index UNIQUE PARTIEL : plusieurs transporteurs peuvent rester sans prestataire
-- (`par_mail`, `par_telephone`, `autre` n'en ont pas), mais un prestataire donné
-- n'est exécuté que par un seul transporteur — donc par un seul provider.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transporteur_par_prestataire
  ON plateforme.transporteurs (prestataire_logistique_id)
  WHERE prestataire_logistique_id IS NOT NULL;

COMMENT ON INDEX plateforme.uniq_transporteur_par_prestataire IS
  'Un prestataire logistique est exécuté par AU PLUS un transporteur, donc rattaché '
  'à un seul type_tms. Garantit le cloisonnement par provider des adapters '
  '(findTournee/findTournees/updateLieu résolvent le provider via ce lien) et '
  'l''hypothèse .single() de fetchTransporteur. V1-only, comme la colonne.';
