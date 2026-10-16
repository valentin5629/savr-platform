-- pgTAP — Rattacher après coup une collecte Anti-Gaspi au pack actif
-- (décision Val 2026-10-16, migration 20261016140000).
--
-- Couvre : fermeture des deux fonctions (service_role seul), éligibilité
-- (réalisée, clôturée, annulée tardivement ; refus des autres cas), débit d'un
-- crédit comme le déclencheur de réalisation (dont bascule `epuise`), brouillon
-- de facture retiré (vidé → annulé ; à plusieurs lignes → totaux recalculés),
-- facture déjà partie laissée intacte et signalée, alertes « sans pack »
-- résolues, audit_log.

BEGIN;
SELECT plan(36);

-- ── 1. Fermeture ──────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.rpc_rattacher_collecte_pack(uuid, uuid)', 'EXECUTE'),
  'rpc_rattacher_collecte_pack : authenticated n''a pas EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.rpc_rattacher_collecte_pack(uuid, uuid)', 'EXECUTE'),
  'rpc_rattacher_collecte_pack : anon n''a pas EXECUTE');
SELECT ok(NOT has_function_privilege('public', 'plateforme.rpc_rattacher_collecte_pack(uuid, uuid)', 'EXECUTE'),
  'rpc_rattacher_collecte_pack : PUBLIC n''a pas EXECUTE');
SELECT ok(has_function_privilege('service_role', 'plateforme.rpc_rattacher_collecte_pack(uuid, uuid)', 'EXECUTE'),
  'rpc_rattacher_collecte_pack : service_role a EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.f_collecte_rattachable_pack(uuid)', 'EXECUTE'),
  'f_collecte_rattachable_pack : authenticated n''a pas EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.f_collecte_rattachable_pack(uuid)', 'EXECUTE'),
  'f_collecte_rattachable_pack : anon n''a pas EXECUTE');
SELECT ok(has_function_privilege('service_role', 'plateforme.f_collecte_rattachable_pack(uuid)', 'EXECUTE'),
  'f_collecte_rattachable_pack : service_role a EXECUTE');

-- ── 2. Fixtures (identifiants improbables, hexadécimaux) ──────────────────────
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('e1a70000-0000-0000-0000-000000000001', 'Org Rattachement Pack', 'Org Rattachement Pack', 'traiteur', '98765432109876', true);
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('e1a70000-0000-0000-0000-000000000009', 'RATTACH_TEST', 'Rattachement Test', 1, true);
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('e1a70000-0000-0000-0000-000000000002', 'Salle Rattachement', '1 rue Test', 'Paris', '75001', 'camionnette');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('e1a70000-0000-0000-0000-000000000010', 'e1a70000-0000-0000-0000-000000000001',
  'admin@test-rattachement.test', 'Admin', 'Test', 'admin_savr');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('e1a70000-0000-0000-0000-000000000011', 'e1a70000-0000-0000-0000-000000000001',
  'Org Rattachement SARL', '98765432109876', '1 rue Test', '75001', 'Paris');
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'e1a70000-0000-0000-0000-000000000003', 'e1a70000-0000-0000-0000-000000000001',
  'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011',
  'e1a70000-0000-0000-0000-000000000010', 'e1a70000-0000-0000-0000-000000000002',
  'e1a70000-0000-0000-0000-000000000009', CURRENT_DATE + 10, 200, 'Contact Test', '0600000001'
);

-- Collectes AG passées par le vrai déclencheur de réalisation, SANS pack actif
-- (aucun pack encore) : pas de débit, alerte ag_realisee_sans_pack_actif.
--   c1 : réalisée, brouillon à une ligne
--   c2 : réalisée puis clôturée, facture déjà émise
--   c6 : réalisée, brouillon partagé avec c7
--   c8 : réalisée, crédit annulé côté Savr (non rattachable)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms)
VALUES
  ('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-000000000003', 'anti_gaspi', 'programmee', CURRENT_DATE + 10, '09:00', 1, 'non_envoye'),
  ('e1a70000-0000-0000-0000-0000000000c2', 'e1a70000-0000-0000-0000-000000000003', 'anti_gaspi', 'programmee', CURRENT_DATE + 10, '10:00', 1, 'non_envoye'),
  ('e1a70000-0000-0000-0000-0000000000c6', 'e1a70000-0000-0000-0000-000000000003', 'anti_gaspi', 'programmee', CURRENT_DATE + 10, '11:00', 1, 'non_envoye'),
  ('e1a70000-0000-0000-0000-0000000000c7', 'e1a70000-0000-0000-0000-000000000003', 'zero_dechet', 'programmee', CURRENT_DATE + 10, '12:00', 1, 'non_envoye'),
  ('e1a70000-0000-0000-0000-0000000000c8', 'e1a70000-0000-0000-0000-000000000003', 'anti_gaspi', 'programmee', CURRENT_DATE + 10, '13:00', 1, 'non_envoye');
