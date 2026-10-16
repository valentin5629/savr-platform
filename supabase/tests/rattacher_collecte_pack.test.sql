-- pgTAP — Rattacher après coup une collecte Anti-Gaspi au pack actif
-- (décision Val 2026-10-16, migration 20261016140000).
--
-- Couvre : fermeture des deux fonctions (service_role seul : droits, attributs
-- et refus effectif sous authenticated — même JWT admin_savr — et anon) ; éligibilité
-- (réalisée, clôturée, annulée tardivement ; refus d'une ZD, des statuts non
-- terminaux, de realisee_sans_collecte, d'un crédit annulé côté Savr) ; débit
-- d'un crédit sur le pack actif de la SEULE organisation programmatrice
-- (seuil « pack bas », bascule `epuise`) ; brouillon de facture retiré (vidé →
-- annulé ; à plusieurs lignes → totaux recalculés) ; facture déjà partie
-- (en attente Pennylane, émise, payée) laissée intacte et signalée ; facture
-- annulée et avoir ignorés ; alertes « sans pack » de la seule collecte
-- résolues ; audit_log avec auteur et rôle. Et la réservation périmée : une
-- collecte réalisée sans pack actif perd la réservation posée à l'envoi, puis
-- se rattache à un pack pris plus tard, sans second débit.

BEGIN;
SELECT plan(64);

-- ── 1. Fermeture ──────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.rpc_rattacher_collecte_pack(uuid, uuid, text)', 'EXECUTE'),
  'rpc_rattacher_collecte_pack : authenticated n''a pas EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.rpc_rattacher_collecte_pack(uuid, uuid, text)', 'EXECUTE'),
  'rpc_rattacher_collecte_pack : anon n''a pas EXECUTE');
SELECT ok(NOT has_function_privilege('public', 'plateforme.rpc_rattacher_collecte_pack(uuid, uuid, text)', 'EXECUTE'),
  'rpc_rattacher_collecte_pack : PUBLIC n''a pas EXECUTE');
SELECT ok(has_function_privilege('service_role', 'plateforme.rpc_rattacher_collecte_pack(uuid, uuid, text)', 'EXECUTE'),
  'rpc_rattacher_collecte_pack : service_role a EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.f_collecte_rattachable_pack(uuid)', 'EXECUTE'),
  'f_collecte_rattachable_pack : authenticated n''a pas EXECUTE');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.f_collecte_rattachable_pack(uuid)', 'EXECUTE'),
  'f_collecte_rattachable_pack : anon n''a pas EXECUTE');
SELECT ok(has_function_privilege('service_role', 'plateforme.f_collecte_rattachable_pack(uuid)', 'EXECUTE'),
  'f_collecte_rattachable_pack : service_role a EXECUTE');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'plateforme'
       AND p.proname = 'rpc_rattacher_collecte_pack'
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=plateforme, pg_catalog']),
  1,
  'Attributs : rpc_rattacher_collecte_pack en SECURITY DEFINER avec search_path figé');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'plateforme'
       AND p.proname = 'f_collecte_rattachable_pack'
       AND NOT p.prosecdef),
  1,
  'Attributs : f_collecte_rattachable_pack en SECURITY INVOKER');

