-- =============================================================================
-- G9 — Oracles sémantiques (Lot 0 / R0c) — MODE RAPPORT.
-- =============================================================================
-- Ferme L1 : « livrable présent + test vert MAIS règle métier fausse ». Pour
-- chaque règle SI/ALORS à risque, on compare le comportement RÉEL (trigger/RPC)
-- à l'oracle `fn_est_*` (migration 20260624120000) aux CAS-LIMITES — c'est là
-- que le test « heureux » rate la divergence.
--
-- ⚠ HORS supabase/tests/ À DESSEIN : ce fichier ne doit PAS être ramassé par le
-- job bloquant `pgtap-rls-outbox` (`supabase test db`). Il est exécuté par le job
-- mode-rapport `semantic-oracle` (continue-on-error) via psql -f → ne rougit
-- jamais le build en T0. Flip bloquant (T1) = déplacer dans supabase/tests/.
--
-- Lancement local : psql "$DATABASE_URL" -f supabase/tests-report/g9_semantic_oracle.test.sql
-- =============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(21);

-- =============================================================================
-- Oracle 3 — numérotation gapless (fn_est_numerotation_gapless)
-- =============================================================================
SELECT ok(plateforme.fn_est_numerotation_gapless(ARRAY[1, 2, 3]), 'gapless : [1,2,3] contigu sans doublon');
SELECT ok(plateforme.fn_est_numerotation_gapless(ARRAY[5, 6, 7]), 'gapless : [5,6,7] contigu (n''impose pas le départ à 1)');
SELECT ok(NOT plateforme.fn_est_numerotation_gapless(ARRAY[1, 2, 4]), 'NON gapless : trou interne [1,2,4]');
SELECT ok(NOT plateforme.fn_est_numerotation_gapless(ARRAY[1, 2, 2]), 'NON gapless : doublon [1,2,2]');
SELECT ok(plateforme.fn_est_numerotation_gapless(ARRAY[]::integer[]), 'gapless : séquence vide (trivial)');
SELECT ok(plateforme.fn_est_numerotation_gapless(ARRAY[1]), 'gapless : singleton [1]');

-- Cross-check RÉEL : 3 appels successifs de f_next_numero_facture sur une série
-- fraîche doivent produire exactement 1,2,3 (gapless + départ à 1).
SELECT is(
  (
    SELECT array_agg(x ORDER BY x)
    FROM (
      SELECT plateforme.f_next_numero_facture('ORACLE_TEST_R0C', 2099::smallint) AS x
      FROM generate_series(1, 3)
    ) s
  ),
  ARRAY[1, 2, 3],
  'RÉEL : f_next_numero_facture émet une séquence gapless 1,2,3 (≡ oracle)'
);

-- =============================================================================
-- Oracle 2 — agrégation terminale multi-camions (fn_est_terminal_attendu)
-- =============================================================================
SELECT is(plateforme.fn_est_terminal_attendu(2, 0, 1), 'pending', 'terminal : total(1) < N(2) → pending');
SELECT is(plateforme.fn_est_terminal_attendu(2, 1, 1), 'realisee', 'terminal : total=N, ≥1 terminée → realisee');
SELECT is(plateforme.fn_est_terminal_attendu(2, 0, 2), 'rejetee_par_prestataire', 'terminal : total=N, 0 terminée → rejetee');
SELECT is(plateforme.fn_est_terminal_attendu(1, 1, 0), 'realisee', 'terminal : N=1, 1 terminée → realisee');
SELECT is(plateforme.fn_est_terminal_attendu(3, 2, 0), 'pending', 'terminal : N=3, 2 terminées 0 annulée → pending (borne)');

