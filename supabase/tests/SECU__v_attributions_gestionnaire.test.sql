-- =============================================================================
-- Tests pgTAP — gestionnaire_lieux : données Anti-Gaspi de ses lieux par vue restreinte
-- Migration : 20261004190000_plateforme_v_attributions_gestionnaire.sql
-- =============================================================================
-- Constat (savr-dev, 2026-10-04) : un gestionnaire_lieux lisait 0 attribution AG
-- sur les collectes de ses lieux dès que l'événement venait d'un traiteur tiers
-- (aa_select, décision C-1 §09 : aucune branche par le lieu) — « Repas donnés »,
-- association et distance à zéro sur tous ses écrans.
--
-- CDC §04 « Vue SQL : v_attributions_gestionnaire » + matrice §09 :
--   v_attributions_gest_own_lieu_ok                    (1, 3)
--   v_attributions_gest_autre_lieu_denied              (4, 5)
--   v_attributions_gest_colonnes_whitelist_ok          (14, 15)
--   v_attributions_gest_role_non_gestionnaire_denied   (7, 8, 9, 11-13b)
--   attributions_ag_gestionnaire_denied (T18) inchangé (2, 20)
--
-- Oracle : la TABLE reste fermée au gestionnaire (2, 20) ; la VUE lui rend les
-- attributions des collectes de SES lieux, événement d'un tiers compris (1, 3),
-- jamais celles d'un autre lieu (4) ni d'un événement sans date (6), seulement 5
-- colonnes (14, 15), et rien à aucun autre rôle (7, 9, 11-13b) ni sans
-- organisation (8b). Chaque refus a son contrôle positif : 5 (lieu), 22 (date),
-- 8 (rôle — l'organisation des cas 7, 9, 11, 13, 13b rend 1 ligne au rôle
-- gestionnaire), 1 (l'organisation du cas 12 aussi).
--
-- ⚠ La garde de rôle se teste sur une organisation RATTACHÉE au lieu. Sur une
-- organisation sans lieu, le bornage par organisation vide déjà la vue : le test
-- resterait vert avec une garde élargie à ce rôle (revue sécurité 2026-10-04 —
-- garde passée en liste noire, 22 tests verts sur 22).
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(24);

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

-- Fixture ---------------------------------------------------------------------
-- G  = gestionnaire_lieux rattaché au lieu L1 ; G2 = gestionnaire rattaché à L2
-- T  = traiteur TIERS : programme et opère les trois événements
-- C  = client_organisateur rattaché à L1 par une ligne antérieure au trigger P0047
-- E1 = événement daté sur L1  → collecte AG K1, attribution 120 repas
-- E2 = événement daté sur L2  → collecte AG K2, attribution 80 repas
-- E3 = événement SANS DATE sur L1 → collecte AG K3 annulée, attribution sans volume
--      (date_evenement = MIN(date_collecte) des collectes non annulées, trigger
--      trg_set_date_evenement : NULL pour un brouillon ou si tout est annulé)
SELECT test_as_superuser();

INSERT INTO plateforme.organisations
  (id, nom, raison_sociale, type, actif, est_shadow, siret, email_principal)
VALUES
  ('7a9a0001-0000-0000-0000-0000000000d4'::uuid, 'VAG Gest', 'VAG Gest SA', 'gestionnaire_lieux', true, false,
   '77940000000001', 'gest@vag.test'),
  ('7a9a0002-0000-0000-0000-0000000000d4'::uuid, 'VAG Gest2', 'VAG Gest2 SA', 'gestionnaire_lieux', true, false,
   '77940000000002', 'gest2@vag.test'),
  ('7a9a0003-0000-0000-0000-0000000000d4'::uuid, 'VAG Trait', 'VAG Trait SAS', 'traiteur', true, false,
   '77940000000003', 'trait@vag.test'),
  ('7a9a0004-0000-0000-0000-0000000000d4'::uuid, 'VAG Client', 'VAG Client SA', 'client_organisateur', true, false,
   '77940000000004', 'client@vag.test');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES ('7a9a0a01-0000-0000-0000-0000000000d4'::uuid, '7a9a0003-0000-0000-0000-0000000000d4'::uuid,
        'chef@vag-trait.test', 'Chef', 'T', 'traiteur_manager', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('7a9aef01-0000-0000-0000-0000000000d4'::uuid, '7a9a0003-0000-0000-0000-0000000000d4'::uuid,
        'VAG Trait SAS', '77940000000003', '2 rue Trait', '75002', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES
  ('7a9a1001-0000-0000-0000-0000000000d4'::uuid, 'VAG Lieu 1', '3 rue Lieu', '75003', 'Paris', 'camionnette'),
  ('7a9a1002-0000-0000-0000-0000000000d4'::uuid, 'VAG Lieu 2', '4 rue Lieu', '75004', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES
  ('7a9a0001-0000-0000-0000-0000000000d4'::uuid, '7a9a1001-0000-0000-0000-0000000000d4'::uuid),
  ('7a9a0002-0000-0000-0000-0000000000d4'::uuid, '7a9a1002-0000-0000-0000-0000000000d4'::uuid);

-- Le client_organisateur est AUSSI rattaché à L1. Depuis 20260929140000, le trigger
-- P0047 refuse ce rattachement : la ligne simule un rattachement ANTÉRIEUR au
-- trigger (un trigger de ligne ne revalide pas l'existant), posé hors triggers.
-- Sans elle, le cas 7 serait vide par construction et ne prouverait pas la garde de
-- rôle de la vue, qui reste la défense pour ces lignes historiques (§04, D1).
SET LOCAL session_replication_role = replica;
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('7a9a0004-0000-0000-0000-0000000000d4'::uuid, '7a9a1001-0000-0000-0000-0000000000d4'::uuid);
SET LOCAL session_replication_role = origin;

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('7a9a7e01-0000-0000-0000-0000000000d4'::uuid, 'VAG_ATTR_GEST', 'VAG attributions gestionnaire', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by,
  lieu_id, type_evenement_id, nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES
  ('7a9ae001-0000-0000-0000-0000000000d4'::uuid,
   '7a9a0003-0000-0000-0000-0000000000d4'::uuid, '7a9a0003-0000-0000-0000-0000000000d4'::uuid,
   '7a9aef01-0000-0000-0000-0000000000d4'::uuid, '7a9a0a01-0000-0000-0000-0000000000d4'::uuid,
   '7a9a1001-0000-0000-0000-0000000000d4'::uuid, '7a9a7e01-0000-0000-0000-0000000000d4'::uuid,
   'VAG Gala L1', '2026-06-15', 200, 'Contact', '0600000031'),
  ('7a9ae002-0000-0000-0000-0000000000d4'::uuid,
   '7a9a0003-0000-0000-0000-0000000000d4'::uuid, '7a9a0003-0000-0000-0000-0000000000d4'::uuid,
   '7a9aef01-0000-0000-0000-0000000000d4'::uuid, '7a9a0a01-0000-0000-0000-0000000000d4'::uuid,
   '7a9a1002-0000-0000-0000-0000000000d4'::uuid, '7a9a7e01-0000-0000-0000-0000000000d4'::uuid,
   'VAG Gala L2', '2026-06-16', 150, 'Contact', '0600000032'),
  ('7a9ae003-0000-0000-0000-0000000000d4'::uuid,
   '7a9a0003-0000-0000-0000-0000000000d4'::uuid, '7a9a0003-0000-0000-0000-0000000000d4'::uuid,
   '7a9aef01-0000-0000-0000-0000000000d4'::uuid, '7a9a0a01-0000-0000-0000-0000000000d4'::uuid,
   '7a9a1001-0000-0000-0000-0000000000d4'::uuid, '7a9a7e01-0000-0000-0000-0000000000d4'::uuid,
   'VAG Brouillon L1', NULL, 100, 'Contact', '0600000033');

-- Association + transporteur : FK NOT NULL de attributions_antgaspi. Le transporteur
-- n'est là que pour la FK (type_tms = 'autre', provider_manual).
INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact)
VALUES ('7a9aa501-0000-0000-0000-0000000000d4'::uuid, 'VAG Asso', '1 rue du don', 'idf', 'Pantin',
        'asso@vag.test', 'Association de test pour la vue des attributions gestionnaire.');

INSERT INTO plateforme.transporteurs
  (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms, contact_nom, contact_email, contact_telephone)
VALUES ('7a9a7a01-0000-0000-0000-0000000000d4'::uuid, 'VAG Transporteur', '779400009', '1 rue du froid', '75001',
        'Paris', ARRAY['fourgon'], 'autre', 'Contact', 'transp@vag.test', '0601010131');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES
  ('7a9ac001-0000-0000-0000-0000000000d4'::uuid, '7a9ae001-0000-0000-0000-0000000000d4'::uuid,
   'anti_gaspi', 'programmee', 'non_envoye', '2026-06-15', '23:00'),
  ('7a9ac002-0000-0000-0000-0000000000d4'::uuid, '7a9ae002-0000-0000-0000-0000000000d4'::uuid,
   'anti_gaspi', 'programmee', 'non_envoye', '2026-06-16', '23:00'),
  ('7a9ac003-0000-0000-0000-0000000000d4'::uuid, '7a9ae003-0000-0000-0000-0000000000d4'::uuid,
   'anti_gaspi', 'annulee', 'non_envoye', '2026-06-17', '23:00');

INSERT INTO plateforme.attributions_antgaspi
  (id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation, volume_repas_realise)
VALUES
  ('7a9aad01-0000-0000-0000-0000000000d4'::uuid, '7a9ac001-0000-0000-0000-0000000000d4'::uuid,
   '7a9aa501-0000-0000-0000-0000000000d4'::uuid, '7a9a7a01-0000-0000-0000-0000000000d4'::uuid,
   'IDF', 'manuel_top1', 120),
  ('7a9aad02-0000-0000-0000-0000000000d4'::uuid, '7a9ac002-0000-0000-0000-0000000000d4'::uuid,
   '7a9aa501-0000-0000-0000-0000000000d4'::uuid, '7a9a7a01-0000-0000-0000-0000000000d4'::uuid,
   'IDF', 'manuel_top1', 80),
  ('7a9aad03-0000-0000-0000-0000000000d4'::uuid, '7a9ac003-0000-0000-0000-0000000000d4'::uuid,
   '7a9aa501-0000-0000-0000-0000000000d4'::uuid, '7a9a7a01-0000-0000-0000-0000000000d4'::uuid,
   'IDF', 'manuel_top1', NULL);

-- =============================================================================
-- 1-3 — v_attributions_gest_own_lieu_ok : son lieu, événement d'un traiteur tiers
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', '7a9a0001-0000-0000-0000-0000000000d4'::uuid);

-- 1. La vue rend l'attribution de la collecte tenue sur L1, et elle seule
SELECT results_eq(
  $$ SELECT collecte_id, volume_repas_realise, association_id, association_nom, association_ville
       FROM plateforme.v_attributions_gestionnaire $$,
  $$ VALUES ('7a9ac001-0000-0000-0000-0000000000d4'::uuid, 120,
             '7a9aa501-0000-0000-0000-0000000000d4'::uuid, 'VAG Asso'::text, 'Pantin'::text) $$,
  '1. v_attributions_gest_own_lieu_ok : repas + association de la collecte de SON lieu (traiteur tiers)');

-- 2. C-1 inchangée au niveau de la TABLE (T18) : les mêmes lignes lui restent refusées
SELECT is(
  (SELECT count(*)::int FROM plateforme.attributions_antgaspi),
  0, '2. attributions_ag_gestionnaire_denied : la table reste fermée au gestionnaire (C-1)');

-- 3. Chemin des routes : collectes (lue sous sa RLS) jointe à la vue par collecte_id
SELECT is(
  (SELECT v.volume_repas_realise FROM plateforme.collectes c
     JOIN plateforme.v_attributions_gestionnaire v ON v.collecte_id = c.id
    WHERE c.id = '7a9ac001-0000-0000-0000-0000000000d4'),
  120, '3. gestionnaire : collectes → v_attributions_gestionnaire résout les repas donnés');

-- =============================================================================
-- 4-5 — v_attributions_gest_autre_lieu_denied
-- =============================================================================
-- 4. La collecte tenue sur L2 (lieu d'un autre gestionnaire) est absente
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_attributions_gestionnaire
    WHERE collecte_id = '7a9ac002-0000-0000-0000-0000000000d4'),
  0, '4. v_attributions_gest_autre_lieu_denied : collecte d''un lieu hors organisations_lieux absente');

-- 5. Contrôle positif : le gestionnaire de L2 lit cette ligne, et elle seule
SELECT test_set_jwt_prod('gestionnaire_lieux', '7a9a0002-0000-0000-0000-0000000000d4'::uuid);
SELECT results_eq(
  $$ SELECT collecte_id, volume_repas_realise FROM plateforme.v_attributions_gestionnaire $$,
  $$ VALUES ('7a9ac002-0000-0000-0000-0000000000d4'::uuid, 80) $$,
  '5. gestionnaire de L2 : lit la collecte de L2 (le refus du cas 4 porte sur le lieu)');

-- =============================================================================
-- 6 — événement sans date (date_evenement NULL) : même garde que f_collecte_visible
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', '7a9a0001-0000-0000-0000-0000000000d4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_attributions_gestionnaire
    WHERE collecte_id = '7a9ac003-0000-0000-0000-0000000000d4'),
  0, '6. gestionnaire : attribution d''un événement sans date (date NULL) sur son lieu absente');

-- =============================================================================
-- 7-8 — v_attributions_gest_role_non_gestionnaire_denied (garde de rôle D1)
-- =============================================================================
-- 7. Organisation client_organisateur RATTACHÉE à L1 : aucune ligne
SELECT test_set_jwt_prod('client_organisateur', '7a9a0004-0000-0000-0000-0000000000d4'::uuid);
SELECT is_empty(
  $$ SELECT collecte_id FROM plateforme.v_attributions_gestionnaire $$,
  '7. v_attributions_gest_role_non_gestionnaire_denied : client_organisateur rattaché au lieu, vue vide');

-- 8. Non-vacuité : le MÊME rattachement rend la ligne au rôle gestionnaire_lieux
SELECT test_set_jwt_prod('gestionnaire_lieux', '7a9a0004-0000-0000-0000-0000000000d4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_attributions_gestionnaire),
  1, '8. même rattachement, rôle gestionnaire_lieux : 1 ligne (le refus du cas 7 porte sur le rôle)');

-- 8b. Rôle gestionnaire SANS organisation dans le JWT : échec fermé
SELECT test_set_jwt_prod('gestionnaire_lieux');
SELECT is_empty(
  $$ SELECT collecte_id FROM plateforme.v_attributions_gestionnaire $$,
  '8b. gestionnaire_lieux sans organisation_id : vue vide');

-- =============================================================================
-- 9-13b — aucun autre rôle ne lit la vue ; le traiteur garde la table
-- =============================================================================
-- Chaque rôle est posé sur l'organisation RATTACHÉE à L1 (…0004, qui rend 1 ligne
-- au rôle gestionnaire — cas 8) : seul le rôle diffère, seule la garde de rôle
-- peut vider la vue.
SELECT test_set_jwt_prod('traiteur_manager', '7a9a0004-0000-0000-0000-0000000000d4'::uuid);
SELECT is_empty($$ SELECT collecte_id FROM plateforme.v_attributions_gestionnaire $$,
  '9. traiteur_manager sur une organisation rattachée au lieu : vue vide');

-- 10. Le traiteur programmateur lit toujours ses attributions par la TABLE
-- (aa_select inchangée) : c'est ce qui impose le branchement par rôle des
-- chargeurs partagés (arbitrage option A).
SELECT test_set_jwt_prod('traiteur_manager', '7a9a0003-0000-0000-0000-0000000000d4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.attributions_antgaspi),
  3, '10. traiteur_manager programmateur : ses 3 attributions restent lisibles par la table');

SELECT test_set_jwt_prod('traiteur_commercial', '7a9a0004-0000-0000-0000-0000000000d4'::uuid);
SELECT is_empty($$ SELECT collecte_id FROM plateforme.v_attributions_gestionnaire $$,
  '11. traiteur_commercial sur une organisation rattachée au lieu : vue vide');

SELECT test_set_jwt_prod('agence', '7a9a0001-0000-0000-0000-0000000000d4'::uuid);
SELECT is_empty($$ SELECT collecte_id FROM plateforme.v_attributions_gestionnaire $$,
  '12. rôle agence sur une organisation rattachée au lieu : vue vide');

SELECT test_set_jwt_prod('admin_savr', '7a9a0004-0000-0000-0000-0000000000d4'::uuid);
SELECT is_empty($$ SELECT collecte_id FROM plateforme.v_attributions_gestionnaire $$,
  '13. admin_savr sur une organisation rattachée au lieu : vue vide (le staff lit la table)');

SELECT test_set_jwt_prod('ops_savr', '7a9a0004-0000-0000-0000-0000000000d4'::uuid);
SELECT is_empty($$ SELECT collecte_id FROM plateforme.v_attributions_gestionnaire $$,
  '13b. ops_savr sur une organisation rattachée au lieu : vue vide');

-- =============================================================================
-- 14-15 — v_attributions_gest_colonnes_whitelist_ok
-- =============================================================================
SELECT test_as_superuser();

-- 14. Colonnes figées : toute colonne ajoutée élargit l'accès → ce test doit rougir
SELECT is(
  (SELECT array_agg(attname::text ORDER BY attname::text COLLATE "C")
     FROM pg_attribute
    WHERE attrelid = 'plateforme.v_attributions_gestionnaire'::regclass AND attnum > 0 AND NOT attisdropped),
  ARRAY['association_id', 'association_nom', 'association_ville', 'collecte_id', 'volume_repas_realise']::text[],
  '14. v_attributions_gest_colonnes_whitelist_ok : 5 colonnes exactement');

-- 15. Les 9 colonnes exclues par le §04, nommées une à une
SELECT is_empty(
  $$ SELECT attname::text FROM pg_attribute
      WHERE attrelid = 'plateforme.v_attributions_gestionnaire'::regclass AND attnum > 0
        AND attname::text = ANY (ARRAY['transporteur_id', 'branche_attribution', 'confirmation_transporteur',
              'mode_validation', 'valide_par', 'valide_at', 'poids_repas_kg', 'motif_override',
              'motif_override_libre']) $$,
  '15. aucune colonne exclue exposée (transporteur, branche, confirmation, validation, poids, motifs)');

-- =============================================================================
-- 16-20 — structure : vue barrière, privilèges, policy de la table intacte
-- =============================================================================
SELECT ok(
  (SELECT 'security_barrier=true' = ANY (reloptions) AND 'security_invoker=false' = ANY (reloptions)
     FROM pg_class WHERE oid = 'plateforme.v_attributions_gestionnaire'::regclass),
  '16. vue security_barrier=true et security_invoker=false');

SELECT ok(
  NOT has_table_privilege('anon', 'plateforme.v_attributions_gestionnaire', 'SELECT')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'plateforme.v_attributions_gestionnaire'::regclass AND a.grantee = 0),
  '17. anon et PUBLIC : aucun privilège sur la vue');