-- ── 2. Fixtures (identifiants improbables, hexadécimaux) ──────────────────────
-- Deux organisations : o1 (celle des collectes) et o2 (un pack actif qui ne doit
-- jamais être touché). o3 sert au scénario de la réservation périmée (§9).
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('e1a70000-0000-0000-0000-000000000001', 'Org Rattachement Pack', 'Org Rattachement Pack', 'traiteur', '98765432109876', true),
  ('e1a70000-0000-0000-0000-0000000000b2', 'Org Voisine', 'Org Voisine', 'traiteur', '98765432109877', true),
  ('e1a70000-0000-0000-0000-0000000000b3', 'Org Reservation', 'Org Reservation', 'traiteur', '98765432109878', true);
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('e1a70000-0000-0000-0000-000000000009', 'RATTACH_TEST', 'Rattachement Test', 1, true);
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('e1a70000-0000-0000-0000-000000000002', 'Salle Rattachement', '1 rue Test', 'Paris', '75001', 'camionnette');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('e1a70000-0000-0000-0000-000000000010', 'e1a70000-0000-0000-0000-000000000001',
  'admin@test-rattachement.test', 'Admin', 'Test', 'admin_savr');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('e1a70000-0000-0000-0000-000000000011', 'e1a70000-0000-0000-0000-000000000001', 'Org Rattachement SARL', '98765432109876', '1 rue Test', '75001', 'Paris'),
  ('e1a70000-0000-0000-0000-0000000000e3', 'e1a70000-0000-0000-0000-0000000000b3', 'Org Reservation SARL', '98765432109878', '1 rue Test', '75001', 'Paris');
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  ('e1a70000-0000-0000-0000-000000000003', 'e1a70000-0000-0000-0000-000000000001',
   'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011',
   'e1a70000-0000-0000-0000-000000000010', 'e1a70000-0000-0000-0000-000000000002',
   'e1a70000-0000-0000-0000-000000000009', CURRENT_DATE + 10, 200, 'Contact Test', '0600000001'),
  ('e1a70000-0000-0000-0000-0000000000a3', 'e1a70000-0000-0000-0000-0000000000b3',
   'e1a70000-0000-0000-0000-0000000000b3', 'e1a70000-0000-0000-0000-0000000000e3',
   'e1a70000-0000-0000-0000-000000000010', 'e1a70000-0000-0000-0000-000000000002',
   'e1a70000-0000-0000-0000-000000000009', CURRENT_DATE + 10, 200, 'Contact Test', '0600000001');

-- Collectes AG passées par le vrai déclencheur de réalisation, SANS pack actif
-- (aucun pack encore pour o1) : pas de débit, alerte ag_realisee_sans_pack_actif.
--   c1 : réalisée, brouillon à une ligne
--   c2 : réalisée puis clôturée, facture émise
--   c6 : réalisée, brouillon partagé avec c7 (ZD)
--   c8 : réalisée, crédit annulé côté Savr (non rattachable)
--   c14 : clôturée, facture en attente Pennylane ; c15 : clôturée, facture payée
--   c16 : clôturée, lignes sur une facture annulée et sur un avoir (ignorées)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms)
SELECT ('e1a70000-0000-0000-0000-0000000000' || suffixe)::uuid, 'e1a70000-0000-0000-0000-000000000003',
       type::plateforme.collecte_type, 'programmee', CURRENT_DATE + 10, '09:00', 1, 'non_envoye'
  FROM (VALUES ('c1','anti_gaspi'), ('c2','anti_gaspi'), ('c6','anti_gaspi'), ('c7','zero_dechet'),
               ('c8','anti_gaspi'), ('d4','anti_gaspi'), ('d5','anti_gaspi'), ('d6','anti_gaspi'),
               ('c9','zero_dechet'), ('ca','anti_gaspi'), ('cb','anti_gaspi'), ('cc','anti_gaspi'),
               ('cd','anti_gaspi')) AS v(suffixe, type);
UPDATE plateforme.collectes SET statut = 'realisee'
 WHERE id IN ('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-0000000000c2',
              'e1a70000-0000-0000-0000-0000000000c6', 'e1a70000-0000-0000-0000-0000000000c8',
              'e1a70000-0000-0000-0000-0000000000d4', 'e1a70000-0000-0000-0000-0000000000d5',
              'e1a70000-0000-0000-0000-0000000000d6');
UPDATE plateforme.collectes SET annulee_cote_savr = true, annulee_cote_savr_motif = 'Geste commercial test'
 WHERE id = 'e1a70000-0000-0000-0000-0000000000c8';
-- Statuts posés sans rejouer leurs déclencheurs (CO₂, documents, logistique) : hors sujet ici.
--   c2, d4 (= c14), d5 (= c15), d6 (= c16), c9 (ZD) : clôturées
--   ca : validee ; cb : en_cours ; cc : realisee_sans_collecte ; cd : reste programmee
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes SET statut = 'cloturee'
 WHERE id IN ('e1a70000-0000-0000-0000-0000000000c2', 'e1a70000-0000-0000-0000-0000000000d4',
              'e1a70000-0000-0000-0000-0000000000d5', 'e1a70000-0000-0000-0000-0000000000d6',
              'e1a70000-0000-0000-0000-0000000000c9');
