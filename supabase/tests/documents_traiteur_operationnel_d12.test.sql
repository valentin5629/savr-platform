-- =============================================================================
-- Documents d'une collecte programmée par une agence : ce que lit le traiteur
-- OPÉRATIONNEL (D12, arbitrage Val 2026-09-30)
-- =============================================================================
-- La fiche collecte client et la route /api/v1/traiteur/collectes/[id]/
-- rapport-rse/download lisent désormais les documents sous la RLS du traiteur
-- (la lecture service-role historique est retirée). Ce fichier fixe en base ce
-- que ce passage en RLS garantit — sans lui, D12 ne tiendrait que par des mocks :
--   · attestations_don / att_traiteur_select : l'attestation de don d'une
--     collecte AG programmée par une agence (donateur = l'agence, raison sociale
--     + SIRET) est REFUSÉE au traiteur opérationnel, manager comme commercial.
--     Un alignement « par cohérence » de att_traiteur_select sur
--     f_collecte_visible (comme rr_select en 20260617150000) rouvrirait la
--     fuite : ce fichier deviendrait rouge ;
--   · rapports_rse / rr_select : le rapport RSE ZD et le rapport « sans
--     excédent » de l'agence RESTENT servis au traiteur opérationnel ;
--   · miroirs positifs : programmateur (manager, commercial non créateur),
--     agence donneuse d'ordre ; cross-org et gestionnaire d'un autre lieu = 0 ;
--   · gestionnaire du lieu : attestations servies (§06.05 l.619, D9 non fermé),
--     attributions refusées par la TABLE (aa_select, C-1 intacte) ; nb_repas de
--     l'attestation lui reste lisible (document servi). Depuis 20261004190000,
--     « Repas donnés » sur une collecte tierce est lu par la vue
--     v_attributions_gestionnaire, plus par l'attestation (ex-repli D13).
-- Requêtes q_* = requêtes EXACTES des chemins applicatifs (fiche + route).
-- Témoins de non-vacuité NV1-NV3 : un 0 est un refus RLS, pas une absence.
-- Sonde écrite par reviewer-rls-securite (revue 2026-09-30), reprise ici.
-- =============================================================================

BEGIN;
SELECT plan(42);

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', NULL, true); END $$;

