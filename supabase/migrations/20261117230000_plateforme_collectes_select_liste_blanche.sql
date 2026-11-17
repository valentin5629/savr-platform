-- =============================================================================
-- collectes : SELECT en liste blanche colonne-level (3 colonnes internes fermées)
-- =============================================================================
-- Constat (reviewer-rls-securite, 2026-09-22 ; re-mesuré le 2026-11-15 sur savr-dev
-- ET savr-prod en lecture seule) : `authenticated` porte le SELECT TABLE-LEVEL sur
-- plateforme.collectes (blanket grant 0.4a ; seule l'écriture a été retirée,
-- 20260915140000). La policy col_select / f_collecte_visible filtre les LIGNES,
-- jamais les colonnes : tout rôle client qui voit une collecte en lit donc les 46
-- colonnes par PostgREST direct, dont trois que l'équipe Savr écrit pour elle seule.
--
-- COLONNES RETIRÉES à authenticated (3 — lues en service_role uniquement) :
--   - notes_internes : « Commentaires libres Admin Savr » (§04). Val, 2026-10-01 :
--     lot séparé à livrer avant le go-live.
--   - motif_override_prestataire : motif saisi par l'Admin quand il retient un autre
--     prestataire que celui recommandé (§04, §06.06).
--   - aucun_repas_photo_url : photo du lieu « aucun repas », réservée à l'équipe
--     Savr (arbitrage Val C1, 2026-10-07 ; scénario 09
--     `photo_aucun_repas_lecture_equipe_savr_seule`).
--
-- Un privilège colonne ne distingue pas les rôles métier (tous portent le rôle PG
-- `authenticated`). Même mécanisme que evenements (20261001103000), tournees
-- (20260930160000), organisations (20260918100000) : retrait du privilège
-- TABLE-LEVEL, puis re-GRANT d'une liste blanche. Un REVOKE colonne seul serait
-- INOPÉRANT tant que le privilège table subsiste. Fail-closed : une colonne
-- ajoutée demain n'est pas lisible par authenticated (épinglé par le test). Ce
-- qui rouvrirait tout : un `GRANT SELECT ON plateforme.collectes` ou un
-- `GRANT … ON ALL TABLES IN SCHEMA plateforme TO authenticated`.
--
-- LISTE BLANCHE (43 colonnes) = toutes les autres, sans tri : ce lot ne ferme que
-- ce qui est tranché. Les candidates à une fermeture ultérieure (dirty_tms,
-- caps_appliques, co2_facteurs_snapshot, annulee_cote_savr_motif,
-- incident_imputable_a…) sont remontées à Val, pas décidées ici.
--
-- LECTEURS RECENSÉS (2026-11-17, origin/main 69babef3 ; catalogue de savr-dev) :
--   - Code : aucune lecture sous identité utilisateur ne nomme l'une des 3
--     colonnes, ni ne lit `*` sur collectes (direct ou par embed). Les seules
--     lectures `*` de la table sont en service_role (routes admin, et les trois
--     routes clientes de modification pour l'état « avant » de l'audit).
--   - Retour de fonction : fn_modifier_collecte rend `to_jsonb(ligne)` et les
--     routes PATCH traiteur / agence / gestionnaire le renvoyaient tel quel.
--     Réponse réduite dans le même lot (lib/collectes/champs-editables.ts).
--   - Policies d'autres tables (attestations_don, bordereaux_savr,
--     attributions_antgaspi, evenements) : ne lisent que id, evenement_id, statut.
--   - Vues security_invoker : v_kpi_traiteur, v_kpi_lieu,
--     v_kpi_client_organisateur ne lisent que des colonnes conservées ;
--     v_kpi_admin n'est pas accordée à authenticated ;
--     v_collectes_gestionnaire_lieux exposait aucun_repas_photo_url → corrigée
--     ci-dessous. v_registre_dechets et v_attributions_gestionnaire tournent avec
--     les droits de leur propriétaire.
--   - Fonctions SECURITY INVOKER qui lisent collectes ou se déclenchent sur
--     elle : aucune ne nomme une colonne retirée ni ne lit la ligne entière.
--
-- EFFET DE BORD ASSUMÉ : admin_savr / ops_savr portent eux aussi le rôle PG
-- `authenticated`. Par PostgREST direct avec leur JWT, les 3 colonnes leur sont
-- fermées (42501) — même conséquence que evenements, tournees et organisations.
-- Le back-office lit collectes exclusivement en service_role.
--
-- NON DESTRUCTIF : aucune donnée touchée, aucune colonne supprimée ou renommée.
-- FERME un accès (CLAUDE.md §12-2bis) — GO reviewer-rls-securite + pgTAP de preuve.
-- ORDRE DE DÉPLOIEMENT : indifférent. Le code d'avant ce lot ne lit aucune des 3
-- colonnes sous identité utilisateur ; il fonctionne donc contre une base migrée.
-- APRÈS APPLICATION, mesurer sur la base : has_table_privilege('authenticated',
-- 'plateforme.collectes', 'SELECT') = false et 43 colonnes lisibles.
-- =============================================================================

REVOKE SELECT ON plateforme.collectes FROM authenticated;