UPDATE plateforme.collectes SET statut = 'validee' WHERE id = 'e1a70000-0000-0000-0000-0000000000ca';
UPDATE plateforme.collectes SET statut = 'en_cours' WHERE id = 'e1a70000-0000-0000-0000-0000000000cb';
UPDATE plateforme.collectes SET statut = 'realisee_sans_collecte' WHERE id = 'e1a70000-0000-0000-0000-0000000000cc';
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

-- Factures : f1 brouillon (c1 seule), f2 émise (c2), f3 brouillon (c6 + c7),
-- f4 en attente Pennylane (c14), f5 payée (c15), f6 annulée + f7 avoir (c16).
INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, type, statut, facture_origine_id, montant_ht, taux_tva, montant_tva, montant_ttc)
VALUES
  ('e1a70000-0000-0000-0000-0000000000f1', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'collecte_antigaspi', 'brouillon', NULL, 590, 20, 118, 708),
  ('e1a70000-0000-0000-0000-0000000000f2', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'collecte_antigaspi', 'emise', NULL, 590, 20, 118, 708),
  ('e1a70000-0000-0000-0000-0000000000f3', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'collecte_antigaspi', 'brouillon', NULL, 840, 20, 168, 1008),
  ('e1a70000-0000-0000-0000-0000000000f4', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'collecte_antigaspi', 'en_attente_pennylane', NULL, 590, 20, 118, 708),
  ('e1a70000-0000-0000-0000-0000000000f5', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'collecte_antigaspi', 'payee', NULL, 590, 20, 118, 708),
  ('e1a70000-0000-0000-0000-0000000000f6', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'collecte_antigaspi', 'annulee', NULL, 590, 20, 118, 708);
INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, type, statut, facture_origine_id, montant_ht, taux_tva, montant_tva, montant_ttc)
VALUES
  ('e1a70000-0000-0000-0000-0000000000f7', 'e1a70000-0000-0000-0000-000000000001', 'e1a70000-0000-0000-0000-000000000011', 'avoir', 'brouillon', 'e1a70000-0000-0000-0000-0000000000f2', -590, 20, -118, -708);
INSERT INTO plateforme.factures_collectes (id, facture_id, collecte_id, quantite, taux_tva, montant_ligne_ht, montant_ht)
VALUES
  ('e1a70000-0000-0000-0000-0000000000d1', 'e1a70000-0000-0000-0000-0000000000f1', 'e1a70000-0000-0000-0000-0000000000c1', 1, 20, 590, 590),
  ('e1a70000-0000-0000-0000-0000000000d2', 'e1a70000-0000-0000-0000-0000000000f2', 'e1a70000-0000-0000-0000-0000000000c2', 1, 20, 590, 590),
  ('e1a70000-0000-0000-0000-0000000000a6', 'e1a70000-0000-0000-0000-0000000000f3', 'e1a70000-0000-0000-0000-0000000000c6', 1, 20, 590, 590),
  ('e1a70000-0000-0000-0000-0000000000a7', 'e1a70000-0000-0000-0000-0000000000f3', 'e1a70000-0000-0000-0000-0000000000c7', 1, 20, 250, 250),
  ('e1a70000-0000-0000-0000-0000000000e4', 'e1a70000-0000-0000-0000-0000000000f4', 'e1a70000-0000-0000-0000-0000000000d4', 1, 20, 590, 590),
  ('e1a70000-0000-0000-0000-0000000000e5', 'e1a70000-0000-0000-0000-0000000000f5', 'e1a70000-0000-0000-0000-0000000000d5', 1, 20, 590, 590),
  ('e1a70000-0000-0000-0000-0000000000e6', 'e1a70000-0000-0000-0000-0000000000f6', 'e1a70000-0000-0000-0000-0000000000d6', 1, 20, 590, 590),
  ('e1a70000-0000-0000-0000-0000000000e7', 'e1a70000-0000-0000-0000-0000000000f7', 'e1a70000-0000-0000-0000-0000000000d6', 1, 20, -590, -590);

-- ── 3. Éligibilité ────────────────────────────────────────────────────────────
SELECT ok(plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c1'),
  'réalisée sans pack → rattachable');
SELECT ok(plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c2'),
  'clôturée sans pack → rattachable');
