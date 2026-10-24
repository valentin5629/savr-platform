-- =============================================================================
-- pgTAP — programmation par cartes (refonte du formulaire, lot B2 ; décisions
-- Val 2026-10-24, B2-Q1 à B2-Q4), migration
-- 20261024100000_plateforme_programmation_collectes_par_carte.sql
-- =============================================================================
-- Prouve :
--   • fn_enregistrer_programmation crée l'événement et ses N collectes, chacune
--     avec son type d'événement et ses contacts ; l'E1 part pour chaque ZD
--     confirmée, aucun pour un brouillon ; l'événement garde la copie de sa
--     collecte n°1 ;
--   • tout ou rien : une carte refusée n'en laisse aucune, ni l'événement ;
--   • plafond de 10 collectes par type ;
--   • reprise d'un brouillon : ses collectes sont remplacées, éventuellement
--     confirmées ; un événement déjà confirmé est refusé ;
--   • fn_creer_collecte_carte (ajout à un événement existant) pose type et
--     contacts dans la même transaction ;
--   • lieu modifié porté par chaque collecte et par l'ordre de création ;
--     contrôle d'accès reporté sur le lieu ; type d'une carte brouillon ;
--   • aucune des deux fonctions n'est exécutable par un rôle client.
-- =============================================================================

BEGIN;
SELECT plan(47);

-- ── Jeu d'essai : l'organisation, le lieu et l'entité de facturation d'un
-- événement existant, deux types d'événement.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT tests.outbox_fixture_collecte('zd') AS collecte_fixture,
       NULL::jsonb AS evt, NULL::uuid AS type_a, NULL::uuid AS type_b;
UPDATE t SET evt = jsonb_build_object(
    'organisation_id', e.organisation_id,
    'traiteur_operationnel_organisation_id', e.traiteur_operationnel_organisation_id,
    'entite_facturation_id', e.entite_facturation_id,
    'lieu_id', e.lieu_id,
    'created_by', e.created_by,
    'nom_evenement', 'Gala B2',
    'controle_acces_requis', false),
  type_a = e.type_evenement_id
  FROM plateforme.collectes c JOIN plateforme.evenements e ON e.id = c.evenement_id
 WHERE c.id = t.collecte_fixture;
INSERT INTO plateforme.types_evenements (code, libelle, created_at, updated_at)
VALUES ('LOT_B2_AUTRE_TYPE', 'Lot B2 autre type', now(), now())
ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle;
UPDATE t SET type_b = (SELECT id FROM plateforme.types_evenements WHERE code = 'LOT_B2_AUTRE_TYPE');

CREATE FUNCTION pg_temp.carte(p_type text, p_jours int, p_heure text, p_pax int,
                              p_type_evt uuid, p_nom text, p_secours text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'type', p_type, 'date_collecte', CURRENT_DATE + p_jours, 'heure_collecte', p_heure,
    'pax', p_pax, 'informations_supplementaires', 'Quai ' || p_nom,
    'type_evenement_id', p_type_evt,
    'contact_principal_nom', p_nom, 'contact_principal_telephone', '06' || lpad(p_pax::text, 8, '0'),
    'contact_secours_nom', p_secours, 'contact_secours_telephone',
      CASE WHEN p_secours IS NULL THEN NULL ELSE '0700000000' END)
