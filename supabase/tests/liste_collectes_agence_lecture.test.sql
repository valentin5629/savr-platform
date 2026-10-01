-- =============================================================================
-- Liste Collectes agence : lecture des résultats sous RLS + cloisonnement
-- Routes : GET /api/v1/agence/collectes (+ /filtres), export CSV collectes
-- =============================================================================
-- Revue écran E2E 2026-09-30 : la liste agence est désormais la liste traiteur
-- (§06.11 = §06.04 §3). Elle affiche les résultats de la collecte réalisée,
-- lus sous l'identité de l'agence via les embeds `collecte_flux` (poids ZD) et
-- `attributions_antgaspi` (repas AG). Aucune policy n'est créée : ce fichier
-- VERROUILLE les branches « agence donneuse d'ordre » existantes dont la route
-- dépend désormais — si une migration resserrait `cf_select` / `aa_select`, la
-- liste afficherait 0 kg / 0 repas sans erreur ; si elle les élargissait, une
-- agence lirait les résultats d'une autre.
--
-- La fonction test_liste_agence reproduit la forme PostgREST de la route
-- (collectes + sous-requêtes des embeds + evenements!inner) et ses filtres
-- (lieu, client, programmée par — ce dernier côté export).
--   V1-V2  non-vacuité : les lignes de l'agence B existent (superuser) ;
--   R0     exécution sous le rôle authenticated ;
--   A1-A3  l'agence A liste ses 2 collectes et lit ses résultats (11 kg, 40 repas) ;
--   A4-A8  résultats / collectes de B refusés, en accès direct et par balayage ;
--   A9-A12 les filtres ne font que restreindre (lieu, client, programmée par) ;
--   A13-A15 options de filtres : lieu, client, événement de B jamais visibles ;
--   B1-B3  symétrie pour l'agence B ;
--   T1     traiteur opérationnel : programmée par ne dépasse pas sa RLS ;
--   N1-N2  agence sans organisation_id : rien (fail-closed).
--
-- JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(24);