-- Requêtes EXACTES des chemins applicatifs (fiche + route download)
CREATE OR REPLACE FUNCTION q_att(p uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM (SELECT id, eligible_at, pdf_url FROM plateforme.attestations_don WHERE collecte_id = p ORDER BY version DESC LIMIT 1) s $$;
CREATE OR REPLACE FUNCTION q_rr(p uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM (SELECT id, disponible_a, genere_at, regenere_at, pdf_url FROM plateforme.rapports_rse WHERE collecte_id = p ORDER BY version DESC LIMIT 1) s $$;
CREATE OR REPLACE FUNCTION q_col(p uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM plateforme.collectes c JOIN plateforme.evenements e ON e.id = c.evenement_id WHERE c.id = p $$;
CREATE OR REPLACE FUNCTION q_aa(p uuid) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM plateforme.attributions_antgaspi WHERE collecte_id = p $$;

SELECT test_as_superuser();
DO $$ BEGIN
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
   ('d1200000-0000-0000-0000-0000000000a1','Agence D12','Agence D12 SAS','agence','51200000000011',true),
   ('d1200000-0000-0000-0000-0000000000a2','Traiteur Op D12','Traiteur Op SAS','traiteur','51200000000022',true),
   ('d1200000-0000-0000-0000-0000000000a3','Traiteur Propre D12','Traiteur Propre SAS','traiteur','51200000000033',true),
   ('d1200000-0000-0000-0000-0000000000a4','Traiteur Tiers D12','Traiteur Tiers SAS','traiteur','51200000000044',true),
   ('d1200000-0000-0000-0000-0000000000a5','Gestionnaire D12','Gest SAS','gestionnaire_lieux','51200000000055',true),
   ('d1200000-0000-0000-0000-0000000000a6','Gestionnaire X D12','GestX SAS','gestionnaire_lieux','51200000000066',true);
  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
   ('d1210000-0000-0000-0000-0000000000a1','d1200000-0000-0000-0000-0000000000a1','Agence D12 SAS','51200000000011','1 r','75001','Paris'),
   ('d1210000-0000-0000-0000-0000000000a3','d1200000-0000-0000-0000-0000000000a3','Traiteur Propre SAS','51200000000033','3 r','75003','Paris');
  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
   ('d1220000-0000-0000-0000-0000000000a1','d1200000-0000-0000-0000-0000000000a1','ag@d12.local','A','G','agence'),
   ('d1220000-0000-0000-0000-0000000000a3','d1200000-0000-0000-0000-0000000000a3','mgr@d12.local','M','P','traiteur_manager'),
   ('d1220000-0000-0000-0000-0000000000b3','d1200000-0000-0000-0000-0000000000a3','com@d12.local','C','P','traiteur_commercial');
  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
   ('d1230000-0000-0000-0000-000000000001','Salle D12','1 rue','75010','Paris','camionnette',48.87,2.36,'idf'),
   ('d1230000-0000-0000-0000-000000000002','Salle X D12','2 rue','75011','Paris','camionnette',48.86,2.37,'idf');
  INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
   ('d1200000-0000-0000-0000-0000000000a5','d1230000-0000-0000-0000-000000000001'),
   ('d1200000-0000-0000-0000-0000000000a6','d1230000-0000-0000-0000-000000000002');
  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
   ('d1240000-0000-0000-0000-000000000001','GALA_D12','Gala D12',1,true);
  INSERT INTO plateforme.evenements (id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
    created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone) VALUES
   ('d1250000-0000-0000-0000-0000000000ea','d1200000-0000-0000-0000-0000000000a1','d1200000-0000-0000-0000-0000000000a2',
    'd1210000-0000-0000-0000-0000000000a1','d1220000-0000-0000-0000-0000000000a1','d1230000-0000-0000-0000-000000000001',
    'd1240000-0000-0000-0000-000000000001','Evt Agence','2026-09-01',300,'C','0600000001'),
   ('d1250000-0000-0000-0000-0000000000eb','d1200000-0000-0000-0000-0000000000a3','d1200000-0000-0000-0000-0000000000a3',
    'd1210000-0000-0000-0000-0000000000a3','d1220000-0000-0000-0000-0000000000a3','d1230000-0000-0000-0000-000000000001',
    'd1240000-0000-0000-0000-000000000001','Evt Propre','2026-09-02',200,'C','0600000002');
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at) VALUES
   ('d1260000-0000-0000-0000-0000000000a1','d1250000-0000-0000-0000-0000000000ea','anti_gaspi','cloturee','non_envoye','2026-09-01','22:00',now()-interval '30h'),
   ('d1260000-0000-0000-0000-0000000000a2','d1250000-0000-0000-0000-0000000000ea','zero_dechet','cloturee','non_envoye','2026-09-01','22:00',now()-interval '30h'),
   ('d1260000-0000-0000-0000-0000000000a3','d1250000-0000-0000-0000-0000000000ea','anti_gaspi','realisee_sans_collecte','non_envoye','2026-09-01','22:00',now()-interval '30h'),
   ('d1260000-0000-0000-0000-0000000000b1','d1250000-0000-0000-0000-0000000000eb','anti_gaspi','cloturee','non_envoye','2026-09-02','22:00',now()-interval '30h'),
   ('d1260000-0000-0000-0000-0000000000b2','d1250000-0000-0000-0000-0000000000eb','zero_dechet','cloturee','non_envoye','2026-09-02','22:00',now()-interval '30h'),
   ('d1260000-0000-0000-0000-0000000000b3','d1250000-0000-0000-0000-0000000000eb','anti_gaspi','realisee_sans_collecte','non_envoye','2026-09-02','22:00',now()-interval '30h');
  INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact) VALUES
   ('d1270000-0000-0000-0000-000000000001','Asso Secrete D12','1 r','idf','Paris','a@d12.local','Association de test D12 pour la revue sécurité pop-up.');
  INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms, contact_nom, contact_email, contact_telephone) VALUES
   ('d1280000-0000-0000-0000-000000000001','Trans D12','512000001','1 r','75001','Paris',ARRAY['camionnette'],'autre','C','t@d12.local','0600000099');
  INSERT INTO plateforme.attributions_antgaspi (collecte_id, association_id, transporteur_id, branche_attribution, mode_validation, volume_repas_realise) VALUES
   ('d1260000-0000-0000-0000-0000000000a1','d1270000-0000-0000-0000-000000000001','d1280000-0000-0000-0000-000000000001','branche_1','manuel_top1',150),
   ('d1260000-0000-0000-0000-0000000000b1','d1270000-0000-0000-0000-000000000001','d1280000-0000-0000-0000-000000000001','branche_1','manuel_top1',90);
  INSERT INTO plateforme.attestations_don (id, collecte_id, association_id, statut, genere_at, pdf_url, eligible_at, donateur_raison_sociale, donateur_siret, association_nom, nb_repas) VALUES
   ('d1290000-0000-0000-0000-0000000000a1','d1260000-0000-0000-0000-0000000000a1','d1270000-0000-0000-0000-000000000001','emise',now()-interval '29h','att/a1.pdf',now()-interval '6h','Agence D12 SAS','51200000000011','Asso Secrete D12',150),
   ('d1290000-0000-0000-0000-0000000000b1','d1260000-0000-0000-0000-0000000000b1','d1270000-0000-0000-0000-000000000001','emise',now()-interval '29h','att/b1.pdf',now()-interval '6h','Traiteur Propre SAS','51200000000033','Asso Secrete D12',90);
  INSERT INTO plateforme.rapports_rse (id, collecte_id, evenement_id, disponible_a, genere_at, pdf_url) VALUES
   ('d12a0000-0000-0000-0000-0000000000a2','d1260000-0000-0000-0000-0000000000a2','d1250000-0000-0000-0000-0000000000ea',now()-interval '6h',now()-interval '29h','rr/a2.pdf'),
   ('d12a0000-0000-0000-0000-0000000000a3','d1260000-0000-0000-0000-0000000000a3','d1250000-0000-0000-0000-0000000000ea',now()-interval '29h',now()-interval '29h','rr/a3.pdf'),
   ('d12a0000-0000-0000-0000-0000000000b2','d1260000-0000-0000-0000-0000000000b2','d1250000-0000-0000-0000-0000000000eb',now()-interval '6h',now()-interval '29h','rr/b2.pdf'),
   ('d12a0000-0000-0000-0000-0000000000b3','d1260000-0000-0000-0000-0000000000b3','d1250000-0000-0000-0000-0000000000eb',now()-interval '29h',now()-interval '29h','rr/b3.pdf');