$$;
CREATE FUNCTION pg_temp.contact(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT contact_principal_nom || ' / ' || coalesce(contact_secours_nom, '-')
    FROM plateforme.collecte_contacts WHERE collecte_id = p_id
$$;

-- ── Création confirmée : 2 ZD + 1 AG, chacune ses valeurs ──────────────────
CREATE TEMP TABLE r ON COMMIT DROP AS
SELECT plateforme.fn_enregistrer_programmation((SELECT evt FROM t),
  jsonb_build_array(
    pg_temp.carte('zd', 12, '19:00', 120, (SELECT type_a FROM t), 'Alice', 'Sam'),
    pg_temp.carte('zd', 13, '19:00', 80, (SELECT type_b FROM t), 'Bruno'),
    pg_temp.carte('ag', 12, '22:00', 120, (SELECT type_b FROM t), 'Chloé')),
  true) AS res;
CREATE FUNCTION pg_temp.cid(p_rang int) RETURNS uuid LANGUAGE sql AS
  $$ SELECT ((SELECT res FROM r)->'collecte_ids'->>(p_rang - 1))::uuid $$;
CREATE FUNCTION pg_temp.evt_id() RETURNS uuid LANGUAGE sql AS
  $$ SELECT ((SELECT res FROM r)->>'evenement_id')::uuid $$;

SELECT is((SELECT count(*)::int FROM plateforme.collectes WHERE evenement_id = pg_temp.evt_id()), 3,
  'création confirmée : une collecte par carte');
SELECT is((SELECT count(*)::int FROM plateforme.collectes WHERE evenement_id = pg_temp.evt_id() AND statut = 'programmee'), 3,
  'création confirmée : les collectes sont programmées');
SELECT is(pg_temp.contact(pg_temp.cid(1)), 'Alice / Sam', 'carte 1 : ses contacts');
SELECT is(pg_temp.contact(pg_temp.cid(2)), 'Bruno / -', 'carte 2 : ses contacts, sans secours');
SELECT is(pg_temp.contact(pg_temp.cid(3)), 'Chloé / -', 'carte 3 : ses contacts');
SELECT is((SELECT type_evenement_id FROM plateforme.collectes WHERE id = pg_temp.cid(2)), (SELECT type_b FROM t),
  'carte 2 : son type d’événement');
SELECT is((SELECT type_evenement_id FROM plateforme.collectes WHERE id = pg_temp.cid(1)), (SELECT type_a FROM t),
  'carte 1 : son type d’événement');
SELECT is((SELECT pax FROM plateforme.collectes WHERE id = pg_temp.cid(2)), 80, 'carte 2 : ses convives');
SELECT is((SELECT informations_supplementaires FROM plateforme.collectes WHERE id = pg_temp.cid(3)), 'Quai Chloé',
  'carte 3 : ses informations supplémentaires');
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE event_type = 'collecte.creee' AND aggregate_id IN (pg_temp.cid(1), pg_temp.cid(2), pg_temp.cid(3))),
  2, 'création confirmée : un ordre de création par collecte Zéro-Déchet, aucun pour l’Anti-Gaspi');
SELECT is((SELECT contact_principal_nom FROM plateforme.evenements WHERE id = pg_temp.evt_id()), 'Alice',
  'l’événement garde les contacts de sa collecte n°1');
SELECT is((SELECT nom_evenement FROM plateforme.evenements WHERE id = pg_temp.evt_id()), 'Gala B2',
  'l’événement porte son nom');

-- ── Tout ou rien ────────────────────────────────────────────────────────────
CREATE TEMP TABLE avant ON COMMIT DROP AS
SELECT (SELECT count(*) FROM plateforme.evenements) AS evts, (SELECT count(*) FROM plateforme.collectes) AS cols;
SELECT throws_ok(
  format($$ SELECT plateforme.fn_enregistrer_programmation(%L::jsonb, %L::jsonb, true) $$,
    (SELECT evt FROM t),
    jsonb_build_array(
      pg_temp.carte('zd', 12, '19:00', 120, (SELECT type_a FROM t), 'Alice'),
      pg_temp.carte('zd', 13, '19:00', 0, (SELECT type_a FROM t), 'Bruno'))),
  'P0001', NULL, 'une carte aux convives invalides : la programmation est refusée');
SELECT is((SELECT count(*) FROM plateforme.evenements), (SELECT evts FROM avant),
  'refus : aucun événement créé');
SELECT is((SELECT count(*) FROM plateforme.collectes), (SELECT cols FROM avant),
  'refus : aucune collecte créée, pas même la première carte');
SELECT throws_ok(
  format($$ SELECT plateforme.fn_enregistrer_programmation(%L::jsonb, %L::jsonb, true) $$,
    (SELECT evt FROM t),
    jsonb_build_array(jsonb_build_object('type', 'zd', 'date_collecte', CURRENT_DATE + 3,
      'heure_collecte', '19:00', 'pax', 50, 'contact_principal_nom', 'Ana',
      'contact_principal_telephone', '0600000000'))),
  'P0001', 'TYPE_EVENEMENT_REQUIS: chaque collecte porte son type d''événement',
  'une carte sans type d’événement est refusée');
