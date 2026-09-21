-- =============================================================================
-- SÉCURITÉ — écriture PostgREST directe de `plateforme.lieux` fermée.
--
-- Migration prouvée : 20260921210000_plateforme_lieux_ecriture_client_fermee.
-- Suite de #318 (`20260915160000`, `collectes`) et #328 (`20260915190000`,
-- `evenements`). CLAUDE.md §12 pt 2bis.
--
-- ⚠ HORODATAGE : renuméroté depuis `20260921160000`. Trois migrations ont atterri
-- sur `main` PENDANT la revue de ce lot (`…170000`, `…190000`, `…200000`) ;
-- une migration au timestamp ANTÉRIEUR est SAUTÉE EN SILENCE par
-- `supabase db push` dès que les suivantes sont appliquées. Même correction
-- qu'en #328, pour la même raison.
--
-- ⚠ CE QUI REND CE FICHIER DIFFÉRENT DE SES DEUX PRÉDÉCESSEURS. Sur `collectes` et
-- `evenements`, les policies ouvrantes étaient CLIENT (evt_manager_update,
-- col_update_client…). Sur `lieux`, il n'existe AUCUNE policy d'écriture client :
-- les deux seules sont `lieux_admin` (`FOR ALL`, donc INSERT/UPDATE/DELETE, pour
-- `admin_savr`) et `lieux_ops_write` (UPDATE, pour `ops_savr`). Le chemin qui était
-- réellement ouvert est donc le chemin STAFF — un JWT `admin_savr`/`ops_savr` porté
-- par la clé anon, qui est publique. C'est ce que ferment B1-B4, et c'est la raison
-- d'être du fichier.
--
-- ⚠ Le constat d'origine tenait ce GRANT pour INERTE (« aucune policy INSERT »).
-- C'est faux : `polcmd = '*'` couvre INSERT. Avant la migration, mesuré sous rôle
-- `authenticated` (transaction rollbackée) : INSERT 0 1, UPDATE 1, DELETE 1 sous
-- `admin_savr`, UPDATE 1 sous `ops_savr`. Les cas B1-B4 rejouent EXACTEMENT ces
-- quatre écritures et exigent désormais un refus — la contre-épreuve (ré-accorder
-- le GRANT) les rend donc rouges, aucun n'est vacant.
--
-- ⚠ Tout se joue SOUS RÔLE `authenticated` (test_set_jwt pose `role`) : sous
-- service_role ou superuser, la RLS est bypassée ET les privilèges sont ceux d'un
-- autre rôle — le test passerait au vert quoi qu'il arrive. Les refus attendus sont
-- des 42501 levés AVANT l'évaluation RLS : c'est le privilège qui ferme, pas la
-- policy. Discriminant : chaque refus asserte le MESSAGE « permission denied for
-- table lieux » (idiome de SECU__rls_09_ecriture_directe_revoke), pour qu'un 42501
-- levé plus loin — trigger, fonction — ne suffise pas à faire passer le cas.
--
-- CONTRE-ÉPREUVE EXÉCUTÉE (base jetable, 149 migrations rejouées sur base vierge,
-- puis `GRANT INSERT, UPDATE, DELETE ON plateforme.lieux TO authenticated`) :
-- 9 rouges, exactement les cas visés = A1 A2 A3 A5 + B1 B2 B3 B4 B5. B5 rougit
-- parce qu'il n'obtient plus d'exception du tout, les huit autres parce que le
-- privilège est de retour. A4 A6 A7 A8, B6 B7 et tout le bloc C restent verts :
-- ils portent sur ce que la migration NE change PAS, et leur rôle est d'interdire
-- la sur-fermeture. Aucun cas n'est vacant.
--
-- C6 rougissait lui aussi à la première contre-épreuve, pour une raison qui n'était
-- pas la sienne : son compte d'E5 était ABSOLU, donc dépendant de l'échec de B2.
-- Les compteurs de C5/C6 sont depuis relevés en DELTA autour de la seule écriture
-- qu'ils mesurent.
-- =============================================================================

BEGIN;
SELECT plan(22);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Helpers JWT (cf. SECU__evenements_ecriture_client_fermee) ────────────────
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- `service_role` exercé par de VRAIES écritures, jamais par has_table_privilege
-- seul : c'est le chemin des routes API, et la non-régression qui compte.
CREATE OR REPLACE FUNCTION test_as_service_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- ── Fixtures (UUID improbables, pas de collision avec la seed) ───────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('11e00000-0000-0000-0000-000000000001'::uuid, 'Traiteur LIEUX', 'traiteur', true, false, '11E00000000001', 'lieux-t@test.internal');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('11e00000-0000-0000-0000-0000000000a1'::uuid, '11e00000-0000-0000-0000-000000000001'::uuid, 'mgr@lieux.test', 'Mgr', 'Lieux', 'traiteur_manager');