SELECT ok(
  has_table_privilege('authenticated', 'plateforme.v_attributions_gestionnaire', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_attributions_gestionnaire', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_attributions_gestionnaire', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_attributions_gestionnaire', 'DELETE'),
  '18. authenticated : SELECT seul sur la vue');

-- 19. Écriture à travers la vue refusée au gestionnaire
SELECT test_set_jwt_prod('gestionnaire_lieux', '7a9a0001-0000-0000-0000-0000000000d4'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.v_attributions_gestionnaire SET volume_repas_realise = 9999
      WHERE collecte_id = '7a9ac001-0000-0000-0000-0000000000d4' $$,
  '55000', NULL, '19. gestionnaire : UPDATE à travers la vue refusé (vue à jointure, non modifiable)');

-- 20. aa_select n'a toujours aucune branche par le lieu (jamais élargie, §04)
SELECT test_as_superuser();
SELECT ok(
  (SELECT qual NOT LIKE '%organisations_lieux%' AND qual NOT LIKE '%f_collecte_visible%'
          AND qual NOT LIKE '%lieu_id%'
     FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'attributions_antgaspi' AND policyname = 'aa_select'),
  '20. aa_select : aucune branche par le lieu (C-1 portée par la table, accès gestionnaire par la vue seule)');

-- =============================================================================
-- 21-22 — non-vacuité du cas 6 : l'événement, une fois daté, devient visible
-- =============================================================================
-- 21. L'attribution de l'événement sans date existe bien sur L1 (le cas 6 ne teste pas du vide)
SELECT is(
  (SELECT count(*)::int FROM plateforme.attributions_antgaspi aa
     JOIN plateforme.collectes c ON c.id = aa.collecte_id
     JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE e.id = '7a9ae003-0000-0000-0000-0000000000d4'
      AND e.lieu_id = '7a9a1001-0000-0000-0000-0000000000d4' AND e.date_evenement IS NULL),
  1, '21. fixture : une attribution porte sur un événement sans date (date NULL) du lieu L1');

UPDATE plateforme.evenements SET date_evenement = '2026-06-17'
 WHERE id = '7a9ae003-0000-0000-0000-0000000000d4';

SELECT test_set_jwt_prod('gestionnaire_lieux', '7a9a0001-0000-0000-0000-0000000000d4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_attributions_gestionnaire
    WHERE collecte_id = '7a9ac003-0000-0000-0000-0000000000d4'),
  1, '22. événement daté : la même attribution devient visible (le refus du cas 6 porte sur la date)');

SELECT * FROM finish();
ROLLBACK;
