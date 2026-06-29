-- REVIEWED-DESTRUCTIVE: DROP COLUMN de 11 colonnes LEGACY (tarifs_packs_ag x5, packs_antgaspi x6) +
-- DROP du trigger zombie fn_trg_pack_recredite_annulation_collecte. Convergence V1 ⊆ DDL cible :
-- toutes ces colonnes sont REDONDANTES (valeur portée par la colonne convergée : nb_collectes→credits,
-- prix_ht→prix_unitaire_ht, nb_utilisees→credits_consommes…) OU orphelines (0 lecteur après l'align M2.1b).
-- Aucune donnée métier perdue. 3 reviewers GO (data-model + rls + conformité §04). Cf. corps ci-dessous.
-- Convergence V1 ⊆ DDL cible — purge des colonnes LEGACY de la facturation packs AG
-- ============================================================================
-- Dette R8 (CLAUDE.md §4 « dettes purgées en fin de session »). Le schéma bloc5
-- (20260611171639) a été CONVERGÉ par l'align M2.1b (20260615200000) qui a AJOUTÉ
-- les colonnes cibles sans DROPPER les legacy. Autorité = CDC §04 Data Model :
-- toute colonne ABSENTE du §04 est un résidu legacy → droppée ici (restaure
-- V1 ⊆ cible, retire 11 divergences du gate schema-vs-cible).
--
-- Mapping legacy → convergé (confirmé align M2.1b + CDC §04) :
--   tarifs_packs_ag : nb_collectes→credits, prix_ht→prix_unitaire_ht,
--                     valide_jusqu→valide_jusqu_au, actif/commentaire = sans
--                     équivalent (activité portée par le versioning valide_jusqu_au).
--   packs_antgaspi  : nb_collectes→credits_initiaux, nb_utilisees→credits_consommes,
--                     notes→commentaires, facture_pack_id→facture_achat_id,
--                     nb_annulees/tarif_pack_id = sans équivalent (tarif_pack_id
--                     FK legacy déjà rendue nullable #116 ; credits_restants est
--                     déjà GENERATED depuis credits_initiaux-credits_consommes,
--                     plus aucune dépendance aux colonnes droppées).
--
-- KEPT (champs réels §04, NON droppés) : date_achat, date_expiration, commentaires,
-- facture_achat_id, prix_unitaire_ht, idempotency_key, cree_par_user_id.
--
-- Non destructif sur la donnée métier : ces colonnes sont REDONDANTES (leur valeur
-- vit dans la colonne convergée) ou orphelines (0 lecteur : ni vue, ni trigger, ni
-- generated, ni code). DROP COLUMN auto-supprime les CHECK mono-colonne et la FK
-- facture_pack_id qui les référencent. Idempotent (IF EXISTS).
-- ============================================================================

-- Trigger zombie legacy : fn_trg_pack_recredite_annulation_collecte (bloc
-- 20260613200000) fait `SET nb_utilisees = nb_utilisees - 1` sur AFTER UPDATE OF
-- statut. Jamais droppé, alors qu'il est SUPERSÉDÉ par fn_trg_pack_recredit
-- (M2.1b 20260615200100, BEFORE UPDATE, recrédit via credits_consommes avec
-- GREATEST). Sans ce DROP, toute annulation AG realisee→annulee crasherait au
-- runtime (corps PL/pgSQL référençant nb_utilisees droppée). Le recrédit réel
-- reste assuré par trg_pack_recredit.
DROP TRIGGER IF EXISTS trg_pack_recredite_annulation_collecte ON plateforme.collectes;
DROP FUNCTION IF EXISTS plateforme.fn_trg_pack_recredite_annulation_collecte();

-- tarifs_packs_ag — 5 colonnes legacy
ALTER TABLE plateforme.tarifs_packs_ag
  DROP COLUMN IF EXISTS nb_collectes,
  DROP COLUMN IF EXISTS prix_ht,
  DROP COLUMN IF EXISTS valide_jusqu,
  DROP COLUMN IF EXISTS actif,
  DROP COLUMN IF EXISTS commentaire;

-- packs_antgaspi — 6 colonnes legacy (FK facture_pack_id + CHECK auto-droppés)
ALTER TABLE plateforme.packs_antgaspi
  DROP COLUMN IF EXISTS tarif_pack_id,
  DROP COLUMN IF EXISTS nb_collectes,
  DROP COLUMN IF EXISTS nb_utilisees,
  DROP COLUMN IF EXISTS nb_annulees,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS facture_pack_id;