-- l1 : la cible des écritures directes. l2 : la cible du DELETE (B3), pour que
-- l'échec attendu ne puisse jamais être imputé à une FK entrante.
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('11e00000-0000-0000-0000-00000000011a'::uuid, 'Salle LIEUX A', '1 rue A', '75001', 'Paris', 'fourgon'),
  ('11e00000-0000-0000-0000-00000000011b'::uuid, 'Salle LIEUX B', '1 rue B', '75002', 'Paris', 'fourgon');

-- =============================================================================
-- A. PRIVILÈGES — le GRANT table-level 0.4a est bien amputé
-- =============================================================================
SELECT test_as_superuser();

SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.lieux', 'INSERT'),
  'A1 authenticated n''a plus INSERT table-level sur lieux'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.lieux', 'UPDATE'),
  'A2 authenticated n''a plus UPDATE table-level sur lieux'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.lieux', 'DELETE'),
  'A3 authenticated n''a plus DELETE table-level sur lieux'
);

-- A4 NON-RÉGRESSION — le SELECT est hors périmètre. Il avait été retiré au niveau
-- table par 20260617170000 puis ré-accordé sur une liste blanche de colonnes
-- (masquage des 5 champs admin-only : commentaire_lieu, siren, email_gestionnaire,
-- reference_citeo, commentaires_internes). Ce lot ne doit ni l'élargir ni le
-- réduire — le compte exact est le cliquet des deux côtés.
--
-- Provenance du 23 : 20260617170000 en accorde 22, et 20260706100000 (R19b P2,
-- `v_lieux_clients` + capacité) en ajoute une 23e, `capacite_maximum`. Le §09 l.64
-- dit encore « whitelist 22 colonnes » : c'est le CDC qui est en retard d'une
-- colonne depuis R19b, pas la base. Dette signalée, hors périmètre de ce lot — ne
-- PAS « corriger » ce 23 en 22 sans vérifier le catalogue.
SELECT is(
  (SELECT count(*)::int FROM information_schema.column_privileges
    WHERE grantee = 'authenticated'
      AND table_schema = 'plateforme' AND table_name = 'lieux'
      AND privilege_type = 'SELECT'),
  23,
  'A4 non-regression : liste blanche SELECT de 20260617170000 intacte (23 colonnes)'
);

-- A5 cliquet : interdit de ré-ouvrir par la porte colonne-level. Un
-- `GRANT UPDATE (adresse_acces)` laisserait A2 vrai tout en ré-autorisant
-- l'écriture directe que ce fichier ferme.
SELECT is(
  (SELECT count(*)::int FROM information_schema.column_privileges
    WHERE grantee = 'authenticated'
      AND table_schema = 'plateforme' AND table_name = 'lieux'
      AND privilege_type IN ('INSERT', 'UPDATE')),
  0,
  'A5 aucun GRANT colonne-level INSERT/UPDATE residuel sur lieux'
);

-- A6 NON-RÉGRESSION : les routes écrivent sous service_role, qui doit rester intact.
SELECT ok(
  has_table_privilege('service_role', 'plateforme.lieux', 'SELECT')
  AND has_table_privilege('service_role', 'plateforme.lieux', 'INSERT')
  AND has_table_privilege('service_role', 'plateforme.lieux', 'UPDATE')
  AND has_table_privilege('service_role', 'plateforme.lieux', 'DELETE'),
  'A6 service_role conserve SELECT + INSERT + UPDATE + DELETE (les routes ecrivent toujours)'
);

-- A7 cliquet d'arbitrage : les policies sont CONSERVÉES (même décision qu'en #318
-- et #328) — inertes tant que le privilège n'est pas ré-accordé, mais prêtes si un
-- besoin JWT-scopé revient. `lieux_admin` est bien `FOR ALL` : c'est elle qui
-- rendait le GRANT atteignable, et la retirer serait une seconde décision.
SELECT is(
  (SELECT count(*)::int FROM pg_policy
    WHERE polrelid = 'plateforme.lieux'::regclass
      AND polname IN ('lieux_admin', 'lieux_ops_write')),
  2,
  'A7 policies lieux_admin (FOR ALL) et lieux_ops_write conservees (inertes)'
);

