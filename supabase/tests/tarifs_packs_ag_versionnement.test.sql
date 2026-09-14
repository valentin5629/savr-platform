-- =============================================================================
-- Tests pgTAP — tarifs_packs_ag : versionnement atomique, contraintes recollées,
-- invariant « une seule ligne ouverte par type_pack » (migration 20260914160000).
-- =============================================================================
-- Oracles :
--  (1) ACL — rpc_creer_tarif_pack_ag est SECURITY DEFINER et écrit le référentiel
--      de prix en bypass RLS ; un CREATE OR REPLACE sur une base où la fonction
--      n'existe pas dégénère en CREATE, qui rend EXECUTE à PUBLIC (piège P0 #263)
--      → cliquet permanent sur anon/authenticated.
--  (2) Contraintes — credits <= 0, prix < 0 et bornes inversées sont REJETÉS
--      (elles l'étaient avant le DROP COLUMN legacy 20260629000000, plus après).
--  (3) Invariant — deux lignes ouvertes pour le même type_pack sont impossibles.
--  (4) Atomicité — une création qui échoue APRÈS la fermeture laisse la ligne
--      en vigueur OUVERTE (c'était le défaut : zéro tarif actif, silencieusement).
--  (5) Non rétroactif — CLAUDE.md §4 / CDC §9 : une nouvelle version prend effet
--      après le début de celle qu'elle remplace.
-- =============================================================================

BEGIN;
SELECT plan(15);

-- ── Fixtures : on part d'un référentiel maîtrisé. Les lignes seedées ouvertes
-- sont fermées « à leur jour de prise d'effet » (intervalle nul, autorisé par
-- chk_tarif_pack_ag_bornes_validite) pour libérer l'index unique partiel.
UPDATE plateforme.tarifs_packs_ag
   SET valide_jusqu_au = valide_du
 WHERE valide_jusqu_au IS NULL;

INSERT INTO plateforme.tarifs_packs_ag
  (id, type_pack, credits, prix_unitaire_ht, montant_total_ht, valide_du)
VALUES
  ('7a71f000-0000-0000-0000-000000000030'::uuid, 'pack_30', 30, 460.00, 13800.00, '2026-01-01'),
  ('7a71f000-0000-0000-0000-000000000060'::uuid, 'pack_60', 60, 390.00, 23400.00, '2026-01-01');

-- ── 1. Présence + ACL ────────────────────────────────────────────────────────

SELECT has_function(
  'plateforme', 'rpc_creer_tarif_pack_ag',
  'rpc_creer_tarif_pack_ag présente');

SELECT ok(
  NOT has_function_privilege('anon',
    'plateforme.rpc_creer_tarif_pack_ag(text, integer, numeric, date, boolean, integer)',
    'EXECUTE'),
  'anon ne peut PAS exécuter rpc_creer_tarif_pack_ag');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.rpc_creer_tarif_pack_ag(text, integer, numeric, date, boolean, integer)',
    'EXECUTE'),
  'authenticated ne peut PAS exécuter rpc_creer_tarif_pack_ag');

SELECT ok(
  has_function_privilege('service_role',
    'plateforme.rpc_creer_tarif_pack_ag(text, integer, numeric, date, boolean, integer)',
    'EXECUTE'),
  'service_role peut exécuter rpc_creer_tarif_pack_ag (chemin applicatif)');

-- ── 2. Contraintes recollées (perdues au DROP COLUMN legacy) ─────────────────

SELECT throws_ok(
  $$ INSERT INTO plateforme.tarifs_packs_ag
       (type_pack, credits, prix_unitaire_ht, montant_total_ht, valide_du)
     VALUES ('unitaire', 0, 590.00, 0.00, '2027-01-01') $$,
  '23514',
  NULL,
  'credits = 0 rejeté (chk_tarif_pack_ag_credits_positifs)');

