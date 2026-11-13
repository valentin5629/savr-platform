-- =============================================================================
-- Email à l'association d'un don AG : 48 h avant le créneau, pas avant
-- (Val 2026-11-13, migration 20261113150000).
-- VRAI chemin DB : fn_claim_outbox_attribution_batch retient l'event
-- `attribution.validee` tant que le créneau (date + heure, heure de Paris) est
-- à plus de 48 h, et relit la date à chaque passage.
--
-- Créneaux posés à 47 h 30 et 48 h 30 en heure de Paris : lus en UTC par erreur,
-- les deux tomberaient du même côté de la borne (décalage Paris ≥ 1 h).
-- Collecte refusée par le prestataire : retenu jusqu'au renvoi.
-- Events claimables : txid=1 (committé). UUID stricts hex.
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ─── Fixture minimale ────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES ('a4800000-0000-0000-0000-000000000001'::uuid, 'Traiteur 48h', 'traiteur', true, false, '11111111100048', 't48@test.com');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('a4800000-0000-0000-0000-000000000002'::uuid, 'test_48h', 'Test 48h');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('a4800000-0000-0000-0000-000000000003'::uuid, 'Salle 48h', '1 rue Paris', '75001', 'Paris', 'fourgon');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('a4800000-0000-0000-0000-000000000004'::uuid, 'a4800000-0000-0000-0000-000000000001'::uuid, 'mgr48@test.com', 'Jean', 'D', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('a4800000-0000-0000-0000-000000000005'::uuid, 'a4800000-0000-0000-0000-000000000001'::uuid, 'T48 SARL', '11111111100048', '1 rue Paris', '75001', 'Paris');

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'a4800000-0000-0000-0000-000000000006'::uuid,
  'a4800000-0000-0000-0000-000000000001'::uuid,
  'a4800000-0000-0000-0000-000000000003'::uuid,
  'a4800000-0000-0000-0000-000000000001'::uuid,
  'a4800000-0000-0000-0000-000000000005'::uuid,
  'a4800000-0000-0000-0000-000000000004'::uuid,
  'a4800000-0000-0000-0000-000000000002'::uuid,
  NOW() + INTERVAL '1 day', 100, 'Alice D', '0601020304');

-- Créneaux en heure de Paris, relatifs à maintenant.
CREATE TEMP TABLE creneaux ON COMMIT DROP AS
SELECT v.id, v.decalage, (now() AT TIME ZONE 'Europe/Paris') + v.decalage AS local_paris
FROM (VALUES
  ('c4800000-0000-0000-0000-0000000000a1'::uuid, interval '10 days'),
  ('c4800000-0000-0000-0000-0000000000b1'::uuid, interval '47 hours 30 minutes'),
  ('c4800000-0000-0000-0000-0000000000c1'::uuid, interval '48 hours 30 minutes'),
  ('c4800000-0000-0000-0000-0000000000d1'::uuid, interval '10 days')
) AS v(id, decalage);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
SELECT c.id, 'a4800000-0000-0000-0000-000000000006'::uuid, 'anti_gaspi', 'programmee', 'non_envoye',
       c.local_paris::date, c.local_paris::time
FROM creneaux c;

-- Un event par collecte, plus un event sans collecte (E).
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES
  ('e4800000-0000-0000-0000-0000000000a1', 1, 'collecte', 'c4800000-0000-0000-0000-0000000000a1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job'),
  ('e4800000-0000-0000-0000-0000000000b1', 1, 'collecte', 'c4800000-0000-0000-0000-0000000000b1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job'),
  ('e4800000-0000-0000-0000-0000000000c1', 1, 'collecte', 'c4800000-0000-0000-0000-0000000000c1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job'),
  ('e4800000-0000-0000-0000-0000000000d1', 1, 'collecte', 'c4800000-0000-0000-0000-0000000000d1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job'),
  ('e4800000-0000-0000-0000-0000000000e1', 1, 'collecte', 'c4800000-0000-0000-0000-0000000000e1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job');

