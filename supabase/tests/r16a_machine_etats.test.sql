-- =============================================================================
-- R16a — Machine à états collecte (BL-P1-RM-01/02/05/07/09)
-- =============================================================================
-- RM-01 : fn_cloturer_collectes_embargo — realisee + realisee_at ≥ H+24 → cloturee ;
--         realisee < H+24 → reste realisee ; realisee_sans_collecte → jamais clôturé.
-- RM-02 : fn_modifier_collecte — nb_camions_demande interdit hors (programmee/validee/en_cours).
-- RM-05 : fn_modifier_collecte — réduction de N bloquée < 1h avant mission ; augmentation OK ;
--         réduction OK si mission lointaine.
-- RM-07 : fn_agreger_terminal_collecte — tous tours KO → rejetee + alerte Admin.
-- RM-09 : fn_trg_pack_debit_annulation_tardive — pas de débit si incident ≠ client ; débit si client.
-- Exécution : supabase test db (job CI pgtap-rls-outbox) — applique migrations + seeds.
-- =============================================================================

BEGIN;
SELECT plan(14);

-- ─── Fixtures de base (org / user / entité / type évt / lieu / presta / évt) ──
INSERT INTO plateforme.organisations (id, nom, type, actif, siret, email_principal)
VALUES ('e16a0001-0000-0000-0000-000000000001'::uuid, 'Org R16a', 'traiteur', true, '90000000160001', 'r16a@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.organisations (id, nom, type, actif, siret, email_principal)
VALUES ('e16a0001-0000-0000-0000-000000000002'::uuid, 'Org R16a bis', 'traiteur', true, '90000000160002', 'r16a2@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('e16a0002-0000-0000-0000-000000000001'::uuid, 'e16a0001-0000-0000-0000-000000000001'::uuid,
        'r16a@user.test', 'R', '16', 'traiteur_manager')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('e16a0003-0000-0000-0000-000000000001'::uuid, 'e16a0001-0000-0000-0000-000000000001'::uuid,
        'Org R16a SAS', '90000000160001', '1 rue R16a', '75001', 'Paris')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('e16a0004-0000-0000-0000-000000000001'::uuid, 'r16a', 'Test R16a')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('e16a0005-0000-0000-0000-000000000001'::uuid, 'Lieu R16a', '1 rue', '75001', 'Paris', 'fourgon')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shared.prestataires (id, nom, code)
VALUES ('e16a0007-0000-0000-0000-000000000001'::uuid, 'Presta R16a', 'presta-r16a')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES ('e16a0006-0000-0000-0000-000000000001'::uuid, 'e16a0001-0000-0000-0000-000000000001'::uuid,
        'e16a0005-0000-0000-0000-000000000001'::uuid, 'e16a0001-0000-0000-0000-000000000001'::uuid,
        'e16a0003-0000-0000-0000-000000000001'::uuid, 'e16a0002-0000-0000-0000-000000000001'::uuid,
        'e16a0004-0000-0000-0000-000000000001'::uuid, current_date + 10, 200, 'Contact R16a', '0600000000')
ON CONFLICT (id) DO NOTHING;

-- Événement pour l'org bis (RM-09 cas client)
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES ('e16a0006-0000-0000-0000-000000000002'::uuid, 'e16a0001-0000-0000-0000-000000000002'::uuid,
        'e16a0005-0000-0000-0000-000000000001'::uuid, 'e16a0001-0000-0000-0000-000000000002'::uuid,
        'e16a0003-0000-0000-0000-000000000001'::uuid, 'e16a0002-0000-0000-0000-000000000001'::uuid,
        'e16a0004-0000-0000-0000-000000000001'::uuid, current_date + 10, 200, 'Contact R16a bis', '0600000000')
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- RM-01 — Clôture embargo H+24
-- =====================================================================
-- C1 : realisee, realisee_at = now()-25h → doit être clôturée.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande, realisee_at)
VALUES ('e16a0c01-0000-0000-0000-000000000001'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'anti_gaspi', 'realisee', 'en_attente_execution', current_date - 2, '08:00', 1, now() - interval '25 hours');
-- C2 : realisee, realisee_at = now()-1h → embargo non expiré, reste realisee.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande, realisee_at)
VALUES ('e16a0c01-0000-0000-0000-000000000002'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'anti_gaspi', 'realisee', 'en_attente_execution', current_date, '08:00', 1, now() - interval '1 hour');
-- C3 : realisee_sans_collecte ancienne → JAMAIS clôturée (état terminal distinct).
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande, realisee_at)
VALUES ('e16a0c01-0000-0000-0000-000000000003'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'anti_gaspi', 'realisee_sans_collecte', 'en_attente_execution', current_date - 3, '08:00', 1, now() - interval '48 hours');

