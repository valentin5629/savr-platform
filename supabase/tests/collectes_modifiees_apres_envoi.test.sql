-- =============================================================================
-- pgTAP — drapeau « modifiée sans renvoi » (`collectes.dirty_tms`)
-- =============================================================================
-- Scénario `M0.6/dirty_tms_apres_envoi` (couche db), arbitrage Val 2026-10-09 :
-- le drapeau s'arme dès que la demande est partie vers le prestataire (clic de
-- l'Admin), pour les champs de la collecte comme pour le pax et les contacts de
-- l'événement ; il ne s'arme pas avant l'envoi, ni pour un champ qui n'est pas
-- transmis ; le renvoi le vide. Migration 20261009210000.
--
-- Sous rôle : un client ne peut ni armer ni vider le drapeau lui-même, et ne
-- peut pas appeler la fonction du déclencheur.
-- =============================================================================

BEGIN;
SELECT plan(19);

-- Helpers de rôle, signatures de rls_0_4_smoke.test.sql.
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'user_role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Une collecte « partie » : la fixture pose le prestataire, comme le fait le
-- clic de l'Admin ; le statut TMS reste « non envoyé » et aucune référence de
-- commande n'est reçue — l'état exact du constat de Val.
-- Deux autres collectes du même événement restent « pas encore envoyées » : une
-- ZD et une AG, créées comme le fait la programmation, sans prestataire.
CREATE TEMP TABLE t_ids ON COMMIT DROP AS
SELECT tests.outbox_fixture_collecte('zd') AS partie,
       NULL::uuid AS non_partie,
       NULL::uuid AS ag;
UPDATE t_ids SET non_partie = plateforme.fn_creer_collecte(
  p_evenement_id   := (SELECT evenement_id FROM plateforme.collectes WHERE id = t_ids.partie),
  p_type           := 'zd',
  p_date_collecte  := CURRENT_DATE + 31,
  p_heure_collecte := '09:00'::time
);
UPDATE t_ids SET ag = plateforme.fn_creer_collecte(
  p_evenement_id   := (SELECT evenement_id FROM plateforme.collectes WHERE id = t_ids.partie),
  p_type           := 'ag',
  p_date_collecte  := CURRENT_DATE + 32,
  p_heure_collecte := '09:00'::time
);
GRANT SELECT ON t_ids TO authenticated;

CREATE FUNCTION pg_temp.drapeau(p_id uuid) RETURNS boolean LANGUAGE sql AS
  $$ SELECT dirty_tms FROM plateforme.collectes WHERE id = p_id $$;
CREATE FUNCTION pg_temp.evenement(p_id uuid) RETURNS uuid LANGUAGE sql AS
  $$ SELECT evenement_id FROM plateforme.collectes WHERE id = p_id $$;

SELECT is(
  (SELECT (statut_tms::text, tms_reference IS NULL, prestataire_logistique_id IS NOT NULL, dirty_tms)
     FROM plateforme.collectes WHERE id = (SELECT partie FROM t_ids)),
  ('non_envoye'::text, true, true, false),
  'état de départ : prestataire posé, statut TMS « non envoyé », aucune référence, drapeau baissé'
);

-- ── Champs de la collecte ────────────────────────────────────────────────────
UPDATE plateforme.collectes SET date_collecte = date_collecte + 1
 WHERE id = (SELECT partie FROM t_ids);
SELECT ok(pg_temp.drapeau((SELECT partie FROM t_ids)),
  'collecte partie (prestataire posé, commande pas encore reçue) : changer la date arme le drapeau');

-- ── Renvoi ───────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$SELECT plateforme.fn_dispatcher_collecte((SELECT partie FROM t_ids))$$,
  'le renvoi (fn_dispatcher_collecte) passe');
SELECT ok(NOT pg_temp.drapeau((SELECT partie FROM t_ids)),
  'le renvoi vide le drapeau');

-- ── Pax et contacts de l'événement ───────────────────────────────────────────
UPDATE plateforme.evenements SET pax = pax + 10
 WHERE id = pg_temp.evenement((SELECT partie FROM t_ids));
SELECT ok(pg_temp.drapeau((SELECT partie FROM t_ids)),
  'collecte partie : changer le pax de l''événement arme le drapeau');
SELECT ok(NOT pg_temp.drapeau((SELECT non_partie FROM t_ids))
          AND NOT pg_temp.drapeau((SELECT ag FROM t_ids)),
  'les collectes du même événement pas encore envoyées ne sont pas armées par ce changement de pax');

UPDATE plateforme.collectes SET dirty_tms = false WHERE id = (SELECT partie FROM t_ids);
UPDATE plateforme.evenements SET contact_principal_telephone = '0699990003'
 WHERE id = pg_temp.evenement((SELECT partie FROM t_ids));
SELECT ok(pg_temp.drapeau((SELECT partie FROM t_ids)),
  'collecte partie : changer le téléphone du contact arme le drapeau');

UPDATE plateforme.collectes SET dirty_tms = false WHERE id = (SELECT partie FROM t_ids);
UPDATE plateforme.evenements SET contact_secours_nom = 'Secours Fixture'
 WHERE id = pg_temp.evenement((SELECT partie FROM t_ids));
SELECT ok(pg_temp.drapeau((SELECT partie FROM t_ids)),
  'collecte partie : changer le contact de secours arme le drapeau');