SELECT throws_ok(
  format($$ SELECT plateforme.fn_enregistrer_programmation(%L::jsonb, '[]'::jsonb, true) $$, (SELECT evt FROM t)),
  'P0001', 'COLLECTES_REQUISES: une programmation porte au moins une collecte',
  'une programmation sans collecte est refusée');

-- ── Plafond : 10 collectes par type (B2-Q4) ─────────────────────────────────
SELECT throws_ok(
  format($$ SELECT plateforme.fn_enregistrer_programmation(%L::jsonb, %L::jsonb, false) $$,
    (SELECT evt FROM t),
    (SELECT jsonb_agg(pg_temp.carte('ag', 20 + g, '19:00', 50, (SELECT type_a FROM t), 'Ag' || g))
       FROM generate_series(1, 11) g)),
  'P0001', 'PLAFOND_COLLECTES: au plus 10 collectes Zéro-Déchet et 10 Anti-Gaspi par programmation',
  'onze collectes Anti-Gaspi : refusé');
SELECT lives_ok(
  format($$ SELECT plateforme.fn_enregistrer_programmation(%L::jsonb, %L::jsonb, false) $$,
    (SELECT evt FROM t),
    (SELECT jsonb_agg(pg_temp.carte(CASE WHEN g <= 10 THEN 'zd' ELSE 'ag' END, 20 + g, '19:00', 50, (SELECT type_a FROM t), 'C' || g))
       FROM generate_series(1, 20) g)),
  'dix Zéro-Déchet et dix Anti-Gaspi : accepté');

-- ── Brouillon puis reprise (B2-Q2) ──────────────────────────────────────────
CREATE TEMP TABLE b ON COMMIT DROP AS
SELECT plateforme.fn_enregistrer_programmation((SELECT evt FROM t),
  jsonb_build_array(pg_temp.carte('zd', 15, '18:00', 60, (SELECT type_a FROM t), 'Dora')), false) AS res;
CREATE FUNCTION pg_temp.brouillon() RETURNS uuid LANGUAGE sql AS
  $$ SELECT ((SELECT res FROM b)->>'evenement_id')::uuid $$;
SELECT is((SELECT statut::text FROM plateforme.collectes WHERE evenement_id = pg_temp.brouillon()), 'brouillon',
  'brouillon : la collecte est en brouillon');
SELECT is(pg_temp.contact(((SELECT res FROM b)->'collecte_ids'->>0)::uuid), 'Dora / -',
  'brouillon : la carte porte ses contacts');
SELECT is((SELECT count(*)::int FROM plateforme.outbox_events
            WHERE aggregate_id = ((SELECT res FROM b)->'collecte_ids'->>0)::uuid), 0,
  'brouillon : aucun ordre au prestataire');

SELECT plateforme.fn_enregistrer_programmation(
  (SELECT evt FROM t) || '{"nom_evenement": "Gala B2 repris"}'::jsonb,
  jsonb_build_array(
    pg_temp.carte('zd', 16, '18:00', 70, (SELECT type_a FROM t), 'Eva'),
    pg_temp.carte('ag', 16, '23:00', 70, (SELECT type_b FROM t), 'Félix')), false,
  pg_temp.brouillon());
SELECT is((SELECT count(*)::int FROM plateforme.collectes WHERE evenement_id = pg_temp.brouillon()), 2,
  'reprise du brouillon : ses collectes sont remplacées par les cartes du formulaire');
SELECT is((SELECT nom_evenement FROM plateforme.evenements WHERE id = pg_temp.brouillon()), 'Gala B2 repris',
  'reprise du brouillon : l’événement prend les valeurs du formulaire');
SELECT is((SELECT count(*)::int FROM plateforme.collectes
            WHERE id = ((SELECT res FROM b)->'collecte_ids'->>0)::uuid), 0,
  'reprise du brouillon : l’ancienne collecte n’existe plus');

SELECT plateforme.fn_enregistrer_programmation((SELECT evt FROM t),
  jsonb_build_array(pg_temp.carte('zd', 16, '18:00', 70, (SELECT type_a FROM t), 'Eva')), true,
  pg_temp.brouillon());
