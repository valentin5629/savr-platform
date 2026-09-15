-- =============================================================================
-- E2 `collecte.modifiee` — le gate porte sur l'existence d'une COMMANDE chez le
-- prestataire, plus sur `collectes.tms_reference` (que rien n'ecrivait).
-- =============================================================================
-- Ce fichier verrouille la correction du 2026-09-15 (migration
-- 20260915100000_plateforme_e2_gate_commande_provider.sql).
--
-- ⚠ NON-COMPLAISANCE — c'est le point central de ce test. Les fixtures ci-dessous
-- ne posent JAMAIS `plateforme.collectes.tms_reference` a la main : elles montent
-- l'etat que l'adapter produit reellement au dispatch (une ligne `tournees` avec
-- `external_ref_commande`, liee par `collecte_tournees`). Le cas G10 asserte en
-- fin de parcours que la colonne est restee NULL sur toutes les collectes — donc
-- qu'aucune des E2 comptees ici ne peut venir d'elle.
--
-- C'est exactement le vice de l'ancien harnais : `tests.outbox_fixture_collecte`
-- posait `tms_reference = 'FIXTURE-REF-001'` avant d'appeler le dispatch, si bien
-- que l'assertion E2 de `outbox_par_mutation.test.sql` passait au vert alors que
-- le predicat etait TOUJOURS faux en production.
--
-- Les 3 RPC sont SECURITY DEFINER / service_role → appelees ici en superuser.
-- =============================================================================

BEGIN;
SELECT plan(10);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Fixtures referentiel ─────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('e29a0000-0000-0000-0000-000000000001'::uuid, 'Traiteur E2Gate', 'traiteur', true, false, 'E29A0000000001', 'e2gate@test.internal');

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('e29a0000-0000-0000-0000-0000000000e0'::uuid, 'cocktail_e2gate', 'Cocktail E2Gate');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('e29a0000-0000-0000-0000-0000000000a0'::uuid, 'e29a0000-0000-0000-0000-000000000001'::uuid, 'u@e2gate.test', 'U', 'E2Gate', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('e29a0000-0000-0000-0000-0000000000f0'::uuid, 'e29a0000-0000-0000-0000-000000000001'::uuid, 'Traiteur E2Gate SARL', 'E29A0000000001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('e29a0000-0000-0000-0000-0000000000b0'::uuid, 'Salle E2Gate', '1 rue', '75001', 'Paris', 'fourgon');

INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut) VALUES
  ('e29a0000-0000-0000-0000-0000000000d0'::uuid, 'Presta E2Gate', 'E2GATE', ARRAY['zd','ag'], 'manuel', 'actif');

-- 7 evenements (1 par collecte testee).
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
SELECT
  ('e29a0000-0000-0000-0000-0000000000e' || n)::uuid,
  'e29a0000-0000-0000-0000-000000000001'::uuid,
  'e29a0000-0000-0000-0000-0000000000b0'::uuid,
  'e29a0000-0000-0000-0000-000000000001'::uuid,
  'e29a0000-0000-0000-0000-0000000000f0'::uuid,
  'e29a0000-0000-0000-0000-0000000000a0'::uuid,
  'e29a0000-0000-0000-0000-0000000000e0'::uuid,
  current_date + 10, 100, 'Contact ' || n, '060' || n
FROM generate_series(1, 7) AS n;

-- Collectes — `tms_reference` laissee a NULL PARTOUT (defaut), volontairement.
--   c1 aucune tournee                         → gate ferme
--   c2 tournee SANS external_ref_commande     → gate ferme (commande pas encore posee)
--   c3 tournee AVEC commande (rang 1)         → gate ouvert
--   c4 2 tournees, commande au RANG 2 seul    → gate ouvert (insensible au rang)
--   c5 tournee AVEC commande                  → fn_dispatcher_collecte = renvoi
--   c6 aucune tournee                         → fn_dispatcher_collecte = 1er envoi
--   c7 tournee AVEC commande                  → annulation : E3 et pas E2
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
SELECT
  ('e29a0000-0000-0000-0000-0000000000c' || n)::uuid,
  ('e29a0000-0000-0000-0000-0000000000e' || n)::uuid,
  'zero_dechet', 'validee', 'acceptee', current_date + 10, '08:00'
FROM generate_series(1, 7) AS n;

-- Tournees : ce que l'adapter ecrit reellement au dispatch.
INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut, external_ref_commande) VALUES
  -- c2 : tournee creee, commande PAS encore posee (external_ref_commande NULL)
  ('e29a0000-0000-0000-0000-0000000000a2'::uuid, 'E2GATE-T2',   current_date + 10, 'nuit', 'e29a0000-0000-0000-0000-0000000000d0'::uuid, 'planifiee', NULL),
  ('e29a0000-0000-0000-0000-0000000000a3'::uuid, 'E2GATE-T3',   current_date + 10, 'nuit', 'e29a0000-0000-0000-0000-0000000000d0'::uuid, 'en_cours',  'CMD-T3'),
  -- c4 multi-camions : rang 1 sans commande (echec), rang 2 commande
  ('e29a0000-0000-0000-0000-0000000000a4'::uuid, 'E2GATE-T4R1', current_date + 10, 'nuit', 'e29a0000-0000-0000-0000-0000000000d0'::uuid, 'planifiee', NULL),
  ('e29a0000-0000-0000-0000-0000000000ab'::uuid, 'E2GATE-T4R2', current_date + 10, 'nuit', 'e29a0000-0000-0000-0000-0000000000d0'::uuid, 'en_cours',  'CMD-T4R2'),
  ('e29a0000-0000-0000-0000-0000000000a5'::uuid, 'E2GATE-T5',   current_date + 10, 'nuit', 'e29a0000-0000-0000-0000-0000000000d0'::uuid, 'en_cours',  'CMD-T5'),
  ('e29a0000-0000-0000-0000-0000000000a7'::uuid, 'E2GATE-T7',   current_date + 10, 'nuit', 'e29a0000-0000-0000-0000-0000000000d0'::uuid, 'en_cours',  'CMD-T7');

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
  ('e29a0000-0000-0000-0000-0000000000c2'::uuid, 'e29a0000-0000-0000-0000-0000000000a2'::uuid, 1),
  ('e29a0000-0000-0000-0000-0000000000c3'::uuid, 'e29a0000-0000-0000-0000-0000000000a3'::uuid, 1),
  ('e29a0000-0000-0000-0000-0000000000c4'::uuid, 'e29a0000-0000-0000-0000-0000000000a4'::uuid, 1),
  ('e29a0000-0000-0000-0000-0000000000c4'::uuid, 'e29a0000-0000-0000-0000-0000000000ab'::uuid, 2),
  ('e29a0000-0000-0000-0000-0000000000c5'::uuid, 'e29a0000-0000-0000-0000-0000000000a5'::uuid, 1),
  ('e29a0000-0000-0000-0000-0000000000c7'::uuid, 'e29a0000-0000-0000-0000-0000000000a7'::uuid, 1);

-- ── G1 : aucune commande chez le prestataire → pas d'E2 ──────────────────────
SELECT plateforme.fn_modifier_collecte(
  'e29a0000-0000-0000-0000-0000000000c1'::uuid,
  '{"heure_collecte": "09:30"}'::jsonb, ARRAY['heure_collecte']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'e29a0000-0000-0000-0000-0000000000c1'::uuid
       AND event_type = 'collecte.modifiee'),
  0, 'G1 collecte sans tournee -> pas d''E2 (rien a mettre a jour chez le prestataire)');