-- Un champ qui n'est pas transmis au prestataire ne demande aucun renvoi.
UPDATE plateforme.collectes SET dirty_tms = false WHERE id = (SELECT partie FROM t_ids);
UPDATE plateforme.evenements SET nom_evenement = 'Renommé', reference_affaire = 'A-42'
 WHERE id = pg_temp.evenement((SELECT partie FROM t_ids));
SELECT ok(NOT pg_temp.drapeau((SELECT partie FROM t_ids)),
  'collecte partie : renommer l''événement ou changer sa référence n''arme rien');

UPDATE plateforme.evenements SET pax = pax
 WHERE id = pg_temp.evenement((SELECT partie FROM t_ids));
SELECT ok(NOT pg_temp.drapeau((SELECT partie FROM t_ids)),
  'collecte partie : un pax renvoyé à l''identique n''arme rien');

-- ── Avant l'envoi : rien à renvoyer ──────────────────────────────────────────
UPDATE plateforme.collectes SET date_collecte = date_collecte + 1, heure_collecte = '11:00'
 WHERE id = (SELECT non_partie FROM t_ids);
SELECT ok(NOT pg_temp.drapeau((SELECT non_partie FROM t_ids)),
  'collecte pas encore envoyée : changer la date et l''heure n''arme rien');

-- ── Chacun des autres signaux suffit ─────────────────────────────────────────
-- Référence de commande reçue.
UPDATE plateforme.collectes SET tms_reference = 'CMD-FIXTURE'
 WHERE id = (SELECT non_partie FROM t_ids);
UPDATE plateforme.collectes SET informations_supplementaires = 'Quai B'
 WHERE id = (SELECT non_partie FROM t_ids);
SELECT ok(pg_temp.drapeau((SELECT non_partie FROM t_ids)),
  'référence de commande reçue : changer les informations supplémentaires arme le drapeau');

-- Statut TMS sorti de « non envoyé ».
UPDATE plateforme.collectes
   SET tms_reference = NULL, dirty_tms = false, statut_tms = 'attribuee_en_attente_acceptation'
 WHERE id = (SELECT non_partie FROM t_ids);
UPDATE plateforme.collectes SET controle_acces_requis = NOT controle_acces_requis
 WHERE id = (SELECT non_partie FROM t_ids);
SELECT ok(pg_temp.drapeau((SELECT non_partie FROM t_ids)),
  'statut TMS sorti de « non envoyé » : changer le contrôle d''accès arme le drapeau');

-- Attribution AG seule (transporteur joint par mail ou téléphone, sans
-- prestataire relié) : la collecte est partie au sens de l'Admin.
UPDATE plateforme.collectes SET heure_collecte = '12:00'
 WHERE id = (SELECT ag FROM t_ids);
SELECT ok(NOT pg_temp.drapeau((SELECT ag FROM t_ids)),
  'AG sans attribution ni prestataire : changer l''heure n''arme rien');

INSERT INTO plateforme.associations (nom, adresse, region, ville, contact_email, description_rapport_impact)
VALUES ('Asso Fixture Drapeau', '1 rue Asso', 'idf', 'Paris', 'asso-drapeau@test.internal',
        'Association de test pour le drapeau « modifiée sans renvoi » — fixture pgTAP.');
INSERT INTO plateforme.attributions_antgaspi (
  collecte_id, association_id, transporteur_id, branche_attribution, mode_validation
) VALUES (
  (SELECT ag FROM t_ids),
  (SELECT id FROM plateforme.associations WHERE contact_email = 'asso-drapeau@test.internal'),
  (SELECT id FROM plateforme.transporteurs WHERE code_transporteur_mts1 = 'FIXTURE-G4-CODE'),
  'branche_1', 'manuel_top1'
);
UPDATE plateforme.collectes SET heure_collecte = '13:00'
 WHERE id = (SELECT ag FROM t_ids);
SELECT ok(pg_temp.drapeau((SELECT ag FROM t_ids)),
  'AG attribuée, sans prestataire relié : changer l''heure arme le drapeau');

UPDATE plateforme.collectes SET dirty_tms = false WHERE id = (SELECT ag FROM t_ids);
UPDATE plateforme.evenements SET pax = pax + 5
 WHERE id = pg_temp.evenement((SELECT ag FROM t_ids));
SELECT ok(pg_temp.drapeau((SELECT ag FROM t_ids)),
  'AG attribuée, sans prestataire relié : changer le pax arme le drapeau');

-- ── Sous rôle : le drapeau n'est pas à la main du client ─────────────────────
UPDATE plateforme.collectes SET dirty_tms = true WHERE id = (SELECT partie FROM t_ids);
SELECT test_set_jwt(
  'traiteur_manager',
  (SELECT e.organisation_id FROM plateforme.evenements e
    WHERE e.id = pg_temp.evenement((SELECT partie FROM t_ids)))
);
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET dirty_tms = false WHERE id = (SELECT partie FROM t_ids)$$,
  '42501', NULL,
  'traiteur_manager de l''organisation ne vide pas le drapeau lui-même');
SELECT throws_ok(
  $$SELECT plateforme.fn_evenement_marque_collectes_modifiees()$$,
  '42501', NULL,
  'traiteur_manager n''exécute pas la fonction du déclencheur');

SELECT test_as_superuser();
SELECT ok(pg_temp.drapeau((SELECT partie FROM t_ids)),
  'le drapeau n''a pas bougé');

SELECT * FROM finish();
ROLLBACK;
