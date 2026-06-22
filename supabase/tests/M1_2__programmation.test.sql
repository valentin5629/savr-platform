-- =============================================================================
-- M1.2 — Tests pgTAP : Formulaire programmation collecte
-- =============================================================================
-- Priorités P1 (bloquants CI) testées ici.
-- Requiert : supabase db start + pgtap installé.
-- Exécution : pnpm test:pgtap ou via job CI pgtap-rls-outbox.
-- =============================================================================

BEGIN;
SELECT plan(16);

-- ─── Fixtures ────────────────────────────────────────────────────────────────

-- Organisation de test
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, actif)
VALUES ('00000000-0000-0000-0000-000000000010'::uuid, 'Traiteur Test M1.2', 'Traiteur Test M1.2', 'traiteur', true)
ON CONFLICT (id) DO NOTHING;

-- Entité de facturation vérifiée
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville, siret_verification)
VALUES (
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000010'::uuid,
  'Traiteur Test M1.2 SAS',
  '12345678901234',
  '1 Rue du Test',
  '75001',
  'Paris',
  'verifie'
)
ON CONFLICT (id) DO NOTHING;

-- Lieu
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif, controle_acces_requis_default)
VALUES (
  '00000000-0000-0000-0000-000000000012'::uuid,
  'Salle Test M1.2', 'Rue du Test 1', '75001', 'Paris', 'camionnette', true, false
)
ON CONFLICT (id) DO NOTHING;

-- Type événement
INSERT INTO plateforme.types_evenements (id, code, libelle, actif)
VALUES ('00000000-0000-0000-0000-000000000013'::uuid, 'cocktail_aperitif_m12', 'Cocktail apéritif (test M1.2)', true)
ON CONFLICT (id) DO NOTHING;

-- User de test
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000014'::uuid, 'test-m12@savr.io')
ON CONFLICT (id) DO NOTHING;
INSERT INTO plateforme.users (id, email, prenom, nom, organisation_id, role)
VALUES ('00000000-0000-0000-0000-000000000014'::uuid, 'test-m12@savr.io',
        'Test', 'M12',
        '00000000-0000-0000-0000-000000000010'::uuid, 'traiteur_commercial')
ON CONFLICT (id) DO NOTHING;

-- ─── Test 1 : fn_creer_collecte ZD émet E1 outbox ────────────────────────────

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  '00000000-0000-0000-0000-000000000020'::uuid,
  '00000000-0000-0000-0000-000000000010'::uuid,
  '00000000-0000-0000-0000-000000000010'::uuid,
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000012'::uuid,
  '00000000-0000-0000-0000-000000000014'::uuid,
  '00000000-0000-0000-0000-000000000013'::uuid,
  50, 'Contact Test', '0600000001'
);

SELECT plateforme.fn_creer_collecte(
  p_evenement_id := '00000000-0000-0000-0000-000000000020'::uuid,
  p_type := 'zd',
  p_date_collecte := CURRENT_DATE + 7,
  p_heure_collecte := '14:00'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM plateforme.outbox_events
    WHERE aggregate_id = (
      SELECT id FROM plateforme.collectes
      WHERE evenement_id = '00000000-0000-0000-0000-000000000020'::uuid
        AND type = 'zero_dechet'::plateforme.collecte_type
    )
      AND event_type = 'collecte.creee'
      AND consumer = 'adapter_mts1'
  ),
  'T1 : fn_creer_collecte ZD émet outbox E1'
);

-- ─── Test 2 : fn_creer_collecte AG n'émet PAS E1 ─────────────────────────────

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  '00000000-0000-0000-0000-000000000021'::uuid,
  '00000000-0000-0000-0000-000000000010'::uuid,
  '00000000-0000-0000-0000-000000000010'::uuid,
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000012'::uuid,
  '00000000-0000-0000-0000-000000000014'::uuid,
  '00000000-0000-0000-0000-000000000013'::uuid,
  40, 'Contact Test', '0600000002'
);

SELECT plateforme.fn_creer_collecte(
  p_evenement_id := '00000000-0000-0000-0000-000000000021'::uuid,
  p_type := 'ag',
  p_date_collecte := CURRENT_DATE + 7,
  p_heure_collecte := '15:00'
);

SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM plateforme.outbox_events
    WHERE aggregate_id = (
      SELECT id FROM plateforme.collectes
      WHERE evenement_id = '00000000-0000-0000-0000-000000000021'::uuid
        AND type = 'anti_gaspi'::plateforme.collecte_type
    )
      AND event_type = 'collecte.creee'
  ),
  'T2 : fn_creer_collecte AG n''émet PAS E1 outbox'
);

-- ─── Test 3 : statut_tms AG = non_envoye ─────────────────────────────────────

SELECT is(
  (SELECT statut_tms FROM plateforme.collectes
   WHERE evenement_id = '00000000-0000-0000-0000-000000000021'::uuid
     AND type = 'anti_gaspi'::plateforme.collecte_type),
  'non_envoye'::plateforme.collecte_statut_tms,
  'T3 : collecte AG créée avec statut_tms=non_envoye'
);

-- ─── Test 4 : volume_estime_repas AG = round(0.1 × pax) ─────────────────────

SELECT is(
  (SELECT volume_estime_repas FROM plateforme.collectes
   WHERE evenement_id = '00000000-0000-0000-0000-000000000021'::uuid
     AND type = 'anti_gaspi'::plateforme.collecte_type),
  4,  -- round(0.1 × 40) = 4
  'T4 : volume_estime_repas AG = round(0.1 × pax)'
);

-- ─── Test 5 : date_evenement dérivée = MIN(date_collecte) ────────────────────

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  '00000000-0000-0000-0000-000000000022'::uuid,
  '00000000-0000-0000-0000-000000000010'::uuid,
  '00000000-0000-0000-0000-000000000010'::uuid,
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000012'::uuid,
  '00000000-0000-0000-0000-000000000014'::uuid,
  '00000000-0000-0000-0000-000000000013'::uuid,
  30, 'Contact Test', '0600000003'
);

SELECT plateforme.fn_creer_collecte(
  p_evenement_id := '00000000-0000-0000-0000-000000000022'::uuid,
  p_type := 'zd',
  p_date_collecte := CURRENT_DATE + 10,
  p_heure_collecte := '08:00'
);

SELECT plateforme.fn_creer_collecte(
  p_evenement_id := '00000000-0000-0000-0000-000000000022'::uuid,
  p_type := 'ag',
  p_date_collecte := CURRENT_DATE + 5,
  p_heure_collecte := '10:00'
);

SELECT is(
  (SELECT date_evenement FROM plateforme.evenements
   WHERE id = '00000000-0000-0000-0000-000000000022'::uuid),
  CURRENT_DATE + 5,
  'T5 : date_evenement = MIN(date_collecte) via trigger'
);

-- ─── Test 6 : brouillon INSERT direct sans outbox ────────────────────────────

WITH evt AS (
  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id,
    entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
    contact_principal_nom, contact_principal_telephone
  ) VALUES (
    '00000000-0000-0000-0000-000000000023'::uuid,
    '00000000-0000-0000-0000-000000000010'::uuid,
    '00000000-0000-0000-0000-000000000010'::uuid,
    '00000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000012'::uuid,
    '00000000-0000-0000-0000-000000000014'::uuid,
    '00000000-0000-0000-0000-000000000013'::uuid,
    20, 'Contact Test', '0600000004'
  ) RETURNING id
),
col AS (
  INSERT INTO plateforme.collectes (
    evenement_id, type, date_collecte, heure_collecte, statut, statut_tms, nb_camions_demande
  ) VALUES (
    (SELECT id FROM evt), 'zero_dechet'::plateforme.collecte_type, CURRENT_DATE + 3, '09:00', 'brouillon', 'non_envoye', 1
  ) RETURNING id
)
SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM plateforme.outbox_events
    WHERE aggregate_id = (SELECT id FROM col)
  ),
  'T6 : collecte brouillon (INSERT direct) n''émet pas d''outbox'
);

-- ─── Test 7 : fn_confirmer_programmation_brouillon ZD émet E1 ────────────────