SELECT ok(
  NOT has_table_privilege('anon', 'plateforme.lieux', 'INSERT')
  AND NOT has_table_privilege('anon', 'plateforme.lieux', 'UPDATE')
  AND NOT has_table_privilege('anon', 'plateforme.lieux', 'DELETE')
  AND NOT has_any_column_privilege('anon', 'plateforme.lieux', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'plateforme.lieux', 'UPDATE'),
  'A8 anon ne detient aucune ecriture sur lieux (ni table, ni colonne)'
);

-- =============================================================================
-- B. FERMETURE SOUS RÔLE — le POST/PATCH/DELETE PostgREST direct est refusé
-- =============================================================================
-- B1-B4 rejouent les quatre écritures qui RÉUSSISSAIENT avant la migration. Leur
-- policy les autorise toujours : le 42501 prouve que c'est le privilège qui ferme.

SELECT test_set_jwt('admin_savr', NULL, '11e00000-0000-0000-0000-0000000000a1'::uuid);

SELECT throws_ok(
  $$INSERT INTO plateforme.lieux (nom, adresse_acces, code_postal, ville, type_vehicule_max)
    VALUES ('Lieu injecte', '1 rue injectee', '75003', 'Paris', 'camionnette')$$,
  '42501', 'permission denied for table lieux',
  'B1 admin_savr : INSERT direct refuse (42501) malgre lieux_admin FOR ALL'
);

SELECT throws_ok(
  $$UPDATE plateforme.lieux SET adresse_acces = '9 rue mutee en direct'
     WHERE id = '11e00000-0000-0000-0000-00000000011a'::uuid$$,
  '42501', 'permission denied for table lieux',
  'B2 admin_savr : UPDATE direct refuse (42501) malgre lieux_admin FOR ALL'
);

-- B3 sur l2, qu'aucune FK entrante ne retient : sans le REVOKE, la suppression
-- aboutirait pour de bon.
SELECT throws_ok(
  $$DELETE FROM plateforme.lieux
     WHERE id = '11e00000-0000-0000-0000-00000000011b'::uuid$$,
  '42501', 'permission denied for table lieux',
  'B3 admin_savr : DELETE direct refuse (42501) malgre lieux_admin FOR ALL'
);

-- B4 l'autre policy ouvrante, sur l'autre rôle staff.
SELECT test_set_jwt('ops_savr', NULL, '11e00000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.lieux SET acces_details = 'ops-direct'
     WHERE id = '11e00000-0000-0000-0000-00000000011a'::uuid$$,
  '42501', 'permission denied for table lieux',
  'B4 ops_savr : UPDATE direct refuse (42501) malgre lieux_ops_write'
);

-- B5 défense en profondeur. Un rôle CLIENT n'a jamais eu de policy d'écriture ici :
-- avant la migration son UPDATE n'échouait pas, il affectait 0 ligne en silence.
-- Le passage à un 42501 franc est le gain — un refus qui se voit, au lieu d'un
-- no-op qu'un appelant peut confondre avec un succès.
SELECT test_set_jwt('traiteur_manager', '11e00000-0000-0000-0000-000000000001'::uuid, '11e00000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$UPDATE plateforme.lieux SET nom = 'client-direct'
     WHERE id = '11e00000-0000-0000-0000-00000000011a'::uuid$$,
  '42501', 'permission denied for table lieux',
  'B5 traiteur_manager : UPDATE direct refuse (42501) — plus de no-op silencieux'
);

-- ── Non-régression de la LECTURE : la fermeture ne doit pas sur-fermer ───────
-- B6 le staff lit toujours (lieux_ops_read + liste blanche colonne).
SELECT test_set_jwt('ops_savr', NULL, '11e00000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.lieux
    WHERE id = '11e00000-0000-0000-0000-00000000011a'::uuid),
  1,
  'B6 non-regression : ops_savr lit toujours lieux (lieux_ops_read intacte)'
);

-- B7 et la colonne admin-only reste masquée : le REVOKE d'écriture n'a pas
-- déplacé la frontière de lecture posée par 20260617170000.
SELECT throws_ok(
  $$SELECT commentaire_lieu FROM plateforme.lieux
     WHERE id = '11e00000-0000-0000-0000-00000000011a'::uuid$$,
  '42501', NULL,
  'B7 non-regression : colonne admin-only toujours masquee a authenticated'
);

-- =============================================================================
-- C. LE CANAL LÉGITIME reste ouvert, et le MOTIF de la fermeture est établi
-- =============================================================================
-- Sans ce bloc, une migration qui fermerait `lieux` à TOUT LE MONDE passerait
-- A1-A3 et B1-B5 au vert tout en cassant la production.
SELECT test_as_service_role();

SELECT lives_ok(
  $$INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
    VALUES ('11e00000-0000-0000-0000-00000000011c'::uuid, 'Salle LIEUX C', '1 rue C', '75003', 'Paris', 'fourgon')$$,
  'C1 non-vacuite : service_role INSERT toujours (POST /api/v1/admin/lieux)'
);

