-- =============================================================================
-- Tests pgTAP R18 — BL-P2-04 — Grilles tarifaires ZD : colonne `mode` (converge
-- DDL cible) + RPC rpc_creer_grille_zd (création versionnée close-then-create).
-- =============================================================================
-- Oracle : (1) la colonne fantôme `methode` est remplacée par la vraie colonne
-- `mode` (enum mode_grille_zd) ; (2) la RPC crée entête + paliers atomiquement ;
-- (3) en mode 'paliers' le prix par couvert est forcé à 0 (CDC §9 l.740) ;
-- (4) créer une nouvelle grille par défaut ferme l'ancienne (unicité défaut).
-- =============================================================================

BEGIN;
SELECT plan(7);

-- Structure : colonne mode + RPC présentes
SELECT has_column(
  'plateforme', 'grilles_tarifaires_zd', 'mode',
  'grilles_tarifaires_zd.mode présente (remplace la colonne fantôme methode)');
SELECT hasnt_column(
  'plateforme', 'grilles_tarifaires_zd', 'methode',
  'grilles_tarifaires_zd.methode absente (jamais créée)');
SELECT has_function(
  'plateforme', 'rpc_creer_grille_zd',
  'rpc_creer_grille_zd présente');

-- Création en mode paliers : prix_par_couvert_ht forcé à 0 même si fourni ≠ 0
SELECT lives_ok(
  $$ SELECT plateforme.rpc_creer_grille_zd(
       'Grille Paliers Test', 'paliers'::plateforme.mode_grille_zd, false,
       '2026-09-01'::date,
       jsonb_build_array(jsonb_build_object(
         'pax_min', 1, 'pax_max', 250,
         'prix_base_ht', 450, 'prix_par_couvert_ht', 99)),
       'grille de test') $$,
  'rpc_creer_grille_zd (paliers) : pas d''erreur');

SELECT is(
  (SELECT t.prix_par_couvert_ht
     FROM plateforme.tarifs_zero_dechet t
     JOIN plateforme.grilles_tarifaires_zd g ON g.id = t.grille_id
    WHERE g.nom = 'Grille Paliers Test'),
  0::numeric,
  'mode paliers : prix_par_couvert_ht forcé à 0 (CDC l.740)');

-- Versionnement : neutralise toute défaut existante puis pose une défaut connue,
-- crée une nouvelle défaut → l'ancienne est fermée (une seule défaut active).
UPDATE plateforme.grilles_tarifaires_zd
  SET est_defaut = false, actif = false
  WHERE est_defaut = true AND actif = true;
INSERT INTO plateforme.grilles_tarifaires_zd (nom, mode, est_defaut, actif, valide_du)
VALUES ('Défaut Historique', 'paliers', true, true, '2026-01-01');

SELECT lives_ok(
  $$ SELECT plateforme.rpc_creer_grille_zd(
       'Nouvelle Défaut', 'fixe_variable'::plateforme.mode_grille_zd, true,
       '2026-10-01'::date,
       jsonb_build_array(jsonb_build_object(
         'pax_min', 1, 'pax_max', NULL,
         'prix_base_ht', 200, 'prix_par_couvert_ht', 1)),
       NULL) $$,
  'rpc_creer_grille_zd (nouvelle défaut) : pas d''erreur');

SELECT is(
  (SELECT nom FROM plateforme.grilles_tarifaires_zd
     WHERE est_defaut = true AND actif = true),
  'Nouvelle Défaut',
  'versionnement : la nouvelle grille est l''unique défaut active');

SELECT finish();
ROLLBACK;
