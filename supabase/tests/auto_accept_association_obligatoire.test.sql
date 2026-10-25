-- =============================================================================
-- pgTAP — Auto-accept AG : association obligatoire (décision Val I4 du 2026-10-25)
-- Migration : 20261025200000_plateforme_auto_accept_association_obligatoire.sql
-- =============================================================================
-- Une règle sans association ne se déclenche jamais (le top 1 doit égaler
-- l'association de la règle) : la base la refuse, même au rôle qui contourne
-- la RLS. La règle complète, elle, s'insère toujours.
-- =============================================================================

BEGIN;
SELECT plan(4);

SELECT col_not_null('plateforme', 'config_auto_accept_ag', 'association_id',
  'association_id est NOT NULL');
SELECT col_is_null('plateforme', 'config_auto_accept_ag', 'transporteur_id',
  'transporteur_id reste facultatif (NULL = tout transporteur)');

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, est_shadow, cree_par_organisation_id)
VALUES ('a4a40000-0000-0000-0000-000000000001'::uuid, 'I4 Traiteur', 'I4 Traiteur SAS', 'traiteur', '77740000000001', true, false, NULL);

INSERT INTO plateforme.associations (id, nom, adresse, ville, region, contact_email, capacite_max_beneficiaires,
  actif, description_rapport_impact, latitude, longitude)
VALUES ('a4a40000-0000-0000-0000-000000000040'::uuid, 'Asso I4', '4 rue I4', 'Paris', 'idf', 'asso@i4.test', 100,
  true, 'Association des tests du lot I4.', 48.8700, 2.3400);

SELECT throws_ok(
  $$INSERT INTO plateforme.config_auto_accept_ag (organisation_id, association_id, auto_accept_actif)
    VALUES ('a4a40000-0000-0000-0000-000000000001'::uuid, NULL, true)$$,
  '23502',
  NULL,
  'une règle sans association est refusée (not_null_violation)'
);

SELECT lives_ok(
  $$INSERT INTO plateforme.config_auto_accept_ag (organisation_id, association_id, auto_accept_actif)
    VALUES ('a4a40000-0000-0000-0000-000000000001'::uuid, 'a4a40000-0000-0000-0000-000000000040'::uuid, true)$$,
  'une règle avec association s''insère'
);

SELECT * FROM finish();
ROLLBACK;
