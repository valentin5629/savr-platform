-- =============================================================================
-- alertes_admin : le contenu d'une alerte n'est lisible que d'admin_savr
-- =============================================================================
-- Depuis le lot « emails en échec définitif » (décision Val 2026-10-08), l'alerte
-- `email_echec_definitif` cite l'adresse email du destinataire dans `message`
-- (packages/plateforme/src/lib/emails/email-perdu.ts). La fermeture de la table
-- — policy aa_admin, admin_savr seul — devient donc ce qui protège une donnée
-- personnelle.
--
-- Prouvée ici rôle par rôle, sous `authenticated` + claim `user_role` :
--   · admin_savr lit l'alerte et son message ;
--   · ops_savr NE la lit PAS — rôle interne, à qui `emails_envoyes` est fermée
--     pour la même raison (§09 A2bis). Le jour où l'écran Alertes lui serait
--     ouvert, ce cas rougit et force la décision sur l'adresse ;
--   · les cinq rôles clients, un JWT sans rôle et `anon` ne lisent rien ;
--   · la fonction qui écrit l'alerte (SECURITY DEFINER) n'est exécutable ni par
--     `authenticated` ni par `anon`.
-- Aucune migration dans ce lot : le test fige l'état existant.
-- =============================================================================

BEGIN;
SELECT plan(13);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Nombre d'alertes dont le message cite l'adresse, vu par le rôle courant.
CREATE OR REPLACE FUNCTION test_alertes_visibles() RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM plateforme.alertes_admin
   WHERE message LIKE '%contact@traiteur-secu.test%'
$$;

-- ─── Fixture : l'alerte telle que l'écrit le code (même fonction, mêmes champs) ─
SELECT plateforme.f_upsert_alerte_admin(
  'email_echec_definitif',
  'Email non remis',
  'L''email « collecte_programmee » destiné à contact@traiteur-secu.test n''a pas pu être envoyé après 4 tentatives.',
  'emails_envoyes',
  'ea000000-0000-0000-0000-0000000000a1'::uuid
);

-- ═══ 1. Non-vacuité ══════════════════════════════════════════════════════════
SELECT is(
  test_alertes_visibles(), 1,
  'Non-vacuité : l''alerte et son adresse existent (sous superuser)'
);

-- ═══ 2. admin_savr lit ═══════════════════════════════════════════════════════
SELECT test_set_jwt('admin_savr');
SELECT is(
  test_alertes_visibles(), 1,
  'admin_savr lit l''alerte et son message'
);

-- ═══ 3. ops_savr ne lit pas ══════════════════════════════════════════════════
SELECT test_set_jwt('ops_savr');
SELECT is(
  test_alertes_visibles(), 0,
  'ops_savr ne lit aucune alerte : l''adresse du destinataire ne lui parvient pas'
);
SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin), 0,
  'ops_savr : table entièrement invisible, pas seulement ce message'
);

-- ═══ 4. Rôles clients, JWT sans rôle ═════════════════════════════════════════
SELECT test_set_jwt('traiteur_manager', 'ea100000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(test_alertes_visibles(), 0, 'traiteur_manager ne lit aucune alerte');

SELECT test_set_jwt('traiteur_commercial', 'ea100000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(test_alertes_visibles(), 0, 'traiteur_commercial ne lit aucune alerte');

SELECT test_set_jwt('agence', 'ea100000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(test_alertes_visibles(), 0, 'agence ne lit aucune alerte');

SELECT test_set_jwt('gestionnaire_lieux', 'ea100000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(test_alertes_visibles(), 0, 'gestionnaire_lieux ne lit aucune alerte');

SELECT test_set_jwt('client_organisateur', 'ea100000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(test_alertes_visibles(), 0, 'client_organisateur ne lit aucune alerte');

SELECT test_set_jwt(NULL);
SELECT is(
  test_alertes_visibles(), 0,
  'JWT sans rôle applicatif : aucune alerte (fail-closed)'
);

-- ═══ 5. anon ═════════════════════════════════════════════════════════════════
SELECT test_as_superuser();
SELECT is(
  has_table_privilege('anon', 'plateforme.alertes_admin', 'SELECT'), false,
  'anon n''a pas le privilège SELECT sur alertes_admin'
);

-- ═══ 6. La fonction d'écriture n'est pas appelable par un client ═════════════
SELECT is(
  has_function_privilege(
    'authenticated',
    'plateforme.f_upsert_alerte_admin(text, text, text, text, uuid)',
    'EXECUTE'
  ), false,
  'authenticated ne peut pas exécuter f_upsert_alerte_admin (SECURITY DEFINER)'
);
SELECT is(
  has_function_privilege(
    'anon',
    'plateforme.f_upsert_alerte_admin(text, text, text, text, uuid)',
    'EXECUTE'
  ), false,
  'anon ne peut pas exécuter f_upsert_alerte_admin (SECURITY DEFINER)'
);

SELECT * FROM finish();
ROLLBACK;
