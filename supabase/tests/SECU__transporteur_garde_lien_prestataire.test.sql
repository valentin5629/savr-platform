-- =============================================================================
-- Tests pgTAP — le lien transporteur → prestataire ne se défait pas sous des
-- collectes vivantes
-- Migration prouvée : 20260916100000_plateforme_transporteurs_garde_lien_prestataire
-- =============================================================================
-- Oracle : les tournées en cours ne sont rattachées à leur adapter QUE par
-- `transporteurs.prestataire_logistique_id` + `type_tms`. Changer l'un ou
-- l'autre (ou supprimer le transporteur) sous une collecte vivante rend ses
-- E2/E3 silencieuses (no-op `done`) ou rouvre la fuite inter-provider de #327.
--
-- Ce fichier prouve :
--   1. la forme : fonction SECURITY DEFINER, EXECUTE retiré, trigger branché ;
--   2. la FERMETURE sur les trois gestes (prestataire, type, DELETE) ;
--   3. chacune des DEUX voies de dépendance, isolée de l'autre — sinon l'une
--      pourrait disparaître sans qu'aucun test ne rougisse ;
--   4. la frontière « vivante » : `realisee` bloque encore, `cloturee` libère ;
--   5. la garde tient sous `authenticated` (claims ops_savr), le chemin
--      PostgREST réel — et malgré le REVOKE EXECUTE ;
--   6. l'absence de sur-fermeture : champs sans rapport, réécriture à
--      l'identique (ce que fait l'écran), premier rattachement.
-- =============================================================================
BEGIN;
SELECT plan(17);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Helpers JWT (cf. SECU__evenements_ecriture_client_fermee) ────────────────
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role, 'app_domain', 'plateforme'
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
-- `outbox_fixture_collecte` pose exactement le cas à protéger : une collecte
-- vivante, son prestataire, une tournée commandée chez lui, et le transporteur
-- MTS-1 qui le porte.
CREATE TEMP TABLE ctx ON COMMIT DROP AS
SELECT
  tests.outbox_fixture_collecte('ag')                                    AS collecte,
  NULL::uuid                                                             AS transp,
  NULL::uuid                                                             AS presta_a;
UPDATE ctx SET
  presta_a = (SELECT id FROM shared.prestataires WHERE code = 'FIXTURE_G4'),
  transp   = (SELECT t.id FROM plateforme.transporteurs t
                JOIN shared.prestataires p ON p.id = t.prestataire_logistique_id
               WHERE p.code = 'FIXTURE_G4');

-- Deux prestataires libres (aucun transporteur) : cibles d'un changement de lien.
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut)
VALUES
  ('d1000000-0000-0000-0000-0000000000b1', 'Presta Garde B', 'TEST-GARDE-B', ARRAY['ag'], 'manuel', 'actif'),
  ('d1000000-0000-0000-0000-0000000000c1', 'Presta Garde C', 'TEST-GARDE-C', ARRAY['ag'], 'manuel', 'actif');

GRANT SELECT ON ctx TO authenticated;

-- ─── 1-3. Forme ──────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'plateforme.fn_trg_garde_lien_prestataire_transporteur()'::regprocedure),
  'fonction SECURITY DEFINER (le décompte ne dépend pas des policies de l''appelant)'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.fn_trg_garde_lien_prestataire_transporteur()', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'plateforme.fn_trg_garde_lien_prestataire_transporteur()', 'EXECUTE'),
  'EXECUTE retiré à authenticated et anon (P0 #263)'
);

SELECT trigger_is(
  'plateforme', 'transporteurs', 'trg_garde_lien_prestataire_transporteur',
  'plateforme', 'fn_trg_garde_lien_prestataire_transporteur',
  'trigger branché sur plateforme.transporteurs'
);

-- ─── 4-6. Pas de sur-fermeture sous une collecte vivante ─────────────────────
SELECT lives_ok(
  format('UPDATE plateforme.transporteurs SET nom = nom || '' bis'', actif = false WHERE id = %L',
         (SELECT transp FROM ctx)),
  'champs sans rapport modifiables malgré une collecte vivante'
);

