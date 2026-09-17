-- =============================================================================
-- Réattribution vers le même type de transporteur : tournées refusées
-- réinitialisées en place, la commande repart (E1)
-- =============================================================================
-- Source : §08 §3 V1 / §3bis.6 (refus transporteur → retour file Ops-driven) +
-- arbitrage Val 2026-09-17 (« réinitialiser en place »).
-- Migration : 20260917160000_plateforme_reattribution_reinit_tournees_refusees.sql
--
-- Oracle = l'event émis. Avant correctif (mesuré, transaction annulée), les cas
-- A et B émettaient `collecte.modifiee` : no-op côté vélo, modification d'une
-- commande annulée côté camion, rien de recommandé.
-- Les fixtures posent l'état que les chemins de refus écrivent réellement :
-- référence de commande committée, tournée `annulee` (polling MTS-1) ou mission
-- `failed` / `cancelled_externally` (webhook A Toutes!), collecte rejetée.
-- Exécution : supabase test db (job CI pgtap-rls-outbox).
-- =============================================================================

BEGIN;
SELECT plan(17);

-- ── Référentiel ──────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('e3aa0000-0000-0000-0000-000000000001', 'Traiteur Reatt', 'traiteur', true, false, 'E3AA0000000001', 'reatt@test.internal');
INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('e3aa0000-0000-0000-0000-0000000000e0', 'cocktail_reatt', 'Cocktail Reatt');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('e3aa0000-0000-0000-0000-0000000000a0', 'e3aa0000-0000-0000-0000-000000000001', 'u@reatt.test', 'U', 'Reatt', 'traiteur_manager');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('e3aa0000-0000-0000-0000-0000000000f0', 'e3aa0000-0000-0000-0000-000000000001', 'Reatt SARL', 'E3AA0000000001', '1 rue', '75001', 'Paris');
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('e3aa0000-0000-0000-0000-0000000000b0', 'Salle Reatt', '1 rue', '75001', 'Paris', 'fourgon');
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut) VALUES
  ('e3aa0000-0000-0000-0000-0000000000d0', 'Camion A', 'REATT-CAMA', ARRAY['zd','ag'], 'manuel', 'actif'),
  ('e3aa0000-0000-0000-0000-0000000000d2', 'Camion B', 'REATT-CAMB', ARRAY['zd','ag'], 'manuel', 'actif'),
  ('e3aa0000-0000-0000-0000-0000000000d1', 'Velo',     'REATT-VELO', ARRAY['ag'], 'manuel', 'actif');
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms, contact_nom, contact_email, contact_telephone, prestataire_logistique_id, code_transporteur_mts1) VALUES
  ('e3aa0000-0000-0000-0000-00000000001a', 'Camion A', '920000001', '1 rue', '75001', 'Paris', ARRAY['fourgon'], 'mts1', 'C', 'a@reatt.invalid', '+33600000000', 'e3aa0000-0000-0000-0000-0000000000d0', 'REATT-A'),
  ('e3aa0000-0000-0000-0000-00000000001c', 'Camion B', '920000003', '1 rue', '75001', 'Paris', ARRAY['fourgon'], 'mts1', 'C', 'b@reatt.invalid', '+33600000002', 'e3aa0000-0000-0000-0000-0000000000d2', 'REATT-B'),
  ('e3aa0000-0000-0000-0000-00000000001b', 'Velo',     '920000002', '1 rue', '75001', 'Paris', ARRAY['velo_cargo'], 'a_toutes', 'V', 'v@reatt.invalid', '+33600000001', 'e3aa0000-0000-0000-0000-0000000000d1', NULL);
INSERT INTO plateforme.evenements (id, organisation_id, lieu_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone)
SELECT ('e3aa0000-0000-0000-0000-0000000000e' || n)::uuid, 'e3aa0000-0000-0000-0000-000000000001', 'e3aa0000-0000-0000-0000-0000000000b0', 'e3aa0000-0000-0000-0000-000000000001', 'e3aa0000-0000-0000-0000-0000000000f0', 'e3aa0000-0000-0000-0000-0000000000a0', 'e3aa0000-0000-0000-0000-0000000000e0', current_date + 10, 100, 'Contact', '0600000000'
FROM generate_series(1, 6) n;

