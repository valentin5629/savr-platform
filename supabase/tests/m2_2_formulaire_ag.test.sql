-- =============================================================================
-- M2.2 — Tests pgTAP : Formulaire AG (complétion)
-- =============================================================================
-- Couvre les cas non testés en M1.2 :
--   T1 : programmation_mixte_un_seul_e1    — ZD+AG sur même événement → 1 seul outbox E1
--   T2 : pack_ag_debit_uniquement_a_realisee — 2 INSERTs AG → credits_consommes inchangé
--   T3 : ag_realisee_sans_pack_alerte       — passage realisee sans pack → alerte Admin
-- Garde-fous TMS-Ready G4 : non-émission E1 pour AG confirmée en contexte mixte.
-- =============================================================================

BEGIN;
SELECT plan(4);

-- ── Fixtures partagées M2.2 ──────────────────────────────────────────────────

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES (
  '00000000-0000-0000-0022-000000000001'::uuid,
  'Traiteur M2.2', 'Traiteur M2.2 SAS', 'traiteur', '98765432100012', true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.entites_facturation (
  id, organisation_id, raison_sociale, siret,
  adresse_facturation, code_postal, ville, siret_verification
) VALUES (
  '00000000-0000-0000-0022-000000000002'::uuid,
  '00000000-0000-0000-0022-000000000001'::uuid,
  'Traiteur M2.2 SAS', '98765432100012',
  '5 Avenue Test', '75008', 'Paris', 'verifie'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max, actif)
VALUES (
  '00000000-0000-0000-0022-000000000003'::uuid,
  'Salle M2.2', '3 Rue M2.2', 'Paris', '75001', 'camionnette', true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.types_evenements (id, code, libelle, actif)
VALUES (
  '00000000-0000-0000-0022-000000000004'::uuid,
  'gala_m22_test', 'Gala M2.2 (test)', true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0022-000000000005'::uuid, 'test-m22@savr.io')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.users (id, email, prenom, nom, organisation_id, role)
VALUES (
  '00000000-0000-0000-0022-000000000005'::uuid, 'test-m22@savr.io',
  'Test', 'M22',
  '00000000-0000-0000-0022-000000000001'::uuid, 'traiteur_commercial'
) ON CONFLICT (id) DO NOTHING;

-- Pack AG actif pour T2 et T3 (1 seul crédit restant pour T2)
INSERT INTO plateforme.tarifs_packs_ag (
  id, valide_du,
  type_pack, credits, prix_unitaire_ht, montant_total_ht
) VALUES (
  '00000000-0000-0000-0022-000000000006'::uuid,
  '2026-01-01', 'unitaire', 1, 130.00, 130.00
) ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.packs_antgaspi (
  id, organisation_id,
  type_pack, credits_initiaux, credits_consommes,
  montant_total_ht, mode_facturation, statut, date_achat
) VALUES (
  '00000000-0000-0000-0022-000000000007'::uuid,
  '00000000-0000-0000-0022-000000000001'::uuid,
  'unitaire', 1, 0,
  130.00, 'par_collecte', 'actif', CURRENT_DATE
) ON CONFLICT (id) DO NOTHING;

-- ─── Test 1 : programmation_mixte_un_seul_e1 ─────────────────────────────────
-- Même événement → fn_creer_collecte appelée 2 fois (ZD + AG)
-- Attendu : exactement 1 outbox E1 (ZD), 0 pour AG

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  '00000000-0000-0000-0022-000000000010'::uuid,
  '00000000-0000-0000-0022-000000000001'::uuid,
  '00000000-0000-0000-0022-000000000001'::uuid,
  '00000000-0000-0000-0022-000000000002'::uuid,
  '00000000-0000-0000-0022-000000000003'::uuid,
  '00000000-0000-0000-0022-000000000005'::uuid,
  '00000000-0000-0000-0022-000000000004'::uuid,
  100, 'Contact Mixte', '0611223344'
);

SELECT plateforme.fn_creer_collecte(
  p_evenement_id := '00000000-0000-0000-0022-000000000010'::uuid,
  p_type := 'zd',
  p_date_collecte := CURRENT_DATE + 7,
  p_heure_collecte := '10:00'
);

SELECT plateforme.fn_creer_collecte(
  p_evenement_id := '00000000-0000-0000-0022-000000000010'::uuid,
  p_type := 'ag',
  p_date_collecte := CURRENT_DATE + 7,
  p_heure_collecte := '11:00'
);

SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.outbox_events oe
   JOIN plateforme.collectes c ON c.id = oe.aggregate_id
   WHERE c.evenement_id = '00000000-0000-0000-0022-000000000010'::uuid
     AND oe.event_type = 'collecte.creee'),
  1,
  'T1 : mixte ZD+AG → exactement 1 outbox E1 (ZD seule, 0 pour AG)'
);

