-- M3.5 — Test pgTAP `v_kpi_admin` : CA AG « économique » + non-régression ZD
-- ============================================================================
-- Source : §11 §1.1 Bloc 2 (histogramme Revenus admin) + divergence Val 2026-07-07
-- (CA AG = coût/collecte du pack, imputé date_collecte, realisee/cloturee ;
--  REMPLACE la facture d'achat de pack — les factures achat_pack_antigaspi ET
--  leurs avoirs ne comptent plus dans le montant AG du dashboard de pilotage).
-- Couche : db — Priorité : P1-critique (calcul du revenu affiché au dashboard Admin).
--
-- `v_kpi_admin` est une vue service_role (createAdminSupabaseClient) : le runner
-- pgTAP se connecte en owner/superuser → bypass grants + RLS = comportement admin.
-- On ne bascule donc PAS en `authenticated` ici.
-- ============================================================================

BEGIN;

SELECT plan(4);

-- Triggers/FK-checks désactivés le temps d'insérer des fixtures terminales libres
-- (statuts cloturee/realisee sans faire tourner les triggers pack). N'affecte pas
-- les SELECT des assertions.
SET LOCAL session_replication_role = replica;

DO $$ BEGIN
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'KpiAdmin', 'KpiAdmin SAS', 'traiteur', '99999999999901', true, 1.50);

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
    ('e1000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'KpiAdmin SAS', '99999999999901', '1 Rue A', '75001', 'Paris');

  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
    ('e2000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'a@kpiadmin.local', 'A', 'B', 'admin_savr');

  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
    ('e3000000-0000-0000-0000-000000000001'::uuid, 'Salle', '1 Rue L', '75001', 'Paris', 'camionnette', 48.85, 2.35, 'idf');

  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
    ('e4000000-0000-0000-0000-000000000001'::uuid, 'GALA_VKA', 'Gala', 1, true);

  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
    created_by, lieu_id, type_evenement_id, nom_evenement, pax,
    contact_principal_nom, contact_principal_telephone
  ) VALUES
    ('e5000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid,
     'e0000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid,
     'e2000000-0000-0000-0000-000000000001'::uuid, 'e3000000-0000-0000-0000-000000000001'::uuid,
     'e4000000-0000-0000-0000-000000000001'::uuid, 'Evt', 100, 'Contact', '0600000000');

  -- Packs : P1 prix_unitaire_ht=120 ; P2 fallback (prix NULL → montant_total_ht/crédits = 1200/10 = 120).
  INSERT INTO plateforme.packs_antgaspi (
    id, organisation_id, statut, date_achat, mode_facturation, type_pack,
    credits_initiaux, credits_consommes, prix_unitaire_ht, montant_total_ht
  ) VALUES
    ('e6000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'epuise', '2026-05-01', 'par_collecte', 'personnalise', 10, 10, 120, 1200),
    ('e6000000-0000-0000-0000-000000000002'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'actif',  '2026-05-01', 'par_collecte', 'personnalise', 10,  5, NULL, 1200);

  -- Collectes AG : CA1 cloturee+P1(120), CA2 realisee+P2(fallback 120) → comptées ;
  --               CA3 programmee+P1 (statut non livré) et CA4 cloturee SANS pack → exclues du MONTANT ;
  --               toutes hors annulee/brouillon → comptées dans nb.
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, pack_antgaspi_id) VALUES
    ('e7000000-0000-0000-0000-000000000001'::uuid, 'e5000000-0000-0000-0000-000000000001'::uuid, 'anti_gaspi', 'cloturee',   '2026-05-10', '08:00', 'e6000000-0000-0000-0000-000000000001'::uuid),
    ('e7000000-0000-0000-0000-000000000002'::uuid, 'e5000000-0000-0000-0000-000000000001'::uuid, 'anti_gaspi', 'realisee',   '2026-05-12', '08:00', 'e6000000-0000-0000-0000-000000000002'::uuid),
    ('e7000000-0000-0000-0000-000000000003'::uuid, 'e5000000-0000-0000-0000-000000000001'::uuid, 'anti_gaspi', 'programmee', '2026-05-14', '08:00', 'e6000000-0000-0000-0000-000000000001'::uuid),
    ('e7000000-0000-0000-0000-000000000004'::uuid, 'e5000000-0000-0000-0000-000000000001'::uuid, 'anti_gaspi', 'cloturee',   '2026-05-16', '08:00', NULL);
  -- 1 collecte ZD (mai)
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte) VALUES
    ('e7000000-0000-0000-0000-000000000005'::uuid, 'e5000000-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'cloturee', '2026-05-15', '08:00');

  -- Factures : ZD 300 (mai, emise) ; avoir ZD -50 (mai) rattaché à la ZD ;
  --            achat_pack 5000 (mai) + son avoir -500 (mai) → IGNORÉS pour l'AG ;
  --            achat_pack 3000 (AVRIL, sans collecte AG livrée) → ne crée PAS de CA AG fantôme.
  INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, numero_facture, type, statut, date_emission, montant_ht, montant_tva, montant_ttc) VALUES
    ('e9000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid, 'FZD-VKA-1', 'zero_dechet',          'emise', '2026-05-20', 300, 60, 360),
    ('e9000000-0000-0000-0000-000000000003'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid, 'FPK-VKA-1', 'achat_pack_antigaspi', 'emise', '2026-05-05', 5000, 1000, 6000),
    ('e9000000-0000-0000-0000-000000000005'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid, 'FPK-VKA-2', 'achat_pack_antigaspi', 'emise', '2026-04-03', 3000, 600, 3600);
  INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, numero_facture, type, statut, date_emission, montant_ht, montant_tva, montant_ttc, facture_origine_id) VALUES
    ('e9000000-0000-0000-0000-000000000002'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid, 'AVZD-VKA-1', 'avoir', 'emise', '2026-05-25',  50,  10,  60, 'e9000000-0000-0000-0000-000000000001'::uuid),
    ('e9000000-0000-0000-0000-000000000004'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid, 'AVPK-VKA-1', 'avoir', 'emise', '2026-05-06', 500, 100, 600, 'e9000000-0000-0000-0000-000000000003'::uuid);