-- ── Collectes ────────────────────────────────────────────────────────────────
--   c1 AG refusée par A Toutes! (webhook mission_failed)      → réattribuée vélo
--   c2 ZD MTS-1 tous tours KO (tournée annulee)                → réattribuée camion B
--   c3 AG refusée par A Toutes! (annulation externe)           → réattribuée camion
--   c4 ZD MTS-1 2 camions, rang 1 KO, rang 2 vivant (rejet posé par le rang 1)
--   c5 ZD validee, rang 1 annulee — renvoi Ops, PAS une réattribution
--   c6 ZD MTS-1 tous tours KO, mais pesées déjà enregistrées sur la tournée
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, prestataire_logistique_id, nb_camions_demande, tms_reference) VALUES
  ('e3aa0000-0000-0000-0000-0000000000c1', 'e3aa0000-0000-0000-0000-0000000000e1', 'anti_gaspi',  'rejetee_par_prestataire', 'rejetee_par_prestataire', current_date + 10, '20:00', 'e3aa0000-0000-0000-0000-0000000000d1', 1, 'MISSION-REATT-1'),
  ('e3aa0000-0000-0000-0000-0000000000c2', 'e3aa0000-0000-0000-0000-0000000000e2', 'zero_dechet', 'rejetee_par_prestataire', 'rejetee_par_prestataire', current_date + 10, '02:00', 'e3aa0000-0000-0000-0000-0000000000d0', 1, 'TOUR-REATT-2'),
  ('e3aa0000-0000-0000-0000-0000000000c3', 'e3aa0000-0000-0000-0000-0000000000e3', 'anti_gaspi',  'rejetee_par_prestataire', 'rejetee_par_prestataire', current_date + 10, '20:00', 'e3aa0000-0000-0000-0000-0000000000d1', 1, 'MISSION-REATT-3'),
  ('e3aa0000-0000-0000-0000-0000000000c4', 'e3aa0000-0000-0000-0000-0000000000e4', 'zero_dechet', 'programmee',              'rejetee_par_prestataire', current_date + 10, '02:00', 'e3aa0000-0000-0000-0000-0000000000d0', 2, 'TOUR-REATT-4R1'),
  ('e3aa0000-0000-0000-0000-0000000000c5', 'e3aa0000-0000-0000-0000-0000000000e5', 'zero_dechet', 'validee',                 'acceptee',                current_date + 10, '02:00', 'e3aa0000-0000-0000-0000-0000000000d0', 1, 'TOUR-REATT-5'),
  ('e3aa0000-0000-0000-0000-0000000000c6', 'e3aa0000-0000-0000-0000-0000000000e6', 'zero_dechet', 'rejetee_par_prestataire', 'rejetee_par_prestataire', current_date + 10, '02:00', 'e3aa0000-0000-0000-0000-0000000000d0', 1, 'TOUR-REATT-6');

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut, external_ref_commande, tms_reference, plaque_immatriculation, chauffeur_nom) VALUES
  ('e3aa0000-0000-0000-0000-0000000000a1', 'EVR-e3aa0000-0000-0000-0000-0000000000c1-1', current_date + 10, 'soir', 'e3aa0000-0000-0000-0000-0000000000d1', 'planifiee', 'MISSION-REATT-1', NULL, NULL, NULL),
  ('e3aa0000-0000-0000-0000-0000000000a2', 'TMS-e3aa0000-0000-0000-0000-0000000000c2-1', current_date + 10, 'nuit', 'e3aa0000-0000-0000-0000-0000000000d0', 'annulee',   'CO-REATT-2', 'TOUR-REATT-2', 'AA-123-AA', 'Chauffeur KO'),
  ('e3aa0000-0000-0000-0000-0000000000a3', 'EVR-e3aa0000-0000-0000-0000-0000000000c3-1', current_date + 10, 'soir', 'e3aa0000-0000-0000-0000-0000000000d1', 'planifiee', 'MISSION-REATT-3', NULL, NULL, NULL),
  ('e3aa0000-0000-0000-0000-0000000000a4', 'TMS-e3aa0000-0000-0000-0000-0000000000c4-1', current_date + 10, 'nuit', 'e3aa0000-0000-0000-0000-0000000000d0', 'annulee',   'CO-REATT-4R1', 'TOUR-REATT-4R1', NULL, NULL),
  ('e3aa0000-0000-0000-0000-0000000000b4', 'TMS-e3aa0000-0000-0000-0000-0000000000c4-2', current_date + 10, 'nuit', 'e3aa0000-0000-0000-0000-0000000000d0', 'en_cours',  'CO-REATT-4R2', 'TOUR-REATT-4R2', NULL, NULL),
  ('e3aa0000-0000-0000-0000-0000000000a5', 'TMS-e3aa0000-0000-0000-0000-0000000000c5-1', current_date + 10, 'nuit', 'e3aa0000-0000-0000-0000-0000000000d0', 'annulee',   'CO-REATT-5', 'TOUR-REATT-5', NULL, NULL),
  ('e3aa0000-0000-0000-0000-0000000000a6', 'TMS-e3aa0000-0000-0000-0000-0000000000c6-1', current_date + 10, 'nuit', 'e3aa0000-0000-0000-0000-0000000000d0', 'annulee',   'CO-REATT-6', 'TOUR-REATT-6', NULL, NULL);

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
  ('e3aa0000-0000-0000-0000-0000000000c1', 'e3aa0000-0000-0000-0000-0000000000a1', 1),
  ('e3aa0000-0000-0000-0000-0000000000c2', 'e3aa0000-0000-0000-0000-0000000000a2', 1),
  ('e3aa0000-0000-0000-0000-0000000000c3', 'e3aa0000-0000-0000-0000-0000000000a3', 1),
  ('e3aa0000-0000-0000-0000-0000000000c4', 'e3aa0000-0000-0000-0000-0000000000a4', 1),
  ('e3aa0000-0000-0000-0000-0000000000c4', 'e3aa0000-0000-0000-0000-0000000000b4', 2),
  ('e3aa0000-0000-0000-0000-0000000000c5', 'e3aa0000-0000-0000-0000-0000000000a5', 1),
  ('e3aa0000-0000-0000-0000-0000000000c6', 'e3aa0000-0000-0000-0000-0000000000a6', 1);

