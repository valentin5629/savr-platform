-- =============================================================================
-- Invariant DB du cloisonnement par provider :
--   1 reference de commande = AU PLUS 1 tournee
-- =============================================================================
-- POURQUOI
-- `tournees.external_ref_commande` n'avait NI unique NI index (verifie sur
-- savr-dev). C'est pourtant la cle de rapprochement du polling entrant
-- (`AdapterMts1.findTourneeByOrderId`, `.maybeSingle()`) : deux tournees portant
-- la meme reference faisaient remonter PGRST116, l'ordre passait pour « sans
-- tournee Savr » et `markInboxDone(traite=true)` consommait la cle d'idempotence
-- DEFINITIVEMENT (pesees, statuts, agregation terminale perdus, sans retry ni
-- alerte). L'adapter lit desormais cette `error` — l'index, lui, rend la
-- collision impossible plutot que seulement bruyante, et sert d'index de lecture
-- au poll (qui faisait jusqu'ici un parcours complet de `tournees`).
--
-- L'AUTRE invariant du cloisonnement — « 1 prestataire = au plus 1 transporteur,
-- donc 1 seul type_tms » — est pose par `20260915170000_plateforme_transporteurs
-- _presta_unique` (#323), livre en parallele. Il n'est pas redonne ici : deux
-- migrations creant le meme objet finissent toujours par diverger.
--
-- NATURE DE LA MIGRATION
-- Fermante et non destructive : aucun DROP, aucun RENAME, aucun backfill, aucune
-- ouverture d'acces (ni GRANT, ni policy, ni SECURITY DEFINER, ni RLS touchee).
-- Elle ne peut echouer que si des doublons existent deja.
--
-- CONTROLE DES DONNEES AVANT POSE (2026-09-15, lecture seule forcee
-- `default_transaction_read_only = on`)
--   dev  (savr-dev)  : 202 tournees, 202 references, 202 distinctes -> 0 doublon
--   prod (savr-prod) : `tournees` vide (0 ligne)
-- =============================================================================

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
