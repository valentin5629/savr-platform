-- pgTAP M0.3 / BL-P2-30 — Alerte « pack AG bientôt épuisé » (franchissement ≤10%)
-- + ré-arme au recrédit. §05 l.1018 / §06.02 l.204 (F4). Table alertes_admin.

BEGIN;
SELECT plan(6);

-- ── Colonne pont trigger → email ──────────────────────────────────────────
SELECT has_column(
  'plateforme', 'alertes_admin', 'email_notifie_at',
  'colonne alertes_admin.email_notifie_at (pont cron tpl 9) existe'
);

-- ── Fixtures ──────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('0a000000-0000-0000-0000-000000000001'::uuid, 'Org Bas', 'Org Bas', 'traiteur', '11111111100011', true),
  ('0a000000-0000-0000-0000-000000000002'::uuid, 'Org Epuise', 'Org Epuise', 'traiteur', '22222222200022', true);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('0a000000-0000-0000-0000-000000000009'::uuid, 'GALA_M03', 'Gala M0.3', 1, true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('0a000000-0000-0000-0000-000000000003'::uuid, 'Salle M0.3', '1 rue M0.3', 'Paris', '75001', 'camionnette');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('0a000000-0000-0000-0000-000000000010'::uuid, '0a000000-0000-0000-0000-000000000001'::uuid,
  'admin@m03.test', 'Admin', 'M03', 'admin_savr');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('0a000000-0000-0000-0000-000000000021'::uuid, '0a000000-0000-0000-0000-000000000001'::uuid, 'Org Bas SARL', '11111111100011', '1 rue', '75001', 'Paris'),
  ('0a000000-0000-0000-0000-000000000022'::uuid, '0a000000-0000-0000-0000-000000000002'::uuid, 'Org Epuise SARL', '22222222200022', '2 rue', '75002', 'Paris');

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  ('0a000000-0000-0000-0000-000000000031'::uuid, '0a000000-0000-0000-0000-000000000001'::uuid,
   '0a000000-0000-0000-0000-000000000001'::uuid, '0a000000-0000-0000-0000-000000000021'::uuid,
   '0a000000-0000-0000-0000-000000000010'::uuid, '0a000000-0000-0000-0000-000000000003'::uuid,
   '0a000000-0000-0000-0000-000000000009'::uuid, CURRENT_DATE + INTERVAL '1 day', 200, 'C', '0600000001'),
  ('0a000000-0000-0000-0000-000000000032'::uuid, '0a000000-0000-0000-0000-000000000002'::uuid,
   '0a000000-0000-0000-0000-000000000002'::uuid, '0a000000-0000-0000-0000-000000000022'::uuid,
   '0a000000-0000-0000-0000-000000000010'::uuid, '0a000000-0000-0000-0000-000000000003'::uuid,
   '0a000000-0000-0000-0000-000000000009'::uuid, CURRENT_DATE + INTERVAL '1 day', 50, 'C', '0600000002');

-- Pack Org Bas : 50 crédits, 44 consommés → 6 restants (12 % > 10 %).
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES ('0a000000-0000-0000-0000-000000000041'::uuid, '0a000000-0000-0000-0000-000000000001'::uuid,
  'personnalise', 50, 44, 100.00, 'par_collecte', 'actif', CURRENT_DATE);

-- Pack Org Epuise : 1 crédit, 0 consommé → franchit directement à épuisé.
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES ('0a000000-0000-0000-0000-000000000042'::uuid, '0a000000-0000-0000-0000-000000000002'::uuid,
  'unitaire', 1, 0, 100.00, 'par_collecte', 'actif', CURRENT_DATE);

-- Collectes AG programmées
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms) VALUES
  ('0a000000-0000-0000-0000-000000000051'::uuid, '0a000000-0000-0000-0000-000000000031'::uuid, 'anti_gaspi', 'programmee', CURRENT_DATE + INTERVAL '1 day', '09:00:00', 1, 'non_envoye'),
  ('0a000000-0000-0000-0000-000000000052'::uuid, '0a000000-0000-0000-0000-000000000031'::uuid, 'anti_gaspi', 'programmee', CURRENT_DATE + INTERVAL '2 days', '09:00:00', 1, 'non_envoye'),
  ('0a000000-0000-0000-0000-000000000053'::uuid, '0a000000-0000-0000-0000-000000000032'::uuid, 'anti_gaspi', 'programmee', CURRENT_DATE + INTERVAL '1 day', '09:00:00', 1, 'non_envoye');

-- ── 1. Franchissement du seuil : 6 → 5 restants (>10 % → ≤10 %) ───────────
UPDATE plateforme.collectes SET statut = 'realisee'
WHERE id = '0a000000-0000-0000-0000-000000000051'::uuid;

SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_bas' AND entity_type = 'pack_antgaspi'
     AND entity_id = '0a000000-0000-0000-0000-000000000041'::uuid AND statut = 'ouverte'),
  1,
  'franchissement ≤10 % → 1 alerte pack_ag_bas ouverte'
);

-- ── 2. Pas de répétition : 5 → 4 restants (déjà sous le seuil) ────────────
UPDATE plateforme.collectes SET statut = 'realisee'
WHERE id = '0a000000-0000-0000-0000-000000000052'::uuid;

SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_bas' AND entity_type = 'pack_antgaspi'
     AND entity_id = '0a000000-0000-0000-0000-000000000041'::uuid AND statut = 'ouverte'),
  1,
  'décrément sous le seuil déjà franchi → pas de nouvelle alerte pack_ag_bas'
);

-- ── 3. Épuisement direct : pack_ag_epuise, jamais pack_ag_bas ─────────────
UPDATE plateforme.collectes SET statut = 'realisee'
WHERE id = '0a000000-0000-0000-0000-000000000053'::uuid;

SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_epuise' AND entity_id = '0a000000-0000-0000-0000-000000000042'::uuid AND statut = 'ouverte'),
  1,
  'pack épuisé → 1 alerte pack_ag_epuise ouverte'
);
SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_bas' AND entity_id = '0a000000-0000-0000-0000-000000000042'::uuid),
  0,
  'passage direct à épuisé n’émet jamais pack_ag_bas'
);

-- ── 4. Ré-arme : recrédit qui repasse > 10 % résout l’alerte ouverte ──────
-- Annuler la collecte 52 (46→45, restants 5, toujours ≤10 % → pas de ré-arme),
-- puis la collecte 51 (45→44, restants 6 > 10 % → résout pack_ag_bas).
UPDATE plateforme.collectes SET statut = 'annulee'
WHERE id = '0a000000-0000-0000-0000-000000000052'::uuid;
UPDATE plateforme.collectes SET statut = 'annulee'
WHERE id = '0a000000-0000-0000-0000-000000000051'::uuid;

SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_bas' AND entity_type = 'pack_antgaspi'
     AND entity_id = '0a000000-0000-0000-0000-000000000041'::uuid AND statut = 'ouverte'),
  0,
  'recrédit >10 % ré-arme : alerte pack_ag_bas résolue (F4)'
);

SELECT * FROM finish();
ROLLBACK;