INSERT INTO plateforme.everest_missions (tournee_id, collecte_id, everest_mission_id, everest_service_id, statut_everest) VALUES
  ('e3aa0000-0000-0000-0000-0000000000a1', 'e3aa0000-0000-0000-0000-0000000000c1', 'MISSION-REATT-1', 71, 'failed'),
  ('e3aa0000-0000-0000-0000-0000000000a3', 'e3aa0000-0000-0000-0000-0000000000c3', 'MISSION-REATT-3', 71, 'cancelled_externally');

INSERT INTO plateforme.pesees_tournees (tournee_id, stop_id, flux_id, poids_kg)
SELECT 'e3aa0000-0000-0000-0000-0000000000a6', 'STOP-REATT-6', id, 12.5
FROM plateforme.flux_dechets LIMIT 1;

-- ─── 1-4. A : refus A Toutes! (webhook) → réattribué à A Toutes! ─────────────
SELECT is(
  plateforme.fn_dispatcher_collecte('e3aa0000-0000-0000-0000-0000000000c1', 'e3aa0000-0000-0000-0000-0000000000d1', 'reattribution'),
  'collecte.creee',
  'A refus A Toutes! puis réattribution à A Toutes! → collecte.creee (la mission failed ne compte plus)'
);

SELECT is(
  (SELECT row(external_ref_commande, statut::text, reference_interne)::text FROM plateforme.tournees WHERE id = 'e3aa0000-0000-0000-0000-0000000000a1'),
  row(NULL::text, 'planifiee', 'EVR-e3aa0000-0000-0000-0000-0000000000c1-1-r2')::text,
  'A tournée réinitialisée en place : référence effacée, planifiee, tentative -r2'
);

SELECT is(
  (SELECT tms_reference FROM plateforme.collectes WHERE id = 'e3aa0000-0000-0000-0000-0000000000c1'),
  NULL,
  'A référence d''affichage du rang 1 effacée (collecte de nouveau « non transmise »)'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.collecte_tournees WHERE collecte_id = 'e3aa0000-0000-0000-0000-0000000000c1'),
  1,
  'A le lien de rang est conservé (réinitialisation en place, aucune tournée détachée)'
);

-- ─── 5-7. B : tous tours MTS-1 KO → réattribué à un autre transporteur MTS-1 ─
SELECT is(
  plateforme.fn_dispatcher_collecte('e3aa0000-0000-0000-0000-0000000000c2', 'e3aa0000-0000-0000-0000-0000000000d2', 'reattribution'),
  'collecte.creee',
  'B tous tours MTS-1 KO puis réattribution à un autre transporteur MTS-1 → collecte.creee'
);

SELECT is(
  (SELECT row(external_ref_commande, tms_reference, statut::text, plaque_immatriculation, chauffeur_nom)::text
     FROM plateforme.tournees WHERE id = 'e3aa0000-0000-0000-0000-0000000000a2'),
  row(NULL::text, NULL::text, 'planifiee', NULL::text, NULL::text)::text,
  'B tournée annulee réinitialisée : commande, tour, plaque et chauffeur effacés (sinon l''adapter sortirait en no-op)'
);

-- Second refus puis seconde réattribution : la tentative s'incrémente.
UPDATE plateforme.tournees SET external_ref_commande = 'CO-REATT-2-BIS', tms_reference = 'TOUR-REATT-2-BIS', statut = 'annulee'
WHERE id = 'e3aa0000-0000-0000-0000-0000000000a2';
UPDATE plateforme.collectes SET statut = 'rejetee_par_prestataire', statut_tms = 'rejetee_par_prestataire'
WHERE id = 'e3aa0000-0000-0000-0000-0000000000c2';
SELECT plateforme.fn_dispatcher_collecte('e3aa0000-0000-0000-0000-0000000000c2', 'e3aa0000-0000-0000-0000-0000000000d0', 'reattribution bis');