CREATE OR REPLACE FUNCTION test_set_jwt_prod(p_role text, p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(), 'role', 'authenticated', 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Forme PostgREST de la liste : chaque embed est une sous-requête soumise à SA
-- propre RLS ; evenements!inner = jointure soumise à la RLS evenements.
CREATE OR REPLACE FUNCTION test_liste_agence(
  p_lieu uuid DEFAULT NULL,
  p_client text DEFAULT NULL,
  p_prog uuid[] DEFAULT NULL)
RETURNS TABLE(id uuid, poids numeric, repas numeric, client text)
LANGUAGE sql AS $$
  SELECT c.id,
    (SELECT coalesce(sum(cf.poids_reel_kg), 0)
       FROM plateforme.collecte_flux cf WHERE cf.collecte_id = c.id),
    (SELECT coalesce(sum(a.volume_repas_realise), 0)
       FROM plateforme.attributions_antgaspi a WHERE a.collecte_id = c.id),
    e.nom_client_organisateur
  FROM plateforme.collectes c
  JOIN LATERAL (
    SELECT ev.* FROM plateforme.evenements ev
     WHERE ev.id = c.evenement_id
       AND (p_lieu IS NULL OR ev.lieu_id = p_lieu)
       AND (p_client IS NULL OR ev.nom_client_organisateur = p_client)
       AND (p_prog IS NULL OR ev.organisation_id = ANY (p_prog))
  ) e ON true
$$;
GRANT EXECUTE ON FUNCTION test_set_jwt_prod(text, uuid), test_as_superuser(),
  test_liste_agence(uuid, text, uuid[]) TO authenticated;

-- Fixture : agences A et B, même traiteur opérationnel T ; chacune une collecte
-- ZD clôturée (A 11 kg / B 777 kg) et une collecte AG (A 40 / B 999 repas).
SELECT test_as_superuser();
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, est_shadow) VALUES
  ('e2e33000-0000-0000-0000-0000000000a1', 'Agence A', 'Agence A SAS', 'agence', NULL, true, false),
  ('e2e33000-0000-0000-0000-0000000000a2', 'Agence B', 'Agence B SAS', 'agence', NULL, true, false),
  ('e2e33000-0000-0000-0000-0000000000b1', 'Traiteur T', 'Traiteur T SARL', 'traiteur', NULL, true, false);
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('e2e33000-0000-0000-0000-0000000000d1', 'e2e33000-0000-0000-0000-0000000000a1', 'a@e2e33.test', 'A', 'A', 'agence'),
  ('e2e33000-0000-0000-0000-0000000000d2', 'e2e33000-0000-0000-0000-0000000000a2', 'b@e2e33.test', 'B', 'B', 'agence');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('e2e33000-0000-0000-0000-0000000000e1', 'e2e33000-0000-0000-0000-0000000000a1', 'Agence A SAS', '99999999900009', '1 rue A', '75001', 'Paris'),
  ('e2e33000-0000-0000-0000-0000000000e4', 'e2e33000-0000-0000-0000-0000000000a2', 'Agence B SAS', '99999999900017', '1 rue B', '75001', 'Paris');
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
  ('e2e33000-0000-0000-0000-0000000000e2', 'Lieu A', '1 av A', '75008', 'Paris', 'camionnette', 48.86, 2.31, 'idf'),
  ('e2e33000-0000-0000-0000-0000000000e5', 'Lieu SECRET B', '2 av B', '75009', 'Paris', 'camionnette', 48.87, 2.33, 'idf');
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('e2e33000-0000-0000-0000-0000000000e3', 'GALA_E2E33', 'Gala E2E33', 1, true);
INSERT INTO plateforme.evenements (id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax, nom_client_organisateur,
  contact_principal_nom, contact_principal_telephone) VALUES
  ('e2e33000-0000-0000-0000-0000000000f1', 'e2e33000-0000-0000-0000-0000000000a1', 'e2e33000-0000-0000-0000-0000000000b1',
   'e2e33000-0000-0000-0000-0000000000e1', 'e2e33000-0000-0000-0000-0000000000d1', 'e2e33000-0000-0000-0000-0000000000e2',
   'e2e33000-0000-0000-0000-0000000000e3', 'Gala A', CURRENT_DATE, 300, 'Client A', 'Contact', '0600000000'),
  ('e2e33000-0000-0000-0000-0000000000f2', 'e2e33000-0000-0000-0000-0000000000a2', 'e2e33000-0000-0000-0000-0000000000b1',
   'e2e33000-0000-0000-0000-0000000000e4', 'e2e33000-0000-0000-0000-0000000000d2', 'e2e33000-0000-0000-0000-0000000000e5',
   'e2e33000-0000-0000-0000-0000000000e3', 'Gala B', CURRENT_DATE, 200, 'Client SECRET B', 'Contact', '0611111111');
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte) VALUES
  ('e2e33000-0000-0000-0000-00000000c0a1', 'e2e33000-0000-0000-0000-0000000000f1', 'zero_dechet', 'cloturee', 'non_envoye', CURRENT_DATE, '06:00'),
  ('e2e33000-0000-0000-0000-00000000c0a2', 'e2e33000-0000-0000-0000-0000000000f1', 'anti_gaspi', 'programmee', 'non_envoye', CURRENT_DATE + 10, '10:00'),
  ('e2e33000-0000-0000-0000-00000000c0b1', 'e2e33000-0000-0000-0000-0000000000f2', 'zero_dechet', 'cloturee', 'non_envoye', CURRENT_DATE, '06:00'),
  ('e2e33000-0000-0000-0000-00000000c0b2', 'e2e33000-0000-0000-0000-0000000000f2', 'anti_gaspi', 'programmee', 'non_envoye', CURRENT_DATE + 10, '10:00');
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
  SELECT x.cid, fd.id, x.kg FROM (VALUES
    ('e2e33000-0000-0000-0000-00000000c0a1'::uuid, 11::numeric),
    ('e2e33000-0000-0000-0000-00000000c0b1'::uuid, 777::numeric)) x(cid, kg)
  CROSS JOIN (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet' LIMIT 1) fd
ON CONFLICT (collecte_id, flux_id) DO UPDATE SET poids_reel_kg = EXCLUDED.poids_reel_kg;
INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact)
VALUES ('e2e33000-0000-0000-0000-0000000005a1', 'Asso E2E33', '1 rue', 'idf', 'Paris', 'asso@e2e33.test',
        'Association de test pour les tests pgTAP RLS.');
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
  contact_nom, contact_email, contact_telephone)