UPDATE plateforme.collectes SET statut = 'realisee'
 WHERE id IN ('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-0000000000c2',
              'e1a70000-0000-0000-0000-0000000000c6', 'e1a70000-0000-0000-0000-0000000000c8');
UPDATE plateforme.collectes SET annulee_cote_savr = true, annulee_cote_savr_motif = 'Geste commercial test'
 WHERE id = 'e1a70000-0000-0000-0000-0000000000c8';
-- c2 clôturée sans rejouer les déclencheurs de clôture (CO₂, documents) : hors sujet ici.
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes SET statut = 'cloturee' WHERE id = 'e1a70000-0000-0000-0000-0000000000c2';
SET LOCAL session_replication_role = origin;

-- c3 : annulée à moins de 4 h du créneau (heure de Paris), sans pack : le vrai
-- déclencheur d'annulation tardive émet ag_annulee_tardive_sans_pack_actif.
-- c4 : annulée dix jours avant : pas tardive, donc pas rattachable.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms)
VALUES
  ('e1a70000-0000-0000-0000-0000000000c3', 'e1a70000-0000-0000-0000-000000000003', 'anti_gaspi', 'programmee',
   ((now() + interval '1 hour') AT TIME ZONE 'Europe/Paris')::date,
   ((now() + interval '1 hour') AT TIME ZONE 'Europe/Paris')::time, 1, 'non_envoye'),
  ('e1a70000-0000-0000-0000-0000000000c4', 'e1a70000-0000-0000-0000-000000000003', 'anti_gaspi', 'programmee', CURRENT_DATE + 10, '14:00', 1, 'non_envoye');
UPDATE plateforme.collectes SET statut = 'annulee'
 WHERE id IN ('e1a70000-0000-0000-0000-0000000000c3', 'e1a70000-0000-0000-0000-0000000000c4');

-- Factures : f1 brouillon (c1 seule), f2 émise (c2), f3 brouillon (c6 + c7).
INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, type, statut, montant_ht, taux_tva, montant_tva, montant_ttc)
VALUES
  ('e1a70000-0000-0000-0000-0000000000f1', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'collecte_antigaspi', 'brouillon', 590, 20, 118, 708),
  ('e1a70000-0000-0000-0000-0000000000f2', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'collecte_antigaspi', 'emise', 590, 20, 118, 708),
  ('e1a70000-0000-0000-0000-0000000000f3', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'collecte_antigaspi', 'brouillon', 840, 20, 168, 1008);
INSERT INTO plateforme.factures_collectes (id, facture_id, collecte_id, quantite, taux_tva, montant_ligne_ht, montant_ht)
VALUES
  ('e1a70000-0000-0000-0000-0000000000d1', 'e1a70000-0000-0000-0000-0000000000f1', 'e1a70000-0000-0000-0000-0000000000c1', 1, 20, 590, 590),
  ('e1a70000-0000-0000-0000-0000000000d2', 'e1a70000-0000-0000-0000-0000000000f2', 'e1a70000-0000-0000-0000-0000000000c2', 1, 20, 590, 590),
  ('e1a70000-0000-0000-0000-0000000000d6', 'e1a70000-0000-0000-0000-0000000000f3', 'e1a70000-0000-0000-0000-0000000000c6', 1, 20, 590, 590),
  ('e1a70000-0000-0000-0000-0000000000d7', 'e1a70000-0000-0000-0000-0000000000f3', 'e1a70000-0000-0000-0000-0000000000c7', 1, 20, 250, 250);

-- ── 3. Éligibilité ────────────────────────────────────────────────────────────
SELECT ok(plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c1'),
  'réalisée sans pack → rattachable');
SELECT ok(plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c2'),
  'clôturée sans pack → rattachable');
SELECT ok(plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c3'),
  'annulée à moins de 4 h sans pack (alerte du déclencheur) → rattachable');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c4'),
  'annulée dix jours avant (pas tardive) → non rattachable');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c7'),
  'collecte ZD → non rattachable');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c8'),
  'réalisée au crédit annulé côté Savr → non rattachable');

-- ── 4. Sans pack actif : refus ───────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-000000000010') $$,
  'P0006', NULL,
  'aucun pack actif → refus P0006');

-- Pack pris plus tard : 4 crédits, facturé par collecte.
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES ('e1a70000-0000-0000-0000-0000000000a1', 'e1a70000-0000-0000-0000-000000000001', 'personnalise', 4, 0, 2000, 'par_collecte', 'actif', CURRENT_DATE);

SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c4', 'e1a70000-0000-0000-0000-000000000010') $$,
  'P0003', NULL,
  'collecte non rattachable → refus P0003, même avec un pack actif');
SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000ff', 'e1a70000-0000-0000-0000-000000000010') $$,
  'P0002', NULL,
  'collecte inconnue → P0002');

-- ── 5. Réalisée, brouillon à une ligne ───────────────────────────────────────
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-000000000010')
    - 'pack_antgaspi_id' - 'statut_pack',
  '{"ok": true, "brouillons_retires": 1, "facture_envoyee": false}'::jsonb,
  'c1 : un brouillon retiré, aucune facture partie');