SELECT throws_ok(
  $$ INSERT INTO plateforme.tarifs_packs_ag
       (type_pack, credits, prix_unitaire_ht, montant_total_ht, valide_du)
     VALUES ('unitaire', 1, -100.00, -100.00, '2027-01-01') $$,
  '23514',
  NULL,
  'prix_unitaire_ht négatif rejeté (chk_tarif_pack_ag_prix_positif)');

SELECT throws_ok(
  $$ INSERT INTO plateforme.tarifs_packs_ag
       (type_pack, credits, prix_unitaire_ht, montant_total_ht, valide_du, valide_jusqu_au)
     VALUES ('unitaire', 1, 590.00, 590.00, '2027-01-01', '2026-12-31') $$,
  '23514',
  NULL,
  'valide_jusqu_au antérieur à valide_du rejeté (chk_tarif_pack_ag_bornes_validite)');

-- ── 3. Invariant « une seule ligne ouverte par type_pack » ───────────────────

SELECT throws_ok(
  $$ INSERT INTO plateforme.tarifs_packs_ag
       (type_pack, credits, prix_unitaire_ht, montant_total_ht, valide_du)
     VALUES ('pack_30', 30, 400.00, 12000.00, '2026-06-01') $$,
  '23505',
  NULL,
  'deuxième ligne ouverte pour pack_30 impossible (uniq_tarif_pack_ag_ouvert_par_type)');

-- ── 4. Chemin nominal : fermeture + insertion atomiques ──────────────────────

SELECT lives_ok(
  $$ SELECT plateforme.rpc_creer_tarif_pack_ag('pack_30', 30, 400.00, '2026-06-01') $$,
  'rpc_creer_tarif_pack_ag (pack_30 au 2026-06-01) : pas d''erreur');

SELECT is(
  (SELECT valide_jusqu_au FROM plateforme.tarifs_packs_ag
    WHERE id = '7a71f000-0000-0000-0000-000000000030'::uuid),
  '2026-05-31'::date,
  'ligne en vigueur fermée à la veille de la prise d''effet');

SELECT is(
  (SELECT count(*)::int FROM plateforme.tarifs_packs_ag
    WHERE type_pack = 'pack_30' AND valide_jusqu_au IS NULL),
  1,
  'exactement une ligne pack_30 ouverte après versionnement');

SELECT is(
  (SELECT montant_total_ht FROM plateforme.tarifs_packs_ag
    WHERE type_pack = 'pack_30' AND valide_jusqu_au IS NULL),
  12000.00::numeric,
  'montant_total_ht calculé en base (credits × prix_unitaire_ht)');

-- ── 5. Atomicité : échec APRÈS la fermeture = rien n'a bougé ─────────────────
-- credits = -5 viole chk_tarif_pack_ag_credits_positifs à l'INSERT, donc APRÈS
-- l'UPDATE de fermeture. Avant la RPC (deux appels PostgREST séparés), pack_60
-- se retrouvait sans aucune ligne ouverte.

SELECT throws_ok(
  $$ SELECT plateforme.rpc_creer_tarif_pack_ag('pack_60', -5, 390.00, '2026-06-01') $$,
  '23514',
  NULL,
  'credits négatif : la RPC échoue (contrainte de table)');

SELECT is(
  (SELECT valide_jusqu_au FROM plateforme.tarifs_packs_ag
    WHERE id = '7a71f000-0000-0000-0000-000000000060'::uuid),
  NULL::date,
  'atomicité : après échec, la ligne pack_60 en vigueur est TOUJOURS ouverte');

-- ── 6. Versionnement non rétroactif (CLAUDE.md §4) ───────────────────────────

SELECT throws_ok(
  $$ SELECT plateforme.rpc_creer_tarif_pack_ag('pack_60', 60, 300.00, '2026-01-01') $$,
  '22023',
  NULL,
  'valide_du au jour même de la version en vigueur rejeté (non rétroactif)');

SELECT finish();
ROLLBACK;