SELECT lives_ok(
  format('UPDATE plateforme.transporteurs
             SET type_tms = type_tms, prestataire_logistique_id = prestataire_logistique_id
           WHERE id = %L', (SELECT transp FROM ctx)),
  'réécriture à l''identique du type et du prestataire acceptée (l''écran renvoie tous les champs)'
);

SELECT lives_ok(
  $$INSERT INTO plateforme.transporteurs (
      nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
      contact_nom, contact_email, contact_telephone)
    VALUES ('Transporteur Garde Neuf', '999000077', '1 rue Test', '75001', 'Paris',
            ARRAY['fourgon'], 'autre', 'Test', 'garde@test.internal', '0600000000');
    UPDATE plateforme.transporteurs
       SET prestataire_logistique_id = 'd1000000-0000-0000-0000-0000000000c1'
     WHERE nom = 'Transporteur Garde Neuf';$$,
  'premier rattachement (NULL → prestataire) accepté'
);

-- ─── 7-9. Fermeture des trois gestes ─────────────────────────────────────────
SELECT throws_ok(
  format('UPDATE plateforme.transporteurs SET prestataire_logistique_id = %L WHERE id = %L',
         'd1000000-0000-0000-0000-0000000000b1', (SELECT transp FROM ctx)),
  '23001', NULL,
  'changement de prestataire REFUSÉ sous une collecte vivante'
);

SELECT throws_ok(
  format('UPDATE plateforme.transporteurs SET type_tms = %L WHERE id = %L',
         'a_toutes', (SELECT transp FROM ctx)),
  '23001', NULL,
  'changement de type_tms REFUSÉ (rouvrirait la fuite inter-provider #327)'
);

SELECT throws_ok(
  format('DELETE FROM plateforme.transporteurs WHERE id = %L', (SELECT transp FROM ctx)),
  '23001', NULL,
  'suppression du transporteur REFUSÉE sous une collecte vivante'
);

-- ─── 10. Sous authenticated / ops_savr : le chemin PostgREST réel ────────────
SELECT test_set_jwt('ops_savr');
SELECT throws_ok(
  format('UPDATE plateforme.transporteurs SET prestataire_logistique_id = %L WHERE id = %L',
         'd1000000-0000-0000-0000-0000000000b1', (SELECT transp FROM ctx)),
  '23001', NULL,
  'ops_savr via authenticated : REFUSÉ par la garde (ni ignoré, ni refusé par un droit)'
);
SELECT test_as_superuser();

-- ─── 11. Voie « tournée » SEULE ──────────────────────────────────────────────
-- Redispatch vers un autre prestataire (cas #327) : la collecte change de
-- prestataire, la tournée déjà commandée garde l'ancien.
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes
   SET prestataire_logistique_id = 'd1000000-0000-0000-0000-0000000000b1'
 WHERE id = (SELECT collecte FROM ctx);
SET LOCAL session_replication_role = origin;

SELECT throws_ok(
  format('UPDATE plateforme.transporteurs SET prestataire_logistique_id = %L WHERE id = %L',
         'd1000000-0000-0000-0000-0000000000b1', (SELECT transp FROM ctx)),
  '23001', NULL,
  'voie tournée seule : la tournée commandée chez l''ancien prestataire suffit à bloquer'
);

-- ─── 12. Voie « collecte » SEULE ─────────────────────────────────────────────
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes
   SET prestataire_logistique_id = (SELECT presta_a FROM ctx)
 WHERE id = (SELECT collecte FROM ctx);
DELETE FROM plateforme.collecte_tournees WHERE collecte_id = (SELECT collecte FROM ctx);
SET LOCAL session_replication_role = origin;

SELECT throws_ok(
  format('UPDATE plateforme.transporteurs SET prestataire_logistique_id = %L WHERE id = %L',
         'd1000000-0000-0000-0000-0000000000b1', (SELECT transp FROM ctx)),
  '23001', NULL,
  'voie collecte seule : une collecte routée vers ce prestataire, sans tournée, suffit à bloquer'
);

-- ─── 13-15. Frontière « vivante » ────────────────────────────────────────────
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes SET statut = 'realisee' WHERE id = (SELECT collecte FROM ctx);
SET LOCAL session_replication_role = origin;

SELECT throws_ok(
  format('UPDATE plateforme.transporteurs SET type_tms = %L WHERE id = %L',
         'a_toutes', (SELECT transp FROM ctx)),
  '23001', NULL,
  'realisee reste vivante (pesées rapprochées jusqu''à la clôture) : REFUSÉ'
);

SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes SET statut = 'cloturee' WHERE id = (SELECT collecte FROM ctx);
SET LOCAL session_replication_role = origin;

SELECT lives_ok(
  format('UPDATE plateforme.transporteurs SET prestataire_logistique_id = %L WHERE id = %L',
         'd1000000-0000-0000-0000-0000000000b1', (SELECT transp FROM ctx)),
  'collecte cloturee : plus rien ne dépend du lien, changement accepté'
);

SELECT is(
  (SELECT prestataire_logistique_id FROM plateforme.transporteurs WHERE id = (SELECT transp FROM ctx)),
  'd1000000-0000-0000-0000-0000000000b1'::uuid,
  'le changement accepté a bien été écrit (le lives_ok ne masquait pas un UPDATE à 0 ligne)'
);

-- ─── 16-17. Les deux autres statuts finaux ───────────────────────────────────
-- Le transporteur pointe maintenant B ; la collecte est rerattachée à B, puis
-- passée dans chacun des deux autres statuts finaux.
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes
   SET prestataire_logistique_id = 'd1000000-0000-0000-0000-0000000000b1', statut = 'annulee'
 WHERE id = (SELECT collecte FROM ctx);
SET LOCAL session_replication_role = origin;

SELECT lives_ok(
  format('UPDATE plateforme.transporteurs SET type_tms = %L WHERE id = %L',
         'a_toutes', (SELECT transp FROM ctx)),
  'collecte annulee : changement de type accepté'
);

SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes SET statut = 'rejetee_par_prestataire' WHERE id = (SELECT collecte FROM ctx);
SET LOCAL session_replication_role = origin;

SELECT lives_ok(
  format('UPDATE plateforme.transporteurs SET type_tms = %L WHERE id = %L',
         'autre', (SELECT transp FROM ctx)),
  'collecte rejetee_par_prestataire : changement de type accepté'
);

SELECT * FROM finish();
ROLLBACK;
