-- =============================================================================
-- Tests pgTAP — collectes : SELECT en liste blanche colonne-level
-- Migration prouvée : 20261117230000_plateforme_collectes_select_liste_blanche
-- =============================================================================
-- Fuite fermée (reviewer-rls-securite, 2026-09-22 ; re-mesurée le 2026-11-15) : via
-- col_select, tout rôle client qui voit une collecte en lisait par PostgREST direct
-- les 46 colonnes, dont trois réservées à l'équipe Savr : notes_internes,
-- motif_override_prestataire et aucun_repas_photo_url.
--
-- Fixture : une collecte AG « réalisée sans collecte » programmée par une AGENCE,
-- exécutée par un TRAITEUR opérationnel, sur le lieu d'un GESTIONNAIRE, pour un
-- CLIENT ORGANISATEUR doté d'un compte ; les 3 colonnes retirées renseignées.
--
-- NON-VACUITÉ (mesurée le 2026-11-17 sur une base rejouée depuis origin/main
-- 69babef3 SANS la migration) : 25 assertions tombent en `not ok` — 1-3, 9-12,
-- 14-17, 19-21, 23-25, 27-29, 33, 36, 48, 50 et 57 — et les 33 autres passent. Les
-- contrôles positifs (7, 13, 18, 22, 26, 47, 49 : « la ligne reste visible »)
-- prouvent que chaque refus vient du privilège colonne, pas d'une ligne invisible.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(58);

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
-- O = client organisateur ; X = traiteur sans lien (témoin de cloisonnement des lignes).
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('c5c50001-0000-0000-0000-0000000000c5'::uuid, 'C5 Traiteur', 'C5 Traiteur SAS', 'traiteur', '55550000000001', true),
  ('c5c50002-0000-0000-0000-0000000000c5'::uuid, 'C5 Agence', 'C5 Agence SAS', 'agence', '55550000000002', true),
  ('c5c50003-0000-0000-0000-0000000000c5'::uuid, 'C5 Gest', 'C5 Gest SA', 'gestionnaire_lieux', '55550000000003', true),
  ('c5c50004-0000-0000-0000-0000000000c5'::uuid, 'C5 Tiers', 'C5 Tiers SAS', 'traiteur', '55550000000004', true),
  ('c5c50005-0000-0000-0000-0000000000c5'::uuid, 'C5 Client', 'C5 Client SA', 'client_organisateur', '55550000000005', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('c5c5ef02-0000-0000-0000-0000000000c5'::uuid, 'c5c50002-0000-0000-0000-0000000000c5'::uuid,
        'C5 Agence SAS', '55550000000002', '2 rue Agence', '75002', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  ('c5c50a02-0000-0000-0000-0000000000c5'::uuid, 'c5c50002-0000-0000-0000-0000000000c5'::uuid,
   'prog@c5-agence.test', 'Prog', 'Agence', 'agence', true),
  ('c5c50a01-0000-0000-0000-0000000000c5'::uuid, 'c5c50001-0000-0000-0000-0000000000c5'::uuid,
   'com@c5-traiteur.test', 'Com', 'Traiteur', 'traiteur_commercial', true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('c5c51001-0000-0000-0000-0000000000c5'::uuid, 'C5 Lieu', '3 rue Lieu', '75003', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('c5c50003-0000-0000-0000-0000000000c5'::uuid, 'c5c51001-0000-0000-0000-0000000000c5'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('c5c57e01-0000-0000-0000-0000000000c5'::uuid, 'SECU_C5_COLLECTES', 'SECU C5 collectes', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, client_organisateur_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'c5c5e001-0000-0000-0000-0000000000c5'::uuid,
  'c5c50002-0000-0000-0000-0000000000c5'::uuid, 'c5c50001-0000-0000-0000-0000000000c5'::uuid,
  'c5c50005-0000-0000-0000-0000000000c5'::uuid,
  'c5c5ef02-0000-0000-0000-0000000000c5'::uuid, 'c5c50a02-0000-0000-0000-0000000000c5'::uuid,
  'c5c51001-0000-0000-0000-0000000000c5'::uuid, 'c5c57e01-0000-0000-0000-0000000000c5'::uuid,
  'C5 Gala', '2026-09-10', 300,
  'Contact C5', '0600000055'
);

INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande,
  aucun_repas_motif, aucun_repas_photo_url, notes_internes, motif_override_prestataire
) VALUES (
  'c5c5c001-0000-0000-0000-0000000000c5'::uuid, 'c5c5e001-0000-0000-0000-0000000000c5'::uuid,
  'anti_gaspi', 'realisee_sans_collecte', 'non_envoye', '2026-09-10', '23:00', 1,
  'Aucun excédent', 'https://preuve.test/c5-photo.jpg', 'NOTE EQUIPE C5', 'MOTIF PRESTATAIRE C5'
);

-- =============================================================================
-- 1-5 — Privilèges (structure) : table-level retiré, liste blanche exacte
-- =============================================================================
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.collectes', 'SELECT'),
  '1. authenticated n''a plus le SELECT TABLE-LEVEL sur collectes (sinon un REVOKE colonne serait inopérant)');

SELECT is(
  (SELECT array_agg(attname::text ORDER BY attname)
     FROM pg_attribute
    WHERE attrelid = 'plateforme.collectes'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('authenticated', attrelid, attnum, 'SELECT')),
  ARRAY['annulation_demandee_at', 'annulation_tardive', 'annulee_cote_savr', 'annulee_cote_savr_motif',
        'aucun_repas_motif', 'caps_appliques', 'co2_evite_kg', 'co2_facteurs_snapshot', 'co2_induit_kg',
        'co2_net_kg', 'collecte_remplacee_id', 'controle_acces_requis', 'created_at', 'date_collecte',
        'dirty_tms', 'energie_primaire_evitee_kwh', 'evenement_id', 'heure_collecte', 'heure_debut_reelle',
        'heure_fin_reelle', 'historique_partiel', 'id', 'incident_imputable_a', 'informations_completes',
        'informations_supplementaires', 'infos_acces_email_envoye_at', 'lieu_overrides', 'motif_incident',
        'nb_camions_demande', 'pack_antgaspi_id', 'pax', 'prestataire_logistique_id', 'realisee_at',
        'statut', 'statut_tms', 'statut_tms_at', 'taux_recyclage', 'tms_reference', 'type',
        'type_evenement_id', 'type_vehicule_souhaite', 'updated_at', 'volume_estime_repas'],
  '2. liste blanche SELECT authenticated EXACTE (43 colonnes : un ajout comme un retrait fait rougir)');

SELECT is(
  (SELECT array_agg(attname::text ORDER BY attname)
     FROM pg_attribute
    WHERE attrelid = 'plateforme.collectes'::regclass AND attnum > 0 AND NOT attisdropped
      AND NOT has_column_privilege('authenticated', attrelid, attnum, 'SELECT')),
  ARRAY['aucun_repas_photo_url', 'motif_override_prestataire', 'notes_internes'],
  '3. colonnes fermées à authenticated : exactement les 3 colonnes de l''équipe Savr');

SELECT is(
  (SELECT count(*)::int
     FROM pg_attribute
    WHERE attrelid = 'plateforme.collectes'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('anon', attrelid, attnum, 'SELECT')),
  0,
  '4. anon ne lit aucune colonne de collectes');

SELECT ok(
  has_table_privilege('service_role', 'plateforme.collectes', 'SELECT')
  AND NOT has_any_column_privilege('authenticated', 'plateforme.collectes', 'INSERT, UPDATE'),
  '5. service_role garde le SELECT table-level ; l''écriture reste fermée à authenticated (20260915140000)');

-- =============================================================================
-- 6 — Non-vacuité : la ligne existe et porte les 3 colonnes retirées renseignées
-- =============================================================================
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes
    WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'
      AND notes_internes IS NOT NULL AND motif_override_prestataire IS NOT NULL
      AND aucun_repas_photo_url IS NOT NULL),
  1,
  '6. non-vacuité (superuser) : la collecte existe, les 3 colonnes retirées sont renseignées');

-- =============================================================================
-- 7-12 — gestionnaire_lieux (collecte d'un tiers tenue sur son lieu)
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', 'c5c50003-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT aucun_repas_motif FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  'Aucun excédent',
  '7. gestionnaire : la ligne reste visible (col_select inchangée) — les refus 9-12 portent sur la colonne');

SELECT lives_ok(
  $$ SELECT id, evenement_id, type, prestataire_logistique_id, nb_camions_demande, statut,
            aucun_repas_motif, statut_tms, statut_tms_at, collecte_remplacee_id, motif_incident,
            incident_imputable_a, date_collecte, heure_collecte, heure_debut_reelle, heure_fin_reelle,
            volume_estime_repas, controle_acces_requis, informations_supplementaires, tms_reference,
            informations_completes, annulee_cote_savr, annulee_cote_savr_motif, dirty_tms,
            historique_partiel, taux_recyclage, caps_appliques, co2_induit_kg, co2_evite_kg, co2_net_kg,
            energie_primaire_evitee_kwh, co2_facteurs_snapshot, pack_antgaspi_id, lieu_overrides,
            realisee_at, created_at, updated_at, infos_acces_email_envoye_at, type_vehicule_souhaite,
            annulation_demandee_at, pax, type_evenement_id, annulation_tardive
       FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '8. gestionnaire : les 43 colonnes de la liste blanche se lisent ensemble');

SELECT throws_ok($$ SELECT notes_internes FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '9. gestionnaire : notes_internes illisible (permission denied)');
SELECT throws_ok($$ SELECT motif_override_prestataire FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '10. gestionnaire : motif_override_prestataire illisible');
SELECT throws_ok($$ SELECT aucun_repas_photo_url FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '11. gestionnaire : aucun_repas_photo_url illisible');
SELECT throws_ok($$ SELECT * FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '12. gestionnaire : SELECT * (PostgREST select=*) refusé');

-- =============================================================================
-- 13-17 — traiteur_manager (traiteur opérationnel d'un événement programmé par un tiers)
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', 'c5c50001-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT aucun_repas_motif FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  'Aucun excédent',
  '13. traiteur_manager : la ligne reste visible');
SELECT throws_ok($$ SELECT notes_internes FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '14. traiteur_manager : notes_internes illisible');
SELECT throws_ok($$ SELECT motif_override_prestataire FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '15. traiteur_manager : motif_override_prestataire illisible');
SELECT throws_ok($$ SELECT aucun_repas_photo_url FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '16. traiteur_manager : aucun_repas_photo_url illisible');
SELECT throws_ok(
  $$ SELECT c.notes_internes
       FROM plateforme.evenements e JOIN plateforme.collectes c ON c.evenement_id = e.id
      WHERE e.id = 'c5c5e001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '17. traiteur_manager : notes_internes illisible aussi par la jointure evenements → collectes');

-- =============================================================================
-- 18-21 — traiteur_commercial (même organisation que le traiteur opérationnel)
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_commercial', 'c5c50001-0000-0000-0000-0000000000c5'::uuid,
                         'c5c50a01-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT aucun_repas_motif FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  'Aucun excédent',
  '18. traiteur_commercial : la ligne reste visible');
SELECT throws_ok($$ SELECT notes_internes FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '19. traiteur_commercial : notes_internes illisible');
SELECT throws_ok($$ SELECT motif_override_prestataire FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '20. traiteur_commercial : motif_override_prestataire illisible');
SELECT throws_ok($$ SELECT aucun_repas_photo_url FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '21. traiteur_commercial : aucun_repas_photo_url illisible');

-- =============================================================================
-- 22-25 — agence programmatrice (propriétaire de l'événement)
-- =============================================================================
SELECT test_set_jwt_prod('agence', 'c5c50002-0000-0000-0000-0000000000c5'::uuid,
                         'c5c50a02-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT aucun_repas_motif FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  'Aucun excédent',
  '22. agence : la ligne reste visible');
SELECT throws_ok($$ SELECT notes_internes FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '23. agence : notes_internes illisible, même sur sa propre programmation');
SELECT throws_ok($$ SELECT motif_override_prestataire FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '24. agence : motif_override_prestataire illisible');
SELECT throws_ok($$ SELECT aucun_repas_photo_url FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '25. agence : aucun_repas_photo_url illisible');

-- =============================================================================
-- 26-29 — client organisateur
-- =============================================================================
SELECT test_set_jwt_prod('client_organisateur', 'c5c50005-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT aucun_repas_motif FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  'Aucun excédent',
  '26. client organisateur : la ligne reste visible');
SELECT throws_ok($$ SELECT notes_internes FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '27. client organisateur : notes_internes illisible');
SELECT throws_ok($$ SELECT motif_override_prestataire FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '28. client organisateur : motif_override_prestataire illisible');
SELECT throws_ok($$ SELECT aucun_repas_photo_url FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '29. client organisateur : aucun_repas_photo_url illisible');

-- =============================================================================
-- 30 — traiteur sans lien : cloisonnement des LIGNES inchangé
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', 'c5c50004-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  0,
  '30. traiteur sans lien : la collecte reste invisible (policies inchangées)');

-- =============================================================================
-- 31-35 — Vue du gestionnaire : interrogeable, photo rendue à NULL
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', 'c5c50003-0000-0000-0000-0000000000c5'::uuid);

SELECT lives_ok(
  $$ SELECT * FROM plateforme.v_collectes_gestionnaire_lieux
      WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '31. gestionnaire : v_collectes_gestionnaire_lieux se lit en entier (elle ne relit plus la photo)');

SELECT is(
  (SELECT aucun_repas_motif FROM plateforme.v_collectes_gestionnaire_lieux
    WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  'Aucun excédent',
  '32. gestionnaire : la vue rend toujours la ligne et le motif « aucun repas »');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_collectes_gestionnaire_lieux
    WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' AND aucun_repas_photo_url IS NULL),
  1,
  '33. gestionnaire : la vue rend aucun_repas_photo_url à NULL alors que la colonne est renseignée (cf. 6)');

SELECT test_as_superuser();

SELECT is(
  (SELECT string_agg(attname::text, ',' ORDER BY attnum)
     FROM pg_attribute
    WHERE attrelid = 'plateforme.v_collectes_gestionnaire_lieux'::regclass AND attnum > 0),
  'id,evenement_id,type,statut,statut_tms,statut_tms_at,prestataire_logistique_id,date_collecte,'
  || 'heure_collecte,heure_debut_reelle,heure_fin_reelle,volume_estime_repas,controle_acces_requis,'
  || 'informations_supplementaires,aucun_repas_motif,aucun_repas_photo_url,motif_incident,taux_recyclage,'
  || 'co2_induit_kg,co2_evite_kg,co2_net_kg,energie_primaire_evitee_kwh,realisee_at,created_at,updated_at',
  '34. la vue garde ses 25 colonnes, dans l''ordre (remplacement sans suppression)');

SELECT ok(
  (SELECT reloptions @> ARRAY['security_invoker=true']
     FROM pg_class WHERE oid = 'plateforme.v_collectes_gestionnaire_lieux'::regclass),
  '35. la vue reste security_invoker (elle lit collectes avec les droits de l''appelant, RLS comprise)');

-- =============================================================================
-- 36 — Aucune vue ne dépend plus d'une des 3 colonnes
-- =============================================================================
SELECT is(
  (SELECT count(DISTINCT r.ev_class)::int
     FROM pg_depend d
     JOIN pg_rewrite r ON r.oid = d.objid
     JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
    WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid = 'plateforme.collectes'::regclass
      AND a.attname IN ('notes_internes', 'motif_override_prestataire', 'aucun_repas_photo_url')),
  0,
  '36. aucune vue (droits de l''appelant ou du propriétaire) ne lit une des 3 colonnes retirées');

-- =============================================================================
-- 37-46 — Les lecteurs légitimes de collectes continuent de tourner
-- =============================================================================
-- Policies d'autres tables (sous-SELECT sur collectes) et vues security_invoker
-- relisent collectes avec les droits de l'APPELANT : une colonne qu'elles lisent,
-- sortie de la liste blanche, les ferait lever 42501. L'assertion 40 est un simple
-- témoin : v_registre_dechets tourne avec les droits de son propriétaire, elle ne
-- dépend pas du privilège colonne.
SELECT test_set_jwt_prod('gestionnaire_lieux', 'c5c50003-0000-0000-0000-0000000000c5'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements WHERE id = 'c5c5e001-0000-0000-0000-0000000000c5'),
  1,
  '37. gestionnaire : lit toujours l''événement (evt_gestionnaire_select → collectes.evenement_id / statut)');

SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.attestations_don $$,
  '38. gestionnaire : att_gestionnaire_select (collectes.id / evenement_id) tourne');

SELECT lives_ok(
  $$ SELECT * FROM plateforme.v_kpi_lieu LIMIT 1 $$,
  '39. gestionnaire : v_kpi_lieu (security_invoker) tourne');

SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.v_registre_dechets $$,
  '40. gestionnaire : v_registre_dechets (droits du propriétaire, témoin) tourne');

SELECT test_set_jwt_prod('traiteur_manager', 'c5c50001-0000-0000-0000-0000000000c5'::uuid);

SELECT lives_ok(
  $$ SELECT * FROM plateforme.v_kpi_traiteur LIMIT 1 $$,
  '41. traiteur : v_kpi_traiteur (security_invoker) tourne');

SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.bordereaux_savr $$,
  '42. traiteur : bord_traiteur_select et bord_collecte_visible_select tournent');

SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.attributions_antgaspi $$,
  '43. traiteur : aa_select (collectes.id / evenement_id) tourne');

SELECT test_set_jwt_prod('client_organisateur', 'c5c50005-0000-0000-0000-0000000000c5'::uuid);

SELECT lives_ok(
  $$ SELECT * FROM plateforme.v_kpi_client_organisateur LIMIT 1 $$,
  '44. client organisateur : v_kpi_client_organisateur (security_invoker) tourne');

SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.attestations_don $$,
  '45. client organisateur : att_client_orga_select tourne');

-- col_delete_brouillon s'évalue sous l'identité du client : un DELETE qui ne vise
-- aucune ligne suffit à faire vérifier les privilèges colonne du prédicat.
SELECT test_set_jwt_prod('agence', 'c5c50002-0000-0000-0000-0000000000c5'::uuid,
                         'c5c50a02-0000-0000-0000-0000000000c5'::uuid);

SELECT lives_ok(
  $$ DELETE FROM plateforme.collectes WHERE id = '00000000-0000-0000-0000-0000000000c5' $$,
  '46. agence : col_delete_brouillon (collectes.statut / evenement_id) tourne');

-- =============================================================================
-- 47-52 — staff et service_role
-- =============================================================================
SELECT test_set_jwt_prod('admin_savr', NULL);

SELECT is(
  (SELECT aucun_repas_motif FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  'Aucun excédent',
  '47. admin_savr (JWT) : la ligne reste visible');

-- Effet de bord ASSUMÉ et épinglé : le privilège est par rôle PG, admin_savr et
-- ops_savr portent `authenticated`. Le back-office lit collectes en service_role.
SELECT throws_ok($$ SELECT notes_internes FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '48. admin_savr (JWT, PostgREST direct) : notes_internes fermé aussi — le back-office lit en service_role');

SELECT test_set_jwt_prod('ops_savr', NULL);

SELECT is(
  (SELECT aucun_repas_motif FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  'Aucun excédent',
  '49. ops_savr (JWT) : la ligne reste visible');

SELECT throws_ok($$ SELECT aucun_repas_photo_url FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5' $$,
  '42501', NULL, '50. ops_savr (JWT, PostgREST direct) : aucun_repas_photo_url fermé aussi');

SELECT test_as_service_role();
SELECT is(
  (SELECT notes_internes || '|' || motif_override_prestataire || '|' || aucun_repas_photo_url
     FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  'NOTE EQUIPE C5|MOTIF PRESTATAIRE C5|https://preuve.test/c5-photo.jpg',
  '51. service_role : lit toujours les 3 colonnes retirées (back-office, adapters) — c''est par lui que l''équipe Savr les lit');

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes WHERE id = 'c5c5c001-0000-0000-0000-0000000000c5'),
  1,
  '52. service_role : la ligne est toujours là (aucune donnée touchée par la migration)');

-- =============================================================================
-- 53-56 — Fonctions : aucun détour ouvert à un client vers les 3 colonnes
-- =============================================================================
SELECT test_as_superuser();

-- fn_modifier_collecte rend la ligne ENTIÈRE (to_jsonb) : elle ne doit jamais être
-- appelable par l'API sous une identité cliente.
SELECT is(
  (SELECT count(*)::int FROM pg_proc
    WHERE pronamespace = 'plateforme'::regnamespace AND proname = 'fn_modifier_collecte'),
  1,
  '53. contrôle positif : fn_modifier_collecte existe en un exemplaire');

SELECT ok(
  NOT (SELECT bool_or(has_function_privilege('authenticated', oid, 'EXECUTE')
                      OR has_function_privilege('anon', oid, 'EXECUTE'))
         FROM pg_proc
        WHERE pronamespace = 'plateforme'::regnamespace AND proname = 'fn_modifier_collecte'),
  '54. fn_modifier_collecte (rend la ligne entière) n''est exécutable ni par authenticated ni par anon');

-- Détecteur par le texte du corps : il voit une lectrice connue (55) et ne trouve
-- aucune fonction ouverte à un client qui nomme une des 3 colonnes (56). Limites :
-- il ne voit ni le SQL dynamique, ni un corps SQL standard (BEGIN ATOMIC, texte vide).
SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc
           WHERE pronamespace = 'plateforme'::regnamespace AND proname = 'fn_modifier_collecte'
             AND prosrc ~* 'notes_internes|motif_override_prestataire|aucun_repas_photo_url'),
  '55. contrôle positif du détecteur : il voit fn_modifier_collecte comme lectrice des colonnes retirées');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p
    WHERE p.prosrc ~* 'notes_internes|motif_override_prestataire|aucun_repas_photo_url'
      AND p.prosrc ~* '\mcollectes\M'
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
           OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  0,
  '56. aucune fonction exécutable par authenticated ou anon ne nomme une des 3 colonnes de collectes');

-- =============================================================================
-- 57-58 — Fail-closed : une colonne ajoutée plus tard n'est pas lisible par défaut
-- =============================================================================
ALTER TABLE plateforme.collectes ADD COLUMN sonde_c5_fail_closed text;

SELECT ok(
  NOT has_column_privilege('authenticated', 'plateforme.collectes', 'sonde_c5_fail_closed', 'SELECT'),
  '57. fail-closed : une colonne ajoutée à collectes n''est pas lisible par authenticated');
SELECT ok(
  has_column_privilege('service_role', 'plateforme.collectes', 'sonde_c5_fail_closed', 'SELECT'),
  '58. contrôle positif de la sonde : service_role, lui, lit la nouvelle colonne (privilège table-level)');

SELECT * FROM finish();
ROLLBACK;
