-- pgTAP M2.3 — Algo attribution AG
-- Tests : moteur algo IDF/province, trigger poids→volume, immutabilité mode_validation, RLS.

BEGIN;
SELECT plan(34);

-- ── Helpers JWT ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'role', p_role,
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

-- ── Fixtures communes ─────────────────────────────────────────────────────

-- Organisation
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('a0000000-0000-0000-0000-000000000001'::uuid, 'OrgTest M2.3', 'OrgTest M2.3 SARL', 'traiteur', '12300000000000', true);

-- Organisation cross-org (isolation RLS)
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('a0000000-0000-0000-0000-000000000002'::uuid, 'OrgTest Autre', 'OrgTest Autre SARL', 'traiteur', '99900000000000', true);

-- Entité facturation
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('a0000000-0000-0000-0000-000000000011'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid,
  'OrgTest M2.3 SARL', '12300000000000', '1 Rue Test', '75001', 'Paris');

-- User admin
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('a0000000-0000-0000-0000-000000000010'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid,
  'admin-m23@test.test', 'Admin', 'M23', 'admin_savr');

-- User manager traiteur (pour tests RLS deny)
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('a0000000-0000-0000-0000-000000000012'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid,
  'mgr-m23@test.test', 'Mgr', 'M23', 'traiteur_manager');

-- User ops_savr
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('a0000000-0000-0000-0000-000000000013'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid,
  'ops-m23@test.test', 'Ops', 'M23', 'ops_savr');

-- Type événement
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('a0000000-0000-0000-0000-000000000009'::uuid, 'GALA_M23', 'Gala M2.3 Test', 1, true);

-- Lieu IDF (75001, coord Paris centre)
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max, latitude, longitude, region)
VALUES ('a0000000-0000-0000-0000-000000000020'::uuid, 'Lieu IDF Paris', '1 Rue Rivoli', 'Paris', '75001', 'camionnette', 48.8566, 2.3522, 'idf');

-- Lieu province (Rouen)
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max, latitude, longitude, region)
VALUES ('a0000000-0000-0000-0000-000000000021'::uuid, 'Lieu Province Rouen', '5 Quai de Rouen', 'Rouen', '76000', 'camionnette', 49.4431, 1.0993, 'province');

-- Associations IDF (top 3 à distances croissantes)
-- asso_proche : 4.2 km, capacite=500 (500×2=1000 > volume 200 ✓)
INSERT INTO plateforme.associations (id, nom, adresse, ville, region, contact_email, capacite_max_beneficiaires, actif, description_rapport_impact, latitude, longitude)
VALUES
  ('a0000000-0000-0000-0000-000000000030'::uuid, 'Asso Proche IDF', '10 Rue Proche', 'Paris', 'idf', 'proche@asso.test', 500, true, 'Association IDF proche, dessert le secteur Paris centre.', 48.8606, 2.3933),
  ('a0000000-0000-0000-0000-000000000031'::uuid, 'Asso Moyenne IDF', '20 Rue Milieu', 'Paris', 'idf', 'milieu@asso.test', 700, true, 'Association IDF moyenne, couvre le grand Paris nord-est.', 48.8676, 2.4122),
  ('a0000000-0000-0000-0000-000000000032'::uuid, 'Asso Loin IDF', '30 Rue Loin', 'Paris', 'idf', 'loin@asso.test', 900, true, 'Association IDF lointaine, dessert le grand Paris Est.', 48.8346, 2.4522),
  -- asso avec capacite exactement = volume/2 → exclue (500×2=1000 NOT > 1000)
  ('a0000000-0000-0000-0000-000000000033'::uuid, 'Asso Capacite Limite IDF', '40 Rue Limite', 'Paris', 'idf', 'limite@asso.test', 500, true, 'Association IDF, limite de capacité pour test filtre algo.', 48.8416, 2.3022),
  -- asso avec capacite 501 → incluse (501×2=1002 > 1000)
  ('a0000000-0000-0000-0000-000000000034'::uuid, 'Asso Capacite 501 IDF', '50 Rue Ok', 'Paris', 'idf', 'ok@asso.test', 501, true, 'Association IDF capacité 501, incluse dans le top-3 algo.', 48.8456, 2.3122);

