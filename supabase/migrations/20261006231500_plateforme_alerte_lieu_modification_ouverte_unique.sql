-- =============================================================================
-- Demande de modification d'un lieu : UNE demande OUVERTE par lieu
-- =============================================================================
-- Fiche lieu du gestionnaire de lieux (§06.05 §3, arbitrage Val 2026-10-06,
-- divergence M3.2_20261006_fiche-lieu-modale-demande-modification). Le
-- gestionnaire ne modifie pas le référentiel lieux : le bouton « Demande de
-- modification d'information » ouvre une alerte in-app pour l'Admin
-- (`alertes_admin`, code `lieu_modification_demandee`, entity_type `lieux`).
--
-- La route (POST /api/v1/gestionnaire/lieux/[id]/demande-modification) lit s'il
-- existe déjà une demande ouverte puis insère. Cette lecture n'est pas
-- verrouillée : N envois au même instant la franchissaient tous et ouvraient N
-- alertes dans la file Admin (relevé par les revues du lot). L'index ci-dessous
-- porte la règle en base : au plus une alerte OUVERTE de ce code par lieu. Le
-- second insert concurrent échoue en 23505, que la route rend « demande déjà en
-- cours » (409). Une fois l'alerte résolue par l'Admin, une nouvelle demande en
-- ouvre une nouvelle : l'historique des alertes résolues est conservé.
--
-- Même patron que `uniq_alerte_coordonnees_urgence_ouverte` (20260930170000).
--
-- Portée : un index unique partiel, rien d'autre. Aucune donnée touchée (le code
-- `lieu_modification_demandee` est nouveau : aucune ligne ne le porte), aucun
-- accès ouvert ni modifié — `alertes_admin` reste lisible et inscriptible par le
-- seul admin_savr (policy `aa_admin`) et par service_role.
--
-- Retour arrière : retirer l'index `uniq_alerte_lieu_modification_ouverte`. La
-- route retombe alors sur sa seule lecture préalable (doublons possibles en cas
-- d'envois simultanés, aucune demande perdue).
-- =============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_alerte_lieu_modification_ouverte
  ON plateforme.alertes_admin (entity_id)
  WHERE code = 'lieu_modification_demandee' AND statut = 'ouverte';

COMMIT;
