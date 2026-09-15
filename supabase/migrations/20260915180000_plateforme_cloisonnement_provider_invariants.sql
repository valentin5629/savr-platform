-- =============================================================================
-- Invariants DB du cloisonnement par provider
--   1. 1 prestataire logistique = AU PLUS 1 transporteur (donc 1 seul type_tms)
--   2. 1 reference de commande = AU PLUS 1 tournee
-- =============================================================================
-- POURQUOI
-- Les adapters resolvent le provider d'une tournee par
-- `tournees.prestataire_logistique_id` -> `transporteurs.type_tms` : l'adapter
-- MTS-1 ne pousse qu'aux prestataires `type_tms='mts1'`, l'adapter Everest
-- qu'aux `a_toutes`. Ce cloisonnement (sortant E1/E2/E3/E5 et entrant
-- `findTourneeByOrderId`) suppose DEUX invariants que rien n'imposait en base.
--
-- (1) Le lien prestataire -> transporteur n'avait qu'un INDEX SIMPLE
-- (20260625000000). Deux lignes transporteur pointant le MEME prestataire avec
-- des `type_tms` differents remettraient ce prestataire dans les deux ensembles
-- a la fois : un id de mission Everest repartirait vers MTS-1, CI verte et sans
-- un test rouge. Le reste du code assume deja ce 1:1 — `fetchTransporteur`
-- (packages/adapters/src/outbox-worker.ts) fait `.single()`, qui ERREUR sur
-- doublon : l'invariant etait suppose, jamais garanti.
--
-- (2) `tournees.external_ref_commande` n'avait NI unique NI index (verifie sur
-- savr-dev). C'est pourtant la cle de rapprochement du polling entrant
-- (`findTourneeByOrderId`, `.maybeSingle()`) : deux tournees portant la meme
-- reference faisaient remonter PGRST116, l'ordre passait pour « sans tournee
-- Savr » et `markInboxDone(traite=true)` consommait la cle d'idempotence
-- DEFINITIVEMENT (pesees, statuts, agregation terminale perdus, sans retry ni
-- alerte). L'adapter lit desormais cette `error` — l'index, lui, rend la
-- collision impossible plutot que seulement bruyante, et sert d'index de
-- lecture au poll (qui faisait jusqu'ici un parcours complet de `tournees`).
--
-- NATURE DE LA MIGRATION
-- Fermante et non destructive : aucun DROP, aucun RENAME, aucun backfill, aucune
-- ouverture d'acces (ni GRANT, ni policy, ni SECURITY DEFINER, ni RLS touchee).
-- Elle ne peut echouer que si des doublons existent deja.
--
-- CONTROLE DES DONNEES AVANT POSE (2026-09-15, lecture seule forcee
-- `default_transaction_read_only = on`)
--   dev  (savr-dev)  : 5 transporteurs / 4 prestataires renseignes, 4 distincts
--                      202 tournees, 202 references, 202 distinctes -> 0 doublon
--   prod (savr-prod) : `transporteurs` et `tournees` vides (0 ligne)
--
-- INDEX REDONDANT ASSUME
-- `idx_transporteurs_prestataire_logistique` (index simple, migration R5) est
-- conserve : le retirer serait un DROP, et une migration prod destructive est
-- interdite sans arbitrage Val (CLAUDE.md §12 point 2). Nettoyage a faire dans
-- un lot dedie — le cout est une entree d'index sur une table de quelques lignes.
-- =============================================================================

-- ─── 1. Un prestataire = un transporteur = un provider ───────────────────────
-- PARTIEL : plusieurs transporteurs peuvent rester sans prestataire
-- (`par_mail`, `par_telephone`, `autre` n'en ont pas), mais un prestataire
-- donne n'est execute que par un seul transporteur.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transporteur_par_prestataire
  ON plateforme.transporteurs (prestataire_logistique_id)
  WHERE prestataire_logistique_id IS NOT NULL;

COMMENT ON INDEX plateforme.uniq_transporteur_par_prestataire IS
  'Un prestataire logistique est execute par AU PLUS un transporteur, donc rattache '
  'a un seul type_tms. Garantit le cloisonnement par provider des adapters '
  '(findTournee/findTournees/findTourneeByOrderId/updateLieu resolvent le provider '
  'via ce lien) et l''hypothese .single() de fetchTransporteur. V1-only, comme la colonne.';

-- ─── 2. Une reference de commande = une tournee ──────────────────────────────
-- PARTIEL : une tournee non encore dispatchee n'a pas de reference (NULL), et
-- ces NULL restent multiples.
--
-- La colonne est PARTAGEE entre providers (MTS-1 y ecrit un customerOrderId,
-- Everest un mission_id) : l'unicite porte donc sur l'ensemble des references,
-- tous providers confondus. C'est volontaire — c'est exactement l'espace dans
-- lequel `findTourneeByOrderId` cherche, et une collision inter-providers y
-- serait tout aussi ambigue qu'une collision intra-provider. Cote ecriture, les
-- deux adapters remontent desormais l'erreur d'un tel conflit (23505) au lieu de
-- l'ignorer : jamais de mission creee chez le provider sans reference en base.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tournee_par_external_ref
  ON plateforme.tournees (external_ref_commande)
  WHERE external_ref_commande IS NOT NULL;

COMMENT ON INDEX plateforme.uniq_tournee_par_external_ref IS
  'Une reference de commande prestataire (customerOrderId MTS-1 ou mission_id Everest) '
  'designe AU PLUS une tournee. Rend sound le .maybeSingle() du rapprochement entrant '
  '(AdapterMts1.findTourneeByOrderId) — une collision y remontait PGRST116, l''ordre '
  'passait pour inconnu et markInboxDone consommait la cle d''idempotence definitivement. '
  'Sert aussi d''index de lecture au polling (auparavant parcours complet de tournees).';