SELECT ok(
  plateforme.fn_cloturer_collectes_embargo() >= 1,
  'RM-01 : fn_cloturer_collectes_embargo clôture au moins 1 collecte éligible'
);
SELECT is(
  (SELECT statut::text FROM plateforme.collectes WHERE id = 'e16a0c01-0000-0000-0000-000000000001'::uuid),
  'cloturee',
  'RM-01 : realisee + realisee_at ≥ H+24 → cloturee'
);
SELECT is(
  (SELECT statut::text FROM plateforme.collectes WHERE id = 'e16a0c01-0000-0000-0000-000000000002'::uuid),
  'realisee',
  'RM-01 : realisee + realisee_at < H+24 → reste realisee (embargo)'
);
SELECT is(
  (SELECT statut::text FROM plateforme.collectes WHERE id = 'e16a0c01-0000-0000-0000-000000000003'::uuid),
  'realisee_sans_collecte',
  'RM-01 : realisee_sans_collecte → jamais clôturé (exclu du cron)'
);

-- =====================================================================
-- RM-02 — nb_camions_demande interdit sur statut terminal
-- =====================================================================
-- Collecte realisee : modif N interdite.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande, realisee_at)
VALUES ('e16a0c02-0000-0000-0000-000000000001'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'realisee', 'en_attente_execution', current_date - 1, '08:00', 2, now() - interval '2 hours');
-- Collecte programmee : modif N autorisée.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('e16a0c02-0000-0000-0000-000000000002'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00', 2);

SELECT throws_like(
  $$ SELECT plateforme.fn_modifier_collecte('e16a0c02-0000-0000-0000-000000000001'::uuid, '{"nb_camions_demande": 5}'::jsonb, ARRAY['nb_camions_demande']) $$,
  '%NB_CAMIONS_STATUT_TERMINAL%',
  'RM-02 : modif nb_camions_demande sur realisee → exception (jamais de régression terminale)'
);
SELECT lives_ok(
  $$ SELECT plateforme.fn_modifier_collecte('e16a0c02-0000-0000-0000-000000000002'::uuid, '{"nb_camions_demande": 3}'::jsonb, ARRAY['nb_camions_demande']) $$,
  'RM-02 : modif nb_camions_demande sur programmee → autorisée'
);

-- =====================================================================
-- RM-05 — réduction de N bloquée < 1h avant mission
-- =====================================================================
-- Mission passée (date_collecte hier) + statut programmee : réduction bloquée.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('e16a0c03-0000-0000-0000-000000000001'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'programmee', 'non_envoye', current_date - 1, '08:00', 3);
-- Mission lointaine (J+10) : réduction autorisée.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('e16a0c03-0000-0000-0000-000000000002'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00', 3);
-- Mission passée : augmentation autorisée (capacité last-minute).
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('e16a0c03-0000-0000-0000-000000000003'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'programmee', 'non_envoye', current_date - 1, '08:00', 1);

SELECT throws_like(
  $$ SELECT plateforme.fn_modifier_collecte('e16a0c03-0000-0000-0000-000000000001'::uuid, '{"nb_camions_demande": 1}'::jsonb, ARRAY['nb_camions_demande']) $$,
  '%REDUCTION_CANCEL_WINDOW_CLOSED%',
  'RM-05 : réduction de N < 1h avant mission → exception'
);
SELECT lives_ok(
  $$ SELECT plateforme.fn_modifier_collecte('e16a0c03-0000-0000-0000-000000000002'::uuid, '{"nb_camions_demande": 1}'::jsonb, ARRAY['nb_camions_demande']) $$,
  'RM-05 : réduction de N sur mission lointaine → autorisée'
);
SELECT lives_ok(
  $$ SELECT plateforme.fn_modifier_collecte('e16a0c03-0000-0000-0000-000000000003'::uuid, '{"nb_camions_demande": 3}'::jsonb, ARRAY['nb_camions_demande']) $$,
  'RM-05 : augmentation de N < 1h avant mission → autorisée (capacité)'
);
SELECT throws_like(
  $$ SELECT plateforme.fn_modifier_collecte('e16a0c03-0000-0000-0000-000000000002'::uuid, '{"nb_camions_demande": 0}'::jsonb, ARRAY['nb_camions_demande']) $$,
  '%NB_CAMIONS_INVALIDE%',
  'RM-05 : nb_camions_demande = 0 → exception (garde de domaine >= 1)'
);

-- =====================================================================
-- RM-07 — tous tours KO → rejetee + alerte Admin
-- =====================================================================
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('e16a0c04-0000-0000-0000-000000000001'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'en_cours', 'en_attente_execution', current_date, '08:00', 2);

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, chauffeur_nom, statut)
VALUES
  ('e16a0d04-0000-0000-0000-000000000001'::uuid, 'T-R16a-1', current_date, 'matin', 'e16a0007-0000-0000-0000-000000000001'::uuid, 'Ch1', 'annulee'),
  ('e16a0d04-0000-0000-0000-000000000002'::uuid, 'T-R16a-2', current_date, 'matin', 'e16a0007-0000-0000-0000-000000000001'::uuid, 'Ch2', 'annulee');

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang)
VALUES
  ('e16a0c04-0000-0000-0000-000000000001'::uuid, 'e16a0d04-0000-0000-0000-000000000001'::uuid, 1),
  ('e16a0c04-0000-0000-0000-000000000001'::uuid, 'e16a0d04-0000-0000-0000-000000000002'::uuid, 2);