SELECT plateforme.fn_confirmer_programmation_brouillon(
  '00000000-0000-0000-0000-000000000023'::uuid
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM plateforme.outbox_events oe
    JOIN plateforme.collectes c ON c.id = oe.aggregate_id
    WHERE c.evenement_id = '00000000-0000-0000-0000-000000000023'::uuid
      AND oe.event_type = 'collecte.creee'
  ),
  'T7 : fn_confirmer_programmation_brouillon émet E1 pour ZD'
);

-- ─── Test 8 : après confirmation, statut collecte = programmee ───────────────

SELECT is(
  (SELECT statut FROM plateforme.collectes
   WHERE evenement_id = '00000000-0000-0000-0000-000000000023'::uuid),
  'programmee'::plateforme.collecte_statut,
  'T8 : fn_confirmer_programmation_brouillon → statut=programmee'
);

-- ─── Test 9 : cascade contrôle accès upgrade-only ────────────────────────────

-- Lieu avec controle_acces_requis_default=false → UPDATE à true
UPDATE plateforme.lieux
SET controle_acces_requis_default = false
WHERE id = '00000000-0000-0000-0000-000000000012'::uuid;

-- Simulation de l'update API (upgrade-only)
UPDATE plateforme.lieux
SET controle_acces_requis_default = true
WHERE id = '00000000-0000-0000-0000-000000000012'::uuid
  AND controle_acces_requis_default = false;

SELECT is(
  (SELECT controle_acces_requis_default FROM plateforme.lieux
   WHERE id = '00000000-0000-0000-0000-000000000012'::uuid),
  true,
  'T9 : controle_acces_requis_default upgradé à true'
);

-- Vérification downgrade bloqué (UPDATE WHERE false ne modifie pas)
UPDATE plateforme.lieux
SET controle_acces_requis_default = false
WHERE id = '00000000-0000-0000-0000-000000000012'::uuid
  AND controle_acces_requis_default = false; -- condition toujours false

SELECT is(
  (SELECT controle_acces_requis_default FROM plateforme.lieux
   WHERE id = '00000000-0000-0000-0000-000000000012'::uuid),
  true,
  'T9b : downgrade controle_acces_requis_default bloqué (upgrade-only)'
);

-- ─── Test 10 : f_collecte_editable retourne false sur terminal ───────────────

WITH evt AS (
  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id,
    entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
    contact_principal_nom, contact_principal_telephone
  ) VALUES (
    '00000000-0000-0000-0000-000000000024'::uuid,
    '00000000-0000-0000-0000-000000000010'::uuid,
    '00000000-0000-0000-0000-000000000010'::uuid,
    '00000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000012'::uuid,
    '00000000-0000-0000-0000-000000000014'::uuid,
    '00000000-0000-0000-0000-000000000013'::uuid,
    25, 'Contact Test', '0600000005'
  ) RETURNING id
),
col AS (
  INSERT INTO plateforme.collectes (
    evenement_id, type, date_collecte, heure_collecte, statut, statut_tms, nb_camions_demande
  ) VALUES (
    (SELECT id FROM evt), 'zero_dechet'::plateforme.collecte_type, CURRENT_DATE - 1, '08:00', 'cloturee', 'non_envoye', 1
  ) RETURNING evenement_id
)
SELECT is(
  plateforme.f_collecte_editable((SELECT evenement_id FROM col)),
  false,
  'T10 : f_collecte_editable=false si toutes collectes terminales'
);

-- ─── Test 11 : lieu hors référentiel créé avec actif=false ───────────────────

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif)
VALUES ('00000000-0000-0000-0000-000000000025'::uuid, 'Lieu hors ref', 'Rue inconnue 99', '69001', 'Lyon', 'camionnette', false);

SELECT is(
  (SELECT actif FROM plateforme.lieux WHERE id = '00000000-0000-0000-0000-000000000025'::uuid),
  false,
  'T11 : lieu hors référentiel créé avec actif=false'
);

-- ─── Test 12 : client_organisateur ne peut pas insérer d'événement ───────────

SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"user_role":"client_organisateur","organisation_id":"00000000-0000-0000-0000-000000000010"}';

