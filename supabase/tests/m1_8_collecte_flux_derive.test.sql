-- =============================================================================
-- M1.8 / R1 — Dérivation collecte_flux depuis pesees_tournees
-- (BL-P0-01 recalcul UPSERT + BL-P1-RM-06 somme des seuls tours non-KO)
-- =============================================================================
-- Vérifie fn_agreger_terminal_collecte (migration 20260624130000) :
--   S1 — 3 tournées OK pesées → collecte_flux = SUM(pesees_tournees) GROUP BY flux
--   S2 — 2 tours OK + 1 KO → realisee sur la somme des 2 OK (pesée du KO exclue)
--   S3 — collecte cloturee → AUCUN écrasement de collecte_flux (§04 + §08 3bis.7)
-- Requiert : supabase db start + pgtap. Exécution : pnpm test:pgtap ou job CI.
-- =============================================================================

BEGIN;
SELECT plan(10);

-- ─── Référentiel flux (normalement seedé — guard idempotent) ─────────────────
INSERT INTO plateforme.flux_dechets (code, nom, unite_mesure, filiere_valorisation, ordre_affichage, actif)
VALUES
  ('biodechet', 'Biodéchets', 'kg', 'compostage', 1, true),
  ('carton',    'Cartons',    'kg', 'recyclage',  3, true),
  ('verre',     'Verre',      'kg', 'recyclage',  4, true)
ON CONFLICT (code) DO NOTHING;

-- ─── Fixtures de base (org / user / entité / type évt / lieu / presta / évt) ──
INSERT INTO plateforme.organisations (id, nom, type, actif, siret, email_principal)
VALUES ('caf10001-0000-0000-0000-000000000001'::uuid, 'Org R1', 'traiteur', true, '90000000100001', 'r1@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('caf10002-0000-0000-0000-000000000001'::uuid, 'caf10001-0000-0000-0000-000000000001'::uuid,
        'r1@user.test', 'R', '1', 'traiteur_manager')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('caf10003-0000-0000-0000-000000000001'::uuid, 'caf10001-0000-0000-0000-000000000001'::uuid,
        'Org R1 SAS', '90000000100001', '1 rue R1', '75001', 'Paris')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('caf10004-0000-0000-0000-000000000001'::uuid, 'r1', 'Test R1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('caf10005-0000-0000-0000-000000000001'::uuid, 'Lieu R1', '1 rue', '75001', 'Paris', 'fourgon')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shared.prestataires (id, nom, code)
VALUES ('caf10007-0000-0000-0000-000000000001'::uuid, 'Presta R1', 'presta-r1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES ('caf10006-0000-0000-0000-000000000001'::uuid, 'caf10001-0000-0000-0000-000000000001'::uuid,
        'caf10005-0000-0000-0000-000000000001'::uuid, 'caf10001-0000-0000-0000-000000000001'::uuid,
        'caf10003-0000-0000-0000-000000000001'::uuid, 'caf10002-0000-0000-0000-000000000001'::uuid,
        'caf10004-0000-0000-0000-000000000001'::uuid, current_date + 10, 200, 'Contact R1', '0600000000')
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- S1 — 3 tournées OK pesées → collecte_flux = somme par flux
-- =====================================================================
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('caf1c001-0000-0000-0000-000000000001'::uuid, 'caf10006-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'en_cours', 'en_attente_execution', current_date + 10, '08:00', 3);

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, chauffeur_nom, statut)
VALUES
  ('caf1d001-0000-0000-0000-000000000001'::uuid, 'T-R1-1', current_date + 10, 'matin', 'caf10007-0000-0000-0000-000000000001'::uuid, 'Ch1', 'terminee'),
  ('caf1d002-0000-0000-0000-000000000001'::uuid, 'T-R1-2', current_date + 10, 'matin', 'caf10007-0000-0000-0000-000000000001'::uuid, 'Ch2', 'terminee'),
  ('caf1d003-0000-0000-0000-000000000001'::uuid, 'T-R1-3', current_date + 10, 'matin', 'caf10007-0000-0000-0000-000000000001'::uuid, 'Ch3', 'terminee');

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang)
VALUES
  ('caf1c001-0000-0000-0000-000000000001'::uuid, 'caf1d001-0000-0000-0000-000000000001'::uuid, 1),
  ('caf1c001-0000-0000-0000-000000000001'::uuid, 'caf1d002-0000-0000-0000-000000000001'::uuid, 2),
  ('caf1c001-0000-0000-0000-000000000001'::uuid, 'caf1d003-0000-0000-0000-000000000001'::uuid, 3);

