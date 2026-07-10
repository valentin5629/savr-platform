-- =============================================================================
-- Tests pgTAP M2.4 — BL-P0-06 — RPC d'audit-write des paramètres CO₂ + taux.
-- =============================================================================
-- Oracle « pas de 500 ET historique tracé » : exécute les triggers RÉELS sous le
-- chemin service-role (auth.uid() NULL, auteur passé en paramètre comme la route).
-- Vérifie que chaque RPC met à jour la table cible ET trace l'historique/audit
-- avec le bon auteur (modifie_par) + commentaire (commentaire_modif).
-- Avant R3, ce chemin échouait (null value in column modifie_par / RLS _history).
-- =============================================================================

BEGIN;
SELECT plan(21);

-- Auteur admin (le trigger résout modifie_par via le GUC savr.audit_user posé par la RPC).
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, tarif_refacture_pax_zd, mode_facturation_zd)
VALUES ('22222222-2222-2222-2222-222222222222', 'Org Test', 'traiteur', true, false, 0,
  (SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'mode_facturation_zd_enum' LIMIT 1)::plateforme.mode_facturation_zd_enum);
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        'admin@savr-test.local', 'A', 'D', 'admin_savr', true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. facteurs CO₂ ZD (verre)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT plateforme.rpc_maj_facteurs_co2(
       '11111111-1111-1111-1111-111111111111', 'Maj ADEME verre 2026',
       jsonb_build_array(jsonb_build_object(
         'id', (SELECT id FROM plateforme.parametres_facteurs_co2 WHERE code_flux='verre'),
         'fe_induit_kg_t', 11.5)) ) $$,
  'rpc_maj_facteurs_co2 : pas d''erreur (pas de 500)');

SELECT is(
  (SELECT fe_induit_kg_t FROM plateforme.parametres_facteurs_co2 WHERE code_flux='verre'),
  11.5::decimal, 'facteurs_co2 : fe_induit_kg_t mis à jour');

SELECT is(
  (SELECT count(*)::int FROM plateforme.parametres_facteurs_co2_history
     WHERE code_flux='verre'
       AND modifie_par='11111111-1111-1111-1111-111111111111'
       AND commentaire_modif='Maj ADEME verre 2026'),
  1, 'facteurs_co2 : 1 ligne d''historique tracée (auteur + commentaire)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. facteur CO₂ AG
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT plateforme.rpc_maj_facteur_co2_ag(
       '11111111-1111-1111-1111-111111111111', 'Maj facteur FAO 2026',
       (SELECT id FROM plateforme.parametres_facteurs_co2_ag LIMIT 1), 2.7) $$,
  'rpc_maj_facteur_co2_ag : pas d''erreur');

SELECT is(
  (SELECT facteur_co2_evite_par_repas_kg FROM plateforme.parametres_facteurs_co2_ag LIMIT 1),
  2.7::decimal, 'facteurs_co2_ag : facteur_co2_evite_par_repas_kg mis à jour');

SELECT is(
  (SELECT count(*)::int FROM plateforme.parametres_facteurs_co2_ag_history
     WHERE modifie_par='11111111-1111-1111-1111-111111111111'
       AND commentaire_modif='Maj facteur FAO 2026'),
  1, 'facteurs_co2_ag : 1 ligne d''historique tracée');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. mix emballages (redistribution Σ=100 : carton +5 / pet -5)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT plateforme.rpc_maj_mix_emballages(
       '11111111-1111-1111-1111-111111111111', 'Maj mix emballages 2026',
       (SELECT jsonb_agg(jsonb_build_object('id', id, 'part_pct',
          part_pct + CASE code_materiau WHEN 'carton_papier' THEN 5 WHEN 'pet' THEN -5 ELSE 0 END))
        FROM plateforme.parametres_mix_emballages)) $$,
  'rpc_maj_mix_emballages : pas d''erreur');

SELECT is(
  (SELECT SUM(part_pct) FROM plateforme.parametres_mix_emballages WHERE actif),
  100::decimal, 'mix : Σ part_pct = 100 après batch');

SELECT is(
  (SELECT count(*)::int FROM plateforme.parametres_mix_emballages_history
     WHERE modifie_par='11111111-1111-1111-1111-111111111111'),
  2, 'mix : 2 lignes d''historique (carton + pet modifiés)');

SELECT is(
  (SELECT count(*)::int FROM plateforme.parametres_facteurs_co2_history
     WHERE code_flux='emballage'
       AND modifie_par='11111111-1111-1111-1111-111111111111'),
  1, 'mix : recompute emballage → 1 seule ligne d''historique (pas de bruit)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. co2_divers (clé-valeur) — audit_log
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT plateforme.rpc_maj_co2_divers(
       '11111111-1111-1111-1111-111111111111', 'Maj forfait collecte',
       jsonb_build_array(jsonb_build_object(
         'id', (SELECT id FROM plateforme.parametres_co2_divers LIMIT 1), 'valeur', 0.42))) $$,
  'rpc_maj_co2_divers : pas d''erreur');

SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
     WHERE action='parametres_co2_divers_update'
       AND user_id='11111111-1111-1111-1111-111111111111'
       AND motif='Maj forfait collecte'),
  1, 'co2_divers : audit_log tracé (auteur + motif)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. taux recyclage (inclus R3) + garde commentaire
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT plateforme.rpc_maj_taux_recyclage(
       '11111111-1111-1111-1111-111111111111', 'Maj taux ADEME 2026',
       (SELECT id FROM plateforme.parametres_taux_recyclage ORDER BY code_filiere LIMIT 1), 0.123) $$,
  'rpc_maj_taux_recyclage : pas d''erreur');

SELECT is(
  (SELECT count(*)::int FROM plateforme.parametres_taux_recyclage_history
     WHERE modifie_par='11111111-1111-1111-1111-111111111111'
       AND commentaire_modif='Maj taux ADEME 2026'),
  1, 'taux_recyclage : 1 ligne d''historique tracée');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. emballage : énergie primaire éditable, FE induit/évité protégés (dérivés)
--    CDC §06.06 §9.1 + R_co2_emballage_mix.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT plateforme.rpc_maj_facteurs_co2(
       '11111111-1111-1111-1111-111111111111', 'Energie emballage 2026',
       jsonb_build_array(jsonb_build_object(
         'id', (SELECT id FROM plateforme.parametres_facteurs_co2 WHERE code_flux='emballage'),
         'fe_induit_kg_t', 999, 'fe_evite_kg_t', 999,
         'energie_primaire_evitee_kwh_t', 1234)) ) $$,
  'emballage : RPC accepte la maj de l''énergie primaire');

SELECT is(
  (SELECT energie_primaire_evitee_kwh_t FROM plateforme.parametres_facteurs_co2 WHERE code_flux='emballage'),
  1234::decimal, 'emballage : énergie primaire éditée à la main (CDC §9.1)');

SELECT isnt(
  (SELECT fe_induit_kg_t FROM plateforme.parametres_facteurs_co2 WHERE code_flux='emballage'),
  999::decimal, 'emballage : FE induit RESTE dérivé du mix (999 ignoré)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. mix : FE matériau éditable (part_pct + FE matériau) — CDC §06.06 §9.2
-- ─────────────────────────────────────────────────────────────────────────────
SELECT is(
  (WITH r AS (
     SELECT plateforme.rpc_maj_mix_emballages(
       '11111111-1111-1111-1111-111111111111', 'FE materiau carton 2026',
       jsonb_build_array(jsonb_build_object(
         'id', (SELECT id FROM plateforme.parametres_mix_emballages WHERE code_materiau='carton_papier'),
         'part_pct', (SELECT part_pct FROM plateforme.parametres_mix_emballages WHERE code_materiau='carton_papier'),
         'fe_induit_kg_t', 77)))
   ) SELECT 1 FROM r),
  1, 'mix : RPC accepte la maj du FE matériau');

SELECT is(
  (SELECT fe_induit_kg_t FROM plateforme.parametres_mix_emballages WHERE code_materiau='carton_papier'),
  77::decimal, 'mix : FE induit matériau carton édité à la main (CDC §9.2)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. BL-P3-14 — tolérance Σ=100 = 0,05 (CDC §05 R_co2 l.575 / §04 Data Model).
--    Verrou de non-régression : 99,96 % accepté (|Δ|=0,04), 105 % rejeté (22023).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT plateforme.rpc_maj_mix_emballages(
       '11111111-1111-1111-1111-111111111111', 'BL-P3-14 tolérance basse 99.96',
       (SELECT jsonb_agg(jsonb_build_object('id', id, 'part_pct',
          part_pct + CASE WHEN code_materiau='carton_papier'
            THEN (99.96 - (SELECT SUM(part_pct) FROM plateforme.parametres_mix_emballages WHERE actif))
            ELSE 0 END))
        FROM plateforme.parametres_mix_emballages WHERE actif)) $$,
  'BL-P3-14 : mix Σ=99,96 accepté (|Δ|=0,04 ≤ tolérance 0,05)');

SELECT throws_ok(
  $$ SELECT plateforme.rpc_maj_mix_emballages(
       '11111111-1111-1111-1111-111111111111', 'BL-P3-14 hors tolérance 105',
       (SELECT jsonb_agg(jsonb_build_object('id', id, 'part_pct',
          part_pct + CASE WHEN code_materiau='carton_papier'
            THEN (105 - (SELECT SUM(part_pct) FROM plateforme.parametres_mix_emballages WHERE actif))
            ELSE 0 END))
        FROM plateforme.parametres_mix_emballages WHERE actif)) $$,
  '22023',
  NULL,
  'BL-P3-14 : mix Σ=105 rejeté (RAISE 22023, hors tolérance)');

SELECT finish();
ROLLBACK;
