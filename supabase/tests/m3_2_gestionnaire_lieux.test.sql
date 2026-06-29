-- pgTAP M3.2 — Espace client gestionnaire de lieux
-- 13 scénarios RLS P1-critique (bloquants CI) + scénarios P1 happy path
-- Catégorie 4 : isolation cross-org, whitelist colonnes, factures self, fichiers,
--               coefficient labo, champs admin lieux, brouillons tiers, benchmark,
--               organisations_lieux self.
-- Catégorie 1 : programmation sur lieu propre, invitation collègue.
-- Catégorie 2 : brackets, k-anonymat.
-- Catégorie 3 : programmation lieu hors périmètre.

BEGIN;
SELECT plan(37);

-- ── Helpers JWT ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
SELECT test_as_superuser();

-- Organisations : Viparis (gestionnaire_lieux) + GL Events (gestionnaire_lieux) + Kaspia (traiteur) + Externe (traiteur sans événement)
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd)
VALUES
  ('cc000000-0000-0000-0000-00000000000a'::uuid, 'Viparis',          'Viparis SA',          'gestionnaire_lieux', '33333333300001', true, 0),
  ('cc000000-0000-0000-0000-00000000000b'::uuid, 'GL Events',        'GL Events SAS',       'gestionnaire_lieux', '44444444400001', true, 0),
  ('cc000000-0000-0000-0000-00000000000c'::uuid, 'Kaspia',           'Kaspia SARL',         'traiteur',           '55555555500001', true, 1.50),
  -- T37 : traiteur sans aucun événement → doit être INVISIBLE à tout gestionnaire
  ('cc000000-0000-0000-0000-00000000000d'::uuid, 'Traiteur Externe', 'Externe SARL',        'traiteur',           '77777777700001', true, 0);

-- Users
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES
  ('cc000000-0000-0000-0000-000000000a01'::uuid, 'cc000000-0000-0000-0000-00000000000a'::uuid,
   'alice@viparis.test', 'Alice', 'V', 'gestionnaire_lieux', true),
  ('cc000000-0000-0000-0000-000000000b01'::uuid, 'cc000000-0000-0000-0000-00000000000b'::uuid,
   'bob@glevents.test',  'Bob',   'G', 'gestionnaire_lieux', true),
  ('cc000000-0000-0000-0000-000000000c01'::uuid, 'cc000000-0000-0000-0000-00000000000c'::uuid,
   'chef@kaspia.test',   'Chef',  'K', 'traiteur_manager',   true);

-- Entités facturation Kaspia (traiteur, nécessaire pour evenements)
INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES
  ('cc000000-0000-0000-0000-0000000000f1'::uuid,
   'cc000000-0000-0000-0000-00000000000c'::uuid,
   'Kaspia SARL', '55555555500001', '10 rue Chef', '75001', 'Paris'),
  ('cc000000-0000-0000-0000-0000000000f5'::uuid,
   'cc000000-0000-0000-0000-00000000000a'::uuid,
   'Viparis SA', '33333333300001', '15 pl Viparis', '75015', 'Paris');

-- Lieux (UUIDs hex valides uniquement — b01/b02/b03)
INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, commentaire_lieu, siren, email_gestionnaire, reference_citeo)
VALUES
  ('cc000000-0000-0000-0000-000000000b01'::uuid,
   'Palais des Congrès', '2 pl Porte Maillot', '75017', 'Paris', 'camionnette',
   'Accès difficile', '333333333', 'info@viparis.test', false),
  ('cc000000-0000-0000-0000-000000000b02'::uuid,
   'Paris Expo', '1 pl Porte Versailles', '75015', 'Paris', 'camionnette',
   'Quai 12', '333333333', NULL, true),
  ('cc000000-0000-0000-0000-000000000b03'::uuid,
   'GL Arena', '5 av GL', '69001', 'Lyon', 'fourgon',
   NULL, NULL, NULL, false);