-- ── G2 : tournee creee mais commande pas encore posee → pas d'E2 ─────────────
SELECT plateforme.fn_modifier_collecte(
  'e29a0000-0000-0000-0000-0000000000c2'::uuid,
  '{"heure_collecte": "09:30"}'::jsonb, ARRAY['heure_collecte']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'e29a0000-0000-0000-0000-0000000000c2'::uuid
       AND event_type = 'collecte.modifiee'),
  0, 'G2 tournee sans external_ref_commande -> pas d''E2 (commande pas encore passee)');

-- ── G3 : LE CAS DU BUG — commande existante, tms_reference NULL → E2 emis ────
-- Avant la correction, ce cas etait a 0 : le gate lisait `collectes.tms_reference`,
-- qu'aucun code de production n'ecrit (verifie sur savr-dev : 619 collectes
-- dispatchees, 0 avec la colonne renseignee).
SELECT plateforme.fn_modifier_collecte(
  'e29a0000-0000-0000-0000-0000000000c3'::uuid,
  '{"heure_collecte": "09:30"}'::jsonb, ARRAY['heure_collecte']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'e29a0000-0000-0000-0000-0000000000c3'::uuid
       AND event_type = 'collecte.modifiee'),
  1, 'G3 commande existante + tms_reference NULL -> E2 emis (le bug corrige)');