END $$;

-- Non-vacuité : les fixtures existent (lues en superuser)
SELECT is((SELECT count(*)::int FROM plateforme.attestations_don WHERE id::text LIKE 'd129%'), 2, 'NV1 : 2 attestations en base');
SELECT is((SELECT count(*)::int FROM plateforme.rapports_rse WHERE id::text LIKE 'd12a%'), 4, 'NV2 : 4 rapports_rse en base');

-- ═══ Traiteur OPÉRATIONNEL (collecte programmée par l'agence) ═══
SELECT test_set_jwt('traiteur_manager','d1200000-0000-0000-0000-0000000000a2');
SELECT is(q_col('d1260000-0000-0000-0000-0000000000a1'), 1, 'OP-mgr : collecte AG agence visible (étape 1 passe)');
SELECT is(q_att('d1260000-0000-0000-0000-0000000000a1'), 0, 'OP-mgr : attestation du donneur d''ordre REFUSÉE (D12)');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000a2'), 1, 'OP-mgr : rapport RSE ZD agence SERVI (rr_select)');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000a3'), 1, 'OP-mgr : rapport sans excédent AG agence SERVI');
SELECT is(q_att('d1260000-0000-0000-0000-0000000000b1'), 0, 'OP-mgr : attestation traiteur propre (cross-org) REFUSÉE');
SELECT is(q_col('d1260000-0000-0000-0000-0000000000b1'), 0, 'OP-mgr : collecte traiteur propre (cross-org) invisible');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000b2'), 0, 'OP-mgr : rapport RSE cross-org REFUSÉ');
SELECT test_set_jwt('traiteur_commercial','d1200000-0000-0000-0000-0000000000a2');
SELECT is(q_col('d1260000-0000-0000-0000-0000000000a2'), 1, 'OP-com : collecte ZD agence visible');
SELECT is(q_att('d1260000-0000-0000-0000-0000000000a1'), 0, 'OP-com : attestation du donneur d''ordre REFUSÉE (D12)');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000a2'), 1, 'OP-com : rapport RSE ZD agence SERVI');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000a3'), 1, 'OP-com : rapport sans excédent SERVI');