-- Transporteur Marathon (MTS-1, IDF)
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, type_tms, actif, contact_nom, contact_email, contact_telephone, types_vehicules, latitude, longitude)
VALUES
  ('a0000000-0000-0000-0000-000000000040'::uuid, 'Marathon Test', '123456789', '22 Rue Marathon', '75020', 'Paris', 'mts1', true, 'Contact Marathon', 'marathon@test.test', '0600000001', ARRAY['fourgon','poids_lourd'], 48.8616, 2.3722),
  ('a0000000-0000-0000-0000-000000000041'::uuid, 'A Toutes Test', '987654321', '3 Rue Velo', '75011', 'Paris', 'a_toutes', true, 'Contact A Toutes', 'atoutes@test.test', '0600000002', ARRAY['velo_cargo'], 48.8536, 2.3622);

-- Prestataire shared pour Marathon (requis pour algo province)
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, siret, statut)
VALUES ('a0000000-0000-0000-0000-000000000050'::uuid, 'Marathon Test', 'MARATHON_TEST', ARRAY['ag'], 'mts1', '123456789012345', 'actif')
ON CONFLICT (id) DO NOTHING;

-- Mettre les params algo en mode A Toutes disponible pour certains tests
-- (on les restaurera après)

-- ── Événements + collectes de test ────────────────────────────────────────

-- Événement IDF (200 pax, heure matin)
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'a0000000-0000-0000-0000-000000000060'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000011'::uuid,
  'a0000000-0000-0000-0000-000000000010'::uuid,
  'a0000000-0000-0000-0000-000000000020'::uuid,
  'a0000000-0000-0000-0000-000000000009'::uuid,
  CURRENT_DATE + 7, 200,
  'Contact Evt', '0600000099'
);

-- Événement IDF grand volume (600 pax exactement = seuil) — utilisé par T2
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'a0000000-0000-0000-0000-000000000062'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000011'::uuid,
  'a0000000-0000-0000-0000-000000000010'::uuid,
  'a0000000-0000-0000-0000-000000000020'::uuid,
  'a0000000-0000-0000-0000-000000000009'::uuid,
  CURRENT_DATE + 7, 600,
  'Contact Evt Grand Volume', '0600000099'
);

-- Événement IDF capacité (pax=10000) — trigger → volume_estime_repas=ROUND(0.10*10000)=1000 — utilisé par T6/T6b/T7
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'a0000000-0000-0000-0000-000000000063'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000011'::uuid,
  'a0000000-0000-0000-0000-000000000010'::uuid,
  'a0000000-0000-0000-0000-000000000020'::uuid,
  'a0000000-0000-0000-0000-000000000009'::uuid,
  CURRENT_DATE + 7, 10000,
  'Contact Evt Capacite', '0600000099'
);

-- Événement IDF no-asso (pax=20000) — trigger → volume_estime_repas=2000, exclut toutes les assos (cap max=900, 900×2=1800<2000) — utilisé par T24
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'a0000000-0000-0000-0000-000000000064'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000011'::uuid,
  'a0000000-0000-0000-0000-000000000010'::uuid,
  'a0000000-0000-0000-0000-000000000020'::uuid,
  'a0000000-0000-0000-0000-000000000009'::uuid,
  CURRENT_DATE + 7, 20000,
  'Contact Evt No Asso', '0600000099'
);

-- Collecte AG IDF — heure 10:00, futur lointain (délai > 90 min)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000070'::uuid,
  'a0000000-0000-0000-0000-000000000060'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '10:00', 200
);

-- Collecte AG IDF — nuit (heure 22:00)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000071'::uuid,
  'a0000000-0000-0000-0000-000000000060'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '22:00', 200
);

-- Collecte AG IDF — grand volume (600 pax = seuil, heure 12:00) — liée à événement 0062 (pax=600)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000072'::uuid,
  'a0000000-0000-0000-0000-000000000062'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '12:00', 600
);

-- Collecte AG IDF — volume 599 pax (sous seuil vélo)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000073'::uuid,
  'a0000000-0000-0000-0000-000000000060'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '12:00', 599
);

