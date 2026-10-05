-- =============================================================================
-- attributions_antgaspi : le gestionnaire_lieux lit les données Anti-Gaspi des
-- collectes tenues sur SES lieux par une vue restreinte (5 colonnes)
-- =============================================================================
-- Constat (savr-dev, 2026-10-04, lecture seule, organisation Viparis SAS sous le
-- JWT réel de collab.viparis@savr-test.local) : 127 collectes AG clôturées sur
-- ses 10 lieux, 127 attributions en base toutes renseignées (10 425 repas),
-- 0 attribution lisible. La policy `aa_select` (décision C-1, §09) n'a que deux
-- branches — organisation programmatrice et traiteur opérationnel — et aucune
-- par le lieu : pour un gestionnaire, dont les événements viennent presque tous
-- de traiteurs tiers, « Repas donnés », le ratio repas/pax, la courbe
-- d'évolution, le top associations et le sous-bloc AG du détail événement
-- tombent à zéro sans erreur.
--
-- CDC §04 « Vue SQL : v_attributions_gestionnaire » (arbitrage Val 2026-09-21,
-- option b) : l'accès passe par une VUE en liste blanche, jamais par un
-- élargissement de `aa_select` — C-1 reste vraie au niveau de la table, et les
-- pgTAP T17/T18 (rls_0_4_smoke.test.sql) restent verts.
--
-- Colonnes exposées — rien d'autre : collecte_id, volume_repas_realise,
-- association_id, association_nom, association_ville. `association_id` sert au
-- calcul de distance du §06.05 §3 (associations.latitude/longitude, déjà lues
-- par tout authentifié via `asso_read`). Restent fermées : transporteur_id,
-- branche_attribution, confirmation_transporteur, mode_validation, valide_par,
-- valide_at, poids_repas_kg, motif_override, motif_override_libre.
--
-- Lignes — trois bornages cumulatifs, tous portés par le WHERE (la vue lit la
-- table avec les droits de son propriétaire, la RLS de l'appelant ne filtre
-- rien) :
--   1. rôle : f_app_role() = 'gestionnaire_lieux'. La vue est vide pour tout
--      autre rôle, y compris pour une organisation rattachée à un lieu ;
--   2. lieu : l'événement de la collecte porte un lieu_id rattaché à
--      l'organisation du JWT par organisations_lieux ;
--   3. événement daté : date_evenement IS NOT NULL — la même garde que
--      f_collecte_visible (anti-fuite brouillons tiers, B-2). Le §04 ne la
--      nomme pas ; sans elle la vue rendrait l'association d'un brouillon que
--      la table collectes cache au même gestionnaire (arbitrage Val 2026-10-04).
--
-- Points d'appel (lot de câblage, même PR) : les 6 routes
-- /api/v1/gestionnaire/* et, par branchement de rôle, les chargeurs partagés
-- des dashboards (évolution, blocs, synthèse PDF) et la fiche collecte.
--
-- NON DESTRUCTIF (aucune donnée, aucune colonne). OUVRE un accès en lecture
-- (§12-2bis) : SQL validé par Val avant écriture (2026-10-04). Preuve :
-- supabase/tests/SECU__v_attributions_gestionnaire.test.sql.
--
-- ORDRE DE DÉPLOIEMENT : cette migration doit être appliquée AVANT que le code
-- du lot soit en ligne (dev, puis prod). L'ancien code fonctionne avec la base
-- migrée — rien ne lit la vue avant ce lot. Le nouveau code EXIGE la vue : sans
-- elle, PostgREST refuse l'embed (PGRST200) ou la lecture directe (PGRST205).
-- Relevé dans le code, lecture par lecture : 9 des 11 lectures contrôlent
-- l'erreur de la requête — la route ou le chargeur répond en erreur,
-- l'affichage dépend de chaque page ; 2 ne la contrôlent pas et restent
-- muettes — « Mon pack AG » (historique de consommation vide) et la fiche
-- collecte (« — », sans repas ni association). Les autres rôles ne sont pas
-- touchés (les chargeurs partagés branchent par rôle).
-- APRÈS APPLICATION, mesurer sur la base : la vue existe, ses 5 colonnes, ACL
-- authenticated = SELECT seul, rien pour anon ; puis, sous le jeton d'un
-- gestionnaire, count(*) de la vue = nombre d'attributions des collectes de ses
-- lieux à événement daté, TOUS STATUTS (la vue ne filtre pas le statut). Mesuré
-- sur savr-dev pour Viparis le 2026-10-04 : 153 lignes, dont 127 sur collectes
-- clôturées — ces 127 portent les 10 425 repas du KPI du dashboard.
-- ROLLBACK : en fin de fichier.
-- =============================================================================

-- security_invoker = false : lit attributions_antgaspi avec les droits du
-- propriétaire (aa_select refuse ces lignes au gestionnaire). security_barrier :
-- un filtre fourni par l'appelant (PostgREST) n'est évalué qu'après ce WHERE.
-- auth.jwt() et f_app_role() lisent le JWT de l'appelant (setting de session,
-- inchangé par la vue).
CREATE OR REPLACE VIEW plateforme.v_attributions_gestionnaire
WITH (security_invoker = false, security_barrier = true)
AS
SELECT aa.collecte_id,
       aa.volume_repas_realise,
       aa.association_id,
       a.nom   AS association_nom,
       a.ville AS association_ville
  FROM plateforme.attributions_antgaspi aa
  JOIN plateforme.associations a ON a.id = aa.association_id
 WHERE plateforme.f_app_role() = 'gestionnaire_lieux'
   AND EXISTS (
         SELECT 1
           FROM plateforme.collectes c
           JOIN plateforme.evenements e ON e.id = c.evenement_id
           JOIN plateforme.organisations_lieux ol ON ol.lieu_id = e.lieu_id
          WHERE c.id = aa.collecte_id
            AND e.date_evenement IS NOT NULL
            AND ol.organisation_id = (auth.jwt()->>'organisation_id')::uuid
       );

-- SELECT seul, posé après un REVOKE ALL explicite (indépendant des privilèges par
-- défaut du schéma). Il n'existe pas de rôle Postgres `gestionnaire_lieux` : le
-- rôle métier est porté par le claim `user_role`, filtré dans le WHERE.
REVOKE ALL ON plateforme.v_attributions_gestionnaire FROM PUBLIC, anon, authenticated;
GRANT SELECT ON plateforme.v_attributions_gestionnaire TO authenticated;

COMMENT ON VIEW plateforme.v_attributions_gestionnaire IS
  'Données Anti-Gaspi lues par un gestionnaire_lieux sur les collectes de SES lieux, y compris quand l''événement est programmé par un traiteur tiers (§04, §06.05 §3). Seul chemin de lecture, pour ce rôle, des collectes programmées par un tiers : aa_select n''est jamais élargie (C-1, §09). Toute colonne ajoutée ici élargit l''accès : revue sécurité + pgTAP SECU__v_attributions_gestionnaire.';

-- ROLLBACK (ferme l'accès ouvert ici) :
--   DROP VIEW plateforme.v_attributions_gestionnaire;
-- À jouer APRÈS le retour arrière du code du lot : tant que le code lit la vue,
-- la retirer fait tomber en erreur les 11 lectures du gestionnaire.
