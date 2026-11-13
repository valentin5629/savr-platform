-- =============================================================================
-- Changement de l'association d'une collecte AG déjà attribuée
-- =============================================================================
-- Décisions Val 2026-11-13 : la commande MTS-1 en cours est annulée puis
-- recréée (tournées réinitialisées dans la transaction, anciennes commandes
-- passées à l'ordre de création) ; une commande chez un autre prestataire
-- (A Toute!) reçoit une modification ; la nouvelle association reçoit l'email
-- d'attribution ; collecte programmée ou validée seulement.
-- Migration : 20261113180000_plateforme_changer_association_ag.sql
-- Exécution : supabase test db (job CI pgtap-rls-outbox).
-- =============================================================================

BEGIN;
SELECT plan(21);

-- Collecte AG commandée chez MTS-1 (tournée rang 1 avec commande, cf. helper).
CREATE TEMP TABLE t_c ON COMMIT DROP AS
  SELECT tests.outbox_fixture_collecte('anti_gaspi') AS id;

INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact)
VALUES
  ('a5c00001-0000-0000-0000-000000000001'::uuid, 'Asso Ancienne', '1 rue', 'idf', 'Paris', 'a1@test.com', 'Association de test pour le changement d''association.'),
  ('a5c00001-0000-0000-0000-000000000002'::uuid, 'Asso Nouvelle', '2 rue', 'idf', 'Paris', 'a2@test.com', 'Association de test pour le changement d''association.'),
  ('a5c00001-0000-0000-0000-000000000003'::uuid, 'Asso Inactive', '3 rue', 'idf', 'Paris', 'a3@test.com', 'Association de test pour le changement d''association.');
UPDATE plateforme.associations SET actif = false
WHERE id = 'a5c00001-0000-0000-0000-000000000003';

INSERT INTO plateforme.attributions_antgaspi (collecte_id, association_id, transporteur_id, branche_attribution, mode_validation)
SELECT c.id, 'a5c00001-0000-0000-0000-000000000001'::uuid, t.id, 'ag_marathon_nuit', 'manuel_top1'
FROM t_c c
JOIN plateforme.collectes col ON col.id = c.id
JOIN plateforme.transporteurs t ON t.prestataire_logistique_id = col.prestataire_logistique_id;

-- État « commande reçue » : référence d'affichage, statut logistique posé.
UPDATE plateforme.collectes
SET tms_reference = 'FIXTURE-CMD-AFFICHAGE', statut_tms = 'a_attribuer'
WHERE id = (SELECT id FROM t_c);

CREATE TEMP TABLE t_avant ON COMMIT DROP AS
  SELECT t.external_ref_commande AS ref, t.reference_interne AS refint
  FROM plateforme.tournees t
  JOIN plateforme.collecte_tournees ct ON ct.tournee_id = t.id
  WHERE ct.collecte_id = (SELECT id FROM t_c);

-- ─── 1-9. MTS-1 : annuler et recréer ─────────────────────────────────────────
SELECT is(
  plateforme.fn_changer_association_ag(
    (SELECT id FROM t_c), 'a5c00001-0000-0000-0000-000000000002'::uuid,
    NULL, 'autre', 'Association plus proche du lieu'),
  'collecte.creee',
  'MTS-1 commandé : le changement émet un ordre de création'
);

SELECT is(
  (SELECT association_id FROM plateforme.attributions_antgaspi WHERE collecte_id = (SELECT id FROM t_c)),
  'a5c00001-0000-0000-0000-000000000002'::uuid,
  'l''attribution porte la nouvelle association'
);

SELECT is(
  (SELECT motif_override || '|' || motif_override_libre FROM plateforme.attributions_antgaspi
    WHERE collecte_id = (SELECT id FROM t_c)),
  'autre|Association plus proche du lieu',
  'le motif est rangé sur l''attribution'
);

SELECT is(
  (SELECT payload->'commandes_a_annuler' FROM plateforme.outbox_events
    WHERE aggregate_id = (SELECT id FROM t_c) AND event_type = 'collecte.creee'
      AND payload->>'origine' = 'changement_association'),
  (SELECT jsonb_build_array(ref) FROM t_avant),
  'l''ordre de création porte l''ancienne commande à annuler'
);

SELECT is(
  (SELECT consumer FROM plateforme.outbox_events
    WHERE aggregate_id = (SELECT id FROM t_c) AND payload->>'origine' = 'changement_association'
      AND event_type = 'collecte.creee'),
  'adapter_mts1',
  'l''ordre de création va à l''adapter MTS-1'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.tournees t
    JOIN plateforme.collecte_tournees ct ON ct.tournee_id = t.id
    WHERE ct.collecte_id = (SELECT id FROM t_c) AND t.external_ref_commande IS NULL
      AND t.statut = 'planifiee' AND t.reference_interne = (SELECT refint FROM t_avant) || '-r2'),
  1,
  'la tournée est réinitialisée en place, nouvelle tentative -r2 (nouvelle clé de commande)'
);

SELECT is(
  (SELECT coalesce(tms_reference, '∅') || '|' || statut_tms::text FROM plateforme.collectes
    WHERE id = (SELECT id FROM t_c)),
  '∅|non_envoye',
  'la collecte n''a plus de commande : référence effacée, statut logistique non envoyé'
);

SELECT ok(
  NOT plateforme.fn_collecte_commandee_chez_provider((SELECT id FROM t_c)),
  'plus aucune commande enregistrée : une modification suivante attend la recréation'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = (SELECT id FROM t_c) AND event_type = 'attribution.validee'
      AND consumer = 'attribution_job'
      AND payload->>'association_id' = 'a5c00001-0000-0000-0000-000000000002'),
  1,
  'la nouvelle association reçoit l''email d''attribution (job attribution)'
);