SELECT ok(plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c3'),
  'annulée à moins de 4 h sans pack (alerte du déclencheur) → rattachable');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c4'),
  'annulée dix jours avant (pas tardive) → non rattachable');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c9'),
  'ZD clôturée → non rattachable (jamais de débit AG pour une ZD)');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000cd'),
  'AG programmée → non rattachable (débitée à la réalisation)');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000ca'),
  'AG validée → non rattachable');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000cb'),
  'AG en cours → non rattachable');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000cc'),
  'AG réalisée sans collecte → non rattachable (jamais débitée)');
SELECT ok(NOT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c8'),
  'réalisée au crédit annulé côté Savr → non rattachable');

-- ── 4. Sans pack actif : refus ───────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') $$,
  'P0006', NULL,
  'aucun pack actif → refus P0006');

-- Pack pris plus tard par o1 : 10 crédits dont 3 déjà consommés, facturé par
-- collecte. Et un pack actif chez o2, qui ne doit jamais bouger.
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES
  ('e1a70000-0000-0000-0000-0000000000a1', 'e1a70000-0000-0000-0000-000000000001', 'personnalise', 10, 3, 5000, 'par_collecte', 'actif', CURRENT_DATE),
  ('e1a70000-0000-0000-0000-0000000000a2', 'e1a70000-0000-0000-0000-0000000000b2', 'personnalise', 5, 0, 2500, 'par_collecte', 'actif', CURRENT_DATE);

-- Refus EFFECTIF sous le rôle d'un client connecté — même avec un JWT
-- admin_savr — puis d'un visiteur : 42501 avant l'exécution du corps. Visée :
-- c1, rattachable, avec un pack actif disponible : le refus ne peut pas passer
-- à vide (cf. assertions qui suivent).
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'e1a70000-0000-0000-0000-000000000010', 'user_role', 'admin_savr',
  'organisation_id', 'e1a70000-0000-0000-0000-000000000001', 'app_domain', 'plateforme'
)::text, true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') $$,
  '42501', NULL::text,
  'Refus effectif : authenticated (JWT admin_savr) ne peut pas rattacher → 42501');
SELECT throws_ok(
  $$ SELECT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c1') $$,
  '42501', NULL::text,
  'Refus effectif : authenticated ne peut pas lire l''éligibilité → 42501');
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') $$,
  '42501', NULL::text,
  'Refus effectif : anon ne peut pas rattacher → 42501');
SELECT throws_ok(
  $$ SELECT plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000c1') $$,
  '42501', NULL::text,
  'Refus effectif : anon ne peut pas lire l''éligibilité → 42501');
RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);
SELECT is((SELECT pack_antgaspi_id FROM plateforme.collectes WHERE id = 'e1a70000-0000-0000-0000-0000000000c1'),
  NULL::uuid, 'Refus effectif : c1 n''a pas été rattachée');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e1a70000-0000-0000-0000-0000000000a1'),
  3, 'Refus effectif : le pack n''a pas été débité');

SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c4', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') $$,
  'P0003', NULL,
  'collecte non rattachable → refus P0003, même avec un pack actif');
SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000ff', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') $$,
  'P0002', NULL,
  'collecte inconnue → P0002');

-- ── 5. Réalisée, brouillon à une ligne ───────────────────────────────────────
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr')
    - 'pack_antgaspi_id' - 'statut_pack',
  '{"ok": true, "brouillons_retires": 1, "facture_envoyee": false}'::jsonb,
  'c1 : un brouillon retiré, aucune facture partie');
SELECT is((SELECT pack_antgaspi_id FROM plateforme.collectes WHERE id = 'e1a70000-0000-0000-0000-0000000000c1'),
  'e1a70000-0000-0000-0000-0000000000a1'::uuid, 'c1 : rattachée au pack actif de son organisation');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e1a70000-0000-0000-0000-0000000000a1'),
  4, 'pack o1 : un crédit de plus consommé (3 → 4)');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e1a70000-0000-0000-0000-0000000000a2'),
  0, 'pack actif de l''autre organisation : intact');
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
SELECT is(
  (SELECT statut FROM plateforme.alertes_admin
    WHERE code = 'ag_realisee_sans_pack_actif' AND entity_id = 'e1a70000-0000-0000-0000-0000000000c6'),
  'ouverte', 'alerte d''une autre collecte (c6) : toujours ouverte');
