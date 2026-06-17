-- M3.2 — Espace client gestionnaire de lieux
-- Crée : v_collectes_gestionnaire_lieux, v_lieux_public
-- Vérifie : GRANT EXECUTE f_benchmark_kg_pax_zd → authenticated (PUBLIC)
-- RLS existant (M0.4a) : org_lieux_self_select, f_dechets_labo_estimes avec garde organisations_lieux
-- Contrainte UNIQUE organisations_lieux (organisation_id, lieu_id) : déjà créée M0.1

-- ─── INDEX pour les requêtes gestionnaire ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_evenements_lieu_date
  ON plateforme.evenements (lieu_id, date_evenement);

CREATE INDEX IF NOT EXISTS idx_collectes_statut_evenement
  ON plateforme.collectes (statut, evenement_id);

-- ─── VUE : v_collectes_gestionnaire_lieux ────────────────────────────────────
-- Expose les colonnes non-financières des collectes accessibles à gestionnaire_lieux.
-- Exclut : notes_internes, annulee_cote_savr*, dirty_tms, caps_appliques,
--          co2_facteurs_snapshot, historique_partiel, lieu_overrides,
--          incident_imputable_a, informations_completes, motif_override_prestataire,
--          pack_antgaspi_id, collecte_remplacee_id, nb_camions_demande.
-- SECURITY INVOKER → RLS de plateforme.collectes filtre les lignes (policy existante M0.4c).

DROP VIEW IF EXISTS plateforme.v_collectes_gestionnaire_lieux;

CREATE VIEW plateforme.v_collectes_gestionnaire_lieux
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
  c.aucun_repas_photo_url,
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

GRANT SELECT ON plateforme.v_collectes_gestionnaire_lieux TO authenticated;

-- ─── VUE : v_lieux_public ─────────────────────────────────────────────────────
-- Masque les 4 champs admin-only (R_lieux_admin_only_fields §05) :
--   commentaire_lieu, siren, email_gestionnaire, reference_citeo
-- Masque également commentaires_internes (colonne ops/Admin, hors scope client).
-- SECURITY INVOKER → RLS de plateforme.lieux filtre les lignes selon le rôle appelant.
-- Note : le blanket GRANT 0.4a accorde SELECT table-level sur lieux →
--   l'exclusion des colonnes sensibles passe par cette vue (pas par REVOKE colonne,
--   inopérant tant que le SELECT table-level subsiste — cf. commentaire 0.4a §NOTE).

DROP VIEW IF EXISTS plateforme.v_lieux_public;

CREATE VIEW plateforme.v_lieux_public
  WITH (security_invoker = true)
AS
SELECT
  l.id,
  l.nom,
  l.nom_alternatif,
  l.adresse_acces,
  l.code_postal,
  l.ville,
  l.latitude,
  l.longitude,
  l.region,
  l.acces_details,
  l.acces_office,
  l.stationnement,
  l.type_vehicule_max,
  l.contraintes_horaires,
  l.flux_autorises,
  l.volume_max_bacs,
  l.traiteurs_operant,
  l.controle_acces_requis_default,
  l.photos_urls,
  l.actif,
  l.created_at,
  l.updated_at
  -- Exclus : commentaire_lieu, siren, email_gestionnaire, reference_citeo, commentaires_internes
FROM plateforme.lieux l;

GRANT SELECT ON plateforme.v_lieux_public TO authenticated;

-- ─── GRANT EXECUTE f_benchmark_kg_pax_zd → authenticated ────────────────────
-- La fonction a été créée en M0.8 (bloc8) avec SECURITY DEFINER.
-- En PostgreSQL, CREATE FUNCTION accorde EXECUTE à PUBLIC par défaut.
-- On le rend explicite pour documenter l'intention (gestionnaire_lieux autorisé §06.05).
-- Aucune garde de rôle dans la fonction elle-même : RLS des tables sources (collectes,
-- evenements, collecte_flux) sous search_path figé (M3.5 ALTER FUNCTION search_path).
GRANT EXECUTE ON FUNCTION plateforme.f_benchmark_kg_pax_zd(text, text) TO authenticated;

-- ─── INDEX pour performance dashboard gestionnaire ───────────────────────────

CREATE INDEX IF NOT EXISTS idx_organisations_lieux_organisation
  ON plateforme.organisations_lieux (organisation_id);

CREATE INDEX IF NOT EXISTS idx_organisations_lieux_lieu
  ON plateforme.organisations_lieux (lieu_id);

-- ─── RLS : gestionnaire_lieux peut voir les organisations de type 'traiteur' ──
-- Restreint aux traiteurs ayant des événements sur les lieux du gestionnaire (24m fenêtre).
-- Exclut les champs commerciaux (email/SIRET/téléphone) via la route — pas de colonne-level policy.
-- EXISTS borné par organisations_lieux(organisation_id) → pas de scan global.
CREATE POLICY org_gestionnaire_traiteur_select ON plateforme.organisations
  FOR SELECT USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND type = 'traiteur'
    AND EXISTS (
      SELECT 1
      FROM plateforme.evenements e
      JOIN plateforme.organisations_lieux ol ON ol.lieu_id = e.lieu_id
      WHERE e.traiteur_operationnel_organisation_id = organisations.id
        AND ol.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );
