-- =============================================================================
-- pgTAP — drapeau « modifiée sans renvoi » (`collectes.dirty_tms`)
-- =============================================================================
-- Scénario `M0.6/dirty_tms_apres_envoi` (couche db), arbitrage Val 2026-10-09 :
-- le drapeau s'arme dès que la demande est partie vers le prestataire (clic de
-- l'Admin), pour les champs de la collecte comme pour le pax et les contacts de
-- l'événement ; il ne s'arme pas avant l'envoi, ni pour une collecte terminée,
-- ni pour un autre événement, ni pour un champ hors de la liste ; le renvoi le
-- vide. Migration 20261009210000.
--
-- Sous rôle : les deux fonctions de modification appelées sous `service_role`
-- (le chemin des routes) arment le drapeau ; un client ne peut ni l'armer ni le
-- vider lui-même, et ne peut pas appeler la fonction du déclencheur.
-- =============================================================================

BEGIN;
SELECT plan(34);

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

-- ── Jeu d'essai ──────────────────────────────────────────────────────────────
-- La fixture rend une collecte « commandée » : prestataire posé ET une tournée
-- qui porte la commande chez lui. Elle ne s'appelle qu'une fois par transaction
-- (email utilisateur unique) : les autres collectes sont créées comme le fait
-- la programmation, sur le même événement ou sur un second.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT tests.outbox_fixture_collecte('zd') AS commandee,
       NULL::uuid AS evt, NULL::uuid AS presta,
       NULL::uuid AS en_file, NULL::uuid AS non_partie, NULL::uuid AS ag,
       NULL::uuid AS en_cours, NULL::uuid AS realisee, NULL::uuid AS cloturee,
       NULL::uuid AS terminee, NULL::uuid AS evt_temoin, NULL::uuid AS temoin;
UPDATE t SET (evt, presta) =
  (SELECT evenement_id, prestataire_logistique_id FROM plateforme.collectes WHERE id = t.commandee);

CREATE FUNCTION pg_temp.collecte(p_evt uuid, p_type text, p_jours int) RETURNS uuid LANGUAGE sql AS $$
  SELECT plateforme.fn_creer_collecte(
    p_evenement_id   := p_evt,
    p_type           := p_type,
    p_date_collecte  := CURRENT_DATE + p_jours,
    p_heure_collecte := '09:00'::time
  )
$$;
CREATE FUNCTION pg_temp.drapeau(p_id uuid) RETURNS boolean LANGUAGE sql AS
  $$ SELECT dirty_tms FROM plateforme.collectes WHERE id = p_id $$;
CREATE FUNCTION pg_temp.baisser() RETURNS void LANGUAGE sql AS
  $$ UPDATE plateforme.collectes SET dirty_tms = false WHERE dirty_tms $$;

-- « En file d'envoi » : l'Admin vient de cliquer, le prestataire est posé,
-- aucune commande n'existe encore chez lui — l'état exact du constat de Val.
UPDATE t SET en_file = pg_temp.collecte(evt, 'zd', 31);
UPDATE plateforme.collectes SET prestataire_logistique_id = (SELECT presta FROM t)
 WHERE id = (SELECT en_file FROM t);
-- Pas encore envoyées : aucun des quatre signaux.
UPDATE t SET non_partie = pg_temp.collecte(evt, 'zd', 32);
UPDATE t SET ag = pg_temp.collecte(evt, 'ag', 33);
-- Parties, à chacun des autres statuts : la commandée est validée par son
-- prestataire, une autre est en cours ; trois sont terminées (réalisée,
-- clôturée, annulée) et n'ont plus rien à renvoyer.
UPDATE plateforme.collectes SET statut = 'validee' WHERE id = (SELECT commandee FROM t);
UPDATE t SET en_cours = pg_temp.collecte(evt, 'zd', 36),
             realisee = pg_temp.collecte(evt, 'zd', 37),
             cloturee = pg_temp.collecte(evt, 'zd', 38),
             terminee = pg_temp.collecte(evt, 'zd', 34);
UPDATE plateforme.collectes c
   SET prestataire_logistique_id = (SELECT presta FROM t),
       statut = CASE c.id
         WHEN (SELECT en_cours FROM t) THEN 'en_cours'
         WHEN (SELECT realisee FROM t) THEN 'realisee'
         WHEN (SELECT cloturee FROM t) THEN 'cloturee'
         ELSE 'annulee'
       END::plateforme.collecte_statut
 WHERE c.id IN (SELECT unnest(ARRAY[en_cours, realisee, cloturee, terminee]) FROM t);