-- Pesées : biodechet = 100 (T1) + 30 (T2) = 130 ; carton = 50 (T1) + 20 (T3) = 70 ; verre = 10 (T3)
INSERT INTO plateforme.pesees_tournees (tournee_id, stop_id, flux_id, poids_kg)
VALUES
  ('caf1d001-0000-0000-0000-000000000001'::uuid, 's1', (SELECT id FROM plateforme.flux_dechets WHERE code='biodechet'), 100),
  ('caf1d001-0000-0000-0000-000000000001'::uuid, 's1', (SELECT id FROM plateforme.flux_dechets WHERE code='carton'),    50),
  ('caf1d002-0000-0000-0000-000000000001'::uuid, 's2', (SELECT id FROM plateforme.flux_dechets WHERE code='biodechet'),  30),
  ('caf1d003-0000-0000-0000-000000000001'::uuid, 's3', (SELECT id FROM plateforme.flux_dechets WHERE code='carton'),     20),
  ('caf1d003-0000-0000-0000-000000000001'::uuid, 's3', (SELECT id FROM plateforme.flux_dechets WHERE code='verre'),      10);

SELECT is(
  plateforme.fn_agreger_terminal_collecte('caf1c001-0000-0000-0000-000000000001'::uuid),
  'realisee',
  'S1 : 3 tours terminaux → fn_agreger renvoie realisee'
);

SELECT is(
  (SELECT statut::text FROM plateforme.collectes WHERE id = 'caf1c001-0000-0000-0000-000000000001'::uuid),
  'realisee',
  'S1 : collecte passe realisee'
);

SELECT is(
  (SELECT poids_reel_kg FROM plateforme.collecte_flux cf JOIN plateforme.flux_dechets f ON f.id = cf.flux_id
   WHERE cf.collecte_id = 'caf1c001-0000-0000-0000-000000000001'::uuid AND f.code = 'biodechet'),
  130::numeric,
  'S1 : collecte_flux biodechet = 100 + 30 = 130 (somme par flux)'
);

SELECT is(
  (SELECT poids_reel_kg FROM plateforme.collecte_flux cf JOIN plateforme.flux_dechets f ON f.id = cf.flux_id
   WHERE cf.collecte_id = 'caf1c001-0000-0000-0000-000000000001'::uuid AND f.code = 'carton'),
  70::numeric,
  'S1 : collecte_flux carton = 50 + 20 = 70'
);

SELECT is(
  (SELECT poids_reel_kg FROM plateforme.collecte_flux cf JOIN plateforme.flux_dechets f ON f.id = cf.flux_id
   WHERE cf.collecte_id = 'caf1c001-0000-0000-0000-000000000001'::uuid AND f.code = 'verre'),
  10::numeric,
  'S1 : collecte_flux verre = 10'
);

-- Idempotence : re-appel → mêmes valeurs (pas de doublement)
SELECT plateforme.fn_agreger_terminal_collecte('caf1c001-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT poids_reel_kg FROM plateforme.collecte_flux cf JOIN plateforme.flux_dechets f ON f.id = cf.flux_id
   WHERE cf.collecte_id = 'caf1c001-0000-0000-0000-000000000001'::uuid AND f.code = 'biodechet'),
  130::numeric,
  'S1 : re-appel idempotent → biodechet reste 130 (UPSERT, pas incrément)'
);

-- =====================================================================
-- S2 — 2 tours OK + 1 KO → realisee sur la somme des 2 OK (pesée du KO exclue)
-- =====================================================================
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('caf1c002-0000-0000-0000-000000000001'::uuid, 'caf10006-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'en_cours', 'en_attente_execution', current_date + 10, '08:00', 3);

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, chauffeur_nom, statut)
VALUES
  ('caf1d004-0000-0000-0000-000000000001'::uuid, 'T-R1-4', current_date + 10, 'matin', 'caf10007-0000-0000-0000-000000000001'::uuid, 'Ch4', 'terminee'),
  ('caf1d005-0000-0000-0000-000000000001'::uuid, 'T-R1-5', current_date + 10, 'matin', 'caf10007-0000-0000-0000-000000000001'::uuid, 'Ch5', 'terminee'),
  ('caf1d006-0000-0000-0000-000000000001'::uuid, 'T-R1-6', current_date + 10, 'matin', 'caf10007-0000-0000-0000-000000000001'::uuid, 'Ch6', 'annulee');

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang)
VALUES
  ('caf1c002-0000-0000-0000-000000000001'::uuid, 'caf1d004-0000-0000-0000-000000000001'::uuid, 1),
  ('caf1c002-0000-0000-0000-000000000001'::uuid, 'caf1d005-0000-0000-0000-000000000001'::uuid, 2),
  ('caf1c002-0000-0000-0000-000000000001'::uuid, 'caf1d006-0000-0000-0000-000000000001'::uuid, 3);