VALUES ('e2e33000-0000-0000-0000-0000000007a1', 'Transp E2E33', '123456789', '1 rue', '75001', 'Paris',
        ARRAY['fourgon'], 'autre', 'C', 't@e2e33.test', '0601010101');
INSERT INTO plateforme.attributions_antgaspi (id, collecte_id, association_id, transporteur_id,
  branche_attribution, mode_validation, volume_repas_realise) VALUES
  ('e2e33000-0000-0000-0000-0000000aa0a2', 'e2e33000-0000-0000-0000-00000000c0a2', 'e2e33000-0000-0000-0000-0000000005a1',
   'e2e33000-0000-0000-0000-0000000007a1', 'IDF', 'manuel_top1', 40),
  ('e2e33000-0000-0000-0000-0000000aa0b2', 'e2e33000-0000-0000-0000-00000000c0b2', 'e2e33000-0000-0000-0000-0000000005a1',
   'e2e33000-0000-0000-0000-0000000007a1', 'IDF', 'manuel_top1', 999);

-- Non-vacuité : les lignes de B existent (lues en superuser).
SELECT is((SELECT count(*)::int FROM plateforme.collecte_flux
            WHERE collecte_id = 'e2e33000-0000-0000-0000-00000000c0b1' AND poids_reel_kg = 777),
  1, 'V1 non-vacuité : flux de l''agence B présent');
SELECT is((SELECT count(*)::int FROM plateforme.attributions_antgaspi
            WHERE collecte_id = 'e2e33000-0000-0000-0000-00000000c0b2'),
  1, 'V2 non-vacuité : attribution de l''agence B présente');

-- ═══ Agence A ═══
SELECT test_set_jwt_prod('agence', 'e2e33000-0000-0000-0000-0000000000a1');
SELECT is(current_user::text, 'authenticated', 'R0 exécution sous le rôle authenticated');
SELECT set_eq(
  $$SELECT id FROM test_liste_agence() WHERE id::text LIKE 'e2e33000%'$$,
  $$VALUES ('e2e33000-0000-0000-0000-00000000c0a1'::uuid), ('e2e33000-0000-0000-0000-00000000c0a2'::uuid)$$,
  'A1 la liste de l''agence A = ses 2 collectes seulement');
SELECT is((SELECT poids FROM test_liste_agence() WHERE id = 'e2e33000-0000-0000-0000-00000000c0a1'),
  11::numeric, 'A2 embed collecte_flux lisible sur sa collecte (11 kg)');
SELECT is((SELECT repas FROM test_liste_agence() WHERE id = 'e2e33000-0000-0000-0000-00000000c0a2'),
  40::numeric, 'A3 embed attributions_antgaspi lisible sur sa collecte (40 repas)');
SELECT is((SELECT count(*)::int FROM plateforme.collecte_flux
            WHERE collecte_id = 'e2e33000-0000-0000-0000-00000000c0b1'),
  0, 'A4 flux de l''agence B refusés (accès direct)');
SELECT is((SELECT count(*)::int FROM plateforme.attributions_antgaspi
            WHERE collecte_id = 'e2e33000-0000-0000-0000-00000000c0b2'),
  0, 'A5 attributions de l''agence B refusées (accès direct)');
SELECT is((SELECT count(*)::int FROM plateforme.collectes
            WHERE id IN ('e2e33000-0000-0000-0000-00000000c0b1', 'e2e33000-0000-0000-0000-00000000c0b2')),
  0, 'A6 collectes de l''agence B refusées (accès direct)');
SELECT is((SELECT count(*)::int FROM plateforme.collecte_flux WHERE poids_reel_kg = 777),
  0, 'A7 aucun poids de B par balayage');