-- Un second événement, avec sa collecte en file : témoin du cloisonnement.
WITH e AS (
  INSERT INTO plateforme.evenements (
    organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
    lieu_id, created_by, type_evenement_id, nom_evenement, pax,
    contact_principal_nom, contact_principal_telephone, created_at, updated_at
  )
  SELECT organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
         lieu_id, created_by, type_evenement_id, 'Événement témoin', pax,
         contact_principal_nom, contact_principal_telephone, now(), now()
    FROM plateforme.evenements WHERE id = (SELECT evt FROM t)
  RETURNING id
)
UPDATE t SET evt_temoin = (SELECT id FROM e);
UPDATE t SET temoin = pg_temp.collecte(evt_temoin, 'zd', 35);
UPDATE plateforme.collectes SET prestataire_logistique_id = (SELECT presta FROM t)
 WHERE id = (SELECT temoin FROM t);
GRANT SELECT ON t TO authenticated, service_role;

SELECT is(
  (SELECT (c.statut_tms::text, c.tms_reference IS NULL, c.prestataire_logistique_id IS NOT NULL,
           plateforme.fn_collecte_commandee_chez_provider(c.id), c.dirty_tms)
     FROM plateforme.collectes c WHERE c.id = (SELECT en_file FROM t)),
  ('non_envoye'::text, true, true, false, false),
  'en file d''envoi : prestataire posé, statut TMS « non envoyé », ni référence ni commande, drapeau baissé'
);

-- ── Champs de la collecte, et renvoi ─────────────────────────────────────────
UPDATE plateforme.collectes SET date_collecte = date_collecte + 1
 WHERE id = (SELECT en_file FROM t);
SELECT ok(pg_temp.drapeau((SELECT en_file FROM t)),
  'en file d''envoi : changer la date arme le drapeau');
SELECT is(plateforme.fn_dispatcher_collecte((SELECT en_file FROM t)), 'collecte.creee',
  'en file d''envoi : le renvoi émet un ordre de création (aucune commande n''existe encore)');
SELECT ok(NOT pg_temp.drapeau((SELECT en_file FROM t)),
  'en file d''envoi : le renvoi vide le drapeau');

UPDATE plateforme.collectes SET heure_collecte = '10:30'
 WHERE id = (SELECT commandee FROM t);
SELECT ok(pg_temp.drapeau((SELECT commandee FROM t)),
  'commande existante : changer l''heure arme le drapeau');
SELECT is(plateforme.fn_dispatcher_collecte((SELECT commandee FROM t)), 'collecte.modifiee',
  'commande existante : le renvoi émet une modification');
SELECT ok(NOT pg_temp.drapeau((SELECT commandee FROM t)),
  'commande existante : le renvoi vide le drapeau');

-- ── Pax de l'événement : qui est armé, qui ne l'est pas ──────────────────────
UPDATE plateforme.evenements SET pax = pax + 10 WHERE id = (SELECT evt FROM t);
SELECT is(
  ARRAY[pg_temp.drapeau((SELECT en_file FROM t)), pg_temp.drapeau((SELECT commandee FROM t)), pg_temp.drapeau((SELECT en_cours FROM t))],
  ARRAY[true, true, true],
  'changer le pax arme les collectes de l''événement déjà parties et encore à réaliser (programmée, validée, en cours)');
SELECT ok(NOT pg_temp.drapeau((SELECT non_partie FROM t)) AND NOT pg_temp.drapeau((SELECT ag FROM t)),
  'changer le pax n''arme pas les collectes de l''événement pas encore envoyées');
SELECT is(
  ARRAY[pg_temp.drapeau((SELECT realisee FROM t)), pg_temp.drapeau((SELECT cloturee FROM t)), pg_temp.drapeau((SELECT terminee FROM t))],
  ARRAY[false, false, false],
  'changer le pax n''arme pas une collecte partie puis terminée (réalisée, clôturée, annulée)');
SELECT ok(NOT pg_temp.drapeau((SELECT temoin FROM t)),
  'changer le pax n''arme pas la collecte d''un autre événement');

-- ── Contacts : chacun des quatre champs ──────────────────────────────────────
SELECT pg_temp.baisser();
UPDATE plateforme.evenements SET contact_principal_nom = 'Autre Contact' WHERE id = (SELECT evt FROM t);
SELECT ok(pg_temp.drapeau((SELECT en_file FROM t)), 'changer le nom du contact arme le drapeau');

SELECT pg_temp.baisser();
UPDATE plateforme.evenements SET contact_principal_telephone = '0699990003' WHERE id = (SELECT evt FROM t);
SELECT ok(pg_temp.drapeau((SELECT en_file FROM t)), 'changer le téléphone du contact arme le drapeau');