SELECT throws_ok(
  $$INSERT INTO plateforme.evenements (
      organisation_id, traiteur_operationnel_organisation_id,
      entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
      contact_principal_nom, contact_principal_telephone
    ) VALUES (
      '00000000-0000-0000-0000-000000000010'::uuid,
      '00000000-0000-0000-0000-000000000010'::uuid,
      '00000000-0000-0000-0000-000000000011'::uuid,
      '00000000-0000-0000-0000-000000000012'::uuid,
      '00000000-0000-0000-0000-000000000014'::uuid,
      '00000000-0000-0000-0000-000000000013'::uuid,
      10, 'Contact', '0600000099'
    )$$,
  '42501',
  NULL,
  'T12 : client_organisateur ne peut pas insérer d''événement (RLS DENY)'
);

RESET role;
RESET "request.jwt.claims";

-- ─── Test 13 : gestionnaire_lieux ne peut pas lire un lieu hors périmètre ───

-- Lieu appartenant à une autre organisation (hors organisations_lieux)
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif)
VALUES ('00000000-0000-0000-0000-000000000030'::uuid, 'Lieu Hors Périmètre', 'Rue Inconnue 1', '75002', 'Paris', 'poids_lourd', true)
ON CONFLICT (id) DO NOTHING;

-- Organisation gestionnaire distincte
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, actif)
VALUES ('00000000-0000-0000-0000-000000000031'::uuid, 'Gestionnaire Org Test', 'Gestionnaire Org Test', 'gestionnaire_lieux', true)
ON CONFLICT (id) DO NOTHING;

-- Pas d'entrée dans organisations_lieux pour ce lieu + org gestionnaire

SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"user_role":"gestionnaire_lieux","organisation_id":"00000000-0000-0000-0000-000000000031"}';

SELECT is(
  (SELECT count(*)::int FROM plateforme.lieux
   WHERE id = '00000000-0000-0000-0000-000000000030'::uuid),
  0,
  'T13 : gestionnaire_lieux ne voit pas un lieu hors organisations_lieux (RLS)'
);

RESET role;
RESET "request.jwt.claims";

-- ─── Test 14 : isolation cross-org — traiteur org B ne voit pas les événements de org A ─

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, actif)
VALUES ('00000000-0000-0000-0000-000000000040'::uuid, 'Org B Test M1.2', 'Org B Test M1.2', 'traiteur', true)
ON CONFLICT (id) DO NOTHING;

SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"user_role":"traiteur_commercial","organisation_id":"00000000-0000-0000-0000-000000000040"}';

SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements
   WHERE organisation_id = '00000000-0000-0000-0000-000000000010'::uuid),
  0,
  'T14 : traiteur_commercial org B ne voit pas les événements de org A (cross-org RLS)'
);

RESET role;
RESET "request.jwt.claims";

-- ─── Test 15 : gestionnaire_lieux ne peut pas INSERT event sur lieu hors périmètre ──────

-- org '..31' (Gestionnaire Org Test, créée en T13) n'a aucune entrée organisations_lieux
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"user_role":"gestionnaire_lieux","organisation_id":"00000000-0000-0000-0000-000000000031"}';

SELECT throws_ok(
  $$INSERT INTO plateforme.evenements (
      organisation_id, traiteur_operationnel_organisation_id,
      entite_facturation_id, lieu_id, created_by, type_evenement_id, pax,
      contact_principal_nom, contact_principal_telephone
    ) VALUES (
      '00000000-0000-0000-0000-000000000031'::uuid,
      '00000000-0000-0000-0000-000000000010'::uuid,
      '00000000-0000-0000-0000-000000000011'::uuid,
      '00000000-0000-0000-0000-000000000012'::uuid,
      '00000000-0000-0000-0000-000000000014'::uuid,
      '00000000-0000-0000-0000-000000000013'::uuid,
      15, 'Contact Gest', '0600000097'
    )$$,
  '42501',
  NULL,
  'T15 : gestionnaire_lieux ne peut pas INSERT événement sur lieu hors périmètre (RLS DB)'
);

RESET role;
RESET "request.jwt.claims";

SELECT * FROM finish();
ROLLBACK;