-- Rattachements organisations_lieux
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES
  ('cc000000-0000-0000-0000-00000000000a'::uuid, 'cc000000-0000-0000-0000-000000000b01'::uuid),
  ('cc000000-0000-0000-0000-00000000000a'::uuid, 'cc000000-0000-0000-0000-000000000b02'::uuid),
  ('cc000000-0000-0000-0000-00000000000b'::uuid, 'cc000000-0000-0000-0000-000000000b03'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('cc000000-0000-0000-0000-000000000bee'::uuid, 'GALA_M32', 'Gala M3.2', 1, true);

-- Événements : E1 = programmé par Kaspia sur lieu Viparis (Palais Congrès), date_evenement renseignée
--              E2 = brouillon Kaspia sur lieu Viparis (date_evenement NULL — test F3)
--              E3 = brouillon Viparis sur son propre lieu (doit être visible)
--              E4 = événement GL Events (isolé)
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES
  -- E1 : collecte Kaspia sur lieu Viparis (visible gestionnaire Viparis)
  ('cc000000-0000-0000-0000-0000000000e1'::uuid,
   'cc000000-0000-0000-0000-00000000000c'::uuid,
   'cc000000-0000-0000-0000-00000000000c'::uuid,
   'cc000000-0000-0000-0000-0000000000f1'::uuid,
   'cc000000-0000-0000-0000-000000000c01'::uuid,
   'cc000000-0000-0000-0000-000000000b01'::uuid,
   'cc000000-0000-0000-0000-000000000bee'::uuid,
   'Salon Auto 2026', '2026-06-15', 500, 'Contact', '0600000001'),
  -- E2 : brouillon Kaspia sur lieu Viparis (F3 — doit être INVISIBLE à Viparis)
  ('cc000000-0000-0000-0000-0000000000e2'::uuid,
   'cc000000-0000-0000-0000-00000000000c'::uuid,
   'cc000000-0000-0000-0000-00000000000c'::uuid,
   'cc000000-0000-0000-0000-0000000000f1'::uuid,
   'cc000000-0000-0000-0000-000000000c01'::uuid,
   'cc000000-0000-0000-0000-000000000b01'::uuid,
   'cc000000-0000-0000-0000-000000000bee'::uuid,
   'Brouillon Kaspia', NULL, 300, 'Contact', '0600000002'),
  -- E3 : brouillon Viparis sur son propre lieu (doit être VISIBLE)
  ('cc000000-0000-0000-0000-0000000000e3'::uuid,
   'cc000000-0000-0000-0000-00000000000a'::uuid,
   'cc000000-0000-0000-0000-00000000000c'::uuid,
   'cc000000-0000-0000-0000-0000000000f5'::uuid,
   'cc000000-0000-0000-0000-000000000a01'::uuid,
   'cc000000-0000-0000-0000-000000000b02'::uuid,
   'cc000000-0000-0000-0000-000000000bee'::uuid,
   'Brouillon Viparis', NULL, 200, 'Contact', '0600000003'),
  -- E4 : événement GL Events (isolé — Viparis ne doit pas voir)
  ('cc000000-0000-0000-0000-0000000000e4'::uuid,
   'cc000000-0000-0000-0000-00000000000b'::uuid,
   'cc000000-0000-0000-0000-00000000000c'::uuid,
   'cc000000-0000-0000-0000-0000000000f1'::uuid,
   'cc000000-0000-0000-0000-000000000b01'::uuid,
   'cc000000-0000-0000-0000-000000000b03'::uuid,
   'cc000000-0000-0000-0000-000000000bee'::uuid,
   'GL Arena Event', '2026-06-20', 400, 'ContactG', '0600000004');

-- Collectes sur les lieux Viparis (E1)
INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte,
   notes_internes, dirty_tms, annulee_cote_savr)
VALUES
  ('cc000000-0000-0000-0000-0000000000c1'::uuid,
   'cc000000-0000-0000-0000-0000000000e1'::uuid,
   'zero_dechet', 'cloturee', 'non_envoye', '2026-06-15', '20:00',
   'Note interne admin', false, false),
  -- Collecte GL Events (hors périmètre Viparis)
  ('cc000000-0000-0000-0000-0000000000c4'::uuid,
   'cc000000-0000-0000-0000-0000000000e4'::uuid,
   'zero_dechet', 'cloturee', 'non_envoye', '2026-06-20', '19:00',
   NULL, false, false);