-- =============================================================================
-- Oracle 1 — débit pack annulation tardive AG (fn_est_debit_pack_attendu)
-- Cas-limite central : seuil 12h STRICT, ancrage Europe/Paris.
-- =============================================================================
-- Au seuil EXACT (now = collecte - 12h) → strict '<' → PAS de débit.
SELECT ok(
  NOT plateforme.fn_est_debit_pack_attendu(
    'validee', 'annulee', 'anti_gaspi', gen_random_uuid(),
    DATE '2099-06-15', TIME '20:00', 'non_envoye',
    (TIMESTAMP '2099-06-15 20:00' AT TIME ZONE 'Europe/Paris') - INTERVAL '12 hours'),
  'débit : seuil 12h EXACT → pas de débit (strict <, anti-régression bug <=)'
);
-- 1 min APRÈS le seuil (< 12h restant) → débit.
SELECT ok(
  plateforme.fn_est_debit_pack_attendu(
    'validee', 'annulee', 'anti_gaspi', gen_random_uuid(),
    DATE '2099-06-15', TIME '20:00', 'non_envoye',
    (TIMESTAMP '2099-06-15 20:00' AT TIME ZONE 'Europe/Paris') - INTERVAL '12 hours' + INTERVAL '1 minute'),
  'débit : < 12h avant collecte → débit'
);
-- 1 min AVANT le seuil (> 12h restant) sans mandat → pas de débit.
SELECT ok(
  NOT plateforme.fn_est_debit_pack_attendu(
    'validee', 'annulee', 'anti_gaspi', gen_random_uuid(),
    DATE '2099-06-15', TIME '20:00', 'non_envoye',
    (TIMESTAMP '2099-06-15 20:00' AT TIME ZONE 'Europe/Paris') - INTERVAL '12 hours' - INTERVAL '1 minute'),
  'débit : > 12h sans mandat → pas de débit'
);
-- > 12h MAIS prestataire mandaté → débit (branche mandat).
SELECT ok(
  plateforme.fn_est_debit_pack_attendu(
    'validee', 'annulee', 'anti_gaspi', gen_random_uuid(),
    DATE '2099-06-15', TIME '20:00', 'acceptee',
    (TIMESTAMP '2099-06-15 20:00' AT TIME ZONE 'Europe/Paris') - INTERVAL '1 day'),
  'débit : > 12h + mandat actif → débit'
);
-- Pas de pack attaché → alerte, PAS de débit.
SELECT ok(
  NOT plateforme.fn_est_debit_pack_attendu(
    'validee', 'annulee', 'anti_gaspi', NULL,
    DATE '2099-06-15', TIME '20:00', 'acceptee', now()),
  'débit : pas de pack attaché → pas de débit (alerte Admin)'
);
-- Type ZD → pas de débit.
SELECT ok(
  NOT plateforme.fn_est_debit_pack_attendu(
    'validee', 'annulee', 'zero_dechet', gen_random_uuid(),
    DATE '2099-06-15', TIME '20:00', 'acceptee', now()),
  'débit : type ZD → pas de débit (AG seulement)'
);
-- Transition depuis realisee → pas de débit (couvert par le trigger de recrédit).
SELECT ok(
  NOT plateforme.fn_est_debit_pack_attendu(
    'realisee', 'annulee', 'anti_gaspi', gen_random_uuid(),
    DATE '2099-06-15', TIME '20:00', 'acceptee', now()),
  'débit : OLD=realisee → pas de débit (annulation post-réalisation gérée ailleurs)'
);

-- =============================================================================
-- Fixtures communes pour les cross-checks RÉELS (oracle 1 & 2).
-- =============================================================================
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('a9000000-0000-0000-0000-000000000001'::uuid, 'OracleOrg R0c', 'OracleOrg R0c', 'traiteur', '90000000900001', true);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('a9000000-0000-0000-0000-000000000009'::uuid, 'ORACLE_EVT', 'Oracle Evt', 1, true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('a9000000-0000-0000-0000-000000000002'::uuid, 'Oracle Lieu', '1 rue Oracle', 'Paris', '75001', 'camionnette');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('a9000000-0000-0000-0000-000000000010'::uuid, 'a9000000-0000-0000-0000-000000000001'::uuid,
  'admin@oracle-r0c.test', 'Admin', 'Oracle', 'admin_savr');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('a9000000-0000-0000-0000-000000000011'::uuid, 'a9000000-0000-0000-0000-000000000001'::uuid,
  'OracleOrg R0c SARL', '90000000900001', '1 rue Oracle', '75001', 'Paris');

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'a9000000-0000-0000-0000-000000000003'::uuid,
  'a9000000-0000-0000-0000-000000000001'::uuid,
  'a9000000-0000-0000-0000-000000000001'::uuid,
  'a9000000-0000-0000-0000-000000000011'::uuid,
  'a9000000-0000-0000-0000-000000000010'::uuid,
  'a9000000-0000-0000-0000-000000000002'::uuid,
  'a9000000-0000-0000-0000-000000000009'::uuid,
  CURRENT_DATE + INTERVAL '30 day', 200, 'Contact Oracle', '0600000001'
);