SELECT lives_ok(
  $$UPDATE plateforme.lieux SET acces_details = 'maj par la route'
     WHERE id = '11e00000-0000-0000-0000-00000000011a'::uuid$$,
  'C2 non-vacuite : service_role UPDATE toujours (PATCH /api/v1/admin/lieux/[id])'
);

SELECT lives_ok(
  $$DELETE FROM plateforme.lieux
     WHERE id = '11e00000-0000-0000-0000-00000000011c'::uuid$$,
  'C3 non-vacuite : service_role DELETE toujours (DELETE /api/v1/admin/lieux/[id])'
);

-- ── Le motif : aucune trace d'audit n'est posée PAR LA BASE ─────────────────
SELECT test_as_superuser();

-- C4 `lieux` ne porte aucun trigger d'audit : l'`audit_log` est écrit par les
-- routes (`admin/lieux`, `.../normaliser`) et par elles seules. C'est ce qui rend
-- l'écriture directe silencieuse — et c'est le motif de la fermeture. Si un
-- trigger d'audit était ajouté un jour sur cette table, ce cas rougirait et le
-- motif serait à relire.
SELECT is(
  (SELECT count(*)::int FROM pg_trigger
    WHERE tgrelid = 'plateforme.lieux'::regclass AND NOT tgisinternal
      AND tgname <> 'trg_lieu_champ_critique_e5'),
  0,
  'C4 motif : aucun trigger d''audit sur lieux — l''audit_log est porte par les routes'
);

-- C5 le corollaire, mesuré : une écriture directe ne laisse AUCUNE ligne d'audit.
--
-- ⚠ Les deux compteurs sont relevés AVANT l'écriture et comparés en DELTA, pas en
-- valeur absolue. Un compte absolu ferait dépendre C6 de l'échec de B2 : si le
-- GRANT était ré-accordé, l'UPDATE de B2 aboutirait et émettrait lui aussi un E5,
-- et C6 rougirait pour une raison qui n'est pas la sienne. Mesuré : c'est
-- exactement ce qui s'est produit à la contre-épreuve. Le delta rend chaque bloc
-- lisible seul.
CREATE TEMP TABLE _c5_avant AS
SELECT
  (SELECT count(*)::int FROM plateforme.audit_log_2026
    WHERE record_id = '11e00000-0000-0000-0000-00000000011a'::uuid) AS audit,
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = '11e00000-0000-0000-0000-00000000011a'::uuid
      AND event_type = 'lieu.champ_critique_modifie') AS e5;

UPDATE plateforme.lieux SET adresse_acces = '9 rue posee en direct'
 WHERE id = '11e00000-0000-0000-0000-00000000011a'::uuid;

SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log_2026
    WHERE record_id = '11e00000-0000-0000-0000-00000000011a'::uuid)
    - (SELECT audit FROM _c5_avant),
  0,
  'C5 motif : un UPDATE direct n''ecrit aucun audit_log (la trace est route-only)'
);

-- ── Non-régression de l'OUTBOX : ce que la fermeture ne prétend PAS corriger ──
-- C6 contrairement à `evenements` (#328, où l'UPDATE direct n'émettait aucun E2),
-- l'outbox de `lieux` n'a jamais dépendu de ce privilège :
-- `trg_lieu_champ_critique_e5` est SECURITY DEFINER. L'UPDATE de C5 a touché
-- `adresse_acces`, un champ critique → l'E5 doit être là. Ce cas interdit de
-- sur-vendre la migration ET garde le trigger vivant.
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = '11e00000-0000-0000-0000-00000000011a'::uuid
      AND event_type = 'lieu.champ_critique_modifie')
    - (SELECT e5 FROM _c5_avant),
  1,
  'C6 non-regression : l''E5 lieu.champ_critique_modifie est toujours emis (trigger SECURITY DEFINER)'
);

-- C7 le trigger est bien SECURITY DEFINER — c'est CE qui le rend indépendant du
-- privilège de l'appelant. Le passer en SECURITY INVOKER casserait l'E5 sur tout
-- chemin non privilégié sans qu'aucun autre cas ne le voie.
SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p
    JOIN pg_trigger t ON t.tgfoid = p.oid
   WHERE t.tgrelid = 'plateforme.lieux'::regclass
     AND t.tgname = 'trg_lieu_champ_critique_e5'),
  'C7 trg_lieu_champ_critique_e5 est SECURITY DEFINER (independant du privilege appelant)'
);

SELECT * FROM finish();
ROLLBACK;
