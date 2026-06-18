-- pgTAP M3.4 — Espace client organisateur (RLS lecture seule + helper repas C-1-safe).
-- Couvre : rapports_rse rr_select élargi (dette 0.4c, chemin client_organisateur),
-- bordereaux/attestations own, organisations self, attributions deny (C-1),
-- factures deny, f_volume_repas_realise (impact AG sans fuite C-1),
-- v_kpi_client_organisateur sous JWT organisateur (nb_repas + CO2 ABC),
-- f_fichier_visible rapports_rse aligné.

BEGIN;
SELECT plan(14);

-- ── Helpers JWT ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Fixtures ──────────────────────────────────────────────────────────────────
SELECT test_as_superuser();

DO $$ BEGIN
  -- Organisations : CO-A + CO-B (client_organisateur) + TR (traiteur, donneur d'ordre)
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
    ('e0000000-0000-0000-0000-00000000000a'::uuid, 'OrgA', 'OrgA SA', 'client_organisateur', '99999999900001', true, 0.00),
    ('e0000000-0000-0000-0000-00000000000b'::uuid, 'OrgB', 'OrgB SA', 'client_organisateur', '99999999900002', true, 0.00),
    ('e0000000-0000-0000-0000-00000000000c'::uuid, 'TraiteurT', 'TraiteurT SAS', 'traiteur', '99999999900003', true, 1.50);

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
    ('e1000000-0000-0000-0000-00000000000c'::uuid, 'e0000000-0000-0000-0000-00000000000c'::uuid, 'TraiteurT SAS', '99999999900003', '3 Rue T', '75003', 'Paris');

  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
    ('e2000000-0000-0000-0000-00000000000a'::uuid, 'e0000000-0000-0000-0000-00000000000a'::uuid, 'a@org-test.local', 'A', 'Org', 'client_organisateur'),
    ('e2000000-0000-0000-0000-00000000000b'::uuid, 'e0000000-0000-0000-0000-00000000000b'::uuid, 'b@org-test.local', 'B', 'Org', 'client_organisateur'),
    ('e2000000-0000-0000-0000-00000000000c'::uuid, 'e0000000-0000-0000-0000-00000000000c'::uuid, 't@org-test.local', 'T', 'Tr', 'traiteur_manager');

  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
    ('e3000000-0000-0000-0000-000000000001'::uuid, 'Salle Org', '1 Rue Org', '75001', 'Paris', 'camionnette', 48.8566, 2.3522, 'idf');

  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
    ('e4000000-0000-0000-0000-000000000001'::uuid, 'GALA_M34', 'Gala M3.4', 1, true);

  -- Événements : EV-A (client orga = CO-A) + EV-B (client orga = CO-B, cross)
  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id,
    entite_facturation_id, created_by, lieu_id, type_evenement_id,
    nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone,
    client_organisateur_organisation_id
  ) VALUES
    ('e5000000-0000-0000-0000-00000000000a'::uuid,
     'e0000000-0000-0000-0000-00000000000c'::uuid,
     'e0000000-0000-0000-0000-00000000000c'::uuid,
     'e1000000-0000-0000-0000-00000000000c'::uuid,
     'e2000000-0000-0000-0000-00000000000c'::uuid,
     'e3000000-0000-0000-0000-000000000001'::uuid,
     'e4000000-0000-0000-0000-000000000001'::uuid,
     'Gala Org A', '2026-05-10', 200, 'Contact A', '0600000001',
     'e0000000-0000-0000-0000-00000000000a'::uuid),
    ('e5000000-0000-0000-0000-00000000000b'::uuid,
     'e0000000-0000-0000-0000-00000000000c'::uuid,
     'e0000000-0000-0000-0000-00000000000c'::uuid,
     'e1000000-0000-0000-0000-00000000000c'::uuid,
     'e2000000-0000-0000-0000-00000000000c'::uuid,
     'e3000000-0000-0000-0000-000000000001'::uuid,
     'e4000000-0000-0000-0000-000000000001'::uuid,
     'Gala Org B', '2026-05-11', 150, 'Contact B', '0600000002',
     'e0000000-0000-0000-0000-00000000000b'::uuid);

  -- Collectes cloturees : C-ZD-A + C-AG-A (EV-A) ; C-ZD-B (EV-B, cross)
  INSERT INTO plateforme.collectes (
    id, evenement_id, type, statut, date_collecte, heure_collecte,
    taux_recyclage, co2_induit_kg, co2_evite_kg, co2_net_kg, energie_primaire_evitee_kwh
  ) VALUES
    ('e7000000-0000-0000-0000-0000000000a1'::uuid, 'e5000000-0000-0000-0000-00000000000a'::uuid,
     'zero_dechet', 'cloturee', '2026-05-15', '08:00', 80.00, 10.00, 5.00, -5.00, 120.00),
    ('e7000000-0000-0000-0000-0000000000b1'::uuid, 'e5000000-0000-0000-0000-00000000000b'::uuid,
     'zero_dechet', 'cloturee', '2026-05-16', '08:00', 70.00, 8.00, 4.00, -4.00, 90.00);

  INSERT INTO plateforme.collectes (
    id, evenement_id, type, statut, date_collecte, heure_collecte, co2_evite_kg
  ) VALUES
    ('e7000000-0000-0000-0000-0000000000a2'::uuid, 'e5000000-0000-0000-0000-00000000000a'::uuid,
     'anti_gaspi', 'cloturee', '2026-05-17', '08:00', 200.00);

  INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg) VALUES
    ('e7000000-0000-0000-0000-0000000000a1'::uuid, (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'), 100.00);

  -- Association + transporteur (attribution AG)
  INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact) VALUES
    ('ea000000-0000-0000-0000-000000000001'::uuid, 'Asso M34', '1 Rue Asso', 'idf', 'Paris',
     'asso@org-test.local', 'Association test pour les scénarios M3.4 — fixtures pgTAP organisateur');

  INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms, contact_nom, contact_email, contact_telephone) VALUES
    ('eb000000-0000-0000-0000-000000000001'::uuid, 'Trans M34', '999999999', '1 Rue Trans', '75001', 'Paris',
     ARRAY['camionnette'], 'autre', 'Contact', 'trans@org-test.local', '0600000099');

  -- Attribution AG (volume_repas_realise = 80)
  INSERT INTO plateforme.attributions_antgaspi (
    collecte_id, association_id, transporteur_id, branche_attribution, mode_validation, volume_repas_realise
  ) VALUES
    ('e7000000-0000-0000-0000-0000000000a2'::uuid, 'ea000000-0000-0000-0000-000000000001'::uuid,
     'eb000000-0000-0000-0000-000000000001'::uuid, 'branche_1', 'manuel_top1', 80);

  -- Documents : rapport RSE (A + B cross), bordereau (A), attestation (A)
  INSERT INTO plateforme.rapports_rse (id, collecte_id, evenement_id, disponible_a, genere_at, pdf_url) VALUES
    ('ec000000-0000-0000-0000-0000000000a1'::uuid, 'e7000000-0000-0000-0000-0000000000a1'::uuid,
     'e5000000-0000-0000-0000-00000000000a'::uuid, '2026-05-16 08:00+00', '2026-05-16 08:00+00', 'rapports/a1.pdf'),
    ('ec000000-0000-0000-0000-0000000000b1'::uuid, 'e7000000-0000-0000-0000-0000000000b1'::uuid,
     'e5000000-0000-0000-0000-00000000000b'::uuid, '2026-05-17 08:00+00', '2026-05-17 08:00+00', 'rapports/b1.pdf');

  INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut, genere_at) VALUES
    ('ed000000-0000-0000-0000-0000000000a1'::uuid, 'e7000000-0000-0000-0000-0000000000a1'::uuid, 'emis', '2026-05-16 08:00+00');

  INSERT INTO plateforme.attestations_don (id, collecte_id, association_id, statut, genere_at, pdf_url) VALUES
    ('ee000000-0000-0000-0000-0000000000a1'::uuid, 'e7000000-0000-0000-0000-0000000000a2'::uuid,
     'ea000000-0000-0000-0000-000000000001'::uuid, 'emise', '2026-05-18 08:00+00', 'attestations/a2.pdf');

  -- Facture sur l'org CO-A elle-même (pour prouver le deny même org-scopé)
  INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, numero_facture, type, statut, date_emission, montant_ht, montant_tva, montant_ttc) VALUES
    ('ef000000-0000-0000-0000-0000000000a1'::uuid, 'e0000000-0000-0000-0000-00000000000a'::uuid,
     'e1000000-0000-0000-0000-00000000000c'::uuid, 'FZD-2026-09001', 'zero_dechet', 'emise', '2026-05-19', 100.00, 20.00, 120.00);
