-- M1.1a — Test pgTAP `plateforme.count_collectes_par_org`
-- ============================================================================
-- Liste Clients Admin (CDC §06.06 L555) : colonnes « nb collectes ZD/AG (12
-- derniers mois) » par organisation. Consommée par
-- packages/plateforme/src/app/api/v1/admin/organisations/route.ts.
--
-- Bug pré-existant (revue E2E) : la RPC n'existait dans AUCUNE migration →
-- PGRST202 silencieux → 0 partout. Ce test verrouille l'existence ET la
-- sémantique pour que le trou ne se recrée pas (le test route est un fake
-- service-role qui ne peut PAS exercer la vraie fonction SQL).
--
-- Sémantique testée (CDC §06.06 L90-92, aligné v_kpi_admin) :
--   · mapping 'zd'→zero_dechet, 'ag'→anti_gaspi
--   · fenêtre : date_collecte >= depuis
--   · attribution : evenement.organisation_id (cloisonnement inter-org)
--   · statut : exclut brouillon + annulee
--   · orgs sans collecte : ABSENTES du résultat (route mappe à 0) — anti-vacuité
--   · sécurité : service_role EXECUTE oui / authenticated non (fonction hors RLS)
--
-- `count_collectes_par_org` est SECURITY DEFINER, appelée en service_role : le
-- runner pgTAP se connecte en owner/superuser → comportement admin. On ne
-- bascule donc pas en `authenticated` ; les grants sont vérifiés par
-- has_function_privilege (T7/T8).
-- ============================================================================

BEGIN;

SELECT plan(8);

-- Triggers désactivés le temps d'insérer des collectes terminales/annulées
-- (pack/co2) sans faire tourner les triggers. N'affecte pas les SELECT.
SET LOCAL session_replication_role = replica;