-- Factures : F1 = facture Viparis, F2 = facture Kaspia
INSERT INTO plateforme.factures
  (id, organisation_id, entite_facturation_id, type, statut, montant_ht, taux_tva, montant_tva, montant_ttc, devise, mode_facturation)
VALUES
  ('cc000000-0000-0000-0000-0000000000fa'::uuid,
   'cc000000-0000-0000-0000-00000000000a'::uuid,
   'cc000000-0000-0000-0000-0000000000f5'::uuid,
   'zero_dechet', 'emise', 100.00, 20, 20.00, 120.00, 'EUR', 'par_collecte'),
  ('cc000000-0000-0000-0000-0000000000fb'::uuid,
   'cc000000-0000-0000-0000-00000000000c'::uuid,
   'cc000000-0000-0000-0000-0000000000f1'::uuid,
   'zero_dechet', 'emise', 250.00, 20, 50.00, 300.00, 'EUR', 'par_collecte');

-- Coefficient labo Kaspia (saisi_par requis NOT NULL)
INSERT INTO plateforme.coefficients_perte_labo (id, organisation_id, annee_reference, coefficient_kg_couvert, saisi_par)
VALUES
  ('cc000000-0000-0000-0000-000000000c0b'::uuid,
   'cc000000-0000-0000-0000-00000000000c'::uuid,
   2025, 0.1500, 'cc000000-0000-0000-0000-000000000c01'::uuid);

-- Tarif pack AG
-- M2.1 aligne: credits, prix_unitaire_ht, type_pack sont NOT NULL
INSERT INTO plateforme.tarifs_packs_ag (id, valide_du, credits, prix_unitaire_ht, type_pack)
VALUES ('cc000000-0000-0000-0000-000000000f0a'::uuid, '2026-01-01', 10, 150.00, 'pack_10');

-- Pack AG Viparis
-- M2.1 aligne: credits_initiaux, type_pack sont NOT NULL
INSERT INTO plateforme.packs_antgaspi
  (id, organisation_id, credits_initiaux, type_pack, statut, date_achat)
VALUES
  ('cc000000-0000-0000-0000-000000000ba0'::uuid,
   'cc000000-0000-0000-0000-00000000000a'::uuid,
   10, 'pack_10', 'actif', '2026-01-01');


-- ════════════════════════════════════════════════════════════════════════════
-- T1–T3 : isolation_cross_organisation_gestionnaire (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

SELECT test_set_jwt('gestionnaire_lieux', 'cc000000-0000-0000-0000-00000000000a'::uuid,
                    'cc000000-0000-0000-0000-000000000a01'::uuid);

-- T1 : Viparis voit E1 (son lieu)
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.evenements
   WHERE id = 'cc000000-0000-0000-0000-0000000000e1'::uuid),
  1,
  'T1 : Viparis voit l''événement sur son lieu'
);

-- T2 : Viparis ne voit PAS E4 (GL Arena, lieu hors périmètre)
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.evenements
   WHERE id = 'cc000000-0000-0000-0000-0000000000e4'::uuid),
  0,
  'T2 : Viparis ne voit pas l''événement GL Events (lieu hors périmètre)'
);

