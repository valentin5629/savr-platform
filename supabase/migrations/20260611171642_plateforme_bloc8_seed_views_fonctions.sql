-- Module 0.3 — Bloc 8 : Seed data, vues SQL, fonctions utilitaires
-- Seed : types_evenements, flux_dechets, parametres_*, grilles_tarifaires, email_templates
-- Fonctions : f_benchmark_kg_pax_zd, mv_benchmark_kg_pax_zd_base
-- Vues : v_registre_dechets, v_referentiel_traiteurs, v_factures_client

-- ============================================================
-- SEED DATA — types_evenements (4 catégories V1)
-- ============================================================

INSERT INTO plateforme.types_evenements (code, libelle, ordre_affichage, actif) VALUES
  ('cocktail_aperitif',       'Cocktail apéritif',        1, true),
  ('cocktail_repas_complet',  'Cocktail repas complet',   2, true),
  ('repas_assis',             'Repas assis',              3, true),
  ('autre',                   'Autre',                    4, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SEED DATA — flux_dechets (5 flux V1)
-- ============================================================

INSERT INTO plateforme.flux_dechets (code, nom, unite_mesure, filiere_valorisation, ordre_affichage, actif) VALUES
  ('biodechet',         'Biodéchets',         'kg',  'compostage',         1, true),
  ('emballage',         'Emballages',         'bac', 'recyclage',          2, true),
  ('carton',            'Cartons',            'kg',  'recyclage',          3, true),
  ('verre',             'Verre',              'kg',  'recyclage',          4, true),
  ('dechet_residuel',   'Déchet résiduel',    'kg',  'enfouissement',      5, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SEED DATA — parametres_taux_recyclage (taux de base V1)
-- Colonnes réelles : code_filiere (enum), nom_filiere, taux_captation, prestataire, source_donnee, actif
-- ============================================================

INSERT INTO plateforme.parametres_taux_recyclage
  (code_filiere, nom_filiere, taux_captation, prestataire, source_donnee, actif)
VALUES
  ('biodechet', 'Biodéchets',  0.8500, 'Veolia',  'ADEME 2024', true),
  ('carton',    'Cartons',     0.8000, 'Paprec',  'ADEME 2024', true),
  ('verre',     'Verre',       0.9000, 'Veolia',  'ADEME 2024', true),
  ('emballage', 'Emballages',  0.6000, 'Citeo',   'Citeo 2024', true)
ON CONFLICT (code_filiere) DO NOTHING;

-- ============================================================
-- SEED DATA — parametres_facteurs_co2 (FE initiaux V1)
-- Colonnes réelles : code_flux (enum), nom_flux, fe_induit_kg_t, fe_evite_kg_t,
--   energie_primaire_evitee_kwh_t, source_donnee, actif (valeurs en kgCO₂/tonne)
-- ============================================================

INSERT INTO plateforme.parametres_facteurs_co2
  (code_flux, nom_flux, fe_induit_kg_t, fe_evite_kg_t, energie_primaire_evitee_kwh_t, source_donnee, actif)
VALUES
  ('biodechet',       'Biodéchets',       20.0,   250.0,  800.0,  'ADEME Base Carbone 2024', true),
  ('carton',          'Cartons',          25.0,   520.0,  1800.0, 'ADEME Base Carbone 2024', true),
  ('verre',           'Verre',            10.0,   300.0,  400.0,  'ADEME Base Carbone 2024', true),
  ('dechet_residuel', 'Déchet résiduel',  500.0,  0.0,    0.0,    'ADEME Base Carbone 2024', true),
  -- emballage : calculé par trigger mix emballages (valeur initiale conservative)
  ('emballage',       'Emballages',       30.0,   400.0,  1200.0, 'Calculé mix emballages',  true)
ON CONFLICT (code_flux) DO NOTHING;

-- ============================================================
-- SEED DATA — parametres_mix_emballages (7 matériaux V1)
-- Colonnes réelles : code_materiau (enum), nom_materiau, part_pct, fe_induit_kg_t, fe_evite_kg_t
-- Enum : carton_papier, pet, pehd, acier, alu, briques, autres
-- Somme part_pct = 100%
-- ============================================================

INSERT INTO plateforme.parametres_mix_emballages
  (code_materiau, nom_materiau, part_pct, fe_induit_kg_t, fe_evite_kg_t, source_donnee, actif)
VALUES
  ('carton_papier', 'Carton / papier',  25.0, 25.0,  520.0, 'Citeo 2024', true),
  ('pet',           'PET',              20.0, 80.0,  450.0, 'Citeo 2024', true),
  ('pehd',          'PEHD',             15.0, 80.0,  380.0, 'Citeo 2024', true),
  ('acier',         'Acier',             5.0, 35.0,  600.0, 'Citeo 2024', true),
  ('alu',           'Aluminium',        10.0, 40.0,  900.0, 'Citeo 2024', true),
  ('briques',       'Briques alimentaires', 5.0, 30.0, 400.0, 'Citeo 2024', true),
  ('autres',        'Autres matériaux', 20.0, 50.0,  200.0, 'Citeo 2024', true)
ON CONFLICT (code_materiau) DO NOTHING;

-- ============================================================
-- SEED DATA — parametres_co2_divers (clés V1)
-- Colonnes réelles : cle, valeur (decimal), unite (NOT NULL), description (NOT NULL)
-- ============================================================

INSERT INTO plateforme.parametres_co2_divers (cle, valeur, unite, description) VALUES
  ('fe_transport_km_co2_kg',       0.00012, 'kgCO₂/t.km', 'FE transport routier'),
  ('fe_electricite_fr_co2_kwh',    0.0385,  'kgCO₂/kWh',  'FE électricité France'),
  ('fe_gaz_naturel_co2_kwh',       0.2045,  'kgCO₂/kWh',  'FE gaz naturel'),
  ('facteur_conversion_bac_kg',    12.0,    'kg/bac',      'Masse moyenne contenu 1 bac'),
  ('facteur_co2_biodechet_traite', 0.003,   'kgCO₂/kg',   'FE traitement compost')
ON CONFLICT (cle) DO NOTHING;

-- ============================================================
-- SEED DATA — parametres_facteurs_co2_ag (1 ligne V1)
-- Colonnes réelles : cle (text UNIQUE), facteur_co2_evite_par_repas_kg, source_donnee, actif
-- 2.5 kgCO₂e évité par repas (FAO)
-- ============================================================

INSERT INTO plateforme.parametres_facteurs_co2_ag
  (cle, facteur_co2_evite_par_repas_kg, source_donnee, actif)
VALUES
  ('fao_2023', 2.5, 'FAO 2023 — Food loss and waste footprint', true)
ON CONFLICT (cle) DO NOTHING;

-- ============================================================
-- SEED DATA — parametres_algo (8 paramètres V1)
-- ============================================================

-- valeur est jsonb — les scalaires doivent être des valeurs JSON valides
INSERT INTO plateforme.parametres_algo (cle, valeur, type_valeur, description) VALUES
  ('algo_nb_candidats_top',        '3'::jsonb,       'int',     'Nb associations proposées par algo AG'),
  ('algo_rayon_max_km',            '50'::jsonb,      'int',     'Rayon max (km) pour la sélection des transporteurs AG'),
  ('algo_seuil_refus_pct',         '0.3'::jsonb,     'decimal', 'Part de refus déclenchant une révision transporteur'),
  ('collecte_warning_moins_48h',   'true'::jsonb,    'bool',    'Warning si programmation < 48h avant collecte'),
  ('pesee_seuil_min_kg',           '5'::jsonb,       'int',     'Seuil min pesée ZD en kg (alerte in-app)'),
  ('pesee_seuil_max_kg',           '5000'::jsonb,    'int',     'Seuil max pesée ZD en kg (alerte in-app)'),
  ('batch_pdf_heure',              '"06:00"'::jsonb, 'time',    'Heure batch génération PDF J+1'),
  ('embargo_realisation_heures',   '24'::jsonb,      'int',     'Embargo H+24 avant génération PDF post-réalisation')
ON CONFLICT (cle) DO NOTHING;

-- ============================================================
-- SEED DATA — grilles_tarifaires_zd + tarifs_zero_dechet (grille standard V1)
-- ============================================================

WITH g AS (
  INSERT INTO plateforme.grilles_tarifaires_zd (nom, description, est_defaut, actif, valide_du)
  VALUES ('Grille standard V1', 'Grille tarifaire ZD par défaut — V1', true, true, '2026-01-01')
  ON CONFLICT DO NOTHING
  RETURNING id
)
INSERT INTO plateforme.tarifs_zero_dechet (grille_id, pax_min, pax_max, prix_base_ht, prix_par_couvert_ht)
SELECT g.id, pax_min, pax_max, prix_base_ht, prix_par_couvert_ht
FROM g, (VALUES
  (0,   249,  250.00, 1.50),
  (250, 499,  350.00, 1.40),
  (500, 749,  450.00, 1.30),
  (750, 999,  550.00, 1.20),
  (1000, NULL, 650.00, 1.10)
) AS t(pax_min, pax_max, prix_base_ht, prix_par_couvert_ht)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED DATA — tarifs_packs_ag (4 tailles V1)
-- ============================================================

INSERT INTO plateforme.tarifs_packs_ag (nb_collectes, prix_ht, valide_du, actif) VALUES
  (5,   700.00, '2026-01-01', true),
  (10,  1300.00,'2026-01-01', true),
  (20,  2400.00,'2026-01-01', true),
  (50,  5500.00,'2026-01-01', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED DATA — email_templates (19 templates actifs §06.02)
-- Vouvoiement, FR, 0 emoji, signature « L'équipe Savr »
-- Corps HTML = placeholder — à compléter lors du module email.
-- ============================================================

INSERT INTO plateforme.email_templates (code, sujet, corps_html, actif, description, variables) VALUES
  -- Auth / Onboarding
  ('bienvenue_organisation',         'Bienvenue sur Savr',
    '<p>Bienvenue sur la plateforme Savr.</p><p>L''équipe Savr</p>', true,
    'Envoyé à la création d''une organisation', ARRAY['prenom','organisation_nom']),
  ('verification_email',             'Vérification de votre adresse e-mail',
    '<p>Vérifiez votre adresse e-mail.</p><p>L''équipe Savr</p>', true,
    'Lien de vérification d''email', ARRAY['prenom','lien_verification']),
  ('reinitialisation_mot_de_passe',  'Réinitialisation de votre mot de passe',
    '<p>Réinitialisez votre mot de passe.</p><p>L''équipe Savr</p>', true,
    'Lien de reset mot de passe', ARRAY['prenom','lien_reset']),
  ('invitation_utilisateur',         'Invitation à rejoindre votre organisation sur Savr',
    '<p>Vous avez été invité à rejoindre Savr.</p><p>L''équipe Savr</p>', true,
    'Invitation d''un nouvel utilisateur', ARRAY['prenom','organisation_nom','lien_invitation']),
  -- Collectes
  ('confirmation_collecte',          'Confirmation de votre collecte',
    '<p>Votre collecte a été confirmée.</p><p>L''équipe Savr</p>', true,
    'Confirmation collecte programmée', ARRAY['prenom','date_collecte','lieu_nom']),
  ('rappel_collecte_j3',             'Rappel : votre collecte dans 3 jours',
    '<p>Rappel de votre collecte.</p><p>L''équipe Savr</p>', true,
    'Rappel J-3 avant collecte', ARRAY['prenom','date_collecte','lieu_nom']),
  ('annulation_collecte',            'Annulation de votre collecte',
    '<p>Votre collecte a été annulée.</p><p>L''équipe Savr</p>', true,
    'Notification annulation collecte', ARRAY['prenom','date_collecte','lieu_nom','motif']),
  ('collecte_realisee',              'Votre collecte a été réalisée',
    '<p>Votre collecte a bien été réalisée.</p><p>L''équipe Savr</p>', true,
    'Notification réalisation collecte', ARRAY['prenom','date_collecte']),
  -- Documents
  ('bordereau_disponible',           'Votre bordereau de collecte est disponible',
    '<p>Votre bordereau est disponible.</p><p>L''équipe Savr</p>', true,
    'Bordereau ZD disponible en téléchargement', ARRAY['prenom','date_collecte','lien_pdf']),
  ('attestation_don_disponible',     'Votre attestation de don est disponible',
    '<p>Votre attestation de don est disponible.</p><p>L''équipe Savr</p>', true,
    'Attestation don AG disponible', ARRAY['prenom','association_nom','lien_pdf']),
  -- Facturation
  ('facture_emise',                  'Votre facture Savr est disponible',
    '<p>Votre facture est disponible.</p><p>L''équipe Savr</p>', true,
    'Facture émise', ARRAY['prenom','numero_facture','montant_ttc','lien_pdf']),
  ('avoir_emis',                     'Un avoir Savr a été émis',
    '<p>Un avoir a été émis sur votre compte.</p><p>L''équipe Savr</p>', true,
    'Avoir émis', ARRAY['prenom','numero_avoir','montant_ttc']),
  ('facture_relance_j15',            'Rappel de paiement — facture en attente',
    '<p>Votre facture est en attente de règlement.</p><p>L''équipe Savr</p>', true,
    'Relance paiement J+15', ARRAY['prenom','numero_facture','montant_ttc','date_echeance']),
  ('pack_ag_active',                 'Votre pack Anti-Gaspi est activé',
    '<p>Votre pack Anti-Gaspi est désormais actif.</p><p>L''équipe Savr</p>', true,
    'Activation pack AG', ARRAY['prenom','nb_collectes']),
  -- Ops / Admin (internes ou tiers)
  ('alerte_ops_collecte_non_transmise', 'Alerte : collecte non transmise au TMS',
    '<p>Une collecte n''a pas été transmise au TMS.</p><p>L''équipe Savr</p>', true,
    'Alerte ops — collecte non transmise (email Admin)', ARRAY['collecte_id','date_collecte']),
  ('alerte_ops_pesee_anormale',      'Alerte : pesée anormale détectée',
    '<p>Une pesée anormale a été détectée.</p><p>L''équipe Savr</p>', true,
    'Alerte ops — pesée hors seuil (email Admin)', ARRAY['collecte_id','flux','poids_kg']),
  -- Tiers / partenaires
  ('attribution_association',        'Collecte Anti-Gaspi attribuée à votre association',
    '<p>Une collecte Anti-Gaspi vous a été attribuée.</p><p>L''équipe Savr</p>', true,
    'Notification attribution AG à l''association', ARRAY['association_nom','date_collecte','lieu_nom']),
  ('attribution_transporteur',       'Collecte Anti-Gaspi à venir — confirmation demandée',
    '<p>Merci de confirmer votre disponibilité.</p><p>L''équipe Savr</p>', true,
    'Demande confirmation transporteur', ARRAY['transporteur_nom','date_collecte','lieu_nom']),
  -- Admin
  ('siret_verification_echec',       'Vérification SIRET en échec — action requise',
    '<p>La vérification SIRET de votre organisation a échoué.</p><p>L''équipe Savr</p>', true,
    'Alerte Admin — vérification SIRET échouée', ARRAY['organisation_nom','siret'])
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- FONCTION : f_benchmark_kg_pax_zd
-- Calcul benchmark kg/PAX ZD par bracket taille et filière.
-- SECURITY DEFINER — lecture stats historiques inter-organisations.
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.f_benchmark_kg_pax_zd(
  p_bracket text,
  p_flux_code text DEFAULT NULL
) RETURNS TABLE (
  flux_code    text,
  bracket      text,
  median_kg_pax numeric,
  nb_collectes  integer
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    fd.code,
    plateforme.taille_evenement_bracket(e.pax) AS bracket,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cf.poids_reel_kg / NULLIF(e.pax, 0)) AS median_kg_pax,
    COUNT(*)::integer
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  JOIN plateforme.collecte_flux cf ON cf.collecte_id = c.id
  JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
  WHERE c.statut = 'cloturee'
    AND c.type = 'zero_dechet'
    AND plateforme.taille_evenement_bracket(e.pax) = p_bracket
    AND cf.poids_reel_kg IS NOT NULL
    AND (p_flux_code IS NULL OR fd.code = p_flux_code)
  GROUP BY fd.code, bracket
  HAVING COUNT(*) >= 5;
$$;

-- Vue matérialisée benchmark (rafraîchie périodiquement, ex: 1x/jour)
CREATE MATERIALIZED VIEW IF NOT EXISTS plateforme.mv_benchmark_kg_pax_zd_base AS
  SELECT * FROM plateforme.f_benchmark_kg_pax_zd('XS')
  UNION ALL SELECT * FROM plateforme.f_benchmark_kg_pax_zd('S')
  UNION ALL SELECT * FROM plateforme.f_benchmark_kg_pax_zd('M')
  UNION ALL SELECT * FROM plateforme.f_benchmark_kg_pax_zd('L')
  UNION ALL SELECT * FROM plateforme.f_benchmark_kg_pax_zd('XL')
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_mv_benchmark_bracket_flux
  ON plateforme.mv_benchmark_kg_pax_zd_base (bracket, flux_code);

-- ============================================================
-- VUE : v_registre_dechets
-- Registre réglementaire ZD — collectes cloturees ZD only.
-- SECURITY DEFINER + filtre agence (exclusion par défaut).
-- ============================================================

CREATE OR REPLACE VIEW plateforme.v_registre_dechets
WITH (security_invoker = false)
AS
SELECT
  c.id                    AS collecte_id,
  c.date_collecte,
  e.pax,
  plateforme.taille_evenement_bracket(e.pax) AS taille_bracket,
  o.nom                   AS organisation_nom,
  l.nom                   AS lieu_nom,
  l.adresse_acces         AS lieu_adresse,
  sp.nom                  AS prestataire_nom,
  cf.poids_reel_kg,
  fd.code                 AS flux_code,
  fd.nom                  AS flux_nom,
  fd.filiere_valorisation,
  c.taux_recyclage,
  c.co2_induit_kg,
  c.co2_evite_kg,
  c.co2_net_kg,
  c.realisee_at,
  c.created_at
FROM plateforme.collectes c
JOIN plateforme.evenements e ON e.id = c.evenement_id
JOIN plateforme.organisations o ON o.id = e.organisation_id
JOIN plateforme.lieux l ON l.id = e.lieu_id
LEFT JOIN shared.prestataires sp ON sp.id = c.prestataire_logistique_id
LEFT JOIN plateforme.collecte_flux cf ON cf.collecte_id = c.id
LEFT JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
WHERE c.statut = 'cloturee'
  AND c.type = 'zero_dechet';

COMMENT ON VIEW plateforme.v_registre_dechets IS
  'Registre réglementaire ZD — collectes cloturees uniquement. RLS filtres appliqués via policies.';

-- ============================================================
-- VUE : v_referentiel_traiteurs
-- Vue simplifiée du référentiel traiteur (Admin + lecture interne).
-- ============================================================

CREATE OR REPLACE VIEW plateforme.v_referentiel_traiteurs AS
SELECT
  o.id,
  o.nom,
  o.raison_sociale,
  o.type,
  o.actif,
  o.est_shadow,
  o.tarif_refacture_pax_zd,
  ef.siret,
  ef.siret_verification,
  ef.tva_intracom,
  ef.pennylane_customer_id,
  u.email                   AS contact_email_principal,
  u.prenom || ' ' || u.nom  AS contact_nom_principal,
  COUNT(ev.id)              AS nb_evenements
FROM plateforme.organisations o
LEFT JOIN plateforme.entites_facturation ef
       ON ef.organisation_id = o.id AND ef.entite_par_defaut = true AND ef.actif = true
LEFT JOIN plateforme.users u
       ON u.organisation_id = o.id AND u.role = 'traiteur_manager' AND u.actif = true
LEFT JOIN plateforme.evenements ev ON ev.organisation_id = o.id
WHERE o.type = 'traiteur'
GROUP BY o.id, o.nom, o.raison_sociale, o.type, o.actif, o.est_shadow,
         o.tarif_refacture_pax_zd, ef.siret, ef.siret_verification,
         ef.tva_intracom, ef.pennylane_customer_id, u.email, u.prenom, u.nom;

-- ============================================================
-- VUE : v_factures_client
-- Vue factures par organisation pour l'espace client traiteur.
-- ============================================================

CREATE OR REPLACE VIEW plateforme.v_factures_client AS
SELECT
  f.id,
  f.organisation_id,
  f.numero_complet,
  f.serie,
  f.statut,
  f.date_emission,
  f.date_echeance,
  f.montant_ht,
  f.montant_tva,
  f.montant_ttc,
  f.devise,
  f.pdf_fichier_id,
  f.avoir_de_facture_id,
  f.created_at
FROM plateforme.factures f
WHERE f.statut NOT IN ('brouillon');