END $$;

-- ── Tests sous JWT client_organisateur A ────────────────────────────────────
SELECT test_set_jwt('client_organisateur', 'e0000000-0000-0000-0000-00000000000a'::uuid,
                    'e2000000-0000-0000-0000-00000000000a'::uuid);

-- T1 : rapport RSE de SON événement visible (rr_select élargi — dette 0.4c)
SELECT is(
  (SELECT count(*) FROM plateforme.rapports_rse WHERE id = 'ec000000-0000-0000-0000-0000000000a1'::uuid),
  1::bigint,
  'T1 : client organisateur lit le rapport RSE de son événement (chemin client_organisateur)'
);

-- T2 : rapport RSE d'un AUTRE organisateur invisible
SELECT is(
  (SELECT count(*) FROM plateforme.rapports_rse WHERE id = 'ec000000-0000-0000-0000-0000000000b1'::uuid),
  0::bigint,
  'T2 : rapport RSE d''un autre organisateur (CO-B) non visible (cloisonnement)'
);

-- T3 : bordereau de son événement visible (bord_client_orga_select)
SELECT is(
  (SELECT count(*) FROM plateforme.bordereaux_savr WHERE id = 'ed000000-0000-0000-0000-0000000000a1'::uuid),
  1::bigint,
  'T3 : client organisateur lit le bordereau ZD de son événement'
);