-- T3 : Viparis ne voit pas la collecte GL Events
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.v_collectes_gestionnaire_lieux
   WHERE id = 'cc000000-0000-0000-0000-0000000000c4'::uuid),
  0,
  'T3 : v_collectes_gestionnaire_lieux — collecte hors périmètre exclue'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T4–T6 : vue_collectes_whitelist_colonnes_non_financieres (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

-- T4 : la vue v_collectes_gestionnaire_lieux est interrogeable
SELECT lives_ok(
  $$ SELECT id, type, statut, date_collecte, taux_recyclage
     FROM plateforme.v_collectes_gestionnaire_lieux
     WHERE id = 'cc000000-0000-0000-0000-0000000000c1'::uuid $$,
  'T4 : v_collectes_gestionnaire_lieux interrogeable par gestionnaire_lieux'
);

-- T5 : notes_internes absente de la vue (colonnes non sélectionnées = erreur)
SELECT throws_ok(
  $$ SELECT notes_internes FROM plateforme.v_collectes_gestionnaire_lieux LIMIT 1 $$,
  '42703', NULL,
  'T5 : notes_internes absente de v_collectes_gestionnaire_lieux'
);

-- T6 : dirty_tms absent de la vue
SELECT throws_ok(
  $$ SELECT dirty_tms FROM plateforme.v_collectes_gestionnaire_lieux LIMIT 1 $$,
  '42703', NULL,
  'T6 : dirty_tms absent de v_collectes_gestionnaire_lieux'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T7–T8 : factures_gestionnaire_self_uniquement / F6 (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

-- T7 : Viparis voit sa propre facture
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.factures
   WHERE id = 'cc000000-0000-0000-0000-0000000000fa'::uuid),
  1,
  'T7 : gestionnaire voit sa propre facture (décision F6)'
);

-- T8 : Viparis ne voit pas la facture Kaspia
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.factures
   WHERE id = 'cc000000-0000-0000-0000-0000000000fb'::uuid),
  0,
  'T8 : gestionnaire ne voit pas la facture du traiteur (même si collecte sur son lieu — F6)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T9–T10 : coefficient_labo_jamais_expose (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

-- T9 : SELECT direct coefficients_perte_labo → refusé
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.coefficients_perte_labo),
  0,
  'T9 : SELECT coefficients_perte_labo → 0 lignes (RLS DENY pour gestionnaire_lieux)'
);

-- T10 : f_dechets_labo_estimes sur événement propre → retourne estimation en kg
SELECT is(
  (SELECT plateforme.f_dechets_labo_estimes('cc000000-0000-0000-0000-0000000000e1'::uuid)),
  75.0::numeric,
  'T10 : f_dechets_labo_estimes E1 = 500 pax × 0.1500 = 75.0 kg'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T11–T13 : lieux_champs_admin_only_masques / v_lieux_clients (Catégorie 4)
-- v_lieux_public renommée en v_lieux_clients (fix P1 20260617170000, spec §09).
-- ════════════════════════════════════════════════════════════════════════════

-- T11 : v_lieux_clients visible et retourne le lieu de Viparis
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.v_lieux_clients
   WHERE id = 'cc000000-0000-0000-0000-000000000b01'::uuid),
  1,
  'T11 : v_lieux_clients retourne le lieu de Viparis'
);

-- T12 : commentaire_lieu absent de v_lieux_clients
SELECT throws_ok(
  $$ SELECT commentaire_lieu FROM plateforme.v_lieux_clients LIMIT 1 $$,
  '42703', NULL,
  'T12 : commentaire_lieu absent de v_lieux_clients'
);

-- T13 : siren absent de v_lieux_clients
SELECT throws_ok(
  $$ SELECT siren FROM plateforme.v_lieux_clients LIMIT 1 $$,
  '42703', NULL,
  'T13 : siren absent de v_lieux_clients'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T14–T16 : brouillons_tiers_invisibles / F3 (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

-- T14 : brouillon Kaspia sur lieu Viparis → INVISIBLE (F3)
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.evenements
   WHERE id = 'cc000000-0000-0000-0000-0000000000e2'::uuid),
  0,
  'T14 : brouillon tiers (Kaspia) sur lieu Viparis → invisible gestionnaire (décision F3)'
);

-- T15 : brouillon Viparis sur son propre lieu → VISIBLE
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.evenements
   WHERE id = 'cc000000-0000-0000-0000-0000000000e3'::uuid),
  1,
  'T15 : son propre brouillon reste visible (organisation_id = self — décision F3)'
);

-- T16 : compteur total evenements Viparis = 2 (E1 confirmé + E3 brouillon propre)
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.evenements),
  2,
  'T16 : Viparis voit exactement 2 événements (E1 confirmé + E3 propre brouillon)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T17–T18 : benchmark_execute_gestionnaire (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