END $$;

SET LOCAL session_replication_role = origin;

-- ─── T1 : CA AG mai = coût/collecte pack (realisee/cloturee) ─────────────────
-- P1 120 + P2 fallback (1200/10=120) = 240 ; programmee + sans-pack exclus ;
-- facture achat_pack 5000 + son avoir -500 IGNORÉS.
SELECT is(
  (SELECT ROUND(montant_factures_ht::numeric, 2)
     FROM plateforme.v_kpi_admin
    WHERE mois = '2026-05-01'::date AND type_collecte = 'anti_gaspi'),
  240.00::numeric,
  'T1 — CA AG mai = coût/collecte pack (240€ : 120 + fallback 120), facture/avoir pack ignorés'
);

-- ─── T2 : nb AG découplé du montant ─────────────────────────────────────────
-- 4 collectes AG hors annulee/brouillon (dont programmee + sans pack).
SELECT is(
  (SELECT nb_collectes
     FROM plateforme.v_kpi_admin
    WHERE mois = '2026-05-01'::date AND type_collecte = 'anti_gaspi'),
  4::bigint,
  'T2 — nb AG = 4 (compté hors annulee/brouillon, découplé du montant)'
);

-- ─── T3 : ZD inchangé = factures emise/payee - avoir ZD (par date_emission) ──
SELECT is(
  (SELECT ROUND(montant_factures_ht::numeric, 2)
     FROM plateforme.v_kpi_admin
    WHERE mois = '2026-05-01'::date AND type_collecte = 'zero_dechet'),
  250.00::numeric,
  'T3 — CA ZD mai = 300 - 50 (avoir) = 250, factures par date_emission'
);

-- ─── T4 : facture d'achat de pack seule (avril) ne crée pas de CA AG fantôme ─
SELECT is(
  COALESCE((SELECT ROUND(montant_factures_ht::numeric, 2)
              FROM plateforme.v_kpi_admin
             WHERE mois = '2026-04-01'::date AND type_collecte = 'anti_gaspi'), 0::numeric),
  0::numeric,
  'T4 — achat pack avril (3000€) sans collecte AG livrée → CA AG avril = 0'
);

SELECT * FROM finish();

ROLLBACK;
