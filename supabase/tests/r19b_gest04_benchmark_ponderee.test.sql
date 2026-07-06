-- pgTAP R19b — BL-P1-GEST-04 : f_benchmark_kg_pax_zd (7 params + moyenne pondérée)
-- ---------------------------------------------------------------------------
-- Prouve la refonte de la fonction benchmark (§11 Dashboards, §04 Data Model) :
--   - signature 7 paramètres (flux, type évt, taille, période, lieux, traiteurs) ;
--   - MOYENNE PONDÉRÉE PAR TONNAGE = SUM(poids)/SUM(pax) (≠ moyenne simple des ratios,
--     ≠ médiane de l'ancienne implémentation) ;
--   - k-anonymat ≥5 (segment < 5 collectes non retourné) ;
--   - garde compétitive : rôle traiteur + p_traiteur_ids ⇒ RAISE.
-- Fixtures 100 % isolées (BEGIN…ROLLBACK) : aucune interférence avec m3_2.
-- ---------------------------------------------------------------------------

BEGIN;
SELECT plan(14);

-- ── Helper JWT (isolé) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _r19b_set_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- ── Fixtures (superuser) ────────────────────────────────────────────────────
SET LOCAL role = 'postgres';

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd)
VALUES ('dd000000-0000-0000-0000-0000000000a1'::uuid, 'Bench Traiteur', 'Bench SARL', 'traiteur', '99999999900001', true, 0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES ('dd000000-0000-0000-0000-0000000000b1'::uuid, 'dd000000-0000-0000-0000-0000000000a1'::uuid,
        'chef@bench.test', 'Chef', 'B', 'traiteur_manager', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('dd000000-0000-0000-0000-0000000000f1'::uuid, 'dd000000-0000-0000-0000-0000000000a1'::uuid,
        'Bench SARL', '99999999900001', '1 rue Bench', '75001', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('dd000000-0000-0000-0000-0000000000d1'::uuid, 'BENCH_R19B', 'Bench R19b', 1, true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('dd000000-0000-0000-0000-0000000000f0'::uuid, 'Bench Lieu', '2 av Bench', '75002', 'Paris', 'camionnette');

-- 5 événements bracket M (pax ∈ [500,749]) avec pax VARIÉ (pour distinguer
-- moyenne pondérée d'une moyenne simple des ratios).
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  ('dd000000-0000-0000-0000-0000000000e1'::uuid, 'dd000000-0000-0000-0000-0000000000a1'::uuid,
   'dd000000-0000-0000-0000-0000000000a1'::uuid, 'dd000000-0000-0000-0000-0000000000f1'::uuid,
   'dd000000-0000-0000-0000-0000000000b1'::uuid, 'dd000000-0000-0000-0000-0000000000f0'::uuid,
   'dd000000-0000-0000-0000-0000000000d1'::uuid, 'Evt1', '2026-05-01', 500, 'C', '0600000001'),
  ('dd000000-0000-0000-0000-0000000000e2'::uuid, 'dd000000-0000-0000-0000-0000000000a1'::uuid,
   'dd000000-0000-0000-0000-0000000000a1'::uuid, 'dd000000-0000-0000-0000-0000000000f1'::uuid,
   'dd000000-0000-0000-0000-0000000000b1'::uuid, 'dd000000-0000-0000-0000-0000000000f0'::uuid,
   'dd000000-0000-0000-0000-0000000000d1'::uuid, 'Evt2', '2026-05-02', 700, 'C', '0600000002'),
  ('dd000000-0000-0000-0000-0000000000e3'::uuid, 'dd000000-0000-0000-0000-0000000000a1'::uuid,
   'dd000000-0000-0000-0000-0000000000a1'::uuid, 'dd000000-0000-0000-0000-0000000000f1'::uuid,
   'dd000000-0000-0000-0000-0000000000b1'::uuid, 'dd000000-0000-0000-0000-0000000000f0'::uuid,
   'dd000000-0000-0000-0000-0000000000d1'::uuid, 'Evt3', '2026-05-03', 700, 'C', '0600000003'),
  ('dd000000-0000-0000-0000-0000000000e4'::uuid, 'dd000000-0000-0000-0000-0000000000a1'::uuid,
   'dd000000-0000-0000-0000-0000000000a1'::uuid, 'dd000000-0000-0000-0000-0000000000f1'::uuid,
   'dd000000-0000-0000-0000-0000000000b1'::uuid, 'dd000000-0000-0000-0000-0000000000f0'::uuid,
   'dd000000-0000-0000-0000-0000000000d1'::uuid, 'Evt4', '2026-05-04', 700, 'C', '0600000004'),
  ('dd000000-0000-0000-0000-0000000000e5'::uuid, 'dd000000-0000-0000-0000-0000000000a1'::uuid,
   'dd000000-0000-0000-0000-0000000000a1'::uuid, 'dd000000-0000-0000-0000-0000000000f1'::uuid,
   'dd000000-0000-0000-0000-0000000000b1'::uuid, 'dd000000-0000-0000-0000-0000000000f0'::uuid,
   'dd000000-0000-0000-0000-0000000000d1'::uuid, 'Evt5', '2026-05-05', 700, 'C', '0600000005');

-- 5 collectes cloturees ZD (1 par événement).
INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, dirty_tms, annulee_cote_savr)
VALUES
  ('dd000000-0000-0000-0000-0000000000c1'::uuid, 'dd000000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'cloturee', 'non_envoye', '2026-05-01', '20:00', false, false),
  ('dd000000-0000-0000-0000-0000000000c2'::uuid, 'dd000000-0000-0000-0000-0000000000e2'::uuid, 'zero_dechet', 'cloturee', 'non_envoye', '2026-05-02', '20:00', false, false),
  ('dd000000-0000-0000-0000-0000000000c3'::uuid, 'dd000000-0000-0000-0000-0000000000e3'::uuid, 'zero_dechet', 'cloturee', 'non_envoye', '2026-05-03', '20:00', false, false),
  ('dd000000-0000-0000-0000-0000000000c4'::uuid, 'dd000000-0000-0000-0000-0000000000e4'::uuid, 'zero_dechet', 'cloturee', 'non_envoye', '2026-05-04', '20:00', false, false),
  ('dd000000-0000-0000-0000-0000000000c5'::uuid, 'dd000000-0000-0000-0000-0000000000e5'::uuid, 'zero_dechet', 'cloturee', 'non_envoye', '2026-05-05', '20:00', false, false);

-- biodechet sur les 5 collectes (poids déséquilibré : la collecte à faible pax porte
-- le plus de tonnage ⇒ moyenne pondérée ≠ moyenne simple des ratios).
--   SUM(poids) = 2500 + 700*4 = 5300 ; SUM(pax) = 500 + 700*4 = 3300 ; pondérée = 5300/3300 ≈ 1.606
--   moyenne simple des ratios = (5 + 1 + 1 + 1 + 1)/5 = 1.8
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT c.id, (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'), c.poids
FROM (VALUES
  ('dd000000-0000-0000-0000-0000000000c1'::uuid, 2500::decimal),
  ('dd000000-0000-0000-0000-0000000000c2'::uuid, 700::decimal),
  ('dd000000-0000-0000-0000-0000000000c3'::uuid, 700::decimal),
  ('dd000000-0000-0000-0000-0000000000c4'::uuid, 700::decimal),
  ('dd000000-0000-0000-0000-0000000000c5'::uuid, 700::decimal)
) AS c(id, poids);

-- emballage sur 3 collectes seulement (< 5) → doit être MASQUÉ par le k-anonymat.
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT c.id, (SELECT id FROM plateforme.flux_dechets WHERE code = 'emballage'), 100::decimal
FROM (VALUES
  ('dd000000-0000-0000-0000-0000000000c1'::uuid),
  ('dd000000-0000-0000-0000-0000000000c2'::uuid),
  ('dd000000-0000-0000-0000-0000000000c3'::uuid)
) AS c(id);

-- ════════════════════════════════════════════════════════════════════════════
-- Assertions
-- ════════════════════════════════════════════════════════════════════════════
SELECT _r19b_set_jwt('gestionnaire_lieux', 'dd000000-0000-0000-0000-0000000000a1'::uuid);

-- 1. Signature 7 params callable par gestionnaire (tous filtres nommés).
SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(
       p_flux_id => NULL, p_type_evenement_ids => NULL, p_taille_evenement_codes => ARRAY['M'],
       p_periode_debut => NULL, p_periode_fin => NULL, p_lieu_ids => NULL, p_traiteur_ids => NULL) $$,
  'GEST04-1 : f_benchmark_kg_pax_zd signature 7 params callable (gestionnaire)'
);

-- 2. nb_collectes_segment = 5 sur le segment biodechet / taille M (1 seul type dans la fixture).
SELECT is(
  (SELECT nb_collectes_segment FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M'])
    WHERE flux_code = 'biodechet'),
  5,
  'GEST04-2 : nb_collectes_segment = 5 (biodechet, taille M)'
);

-- 3. kg_par_pax_moyen = moyenne PONDÉRÉE par tonnage = SUM(poids)/SUM(pax) = 5300/3300 ≈ 1.606061.
--    (Valeur attendue codée en dur : la fonction est SECURITY DEFINER — l'oracle inline
--    serait sinon filtré par la RLS gestionnaire et renverrait NULL.)
SELECT is(
  (SELECT round(kg_par_pax_moyen, 6)
     FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M'])
    WHERE flux_code = 'biodechet'),
  round(5300.0 / 3300.0, 6),
  'GEST04-3 : kg_par_pax_moyen = moyenne pondérée SUM(poids)/SUM(pax) = 5300/3300'
);

-- 4. La valeur pondérée (≈1.606061) DIFFÈRE de la moyenne SIMPLE des ratios
--    ((5+1+1+1+1)/5 = 1.8) ⇒ pondération par tonnage effective (pas une médiane ni une
--    moyenne arithmétique des ratios individuels).
SELECT isnt(
  (SELECT round(kg_par_pax_moyen, 6)
     FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M'])
    WHERE flux_code = 'biodechet'),
  round(1.8, 6),
  'GEST04-4 : pondérée (≈1.606) ≠ moyenne simple des ratios (1.8) — pondération par tonnage'
);

-- 5. k-anonymat : emballage n'a que 3 collectes < 5 → segment masqué (aucune ligne).
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M'])
    WHERE flux_code = 'emballage'),
  0,
  'GEST04-5 : k-anonymat — emballage (3 collectes) masqué du benchmark'
);

-- 6. Garde compétitive : rôle traiteur + p_traiteur_ids ⇒ RAISE.
SELECT _r19b_set_jwt('traiteur_manager', 'dd000000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(
       p_traiteur_ids => ARRAY['dd000000-0000-0000-0000-0000000000a1'::uuid]) $$,
  'P0001', NULL,
  'GEST04-6 : rôle traiteur + traiteur_ids ⇒ exception (préservation compétitive)'
);

-- 7. Rôle traiteur SANS p_traiteur_ids ⇒ autorisé (le benchmark reste consultable).
SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M']) $$,
  'GEST04-7 : rôle traiteur sans traiteur_ids ⇒ benchmark autorisé'
);

-- 8. Filtre p_flux_id : cible un flux précis (biodechet) → 1 ligne.
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.f_benchmark_kg_pax_zd(
     p_flux_id => (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'),
     p_taille_evenement_codes => ARRAY['M'])),
  1,
  'GEST04-8 : p_flux_id cible le flux (biodechet) — 1 segment'
);