-- ─── Test 2 : pack_ag_debit_uniquement_a_realisee ────────────────────────────
-- Deux collectes AG insérées (via INSERT direct) sans passer par realisee
-- Attendu : credits_consommes = 0 (débit uniquement à realisee via trigger M2.1)

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  '00000000-0000-0000-0022-000000000020'::uuid,
  '00000000-0000-0000-0022-000000000001'::uuid,
  '00000000-0000-0000-0022-000000000001'::uuid,
  '00000000-0000-0000-0022-000000000002'::uuid,
  '00000000-0000-0000-0022-000000000003'::uuid,
  '00000000-0000-0000-0022-000000000005'::uuid,
  '00000000-0000-0000-0022-000000000004'::uuid,
  80, 'Contact Debit', '0622334455'
);

SELECT plateforme.fn_creer_collecte(
  p_evenement_id := '00000000-0000-0000-0022-000000000020'::uuid,
  p_type := 'ag',
  p_date_collecte := CURRENT_DATE + 10,
  p_heure_collecte := '14:00'
);

SELECT plateforme.fn_creer_collecte(
  p_evenement_id := '00000000-0000-0000-0022-000000000020'::uuid,
  p_type := 'ag',
  p_date_collecte := CURRENT_DATE + 11,
  p_heure_collecte := '14:00'
);

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0022-000000000007'::uuid),
  0,
  'T2 : credits_consommes = 0 après 2 programmations AG (débit uniquement à realisee)'
);

-- ─── Test 3 : ag_realisee_sans_pack_alerte ────────────────────────────────────
-- Collecte AG existante, pack supprimé/épuisé → passage realisee → alerte Admin
-- Attendu : 1 ligne alertes_admin code='ag_realisee_sans_pack_actif' + credits inchangés

-- Créer un événement et une collecte AG
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  '00000000-0000-0000-0022-000000000030'::uuid,
  '00000000-0000-0000-0022-000000000001'::uuid,
  '00000000-0000-0000-0022-000000000001'::uuid,
  '00000000-0000-0000-0022-000000000002'::uuid,
  '00000000-0000-0000-0022-000000000003'::uuid,
  '00000000-0000-0000-0022-000000000005'::uuid,
  '00000000-0000-0000-0022-000000000004'::uuid,
  60, 'Contact Alerte', '0633445566'
);

INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte,
  nb_camions_demande, statut_tms
) VALUES (
  '00000000-0000-0000-0022-000000000031'::uuid,
  '00000000-0000-0000-0022-000000000030'::uuid,
  'anti_gaspi', 'programmee', CURRENT_DATE + 5, '09:00:00',
  1, 'non_envoye'
);

-- Épuiser/invalider le pack avant de passer à realisee
UPDATE plateforme.packs_antgaspi
SET statut = 'epuise', credits_consommes = credits_initiaux
WHERE id = '00000000-0000-0000-0022-000000000007'::uuid;

-- Passer la collecte à realisee → le trigger doit créer une alerte (aucun pack actif)
UPDATE plateforme.collectes
SET statut = 'realisee'
WHERE id = '00000000-0000-0000-0022-000000000031'::uuid;

SELECT ok(
  EXISTS(
    SELECT 1 FROM plateforme.alertes_admin
    WHERE code = 'ag_realisee_sans_pack_actif'
      AND entity_type = 'collecte'
      AND entity_id = '00000000-0000-0000-0022-000000000031'::uuid
  ),
  'T3a : alerte ag_realisee_sans_pack_actif créée dans alertes_admin'
);

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0022-000000000007'::uuid),
  (SELECT credits_initiaux FROM plateforme.packs_antgaspi
   WHERE id = '00000000-0000-0000-0022-000000000007'::uuid),
  'T3b : credits_consommes = credits_initiaux (aucun débit supplémentaire par le trigger)'
);

SELECT * FROM finish();
ROLLBACK;