-- Collecte pour test RLS cross-org (org2)
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'a0000000-0000-0000-0000-000000000061'::uuid,
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'a0000000-0000-0000-0000-000000000011'::uuid,
  'a0000000-0000-0000-0000-000000000010'::uuid,
  'a0000000-0000-0000-0000-000000000020'::uuid,
  'a0000000-0000-0000-0000-000000000009'::uuid,
  CURRENT_DATE + 7, 100, 'Contact Org2', '0600000099'
);
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000074'::uuid,
  'a0000000-0000-0000-0000-000000000061'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '10:00', 100
);

-- Forcer a_toutes_indisponible=false pour les tests IDF qui en ont besoin
UPDATE plateforme.parametres_algo
SET valeur = 'false'::jsonb
WHERE cle = 'a_toutes_indisponible';

-- ── T1 : Branche IDF nuit (heure 22:00 >= 20:00) → ag_marathon_nuit ──────

SELECT is(
  (plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000071'::uuid
  ))->>'branche',
  'ag_marathon_nuit',
  'T1 : heure 22:00 → branche ag_marathon_nuit'
);

-- ── T2 : Branche IDF grand volume (600 pax = seuil) → ag_marathon_volume ──

SELECT is(
  (plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000072'::uuid
  ))->>'branche',
  'ag_marathon_volume',
  'T2 : 600 pax >= seuil 600 → branche ag_marathon_volume'
);

-- ── T3 : Branche IDF vélo programmé (599 pax, A Toutes dispo) → ag_velo_programme/express

SELECT ok(
  (plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000073'::uuid
  ))->>'branche' IN ('ag_velo_programme', 'ag_velo_express'),
  'T3 : 599 pax + A Toutes dispo → branche vélo (programme ou express selon délai)'
);

-- ── T4 : a_toutes_indisponible=true → branche vélo fallback Marathon ──────

UPDATE plateforme.parametres_algo SET valeur = 'true'::jsonb WHERE cle = 'a_toutes_indisponible';

SELECT is(
  (plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000073'::uuid
  ))->>'branche',
  'ag_velo_fallback_marathon',
  'T4 : a_toutes_indisponible=true + 599 pax → ag_velo_fallback_marathon'
);

UPDATE plateforme.parametres_algo SET valeur = 'false'::jsonb WHERE cle = 'a_toutes_indisponible';

-- ── T5 : Heure 07:00 exactement = plage début = JOUR (pas nuit) ──────────

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000075'::uuid,
  'a0000000-0000-0000-0000-000000000060'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '07:00', 200
);

SELECT ok(
  (plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000075'::uuid
  ))->>'branche' IN ('ag_velo_programme', 'ag_velo_express', 'ag_velo_fallback_marathon'),
  'T5 : heure 07:00 exactement = début plage → branche JOUR (pas nuit)'
);

-- ── T6 : Filtre capacité stricte — association exclue si cap×2 = volume ──

-- Test avec volume_estime_repas=1000 (trigger: ROUND(0.10*10000)=1000), asso cap=500 → 500×2=1000 NOT > 1000
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000076'::uuid,
  'a0000000-0000-0000-0000-000000000063'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '10:00', 1000
);

-- Toutes les assos IDF ont capacite ≤ 900 sauf None > 1000/2 = 500 exact
-- asso_proche cap=500 → 500×2=1000 NOT > 1000 → exclue
-- asso_moyenne cap=700 → 700×2=1400 > 1000 → incluse
-- asso_loin cap=900 → 900×2=1800 > 1000 → incluse
-- asso_limite cap=500 → 500×2=1000 NOT > 1000 → exclue
-- asso_501 cap=501 → 501×2=1002 > 1000 → incluse
SELECT ok(
  ((plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000076'::uuid
  ))->>'assoc_count')::integer >= 1,
  'T6 : volume=1000 → asso cap=700+ incluses (cap×2 > 1000 strict)'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      (plateforme.fn_calculer_algo_attribution_ag(
        'a0000000-0000-0000-0000-000000000076'::uuid
      ))->'associations'
    ) a
    WHERE (a->>'id')::uuid IN (
      'a0000000-0000-0000-0000-000000000030'::uuid,  -- cap=500 exactement
      'a0000000-0000-0000-0000-000000000033'::uuid   -- cap=500 exactement
    )
  ),
  'T6b : associations avec capacite=500 exclues (500×2=1000 NOT > 1000)'
);

