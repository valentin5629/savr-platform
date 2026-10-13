-- =============================================================================
-- Invariant DB : 1 reference de tournee prestataire = AU PLUS 1 ligne `tournees`
-- =============================================================================
-- POURQUOI
-- `tournees.tms_reference` porte l'identifiant de la tournee chez le prestataire
-- (le tourId du TMS externe en V1). Une ligne = un camion = sa tournee : c'est
-- par cette colonne que la releve lit les pesees et le statut d'un tour.
--
-- La reprise d'un envoi (`reconcileTour`, PR #563) refuse de reprendre une
-- tournee qu'une ligne `tournees` porte deja. Ce refus est une LECTURE suivie
-- d'une ECRITURE : deux passages simultanes sur deux collectes peuvent lire
-- « aucune ligne » tous les deux, puis ecrire la meme reference (lu dans le
-- code, non mesure ; que le TMS externe place les commandes de deux collectes
-- sur une meme tournee n'est pas mesure non plus). La tournee serait alors
-- envoyee et validee deux fois, et la releve lirait ses pesees sous les deux
-- lignes.
--
-- L'index rend la seconde ecriture impossible : elle echoue (23505). L'adapter
-- lit deja l'erreur de cette ecriture et leve une erreur ambigue ; a la reprise,
-- la lecture voit la ligne de l'autre collecte et le rang cree sa propre
-- tournee.
--
-- CE QUE L'INDEX CHANGE
-- Le code de l'adapter ne change pas. La donnee, si : deux lignes ne peuvent
-- plus porter la meme reference, y compris par un geste manuel. La ou deux
-- lignes l'auraient portee sans bruit, la seconde ecriture est refusee.
-- L'index compare les references a l'identique : une casse ou un blanc de
-- difference lui echappent (l'adapter n'adopte ni blanc ni chaine vide).
--
-- NATURE DE LA MIGRATION
-- Fermante et non destructive : aucune suppression, aucun renommage, aucune
-- reprise de donnees, aucune ouverture d'acces (ni GRANT, ni policy, ni
-- SECURITY DEFINER, ni RLS touchee). Elle echoue si des doublons existent deja
-- (rien n'est alors pose) ; elle peut attendre un verrou derriere une ecriture
-- en cours sur la table.
-- Retour arriere, sans effet sur les donnees (a faire valider par Val : c'est
-- un retrait) :
--   DROP INDEX IF EXISTS plateforme.uniq_tournee_par_tms_reference;
--
-- CONTROLE DES DONNEES AVANT POSE (2026-10-13, lecture seule forcee
-- `default_transaction_read_only = on`)
--   dev  (savr-dev)  : 238 tournees, 234 references, 234 distinctes, aucune
--                      chaine vide -> 0 doublon
--   prod (savr-prod) : `tournees` vide (0 ligne)
--
-- QUI ECRIT LA COLONNE (recense le meme jour)
--   - l'adapter du TMS externe, a la creation ou a la reprise d'une tournee ;
--   - `fn_dispatcher_collecte`, qui la remet a NULL quand un rang refuse est
--     reattribue ;
--   - les jeux de donnees de dev, une valeur par tournee ;
--   - un developpeur, a la main, quand le runbook d'incident fait aligner la
--     ligne d'un rang apres un resolve manuel (RUNBOOK_INCIDENT.md).
-- L'adapter du velo cargo n'y ecrit pas : il pose `external_ref_commande` sur
-- la tournee et `tms_reference` sur la COLLECTE.
--
-- DDL CIBLE V2 (garde-fou 1)
-- La cible porte la colonne sans unicite. Cet index est une divergence V1
-- tracee par une fiche `_Divergences/` (meme cas que
-- `uniq_tournee_par_external_ref`, porte dans la cible le 2026-09-16).
-- =============================================================================

-- PARTIEL : une tournee dont le tour n'est pas encore cree chez le prestataire
-- n'a pas de reference (NULL), et ces NULL restent multiples.
--
-- GLOBAL, tous prestataires confondus, comme `uniq_tournee_par_external_ref` :
-- c'est l'espace dans lequel la reprise cherche (`tms_reference = <tourId>`,
-- sans filtre de prestataire).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tournee_par_tms_reference
  ON plateforme.tournees (tms_reference)
  WHERE tms_reference IS NOT NULL;

COMMENT ON INDEX plateforme.uniq_tournee_par_tms_reference IS
  'Une reference de tournee prestataire (tourId du TMS externe en V1) designe AU PLUS '
  'une ligne tournees. Ferme la course entre deux reprises simultanees qui liraient '
  'toutes deux « aucune ligne ne porte cette tournee » avant d''ecrire la meme reference.';
