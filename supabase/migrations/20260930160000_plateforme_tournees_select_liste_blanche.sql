-- =============================================================================
-- tournees : SELECT en liste blanche colonne-level (arbitrage Val « C5 », suite #435)
-- =============================================================================
-- Fuite mesurée (reviewer-rls-securite, 2026-09-29, rôle authenticated + claims
-- gestionnaire_lieux) : `authenticated` porte le SELECT TABLE-LEVEL sur
-- plateforme.tournees (blanket grant 0.4a, 20260611180000 l.27). La policy
-- `t_select` (0.4b, §09 §3 B-5) ouvre donc TOUTES les colonnes d'une tournée à tout
-- rôle client qui voit l'une de ses collectes (f_collecte_visible), par PostgREST
-- direct et quel que soit le statut : un gestionnaire lit `chauffeur_telephone` et
-- `prestataire_logistique_id` de la tournée d'un traiteur tiers servant son lieu.
--
-- La route de la fiche client (#435, lib/collectes/fiche-client.ts) ne sert les
-- camions qu'en statut programmee / validee / en_cours (§06.04 bloc « Logistique ») ;
-- le privilège colonne ne sait pas exprimer une condition de statut, ni distinguer
-- les rôles métier (tous portent le rôle PG `authenticated`). Ce qui est conditionné
-- par le CDC passe donc par la route (service_role), jamais par le privilège.
--
-- La RLS filtre les LIGNES, jamais les colonnes. Même pattern que organisations
-- (20260918100000) et lieux (20260617170000) : on retire le privilège TABLE-LEVEL
-- puis on re-GRANT une liste blanche. Un REVOKE colonne seul serait INOPÉRANT tant
-- que le privilège table subsiste. Fail-closed : une colonne ajoutée demain n'est pas
-- lisible par authenticated (aucun ALTER DEFAULT PRIVILEGES ne vise authenticated sur
-- `plateforme` — mesuré pg_default_acl : seul service_role y figure). La liste est
-- épinglée à l'identique par SECU__tournees_select_liste_blanche.test.sql.
--
-- LISTE BLANCHE (§09 §3 « un traiteur voit les tournées de ses collectes » → la ligne
-- reste lisible : QUAND et OÙ EN EST la tournée) :
--   id, reference_interne, date_tournee, creneau, heure_debut_prevue,
--   heure_fin_prevue, heure_debut_reelle, heure_fin_reelle, type_vehicule, statut,
--   created_at, updated_at.
--   (type_vehicule : « Sans objet (vélo cargo) » est affiché au client, §06.04.)
--
-- COLONNES RETIRÉES à authenticated (lues en service_role uniquement) :
--   - QUI — chauffeur_nom, chauffeur_telephone, accompagnant_nom,
--     accompagnant_telephone, plaque_immatriculation, plaque_saisie_at.
--     §06.04 : nom / plaque / téléphone affichés au client SEULEMENT en statut
--     programmee / validee / en_cours (« invisible pour les collectes réalisées ») ;
--     RGPD §06.04 : téléphone d'un salarié du transporteur exposé sur la base de
--     l'intérêt légitime (coordination sur place) → borné à cette fenêtre.
--     Accompagnant : saisie Admin uniquement (§04), jamais affiché au client.
--   - CHEZ QUI — prestataire_logistique_id, tms_reference, external_ref_commande.
--     §06.04 : « aucun libellé client ne mentionne le transporteur ni un
--     prestataire » ; références de commande / tour du provider = données d'adapter
--     (Frontière TMS-Ready garde-fou 5).
--   - notes_internes : commentaire Savr interne (convention §04 « notes internes »
--     jamais visibles du client ; arbitrage C1 #435).
--
-- LECTEURS RECENSÉS (grep packages/ + vues + fonctions + policies, 2026-09-30) :
--   - Aucun lecteur authenticated. Routes admin (admin/collectes, admin/collectes/
--     [id], infos-acces), fiche client (fiche-client.ts), urgence
--     (coordonnees-urgence.ts), webhook du transporteur vélo, batch PDF J+1,
--     packages/adapters : tous en service_role (privilèges intacts).
--   - Aucune vue (security_invoker ou non) ne lit tournees.
--   - Policies d'autres tables : aucune ne référence tournees.
--   - Fonctions lisant tournees en SECURITY INVOKER : fn_accepter_mission_everest_
--     manuelle et fn_collecte_commandee_chez_provider (EXECUTE service_role seul) ;
--     fn_cloturer_alerte_coordonnees_urgence (trigger — traité au §2).
--
-- EFFET DE BORD ASSUMÉ : admin_savr / ops_savr portent eux aussi le rôle PG
-- `authenticated`. Par PostgREST direct avec leur JWT, les 10 colonnes retirées leur
-- sont fermées (42501) — même conséquence que organisations.notes_internes (#360).
-- Le back-office lit tournees exclusivement en service_role (requireStaff +
-- createAdminSupabaseClient) : aucun écran impacté.
--
-- NON DESTRUCTIF : aucune donnée touchée, aucune colonne supprimée ou renommée.
-- FERME un accès (CLAUDE.md §12-2bis) — GO reviewer-rls-securite + pgTAP de preuve.
-- =============================================================================

-- ─── 1. SELECT : table-level retiré, liste blanche colonne-level ─────────────
REVOKE SELECT ON plateforme.tournees FROM authenticated;

GRANT SELECT (
  id,
  reference_interne,
  date_tournee,
  creneau,
  heure_debut_prevue,
  heure_fin_prevue,
  heure_debut_reelle,
  heure_fin_reelle,
  type_vehicule,
  statut,
  created_at,
  updated_at
) ON plateforme.tournees TO authenticated;

-- ─── 2. Trigger de clôture de l'alerte urgence : lecture hors privilège appelant ─
-- fn_cloturer_alerte_coordonnees_urgence (20260929160000) relit chauffeur_nom,
-- chauffeur_telephone, plaque_immatriculation, type_vehicule des camions de la
-- collecte. En SECURITY INVOKER, elle s'exécute avec les privilèges de l'ÉCRIVAIN :
-- après le §1, une écriture de tournees / collecte_tournees par admin_savr sous son
-- JWT (policies t_admin FOR ALL, ct_admin_update — §09 : admin_savr ALL) lèverait
-- 42501 et ferait échouer toute l'écriture (mesuré : coordonnees_urgence_alerte c6).
-- SECURITY DEFINER lui rend la lecture sans rien ouvrir : seuls ceux qui peuvent
-- déjà écrire ces deux tables (admin_savr, service_role) la déclenchent, elle ne
-- rend aucune donnée (RETURN NULL) et n'écrit que la clôture des alertes
-- `coordonnees_chauffeur_urgence` des collectes touchées. search_path déjà épinglé
-- (plateforme, pg_catalog) et conservé par ALTER FUNCTION ; EXECUTE re-fermé
-- ci-dessous (un trigger ne vérifie pas EXECUTE au déclenchement).
ALTER FUNCTION plateforme.fn_cloturer_alerte_coordonnees_urgence() SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION plateforme.fn_cloturer_alerte_coordonnees_urgence()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plateforme.fn_cloturer_alerte_coordonnees_urgence() IS
  'Trigger (tournees, collecte_tournees) : clôt l''alerte coordonnees_chauffeur_urgence quand tous les camions de la collecte ont nom + téléphone (+ plaque hors vélo cargo). SECURITY DEFINER depuis 20260930160000 : les colonnes chauffeur sont hors GRANT SELECT authenticated, une écriture admin_savr sous JWT lèverait 42501 en INVOKER. ⚠ Toute redéfinition (CREATE OR REPLACE) doit redéclarer SECURITY DEFINER et SET search_path = plateforme, pg_catalog — sinon retour silencieux à INVOKER (épinglé par SECU__tournees_select_liste_blanche, assertions 5 et 29).';

COMMENT ON COLUMN plateforme.tournees.chauffeur_telephone IS
  'Téléphone du chauffeur. Saisie Admin en V1 (MTS-1 ne l''expose pas). Hors GRANT SELECT authenticated depuis 20260930160000 : servi au client par la route de la fiche collecte (service_role) en statut programmee / validee / en_cours seulement (§06.04).';

COMMENT ON COLUMN plateforme.tournees.prestataire_logistique_id IS
  'Prestataire logistique de la tournée (FK shared.prestataires). Hors GRANT SELECT authenticated depuis 20260930160000 : aucun client ne voit le transporteur (§06.04, marque blanche).';

-- ROLLBACK (rouvre des accès : décision explicite de Val, CLAUDE.md §12-2bis) :
--   ALTER FUNCTION plateforme.fn_cloturer_alerte_coordonnees_urgence() SECURITY INVOKER;
--   GRANT SELECT ON plateforme.tournees TO authenticated;
--   (le grant colonne-level des 12 colonnes devient alors redondant : le retirer est
--   optionnel et purement cosmétique.)
