-- =============================================================================
-- collectes : sept colonnes de plus hors de la liste blanche SELECT (43 → 36)
-- =============================================================================
-- Suite de 20261117230000 (liste blanche colonne-level, 3 colonnes fermées).
-- Décision Val, 2026-11-17, sur les sept candidates remontées par ce lot-là :
-- « On ferme tout ».
--
-- COLONNES RETIRÉES à authenticated (7 — lues en service_role uniquement) :
--   - dirty_tms : drapeau « modifiée depuis le dernier envoi au prestataire »,
--     posé par les déclencheurs, lu par le back-office.
--   - nb_camions_demande : nombre de véhicules fixé par l'équipe Savr.
--   - incident_imputable_a : à qui l'équipe Savr impute un incident.
--   - annulee_cote_savr_motif : motif d'une annulation décidée par Savr.
--   - caps_appliques : plafonds appliqués au calcul de recyclage.
--   - co2_facteurs_snapshot : facteurs d'émission figés au calcul.
--   - lieu_overrides : surcharges du lieu saisies à la programmation.
--
-- MÉCANISME : le REVOKE de niveau table retire aussi tous les privilèges de
-- colonne du même type (documentation PostgreSQL, REVOKE) ; la liste blanche est
-- donc reposée en entier. Le résultat ne dépend pas de l'état de départ. Pas de
-- fenêtre entre les deux instructions : `supabase db push` joue le fichier dans
-- une seule transaction (mesuré le 2026-11-17, CLI 2.105.0, base jetable : une
-- migration dont la seconde instruction échoue ne laisse rien de la première).
--
-- LISTE BLANCHE (36 colonnes) = les 43 de 20261117230000 moins ces sept.
--
-- LECTEURS RECENSÉS (2026-11-17, origin/main cb51adaf ; catalogue de savr-dev) :
--   - Vues et policies : aucune ne dépend de l'une des sept colonnes (pg_depend).
--   - Fonctions dont le corps nomme l'une des sept (18 dans le catalogue de
--     savr-dev, recherche par mot entier) : aucune ne lit ces colonnes sous
--     l'identité d'un client. Deux ont EXECUTE pour authenticated et anon,
--     fn_set_collectes_dirty_tms et fn_trg_regenerer_attestation : ce sont des
--     fonctions de déclencheur, qui ne s'appellent pas directement. Six
--     tournent aux droits de l'appelant : quatre fonctions de déclencheur, sur
--     collectes, evenements et collecte_contacts (authenticated n'a ni INSERT
--     ni UPDATE sur ces trois tables : elles ne tirent pas sous son identité),
--     et fn_calculer_co2_zd / fn_calculer_co2_ag, sans EXECUTE pour
--     authenticated ni anon, appelées par des déclencheurs SECURITY DEFINER.
--     f_lieu_overrides_valide et f_lieu_overrides_textuel (contraintes CHECK)
--     jugent la valeur reçue en argument, sans lire la table.
--   - Code : deux lectures sous identité utilisateur nommaient une colonne
--     retirée, déplacées en service_role dans le même lot, après la lecture sous
--     RLS qui établit que l'appelant voit la collecte :
--       · lib/collectes/fiche-client.ts (lieu_overrides → lieu effectif) ;
--       · lib/dashboards/synthese-snapshot.ts (co2_facteurs_snapshot → annexe
--         de la synthèse PDF).
--     Toutes les autres lectures de ces colonnes sont déjà en service_role
--     (back-office, programmation, adapters, PDF).
--
-- EFFET DE BORD ASSUMÉ : comme pour 20261117230000, admin_savr / ops_savr
-- portent le rôle PG `authenticated` ; par PostgREST direct avec leur JWT ces
-- colonnes leur sont fermées (42501). Le back-office les lit en service_role.
--
-- NON DESTRUCTIF : aucune donnée touchée, aucune colonne supprimée ou renommée.
-- FERME un accès (CLAUDE.md §12-2bis) — GO reviewer-rls-securite + pgTAP de preuve.
-- ORDRE DE DÉPLOIEMENT : le CODE D'ABORD. Le code d'avant ce lot lit
-- lieu_overrides (fiche collecte des espaces clients) et co2_facteurs_snapshot
-- (synthèse PDF) sous identité utilisateur : contre une base migrée, ces deux
-- écrans répondent en erreur jusqu'au déploiement du code de ce lot.
-- APRÈS APPLICATION, mesurer sur la base : has_table_privilege('authenticated',
-- 'plateforme.collectes', 'SELECT') = false et 36 colonnes lisibles.
-- =============================================================================

