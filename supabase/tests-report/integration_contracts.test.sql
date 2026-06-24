-- =============================================================================
-- integration-contracts (Lot 0 / R0c, L4) — MODE RAPPORT.
-- =============================================================================
-- Ferme L4 : « test complaisant — CI verte sur chemin mocké ». Ces assertions
-- portent sur l'ÉTAT RÉEL d'une base Postgres (pas de mock du client Supabase) :
--   · n° de facture ∈ séquence GAPLESS (sequences_facturation réellement avancée) ;
--   · ligne d'alerte réellement écrite en base (f_upsert_alerte_admin) + dédup.
--
-- R2/Storage : la postcondition « fichier présent sur R2 » est REPORTÉE en
-- preprod/DEMO (décision Val 2026-06-24 : R2 non émulé en CI, r2-client.ts pointe
-- prod Cloudflare). Elle est ici déclarée NON-COUVERTE via skip() — pas de cap
-- silencieux (principe « no silent caps »).
--
-- ⚠ HORS supabase/tests/ À DESSEIN (cf. g9_semantic_oracle). Exécuté par le job
-- mode-rapport `integration-contracts` via psql -f.
-- =============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

-- ── Postcondition 1 — numérotation facture gapless sur DB réelle ──────────────
-- 3 attributions successives sur une série fraîche → exactement 1,2,3.
SELECT is(
  (
    SELECT array_agg(x ORDER BY x)
    FROM (
      SELECT plateforme.f_next_numero_facture('INTEG_CONTRACT_R0C', 2099::smallint) AS x
      FROM generate_series(1, 3)
    ) s
  ),
  ARRAY[1, 2, 3],
  'postcondition DB : f_next_numero_facture produit une séquence gapless 1,2,3'
);

-- L'état réel de la séquence reflète les 3 attributions (high-water mark = 3).
SELECT is(
  (SELECT dernier_numero FROM plateforme.sequences_facturation
   WHERE serie = 'INTEG_CONTRACT_R0C' AND annee = 2099),
  3,
  'postcondition DB : sequences_facturation.dernier_numero = 3 (état réel avancé)'
);

-- ── Postcondition 2 — ligne d'alerte réellement écrite en base ────────────────
SELECT lives_ok(
  $$ SELECT plateforme.f_upsert_alerte_admin(
       'integ_contract_test', 'Alerte test contrat', 'message', 'collecte',
       '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'f_upsert_alerte_admin s''exécute'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin
   WHERE code = 'integ_contract_test' AND statut = 'ouverte'),
  1,
  'postcondition DB : 1 ligne alertes_admin réellement écrite (pas un mock)'
);

-- Dédup : un 2e appel identique ne crée pas de doublon (toujours 1 ligne ouverte).
SELECT is(
  (
    WITH dup AS (
      SELECT plateforme.f_upsert_alerte_admin(
        'integ_contract_test', 'Alerte test contrat', 'message', 'collecte',
        '11111111-1111-1111-1111-111111111111'::uuid)
    )
    SELECT count(*)::int FROM plateforme.alertes_admin
    WHERE code = 'integ_contract_test' AND statut = 'ouverte'
  ),
  1,
  'postcondition DB : dédup alerte ouverte (toujours 1 ligne après 2e appel)'
);

-- ── Postcondition 3 — fichier sur R2 : NON COUVERTE en CI (reportée preprod) ──
SELECT skip(
  'R2/Storage non émulé en CI (décision Val 2026-06-24) — postcondition « fichier sur R2 » couverte en preprod/DEMO',
  1
);

SELECT * FROM finish();
ROLLBACK;