-- ═══ Traiteur programmateur (sa propre collecte) ═══
SELECT test_set_jwt('traiteur_manager','d1200000-0000-0000-0000-0000000000a3','d1220000-0000-0000-0000-0000000000a3');
SELECT is(q_att('d1260000-0000-0000-0000-0000000000b1'), 1, 'PR-mgr : sa propre attestation SERVIE');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000b2'), 1, 'PR-mgr : son rapport RSE ZD SERVI');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000b3'), 1, 'PR-mgr : son rapport sans excédent SERVI');
SELECT is(q_att('d1260000-0000-0000-0000-0000000000a1'), 0, 'PR-mgr : attestation agence (cross-org) REFUSÉE');
SELECT test_set_jwt('traiteur_commercial','d1200000-0000-0000-0000-0000000000a3','d1220000-0000-0000-0000-0000000000b3');
SELECT is(q_col('d1260000-0000-0000-0000-0000000000b1'), 1, 'PR-com (non créateur) : collecte de son org visible');
SELECT is(q_att('d1260000-0000-0000-0000-0000000000b1'), 1, 'PR-com (non créateur) : attestation de son org SERVIE');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000b2'), 1, 'PR-com : rapport RSE ZD SERVI');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000b3'), 1, 'PR-com : rapport sans excédent SERVI');

-- ═══ Agence (donneur d'ordre) ═══
SELECT test_set_jwt('agence','d1200000-0000-0000-0000-0000000000a1','d1220000-0000-0000-0000-0000000000a1');
SELECT is(q_att('d1260000-0000-0000-0000-0000000000a1'), 1, 'AG : son attestation SERVIE');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000a2'), 1, 'AG : son rapport RSE ZD SERVI');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000a3'), 1, 'AG : son rapport sans excédent SERVI');
SELECT is(q_att('d1260000-0000-0000-0000-0000000000b1'), 0, 'AG : attestation traiteur (cross-org) REFUSÉE');
SELECT is(q_rr('d1260000-0000-0000-0000-0000000000b2'), 0, 'AG : rapport cross-org REFUSÉ');

