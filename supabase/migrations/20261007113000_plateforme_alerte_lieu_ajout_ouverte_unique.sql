-- =============================================================================
-- Demande d'ajout d'un lieu : UNE demande OUVERTE par organisation
-- =============================================================================
-- Liste Lieux du gestionnaire de lieux (§06.05 §3 « Ajout / retrait lieu »,
-- arbitrages Val 2026-10-07, divergence M3.2_20261007_demande-ajout-lieu). Le
-- gestionnaire ne rattache pas un lieu lui-même : le bouton « Demander l'ajout
-- d'un lieu » ouvre une alerte in-app pour l'Admin (`alertes_admin`, code
-- `lieu_ajout_demande`). Aucun lieu n'existant encore, l'alerte est rattachée à
-- l'organisation qui demande (entity_type `organisations`).
--
-- La route (POST /api/v1/gestionnaire/lieux/demande-ajout) lit s'il existe déjà
-- une demande ouverte puis insère. Cette lecture n'est pas verrouillée : N
-- envois au même instant la franchissent tous et ouvriraient N alertes dans la
-- file Admin, à résoudre une par une. L'index ci-dessous porte la règle en
-- base : au plus une alerte OUVERTE de ce code par organisation. Le second
-- insert concurrent échoue en 23505, que la route rend « demande déjà en
-- cours » (409). Une fois l'alerte résolue par l'Admin, une nouvelle demande en
-- ouvre une nouvelle : l'historique des alertes résolues est conservé.
--
-- Même patron que `uniq_alerte_lieu_modification_ouverte` (20261006231500) et
-- `uniq_alerte_coordonnees_urgence_ouverte` (20260930170000).
--
-- Portée : un index unique partiel, rien d'autre. Aucune donnée touchée (le code
-- `lieu_ajout_demande` est nouveau : aucune ligne ne le porte), aucun accès
-- ouvert ni modifié — `alertes_admin` reste lisible et inscriptible par le seul
-- admin_savr (policy `aa_admin`) et par service_role.
--
-- Retour arrière : retirer l'index `uniq_alerte_lieu_ajout_ouverte`. La route
-- retombe alors sur sa seule lecture préalable (doublons possibles en cas
-- d'envois simultanés, aucune demande perdue).
-- =============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_alerte_lieu_ajout_ouverte
  ON plateforme.alertes_admin (entity_id)
  WHERE code = 'lieu_ajout_demande' AND statut = 'ouverte';

COMMIT;
