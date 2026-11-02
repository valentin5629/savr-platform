-- pgTAP — Pack Anti-Gaspi : crédit décompté dès la programmation, gardé ou
-- rendu ensuite (décision Val 2026-11-02, migration 20261102120000).
--
-- Couvre : débit à la création confirmée et à la confirmation d'un brouillon ;
-- aucun débit sans crédit (facturée à l'unité, sans alerte) ; une ZD n'est
-- jamais débitée ; aucun second débit à la réalisation ; réalisée sans pack →
-- alerte ; annulation tardive → crédit gardé (trace d'audit) ; annulation à
-- 4 h ou plus → crédit rendu, pack épuisé réactivé ; incident imputable à Savr
-- → crédit rendu même tardif ; refus définitif du prestataire → crédit rendu,
-- repris au renvoi ; annulation tardive sans pack → alerte, rattachable ;
-- collecte à venir sans pack → rattachable ; le pack d'une autre organisation
-- n'est jamais touché ; l'attribution AG ne réserve plus de pack ; les
-- fonctions ajoutées sont fermées (service_role seul). Le nom du fichier date de la règle précédente (débit
-- tardif sur le pack actif) ; il est listé tel quel dans le manifeste M2.1.

BEGIN;
SELECT plan(56);

-- ── Fixtures (identifiants improbables, hexadécimaux) ─────────────────────────
-- o1 : l'organisation des collectes ; o2 : une voisine dont le pack actif ne
-- doit jamais bouger.
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('a7d00000-0000-0000-0000-000000000001', 'Org Pack Programmation', 'Org Pack Programmation', 'traiteur', '98765432109811', true),
  ('a7d00000-0000-0000-0000-0000000000b2', 'Org Voisine PP', 'Org Voisine PP', 'traiteur', '98765432109812', true);
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('a7d00000-0000-0000-0000-000000000009', 'PACK_PROG_TEST', 'Pack programmation Test', 1, true);
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('a7d00000-0000-0000-0000-000000000002', 'Salle Pack', '1 rue Test', 'Paris', '75001', 'camionnette');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('a7d00000-0000-0000-0000-000000000010', 'a7d00000-0000-0000-0000-000000000001',
  'admin@test-pack-programmation.test', 'Admin', 'Test', 'admin_savr');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('a7d00000-0000-0000-0000-000000000011', 'a7d00000-0000-0000-0000-000000000001',
  'Org Pack Programmation SARL', '98765432109811', '1 rue Test', '75001', 'Paris');
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'a7d00000-0000-0000-0000-000000000003', 'a7d00000-0000-0000-0000-000000000001',
  'a7d00000-0000-0000-0000-000000000001', 'a7d00000-0000-0000-0000-000000000011',
  'a7d00000-0000-0000-0000-000000000010', 'a7d00000-0000-0000-0000-000000000002',
  'a7d00000-0000-0000-0000-000000000009', CURRENT_DATE, 200, 'Contact Test', '0600000001'
);

-- P1 : trois crédits. Pv : pack actif de la voisine.
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES
  ('a7d00000-0000-0000-0000-0000000000a1', 'a7d00000-0000-0000-0000-000000000001', 'personnalise', 3, 0, 1500, 'par_collecte', 'actif', CURRENT_DATE),
  ('a7d00000-0000-0000-0000-0000000000a9', 'a7d00000-0000-0000-0000-0000000000b2', 'personnalise', 5, 0, 2500, 'par_collecte', 'actif', CURRENT_DATE);

-- Collecte de o1 à un créneau donné (heure de Paris), au statut donné.
CREATE FUNCTION pg_temp.collecte(p_suffixe text, p_type text, p_statut text, p_dans interval)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms)
  VALUES (('a7d00000-0000-0000-0000-0000000000' || p_suffixe)::uuid, 'a7d00000-0000-0000-0000-000000000003',
          p_type::plateforme.collecte_type, p_statut::plateforme.collecte_statut,
          ((now() + p_dans) AT TIME ZONE 'Europe/Paris')::date,
          ((now() + p_dans) AT TIME ZONE 'Europe/Paris')::time,
          1, 'non_envoye');