DO $$ BEGIN
  -- Deux organisations (A = mix ZD/AG, B = AG seul) pour le cloisonnement.
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
    ('ca000000-0000-0000-0000-0000000000a1'::uuid, 'CntA', 'Cnt A SAS', 'traiteur', '99999999999801', true),
    ('ca000000-0000-0000-0000-0000000000b2'::uuid, 'CntB', 'Cnt B SAS', 'traiteur', '99999999999802', true);

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
    ('ca100000-0000-0000-0000-0000000000a1'::uuid, 'ca000000-0000-0000-0000-0000000000a1'::uuid, 'Cnt A SAS', '99999999999801', '1 Rue A', '75001', 'Paris'),
    ('ca100000-0000-0000-0000-0000000000b2'::uuid, 'ca000000-0000-0000-0000-0000000000b2'::uuid, 'Cnt B SAS', '99999999999802', '2 Rue B', '75002', 'Paris');

  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
    ('ca200000-0000-0000-0000-0000000000a1'::uuid, 'ca000000-0000-0000-0000-0000000000a1'::uuid, 'a@cnta.local', 'A', 'A', 'traiteur_manager'),
    ('ca200000-0000-0000-0000-0000000000b2'::uuid, 'ca000000-0000-0000-0000-0000000000b2'::uuid, 'b@cntb.local', 'B', 'B', 'traiteur_manager');

  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
    ('ca300000-0000-0000-0000-0000000000c1'::uuid, 'Salle', '1 Rue L', '75001', 'Paris', 'camionnette', 48.85, 2.35, 'idf');

  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
    ('ca400000-0000-0000-0000-0000000000d1'::uuid, 'GALA_CNT', 'Gala', 1, true);

  -- Un événement par org (porte l'attribution organisation_id).
  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
    created_by, lieu_id, type_evenement_id, nom_evenement, pax,
    contact_principal_nom, contact_principal_telephone
  ) VALUES
    ('ca500000-0000-0000-0000-0000000000a1'::uuid, 'ca000000-0000-0000-0000-0000000000a1'::uuid,
     'ca000000-0000-0000-0000-0000000000a1'::uuid, 'ca100000-0000-0000-0000-0000000000a1'::uuid,
     'ca200000-0000-0000-0000-0000000000a1'::uuid, 'ca300000-0000-0000-0000-0000000000c1'::uuid,
     'ca400000-0000-0000-0000-0000000000d1'::uuid, 'Evt A', 100, 'Contact', '0600000000'),
    ('ca500000-0000-0000-0000-0000000000b2'::uuid, 'ca000000-0000-0000-0000-0000000000b2'::uuid,
     'ca000000-0000-0000-0000-0000000000b2'::uuid, 'ca100000-0000-0000-0000-0000000000b2'::uuid,
     'ca200000-0000-0000-0000-0000000000b2'::uuid, 'ca300000-0000-0000-0000-0000000000c1'::uuid,
     'ca400000-0000-0000-0000-0000000000d1'::uuid, 'Evt B', 100, 'Contact', '0600000000');

  -- Collectes org A (fenêtre depuis = 2026-01-01) :
  --   2 ZD comptées (cloturee, realisee) ; 1 AG comptée (programmee) ;
  --   1 ZD brouillon + 1 ZD annulee = exclues par statut ;
  --   1 ZD cloturee AVANT la fenêtre (2025-01-01) = exclue par date.
  --   → si l'un de ces filtres tombait, zd(A) ne vaudrait plus 2.
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte) VALUES
    ('ca700000-0000-0000-0000-0000000000a1'::uuid, 'ca500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'cloturee',   '2026-06-10', '08:00'),
    ('ca700000-0000-0000-0000-0000000000a2'::uuid, 'ca500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'realisee',   '2026-06-12', '08:00'),
    ('ca700000-0000-0000-0000-0000000000a3'::uuid, 'ca500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'brouillon',  '2026-06-14', '08:00'),
    ('ca700000-0000-0000-0000-0000000000a4'::uuid, 'ca500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'annulee',    '2026-06-16', '08:00'),
    ('ca700000-0000-0000-0000-0000000000a5'::uuid, 'ca500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'cloturee',   '2025-01-01', '08:00'),
    ('ca700000-0000-0000-0000-0000000000a6'::uuid, 'ca500000-0000-0000-0000-0000000000a1'::uuid, 'anti_gaspi',  'programmee', '2026-06-20', '08:00');

  -- Collecte org B : 1 AG comptée, 0 ZD (org B ABSENTE du résultat ZD).
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte) VALUES
    ('ca700000-0000-0000-0000-0000000000b1'::uuid, 'ca500000-0000-0000-0000-0000000000b2'::uuid, 'anti_gaspi', 'cloturee', '2026-06-11', '08:00');
END $$;

SET LOCAL session_replication_role = origin;

-- ─── T1 : la fonction existe (aurait rougi sur le bug d'origine) ─────────────
SELECT has_function(
  'plateforme', 'count_collectes_par_org', ARRAY['text', 'date'],
  'T1 — plateforme.count_collectes_par_org(text, date) existe'
);

-- ─── T2 : ZD org A = 2 (statut brouillon/annulee + hors-fenêtre exclus) ──────
SELECT is(
  (SELECT nb FROM plateforme.count_collectes_par_org('zd', '2026-01-01')
    WHERE organisation_id = 'ca000000-0000-0000-0000-0000000000a1'::uuid),
  2::bigint,
  'T2 — ZD org A = 2 (mapping zero_dechet, hors brouillon/annulee, hors fenêtre)'
);

-- ─── T3 : AG org A = 1 (mapping anti_gaspi) ──────────────────────────────────
SELECT is(
  (SELECT nb FROM plateforme.count_collectes_par_org('ag', '2026-01-01')
    WHERE organisation_id = 'ca000000-0000-0000-0000-0000000000a1'::uuid),
  1::bigint,
  'T3 — AG org A = 1 (mapping anti_gaspi)'
);

-- ─── T4 : org B ABSENTE du résultat ZD (0 collecte ZD) — anti-vacuité ────────
-- La route mappe l'absence à 0 (statsZd[o.id] ?? 0). Si la fonction renvoyait
-- une valeur figée / ignorait le filtre type, org B apparaîtrait ici.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM plateforme.count_collectes_par_org('zd', '2026-01-01')
     WHERE organisation_id = 'ca000000-0000-0000-0000-0000000000b2'::uuid
  ),
  'T4 — org B absente du résultat ZD (0 ZD → route affiche 0)'
);

-- ─── T5 : AG org B = 1 (cloisonnement : ne compte pas les AG de l'org A) ─────
SELECT is(
  (SELECT nb FROM plateforme.count_collectes_par_org('ag', '2026-01-01')
    WHERE organisation_id = 'ca000000-0000-0000-0000-0000000000b2'::uuid),
  1::bigint,
  'T5 — AG org B = 1 (attribution par evenement.organisation_id, pas de fuite A→B)'
);

-- ─── T6 : type_collecte inconnu → aucun résultat (CASE sans ELSE = NULL) ─────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM plateforme.count_collectes_par_org('xyz', '2026-01-01')),
  'T6 — type_collecte inconnu → 0 ligne (pas de fuite tous-types)'
);

-- ─── T7 : authenticated NE PEUT PAS exécuter (fonction hors RLS, tout le parc) ─
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plateforme.count_collectes_par_org(text, date)',
    'EXECUTE'
  ),
  'T7 — authenticated sans EXECUTE (pas de fuite inter-org depuis un JWT client)'
);

-- ─── T8 : service_role PEUT exécuter (rôle serveur de confiance) ─────────────
SELECT ok(
  has_function_privilege(
    'service_role',
    'plateforme.count_collectes_par_org(text, date)',
    'EXECUTE'
  ),
  'T8 — service_role a EXECUTE (route back-office admin)'
);

SELECT * FROM finish();

ROLLBACK;