-- ── Cross-check RÉEL oracle 1 : trigger de débit vs oracle (branche mandat) ──
-- Collecte AG future (> 12h → delai_court FALSE) + prestataire mandaté
-- (statut_tms='acceptee' → mandat actif) → débit attendu. Déterministe (pas de
-- dépendance à l'heure de run, contrairement à la branche temporelle).
INSERT INTO plateforme.tarifs_packs_ag (id, nb_collectes, prix_ht, valide_du, type_pack, credits, prix_unitaire_ht, montant_total_ht)
VALUES ('a9000000-0000-0000-0000-000000000004'::uuid, 10, 130.00, '2026-01-01', 'pack_10', 10, 130.00, 1300.00);

INSERT INTO plateforme.packs_antgaspi (
  id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees,
  type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat
) VALUES (
  'a9000000-0000-0000-0000-000000000005'::uuid,
  'a9000000-0000-0000-0000-000000000001'::uuid,
  'a9000000-0000-0000-0000-000000000004'::uuid, 10, 0, 0,
  'pack_10', 10, 0, 1300.00, 'par_collecte', 'actif', CURRENT_DATE
);

INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte,
  nb_camions_demande, statut_tms, pack_antgaspi_id
) VALUES (
  'a9000000-0000-0000-0000-000000000006'::uuid,
  'a9000000-0000-0000-0000-000000000003'::uuid,
  'anti_gaspi', 'validee', CURRENT_DATE + INTERVAL '30 day', '12:00:00',
  1, 'acceptee', 'a9000000-0000-0000-0000-000000000005'::uuid
);

UPDATE plateforme.collectes SET statut = 'annulee'
WHERE id = 'a9000000-0000-0000-0000-000000000006'::uuid;

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi
   WHERE id = 'a9000000-0000-0000-0000-000000000005'::uuid),
  1,
  'RÉEL : annulation AG > 12h avec mandat → 1 crédit débité (≡ oracle TRUE)'
);

-- ── Cross-check RÉEL oracle 2 : fn_agreger_terminal_collecte vs oracle ──
-- N=2, 1 tournée terminée + 1 annulée → total=N, ≥1 terminée → 'realisee'.
INSERT INTO shared.prestataires (id, nom, code)
VALUES ('a9000000-0000-0000-0000-000000000020'::uuid, 'Oracle Transp', 'ORACLE-TRANSP-R0C');

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut)
VALUES
  ('a9000000-0000-0000-0000-000000000021'::uuid, 'ORACLE-T1-R0C', CURRENT_DATE, 'nuit', 'a9000000-0000-0000-0000-000000000020'::uuid, 'terminee'),
  ('a9000000-0000-0000-0000-000000000022'::uuid, 'ORACLE-T2-R0C', CURRENT_DATE, 'nuit', 'a9000000-0000-0000-0000-000000000020'::uuid, 'annulee');

INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms
) VALUES (
  'a9000000-0000-0000-0000-000000000007'::uuid,
  'a9000000-0000-0000-0000-000000000003'::uuid,
  'zero_dechet', 'validee', CURRENT_DATE, '23:00:00', 2, 'acceptee'
);

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang)
VALUES
  ('a9000000-0000-0000-0000-000000000007'::uuid, 'a9000000-0000-0000-0000-000000000021'::uuid, 1),
  ('a9000000-0000-0000-0000-000000000007'::uuid, 'a9000000-0000-0000-0000-000000000022'::uuid, 2);

SELECT is(
  plateforme.fn_agreger_terminal_collecte('a9000000-0000-0000-0000-000000000007'::uuid),
  plateforme.fn_est_terminal_attendu(2, 1, 1),
  'RÉEL : fn_agreger_terminal_collecte ≡ oracle (N=2, 1 terminée + 1 annulée → realisee)'
);

SELECT * FROM finish();
ROLLBACK;