REVOKE SELECT ON plateforme.collectes FROM authenticated;

GRANT SELECT (
  id,
  evenement_id,
  type,
  prestataire_logistique_id,
  statut,
  aucun_repas_motif,
  statut_tms,
  statut_tms_at,
  collecte_remplacee_id,
  motif_incident,
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
  historique_partiel,
  taux_recyclage,
  co2_induit_kg,
  co2_evite_kg,
  co2_net_kg,
  energie_primaire_evitee_kwh,
  pack_antgaspi_id,
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

COMMENT ON COLUMN plateforme.collectes.dirty_tms IS
  'Collecte modifiée depuis le dernier envoi au prestataire. Hors GRANT SELECT authenticated depuis 20261117233000 : lu en service_role (back-office, adapters).';

COMMENT ON COLUMN plateforme.collectes.nb_camions_demande IS
  'Nombre de véhicules fixé par l''équipe Savr (V1-only, Frontière G1). Hors GRANT SELECT authenticated depuis 20261117233000 : lu en service_role.';

COMMENT ON COLUMN plateforme.collectes.incident_imputable_a IS
  'À qui l''équipe Savr impute l''incident. Hors GRANT SELECT authenticated depuis 20261117233000 : lu en service_role.';

COMMENT ON COLUMN plateforme.collectes.annulee_cote_savr_motif IS
  'Motif d''une annulation décidée par l''équipe Savr. Hors GRANT SELECT authenticated depuis 20261117233000 : lu en service_role.';

COMMENT ON COLUMN plateforme.collectes.caps_appliques IS
  'Plafonds appliqués au calcul de recyclage. Hors GRANT SELECT authenticated depuis 20261117233000 : lu en service_role (fabrication des PDF).';

COMMENT ON COLUMN plateforme.collectes.co2_facteurs_snapshot IS
  'Facteurs d''émission figés au calcul. Hors GRANT SELECT authenticated depuis 20261117233000 : lu en service_role (PDF, synthèse des tableaux de bord après lecture sous RLS).';

COMMENT ON COLUMN plateforme.collectes.lieu_overrides IS
  'Surcharges du lieu saisies à la programmation. Hors GRANT SELECT authenticated depuis 20261117233000 : lu en service_role (programmation, fiche collecte après lecture sous RLS, adapters).';

COMMENT ON TABLE plateforme.collectes IS
  'Collecte des invendus (AG / ZD). Écriture FERMÉE à `authenticated` depuis 2026-09-15 : UPDATE et INSERT retirés du GRANT table-level 0.4a, sans re-GRANT — toute écriture passe par les routes API (service_role), seules à émettre l''outbox E1/E2, tracer l''audit_log et poser dirty_tms. Les policies col_update_client / col_update_commercial / col_insert sont conservées mais INERTES pour PostgREST direct tant que le privilège n''est pas ré-accordé. Lecture : `authenticated` n''a pas le SELECT table-level mais une LISTE BLANCHE de 36 colonnes (20261117230000 puis 20261117233000, épinglée par SECU__collectes_select_liste_blanche) ; dix colonnes sont hors privilège et lues en service_role : notes_internes, motif_override_prestataire, aucun_repas_photo_url, dirty_tms, nb_camions_demande, incident_imputable_a, annulee_cote_savr_motif, caps_appliques, co2_facteurs_snapshot, lieu_overrides. Toute colonne ajoutée est fermée par défaut. Le privilège DELETE reste accordé (col_delete_brouillon) mais est INATTEIGNABLE sous `authenticated` depuis la fermeture d''`evenements` : le trigger trg_set_date_evenement (fonction NON SECURITY DEFINER) y fait un UPDATE qui lève 42501. La suppression de brouillon passe par fn_supprimer_brouillon (service_role).';

-- ROLLBACK (rouvre des accès : décision explicite de Val, CLAUDE.md §12-2bis) :
--   GRANT SELECT (dirty_tms, nb_camions_demande, incident_imputable_a,
--     annulee_cote_savr_motif, caps_appliques, co2_facteurs_snapshot,
--     lieu_overrides) ON plateforme.collectes TO authenticated;