SELECT ok(EXISTS (
  SELECT 1 FROM plateforme.audit_log
   WHERE action = 'pack_rattache_collecte'
     AND record_id = 'e1a70000-0000-0000-0000-0000000000c1'
     AND user_id = 'e1a70000-0000-0000-0000-000000000010'
     AND new_values ->> 'pack_antgaspi_id' = 'e1a70000-0000-0000-0000-0000000000a1'),
  'c1 : rattachement tracé dans audit_log au nom de l''Admin');
SELECT is(
  (SELECT role FROM plateforme.audit_log
    WHERE action = 'pack_rattache_collecte' AND record_id = 'e1a70000-0000-0000-0000-0000000000c1'),
  'admin_savr', 'c1 : le rôle de l''auteur est figé dans audit_log');
SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c1', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') $$,
  'P0003', NULL,
  'c1 déjà rattachée → refus P0003 (pas de second débit)');

-- ── 6. Brouillon partagé : la seule ligne de la collecte part ────────────────
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c6', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') ->> 'brouillons_retires',
  '1', 'c6 : sa ligne quitte le brouillon partagé');
SELECT is((SELECT statut::text FROM plateforme.factures WHERE id = 'e1a70000-0000-0000-0000-0000000000f3'),
  'brouillon', 'f3 : reste brouillon (il porte encore c7)');
SELECT is(
  (SELECT row(montant_ht, montant_tva, montant_ttc)::text FROM plateforme.factures WHERE id = 'e1a70000-0000-0000-0000-0000000000f3'),
  row(250.00, 50.00, 300.00)::text, 'f3 : totaux recalculés sur la ligne restante');
SELECT is((SELECT count(*)::int FROM plateforme.factures_collectes WHERE facture_id = 'e1a70000-0000-0000-0000-0000000000f3'),
  1, 'f3 : la ligne de c7 est intacte');

-- ── 7. Factures déjà parties : intactes et signalées ─────────────────────────
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c2', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr')
    - 'pack_antgaspi_id' - 'statut_pack',
  '{"ok": true, "brouillons_retires": 0, "facture_envoyee": true}'::jsonb,
  'c2 (émise) : aucune ligne retirée, facture envoyée signalée');
SELECT is((SELECT statut::text FROM plateforme.factures WHERE id = 'e1a70000-0000-0000-0000-0000000000f2'),
  'emise', 'f2 : facture émise intacte');
SELECT is((SELECT count(*)::int FROM plateforme.factures_collectes WHERE facture_id = 'e1a70000-0000-0000-0000-0000000000f2'),
  1, 'f2 : sa ligne est intacte');
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000d4', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr')
    - 'pack_antgaspi_id' - 'statut_pack',
  '{"ok": true, "brouillons_retires": 0, "facture_envoyee": true}'::jsonb,
  'c14 (en attente Pennylane) : facture envoyée signalée');
SELECT is(
  (SELECT statut::text || ':' || (SELECT count(*) FROM plateforme.factures_collectes WHERE facture_id = f.id)
     FROM plateforme.factures f WHERE id = 'e1a70000-0000-0000-0000-0000000000f4'),
  'en_attente_pennylane:1', 'f4 : en attente Pennylane, ligne intacte');
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000d5', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr')
    - 'pack_antgaspi_id' - 'statut_pack',
  '{"ok": true, "brouillons_retires": 0, "facture_envoyee": true}'::jsonb,
  'c15 (payée) : facture envoyée signalée');
SELECT is(
  (SELECT statut::text || ':' || (SELECT count(*) FROM plateforme.factures_collectes WHERE facture_id = f.id)
     FROM plateforme.factures f WHERE id = 'e1a70000-0000-0000-0000-0000000000f5'),
  'payee:1', 'f5 : payée, ligne intacte');

-- ── 8. Facture annulée et avoir : ignorés ; seuil « pack bas » franchi ───────
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000d6', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr')
    - 'pack_antgaspi_id' - 'statut_pack',
  '{"ok": true, "brouillons_retires": 0, "facture_envoyee": false}'::jsonb,
  'c16 : lignes sur facture annulée et sur avoir ignorées (rien de retiré, rien de signalé)');
SELECT is(
  (SELECT count(*)::int FROM plateforme.factures_collectes
    WHERE collecte_id = 'e1a70000-0000-0000-0000-0000000000d6'),
  2, 'c16 : ses lignes (facture annulée, avoir) sont intactes');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e1a70000-0000-0000-0000-0000000000a1'),
  9, 'pack o1 : 9 crédits consommés sur 10');