SELECT is((SELECT count(*)::int FROM plateforme.attributions_antgaspi WHERE volume_repas_realise = 999),
  0, 'A8 aucun repas de B par balayage');
SELECT is((SELECT count(*)::int FROM test_liste_agence(p_lieu => 'e2e33000-0000-0000-0000-0000000000e5')),
  0, 'A9 filtre lieu = lieu de B : 0 ligne');
SELECT is((SELECT count(*)::int FROM test_liste_agence(p_client => 'Client SECRET B')),
  0, 'A10 filtre client = client de B : 0 ligne');
SELECT is((SELECT count(*)::int FROM test_liste_agence(
            p_prog => ARRAY['e2e33000-0000-0000-0000-0000000000a2'::uuid])),
  0, 'A11 export programmée par = agence B : 0 ligne');
SELECT is((SELECT count(*)::int FROM test_liste_agence(
            p_prog => ARRAY['e2e33000-0000-0000-0000-0000000000a1'::uuid, 'e2e33000-0000-0000-0000-0000000000a2'::uuid])),
  2, 'A12 programmée par [A, B] : seulement les 2 collectes de A');
SELECT is((SELECT count(*)::int FROM plateforme.collectes c
            JOIN LATERAL (SELECT ev.* FROM plateforme.evenements ev WHERE ev.id = c.evenement_id) e ON true
            JOIN LATERAL (SELECT l.nom FROM plateforme.lieux l WHERE l.id = e.lieu_id) l ON true
           WHERE l.nom = 'Lieu SECRET B'),
  0, 'A13 options de filtres : le lieu de B n''est jamais dérivé');
SELECT is((SELECT count(*)::int FROM test_liste_agence() WHERE client = 'Client SECRET B'),
  0, 'A14 options de filtres : le client de B n''est jamais dérivé');
SELECT is((SELECT count(*)::int FROM plateforme.evenements WHERE id = 'e2e33000-0000-0000-0000-0000000000f2'),
  0, 'A15 l''événement de B est invisible (evt_agence_select)');

-- ═══ Agence B (symétrie) ═══
SELECT test_set_jwt_prod('agence', 'e2e33000-0000-0000-0000-0000000000a2');
SELECT set_eq(
  $$SELECT id FROM test_liste_agence() WHERE id::text LIKE 'e2e33000%'$$,
  $$VALUES ('e2e33000-0000-0000-0000-00000000c0b1'::uuid), ('e2e33000-0000-0000-0000-00000000c0b2'::uuid)$$,
  'B1 la liste de l''agence B = ses 2 collectes seulement');
SELECT is((SELECT count(*)::int FROM plateforme.collecte_flux
            WHERE collecte_id = 'e2e33000-0000-0000-0000-00000000c0a1'),
  0, 'B2 flux de l''agence A refusés');
SELECT is((SELECT count(*)::int FROM plateforme.attributions_antgaspi
            WHERE collecte_id = 'e2e33000-0000-0000-0000-00000000c0a2'),
  0, 'B3 attributions de l''agence A refusées');

-- ═══ Traiteur opérationnel T (export, filtre programmée par) ═══
SELECT test_set_jwt_prod('traiteur_manager', 'e2e33000-0000-0000-0000-0000000000b1');
SELECT is((SELECT count(*)::int FROM test_liste_agence(
            p_prog => ARRAY['e2e33000-0000-0000-0000-0000000000a1'::uuid]) WHERE id::text LIKE 'e2e33000%'),
  2, 'T1 traiteur opérationnel : programmée par = A ne dépasse pas ce que sa RLS ouvre déjà');

-- ═══ Agence sans organisation_id (fail-closed) ═══
SELECT test_set_jwt_prod('agence', NULL);
SELECT is((SELECT count(*)::int FROM test_liste_agence() WHERE id::text LIKE 'e2e33000%'),
  0, 'N1 agence sans organisation : aucune collecte');
SELECT is((SELECT count(*)::int FROM plateforme.collecte_flux WHERE collecte_id::text LIKE 'e2e33000%'),
  0, 'N2 agence sans organisation : aucun flux');

SELECT test_as_superuser();
SELECT * FROM finish();
ROLLBACK;