-- T17 : gestionnaire peut appeler f_benchmark_kg_pax_zd
SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd('M', NULL) $$,
  'T17 : f_benchmark_kg_pax_zd exécutable par gestionnaire_lieux'
);

-- T18 : SELECT direct sur mv_benchmark_kg_pax_zd_base refusé (M3.5 REVOKE)
SELECT throws_ok(
  $$ SELECT * FROM plateforme.mv_benchmark_kg_pax_zd_base LIMIT 1 $$,
  '42501', NULL,
  'T18 : SELECT direct mv_benchmark_kg_pax_zd_base refusé (accès via fonction uniquement)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T19–T22 : organisations_lieux_self_select (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

-- T19 : Viparis voit ses 2 rattachements
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.organisations_lieux
   WHERE organisation_id = 'cc000000-0000-0000-0000-00000000000a'::uuid),
  2,
  'T19 : organisations_lieux — Viparis voit ses 2 rattachements'
);

-- T20 : Viparis ne voit pas le rattachement GL Events
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.organisations_lieux
   WHERE organisation_id = 'cc000000-0000-0000-0000-00000000000b'::uuid),
  0,
  'T20 : organisations_lieux — rattachement GL Events invisible (cross-org denied)'
);

-- T21 : INSERT sur organisations_lieux refusé pour gestionnaire
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
     VALUES ('cc000000-0000-0000-0000-00000000000a'::uuid,
             'cc000000-0000-0000-0000-000000000b03'::uuid) $$,
  '42501', NULL,
  'T21 : INSERT organisations_lieux refusé pour gestionnaire_lieux (admin only)'
);

-- T22 : total organisations_lieux vu = 2 (self only)
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.organisations_lieux),
  2,
  'T22 : organisations_lieux COUNT = 2 (self only — pas les lieux GL Events)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T23–T24 : users_org_wide / F5 (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

-- T23 : Viparis peut insérer un user dans son org (décision F5)
SELECT lives_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
     VALUES ('cc000000-0000-0000-0000-000000000a99'::uuid,
             'cc000000-0000-0000-0000-00000000000a'::uuid,
             'marie@viparis.test', 'Marie', 'D', 'gestionnaire_lieux', false) $$,
  'T23 : gestionnaire peut INSERT users dans son org (invitation collègue — décision F5)'
);

-- T24 : Viparis ne peut pas insérer un user GL Events (cross-org denied)
SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
     VALUES ('cc000000-0000-0000-0000-000000000b99'::uuid,
             'cc000000-0000-0000-0000-00000000000b'::uuid,
             'hack@glevents.test', 'Hack', 'X', 'gestionnaire_lieux', false) $$,
  '42501', NULL,
  'T24 : gestionnaire ne peut PAS INSERT users cross-org (GL Events refusé)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T25–T26 : pack_ag_lecture_self (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

-- T25 : Viparis voit son pack
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.packs_antgaspi
   WHERE id = 'cc000000-0000-0000-0000-000000000ba0'::uuid),
  1,
  'T25 : gestionnaire voit son propre pack AG'
);

