-- =============================================================================
-- R22c / BL-P2-10 — fn_modifier_evenement : émission E2 (collecte.modifiee) sur
-- modification de contacts/pax d'un événement, ÉTENDUE aux collectes `en_cours`.
-- =============================================================================
-- Prouve la décision Val 2026-07-08 (cf. _Divergences/M1.4_20260708.md) :
--   • contacts/pax propagés au TMS via le modèle IMMÉDIAT M1.2 (§05 l.325), PAS via
--     un trigger dirty_tms (qui provoquerait un double-push).
--   • fenêtre d'émission E2 = programmee / validee / EN_COURS (ordre MTS-1 vivant),
--     garde « une commande existe chez le prestataire » ; états terminaux exclus.
-- ⚠ Fixtures mises à jour le 2026-09-15 : le « dispatché » se matérialise désormais
--   par une tournée portant `external_ref_commande` (ce que l'adapter écrit), plus
--   par `collectes.tms_reference` posée à la main — colonne qu'aucun code de
--   production n'écrit, et sur laquelle le gate E2 portait à tort.
-- fn_modifier_evenement est SECURITY DEFINER / service_role → appelée ici en superuser.
-- =============================================================================

BEGIN;
SELECT plan(8);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('c22c0000-0000-0000-0000-000000000001'::uuid, 'Traiteur R22c', 'traiteur', true, false, 'C22C0000000001', 'r22c@test.com');

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('c22c0000-0000-0000-0000-0000000000e0'::uuid, 'cocktail_r22c', 'Cocktail R22c');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('c22c0000-0000-0000-0000-0000000000a0'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'u@r22c.test', 'U', 'R22c', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('c22c0000-0000-0000-0000-0000000000f0'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'Traiteur R22c SARL', 'C22C0000000001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('c22c0000-0000-0000-0000-0000000000b0'::uuid, 'Salle R22c', '1 rue', '75001', 'Paris', 'fourgon');

-- 6 événements (1 par cas). pax=100 par défaut ; contact principal initial.
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  ('c22c0000-0000-0000-0000-0000000000e1'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000b0'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000f0'::uuid, 'c22c0000-0000-0000-0000-0000000000a0'::uuid, 'c22c0000-0000-0000-0000-0000000000e0'::uuid, current_date + 10, 100, 'Alice', '0601'),
  ('c22c0000-0000-0000-0000-0000000000e2'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000b0'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000f0'::uuid, 'c22c0000-0000-0000-0000-0000000000a0'::uuid, 'c22c0000-0000-0000-0000-0000000000e0'::uuid, current_date + 10, 100, 'Bob', '0602'),
  ('c22c0000-0000-0000-0000-0000000000e3'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000b0'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000f0'::uuid, 'c22c0000-0000-0000-0000-0000000000a0'::uuid, 'c22c0000-0000-0000-0000-0000000000e0'::uuid, current_date + 10, 100, 'Carl', '0603'),
  ('c22c0000-0000-0000-0000-0000000000e4'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000b0'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000f0'::uuid, 'c22c0000-0000-0000-0000-0000000000a0'::uuid, 'c22c0000-0000-0000-0000-0000000000e0'::uuid, current_date + 10, 100, 'Dina', '0604'),
  ('c22c0000-0000-0000-0000-0000000000e5'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000b0'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000f0'::uuid, 'c22c0000-0000-0000-0000-0000000000a0'::uuid, 'c22c0000-0000-0000-0000-0000000000e0'::uuid, current_date + 10, 100, 'Eve', '0605'),
  ('c22c0000-0000-0000-0000-0000000000e6'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000b0'::uuid, 'c22c0000-0000-0000-0000-000000000001'::uuid, 'c22c0000-0000-0000-0000-0000000000f0'::uuid, 'c22c0000-0000-0000-0000-0000000000a0'::uuid, 'c22c0000-0000-0000-0000-0000000000e0'::uuid, current_date + 10, 100, 'Fred', '0606');

-- Collectes : cc1 en_cours dispatchée (contact) · cc2 programmee dispatchée (contact,
-- régression) · cc3 en_cours dispatchée AG (pax → E2 + volume) · cc4 en_cours NON
-- dispatchée (aucune commande) · cc5 cloturee dispatchée (terminal exclu) ·
-- cc6 en_cours dispatchée (champ non-TMS).
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut) VALUES
  ('c22c0000-0000-0000-0000-0000000000d0'::uuid, 'Presta R22c', 'R22C', ARRAY['zd','ag'], 'manuel', 'actif');

-- `prestataire_logistique_id` renseigne comme en production (fn_dispatcher_collecte
-- le pose) : depuis le 2026-09-15, le gate E2 compare le `type_tms` du prestataire
-- de la collecte a celui du prestataire de la tournee. Une collecte sans
-- prestataire n'est « commandee » nulle part.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, prestataire_logistique_id) VALUES
  ('c22c0000-0000-0000-0000-0000000000c1'::uuid, 'c22c0000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'en_cours',   'acceptee',   current_date + 10, '08:00', 'c22c0000-0000-0000-0000-0000000000d0'::uuid),
  ('c22c0000-0000-0000-0000-0000000000c2'::uuid, 'c22c0000-0000-0000-0000-0000000000e2'::uuid, 'zero_dechet', 'programmee', 'acceptee',   current_date + 10, '08:00', 'c22c0000-0000-0000-0000-0000000000d0'::uuid),
  ('c22c0000-0000-0000-0000-0000000000c3'::uuid, 'c22c0000-0000-0000-0000-0000000000e3'::uuid, 'anti_gaspi', 'en_cours',   'acceptee',   current_date + 10, '08:00', 'c22c0000-0000-0000-0000-0000000000d0'::uuid),
  ('c22c0000-0000-0000-0000-0000000000c4'::uuid, 'c22c0000-0000-0000-0000-0000000000e4'::uuid, 'zero_dechet', 'en_cours',   'non_envoye', current_date + 10, '08:00', 'c22c0000-0000-0000-0000-0000000000d0'::uuid),
  ('c22c0000-0000-0000-0000-0000000000c5'::uuid, 'c22c0000-0000-0000-0000-0000000000e5'::uuid, 'zero_dechet', 'cloturee',   'acceptee',   current_date + 10, '08:00', 'c22c0000-0000-0000-0000-0000000000d0'::uuid),
  ('c22c0000-0000-0000-0000-0000000000c6'::uuid, 'c22c0000-0000-0000-0000-0000000000e6'::uuid, 'zero_dechet', 'en_cours',   'acceptee',   current_date + 10, '08:00', 'c22c0000-0000-0000-0000-0000000000d0'::uuid);

-- « Dispatchée » = une commande existe chez le prestataire, soit une tournée avec
-- `external_ref_commande` liée par `collecte_tournees` (état que l'adapter écrit).
-- cc4 n'en a AUCUNE → c'est elle, et elle seule, qui reste hors du gate (cas R22c-5).
-- Le prestataire porte son transporteur : c'est `transporteurs.type_tms` qui
-- tranche le provider d'une tournee (cf. fn_collecte_commandee_chez_provider).
INSERT INTO plateforme.transporteurs
  (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
   contact_nom, contact_email, contact_telephone, prestataire_logistique_id,
   code_transporteur_mts1)
VALUES
  ('c22c0000-0000-0000-0000-0000000000b0'::uuid, 'Transporteur R22c', '920000001',
   '1 rue', '75001', 'Paris', ARRAY['fourgon'], 'mts1',
   'C', 'r22c@example.invalid', '+33600000000',
   'c22c0000-0000-0000-0000-0000000000d0'::uuid, 'R22C-CODE');

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut, external_ref_commande)
SELECT ('c22c0000-0000-0000-0000-0000000000' || n)::uuid, 'R22C-TOUR-' || n, current_date + 10, 'nuit',
       'c22c0000-0000-0000-0000-0000000000d0'::uuid, 'en_cours', 'CMD-R22C-' || n
FROM unnest(ARRAY['a1','a2','a3','a5','a6']) AS n;

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang)
SELECT ('c22c0000-0000-0000-0000-0000000000c' || right(n,1))::uuid,
       ('c22c0000-0000-0000-0000-0000000000' || n)::uuid, 1
FROM unnest(ARRAY['a1','a2','a3','a5','a6']) AS n;

-- ── R22c-1 : contact sur collecte EN_COURS dispatchée → E2 émis (le fix) ──────
SELECT plateforme.fn_modifier_evenement(
  'c22c0000-0000-0000-0000-0000000000e1'::uuid,
  '{"contact_principal_nom": "Alice Modifiee"}'::jsonb, ARRAY['contact_principal_nom']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'c22c0000-0000-0000-0000-0000000000c1'::uuid
       AND event_type = 'collecte.modifiee' AND payload->>'source' = 'evenement'),
  1, 'R22c-1 modif contact sur collecte en_cours dispatchee -> E2 emis');

-- ── R22c-2 : contact sur collecte PROGRAMMEE dispatchée → E2 (régression) ─────
SELECT plateforme.fn_modifier_evenement(
  'c22c0000-0000-0000-0000-0000000000e2'::uuid,
  '{"contact_principal_telephone": "0699"}'::jsonb, ARRAY['contact_principal_telephone']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'c22c0000-0000-0000-0000-0000000000c2'::uuid
       AND event_type = 'collecte.modifiee'),
  1, 'R22c-2 modif contact sur collecte programmee dispatchee -> E2 (regression preservee)');

-- ── R22c-8 : durcissement — authenticated n'a PAS EXECUTE (service_role only) ──
-- CREATE OR REPLACE ne réinitialise pas les grants ; verrou contre un GRANT accidentel.
SELECT is(
  has_function_privilege('authenticated',
    'plateforme.fn_modifier_evenement(uuid, jsonb, text[])', 'EXECUTE'),
  false, 'R22c-8 authenticated n''a pas EXECUTE sur fn_modifier_evenement (service_role only)');

-- ── R22c-3 : pax sur collecte EN_COURS AG dispatchée → E2 émis ────────────────
SELECT plateforme.fn_modifier_evenement(
  'c22c0000-0000-0000-0000-0000000000e3'::uuid,
  '{"pax": 300}'::jsonb, ARRAY['pax']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'c22c0000-0000-0000-0000-0000000000c3'::uuid
       AND event_type = 'collecte.modifiee'),
  1, 'R22c-3 modif pax sur collecte en_cours dispatchee -> E2 emis');