-- ── T7 : Asso capacite 501 → incluse (501×2=1002 > 1000) ────────────────

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      (plateforme.fn_calculer_algo_attribution_ag(
        'a0000000-0000-0000-0000-000000000076'::uuid
      ))->'associations'
    ) a
    WHERE (a->>'id')::uuid = 'a0000000-0000-0000-0000-000000000034'::uuid
  ),
  'T7 : association cap=501 incluse (501×2=1002 > 1000)'
);

-- ── T8 : Algo retourne bien les 3 associations max ───────────────────────

SELECT ok(
  ((plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000070'::uuid
  ))->>'assoc_count')::integer <= 3,
  'T8 : algo retourne max 3 associations'
);

-- ── T9 : Trigger poids_repas_kg → volume_repas_realise (ceil) ────────────

-- Créer une attribution de test
INSERT INTO plateforme.attributions_antgaspi (
  id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation
) VALUES (
  'a0000000-0000-0000-0000-000000000080'::uuid,
  'a0000000-0000-0000-0000-000000000070'::uuid,
  'a0000000-0000-0000-0000-000000000030'::uuid,
  'a0000000-0000-0000-0000-000000000040'::uuid,
  'ag_marathon_nuit',
  'manuel_top1'
);

-- poids=202.3, coef=0.45 → ceil(202.3/0.45) = ceil(449.555...) = 450
UPDATE plateforme.attributions_antgaspi
SET poids_repas_kg = 202.3
WHERE id = 'a0000000-0000-0000-0000-000000000080'::uuid;

SELECT is(
  (SELECT volume_repas_realise FROM plateforme.attributions_antgaspi
   WHERE id = 'a0000000-0000-0000-0000-000000000080'::uuid),
  450,
  'T9 : trigger poids 202.3 kg → volume = ceil(202.3/0.45) = 450'
);

-- ── T10 : poids=135.0 → volume = ceil(135/0.45) = 300 ───────────────────

UPDATE plateforme.attributions_antgaspi
SET poids_repas_kg = 135.0
WHERE id = 'a0000000-0000-0000-0000-000000000080'::uuid;

SELECT is(
  (SELECT volume_repas_realise FROM plateforme.attributions_antgaspi
   WHERE id = 'a0000000-0000-0000-0000-000000000080'::uuid),
  300,
  'T10 : trigger poids 135.0 kg → volume = ceil(135.0/0.45) = 300'
);

-- ── T11 : mode_validation immuable post-INSERT ────────────────────────────

SELECT throws_ok(
  $$UPDATE plateforme.attributions_antgaspi
    SET mode_validation = 'manuel_override'
    WHERE id = 'a0000000-0000-0000-0000-000000000080'::uuid$$,
  'P0021',
  NULL,
  'T11 : UPDATE mode_validation → exception P0021 (immuable)'
);

-- ── T12 : RLS admin_savr INSERT attributions_antgaspi ────────────────────

SELECT test_set_jwt('admin_savr', 'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000010'::uuid);

SELECT lives_ok(
  $$INSERT INTO plateforme.attributions_antgaspi (
      id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation
    ) VALUES (
      'a0000000-0000-0000-0000-000000000081'::uuid,
      'a0000000-0000-0000-0000-000000000071'::uuid,
      'a0000000-0000-0000-0000-000000000030'::uuid,
      'a0000000-0000-0000-0000-000000000040'::uuid,
      'ag_marathon_nuit',
      'manuel_top1'
    )$$,
  'T12 : admin_savr peut INSERT attributions_antgaspi'
);

-- ── T13 : RLS manager_traiteur DENY INSERT attributions_antgaspi ─────────

SELECT test_set_jwt('traiteur_manager', 'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000012'::uuid);

SELECT throws_ok(
  $$INSERT INTO plateforme.attributions_antgaspi (
      id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation
    ) VALUES (
      'a0000000-0000-0000-0000-000000000082'::uuid,
      'a0000000-0000-0000-0000-000000000073'::uuid,
      'a0000000-0000-0000-0000-000000000030'::uuid,
      'a0000000-0000-0000-0000-000000000040'::uuid,
      'ag_marathon_volume',
      'manuel_top1'
    )$$,
  '42501',
  NULL,
  'T13 : manager_traiteur DENY INSERT attributions_antgaspi (42501)'
);

