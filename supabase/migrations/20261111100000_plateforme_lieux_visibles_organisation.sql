-- =============================================================================
-- plateforme.f_lieux_visibles_organisation — les lieux qu'une organisation voit
-- §06.01 Formulaire de programmation, champ « Lieu » (« Liste filtrée selon RLS »)
-- =============================================================================
-- SYMPTÔME CORRIGÉ. Quand l'Admin programme une collecte POUR un client
-- (GET /api/v1/programmation/lieux?organisation_id=…), la route relisait par
-- l'API de données tous les événements de l'organisation, puis redemandait tous
-- ses lieux par un seul filtre `in.(…)`. Deux plafonds de cette API, mesurés sur
-- savr-dev le 2026-10-09 (packages/plateforme/src/lib/pdf/selection-par-pages.ts) :
--   - une réponse est amputée à 1 000 lignes, sans erreur : au-delà de 1 000
--     événements, des lieux manquaient dans les propositions ;
--   - un filtre de quelques centaines d'identifiants fait échouer la lecture
--     (390 passaient, 402 non) : la recherche répondait en erreur.
-- Lire par pages côté application aurait relu tout l'historique à chaque frappe.
-- La fonction rend l'ensemble côté base ; la route lui applique ensuite les
-- mêmes filtres que pour un client (lieu actif, terme saisi, tri par nom, 20
-- lignes).
--
-- CE QUE REND LA FONCTION : les lieux que verrait l'organisation cible. C'est la
-- transcription des branches de la policy `lieux_clients_select` qui ont un
-- effet pour les rôles qui programment — les mêmes branches que la route
-- calculait jusqu'ici en TypeScript :
--   branche 1 — lieu rattaché à l'organisation ;
--   branche 2 — lieu d'un événement que l'organisation a programmé ;
--   branche 4 — lieu d'un événement que l'organisation opère, pour une
--               organisation de type `traiteur` seulement.
-- La policy garde la branche 4 par le RÔLE de l'utilisateur. Ici la cible est une
-- organisation : la garde est portée par `organisations.type`. Approximation
-- assumée, inchangée : aucun CHECK ni trigger ne lie `users.role` à
-- `organisations.type`. Si elle était prise en défaut, l'effet serait une
-- proposition de trop ou de moins dans la liste de l'Admin, jamais une fuite
-- (l'Admin lit déjà tous les lieux).
-- La branche 3 « client organisateur » n'est pas transcrite : pour ces rôles,
-- tout lieu qu'elle atteint est déjà couvert par les branches 1, 2 ou 4.
-- ⚠ Le motif n'est PAS « elle ne rend rien » : sous la policy, la RLS de
-- `evenements` filtre aussi son sous-SELECT, et elle atteint bien un événement
-- pour un gestionnaire rattaché au lieu (mesuré : assert 23 du test de cette
-- fonction). La transcrire telle quelle, sans cette RLS, rendrait l'Admin PLUS
-- large que sa cible : un traiteur, une agence ou un gestionnaire verraient
-- proposés des lieux où ils ne sont que client organisateur (asserts 10, 12,
-- 14 et égalités 18 à 22).
-- Le filtre `actif` n'est pas ici : la policy ne le porte pas, c'est celui de
-- l'écran, posé par la route sur ses deux chemins.
--
-- ⚠ À TENIR ALIGNÉE SUR LA POLICY. Deux garde-fous :
--   - supabase/tests/lieux_clients_select_cliquet.test.sql rougit dès que le
--     prédicat de la policy change ;
--   - supabase/tests/programmation_lieux_visibles_organisation.test.sql compare
--     ce que rend la fonction à ce que lit chaque rôle sous `authenticated`.
--
-- ACCÈS : aucun accès ouvert ni élargi (CLAUDE.md §12, 2bis).
--   - SECURITY INVOKER : la fonction lit avec les droits de l'appelant, elle ne
--     contourne la RLS ni les droits de colonne de personne ;
--   - EXECUTE retiré à PUBLIC, anon et authenticated, donné à service_role seul
--     (`CREATE FUNCTION` le donne à PUBLIC par défaut, et le schéma est exposé
--     par l'API de données) ;
--   - elle ne donne au serveur rien qu'il ne lise déjà : la route lisait ces
--     quatre tables en service_role.
-- Solution présentée à Val avant écriture, accordée le 2026-11-11.
--
-- Rien d'autre n'est touché : ni table, ni colonne, ni policy, ni index (les
-- index sur evenements.organisation_id, evenements.traiteur_operationnel_organisation_id
-- et organisations_lieux.organisation_id existent déjà).
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.f_lieux_visibles_organisation(p_organisation_id uuid)
RETURNS SETOF plateforme.lieux
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = plateforme, pg_catalog
AS $$
  SELECT l.*
    FROM plateforme.lieux l
   WHERE
      -- Branche 1 — lieu rattaché à l'organisation.
      l.id IN (SELECT ol.lieu_id
                 FROM plateforme.organisations_lieux ol
                WHERE ol.organisation_id = p_organisation_id)
      -- Branche 2 — lieu d'un événement que l'organisation a programmé.
      OR l.id IN (SELECT e.lieu_id
                    FROM plateforme.evenements e
                   WHERE e.organisation_id = p_organisation_id)
      -- Branche 4 — lieu d'un événement que l'organisation opère, organisation
      -- de type traiteur seulement.
      OR (EXISTS (SELECT 1
                    FROM plateforme.organisations o
                   WHERE o.id = p_organisation_id
                     AND o.type = 'traiteur')
          AND l.id IN (SELECT e.lieu_id
                         FROM plateforme.evenements e
                        WHERE e.traiteur_operationnel_organisation_id = p_organisation_id));
$$;

COMMENT ON FUNCTION plateforme.f_lieux_visibles_organisation(uuid) IS
  'Lieux que verrait une organisation : rattachés, lieux des événements qu''elle a programmés, et lieux des événements qu''elle opère si elle est de type traiteur. Transcription des branches 1, 2 et 4 de la policy lieux_clients_select, à tenir alignée (cliquet lieux_clients_select_cliquet.test.sql). Ne filtre pas actif. Sert la recherche de lieux quand l''Admin programme pour un client (GET /api/v1/programmation/lieux). SECURITY INVOKER, service_role uniquement.';

REVOKE EXECUTE ON FUNCTION plateforme.f_lieux_visibles_organisation(uuid)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_lieux_visibles_organisation(uuid) TO service_role;