-- ═══ Traiteur tiers sans lien ═══
SELECT test_set_jwt('traiteur_manager','d1200000-0000-0000-0000-0000000000a4');
SELECT is((SELECT count(*)::int FROM plateforme.collectes WHERE id::text LIKE 'd126%'), 0, 'TX : 0 collecte');
SELECT is((SELECT count(*)::int FROM plateforme.attestations_don WHERE id::text LIKE 'd129%'), 0, 'TX : 0 attestation');
SELECT is((SELECT count(*)::int FROM plateforme.rapports_rse WHERE id::text LIKE 'd12a%'), 0, 'TX : 0 rapport');
SELECT test_set_jwt('agence','d1200000-0000-0000-0000-0000000000a4');
SELECT is((SELECT count(*)::int FROM plateforme.attestations_don WHERE id::text LIKE 'd129%'), 0, 'TX sous rôle agence : 0 attestation');

-- ═══ Gestionnaire du lieu ═══
SELECT test_set_jwt('gestionnaire_lieux','d1200000-0000-0000-0000-0000000000a5');
SELECT is((SELECT count(*)::int FROM plateforme.collectes WHERE id::text LIKE 'd126%'), 6, 'GST : 6 collectes de son lieu');
SELECT is((SELECT count(*)::int FROM plateforme.attestations_don WHERE id::text LIKE 'd129%'), 2, 'GST : 2 attestations (D9, att_gestionnaire_select, CDC l.619)');
SELECT is((SELECT count(*)::int FROM plateforme.rapports_rse WHERE id::text LIKE 'd12a%'), 4, 'GST : 4 rapports');
SELECT is((SELECT count(*)::int FROM plateforme.attributions_antgaspi WHERE collecte_id::text LIKE 'd126%'), 0, 'GST : 0 attribution (aa_select intacte, C-1)');
SELECT is((SELECT nb_repas FROM plateforme.attestations_don WHERE collecte_id = 'd1260000-0000-0000-0000-0000000000b1' ORDER BY version DESC LIMIT 1), 90, 'GST : nb_repas de l''attestation d''un traiteur tiers lisible (att_gestionnaire_select ; ex-repli D13, les écrans lisent la vue)');
SELECT is((SELECT count(*)::int FROM plateforme.evenements WHERE id::text LIKE 'd125%' AND organisation_id <> 'd1200000-0000-0000-0000-0000000000a5'), 2, 'GST : organisation_id des événements tiers déjà lisible (drapeaux sans info nouvelle)');
SELECT test_set_jwt('gestionnaire_lieux','d1200000-0000-0000-0000-0000000000a6');
SELECT is((SELECT count(*)::int FROM plateforme.collectes WHERE id::text LIKE 'd126%'), 0, 'GX : 0 collecte');
SELECT is((SELECT count(*)::int FROM plateforme.attestations_don WHERE id::text LIKE 'd129%'), 0, 'GX : 0 attestation');
SELECT is((SELECT count(*)::int FROM plateforme.rapports_rse WHERE id::text LIKE 'd12a%'), 0, 'GX : 0 rapport');

-- ═══ Traiteur opérationnel : aa_select inchangée + écriture des rapports refusée ═══
SELECT test_set_jwt('traiteur_manager','d1200000-0000-0000-0000-0000000000a2');
SELECT is(q_aa('d1260000-0000-0000-0000-0000000000a1'), 1, 'OP-mgr : attribution lisible (aa_select branche traiteur op, inchangée)');
WITH u AS (UPDATE plateforme.rapports_rse SET regenere_at = now() WHERE id::text LIKE 'd12a%' RETURNING 1) SELECT is((SELECT count(*)::int FROM u), 0, 'OP-mgr : UPDATE rapports_rse = 0 ligne');

-- Contrôle d'intégrité des fixtures : sous superuser, l'attestation a1 existe toujours
SELECT test_as_superuser();
SELECT is((SELECT count(*)::int FROM plateforme.attestations_don WHERE collecte_id='d1260000-0000-0000-0000-0000000000a1'), 1, 'NV3 : l''attestation a1 existe (le 0 du traiteur op est un refus RLS, pas une absence)');

SELECT * FROM finish();
ROLLBACK;