SELECT is((SELECT array_agg(statut::text) FROM plateforme.collectes WHERE evenement_id = pg_temp.brouillon()),
  ARRAY['programmee'], 'reprise confirmée : la collecte est programmée');
SELECT is((SELECT count(*)::int FROM plateforme.outbox_events o JOIN plateforme.collectes c ON c.id = o.aggregate_id
            WHERE c.evenement_id = pg_temp.brouillon() AND o.event_type = 'collecte.creee'), 1,
  'reprise confirmée : son ordre de création part');
SELECT throws_ok(
  format($$ SELECT plateforme.fn_enregistrer_programmation(%L::jsonb, %L::jsonb, true, %L::uuid) $$,
    (SELECT evt FROM t),
    jsonb_build_array(pg_temp.carte('zd', 17, '18:00', 70, (SELECT type_a FROM t), 'Gil')),
    pg_temp.brouillon()),
  '22023', 'Des collectes sont déjà confirmées',
  'un événement déjà confirmé ne se reprend pas comme un brouillon');

-- ── Ajout d'une collecte à un événement existant ────────────────────────────
CREATE TEMP TABLE a ON COMMIT DROP AS
SELECT plateforme.fn_creer_collecte_carte(pg_temp.evt_id(),
  pg_temp.carte('ag', 14, '22:00', 90, (SELECT type_b FROM t), 'Hugo', 'Iris'), false, NULL, true) AS id;
SELECT is(pg_temp.contact((SELECT id FROM a)), 'Hugo / Iris', 'ajout : la collecte porte les contacts de sa carte');
SELECT is((SELECT type_evenement_id FROM plateforme.collectes WHERE id = (SELECT id FROM a)), (SELECT type_b FROM t),
  'ajout : la collecte porte le type de sa carte');

-- ── Lieu modifié, contrôle d'accès, type d'une carte brouillon ─────────────
UPDATE plateforme.lieux SET controle_acces_requis_default = false
 WHERE id = ((SELECT evt FROM t)->>'lieu_id')::uuid;
CREATE TEMP TABLE o ON COMMIT DROP AS
SELECT plateforme.fn_enregistrer_programmation(
  (SELECT evt FROM t) || '{"controle_acces_requis": true, "lieu_overrides": {"adresse_acces": "Quai 2"}}'::jsonb,
  jsonb_build_array(
    pg_temp.carte('zd', 18, '19:00', 60, (SELECT type_a FROM t), 'Jade'),
    pg_temp.carte('ag', 18, '23:00', 60, (SELECT type_a FROM t), 'Kim')),
  true) AS res;
SELECT is(
  (SELECT array_agg(DISTINCT lieu_overrides->>'adresse_acces') FROM plateforme.collectes
    WHERE evenement_id = ((SELECT res FROM o)->>'evenement_id')::uuid),
  ARRAY['Quai 2'], 'lieu modifié : porté par chaque collecte');
SELECT is(
  (SELECT payload->'lieu_overrides'->>'adresse_acces' FROM plateforme.outbox_events
    WHERE event_type = 'collecte.creee'
      AND aggregate_id = ((SELECT res FROM o)->'collecte_ids'->>0)::uuid),
  'Quai 2', 'lieu modifié : transmis dans l’ordre de création de la Zéro-Déchet');
SELECT ok(
  (SELECT bool_and(controle_acces_requis) FROM plateforme.collectes
    WHERE evenement_id = ((SELECT res FROM o)->>'evenement_id')::uuid),
  'contrôle d’accès : porté par chaque collecte');
SELECT ok(
  (SELECT controle_acces_requis_default FROM plateforme.lieux
    WHERE id = ((SELECT evt FROM t)->>'lieu_id')::uuid),
  'contrôle d’accès : reporté sur le lieu (montant seulement, R9)');

CREATE TEMP TABLE d ON COMMIT DROP AS
SELECT plateforme.fn_enregistrer_programmation((SELECT evt FROM t),
  jsonb_build_array(
    pg_temp.carte('zd', 19, '19:00', 60, (SELECT type_a FROM t), 'Léo'),
    pg_temp.carte('ag', 19, '23:00', 60, (SELECT type_a FROM t), 'Mia')),
  false) AS res;