-- ── G4 : multi-camions, commande au RANG 2 seulement → E2 emis ───────────────
-- Prouve que le predicat est « au moins une commande », pas « le rang 1 ». Une
-- garde adossee au seul rang 1 raterait ce cas (rang 1 echoue, rang 2 parti).
SELECT plateforme.fn_modifier_collecte(
  'e29a0000-0000-0000-0000-0000000000c4'::uuid,
  '{"heure_collecte": "09:30"}'::jsonb, ARRAY['heure_collecte']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'e29a0000-0000-0000-0000-0000000000c4'::uuid
       AND event_type = 'collecte.modifiee'),
  1, 'G4 multi-camions : commande au rang 2 seul -> E2 emis (insensible au rang)');

-- ── G5 : renvoi Ops d'une collecte deja commandee → E2, pas E1 ───────────────
-- Avant : fn_dispatcher_collecte renvoyait 'collecte.creee', que l'adapter absorbe
-- en no-op idempotent sur une tournee deja dispatchee → le bouton « Renvoyer au
-- TMS » ne propageait rien.
SELECT is(
  plateforme.fn_dispatcher_collecte('e29a0000-0000-0000-0000-0000000000c5'::uuid),
  'collecte.modifiee',
  'G5 renvoi d''une collecte deja commandee -> collecte.modifiee (et non collecte.creee)');

-- ── G6 : premier envoi → E1 (regression preservee) ───────────────────────────
SELECT is(
  plateforme.fn_dispatcher_collecte('e29a0000-0000-0000-0000-0000000000c6'::uuid),
  'collecte.creee',
  'G6 premier envoi (aucune commande) -> collecte.creee');

-- ── G7 : fn_modifier_evenement, meme gate ────────────────────────────────────
SELECT plateforme.fn_modifier_evenement(
  'e29a0000-0000-0000-0000-0000000000e3'::uuid,
  '{"contact_principal_nom": "Contact Modifie"}'::jsonb, ARRAY['contact_principal_nom']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'e29a0000-0000-0000-0000-0000000000c3'::uuid
       AND event_type = 'collecte.modifiee' AND payload->>'source' = 'evenement'),
  1, 'G7 modif contact evenement + commande existante -> E2 emis (meme gate)');

-- ── G8 : annulation → E3 et jamais E2 (regression preservee) ─────────────────
SELECT plateforme.fn_modifier_collecte(
  'e29a0000-0000-0000-0000-0000000000c7'::uuid,
  '{"statut": "annulee"}'::jsonb, ARRAY['statut']);
SELECT is(
  ARRAY(SELECT event_type::text FROM plateforme.outbox_events
          WHERE aggregate_id = 'e29a0000-0000-0000-0000-0000000000c7'::uuid
          ORDER BY event_type),
  ARRAY['collecte.annulee'],
  'G8 passage a annulee sur collecte commandee -> E3 seule, jamais E2');

-- ── G9 : le predicat n'est pas appelable par un role client ──────────────────
SELECT is(
  has_function_privilege('authenticated',
    'plateforme.fn_collecte_commandee_chez_provider(uuid)', 'EXECUTE'),
  false, 'G9 authenticated n''a pas EXECUTE sur fn_collecte_commandee_chez_provider');

-- ── G10 : NON-COMPLAISANCE — aucune fixture n'a pose tms_reference ───────────
-- Si ce cas tombe, une E2 comptee plus haut a pu venir de la colonne et non du
-- nouveau predicat : les cas G3/G4/G5/G7 perdraient toute valeur probante.
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes
     WHERE id::text LIKE 'e29a0000-0000-0000-0000-0000000000c%'
       AND tms_reference IS NOT NULL),
  0, 'G10 aucune collecte fixture ne porte tms_reference (les E2 ci-dessus ne peuvent en venir)');

SELECT * FROM finish();
ROLLBACK;