-- ─── 1er passage ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE passage1 ON COMMIT DROP AS
  SELECT * FROM plateforme.fn_claim_outbox_attribution_batch(50);

SELECT is((SELECT count(*)::int FROM passage1 WHERE id = 'e4800000-0000-0000-0000-0000000000a1'), 0,
  'Créneau dans 10 jours : email retenu');
SELECT is((SELECT count(*)::int FROM passage1 WHERE id = 'e4800000-0000-0000-0000-0000000000b1'), 1,
  'Créneau dans 47 h 30 (heure de Paris) : email envoyé');
SELECT is((SELECT count(*)::int FROM passage1 WHERE id = 'e4800000-0000-0000-0000-0000000000c1'), 0,
  'Créneau dans 48 h 30 (heure de Paris) : email retenu');
SELECT is((SELECT count(*)::int FROM passage1 WHERE id = 'e4800000-0000-0000-0000-0000000000e1'), 1,
  'Event sans collecte correspondante : pas retenu');
SELECT is((SELECT statut::text FROM plateforme.outbox_events WHERE id = 'e4800000-0000-0000-0000-0000000000a1'), 'pending',
  'Event retenu : reste pending, sans tentative consommée');

-- ─── Créneau déplacé avant l'envoi : la date est relue ─────────────────────────
UPDATE plateforme.collectes
SET date_collecte = ((now() AT TIME ZONE 'Europe/Paris') + interval '24 hours')::date,
    heure_collecte = ((now() AT TIME ZONE 'Europe/Paris') + interval '24 hours')::time
WHERE id = 'c4800000-0000-0000-0000-0000000000d1';

CREATE TEMP TABLE passage2 ON COMMIT DROP AS
  SELECT * FROM plateforme.fn_claim_outbox_attribution_batch(50);

SELECT is((SELECT count(*)::int FROM passage2 WHERE id = 'e4800000-0000-0000-0000-0000000000d1'), 1,
  'Créneau avancé à demain : email envoyé au passage suivant');
SELECT is((SELECT count(*)::int FROM passage2 WHERE id = 'e4800000-0000-0000-0000-0000000000a1'), 0,
  'Créneau toujours dans 10 jours : email toujours retenu');

-- ─── Collecte refusée par le prestataire : retenu jusqu'au renvoi ─────────────
-- Créneau dans 24 h (sous la borne des 48 h) : seul le refus retient l'event.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES ('c4800000-0000-0000-0000-0000000000f1'::uuid, 'a4800000-0000-0000-0000-000000000006'::uuid,
        'anti_gaspi', 'programmee', 'non_envoye',
        ((now() AT TIME ZONE 'Europe/Paris') + interval '24 hours')::date,
        ((now() AT TIME ZONE 'Europe/Paris') + interval '24 hours')::time);
UPDATE plateforme.collectes SET statut = 'rejetee_par_prestataire'
WHERE id = 'c4800000-0000-0000-0000-0000000000f1';
SELECT is((SELECT statut::text FROM plateforme.collectes WHERE id = 'c4800000-0000-0000-0000-0000000000f1'),
  'rejetee_par_prestataire', 'Fixture : collecte F refusée par le prestataire');

INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('e4800000-0000-0000-0000-0000000000f1', 1, 'collecte', 'c4800000-0000-0000-0000-0000000000f1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job');

SELECT is((SELECT count(*)::int FROM plateforme.fn_claim_outbox_attribution_batch(50)
           WHERE id = 'e4800000-0000-0000-0000-0000000000f1'), 0,
  'Collecte refusée par le prestataire, créneau dans 24 h : email retenu');

UPDATE plateforme.collectes SET statut = 'programmee'
WHERE id = 'c4800000-0000-0000-0000-0000000000f1';

SELECT is((SELECT count(*)::int FROM plateforme.fn_claim_outbox_attribution_batch(50)
           WHERE id = 'e4800000-0000-0000-0000-0000000000f1'), 1,
  'Collecte renvoyée (programmee), créneau dans 24 h : email envoyé');

SELECT * FROM finish();
ROLLBACK;
