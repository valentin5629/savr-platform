-- =============================================================================
-- plateforme.lieux — 4e branche SELECT « traiteur opérationnel »
-- §09 Authentification et permissions (l.192-193) — arbitrage Val 2026-09-21
-- =============================================================================
-- SYMPTÔME CORRIGÉ : un traiteur qui OPÈRE une collecte programmée par un tiers
-- (agence, gestionnaire de lieux) lit bien l'événement (evt_manager_select /
-- evt_commercial_select portent déjà `traiteur_operationnel_organisation_id`),
-- mais PAS le lieu : `lieux_clients_select` n'avait aucune branche symétrique.
-- Conséquences observées : ligne « Lieu » à « — » sur la fiche et la liste
-- Collectes (§06.04), et lieu absent des options du filtre Lieu
-- (api/v1/traiteur/collectes/filtres) — échec de lecture RLS silencieux.
-- Divergence source : _Divergences/_traités/2026-09/
--   M3.1_20260921_filtre_lieu_collectes_tierces.md
--
-- ⚠ ÉLARGISSEMENT D'ACCÈS au sens CLAUDE.md §12-2bis.
--   Preuve d'étendue : supabase/tests/lieux_traiteur_operationnel.test.sql
--   (sous `authenticated` + claims JWT simulés — service_role bypasse la RLS).
--
-- RÉÉCRITURE À L'IDENTIQUE DES 3 BRANCHES DÉJÀ DÉPLOYÉES.
--   Ajouter une branche impose de recréer la policy entière. Le texte ci-dessous
--   est repris MOT POUR MOT de 20260617180000_plateforme_fix_role_claim.sql
--   (dernière définition en base), et NON du tableau du CDC §09 : ce tableau
--   documente la branche « client organisateur » SANS sa garde
--   `AND date_evenement IS NOT NULL`, qui existe pourtant en base. Recopier le
--   CDC aurait supprimé cette garde en silence = élargissement non voulu d'un
--   accès déjà livré. Correction du CDC demandée dans
--   _Divergences/SECU-RLS_20260921_lieux_branche_client_organisateur_garde_date.md
--
-- ARBITRAGES VAL 2026-09-21 sur le bornage de la 4e branche
-- (_Divergences/SECU-RLS_20260921_lieux_branche_traiteur_operationnel_bornage.md) :
--
--   Q1 — PAS de garde `date_evenement IS NOT NULL` sur cette branche.
--     Motifs mesurés : (a) `evt_manager_select` / `evt_commercial_select`
--     donnent DÉJÀ la ligne `evenements` au traiteur opérationnel sans garde de
--     date — poser la garde ici ne masquerait que le LIEU d'un événement qu'il
--     lit par ailleurs, sans gain de confidentialité ; (b) le trigger
--     `fn_set_date_evenement` calcule
--     `date_evenement = MIN(date_collecte) WHERE statut != 'annulee'`, donc
--     `date_evenement IS NULL` inclut « toutes les collectes annulées » : la
--     garde ferait RÉAPPARAÎTRE le « — » sur les collectes annulées, soit
--     exactement le défaut corrigé ici. L'asymétrie avec la branche « client
--     organisateur » est donc VOULUE : la garde de date y protège contre la
--     fuite d'intention commerciale d'un tiers qui observe par le lieu (§09
--     l.191), alors que le traiteur opérationnel est une partie DÉSIGNÉE sur
--     l'événement, pas un voisin de lieu.
--
--   Q2 — garde de rôle EXPLICITE, alignée sur les policies voisines de
--     `evenements`. Sans elle, la branche vivrait sous la seule garde large
--     `f_app_role() <> ALL (admin_savr, ops_savr)`, donc s'appliquerait à tous
--     les rôles non-admin, l'étendue ne tenant plus qu'à la donnée (qui peut
--     être désigné traiteur opérationnel). La garde rend l'étendue lisible dans
--     la policy elle-même.
--
-- ÉTENDUE RÉELLE (mesurée, pas supposée) : c'est le PRÉDICAT ci-dessous qui borne,
--   à lui seul — « les lieux des événements que j'opère », rien d'autre. Deux
--   précisions vérifiées en revue, qui comptent pour l'avenir :
--   (a) la RLS de la table interne s'applique bien dans le sous-SELECT d'une
--       policy, mais ici elle ne change RIEN : `evt_manager_select` /
--       `evt_commercial_select` valent `organisation_id = self OR
--       traiteur_operationnel = self`, et leur intersection avec le prédicat
--       ci-dessous redonne le prédicat. Ne pas s'appuyer sur cette RLS imbriquée
--       comme si elle resserrait quoi que ce soit — elle ne porte rien ici.
--   (b) corollaire rassurant : si `evt_*_select` s'élargissait un jour, cette
--       branche ne s'élargirait PAS avec — elle reste ancrée sur
--       `traiteur_operationnel_organisation_id`.
--   Écriture de ce champ : `authenticated` n'a aucun droit d'écriture sur
--   `plateforme.evenements` (vérifié : ni table ni colonne) ; la seule voie est
--   une route serveur, où il est forcé à l'organisation appelante pour un rôle
--   traiteur et verrouillé en édition. Un traiteur ne peut donc pas se désigner
--   opérateur sur l'événement d'un tiers pour s'ouvrir un lieu.
--
-- Backward-compatible : aucune branche retirée, aucun accès restreint.
-- =============================================================================

DROP POLICY IF EXISTS lieux_clients_select ON plateforme.lieux;
CREATE POLICY lieux_clients_select ON plateforme.lieux AS PERMISSIVE FOR SELECT TO public
  USING (
    ((plateforme.f_app_role()) <> ALL (ARRAY['admin_savr'::text, 'ops_savr'::text]))
    AND (
      -- Branche 1 (inchangée) — lieu rattaché à mon organisation.
      (id IN ( SELECT organisations_lieux.lieu_id
                 FROM plateforme.organisations_lieux
                WHERE (organisations_lieux.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))
      -- Branche 2 (inchangée) — lieu d'un événement que mon organisation a programmé.
      OR (id IN ( SELECT evenements.lieu_id
                    FROM plateforme.evenements
                   WHERE (evenements.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))
      -- Branche 3 (inchangée, GARDE DE DATE CONSERVÉE) — lieu d'un événement où mon
      -- organisation est client organisateur, événement DATÉ seulement.
      OR (id IN ( SELECT evenements.lieu_id
                    FROM plateforme.evenements
                   WHERE ((evenements.client_organisateur_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)
                     AND (evenements.date_evenement IS NOT NULL))))
      -- Branche 4 (NOUVELLE) — lieu d'un événement que mon organisation OPÈRE.
      -- Gardée par le rôle (Q2), sans garde de date (Q1).
      OR (((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'traiteur_commercial'::text]))
          AND (id IN ( SELECT evenements.lieu_id
                         FROM plateforme.evenements
                        WHERE (evenements.traiteur_operationnel_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))))
    )
  );

COMMENT ON POLICY lieux_clients_select ON plateforme.lieux IS
  'SELECT lieux, rôles clients (non admin/ops). 4 branches : (1) lieu rattaché à mon organisation ; (2) lieu d''un événement que mon organisation a programmé ; (3) lieu d''un événement où mon organisation est client organisateur, événement DATÉ seulement (anti-fuite d''intention commerciale, §09 l.191) ; (4) lieu d''un événement que mon organisation OPÈRE (traiteur_operationnel), rôles traiteur seulement, sans garde de date (arbitrage Val 2026-09-21).';
