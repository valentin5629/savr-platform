-- pgTAP — Annulation tardive AG : le crédit se débite sur le pack ACTIF de
-- l'organisation programmatrice (§05 §3 « Débit d'un crédit », F3), pas sur le
-- pack réservé à l'envoi au transporteur (migration 20261016173000).
--
-- Couvre : le cas qui échouait (pack réservé épuisé entre l'envoi et
-- l'annulation → 23514 sur chk_pack_credits_limite) : l'annulation aboutit,
-- aucun débit, réservation levée, alerte, collecte rattachable ; réservation
-- épuisée mais nouveau pack actif → débit du nouveau pack ; collecte jamais
-- envoyée (sans réservation) → débit du pack actif ; dernier crédit consommé
-- par une annulation → pack épuisé et alerte sur ce pack ; le pack actif d'une
-- autre organisation n'est jamais touché, même quand une collecte de o1 le
-- réserve.

BEGIN;
SELECT plan(23);

-- ── Fixtures (identifiants improbables, hexadécimaux) ─────────────────────────
-- o1 : l'organisation des collectes ; o2 : une voisine dont le pack actif ne
-- doit jamais bouger.
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('a7d00000-0000-0000-0000-000000000001', 'Org Annulation Tardive', 'Org Annulation Tardive', 'traiteur', '98765432109811', true),
  ('a7d00000-0000-0000-0000-0000000000b2', 'Org Voisine AT', 'Org Voisine AT', 'traiteur', '98765432109812', true);
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('a7d00000-0000-0000-0000-000000000009', 'ANNUL_TARDIVE_TEST', 'Annulation tardive Test', 1, true);
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('a7d00000-0000-0000-0000-000000000002', 'Salle Annulation', '1 rue Test', 'Paris', '75001', 'camionnette');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('a7d00000-0000-0000-0000-000000000010', 'a7d00000-0000-0000-0000-000000000001',
  'admin@test-annulation-tardive.test', 'Admin', 'Test', 'admin_savr');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('a7d00000-0000-0000-0000-000000000011', 'a7d00000-0000-0000-0000-000000000001',
  'Org Annulation Tardive SARL', '98765432109811', '1 rue Test', '75001', 'Paris');
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

-- P1 : un seul crédit. Pv : pack actif de la voisine.
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES
  ('a7d00000-0000-0000-0000-0000000000a1', 'a7d00000-0000-0000-0000-000000000001', 'personnalise', 1, 0, 500, 'par_collecte', 'actif', CURRENT_DATE),
  ('a7d00000-0000-0000-0000-0000000000a9', 'a7d00000-0000-0000-0000-0000000000b2', 'personnalise', 5, 0, 2500, 'par_collecte', 'actif', CURRENT_DATE);

-- Collectes de o1. Toutes ont leur créneau dans une heure (heure de Paris) :
-- une annulation maintenant est tardive (< 4 h).
--   ca : réalisée, consomme le seul crédit de P1
--   cb, cc : ont réservé P1 à l'envoi au transporteur (pack_antgaspi_id posé,
--            comme le fait le dispatch), avant son épuisement
--   cd, ce : jamais envoyées, sans réservation
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms, pack_antgaspi_id)
SELECT ('a7d00000-0000-0000-0000-0000000000' || suffixe)::uuid, 'a7d00000-0000-0000-0000-000000000003',
       'anti_gaspi', statut::plateforme.collecte_statut,
       ((now() + interval '1 hour') AT TIME ZONE 'Europe/Paris')::date,
       ((now() + interval '1 hour') AT TIME ZONE 'Europe/Paris')::time,
       1, statut_tms::plateforme.collecte_statut_tms, pack::uuid
  FROM (VALUES
    ('ca', 'programmee', 'non_envoye', NULL),
    ('cb', 'validee', 'acceptee', 'a7d00000-0000-0000-0000-0000000000a1'),
    ('cc', 'validee', 'acceptee', 'a7d00000-0000-0000-0000-0000000000a1'),
    ('cd', 'programmee', 'non_envoye', NULL),
    ('ce', 'programmee', 'non_envoye', NULL)
  ) AS v(suffixe, statut, statut_tms, pack);

UPDATE plateforme.collectes SET statut = 'realisee'
 WHERE id = 'a7d00000-0000-0000-0000-0000000000ca';
SELECT is((SELECT statut::text FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a1'),
  'epuise', 'Préalable : la réalisation de ca consomme le seul crédit de P1, épuisé');

-- ── 1. Le cas qui échouait : la réservation est épuisée, aucun pack actif ─────
-- Avant le correctif : débit de P1 au-delà de credits_initiaux → 23514.
SELECT lives_ok(
  $$ UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = 'a7d00000-0000-0000-0000-0000000000cb' $$,
  'cb : annulation tardive aboutit alors que son pack réservé est épuisé (plus de 23514)');
SELECT is((SELECT statut::text FROM plateforme.collectes WHERE id = 'a7d00000-0000-0000-0000-0000000000cb'),
  'annulee', 'cb : annulée');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a1'),
  1, 'cb : aucun débit, P1 reste à 1 crédit consommé sur 1');
SELECT is((SELECT pack_antgaspi_id FROM plateforme.collectes WHERE id = 'a7d00000-0000-0000-0000-0000000000cb'),
  NULL::uuid, 'cb : la réservation périmée est levée');
SELECT is(
  (SELECT statut FROM plateforme.alertes_admin
    WHERE code = 'ag_annulee_tardive_sans_pack_actif' AND entity_type = 'collecte'
      AND entity_id = 'a7d00000-0000-0000-0000-0000000000cb'),
  'ouverte', 'cb : alerte « annulation tardive sans pack actif » ouverte');
