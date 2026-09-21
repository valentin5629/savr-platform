-- =============================================================================
-- pgTAP — CLIQUET sur le prédicat de `plateforme.lieux_clients_select`
-- =============================================================================
-- POURQUOI CE TEST EXISTE.
--
-- L'autocomplétion Lieux du formulaire de programmation
-- (`GET /api/v1/programmation/lieux`) a DEUX chemins de lecture :
--
--   • rôle client  → lecture sous `authenticated` : la policy filtre, rien
--                    n'est transcrit côté route. Aucune divergence possible.
--   • admin support (`?organisation_id=`) → lecture en service_role : la RLS
--                    ne peut PAS servir ce cas (pour un admin la policy ne
--                    s'applique pas, `lieux_admin` rendrait TOUS les lieux au
--                    lieu du périmètre de l'organisation cible). Ce chemin
--                    transcrit donc les branches de la policy à la main.
--
-- Ce fichier est le garde-fou de cette transcription : il CASSE dès que le
-- prédicat de la policy change, pour forcer la question « le chemin admin de
-- /api/v1/programmation/lieux doit-il suivre ? ». Sans lui, une 5e branche
-- ajoutée à la policy s'appliquerait aux clients et pas à l'admin support, en
-- silence — exactement le défaut que ce lot corrige (la branche 4 « traiteur
-- opérationnel », livrée le 2026-09-21, n'atteignait pas l'autocomplétion).
--
-- QUE FAIRE SI CE TEST ROUGIT (dans l'ordre) :
--   1. Lire le nouveau prédicat :
--        SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
--         WHERE polname = 'lieux_clients_select';
--   2. Décider si la branche ajoutée/modifiée doit valoir aussi pour l'admin
--      support, et mettre à jour `lieuxDeLOrgCible()` dans
--      packages/plateforme/src/app/api/v1/programmation/lieux/route.ts
--      (+ son test Vitest) en conséquence. Une branche peut légitimement ne
--      PAS être transcrite — c'est le cas de « client organisateur ». Le bon
--      critère n'est PAS « la branche est gardée par un rôle absent d'ici » :
--      les policies de `evenements` sont PERMISSIVE, donc OR'ées, et son
--      sous-SELECT rend bel et bien des lignes pour certains rôles. Le critère
--      est : « tout lieu atteint par cette branche est-il déjà couvert par une
--      autre ? » (ici oui, par 1, 2 ou 4). À mesurer, jamais à déduire.
--   3. SEULEMENT ENSUITE, mettre à jour l'empreinte ci-dessous.
--   ⚠ Mettre à jour l'empreinte sans faire les étapes 1-2 vide ce test de
--     son sens : il ne resterait qu'un presse-bouton.
--
-- Ce test lit le catalogue : il ne dépend d'aucune fixture, et ne prouve rien
-- sur l'ÉTENDUE des accès — c'est `lieux_traiteur_operationnel.test.sql` qui
-- mesure ce que chaque rôle voit réellement, sous `authenticated`.
-- =============================================================================

BEGIN;
SELECT plan(6);

CREATE OR REPLACE FUNCTION test_qual_lieux_clients() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT pg_get_expr(pol.polqual, pol.polrelid)
    FROM pg_policy pol
    JOIN pg_class c     ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'plateforme'
     AND c.relname = 'lieux'
     AND pol.polname = 'lieux_clients_select'
$$;

-- ── 1. Nombre de branches ────────────────────────────────────────────────────
-- Chaque branche porte exactement un sous-SELECT. 4 aujourd'hui ; une 5e fait
-- rougir cet assert AVANT l'empreinte, avec un diagnostic lisible.
SELECT is(
  (length(test_qual_lieux_clients()) - length(replace(test_qual_lieux_clients(), 'SELECT', ''))) / 6,
  4,
  'CLIQUET 1/6 : la policy porte toujours 4 branches (1 sous-SELECT chacune)'
);

-- ── 2-5. Marqueurs distinctifs de chaque branche ─────────────────────────────
SELECT ok(
  test_qual_lieux_clients() LIKE '%organisations_lieux%',
  'CLIQUET 2/6 : branche 1 — lieu rattache a mon organisation'
);

SELECT ok(
  test_qual_lieux_clients() LIKE '%client_organisateur_organisation_id%'
    AND test_qual_lieux_clients() LIKE '%date_evenement IS NOT NULL%',
  'CLIQUET 3/6 : branche 3 — client organisateur, garde de date CONSERVEE'
);

SELECT ok(
  test_qual_lieux_clients() LIKE '%traiteur_operationnel_organisation_id%',
  'CLIQUET 4/6 : branche 4 — traiteur operationnel (transcrite cote admin support)'
);

SELECT ok(
  test_qual_lieux_clients() LIKE '%traiteur_manager%'
    AND test_qual_lieux_clients() LIKE '%traiteur_commercial%',
  'CLIQUET 5/6 : branche 4 — garde de role explicite (roles traiteur seulement)'
);

-- ── 6. Empreinte exacte ──────────────────────────────────────────────────────
-- Exhaustif : capture aussi les changements qu'aucun marqueur ci-dessus ne
-- verrait (garde retiree, operateur inverse, branche reformulee).
-- Deparse Postgres, donc stable a version majeure fixee (config.toml : 17).
SELECT is(
  md5(test_qual_lieux_clients()),
  '48ed53603f9368d3aa1cb06a421f4b3a',
  'CLIQUET 6/6 : prédicat inchangé — sinon, revoir le chemin admin support de /api/v1/programmation/lieux AVANT de mettre a jour cette empreinte'
);

SELECT * FROM finish();
ROLLBACK;