SELECT pg_temp.baisser();
UPDATE plateforme.evenements SET contact_secours_nom = 'Secours Fixture' WHERE id = (SELECT evt FROM t);
SELECT ok(pg_temp.drapeau((SELECT en_file FROM t)), 'changer le nom du contact de secours arme le drapeau');

SELECT pg_temp.baisser();
UPDATE plateforme.evenements SET contact_secours_telephone = '0699990004' WHERE id = (SELECT evt FROM t);
SELECT ok(pg_temp.drapeau((SELECT en_file FROM t)), 'changer le téléphone du contact de secours arme le drapeau');

-- Hors de la liste : le nom et la référence de l'événement.
SELECT pg_temp.baisser();
UPDATE plateforme.evenements SET nom_evenement = 'Renommé', reference_affaire = 'A-42'
 WHERE id = (SELECT evt FROM t);
SELECT ok(NOT pg_temp.drapeau((SELECT en_file FROM t)),
  'renommer l''événement ou changer sa référence n''arme rien');

UPDATE plateforme.evenements SET pax = pax WHERE id = (SELECT evt FROM t);
SELECT ok(NOT pg_temp.drapeau((SELECT en_file FROM t)),
  'un pax renvoyé à l''identique n''arme rien');

-- ── Avant l'envoi : rien à renvoyer ──────────────────────────────────────────
UPDATE plateforme.collectes SET date_collecte = date_collecte + 1, heure_collecte = '11:00'
 WHERE id = (SELECT non_partie FROM t);
SELECT ok(NOT pg_temp.drapeau((SELECT non_partie FROM t)),
  'collecte pas encore envoyée : changer la date et l''heure n''arme rien');

-- « Partie » se lit sur l'état d'AVANT la modification : l'écriture qui pose le
-- prestataire et change la date en même temps modifie une collecte qui n'était
-- pas encore partie.
UPDATE plateforme.collectes
   SET prestataire_logistique_id = (SELECT presta FROM t), date_collecte = date_collecte + 1
 WHERE id = (SELECT non_partie FROM t);
SELECT ok(NOT pg_temp.drapeau((SELECT non_partie FROM t)),
  'poser le prestataire et changer la date dans la même écriture n''arme rien (signaux lus avant la modification)');

-- ── Chacun des autres signaux suffit, pour la collecte comme pour l'événement ─
-- Référence de commande seule (la collecte AG n'a ni prestataire ni attribution).
UPDATE plateforme.collectes SET tms_reference = 'CMD-FIXTURE' WHERE id = (SELECT ag FROM t);
UPDATE plateforme.collectes SET informations_supplementaires = 'Quai B' WHERE id = (SELECT ag FROM t);
SELECT ok(pg_temp.drapeau((SELECT ag FROM t)),
  'référence de commande seule : changer les informations supplémentaires arme le drapeau');
SELECT pg_temp.baisser();
UPDATE plateforme.evenements SET pax = pax + 1 WHERE id = (SELECT evt FROM t);
SELECT ok(pg_temp.drapeau((SELECT ag FROM t)),
  'référence de commande seule : changer le pax arme le drapeau');

-- Statut TMS sorti de « non envoyé », seul.
UPDATE plateforme.collectes
   SET tms_reference = NULL, dirty_tms = false, statut_tms = 'attribuee_en_attente_acceptation'
 WHERE id = (SELECT ag FROM t);
UPDATE plateforme.collectes SET controle_acces_requis = NOT controle_acces_requis
 WHERE id = (SELECT ag FROM t);
SELECT ok(pg_temp.drapeau((SELECT ag FROM t)),
  'statut TMS sorti de « non envoyé », seul : changer le contrôle d''accès arme le drapeau');
SELECT pg_temp.baisser();
UPDATE plateforme.evenements SET contact_principal_nom = 'Encore Autre' WHERE id = (SELECT evt FROM t);
SELECT ok(pg_temp.drapeau((SELECT ag FROM t)),
  'statut TMS sorti de « non envoyé », seul : changer le contact arme le drapeau');

-- Attribution AG seule (transporteur joint par mail ou téléphone, sans
-- prestataire relié) : la collecte est partie au sens de l'Admin.
UPDATE plateforme.collectes SET statut_tms = 'non_envoye', dirty_tms = false
 WHERE id = (SELECT ag FROM t);
UPDATE plateforme.collectes SET heure_collecte = '12:00' WHERE id = (SELECT ag FROM t);
SELECT ok(NOT pg_temp.drapeau((SELECT ag FROM t)),
  'AG sans attribution ni prestataire : changer l''heure n''arme rien');

INSERT INTO plateforme.associations (nom, adresse, region, ville, contact_email, description_rapport_impact)
VALUES ('Asso Fixture Drapeau', '1 rue Asso', 'idf', 'Paris', 'asso-drapeau@test.internal',
        'Association de test pour le drapeau « modifiée sans renvoi » — fixture pgTAP.');
INSERT INTO plateforme.attributions_antgaspi (
  collecte_id, association_id, transporteur_id, branche_attribution, mode_validation
) VALUES (
  (SELECT ag FROM t),
  (SELECT id FROM plateforme.associations WHERE contact_email = 'asso-drapeau@test.internal'),
  (SELECT id FROM plateforme.transporteurs WHERE code_transporteur_mts1 = 'FIXTURE-G4-CODE'),
  'branche_1', 'manuel_top1'
);
UPDATE plateforme.collectes SET heure_collecte = '13:00' WHERE id = (SELECT ag FROM t);
SELECT ok(pg_temp.drapeau((SELECT ag FROM t)),
  'AG attribuée, sans prestataire relié : changer l''heure arme le drapeau');
SELECT pg_temp.baisser();
UPDATE plateforme.evenements SET pax = pax + 5 WHERE id = (SELECT evt FROM t);
SELECT ok(pg_temp.drapeau((SELECT ag FROM t)),
  'AG attribuée, sans prestataire relié : changer le pax arme le drapeau');

-- Rien de tout cela n'a touché les collectes terminées ni l'autre événement.
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes
    WHERE dirty_tms AND id IN (SELECT unnest(ARRAY[realisee, cloturee, terminee, temoin]) FROM t)),
  0,
  'les collectes terminées et celle de l''autre événement sont restées intactes');