SELECT is((SELECT pack_antgaspi_id FROM plateforme.collectes WHERE id = 'e1a70000-0000-0000-0000-0000000000c1'),
  'e1a70000-0000-0000-0000-0000000000a1'::uuid, 'c1 : rattachée au pack actif');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e1a70000-0000-0000-0000-0000000000a1'),
  1, 'pack : 1 crédit consommé');
SELECT is((SELECT statut::text FROM plateforme.factures WHERE id = 'e1a70000-0000-0000-0000-0000000000f1'),
  'annulee', 'f1 : brouillon vidé → annulé');
SELECT is((SELECT count(*)::int FROM plateforme.factures_collectes WHERE collecte_id = 'e1a70000-0000-0000-0000-0000000000c1'),
  0, 'c1 : plus aucune ligne de facture');
SELECT is(
  (SELECT statut FROM plateforme.alertes_admin
    WHERE code = 'ag_realisee_sans_pack_actif' AND entity_id = 'e1a70000-0000-0000-0000-0000000000c1'),
  'resolue', 'c1 : alerte « réalisée sans pack » résolue');
SELECT is(
  (SELECT resolue_par_user_id FROM plateforme.alertes_admin
    WHERE code = 'ag_realisee_sans_pack_actif' AND entity_id = 'e1a70000-0000-0000-0000-0000000000c1'),
  'e1a70000-0000-0000-0000-000000000010'::uuid, 'c1 : alerte résolue au nom de l''Admin');
SELECT ok(EXISTS (
  SELECT 1 FROM plateforme.audit_log
   WHERE action = 'pack_rattache_collecte'
     AND record_id = 'e1a70000-0000-0000-0000-0000000000c1'
     AND user_id = 'e1a70000-0000-0000-0000-000000000010'
     AND new_values ->> 'pack_antgaspi_id' = 'e1a70000-0000-0000-0000-0000000000a1'),
  'c1 : rattachement tracé dans audit_log');
SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-000000000010') $$,
  'P0003', NULL,
  'c1 déjà rattachée → refus P0003 (pas de second débit)');

-- ── 6. Brouillon partagé : la seule ligne de la collecte part ────────────────
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c6', 'e1a70000-0000-0000-0000-000000000010') ->> 'brouillons_retires',
  '1', 'c6 : sa ligne quitte le brouillon partagé');
SELECT is((SELECT statut::text FROM plateforme.factures WHERE id = 'e1a70000-0000-0000-0000-0000000000f3'),
  'brouillon', 'f3 : reste brouillon (il porte encore c7)');
SELECT is(
  (SELECT row(montant_ht, montant_tva, montant_ttc)::text FROM plateforme.factures WHERE id = 'e1a70000-0000-0000-0000-0000000000f3'),
  row(250.00, 50.00, 300.00)::text, 'f3 : totaux recalculés sur la ligne restante');
SELECT is((SELECT count(*)::int FROM plateforme.factures_collectes WHERE facture_id = 'e1a70000-0000-0000-0000-0000000000f3'),
  1, 'f3 : la ligne de c7 est intacte');

-- ── 7. Clôturée, facture déjà émise : intacte et signalée ────────────────────
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c2', 'e1a70000-0000-0000-0000-000000000010')
    - 'pack_antgaspi_id' - 'statut_pack',
  '{"ok": true, "brouillons_retires": 0, "facture_envoyee": true}'::jsonb,
  'c2 : aucune ligne retirée, facture envoyée signalée');
SELECT is((SELECT statut::text FROM plateforme.factures WHERE id = 'e1a70000-0000-0000-0000-0000000000f2'),
  'emise', 'f2 : facture émise intacte');
SELECT is((SELECT count(*)::int FROM plateforme.factures_collectes WHERE facture_id = 'e1a70000-0000-0000-0000-0000000000f2'),
  1, 'f2 : sa ligne est intacte');

-- ── 8. Annulée tardivement, dernier crédit : pack épuisé ─────────────────────
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c3', 'e1a70000-0000-0000-0000-000000000010') ->> 'statut_pack',
  'epuise', 'c3 : dernier crédit → pack épuisé');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e1a70000-0000-0000-0000-0000000000a1'),
  4, 'pack : 4 crédits consommés sur 4');
SELECT ok(EXISTS (
  SELECT 1 FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_epuise' AND entity_id = 'e1a70000-0000-0000-0000-0000000000a1' AND statut = 'ouverte'),
  'alerte pack épuisé émise');
SELECT is(
  (SELECT statut FROM plateforme.alertes_admin
    WHERE code = 'ag_annulee_tardive_sans_pack_actif' AND entity_id = 'e1a70000-0000-0000-0000-0000000000c3'),
  'resolue', 'c3 : alerte « annulation tardive sans pack » résolue');

SELECT * FROM finish();
ROLLBACK;
