-- =============================================================================
-- Demande urgente des coordonnées du chauffeur : UNE demande OUVERTE à la fois
-- =============================================================================
-- Suite de 20260929160000. Arbitrage Val 2026-09-30 (divergence
-- M3.1_20260929_popup-client-implementation, D10) : l'unicité « 1 demande par
-- collecte, tous statuts » laissait une nouvelle demande du client sans effet
-- une fois l'alerte clôturée (coordonnées remises à NULL par une réattribution,
-- ou clôture manuelle par Ops) : la route répondait « Demande envoyée » sans
-- qu'aucune alerte ne s'ouvre. Désormais l'unicité ne porte que sur les
-- alertes OUVERTES : tant qu'une demande attend, un nouveau clic reste
-- idempotent (violation d'unicité = « déjà demandée ») ; après clôture, une
-- nouvelle demande ouvre une nouvelle alerte, et l'historique des alertes
-- clôturées est conservé.
--
-- Remplacement d'index dans la même transaction : aucune donnée n'est touchée
-- (alertes_admin garde toutes ses lignes). Les lignes existantes respectent la
-- nouvelle contrainte, plus large que l'ancienne (au plus une ligne par
-- collecte, a fortiori au plus une ouverte). Aucun accès ouvert : pas de GRANT,
-- pas de policy, fonction et triggers de 20260929160000 inchangés (la clôture
-- automatique ne vise déjà que statut = 'ouverte').
--
-- ROLLBACK : recréer uniq_alerte_coordonnees_urgence_par_collecte (définition de
-- 20260929160000) puis retirer uniq_alerte_coordonnees_urgence_ouverte. L'ancien
-- index porte sur TOUS les statuts : le retour échoue dès qu'une collecte a
-- entre-temps plus d'une alerte de ce code (deux clôturées suffisent). Clôturer
-- ne débloque rien : seule la suppression des alertes en surplus (les plus
-- anciennes) le permet.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS plateforme.uniq_alerte_coordonnees_urgence_par_collecte;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_alerte_coordonnees_urgence_ouverte
  ON plateforme.alertes_admin (entity_id)
  WHERE code = 'coordonnees_chauffeur_urgence' AND statut = 'ouverte';

COMMIT;