-- Le drapeau BRUT d'une collecte terminée peut encore être levé par une
-- modification de la collecte elle-même (déclencheur de `collectes`, inchangé
-- sur ce point) : c'est le prédicat de l'écran qui l'écarte.
UPDATE plateforme.collectes SET date_collecte = date_collecte + 1 WHERE id = (SELECT cloturee FROM t);
SELECT ok(pg_temp.drapeau((SELECT cloturee FROM t)),
  'collecte clôturée dont on corrige la date : drapeau brut levé (écarté à l''écran par le statut)');
UPDATE plateforme.collectes SET dirty_tms = false WHERE id = (SELECT cloturee FROM t);
SELECT ok(NOT pg_temp.drapeau((SELECT cloturee FROM t)),
  'remis à plat pour la suite');

-- ── Sous rôle : le chemin de l'application ───────────────────────────────────
-- Les UPDATE ci-dessus prouvent les déclencheurs. Les routes des espaces clients,
-- elles, n'écrivent que par ces deux fonctions, appelées sous `service_role`.
SELECT pg_temp.baisser();
SELECT set_config('role', 'service_role', true);
SELECT plateforme.fn_modifier_evenement(
  (SELECT evt FROM t),
  '{"contact_principal_telephone": "0699990005"}'::jsonb, ARRAY['contact_principal_telephone']);
SELECT test_as_superuser();
SELECT is(
  ARRAY[pg_temp.drapeau((SELECT en_file FROM t)), pg_temp.drapeau((SELECT temoin FROM t))],
  ARRAY[true, false],
  'service_role, fn_modifier_evenement (contact) : la collecte en file d''envoi est marquée, pas celle de l''autre événement');

SELECT pg_temp.baisser();
SELECT set_config('role', 'service_role', true);
SELECT plateforme.fn_modifier_collecte(
  (SELECT en_file FROM t),
  '{"heure_collecte": "14:00"}'::jsonb, ARRAY['heure_collecte']);
SELECT test_as_superuser();
SELECT ok(pg_temp.drapeau((SELECT en_file FROM t)),
  'service_role, fn_modifier_collecte (heure) : la collecte en file d''envoi est marquée');

-- ── Sous rôle : le drapeau n'est pas à la main du client ─────────────────────
SELECT pg_temp.baisser();
UPDATE plateforme.collectes SET dirty_tms = true WHERE id = (SELECT en_file FROM t);
SELECT test_set_jwt(
  'traiteur_manager',
  (SELECT e.organisation_id FROM plateforme.evenements e WHERE e.id = (SELECT evt FROM t))
);
SELECT throws_ok(
  $$UPDATE plateforme.collectes SET dirty_tms = false WHERE id = (SELECT en_file FROM t)$$,
  '42501', NULL,
  'traiteur_manager de l''organisation ne vide pas le drapeau lui-même');
SELECT throws_ok(
  $$SELECT plateforme.fn_evenement_marque_collectes_modifiees()$$,
  '42501', NULL,
  'traiteur_manager n''exécute pas la fonction du déclencheur');

SELECT test_as_superuser();
SELECT ok(pg_temp.drapeau((SELECT en_file FROM t)),
  'le drapeau n''a pas bougé');

SELECT * FROM finish();
ROLLBACK;