SELECT ok(EXISTS (
  SELECT 1 FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_bas' AND entity_id = 'e1a70000-0000-0000-0000-0000000000a1' AND statut = 'ouverte'),
  'seuil des 10 % franchi : alerte « pack bas » émise');

-- ── 9. Annulée tardivement, dernier crédit : pack épuisé ─────────────────────
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000c3', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') ->> 'statut_pack',
  'epuise', 'c3 : dernier crédit → pack épuisé');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e1a70000-0000-0000-0000-0000000000a1'),
  10, 'pack o1 : 10 crédits consommés sur 10');
SELECT ok(EXISTS (
  SELECT 1 FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_epuise' AND entity_id = 'e1a70000-0000-0000-0000-0000000000a1' AND statut = 'ouverte'),
  'alerte pack épuisé émise');
SELECT is(
  (SELECT statut FROM plateforme.alertes_admin
    WHERE code = 'ag_annulee_tardive_sans_pack_actif' AND entity_id = 'e1a70000-0000-0000-0000-0000000000c3'),
  'resolue', 'c3 : alerte « annulation tardive sans pack » résolue');

-- ── 10. Réservation périmée (§05 §3 F3 : 2 collectes pour 1 crédit restant) ──
-- o3 a un pack P3 d'un seul crédit restant. Les deux collectes l'ont réservé à
-- l'envoi au transporteur (pack_antgaspi_id posé, comme le fait le dispatch).
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES ('e1a70000-0000-0000-0000-0000000000a3', 'e1a70000-0000-0000-0000-0000000000b3', 'personnalise', 2, 1, 1000, 'globale_achat', 'actif', CURRENT_DATE);
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms, pack_antgaspi_id)
VALUES
  ('e1a70000-0000-0000-0000-0000000000e1', 'e1a70000-0000-0000-0000-0000000000a3', 'anti_gaspi', 'programmee', CURRENT_DATE + 10, '09:00', 1, 'non_envoye', 'e1a70000-0000-0000-0000-0000000000a3'),
  ('e1a70000-0000-0000-0000-0000000000e2', 'e1a70000-0000-0000-0000-0000000000a3', 'anti_gaspi', 'programmee', CURRENT_DATE + 10, '10:00', 1, 'non_envoye', 'e1a70000-0000-0000-0000-0000000000a3');
UPDATE plateforme.collectes SET statut = 'realisee' WHERE id = 'e1a70000-0000-0000-0000-0000000000e1';
UPDATE plateforme.collectes SET statut = 'realisee' WHERE id = 'e1a70000-0000-0000-0000-0000000000e2';

SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e1a70000-0000-0000-0000-0000000000a3'),
  2, 'P3 : un seul débit (la 1re collecte), jamais au-delà du dernier crédit');
SELECT is((SELECT pack_antgaspi_id FROM plateforme.collectes WHERE id = 'e1a70000-0000-0000-0000-0000000000e2'),
  NULL::uuid, '2e collecte réalisée sans pack actif : la réservation périmée est levée (facturée à l''unité)');
SELECT ok(plateforme.f_collecte_rattachable_pack('e1a70000-0000-0000-0000-0000000000e2'),
  '2e collecte : rattachable');

-- Le client prend un nouveau pack P4 : la 2e collecte s'y rattache, une fois.
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES ('e1a70000-0000-0000-0000-0000000000a4', 'e1a70000-0000-0000-0000-0000000000b3', 'personnalise', 5, 0, 2500, 'par_collecte', 'actif', CURRENT_DATE);
SELECT is(
  plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000e2', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') ->> 'pack_antgaspi_id',
  'e1a70000-0000-0000-0000-0000000000a4', '2e collecte : rattachée au nouveau pack P4');
SELECT throws_ok(
  $$ SELECT plateforme.rpc_rattacher_collecte_pack('e1a70000-0000-0000-0000-0000000000e2', 'e1a70000-0000-0000-0000-000000000010', 'admin_savr') $$,
  'P0003', NULL,
  '2e collecte : second rattachement refusé (P4 débité une seule fois)');

SELECT * FROM finish();
ROLLBACK;