GRANT SELECT (
  id,
  evenement_id,
  type,
  prestataire_logistique_id,
  nb_camions_demande,
  statut,
  aucun_repas_motif,
  statut_tms,
  statut_tms_at,
  collecte_remplacee_id,
  motif_incident,
  incident_imputable_a,
  date_collecte,
  heure_collecte,
  heure_debut_reelle,
  heure_fin_reelle,
  volume_estime_repas,
  controle_acces_requis,
  informations_supplementaires,
  tms_reference,
  informations_completes,
  annulee_cote_savr,
  annulee_cote_savr_motif,
  dirty_tms,
  historique_partiel,
  taux_recyclage,
  caps_appliques,
  co2_induit_kg,
  co2_evite_kg,
  co2_net_kg,
  energie_primaire_evitee_kwh,
  co2_facteurs_snapshot,
  pack_antgaspi_id,
  lieu_overrides,
  realisee_at,
  created_at,
  updated_at,
  infos_acces_email_envoye_at,
  type_vehicule_souhaite,
  annulation_demandee_at,
  pax,
  type_evenement_id,
  annulation_tardive
) ON plateforme.collectes TO authenticated;

-- Vue du gestionnaire (security_invoker : elle relit collectes avec les droits de
-- l'appelant). Elle exposait aucun_repas_photo_url ; la colonne étant retirée du
-- privilège, la vue entière lèverait 42501. La colonne est gardée à sa place, à
-- NULL, pour un remplacement sans suppression de vue (une colonne ne se retire pas
-- d'une vue par CREATE OR REPLACE). Aucune requête de packages/ ni d'apps/ ne lit
-- cette vue (aucun `.from('v_collectes_gestionnaire_lieux')`, recherche du 2026-11-17).
CREATE OR REPLACE VIEW plateforme.v_collectes_gestionnaire_lieux
  WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.evenement_id,
  c.type,
  c.statut,
  c.statut_tms,
  c.statut_tms_at,
  c.prestataire_logistique_id,
  c.date_collecte,
  c.heure_collecte,
  c.heure_debut_reelle,
  c.heure_fin_reelle,
  c.volume_estime_repas,
  c.controle_acces_requis,
  c.informations_supplementaires,
  c.aucun_repas_motif,
  NULL::text AS aucun_repas_photo_url,
  c.motif_incident,
  c.taux_recyclage,
  c.co2_induit_kg,
  c.co2_evite_kg,
  c.co2_net_kg,
  c.energie_primaire_evitee_kwh,
  c.realisee_at,
  c.created_at,
  c.updated_at
FROM plateforme.collectes c;

COMMENT ON COLUMN plateforme.collectes.notes_internes IS
  'Commentaires libres Admin Savr (§04). Hors GRANT SELECT authenticated depuis 20261117230000 : illisible par PostgREST direct, staff compris. Aucune route servant un rôle client ne doit la rendre — attention aux fonctions qui renvoient la ligne entière (fn_modifier_collecte).';

COMMENT ON COLUMN plateforme.collectes.motif_override_prestataire IS
  'Motif saisi par l''Admin quand le prestataire retenu n''est pas celui recommandé (§04). Hors GRANT SELECT authenticated depuis 20261117230000 : lu en service_role par le back-office seulement.';

COMMENT ON COLUMN plateforme.collectes.aucun_repas_photo_url IS
  'Photo du lieu « aucun repas » (lien de preuve du transporteur). Réservée à l''équipe Savr (arbitrage Val 2026-10-07). Hors GRANT SELECT authenticated depuis 20261117230000 ; la vue v_collectes_gestionnaire_lieux la rend à NULL.';

-- Le commentaire de table posé par 20260915140000 disait « SELECT reste accordé » :
-- vrai au niveau table à l'époque, faux depuis cette migration.
COMMENT ON TABLE plateforme.collectes IS
  'Collecte des invendus (AG / ZD). Écriture FERMÉE à `authenticated` depuis 2026-09-15 : UPDATE et INSERT retirés du GRANT table-level 0.4a, sans re-GRANT — toute écriture passe par les routes API (service_role), seules à émettre l''outbox E1/E2, tracer l''audit_log et poser dirty_tms. Les policies col_update_client / col_update_commercial / col_insert sont conservées mais INERTES pour PostgREST direct tant que le privilège n''est pas ré-accordé. Lecture : depuis 20261117230000, `authenticated` n''a plus le SELECT table-level mais une LISTE BLANCHE de 43 colonnes (épinglée par SECU__collectes_select_liste_blanche) ; notes_internes, motif_override_prestataire et aucun_repas_photo_url sont hors privilège et lues en service_role. Toute colonne ajoutée est fermée par défaut. Le privilège DELETE reste accordé (col_delete_brouillon) mais est INATTEIGNABLE sous `authenticated` depuis la fermeture d''`evenements` : le trigger trg_set_date_evenement (fonction NON SECURITY DEFINER) y fait un UPDATE qui lève 42501. La suppression de brouillon passe par fn_supprimer_brouillon (service_role).';

-- ROLLBACK (rouvre des accès : décision explicite de Val, CLAUDE.md §12-2bis) :
--   GRANT SELECT ON plateforme.collectes TO authenticated;
--   puis CREATE OR REPLACE VIEW plateforme.v_collectes_gestionnaire_lieux avec
--   `c.aucun_repas_photo_url` à la place de `NULL::text AS aucun_repas_photo_url`.