-- ── T14 : RLS manager_traiteur voit sa propre attribution ────────────────

SELECT test_as_superuser();
-- Créer attribution pour org1 (collecte 0070)
INSERT INTO plateforme.attributions_antgaspi (
  id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation
) VALUES (
  'a0000000-0000-0000-0000-000000000083'::uuid,
  'a0000000-0000-0000-0000-000000000076'::uuid,
  'a0000000-0000-0000-0000-000000000031'::uuid,
  'a0000000-0000-0000-0000-000000000040'::uuid,
  'ag_marathon_volume',
  'manuel_top1'
);

SELECT test_set_jwt('traiteur_manager', 'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000012'::uuid);

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.attributions_antgaspi
   WHERE id = 'a0000000-0000-0000-0000-000000000083'::uuid),
  1,
  'T14 : manager_traiteur voit sa propre attribution (org1)'
);

-- ── T15 : RLS manager_traiteur ne voit PAS attribution autre org ──────────

SELECT test_as_superuser();
INSERT INTO plateforme.attributions_antgaspi (
  id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation
) VALUES (
  'a0000000-0000-0000-0000-000000000084'::uuid,
  'a0000000-0000-0000-0000-000000000074'::uuid,
  'a0000000-0000-0000-0000-000000000030'::uuid,
  'a0000000-0000-0000-0000-000000000040'::uuid,
  'ag_marathon_nuit',
  'manuel_top1'
);

SELECT test_set_jwt('traiteur_manager', 'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000012'::uuid);

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.attributions_antgaspi
   WHERE id = 'a0000000-0000-0000-0000-000000000084'::uuid),
  0,
  'T15 : manager_traiteur ne voit PAS attribution org2 (RLS isolement cross-org)'
);

-- ── T16 : RLS ops_savr peut lire parametres_algo ─────────────────────────

SELECT test_set_jwt('ops_savr', 'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000013'::uuid);

SELECT ok(
  (SELECT COUNT(*)::integer FROM plateforme.parametres_algo
   WHERE cle = 'a_toutes_indisponible') = 1,
  'T16 : ops_savr peut SELECT parametres_algo'
);

-- ── T17 : RLS ops_savr DENY UPDATE parametres_algo ───────────────────────

WITH u AS (
  UPDATE plateforme.parametres_algo
  SET valeur = 'false'::jsonb
  WHERE cle = 'a_toutes_indisponible'
  RETURNING 1
)
SELECT is(COUNT(*)::integer, 0, 'T17 : ops_savr UPDATE parametres_algo → 0 lignes (deny silencieux UPDATE)')
FROM u;

-- ── T18 : RLS manager_traiteur ne voit PAS parametres_algo ───────────────

SELECT test_set_jwt('traiteur_manager', 'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000012'::uuid);

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.parametres_algo),
  0,
  'T18 : manager_traiteur SELECT parametres_algo → 0 lignes (deny RLS)'
);

-- ── T19 : RLS ops_savr DENY UPDATE config_auto_accept_ag ─────────────────

SELECT test_as_superuser();
INSERT INTO plateforme.config_auto_accept_ag (id, organisation_id, association_id, auto_accept_actif)
VALUES ('a0000000-0000-0000-0000-000000000090'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000030'::uuid,
  true);

SELECT test_set_jwt('ops_savr', 'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000013'::uuid);

WITH u AS (
  UPDATE plateforme.config_auto_accept_ag
  SET auto_accept_actif = false
  WHERE id = 'a0000000-0000-0000-0000-000000000090'::uuid
  RETURNING 1
)
SELECT is(COUNT(*)::integer, 0, 'T19 : ops_savr UPDATE config_auto_accept_ag → 0 lignes (deny RLS)')
FROM u;

-- ── T20 : RPC rpc_valider_attribution_ag (superuser) ─────────────────────

SELECT test_as_superuser();

-- Mettre à jour le seed parametres_algo avec la bonne valeur
UPDATE plateforme.parametres_algo SET valeur = 'false'::jsonb WHERE cle = 'a_toutes_indisponible';