SELECT is(
  (SELECT reference_interne FROM plateforme.tournees WHERE id = 'e3aa0000-0000-0000-0000-0000000000a2'),
  'TMS-e3aa0000-0000-0000-0000-0000000000c2-1-r3',
  'B second refus puis réattribution → tentative -r3 (jamais la clé d''une commande précédente)'
);

-- ─── 8. C : refus A Toutes! → réattribué à MTS-1 (non-régression) ────────────
SELECT is(
  plateforme.fn_dispatcher_collecte('e3aa0000-0000-0000-0000-0000000000c3', 'e3aa0000-0000-0000-0000-0000000000d0', 'reattribution camion'),
  'collecte.creee',
  'C refus A Toutes! (annulation externe) puis réattribution à MTS-1 → collecte.creee'
);

-- ─── 9-11. Multi-camions : seul le rang refusé est réinitialisé ──────────────
SELECT is(
  plateforme.fn_dispatcher_collecte('e3aa0000-0000-0000-0000-0000000000c4', NULL, NULL),
  'collecte.modifiee',
  'multi-camions, rang 2 toujours commandé → collecte.modifiee (l''adapter recommande le rang sans commande)'
);

SELECT is(
  (SELECT row(t1.external_ref_commande, t1.statut::text, t2.external_ref_commande, t2.statut::text, t2.reference_interne)::text
     FROM plateforme.tournees t1, plateforme.tournees t2
    WHERE t1.id = 'e3aa0000-0000-0000-0000-0000000000a4' AND t2.id = 'e3aa0000-0000-0000-0000-0000000000b4'),
  row(NULL::text, 'planifiee', 'CO-REATT-4R2', 'en_cours', 'TMS-e3aa0000-0000-0000-0000-0000000000c4-2')::text,
  'multi-camions : rang 1 refusé réinitialisé, rang 2 vivant intact'
);

SELECT is(
  (SELECT tms_reference FROM plateforme.collectes WHERE id = 'e3aa0000-0000-0000-0000-0000000000c4'),
  NULL,
  'multi-camions : rang 1 réinitialisé → référence d''affichage effacée'
);

-- ─── 12-13. Collecte non rejetée : renvoi Ops, rien n'est réinitialisé ───────
SELECT is(
  plateforme.fn_dispatcher_collecte('e3aa0000-0000-0000-0000-0000000000c5', NULL, NULL),
  'collecte.modifiee',
  'collecte validee (pas un rejet) → renvoi Ops inchangé : collecte.modifiee'
);

SELECT is(
  (SELECT row(t.external_ref_commande, t.statut::text, c.tms_reference)::text
     FROM plateforme.tournees t, plateforme.collectes c
    WHERE t.id = 'e3aa0000-0000-0000-0000-0000000000a5' AND c.id = 'e3aa0000-0000-0000-0000-0000000000c5'),
  row('CO-REATT-5', 'annulee', 'TOUR-REATT-5')::text,
  'collecte validee : la tournée annulee et la référence d''affichage ne sont pas touchées'
);

-- ─── 14-15. Tournée refusée avec pesées : réattribution refusée, rien écrit ──
SELECT throws_ok(
  $$ SELECT plateforme.fn_dispatcher_collecte('e3aa0000-0000-0000-0000-0000000000c6', 'e3aa0000-0000-0000-0000-0000000000d2', 'reattribution') $$,
  'P0001',
  'reattribution_tournee_refusee_avec_pesees',
  'tournée refusée portant des pesées → réattribution refusée (décision Ops)'
);

SELECT is(
  (SELECT row(c.statut::text, t.external_ref_commande,
              (SELECT count(*) FROM plateforme.outbox_events WHERE aggregate_id = c.id AND payload->>'dispatch_manuel' = 'true'))::text
     FROM plateforme.collectes c, plateforme.tournees t
    WHERE c.id = 'e3aa0000-0000-0000-0000-0000000000c6' AND t.id = 'e3aa0000-0000-0000-0000-0000000000a6'),
  row('rejetee_par_prestataire', 'CO-REATT-6', 0::bigint)::text,
  'pesées présentes : collecte, tournée et outbox inchangées (transaction annulée)'
);

-- ─── 16-17. Droits : fonction SECURITY DEFINER fermée ────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_dispatcher_collecte(uuid, uuid, text)', 'EXECUTE'),
  'authenticated n''exécute pas fn_dispatcher_collecte'
);

SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.fn_dispatcher_collecte(uuid, uuid, text)', 'EXECUTE'),
  'anon n''exécute pas fn_dispatcher_collecte'
);

SELECT * FROM finish();
ROLLBACK;