$$;
CREATE FUNCTION pg_temp.consommes() RETURNS int LANGUAGE sql AS $$
  SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a1';
$$;
CREATE FUNCTION pg_temp.pack_de(p_suffixe text) RETURNS uuid LANGUAGE sql AS $$
  SELECT pack_antgaspi_id FROM plateforme.collectes WHERE id = ('a7d00000-0000-0000-0000-0000000000' || p_suffixe)::uuid;
$$;
CREATE FUNCTION pg_temp.audits(p_action text, p_suffixe text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM plateforme.audit_log
   WHERE action = p_action
     AND coalesce(old_values ->> 'collecte_id', old_values ->> 'collecte_id_annulee')
         = 'a7d00000-0000-0000-0000-0000000000' || p_suffixe;
$$;

-- ── 1. Création confirmée : un crédit décompté ───────────────────────────────
SELECT pg_temp.collecte('ca', 'anti_gaspi', 'programmee', interval '3 days');
SELECT is(pg_temp.consommes(), 1, 'ca : programmée → un crédit décompté');
SELECT is(pg_temp.pack_de('ca'), 'a7d00000-0000-0000-0000-0000000000a1'::uuid, 'ca : porte le pack P1');
SELECT is(pg_temp.audits('pack_debite_programmation', 'ca'), 1, 'ca : débit journalisé');

-- ── 2. Brouillon : rien ; confirmé : un crédit ───────────────────────────────
SELECT pg_temp.collecte('cb', 'anti_gaspi', 'brouillon', interval '3 days');
SELECT is(pg_temp.consommes(), 1, 'cb : un brouillon ne décompte rien');
SELECT is(pg_temp.pack_de('cb'), NULL::uuid, 'cb : brouillon sans pack');
UPDATE plateforme.collectes SET statut = 'programmee' WHERE id = 'a7d00000-0000-0000-0000-0000000000cb';
SELECT is(pg_temp.consommes(), 2, 'cb : brouillon confirmé → un crédit décompté');

-- ── 3. Dernier crédit : pack épuisé dès la programmation ─────────────────────
SELECT pg_temp.collecte('cd', 'anti_gaspi', 'programmee', interval '1 hour');
SELECT is(pg_temp.consommes(), 3, 'cd : dernier crédit décompté');
SELECT is((SELECT statut::text FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a1'),
  'epuise', 'cd : P1 épuisé dès la programmation');
SELECT ok(EXISTS (
  SELECT 1 FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_epuise' AND entity_id = 'a7d00000-0000-0000-0000-0000000000a1' AND statut = 'ouverte'),
  'cd : alerte « pack épuisé »');

-- ── 4. Plus de crédit : facturée à l'unité, rattachable ──────────────────────
SELECT lives_ok($$ SELECT pg_temp.collecte('cc', 'anti_gaspi', 'programmee', interval '3 days') $$,
  'cc : programmée sans crédit, jamais bloquée');
SELECT is(pg_temp.pack_de('cc'), NULL::uuid, 'cc : sans pack (facturée à l''unité)');
SELECT is(pg_temp.consommes(), 3, 'cc : P1 jamais au-delà de ses crédits');
SELECT ok(NOT EXISTS (SELECT 1 FROM plateforme.alertes_admin WHERE entity_id = 'a7d00000-0000-0000-0000-0000000000cc'),
  'cc : aucune alerte à la programmation (le formulaire prévient)');
SELECT ok(plateforme.f_collecte_rattachable_pack('a7d00000-0000-0000-0000-0000000000cc'),
  'cc : à venir sans pack → rattachable à un pack pris plus tard');

-- ── 5. Une ZD ne décompte jamais de crédit ───────────────────────────────────
SELECT pg_temp.collecte('c0', 'zero_dechet', 'programmee', interval '3 days');
SELECT is(pg_temp.pack_de('c0'), NULL::uuid, 'c0 : ZD sans pack');
SELECT is(pg_temp.consommes(), 3, 'c0 : ZD, aucun débit');

-- ── 6. Réalisation : aucun second débit ; sans pack → alerte ─────────────────
UPDATE plateforme.collectes SET statut = 'validee' WHERE id IN ('a7d00000-0000-0000-0000-0000000000ca', 'a7d00000-0000-0000-0000-0000000000cc');
UPDATE plateforme.collectes SET statut = 'realisee' WHERE id IN ('a7d00000-0000-0000-0000-0000000000ca', 'a7d00000-0000-0000-0000-0000000000cc');
SELECT is(pg_temp.consommes(), 3, 'ca, cc : réalisées, aucun second débit');
SELECT is(pg_temp.pack_de('ca'), 'a7d00000-0000-0000-0000-0000000000a1'::uuid, 'ca : garde son pack à la réalisation');
SELECT is(
  (SELECT statut FROM plateforme.alertes_admin
    WHERE code = 'ag_realisee_sans_pack_actif' AND entity_id = 'a7d00000-0000-0000-0000-0000000000cc'),
  'ouverte', 'cc : réalisée sans pack → alerte');

-- ── 7. Annulation tardive : le crédit reste décompté ─────────────────────────
UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = 'a7d00000-0000-0000-0000-0000000000cd';
SELECT is(pg_temp.consommes(), 3, 'cd : annulée à moins de 4 h → crédit gardé');
SELECT is(pg_temp.pack_de('cd'), 'a7d00000-0000-0000-0000-0000000000a1'::uuid, 'cd : garde son pack');
SELECT is(pg_temp.audits('pack_debite_annulation_tardive', 'cd'), 1,
  'cd : trace du crédit acquis (lue par l''historique du pack)');

-- ── 8. Annulation à 4 h ou plus : le crédit est rendu ────────────────────────
UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = 'a7d00000-0000-0000-0000-0000000000cb';
SELECT is(pg_temp.consommes(), 2, 'cb : annulée à 3 jours → crédit rendu');
SELECT is((SELECT statut::text FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a1'),
  'actif', 'cb : P1 épuisé redevient actif');
SELECT is(pg_temp.pack_de('cb'), NULL::uuid, 'cb : ne porte plus de pack');
SELECT is(pg_temp.audits('pack_recredite_annulation_collecte', 'cb'), 1, 'cb : recrédit journalisé');

-- ── 9. Incident imputable à Savr, même tardif : crédit rendu ─────────────────
SELECT pg_temp.collecte('cf', 'anti_gaspi', 'programmee', interval '1 hour');
SELECT is(pg_temp.consommes(), 3, 'cf : programmée → dernier crédit décompté');
UPDATE plateforme.collectes SET statut = 'annulee', incident_imputable_a = 'savr'
 WHERE id = 'a7d00000-0000-0000-0000-0000000000cf';
SELECT is(pg_temp.consommes(), 2, 'cf : annulée à moins de 4 h, imputable à Savr → crédit rendu');

-- ── 10. Refus définitif du prestataire : rendu, puis repris au renvoi ────────
SELECT pg_temp.collecte('c9', 'anti_gaspi', 'programmee', interval '3 days');
SELECT is(pg_temp.consommes(), 3, 'c9 : programmée → un crédit décompté');
UPDATE plateforme.collectes SET statut = 'rejetee_par_prestataire', statut_tms = 'rejetee_par_prestataire'
 WHERE id = 'a7d00000-0000-0000-0000-0000000000c9';
SELECT is(pg_temp.consommes(), 2, 'c9 : refusée par le prestataire → crédit rendu');
SELECT is(pg_temp.pack_de('c9'), NULL::uuid, 'c9 : ne porte plus de pack');
SELECT is(pg_temp.audits('pack_recredite_rejet_prestataire', 'c9'), 1, 'c9 : recrédit journalisé');
UPDATE plateforme.collectes SET statut = 'programmee', statut_tms = 'non_envoye'
 WHERE id = 'a7d00000-0000-0000-0000-0000000000c9';
SELECT is(pg_temp.consommes(), 3, 'c9 : renvoyée par l''Admin → crédit repris');
SELECT is(pg_temp.pack_de('c9'), 'a7d00000-0000-0000-0000-0000000000a1'::uuid, 'c9 : porte de nouveau P1');

-- ── 11. Annulation tardive sans pack : alerte, rattachable ───────────────────
SELECT pg_temp.collecte('ce', 'anti_gaspi', 'programmee', interval '1 hour');
SELECT is(pg_temp.pack_de('ce'), NULL::uuid, 'ce : programmée sans crédit');
UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = 'a7d00000-0000-0000-0000-0000000000ce';
SELECT is(
  (SELECT titre FROM plateforme.alertes_admin
    WHERE code = 'ag_annulee_tardive_sans_pack_actif' AND entity_type = 'collecte'
      AND entity_id = 'a7d00000-0000-0000-0000-0000000000ce' AND statut = 'ouverte'),
  'Annulation tardive AG sans pack actif', 'ce : alerte « annulation tardive sans pack actif »');
SELECT is(
  (SELECT message FROM plateforme.alertes_admin
    WHERE code = 'ag_annulee_tardive_sans_pack_actif' AND entity_id = 'a7d00000-0000-0000-0000-0000000000ce'),
  'La collecte a7d00000-0000-0000-0000-0000000000ce a été annulée tardivement sans crédit de pack AG : aucun crédit débité. La rattacher depuis sa fiche à un pack pris plus tard, ou imputer manuellement si nécessaire.',
  'ce : message de l''alerte');
SELECT is(pg_temp.consommes(), 3, 'ce : aucun débit');
SELECT ok(plateforme.f_collecte_rattachable_pack('a7d00000-0000-0000-0000-0000000000ce'),
  'ce : rattachable à un pack pris plus tard');

-- Refusée par le prestataire puis annulée à moins de 4 h : pas d'alerte « sans
-- pack » (le refus a rendu le crédit, rien à rattacher).
SELECT pg_temp.collecte('c2', 'anti_gaspi', 'programmee', interval '1 hour');
UPDATE plateforme.collectes SET statut = 'rejetee_par_prestataire', statut_tms = 'rejetee_par_prestataire'
 WHERE id = 'a7d00000-0000-0000-0000-0000000000c2';
UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = 'a7d00000-0000-0000-0000-0000000000c2';
SELECT ok(NOT EXISTS (SELECT 1 FROM plateforme.alertes_admin WHERE entity_id = 'a7d00000-0000-0000-0000-0000000000c2'),
  'c2 : refusée puis annulée tardivement → aucune alerte « sans pack »');

-- ── 12. Le pack d'une autre organisation n'est jamais touché ─────────────────
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a9'),
  0, 'Pv : le pack actif de la voisine n''a jamais été débité');

-- ── 13. L'attribution AG ne réserve plus de pack ─────────────────────────────
-- c1 est programmée sans crédit (P1 épuisé) ; un nouveau pack P2 est pris
-- ensuite. Avant le 2026-11-02, valider l'attribution posait P2 sur c1
-- (réservation). Désormais rien : c1 reste sans pack, P2 intact.
SELECT pg_temp.collecte('c1', 'anti_gaspi', 'programmee', interval '5 days');
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES ('a7d00000-0000-0000-0000-0000000000a2', 'a7d00000-0000-0000-0000-000000000001', 'personnalise', 5, 0, 2500, 'par_collecte', 'actif', CURRENT_DATE);
INSERT INTO plateforme.associations (id, nom, adresse, ville, region, contact_email, description_rapport_impact)
VALUES ('a7d00000-0000-0000-0000-0000000000d1', 'Asso Pack Test', '1 rue Asso', 'Paris', 'idf', 'asso@test-pack-programmation.test',
        'Association de test du pack Anti-Gaspi, dessert le secteur Paris centre.');
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, type_tms, actif, contact_nom, contact_email, contact_telephone, types_vehicules)
VALUES ('a7d00000-0000-0000-0000-0000000000d2', 'Transporteur Pack Test', '555555556', '2 rue Test', '75001', 'Paris', 'autre', true,
        'Contact', 'transporteur@test-pack-programmation.test', '0600000009', ARRAY['fourgon']);
SELECT is(
  plateforme.rpc_valider_attribution_ag(
    'a7d00000-0000-0000-0000-0000000000c1', 'a7d00000-0000-0000-0000-0000000000d1',
    'a7d00000-0000-0000-0000-0000000000d2', 'ag_province_proximite', 'manuel_top1',
    'a7d00000-0000-0000-0000-000000000010') ->> 'pack_id',
  NULL, 'c1 : attribution validée, aucun pack rendu');
SELECT is(pg_temp.pack_de('c1'), NULL::uuid, 'c1 : l''attribution ne pose aucun pack');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a2'),
  0, 'P2 : intact après l''attribution');

-- ── 14. Les fonctions ajoutées sont fermées (service_role seul) ──────────────
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.f_pack_debiter_credit(uuid)', 'EXECUTE'),
  'f_pack_debiter_credit : fermée à authenticated');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.f_pack_debiter_credit(uuid)', 'EXECUTE'),
  'f_pack_debiter_credit : fermée à anon');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.f_pack_recrediter_credit(uuid, uuid, text)', 'EXECUTE'),
  'f_pack_recrediter_credit : fermée à authenticated');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.f_pack_recrediter_credit(uuid, uuid, text)', 'EXECUTE'),
  'f_pack_recrediter_credit : fermée à anon');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.fn_trg_pack_debit_programmation()', 'EXECUTE'),
  'fn_trg_pack_debit_programmation : fermée à authenticated');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.fn_trg_pack_debit_programmation()', 'EXECUTE'),
  'fn_trg_pack_debit_programmation : fermée à anon');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.rpc_valider_attribution_ag(uuid, uuid, uuid, text, plateforme.mode_validation, uuid, text, text)', 'EXECUTE'),
  'rpc_valider_attribution_ag : toujours fermée à authenticated');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.rpc_valider_attribution_ag(uuid, uuid, uuid, text, plateforme.mode_validation, uuid, text, text)', 'EXECUTE'),
  'rpc_valider_attribution_ag : toujours fermée à anon');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.fn_trg_pack_debit_realisee()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'plateforme.fn_trg_pack_debit_realisee()', 'EXECUTE'),
  'fn_trg_pack_debit_realisee : fermée à authenticated et anon');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.fn_trg_pack_debit_annulation_tardive()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'plateforme.fn_trg_pack_debit_annulation_tardive()', 'EXECUTE'),
  'fn_trg_pack_debit_annulation_tardive : fermée à authenticated et anon');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.fn_trg_pack_recredit()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'plateforme.fn_trg_pack_recredit()', 'EXECUTE'),
  'fn_trg_pack_recredit : fermée à authenticated et anon');
SELECT ok(has_function_privilege('service_role', 'plateforme.f_pack_debiter_credit(uuid)', 'EXECUTE')
      AND has_function_privilege('service_role', 'plateforme.f_pack_recrediter_credit(uuid, uuid, text)', 'EXECUTE'),
  'service_role exécute les deux fonctions de crédit');

SELECT * FROM finish();
ROLLBACK;