SELECT is(
  (SELECT array_agg(type::text ORDER BY heure_collecte) FROM plateforme.collectes
    WHERE evenement_id = ((SELECT res FROM d)->>'evenement_id')::uuid),
  ARRAY['zero_dechet', 'anti_gaspi'],
  'brouillon : une carte zd devient une Zéro-Déchet, une carte ag une Anti-Gaspi');

-- ── Colonnes écrites : heure, téléphones, brouillon complet ─────────────────
SELECT is((SELECT heure_collecte FROM plateforme.collectes WHERE id = pg_temp.cid(3)), '22:00'::time,
  'confirmée : l’heure de la carte');
SELECT is(
  (SELECT contact_principal_telephone || ' / ' || contact_secours_telephone
     FROM plateforme.collecte_contacts WHERE collecte_id = pg_temp.cid(1)),
  '0600000120 / 0700000000', 'confirmée : téléphones principal et de secours de la carte');

CREATE TEMP TABLE b3 ON COMMIT DROP AS
SELECT plateforme.fn_enregistrer_programmation(
  (SELECT evt FROM t) || '{"controle_acces_requis": true, "lieu_overrides": {"ville": "Saint-Ouen"}}'::jsonb,
  jsonb_build_array(pg_temp.carte('zd', 21, '07:30', 45, (SELECT type_b FROM t), 'Nora', 'Omar')),
  false) AS res;
SELECT is(
  (SELECT jsonb_build_object('date', date_collecte, 'heure', heure_collecte, 'pax', pax,
            'controle', controle_acces_requis, 'ville', lieu_overrides->>'ville',
            'infos', informations_supplementaires, 'type', type_evenement_id, 'statut', statut)
     FROM plateforme.collectes WHERE id = ((SELECT res FROM b3)->'collecte_ids'->>0)::uuid),
  jsonb_build_object('date', CURRENT_DATE + 21, 'heure', '07:30:00', 'pax', 45,
            'controle', true, 'ville', 'Saint-Ouen', 'infos', 'Quai Nora',
            'type', (SELECT type_b FROM t), 'statut', 'brouillon'),
  'brouillon : date, heure, convives, contrôle d’accès, lieu modifié, informations et type de la carte');
SELECT is(
  (SELECT contact_principal_nom || ' ' || contact_principal_telephone || ' / ' || contact_secours_nom || ' ' || contact_secours_telephone
     FROM plateforme.collecte_contacts WHERE collecte_id = ((SELECT res FROM b3)->'collecte_ids'->>0)::uuid),
  'Nora 0600000045 / Omar 0700000000', 'brouillon : contacts et téléphones de la carte');

-- ── Reprise : le lieu et le traiteur opérant suivent le formulaire ──────────
CREATE TEMP TABLE autres ON COMMIT DROP AS
SELECT NULL::uuid AS lieu, NULL::uuid AS org;
WITH l AS (
  INSERT INTO plateforme.lieux
  SELECT (jsonb_populate_record(NULL::plateforme.lieux,
            to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'nom', 'Lieu B2 bis'))).*
    FROM plateforme.lieux x WHERE x.id = ((SELECT evt FROM t)->>'lieu_id')::uuid
  RETURNING id)
UPDATE autres SET lieu = (SELECT id FROM l);
WITH o AS (
  INSERT INTO plateforme.organisations
  SELECT (jsonb_populate_record(NULL::plateforme.organisations,
            to_jsonb(x) || jsonb_build_object('id', gen_random_uuid(), 'nom', 'Traiteur B2 bis', 'siret', NULL))).*
    FROM plateforme.organisations x WHERE x.id = ((SELECT evt FROM t)->>'organisation_id')::uuid
  RETURNING id)
UPDATE autres SET org = (SELECT id FROM o);
SELECT plateforme.fn_enregistrer_programmation(
  (SELECT evt FROM t) || jsonb_build_object('lieu_id', (SELECT lieu FROM autres),
                                            'traiteur_operationnel_organisation_id', (SELECT org FROM autres)),
  jsonb_build_array(pg_temp.carte('zd', 22, '18:00', 40, (SELECT type_a FROM t), 'Paul')), false,
  ((SELECT res FROM b3)->>'evenement_id')::uuid);