SELECT is(
  plateforme.fn_agreger_terminal_collecte('e16a0c04-0000-0000-0000-000000000001'::uuid),
  'rejetee_par_prestataire',
  'RM-07 : tous tours annulés (CANCELED/KO) → rejetee_par_prestataire'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM plateforme.alertes_admin
    WHERE code = 'collecte_rejetee_par_prestataire'
      AND entity_id = 'e16a0c04-0000-0000-0000-000000000001'::uuid
      AND statut = 'ouverte'
  ),
  'RM-07 : alerte Admin « collecte_rejetee_par_prestataire » créée (réattribution requise)'
);

-- =====================================================================
-- RM-09 — garde incident sur le débit de crédit pack AG
-- =====================================================================
-- Pack actif org1 (cas incident prestataire → PAS de débit).
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, statut, date_achat)
VALUES ('e16a0f01-0000-0000-0000-000000000001'::uuid, 'e16a0001-0000-0000-0000-000000000001'::uuid,
        'pack_10', 10, 0, 'actif', current_date);
-- Pack actif org2 (cas incident client → débit).
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, statut, date_achat)
VALUES ('e16a0f01-0000-0000-0000-000000000002'::uuid, 'e16a0001-0000-0000-0000-000000000002'::uuid,
        'pack_10', 10, 0, 'actif', current_date);

-- Collecte AG mandatée, mission passée (< 12h), pack attaché — cas incident prestataire.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande, pack_antgaspi_id)
VALUES ('e16a0c05-0000-0000-0000-000000000001'::uuid, 'e16a0006-0000-0000-0000-000000000001'::uuid,
        'anti_gaspi', 'validee', 'acceptee', current_date, '00:00', 1, 'e16a0f01-0000-0000-0000-000000000001'::uuid);
-- Collecte AG mandatée, mission passée (< 12h), pack attaché — cas incident client.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande, pack_antgaspi_id)
VALUES ('e16a0c05-0000-0000-0000-000000000002'::uuid, 'e16a0006-0000-0000-0000-000000000002'::uuid,
        'anti_gaspi', 'validee', 'acceptee', current_date, '00:00', 1, 'e16a0f01-0000-0000-0000-000000000002'::uuid);

-- Incident prestataire → annulee + incident_imputable_a='prestataire' : PAS de débit.
UPDATE plateforme.collectes
SET statut = 'annulee', incident_imputable_a = 'prestataire', motif_incident = 'Prestataire non présenté'
WHERE id = 'e16a0c05-0000-0000-0000-000000000001'::uuid;

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e16a0f01-0000-0000-0000-000000000001'::uuid),
  0,
  'RM-09 : incident imputable prestataire → aucun débit de crédit pack (collecte manquée non facturable)'
);

-- Annulation tardive imputable client → débit normal.
UPDATE plateforme.collectes
SET statut = 'annulee', incident_imputable_a = 'client', motif_incident = 'Annulation last minute client'
WHERE id = 'e16a0c05-0000-0000-0000-000000000002'::uuid;

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'e16a0f01-0000-0000-0000-000000000002'::uuid),
  1,
  'RM-09 : annulation tardive imputable client → débit d''un crédit pack'
);

SELECT * FROM finish();
ROLLBACK;
