-- =============================================================================
-- Régression Lot B — M7 (recrédit anti-violation index) + M9 (avoir→origine) + M4
-- =============================================================================
-- M7 : recrédit d'un pack epuise quand un AUTRE pack de l'org est déjà actif →
--      le pack reste epuise (pas de violation de uniq_pack_actif_par_org),
--      l'annulation aboutit (avant le fix : l'UPDATE échouait).
-- M9 : un avoir qui atteint 'emise' annule sa facture d'origine (trigger).
-- M4 : une collecte dont les seules lignes sont sur une facture annulée + un
--      avoir peut être RE-facturée (le trigger fn_trg_fc_collecte_non_facturee
--      n'exclut plus que les factures actives non-avoir).
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

-- ── Fixtures communes ────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('b0000000-0000-0000-0000-000000000001', 'Org Lot B', 'Org Lot B', 'traiteur', '99999999900001', true);

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000001', 'Org Lot B SARL', '99999999900001', '1 rue Test', '75001', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('b0000000-0000-0000-0000-000000000009', 'LOTB_TEST', 'Lot B Test', 1, true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('b0000000-0000-0000-0000-000000000002', 'Salle Lot B', '1 rue Test', 'Paris', '75001', 'camionnette');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000001', 'admin@lotb.test', 'Admin', 'Test', 'admin_savr');

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000011',
  'b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000002',
  'b0000000-0000-0000-0000-000000000009', CURRENT_DATE + INTERVAL '1 day', 200,
  'Contact Test', '0600000001'
);

INSERT INTO plateforme.tarifs_packs_ag (id, nb_collectes, prix_ht, valide_du, type_pack, credits, prix_unitaire_ht, montant_total_ht)
VALUES ('b0000000-0000-0000-0000-000000000004', 10, 130.00, '2026-01-01', 'pack_10', 10, 130.00, 1300.00);

-- ═══ M7 : recrédit avec un autre pack actif ═════════════════════════════════
-- Pack P1 EPUISE (10/10 consommés)
INSERT INTO plateforme.packs_antgaspi (
  id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees,
  type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat
) VALUES (
  'b0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000004', 10, 10, 0, 'pack_10', 10, 10, 1300.00, 'par_collecte', 'epuise', CURRENT_DATE
);
-- Pack P2 ACTIF (l'org a renouvelé) — un seul actif autorisé par l'index
INSERT INTO plateforme.packs_antgaspi (
  id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees,
  type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat
) VALUES (
  'b0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000004', 10, 0, 0, 'pack_10', 10, 0, 1300.00, 'par_collecte', 'actif', CURRENT_DATE
);
-- Collecte AG REALISEE rattachée à P1 (insert direct à realisee = pas de trigger débit)
INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms, pack_antgaspi_id
) VALUES (
  'b0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-000000000003',
  'anti_gaspi', 'realisee', CURRENT_DATE + INTERVAL '1 day', '09:00:00', 1, 'non_envoye',
  'b0000000-0000-0000-0000-0000000000a1'
);

-- Annulation de la collecte réalisée → recrédit P1 (NE DOIT PAS lever d'erreur)
SELECT lives_ok(
  $$ UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = 'b0000000-0000-0000-0000-0000000000c1' $$,
  'M7 : recrédit avec un autre pack actif n''échoue pas (pas de violation uniq_pack_actif_par_org)'
);

SELECT is(
  (SELECT statut::text FROM plateforme.packs_antgaspi WHERE id = 'b0000000-0000-0000-0000-0000000000a1'),
  'epuise',
  'M7 : l''ancien pack reste epuise (réactivation bloquée car P2 déjà actif)'
);

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'b0000000-0000-0000-0000-0000000000a1'),
  9,
  'M7 : le compteur du pack est bien recrédité (10 → 9)'
);

-- ═══ M9 : un avoir 'emise' annule sa facture d'origine ══════════════════════
INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, type, statut, montant_ht, taux_tva, montant_tva, montant_ttc)
VALUES ('b0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000011', 'zero_dechet', 'emise', 590, 20, 118, 708);

INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, type, statut, facture_origine_id, montant_ht, taux_tva, montant_tva, montant_ttc)
VALUES ('b0000000-0000-0000-0000-0000000000f2', 'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000011', 'avoir', 'brouillon', 'b0000000-0000-0000-0000-0000000000f1', -590, 20, -118, -708);

UPDATE plateforme.factures SET statut = 'emise' WHERE id = 'b0000000-0000-0000-0000-0000000000f2';

SELECT is(
  (SELECT statut::text FROM plateforme.factures WHERE id = 'b0000000-0000-0000-0000-0000000000f1'),
  'annulee',
  'M9 : la facture d''origine passe à annulee quand l''avoir atteint emise (trigger)'
);

-- ═══ M4 : re-facturation possible après annulation par avoir ════════════════
-- Lignes existantes : L1 sur F1 (annulee) + L2 sur F2 (avoir emise), pour la même collecte.
INSERT INTO plateforme.factures_collectes (id, facture_id, collecte_id, quantite, taux_tva, montant_ligne_ht, montant_ht)
VALUES ('b0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000c1', 1, 20, 590, 590);
INSERT INTO plateforme.factures_collectes (id, facture_id, collecte_id, quantite, taux_tva, montant_ligne_ht, montant_ht)
VALUES ('b0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-0000000000f2', 'b0000000-0000-0000-0000-0000000000c1', 1, 20, -590, -590);

-- Nouvelle facture brouillon F3 + nouvelle ligne pour la même collecte → DOIT être autorisée
INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, type, statut, montant_ht, taux_tva, montant_tva, montant_ttc)
VALUES ('b0000000-0000-0000-0000-0000000000f3', 'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000011', 'zero_dechet', 'brouillon', 590, 20, 118, 708);

SELECT lives_ok(
  $$ INSERT INTO plateforme.factures_collectes (id, facture_id, collecte_id, quantite, taux_tva, montant_ligne_ht, montant_ht)
     VALUES ('b0000000-0000-0000-0000-0000000000d3', 'b0000000-0000-0000-0000-0000000000f3', 'b0000000-0000-0000-0000-0000000000c1', 1, 20, 590, 590) $$,
  'M4 : re-facturer une collecte dont les lignes sont sur annulee+avoir est autorisé'
);

-- ═══ M6 : débit nominal (FOR UPDATE) — régression fonctionnelle ═════════════
-- La sécurité concurrente (FOR UPDATE vs SKIP LOCKED) nécessite 2 sessions et
-- n'est pas testable en une transaction pgTAP ; on vérifie ici que le débit
-- nominal reste correct sur le pack actif P2 (0 → 1 consommé).
INSERT INTO plateforme.collectes (
  id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms
) VALUES (
  'b0000000-0000-0000-0000-0000000000c2', 'b0000000-0000-0000-0000-000000000003',
  'anti_gaspi', 'programmee', CURRENT_DATE + INTERVAL '2 days', '09:00:00', 1, 'non_envoye'
);
UPDATE plateforme.collectes SET statut = 'realisee' WHERE id = 'b0000000-0000-0000-0000-0000000000c2';

SELECT is(
  (SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'b0000000-0000-0000-0000-0000000000a2'),
  1,
  'M6 : le débit nominal à la réalisation incrémente le pack actif (FOR UPDATE)'
);

SELECT * FROM finish();
ROLLBACK;