-- T26 : INSERT pack refusé pour gestionnaire (admin only)
-- M2.1 aligne: inclure credits_initiaux, type_pack pour éviter NOT NULL côté PG (RLS 42501 doit tirer en premier)
SELECT throws_ok(
  $$ INSERT INTO plateforme.packs_antgaspi (organisation_id, credits_initiaux, type_pack, statut, date_achat)
     VALUES ('cc000000-0000-0000-0000-00000000000a'::uuid, 5, 'pack_10', 'actif', '2026-01-01') $$,
  '42501', NULL,
  'T26 : INSERT packs_antgaspi refusé pour gestionnaire_lieux (réservé Admin)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T27–T28 : programmation_lieu_autorise et interdit (Catégorie 1 + 3)
-- ════════════════════════════════════════════════════════════════════════════

-- T27 : Viparis peut INSERT evenement sur son propre lieu
SELECT lives_ok(
  $$ INSERT INTO plateforme.evenements (
       id, organisation_id, traiteur_operationnel_organisation_id,
       entite_facturation_id, created_by, lieu_id, type_evenement_id,
       nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
     ) VALUES (
       'cc000000-0000-0000-0000-0000000000e9'::uuid,
       'cc000000-0000-0000-0000-00000000000a'::uuid,
       'cc000000-0000-0000-0000-00000000000c'::uuid,
       'cc000000-0000-0000-0000-0000000000f5'::uuid,
       'cc000000-0000-0000-0000-000000000a01'::uuid,
       'cc000000-0000-0000-0000-000000000b01'::uuid,
       'cc000000-0000-0000-0000-000000000bee'::uuid,
       'Evenement Viparis Test', '2026-09-01', 300, 'Contact9', '0600000009'
     ) $$,
  'T27 : gestionnaire peut programmer sur son propre lieu (INSERT evenements autorisé)'
);

-- T28 : Viparis ne peut PAS INSERT evenement sur GL Arena (hors périmètre)
SELECT throws_ok(
  $$ INSERT INTO plateforme.evenements (
       id, organisation_id, traiteur_operationnel_organisation_id,
       entite_facturation_id, created_by, lieu_id, type_evenement_id,
       nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
     ) VALUES (
       'cc000000-0000-0000-0000-0000000000e8'::uuid,
       'cc000000-0000-0000-0000-00000000000a'::uuid,
       'cc000000-0000-0000-0000-00000000000c'::uuid,
       'cc000000-0000-0000-0000-0000000000f5'::uuid,
       'cc000000-0000-0000-0000-000000000a01'::uuid,
       'cc000000-0000-0000-0000-000000000b03'::uuid,
       'cc000000-0000-0000-0000-000000000bee'::uuid,
       'Lieu GL Events Hack', '2026-09-01', 200, 'ContactH', '0600000008'
     ) $$,
  '42501', NULL,
  'T28 : INSERT evenements sur lieu hors périmètre refusé (organisations_lieux check)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T36–T37 : org_gestionnaire_traiteur_select (Catégorie 4)
-- ════════════════════════════════════════════════════════════════════════════

-- T36 : Viparis voit Kaspia (E1 confirmé sur son lieu b01)
-- JWT Viparis déjà actif (positionné ligne 185)
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.organisations
   WHERE id = 'cc000000-0000-0000-0000-00000000000c'::uuid
   AND type = 'traiteur'),
  1,
  'T36 : org_gestionnaire_traiteur_select — Kaspia visible Viparis (E1 confirmé sur lieu b01)'
);

-- T37 : Viparis ne voit PAS Traiteur Externe (aucun événement sur ses lieux)
-- JWT Viparis toujours actif (pas de switch nécessaire)
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.organisations
   WHERE id = 'cc000000-0000-0000-0000-00000000000d'::uuid
   AND type = 'traiteur'),
  0,
  'T37 : org_gestionnaire_traiteur_select — Traiteur Externe invisible (aucun événement confirmé sur lieux Viparis)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- T29–T35 : brackets + k-anonymat (Catégorie 2)
-- ════════════════════════════════════════════════════════════════════════════

-- T29–T35 : taille_evenement_bracket bornes exactes (7 cas critiques)
SELECT is(plateforme.taille_evenement_bracket(249), 'XS', 'T29 : bracket(249) = XS');
SELECT is(plateforme.taille_evenement_bracket(250), 'S',  'T30 : bracket(250) = S');
SELECT is(plateforme.taille_evenement_bracket(499), 'S',  'T31 : bracket(499) = S');
SELECT is(plateforme.taille_evenement_bracket(500), 'M',  'T32 : bracket(500) = M');
SELECT is(plateforme.taille_evenement_bracket(749), 'M',  'T33 : bracket(749) = M');
SELECT is(plateforme.taille_evenement_bracket(750), 'L',  'T34 : bracket(750) = L');
SELECT is(plateforme.taille_evenement_bracket(1000), 'XL', 'T35 : bracket(1000) = XL');

SELECT * FROM finish();
ROLLBACK;