-- ── R22c-4 : pax sur collecte EN_COURS AG → recalcul volume_estime_repas ──────
SELECT is(
  (SELECT volume_estime_repas FROM plateforme.collectes WHERE id='c22c0000-0000-0000-0000-0000000000c3'::uuid),
  30, 'R22c-4 recalcul volume_estime_repas sur pax en_cours (ROUND(0.10*300)=30)');

-- ── R22c-5 : contact sur collecte EN_COURS NON dispatchée (0 commande) → pas d'E2 ─
SELECT plateforme.fn_modifier_evenement(
  'c22c0000-0000-0000-0000-0000000000e4'::uuid,
  '{"contact_principal_nom": "Dina Modifiee"}'::jsonb, ARRAY['contact_principal_nom']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'c22c0000-0000-0000-0000-0000000000c4'::uuid
       AND event_type = 'collecte.modifiee'),
  0, 'R22c-5 modif contact sur collecte non dispatchee (aucune commande) -> pas d''E2');

-- ── R22c-6 : contact sur collecte CLOTUREE (terminal) → pas d'E2 ──────────────
SELECT plateforme.fn_modifier_evenement(
  'c22c0000-0000-0000-0000-0000000000e5'::uuid,
  '{"contact_principal_nom": "Eve Modifiee"}'::jsonb, ARRAY['contact_principal_nom']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'c22c0000-0000-0000-0000-0000000000c5'::uuid
       AND event_type = 'collecte.modifiee'),
  0, 'R22c-6 modif contact sur collecte cloturee (terminal) -> pas d''E2');

-- ── R22c-7 : champ NON propagé au TMS (nom_evenement) sur en_cours → pas d'E2 ─
SELECT plateforme.fn_modifier_evenement(
  'c22c0000-0000-0000-0000-0000000000e6'::uuid,
  '{"nom_evenement": "Gala R22c"}'::jsonb, ARRAY['nom_evenement']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'c22c0000-0000-0000-0000-0000000000c6'::uuid
       AND event_type = 'collecte.modifiee'),
  0, 'R22c-7 modif champ non-TMS (nom_evenement) sur en_cours -> pas d''E2');

SELECT * FROM finish();
ROLLBACK;