SELECT ok(
  (plateforme.rpc_valider_attribution_ag(
    'a0000000-0000-0000-0000-000000000075'::uuid,
    'a0000000-0000-0000-0000-000000000030'::uuid,
    'a0000000-0000-0000-0000-000000000040'::uuid,
    'ag_marathon_nuit',
    'manuel_top1',
    'a0000000-0000-0000-0000-000000000010'::uuid
  ))->>'ok' = 'true',
  'T20 : rpc_valider_attribution_ag retourne ok=true'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM plateforme.attributions_antgaspi
    WHERE collecte_id = 'a0000000-0000-0000-0000-000000000075'::uuid
      AND mode_validation = 'manuel_top1'
  ),
  'T20b : attribution_antgaspi créée après RPC valider'
);

-- ── T21 : outbox event attribution.validee émis ───────────────────────────

SELECT ok(
  EXISTS (
    SELECT 1 FROM plateforme.outbox_events
    WHERE aggregate_id = 'a0000000-0000-0000-0000-000000000075'::uuid
      AND event_type = 'attribution.validee'
      AND consumer = 'attribution_job'
  ),
  'T21 : outbox_events contient event attribution.validee (G4 garde-fou)'
);

-- ── T22 : RPC refuse doublon (UNIQUE collecte_id) ────────────────────────

SELECT throws_ok(
  $$SELECT plateforme.rpc_valider_attribution_ag(
    'a0000000-0000-0000-0000-000000000075'::uuid,
    'a0000000-0000-0000-0000-000000000030'::uuid,
    'a0000000-0000-0000-0000-000000000040'::uuid,
    'ag_marathon_nuit',
    'manuel_top1',
    'a0000000-0000-0000-0000-000000000010'::uuid
  )$$,
  'P0044',
  NULL,
  'T22 : RPC valider doublon → exception P0044 (attribution déjà existante)'
);

-- ── T23 : heure 20:00 exactement = plage fin = NUIT ──────────────────────

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000077'::uuid,
  'a0000000-0000-0000-0000-000000000060'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '20:00', 200
);

SELECT is(
  (plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000077'::uuid
  ))->>'branche',
  'ag_marathon_nuit',
  'T23 : heure 20:00 exactement = fin plage → branche NUIT (condition >= fin)'
);

-- ── T24 : algo retourne no_asso=true si aucune association éligible ───────

-- Créer collecte avec volume énorme (trigger: ROUND(0.10*20000)=2000, cap max=900 → 900×2=1800 < 2000 → toutes exclues)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000078'::uuid,
  'a0000000-0000-0000-0000-000000000064'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '10:00', 99999
);

SELECT ok(
  ((plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000078'::uuid
  ))->>'no_asso')::boolean = true,
  'T24 : volume trop grand → no_asso=true, aucune association éligible'
);

-- ── T25 : parametres_algo contient bien les 7 clés AG ────────────────────

SELECT test_as_superuser();

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.parametres_algo
   WHERE cle IN (
     'regle_ag_plage_velo_debut', 'regle_ag_plage_velo_fin',
     'regle_ag_seuil_pax_velo', 'regle_ag_seuil_h2_minutes',
     'poids_par_repas_kg', 'a_toutes_indisponible', 'everest_codes_postaux'
   )),
  7,
  'T25 : 7 paramètres AG présents dans parametres_algo'
);

-- ── T26 : email templates AG présents (3 nouveaux) ───────────────────────

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.email_templates
   WHERE code IN ('ag_attribution_association', 'ag_attribution_transporteur', 'ag_a_toutes_indispo')
     AND actif = true),
  3,
  'T26 : 3 templates email AG actifs dans email_templates'
);

-- ── T27 : trigger fn_trg_calc_volume_repas_realise existe ────────────────

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_calc_volume_repas_realise'
      AND tgrelid = 'plateforme.attributions_antgaspi'::regclass
  ),
  'T27 : trigger trg_calc_volume_repas_realise existe'
);

-- ── T28 : trigger trg_mode_validation_immutable existe ───────────────────

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_mode_validation_immutable'
      AND tgrelid = 'plateforme.attributions_antgaspi'::regclass
  ),
  'T28 : trigger trg_mode_validation_immutable existe'
);

-- ── T29 : algo province retourne ag_province_proximite ───────────────────