-- Titre et message tels que la page Admin des alertes les affiche.
SELECT is(
  (SELECT titre FROM plateforme.alertes_admin
    WHERE code = 'ag_annulee_tardive_sans_pack_actif' AND entity_type = 'collecte'
      AND entity_id = 'a7d00000-0000-0000-0000-0000000000cb'),
  'Annulation tardive AG sans pack actif', 'cb : titre de l''alerte');
SELECT is(
  (SELECT message FROM plateforme.alertes_admin
    WHERE code = 'ag_annulee_tardive_sans_pack_actif' AND entity_type = 'collecte'
      AND entity_id = 'a7d00000-0000-0000-0000-0000000000cb'),
  'La collecte a7d00000-0000-0000-0000-0000000000cb a été annulée tardivement sans pack AG actif : aucun crédit débité. La rattacher depuis sa fiche à un pack pris plus tard, ou imputer manuellement si nécessaire.',
  'cb : message de l''alerte');
SELECT ok(plateforme.f_collecte_rattachable_pack('a7d00000-0000-0000-0000-0000000000cb'),
  'cb : rattachable à un pack pris plus tard');
SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
    WHERE action = 'pack_debite_annulation_tardive'
      AND old_values ->> 'collecte_id' = 'a7d00000-0000-0000-0000-0000000000cb'),
  0, 'cb : aucun débit journalisé');

-- ── 2. Réservation épuisée, nouveau pack actif : débit du pack actif ──────────
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES ('a7d00000-0000-0000-0000-0000000000a2', 'a7d00000-0000-0000-0000-000000000001', 'personnalise', 3, 0, 1500, 'par_collecte', 'actif', CURRENT_DATE);

UPDATE plateforme.collectes SET statut = 'annulee'
 WHERE id = 'a7d00000-0000-0000-0000-0000000000cc';
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a2'),
  1, 'cc : un crédit débité sur P2, le pack actif');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a1'),
  1, 'cc : P1, réservé à l''envoi, n''est pas touché');
SELECT is((SELECT pack_antgaspi_id FROM plateforme.collectes WHERE id = 'a7d00000-0000-0000-0000-0000000000cc'),
  'a7d00000-0000-0000-0000-0000000000a2'::uuid, 'cc : porte le pack consommé P2');
SELECT is(
  (SELECT record_id FROM plateforme.audit_log
    WHERE action = 'pack_debite_annulation_tardive' AND table_name = 'packs_antgaspi'
      AND old_values ->> 'collecte_id' = 'a7d00000-0000-0000-0000-0000000000cc'),
  'a7d00000-0000-0000-0000-0000000000a2'::uuid, 'cc : débit journalisé sur P2');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM plateforme.alertes_admin
   WHERE code = 'ag_annulee_tardive_sans_pack_actif' AND entity_id = 'a7d00000-0000-0000-0000-0000000000cc'),
  'cc : aucune alerte « sans pack actif »');

-- ── 3. Collecte jamais envoyée (sans réservation) : débit du pack actif ───────
UPDATE plateforme.collectes SET statut = 'annulee'
 WHERE id = 'a7d00000-0000-0000-0000-0000000000cd';
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a2'),
  2, 'cd : sans réservation, un crédit débité sur P2');
SELECT is((SELECT pack_antgaspi_id FROM plateforme.collectes WHERE id = 'a7d00000-0000-0000-0000-0000000000cd'),
  'a7d00000-0000-0000-0000-0000000000a2'::uuid, 'cd : porte le pack consommé P2');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM plateforme.alertes_admin
   WHERE code = 'ag_annulee_tardive_sans_pack_actif' AND entity_id = 'a7d00000-0000-0000-0000-0000000000cd'),
  'cd : aucune alerte « sans pack actif »');

-- ── 4. Dernier crédit consommé par une annulation ─────────────────────────────
UPDATE plateforme.collectes SET statut = 'annulee'
 WHERE id = 'a7d00000-0000-0000-0000-0000000000ce';
SELECT is((SELECT statut::text FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a2'),
  'epuise', 'ce : dernier crédit de P2 → épuisé');
SELECT ok(EXISTS (
  SELECT 1 FROM plateforme.alertes_admin
   WHERE code = 'pack_ag_epuise' AND entity_type = 'pack_antgaspi'
     AND entity_id = 'a7d00000-0000-0000-0000-0000000000a2' AND statut = 'ouverte'),
  'ce : alerte « pack épuisé » sur P2');

-- ── 5. Le pack d'une autre organisation n'est jamais touché ──────────────────
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a9'),
  0, 'Pv : le pack actif de la voisine n''a jamais été débité');

-- ── 6. Réservation sur le pack actif d'une AUTRE organisation ────────────────
-- cf (de o1) réserve Pv, le pack actif de la voisine. Le corps de
-- 20261015180000 débitait le pack réservé quelle que soit son organisation.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms, pack_antgaspi_id)
VALUES ('a7d00000-0000-0000-0000-0000000000cf', 'a7d00000-0000-0000-0000-000000000003', 'anti_gaspi', 'validee',
        ((now() + interval '1 hour') AT TIME ZONE 'Europe/Paris')::date,
        ((now() + interval '1 hour') AT TIME ZONE 'Europe/Paris')::time,
        1, 'acceptee', 'a7d00000-0000-0000-0000-0000000000a9');
UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = 'a7d00000-0000-0000-0000-0000000000cf';
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'a7d00000-0000-0000-0000-0000000000a9'),
  0, 'cf : réservation sur le pack de la voisine, Pv jamais débité');
SELECT is((SELECT pack_antgaspi_id FROM plateforme.collectes WHERE id = 'a7d00000-0000-0000-0000-0000000000cf'),
  NULL::uuid, 'cf : ne pointe plus vers le pack de la voisine');

SELECT * FROM finish();
ROLLBACK;