-- biodechet : 100 (T4 OK) + 50 (T5 OK) = 150 ; le tour KO (T6) porte 999 → DOIT être exclu.
INSERT INTO plateforme.pesees_tournees (tournee_id, stop_id, flux_id, poids_kg)
VALUES
  ('caf1d004-0000-0000-0000-000000000001'::uuid, 's4', (SELECT id FROM plateforme.flux_dechets WHERE code='biodechet'), 100),
  ('caf1d005-0000-0000-0000-000000000001'::uuid, 's5', (SELECT id FROM plateforme.flux_dechets WHERE code='biodechet'),  50),
  ('caf1d006-0000-0000-0000-000000000001'::uuid, 's6', (SELECT id FROM plateforme.flux_dechets WHERE code='biodechet'), 999);

SELECT is(
  plateforme.fn_agreger_terminal_collecte('caf1c002-0000-0000-0000-000000000001'::uuid),
  'realisee',
  'S2 : ≥1 tour OK (2 OK + 1 KO) → realisee'
);

SELECT is(
  (SELECT poids_reel_kg FROM plateforme.collecte_flux cf JOIN plateforme.flux_dechets f ON f.id = cf.flux_id
   WHERE cf.collecte_id = 'caf1c002-0000-0000-0000-000000000001'::uuid AND f.code = 'biodechet'),
  150::numeric,
  'S2 : collecte_flux biodechet = 100 + 50 = 150 (pesée 999 du tour KO exclue — BL-P1-RM-06)'
);

-- =====================================================================
-- S3 — collecte cloturee → aucun écrasement de collecte_flux
-- =====================================================================
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('caf1c003-0000-0000-0000-000000000001'::uuid, 'caf10006-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'cloturee', 'en_attente_execution', current_date - 2, '08:00', 1);

-- Valeur figée pré-existante (issue d'une clôture antérieure)
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
VALUES ('caf1c003-0000-0000-0000-000000000001'::uuid, (SELECT id FROM plateforme.flux_dechets WHERE code='biodechet'), 42);

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, chauffeur_nom, statut)
VALUES ('caf1d007-0000-0000-0000-000000000001'::uuid, 'T-R1-7', current_date - 2, 'matin', 'caf10007-0000-0000-0000-000000000001'::uuid, 'Ch7', 'terminee');

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang)
VALUES ('caf1c003-0000-0000-0000-000000000001'::uuid, 'caf1d007-0000-0000-0000-000000000001'::uuid, 1);

-- Une pesée tardive distante (100) ne doit PAS écraser la valeur figée (42).
INSERT INTO plateforme.pesees_tournees (tournee_id, stop_id, flux_id, poids_kg)
VALUES ('caf1d007-0000-0000-0000-000000000001'::uuid, 's7', (SELECT id FROM plateforme.flux_dechets WHERE code='biodechet'), 100);

SELECT plateforme.fn_agreger_terminal_collecte('caf1c003-0000-0000-0000-000000000001'::uuid);

SELECT is(
  (SELECT poids_reel_kg FROM plateforme.collecte_flux cf JOIN plateforme.flux_dechets f ON f.id = cf.flux_id
   WHERE cf.collecte_id = 'caf1c003-0000-0000-0000-000000000001'::uuid AND f.code = 'biodechet'),
  42::numeric,
  'S3 : collecte cloturee → poids_reel_kg figé à 42 (aucun écrasement post-clôture)'
);

SELECT is(
  (SELECT statut::text FROM plateforme.collectes WHERE id = 'caf1c003-0000-0000-0000-000000000001'::uuid),
  'cloturee',
  'S3 : statut reste cloturee (garde de transition)'
);

SELECT * FROM finish();
ROLLBACK;
