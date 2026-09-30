-- =============================================================================
-- Tests pgTAP — tournees : SELECT en liste blanche colonne-level (arbitrage C5)
-- Migration prouvée : 20260930160000_plateforme_tournees_select_liste_blanche
-- =============================================================================
-- Fuite fermée (reviewer-rls-securite, 2026-09-29) : via `t_select`, tout rôle client
-- qui voit une collecte lisait par PostgREST direct TOUTES les colonnes de ses
-- tournées, quel que soit le statut — un gestionnaire lisait chauffeur_telephone et
-- prestataire_logistique_id de la tournée d'un traiteur tiers servant son lieu.
--
-- Fixture = le cas mesuré : événement programmé par une AGENCE, exécuté par un
-- TRAITEUR opérationnel, sur le lieu d'un GESTIONNAIRE ; collecte CLÔTURÉE (la route
-- de la fiche ne sert plus le camion à ce statut, §06.04) ; tournée aux 10 colonnes
-- retirées toutes renseignées.
--
-- NON-VACUITÉ (mesurée sur base rejouée SANS la migration, 2026-09-30) : les
-- assertions de fermeture tombent en `not ok` (les SELECT passent). Les contrôles
-- positifs (7, 8, 20, 23, 27, 31) prouvent que chaque refus vient du privilège
-- colonne, pas d'une ligne invisible ni d'une fixture invalide.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(33);

-- Helpers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_set_jwt_prod(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', 'authenticated',
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

CREATE OR REPLACE FUNCTION test_as_service_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- Fixture ---------------------------------------------------------------------
-- A = agence programmatrice ; T = traiteur opérationnel ; G = gestionnaire du lieu L ;
-- X = traiteur sans lien (témoin de cloisonnement des lignes).
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('c5c50001-0000-0000-0000-0000000000c5'::uuid, 'C5 Traiteur', 'C5 Traiteur SAS', 'traiteur', '55520000000001', true),
  ('c5c50002-0000-0000-0000-0000000000c5'::uuid, 'C5 Agence', 'C5 Agence SAS', 'agence', '55520000000002', true),
  ('c5c50003-0000-0000-0000-0000000000c5'::uuid, 'C5 Gest', 'C5 Gest SA', 'gestionnaire_lieux', '55520000000003', true),
  ('c5c50004-0000-0000-0000-0000000000c5'::uuid, 'C5 Tiers', 'C5 Tiers SAS', 'traiteur', '55520000000004', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('c5c5ef02-0000-0000-0000-0000000000c5'::uuid, 'c5c50002-0000-0000-0000-0000000000c5'::uuid,
        'C5 Agence SAS', '55520000000002', '2 rue Agence', '75002', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES ('c5c50a02-0000-0000-0000-0000000000c5'::uuid, 'c5c50002-0000-0000-0000-0000000000c5'::uuid,
        'prog@c5-agence.test', 'Prog', 'Agence', 'agence', true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('c5c51001-0000-0000-0000-0000000000c5'::uuid, 'C5 Lieu', '3 rue Lieu', '75003', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('c5c50003-0000-0000-0000-0000000000c5'::uuid, 'c5c51001-0000-0000-0000-0000000000c5'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('c5c57e01-0000-0000-0000-0000000000c5'::uuid, 'SECU_C5_TOURNEES', 'SECU C5 tournées', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by,
  lieu_id, type_evenement_id, nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'c5c5e001-0000-0000-0000-0000000000c5'::uuid,
  'c5c50002-0000-0000-0000-0000000000c5'::uuid, 'c5c50001-0000-0000-0000-0000000000c5'::uuid,
  'c5c5ef02-0000-0000-0000-0000000000c5'::uuid, 'c5c50a02-0000-0000-0000-0000000000c5'::uuid,
  'c5c51001-0000-0000-0000-0000000000c5'::uuid, 'c5c57e01-0000-0000-0000-0000000000c5'::uuid,
  'C5 Gala', '2026-09-10', 300, 'Contact', '0600000055'
);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('c5c5c001-0000-0000-0000-0000000000c5'::uuid, 'c5c5e001-0000-0000-0000-0000000000c5'::uuid,
        'zero_dechet', 'cloturee', 'non_envoye', '2026-09-10', '23:00', 1);

INSERT INTO shared.prestataires (id, nom, code)
VALUES ('c5c59a01-0000-0000-0000-0000000000c5'::uuid, 'C5 Presta', 'c5-presta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.tournees (
  id, reference_interne, date_tournee, creneau, prestataire_logistique_id, type_vehicule, statut,
  plaque_immatriculation, plaque_saisie_at, chauffeur_nom, chauffeur_telephone,
  accompagnant_nom, accompagnant_telephone, tms_reference, external_ref_commande, notes_internes
) VALUES (
  'c5c57001-0000-0000-0000-0000000000c5'::uuid, 'TRN-C5-0001', '2026-09-10', 'nuit',
  'c5c59a01-0000-0000-0000-0000000000c5'::uuid, 'camionnette', 'terminee',
  'C5-000-AA', now(), 'Chauffeur C5', '0655555555',
  'Accompagnant C5', '0644444444', 'TOUR-C5', 'CMD-C5', 'NOTE OPS C5'
);

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang)
VALUES ('c5c5c001-0000-0000-0000-0000000000c5'::uuid, 'c5c57001-0000-0000-0000-0000000000c5'::uuid, 1);

-- =============================================================================
-- 1-6 — Privilèges (structure) : table-level retiré, liste blanche exacte
-- =============================================================================
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.tournees', 'SELECT'),
  '1. authenticated n''a plus le SELECT TABLE-LEVEL sur tournees (sinon un REVOKE colonne serait inopérant)');

SELECT is(
  (SELECT array_agg(attname::text ORDER BY attname)
     FROM pg_attribute
    WHERE attrelid = 'plateforme.tournees'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('authenticated', attrelid, attnum, 'SELECT')),
  ARRAY['created_at', 'creneau', 'date_tournee', 'heure_debut_prevue', 'heure_debut_reelle',
        'heure_fin_prevue', 'heure_fin_reelle', 'id', 'reference_interne', 'statut',
        'type_vehicule', 'updated_at'],
  '2. liste blanche SELECT authenticated EXACTE (12 colonnes : un ajout comme un retrait fait rougir)');

SELECT is(
  (SELECT count(*)::int
     FROM pg_attribute
    WHERE attrelid = 'plateforme.tournees'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('anon', attrelid, attnum, 'SELECT')),
  0,
  '3. anon ne lit aucune colonne de tournees');

SELECT ok(
  has_table_privilege('service_role', 'plateforme.tournees', 'SELECT'),
  '4. service_role garde le SELECT table-level (routes admin, fiche client, adapters, batch PDF)');

SELECT ok(
  (SELECT prosecdef AND proconfig = ARRAY['search_path=plateforme, pg_catalog']
     FROM pg_proc WHERE oid = 'plateforme.fn_cloturer_alerte_coordonnees_urgence()'::regprocedure),
  '5. trigger de clôture urgence : SECURITY DEFINER, search_path épinglé (plateforme, pg_catalog)');

SELECT is(
  (SELECT array_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                    ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END)
     FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = 'plateforme.fn_cloturer_alerte_coordonnees_urgence()'::regprocedure
      AND a.privilege_type = 'EXECUTE'),
  ARRAY['postgres', 'service_role'],
  '6. trigger de clôture urgence : EXECUTE à postgres + service_role seuls (ni PUBLIC, ni anon, ni authenticated)');

-- 32-33 (fin de fichier) : colonne ajoutée demain = non lisible (fail-closed).

-- =============================================================================
-- 7 — Non-vacuité : la ligne existe et porte les 10 colonnes retirées renseignées
-- =============================================================================
SELECT is(
  (SELECT count(*)::int FROM plateforme.tournees
    WHERE id = 'c5c57001-0000-0000-0000-0000000000c5'
      AND prestataire_logistique_id IS NOT NULL AND plaque_immatriculation IS NOT NULL
      AND plaque_saisie_at IS NOT NULL AND chauffeur_nom IS NOT NULL
      AND chauffeur_telephone IS NOT NULL AND accompagnant_nom IS NOT NULL
      AND accompagnant_telephone IS NOT NULL AND tms_reference IS NOT NULL
      AND external_ref_commande IS NOT NULL AND notes_internes IS NOT NULL),
  1,
  '7. non-vacuité (superuser) : la tournée existe, les 10 colonnes retirées sont renseignées');

-- =============================================================================
-- 8-19 — gestionnaire_lieux (tournée d'un traiteur tiers servant son lieu) : le cas mesuré
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', 'c5c50003-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT statut::text FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5'),
  'terminee',
  '8. gestionnaire : la ligne reste visible (t_select inchangée) — les refus 9-19 portent sur la colonne');

SELECT throws_ok($$ SELECT chauffeur_telephone FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '9. gestionnaire : chauffeur_telephone illisible (permission denied)');
SELECT throws_ok($$ SELECT chauffeur_nom FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '10. gestionnaire : chauffeur_nom illisible');
SELECT throws_ok($$ SELECT accompagnant_nom FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '11. gestionnaire : accompagnant_nom illisible');
SELECT throws_ok($$ SELECT accompagnant_telephone FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '12. gestionnaire : accompagnant_telephone illisible');
SELECT throws_ok($$ SELECT plaque_immatriculation FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '13. gestionnaire : plaque_immatriculation illisible');
SELECT throws_ok($$ SELECT plaque_saisie_at FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '14. gestionnaire : plaque_saisie_at illisible');
SELECT throws_ok($$ SELECT prestataire_logistique_id FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '15. gestionnaire : prestataire_logistique_id illisible (marque blanche)');
SELECT throws_ok($$ SELECT tms_reference FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '16. gestionnaire : tms_reference illisible');
SELECT throws_ok($$ SELECT external_ref_commande FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '17. gestionnaire : external_ref_commande illisible');
SELECT throws_ok($$ SELECT notes_internes FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '18. gestionnaire : notes_internes illisible');
SELECT throws_ok($$ SELECT * FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '19. gestionnaire : SELECT * (PostgREST select=*) refusé');

-- =============================================================================
-- 20-22 — traiteur opérationnel (traiteur_manager)
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', 'c5c50001-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT statut::text FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5'),
  'terminee',
  '20. traiteur opérationnel : la ligne reste visible');
SELECT throws_ok($$ SELECT chauffeur_telephone FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '21. traiteur opérationnel : chauffeur_telephone illisible en direct (servi par la route, fenêtre de statut)');
SELECT throws_ok(
  $$ SELECT t.prestataire_logistique_id
       FROM plateforme.collecte_tournees ct JOIN plateforme.tournees t ON t.id = ct.tournee_id
      WHERE ct.collecte_id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '22. traiteur opérationnel : prestataire illisible par l''embed collecte_tournees → tournees');

-- =============================================================================
-- 23-25 — agence programmatrice
-- =============================================================================
SELECT test_set_jwt_prod('agence', 'c5c50002-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT statut::text FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5'),
  'terminee',
  '23. agence : la ligne reste visible');
SELECT throws_ok($$ SELECT chauffeur_telephone FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '24. agence : chauffeur_telephone illisible');
SELECT throws_ok($$ SELECT external_ref_commande FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '25. agence : external_ref_commande illisible');

-- =============================================================================
-- 26 — traiteur sans lien : cloisonnement des LIGNES inchangé
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', 'c5c50004-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5'),
  0,
  '26. traiteur sans lien : la tournée reste invisible (t_select inchangée)');