SELECT is(
  (SELECT new_values->>'association_id' FROM plateforme.audit_log
    WHERE action = 'CHANGEMENT_ASSOCIATION'
      AND old_values->>'association_id' = 'a5c00001-0000-0000-0000-000000000001'),
  'a5c00001-0000-0000-0000-000000000002',
  'le changement est tracé dans le journal d''audit (ancienne et nouvelle association)'
);

-- ─── 10-11. Rien de commandé : aucun ordre logistique ────────────────────────
-- (la commande vient d'être réinitialisée : l'ordre de création en file lira
-- l'association courante)
SELECT is(
  plateforme.fn_changer_association_ag(
    (SELECT id FROM t_c), 'a5c00001-0000-0000-0000-000000000001'::uuid, NULL),
  'aucun',
  'aucune commande en cours : aucun ordre logistique supplémentaire'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = (SELECT id FROM t_c) AND event_type = 'attribution.validee'),
  1,
  'un email d''attribution encore en attente (relit l''association courante) : pas de doublon'
);

-- Le premier email est parti : un nouveau changement en remet un en file.
UPDATE plateforme.outbox_events SET statut = 'done'
WHERE aggregate_id = (SELECT id FROM t_c) AND event_type = 'attribution.validee';
SELECT plateforme.fn_changer_association_ag(
  (SELECT id FROM t_c), 'a5c00001-0000-0000-0000-000000000002'::uuid, NULL);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = (SELECT id FROM t_c) AND event_type = 'attribution.validee'
      AND statut = 'pending'),
  1,
  'email précédent parti : la nouvelle association reçoit le sien'
);
-- (retour à l'association 1 pour la suite)
SELECT plateforme.fn_changer_association_ag(
  (SELECT id FROM t_c), 'a5c00001-0000-0000-0000-000000000001'::uuid, NULL);

-- ─── 12. A Toute! commandé : modification de la mission ─────────────────────
-- (type_tms immuable : un second prestataire, A Toute!, porte la collecte)
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut, created_at, updated_at)
VALUES ('a5c0e000-0000-0000-0000-000000000001'::uuid, 'Presta A Toute! test', 'FIXTURE_ASSO_ATOUTES',
        ARRAY['ag'], 'manuel', 'actif', now(), now());
INSERT INTO plateforme.transporteurs (
  nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
  contact_nom, contact_email, contact_telephone, prestataire_logistique_id, created_at
) VALUES (
  'A Toute! test', '999000002', '1 rue', '75001', 'Paris', ARRAY['velo_cargo'], 'a_toutes',
  'Contact', 'atoutes@test.internal', '+33600000002', 'a5c0e000-0000-0000-0000-000000000001'::uuid, now()
);
UPDATE plateforme.collectes SET prestataire_logistique_id = 'a5c0e000-0000-0000-0000-000000000001'
WHERE id = (SELECT id FROM t_c);
UPDATE plateforme.tournees t
SET external_ref_commande = 'MISSION-ATOUTE-1',
    prestataire_logistique_id = 'a5c0e000-0000-0000-0000-000000000001'
FROM plateforme.collecte_tournees ct
WHERE ct.tournee_id = t.id AND ct.collecte_id = (SELECT id FROM t_c);

SELECT is(
  plateforme.fn_changer_association_ag(
    (SELECT id FROM t_c), 'a5c00001-0000-0000-0000-000000000002'::uuid, NULL),
  'collecte.modifiee',
  'A Toute! commandé : une modification renvoie l''adresse de fin de mission'
);

-- ─── 13-17. Refus ────────────────────────────────────────────────────────────
SELECT throws_ok(
  format($$SELECT plateforme.fn_changer_association_ag(%L, 'a5c00001-0000-0000-0000-000000000002', NULL)$$,
         (SELECT id FROM t_c)),
  'P0046', NULL, 'même association : refusé'
);

SELECT throws_ok(
  format($$SELECT plateforme.fn_changer_association_ag(%L, 'a5c00001-0000-0000-0000-000000000003', NULL)$$,
         (SELECT id FROM t_c)),
  'P0047', NULL, 'association inactive : refusée'
);

UPDATE plateforme.collectes SET statut = 'en_cours' WHERE id = (SELECT id FROM t_c);
SELECT throws_ok(
  format($$SELECT plateforme.fn_changer_association_ag(%L, 'a5c00001-0000-0000-0000-000000000001', NULL)$$,
         (SELECT id FROM t_c)),
  'P0043', NULL, 'mission commencée (en_cours) : refusé'
);
UPDATE plateforme.collectes SET statut = 'validee' WHERE id = (SELECT id FROM t_c);
SELECT lives_ok(
  format($$SELECT plateforme.fn_changer_association_ag(%L, 'a5c00001-0000-0000-0000-000000000001', NULL)$$,
         (SELECT id FROM t_c)),
  'collecte validée : accepté'
);

DELETE FROM plateforme.attributions_antgaspi WHERE collecte_id = (SELECT id FROM t_c);
SELECT throws_ok(
  format($$SELECT plateforme.fn_changer_association_ag(%L, 'a5c00001-0000-0000-0000-000000000002', NULL)$$,
         (SELECT id FROM t_c)),
  'P0045', NULL, 'sans attribution : refusé'
);

-- ─── 18-19. Droits : fonction SECURITY DEFINER fermée ────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_changer_association_ag(uuid, uuid, uuid, text, text)', 'EXECUTE'),
  'authenticated n''exécute pas fn_changer_association_ag'
);

SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.fn_changer_association_ag(uuid, uuid, uuid, text, text)', 'EXECUTE'),
  'anon n''exécute pas fn_changer_association_ag'
);

SELECT * FROM finish();
ROLLBACK;
