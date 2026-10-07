-- =============================================================================
-- shared.fichiers : une photo de collecte n'est visible du client que si
-- l'équipe Savr l'a choisie (2 au maximum par collecte)
-- =============================================================================
-- Décisions de Val du 2026-10-07 (divergence
-- _Divergences/M0.6_20261007_photos-collecte-selection-admin.md) :
--   - le client ne voit que les photos choisies par l'équipe Savr dans la fiche
--     collecte ; sans choix, il n'en voit aucune ;
--   - 2 photos au maximum par collecte ;
--   - une photo non choisie est masquée au client jusque dans la base : « non
--     choisie » ne doit pas seulement vouloir dire « non affichée ».
--
-- AVANT ce lot (mesuré le 2026-10-07 sur savr-dev et savr-prod) : la policy
-- fichiers_select rendait à tout rôle client TOUTES les lignes
-- entity_type = 'plateforme.collectes' des collectes qu'il voit
-- (shared.f_fichier_visible → plateforme.f_collecte_visible), donc la fiche de
-- chaque photo remontée par le transporteur ou importée par l'Admin. Aucune
-- ligne de ce type n'existe encore (0 sur savr-dev, 0 sur savr-prod) : rien à
-- rattraper, aucune donnée à migrer.
--
-- CE QUE FAIT LA MIGRATION
--   1. Colonne `rang_client` (NULL par défaut). NULL = photo réservée à l'équipe
--      Savr. 1 ou 2 = photo choisie pour le client, à cette place.
--   2. La limite de 2 est portée par la structure, sans fonction ni trigger :
--      le CHECK n'admet que les rangs 1 et 2, et l'index unique partiel interdit
--      deux photos au même rang sur une même collecte. Deux sélections
--      concurrentes ne peuvent donc pas dépasser 2 (la seconde reçoit 23505).
--   3. Le CHECK réserve aussi `rang_client` aux fichiers de collecte : la colonne
--      n'a pas de sens pour un bordereau, un rapport ou un logo.
--      Une photo supprimée (deleted_at) garde son rang mais sort de l'index :
--      sa place est libre, et elle ne peut être restaurée que si son rang l'est
--      resté. Un futur code de suppression de photo devrait vider rang_client.
--   4. La policy de lecture devient PLUS RESTRICTIVE pour les rôles clients :
--      une ligne de collecte n'est rendue que si `rang_client` est renseigné.
--      Les autres entity_type ne changent pas. L'équipe Savr (f_is_staff) lit
--      toujours tout.
--
-- ACCÈS : la migration ferme une lecture. Aucun GRANT, aucune policy créée,
-- aucune fonction. Les écritures restent celles d'avant : service-role (routes
-- Admin, adapters logistiques) et admin_savr par la policy fichiers_admin_write.
-- Un rôle client ne peut pas poser `rang_client` (pgTAP :
-- SECU__fichiers_photos_selection_client.test.sql).
--
-- Compatibilité : colonne ajoutée nullable, sans valeur à calculer. Le code
-- déjà déployé n'écrit pas cette colonne et continue de fonctionner ; ses photos
-- naissent non choisies, ce qui est la règle voulue.
-- =============================================================================

ALTER TABLE shared.fichiers
  ADD COLUMN rang_client smallint;

COMMENT ON COLUMN shared.fichiers.rang_client IS
  'Photo de collecte choisie par l''équipe Savr pour le client : NULL = non choisie (réservée à l''équipe Savr), 1 ou 2 = choisie, à cette place. 2 photos au maximum par collecte (décision Val 2026-10-07). Sans objet hors entity_type = plateforme.collectes.';

ALTER TABLE shared.fichiers
  ADD CONSTRAINT fichiers_rang_client_check
  CHECK (
    rang_client IS NULL
    OR (rang_client IN (1, 2) AND entity_type = 'plateforme.collectes')
  );

CREATE UNIQUE INDEX uniq_fichiers_photo_client_rang
  ON shared.fichiers (entity_type, entity_id, rang_client)
  WHERE rang_client IS NOT NULL AND deleted_at IS NULL;

COMMENT ON INDEX shared.uniq_fichiers_photo_client_rang IS
  'Au plus une photo par rang (1, 2) et par collecte : c''est lui qui garantit « 2 photos visibles du client au maximum », y compris entre deux sélections simultanées.';

-- Lecture cliente resserrée. ALTER POLICY ne change que le prédicat : la policy
-- garde son nom, sa commande (SELECT) et ses rôles.
ALTER POLICY fichiers_select ON shared.fichiers
  USING (
    deleted_at IS NULL
    AND (
      plateforme.f_is_staff()
      OR (
        shared.f_fichier_visible(entity_type, entity_id)
        AND (entity_type <> 'plateforme.collectes' OR rang_client IS NOT NULL)
      )
    )
  );

-- RETOUR ARRIÈRE (rouvrirait aux clients les photos non choisies : décision
-- explicite de Val, CLAUDE.md §12-2bis). Redéployer D'ABORD le code précédent
-- (le code de ce lot lit et écrit rang_client), puis, dans cet ordre : remettre
-- le prédicat d'origine de fichiers_select (20260611180000, sans la condition sur
-- rang_client — la policy dépend de la colonne, elle doit être remise avant),
-- retirer l'index uniq_fichiers_photo_client_rang et la contrainte
-- fichiers_rang_client_check, puis retirer la colonne rang_client. Les choix déjà
-- faits par l'équipe Savr sont alors perdus.