-- =============================================================================
-- 27-31 — staff et service_role
-- =============================================================================
SELECT test_set_jwt_prod('admin_savr', NULL);

SELECT is(
  (SELECT statut::text FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5'),
  'terminee',
  '27. admin_savr (JWT) : la ligne reste visible');

-- Effet de bord ASSUMÉ et épinglé : le privilège est par rôle PG, admin_savr porte
-- `authenticated`. Le back-office lit tournees en service_role (aucun écran impacté).
SELECT throws_ok($$ SELECT chauffeur_telephone FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '28. admin_savr (JWT, PostgREST direct) : chauffeur_telephone fermé aussi — le back-office lit en service_role');

-- L'écriture admin sous JWT (t_admin FOR ALL) survit : le trigger de clôture relit
-- les coordonnées en SECURITY DEFINER, plus avec les privilèges de l'écrivain.
SELECT lives_ok(
  $$ UPDATE plateforme.tournees SET chauffeur_telephone = '0633333333'
      WHERE id = 'c5c57001-0000-0000-0000-0000000000c5' $$,
  '29. admin_savr (JWT) : UPDATE des coordonnées toujours possible (trigger de clôture en DEFINER)');

SELECT test_as_superuser();
SELECT is(
  (SELECT chauffeur_telephone FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5'),
  '0633333333',
  '30. l''UPDATE admin a bien été écrit (pas filtré en silence par la RLS)');

SELECT test_as_service_role();
SELECT is(
  (SELECT chauffeur_telephone || '|' || prestataire_logistique_id::text || '|' || notes_internes
     FROM plateforme.tournees WHERE id = 'c5c57001-0000-0000-0000-0000000000c5'),
  '0633333333|c5c59a01-0000-0000-0000-0000000000c5|NOTE OPS C5',
  '31. service_role : lit toujours les colonnes retirées (routes admin, fiche client, adapters)');

-- =============================================================================
-- 32-33 — Fail-closed : une colonne ajoutée plus tard n'est pas lisible par défaut
-- =============================================================================
SELECT test_as_superuser();
ALTER TABLE plateforme.tournees ADD COLUMN sonde_c5_fail_closed text;

SELECT ok(
  NOT has_column_privilege('authenticated', 'plateforme.tournees', 'sonde_c5_fail_closed', 'SELECT'),
  '32. fail-closed : une colonne ajoutée à tournees n''est pas lisible par authenticated');
SELECT ok(
  has_column_privilege('service_role', 'plateforme.tournees', 'sonde_c5_fail_closed', 'SELECT'),
  '33. contrôle positif de la sonde : service_role, lui, lit la nouvelle colonne (privilège table-level)');

SELECT * FROM finish();
ROLLBACK;
