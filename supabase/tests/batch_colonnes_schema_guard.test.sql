-- pgTAP — Garde anti-récurrence « colonne inexistante » pour les batches PostgREST.
--
-- Contexte : les tests unitaires (Supabase mocké) ne peuvent PAS attraper un nom de
-- colonne erroné dans un .select()/.insert() — le mock renvoie une forme arbitraire
-- sans valider le schéma. Plusieurs bugs « column does not exist » sont passés en prod
-- de cette façon (cloturee_at, co2_net_kwh, nb_pax, poids_kg, contact_principal_email,
-- transporteur_id, transporteurs.siret, mode_facturation_zd, est_principale).
--
-- Cette garde exécute, en LIMIT 0, EXACTEMENT les colonnes lues/écrites par chaque
-- batch contre le schéma réel. Un nom de colonne fautif → lives_ok échoue → CI rouge
-- (job pgtap-rls-outbox : `supabase test db`).
--
-- ⚠ À maintenir en miroir des .select()/.insert() de :
--    packages/plateforme/src/lib/pdf/batch-pdf-j1.ts
--    packages/plateforme/src/lib/facturation/batch-brouillons.ts

BEGIN;
SELECT plan(17);

-- ══════════════════════════════════════════════════════════════════════════════
-- batch-pdf-j1.ts (M1.6) — rapport recyclage ZD + bordereau ZD
-- ══════════════════════════════════════════════════════════════════════════════

SELECT lives_ok(
  $$ SELECT id, evenement_id, realisee_at, taux_recyclage, co2_evite_kg,
            co2_induit_kg, co2_net_kg, energie_primaire_evitee_kwh,
            co2_facteurs_snapshot, nb_camions_demande, prestataire_logistique_id,
            type, statut
     FROM plateforme.collectes LIMIT 0 $$,
  'batch-pdf-j1 : colonnes lues sur plateforme.collectes existent'
);

SELECT lives_ok(
  $$ SELECT id, nom_evenement, date_evenement, pax, organisation_id,
            traiteur_operationnel_organisation_id
     FROM plateforme.evenements LIMIT 0 $$,
  'batch-pdf-j1 : colonnes lues sur plateforme.evenements existent (pas de contact_principal_email en V1)'
);

SELECT lives_ok(
  $$ SELECT raison_sociale, siret, adresse, email_principal
     FROM plateforme.organisations LIMIT 0 $$,
  'batch-pdf-j1 : colonnes lues sur plateforme.organisations existent (+ email_principal destinataire rapport)'
);

SELECT lives_ok(
  $$ SELECT nom, adresse_acces, code_postal, ville
     FROM plateforme.lieux LIMIT 0 $$,
  'batch-pdf-j1 : colonnes lues sur plateforme.lieux existent'
);

SELECT lives_ok(
  $$ SELECT id, nom, siret FROM shared.prestataires LIMIT 0 $$,
  'batch-pdf-j1 : transporteur lu sur shared.prestataires (nom, siret) — pas plateforme.transporteurs'
);

SELECT lives_ok(
  $$ SELECT flux_id, poids_reel_kg, collecte_id
     FROM plateforme.collecte_flux LIMIT 0 $$,
  'batch-pdf-j1 : colonnes lues sur plateforme.collecte_flux existent (poids_reel_kg, pas poids_kg)'
);

SELECT lives_ok(
  $$ SELECT nom FROM plateforme.flux_dechets LIMIT 0 $$,
  'batch-pdf-j1 : flux_dechets.nom (embed flux:flux_id) existe'
);

SELECT lives_ok(
  $$ SELECT collecte_id, statut, numero, date_emission, date_collecte,
            producteur_raison_sociale, producteur_siret, producteur_adresse,
            transporteur_nom, transporteur_siret, exutoire_nom, detail_flux,
            poids_total_kg
     FROM plateforme.bordereaux_savr LIMIT 0 $$,
  'batch-pdf-j1 : colonnes lues/écrites sur plateforme.bordereaux_savr existent'
);

SELECT lives_ok(
  $$ SELECT collecte_id, evenement_id, version, disponible_a, genere_par,
            filtres_benchmark
     FROM plateforme.rapports_rse LIMIT 0 $$,
  'batch-pdf-j1 : colonnes écrites sur plateforme.rapports_rse existent'
);

SELECT lives_ok(
  $$ SELECT type_document, entity_type, entity_id, payload, statut, attempts
     FROM plateforme.jobs_pdf LIMIT 0 $$,
  'batch-pdf-j1 : colonnes écrites sur plateforme.jobs_pdf existent'
);

-- ══════════════════════════════════════════════════════════════════════════════
-- batch-brouillons.ts (M1.7) — brouillons factures ZD + AG
-- ══════════════════════════════════════════════════════════════════════════════

SELECT lives_ok(
  $$ SELECT id, type, statut, annulee_cote_savr, pack_antgaspi_id
     FROM plateforme.collectes LIMIT 0 $$,
  'batch-brouillons : colonnes lues sur plateforme.collectes existent'
);

SELECT lives_ok(
  $$ SELECT id, organisation_id, pax, date_evenement
     FROM plateforme.evenements LIMIT 0 $$,
  'batch-brouillons : colonnes lues sur plateforme.evenements existent (pax, pas nb_pax)'
);

SELECT lives_ok(
  $$ SELECT mode_facturation_zd, grille_tarifaire_zd_id
     FROM plateforme.organisations LIMIT 0 $$,
  'batch-brouillons : organisations.mode_facturation_zd existe (migration 20260619150000)'
);

SELECT lives_ok(
  $$ SELECT id, siret_verification, organisation_id, entite_par_defaut
     FROM plateforme.entites_facturation LIMIT 0 $$,
  'batch-brouillons : entites_facturation.entite_par_defaut existe (pas est_principale)'
);

SELECT lives_ok(
  $$ SELECT collecte_id, facture_id, quantite, taux_tva, tarif_applique_id,
            tarif_applique_source, tarif_detail, montant_ligne_ht, montant_ht
     FROM plateforme.factures_collectes LIMIT 0 $$,
  'batch-brouillons : colonnes lues/écrites sur plateforme.factures_collectes existent'
);

SELECT lives_ok(
  $$ SELECT id, organisation_id, entite_facturation_id, type, mode_facturation,
            statut, montant_ht, taux_tva, montant_tva, montant_ttc, periode_debut,
            pack_antgaspi_id, updated_at
     FROM plateforme.factures LIMIT 0 $$,
  'batch-brouillons : colonnes lues/écrites sur plateforme.factures existent'
);

SELECT lives_ok(
  $$ SELECT mode_facturation FROM plateforme.packs_antgaspi LIMIT 0 $$,
  'batch-brouillons : packs_antgaspi.mode_facturation existe'
);

SELECT * FROM finish();
ROLLBACK;