-- Événement province (lieu Rouen)
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'a0000000-0000-0000-0000-000000000065'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a0000000-0000-0000-0000-000000000011'::uuid,
  'a0000000-0000-0000-0000-000000000010'::uuid,
  'a0000000-0000-0000-0000-000000000021'::uuid,  -- lieu province Rouen
  'a0000000-0000-0000-0000-000000000009'::uuid,
  CURRENT_DATE + 7, 200, 'Contact Province', '0600000099'
);

-- Asso province
INSERT INTO plateforme.associations (id, nom, adresse, ville, region, contact_email, capacite_max_beneficiaires, actif, description_rapport_impact, latitude, longitude)
VALUES ('a0000000-0000-0000-0000-000000000035'::uuid, 'Asso Province Rouen', '1 Rue Province', 'Rouen', 'province', 'rouen@asso.test', 800, true, 'Association province Normandie, collectes invendus Rouen.', 49.4431, 1.0993);

-- Transporteur province (pas a_toutes, actif)
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, type_tms, actif, contact_nom, contact_email, contact_telephone, types_vehicules, latitude, longitude)
VALUES ('a0000000-0000-0000-0000-000000000042'::uuid, 'Transnormandie Test', '456789123', '5 Quai', '76000', 'Rouen', 'mts1', true, 'Contact Trans', 'trans@test.test', '0600000003', ARRAY['fourgon'], 49.4431, 1.0993);

INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, siret, statut, nb_collectes_6_mois_cache)
VALUES ('a0000000-0000-0000-0000-000000000051'::uuid, 'Transnormandie Test', 'TRANSNOR_TEST', ARRAY['ag'], 'mts1', '456789123012345', 'actif', 5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000079'::uuid,
  'a0000000-0000-0000-0000-000000000065'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '10:00', 200
);

SELECT is(
  (plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000079'::uuid
  ))->>'branche',
  'ag_province_proximite',
  'T29 : province → branche ag_province_proximite'
);

-- ── T30 : Audit log écrit lors de la saisie poids ────────────────────────

SELECT ok(
  EXISTS (
    SELECT 1 FROM plateforme.audit_log
    WHERE table_name = 'attributions_antgaspi'
      AND record_id = 'a0000000-0000-0000-0000-000000000080'::uuid
      AND action = 'poids_repas_saisi_ops'
  ),
  'T30 : audit_log contient entrée poids_repas_saisi_ops après UPDATE poids'
);

-- ── T31 : ag_everest_camion_express — grand volume urgent IDF, Marathon absent ──
-- Conditions : pax=600 >= seuil, Marathon inactif → pas ag_marathon_volume,
--              A Toutes! dispo + IDF + délai négatif (passé) < 90 min → ag_everest_camion_express

UPDATE plateforme.transporteurs SET actif = false
WHERE id = 'a0000000-0000-0000-0000-000000000040'::uuid;

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000091'::uuid,
  'a0000000-0000-0000-0000-000000000062'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE - 1, '12:00', 650
);

SELECT is(
  (plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000091'::uuid
  ))->>'branche',
  'ag_everest_camion_express',
  'T31 : grand volume IDF urgent, Marathon absent, A Toutes! dispo → ag_everest_camion_express'
);

UPDATE plateforme.transporteurs SET actif = true
WHERE id = 'a0000000-0000-0000-0000-000000000040'::uuid;

-- ── T32 : ag_marathon_volume_backup_camion — grand volume non-urgent IDF, Marathon absent ──
-- Symétrique de T31 mais délai >= 90 min (J+7 → ~10 080 min >> seuil_h2=90)

UPDATE plateforme.transporteurs SET actif = false
WHERE id = 'a0000000-0000-0000-0000-000000000040'::uuid;

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES (
  'a0000000-0000-0000-0000-000000000092'::uuid,
  'a0000000-0000-0000-0000-000000000062'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  CURRENT_DATE + 7, '12:00', 650
);

SELECT is(
  (plateforme.fn_calculer_algo_attribution_ag(
    'a0000000-0000-0000-0000-000000000092'::uuid
  ))->>'branche',
  'ag_marathon_volume_backup_camion',
  'T32 : grand volume IDF non-urgent, Marathon absent, A Toutes! dispo → ag_marathon_volume_backup_camion'
);

UPDATE plateforme.transporteurs SET actif = true
WHERE id = 'a0000000-0000-0000-0000-000000000040'::uuid;

SELECT * FROM finish();
ROLLBACK;