SELECT is(
  (SELECT jsonb_build_object('lieu', lieu_id, 'traiteur', traiteur_operationnel_organisation_id)
     FROM plateforme.evenements WHERE id = ((SELECT res FROM b3)->>'evenement_id')::uuid),
  jsonb_build_object('lieu', (SELECT lieu FROM autres), 'traiteur', (SELECT org FROM autres)),
  'reprise : le lieu et le traiteur opérant du formulaire remplacent ceux du brouillon');

-- ── Brouillon : convives et type de collecte contrôlés aussi en base ────────
SELECT throws_ok(
  format($$ SELECT plateforme.fn_enregistrer_programmation(%L::jsonb, %L::jsonb, false) $$,
    (SELECT evt FROM t),
    jsonb_build_array(pg_temp.carte('zd', 23, '19:00', 0, (SELECT type_a FROM t), 'Zéro'))),
  'P0001', NULL, 'brouillon aux convives invalides : refusé par la base');
SELECT throws_ok(
  format($$ SELECT plateforme.fn_enregistrer_programmation(%L::jsonb, %L::jsonb, false) $$,
    (SELECT evt FROM t),
    jsonb_build_array(pg_temp.carte('zd', 23, '19:00', 50, (SELECT type_a FROM t), 'Typ') || '{"type": "xx"}'::jsonb)),
  'P0001', 'TYPE_COLLECTE_INVALIDE: type de collecte attendu zd ou ag (reçu xx)',
  'type de collecte inconnu : refusé par la base, jamais écrit en Anti-Gaspi');

-- ── Plafond Zéro-Déchet et ordre de création des cartes ─────────────────────
SELECT throws_ok(
  format($$ SELECT plateforme.fn_enregistrer_programmation(%L::jsonb, %L::jsonb, false) $$,
    (SELECT evt FROM t),
    (SELECT jsonb_agg(pg_temp.carte('zd', 20 + g, '19:00', 50, (SELECT type_a FROM t), 'Zd' || g))
       FROM generate_series(1, 11) g)),
  'P0001', 'PLAFOND_COLLECTES: au plus 10 collectes Zéro-Déchet et 10 Anti-Gaspi par programmation',
  'onze collectes Zéro-Déchet : refusé');

CREATE TEMP TABLE m ON COMMIT DROP AS
SELECT plateforme.fn_enregistrer_programmation((SELECT evt FROM t),
  jsonb_build_array(
    pg_temp.carte('zd', 25, '19:00', 100, (SELECT type_a FROM t), 'Un'),
    pg_temp.carte('zd', 25, '19:00', 200, (SELECT type_a FROM t), 'Deux'),
    pg_temp.carte('zd', 25, '19:00', 300, (SELECT type_a FROM t), 'Trois')), true) AS res;
SELECT is(
  (SELECT array_agg(pax ORDER BY created_at) FROM plateforme.collectes
    WHERE evenement_id = ((SELECT res FROM m)->>'evenement_id')::uuid),
  ARRAY[100, 200, 300],
  'même date et même heure : les collectes se suivent dans l’ordre des cartes (numérotation et collecte n°1 départagées)');
SELECT is(
  (SELECT count(DISTINCT created_at)::int FROM plateforme.collectes
    WHERE evenement_id = ((SELECT res FROM m)->>'evenement_id')::uuid),
  3, 'même opération : trois heures de création distinctes');

-- ── Fermées aux rôles clients ───────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.fn_enregistrer_programmation(jsonb, jsonb, boolean, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'plateforme.fn_enregistrer_programmation(jsonb, jsonb, boolean, uuid)', 'EXECUTE'),
  'fn_enregistrer_programmation : EXECUTE refusé à authenticated et anon');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.fn_creer_collecte_carte(uuid, jsonb, boolean, jsonb, boolean)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'plateforme.fn_creer_collecte_carte(uuid, jsonb, boolean, jsonb, boolean)', 'EXECUTE'),
  'fn_creer_collecte_carte : EXECUTE refusé à authenticated et anon');

SELECT * FROM finish();
ROLLBACK;