-- T4 : attestation de don de son événement visible (att_client_orga_select)
SELECT is(
  (SELECT count(*) FROM plateforme.attestations_don WHERE id = 'ee000000-0000-0000-0000-0000000000a1'::uuid),
  1::bigint,
  'T4 : client organisateur lit l''attestation de don de son événement'
);

-- T5 : attributions_antgaspi TOUJOURS deny (C-1, même sur ses événements)
SELECT is(
  (SELECT count(*) FROM plateforme.attributions_antgaspi WHERE collecte_id = 'e7000000-0000-0000-0000-0000000000a2'::uuid),
  0::bigint,
  'T5 : attributions AG non visibles au client organisateur (C-1)'
);

-- T6a : sa propre organisation lisible (A-4)
SELECT is(
  (SELECT count(*) FROM plateforme.organisations WHERE id = 'e0000000-0000-0000-0000-00000000000a'::uuid),
  1::bigint,
  'T6a : client organisateur lit sa propre organisation'
);

-- T6b : une autre organisation non lisible
SELECT is(
  (SELECT count(*) FROM plateforme.organisations WHERE id = 'e0000000-0000-0000-0000-00000000000c'::uuid),
  0::bigint,
  'T6b : client organisateur ne lit pas l''organisation du traiteur'
);

-- T7 : factures TOUJOURS deny (jamais d'accès financier, même org-scopé)
SELECT is(
  (SELECT count(*) FROM plateforme.factures WHERE id = 'ef000000-0000-0000-0000-0000000000a1'::uuid),
  0::bigint,
  'T7 : factures non visibles au client organisateur (aucun accès financier)'
);

-- T8 : f_volume_repas_realise expose l'impact AG de SA collecte (sans fuite C-1)
SELECT is(
  plateforme.f_volume_repas_realise('e7000000-0000-0000-0000-0000000000a2'::uuid),
  80::numeric,
  'T8 : f_volume_repas_realise = 80 pour la collecte AG du client organisateur'
);

-- T10 : v_kpi_client_organisateur sous JWT organisateur — nb_repas via helper
SELECT is(
  (SELECT nb_repas_donnes FROM plateforme.v_kpi_client_organisateur
   WHERE organisation_id = 'e0000000-0000-0000-0000-00000000000a'::uuid
     AND type_collecte = 'anti_gaspi' AND mois = '2026-05-01'::date),
  80::numeric,
  'T10 : vue KPI organisateur expose repas détournés=80 sous RLS (helper C-1-safe)'
);

-- T11 : vue KPI expose le détail CO2 ABC (induit + énergie primaire)
SELECT is(
  (SELECT co2_induit_kg FROM plateforme.v_kpi_client_organisateur
   WHERE organisation_id = 'e0000000-0000-0000-0000-00000000000a'::uuid
     AND type_collecte = 'zero_dechet' AND mois = '2026-05-01'::date),
  10::numeric,
  'T11 : vue KPI organisateur expose co2_induit_kg (règle ABC)'
);

-- T12 : ses collectes visibles (col_select via f_collecte_visible) = ZD + AG = 2
SELECT is(
  (SELECT count(*) FROM plateforme.collectes
   WHERE evenement_id = 'e5000000-0000-0000-0000-00000000000a'::uuid),
  2::bigint,
  'T12 : client organisateur voit les 2 collectes de son événement'
);

-- T13 : f_fichier_visible rapports_rse aligné sur f_collecte_visible (download bordereau/rapport)
SELECT ok(
  shared.f_fichier_visible('plateforme.rapports_rse', 'ec000000-0000-0000-0000-0000000000a1'::uuid),
  'T13 : f_fichier_visible autorise le rapport RSE du client organisateur'
);

-- ── Test sous JWT client_organisateur B (cross) ─────────────────────────────
SELECT test_set_jwt('client_organisateur', 'e0000000-0000-0000-0000-00000000000b'::uuid,
                    'e2000000-0000-0000-0000-00000000000b'::uuid);

-- T9 : helper ne fuit pas l'impact AG d'un autre organisateur
SELECT is(
  plateforme.f_volume_repas_realise('e7000000-0000-0000-0000-0000000000a2'::uuid),
  0::numeric,
  'T9 : f_volume_repas_realise = 0 pour un organisateur tiers (pas de fuite cross-org)'
);

SELECT * FROM finish();
ROLLBACK;