-- 9. Grain CDC : le segment expose son type_evenement_id (= le type de la fixture).
SELECT is(
  (SELECT type_evenement_id FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M'])
    WHERE flux_code = 'biodechet'),
  'dd000000-0000-0000-0000-0000000000d1'::uuid,
  'GEST04-9 : grain CDC — type_evenement_id exposé sur le segment'
);

-- 10. Colonne d'audit nb_organisations_distinctes (§04) : 1 organisation dans la fixture.
SELECT is(
  (SELECT nb_organisations_distinctes FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M'])
    WHERE flux_code = 'biodechet'),
  1,
  'GEST04-10 : nb_organisations_distinctes exposé (= 1 org dans la fixture)'
);

-- ── Encart « Filtres benchmark » : fonctions de liste parc (SECURITY DEFINER) ──

-- 11. Gestionnaire liste les lieux du parc (>= 1 : la fixture a créé 1 lieu).
SELECT _r19b_set_jwt('gestionnaire_lieux', 'dd000000-0000-0000-0000-0000000000a1'::uuid);
SELECT cmp_ok(
  (SELECT COUNT(*)::int FROM plateforme.f_benchmark_lieux_parc()),
  '>=', 1,
  'GEST04-11 : f_benchmark_lieux_parc listable par gestionnaire (parc entier)'
);

-- 12. Gestionnaire liste les traiteurs du parc (>= 1 : l'org fixture est un traiteur).
SELECT cmp_ok(
  (SELECT COUNT(*)::int FROM plateforme.f_benchmark_traiteurs_parc()),
  '>=', 1,
  'GEST04-12 : f_benchmark_traiteurs_parc listable par gestionnaire'
);

-- 13. Rôle traiteur : la liste des traiteurs est REFUSÉE (préservation compétitive).
SELECT _r19b_set_jwt('traiteur_manager', 'dd000000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_traiteurs_parc() $$,
  'P0001', NULL,
  'GEST04-13 : rôle traiteur ⇒ liste traiteurs parc refusée (compétitif)'
);

-- 14. Rôle hors périmètre benchmark (client_organisateur) : liste lieux refusée.
SELECT _r19b_set_jwt('client_organisateur', 'dd000000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_lieux_parc() $$,
  'P0001', NULL,
  'GEST04-14 : rôle client_organisateur ⇒ liste lieux parc refusée'
);

SELECT * FROM finish();
ROLLBACK;
