-- pgTAP — collectes.annulation_tardive (décision Val 2026-11-03, migration
-- 20261103190000) : marquée au passage à `annulee`, comptée au montant plein
-- dans les Revenus du Dashboard Admin.
--
-- Couvre : ZD et AG annulées à moins de 4 h → true ; à 4 h ou plus → false ;
-- incident imputable à Savr → false ; incident imputable au client → true ;
-- demande confirmée par l'Admin jugée à sa réception (tardive ou non) ;
-- annulée depuis un brouillon ou un refus du prestataire → false ; collecte
-- non annulée → NULL ; colonne non modifiable par `authenticated` ; fonction
-- du déclencheur fermée.

BEGIN;
SELECT plan(13);

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('a8e00000-0000-0000-0000-000000000001', 'Org Annulation Tardive', 'Org Annulation Tardive', 'traiteur', '98765432109821', true);
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('a8e00000-0000-0000-0000-000000000009', 'ANNUL_TARD_TEST', 'Annulation tardive Test', 1, true);
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('a8e00000-0000-0000-0000-000000000002', 'Salle Annulation', '1 rue Test', 'Paris', '75001', 'camionnette');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('a8e00000-0000-0000-0000-000000000010', 'a8e00000-0000-0000-0000-000000000001',
  'admin@test-annulation-tardive.test', 'Admin', 'Test', 'admin_savr');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('a8e00000-0000-0000-0000-000000000011', 'a8e00000-0000-0000-0000-000000000001',
  'Org Annulation Tardive SARL', '98765432109821', '1 rue Test', '75001', 'Paris');
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'a8e00000-0000-0000-0000-000000000003', 'a8e00000-0000-0000-0000-000000000001',
  'a8e00000-0000-0000-0000-000000000001', 'a8e00000-0000-0000-0000-000000000011',
  'a8e00000-0000-0000-0000-000000000010', 'a8e00000-0000-0000-0000-000000000002',
  'a8e00000-0000-0000-0000-000000000009', CURRENT_DATE, 200, 'Contact Test', '0600000001'
);

-- Collecte à un créneau donné (heure de Paris), au statut donné.
CREATE FUNCTION pg_temp.collecte(p_suffixe text, p_type text, p_statut text, p_dans interval)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms)
  VALUES (('a8e00000-0000-0000-0000-0000000000' || p_suffixe)::uuid, 'a8e00000-0000-0000-0000-000000000003',
          p_type::plateforme.collecte_type, p_statut::plateforme.collecte_statut,
          ((now() + p_dans) AT TIME ZONE 'Europe/Paris')::date,
          ((now() + p_dans) AT TIME ZONE 'Europe/Paris')::time,
          1, 'non_envoye');
$$;
CREATE FUNCTION pg_temp.annuler(p_suffixe text) RETURNS void LANGUAGE sql AS $$
  UPDATE plateforme.collectes SET statut = 'annulee'
   WHERE id = ('a8e00000-0000-0000-0000-0000000000' || p_suffixe)::uuid;
$$;
CREATE FUNCTION pg_temp.tardive(p_suffixe text) RETURNS boolean LANGUAGE sql AS $$
  SELECT annulation_tardive FROM plateforme.collectes
   WHERE id = ('a8e00000-0000-0000-0000-0000000000' || p_suffixe)::uuid;
$$;

-- ── 1. Délai : moins de 4 h → true, 4 h ou plus → false (ZD et AG) ───────────
SELECT pg_temp.collecte('e1', 'zero_dechet', 'programmee', interval '3 hours 59 minutes');
SELECT pg_temp.collecte('e2', 'zero_dechet', 'validee', interval '4 hours 1 minute');
SELECT pg_temp.collecte('a1', 'anti_gaspi', 'programmee', interval '1 hour');
SELECT pg_temp.collecte('a2', 'anti_gaspi', 'programmee', interval '3 days');
SELECT is(pg_temp.tardive('e1'), NULL::boolean, 'e1 : non annulée → NULL');
SELECT pg_temp.annuler('e1');
SELECT pg_temp.annuler('e2');
SELECT pg_temp.annuler('a1');
SELECT pg_temp.annuler('a2');
SELECT is(pg_temp.tardive('e1'), true, 'e1 : ZD annulée à 3 h 59 → tardive');
SELECT is(pg_temp.tardive('e2'), false, 'e2 : ZD annulée à 4 h 01 → non tardive');
SELECT is(pg_temp.tardive('a1'), true, 'a1 : AG annulée à 1 h → tardive');
SELECT is(pg_temp.tardive('a2'), false, 'a2 : AG annulée à 3 jours → non tardive');

-- ── 2. Incident : imputable à Savr → false ; au client → true ────────────────
SELECT pg_temp.collecte('c1', 'zero_dechet', 'en_cours', interval '1 hour');
SELECT pg_temp.collecte('c2', 'zero_dechet', 'en_cours', interval '1 hour');
UPDATE plateforme.collectes SET statut = 'annulee', incident_imputable_a = 'savr'
 WHERE id = 'a8e00000-0000-0000-0000-0000000000c1';
UPDATE plateforme.collectes SET statut = 'annulee', incident_imputable_a = 'client'
 WHERE id = 'a8e00000-0000-0000-0000-0000000000c2';
SELECT is(pg_temp.tardive('c1'), false, 'c1 : tardive mais imputable à Savr → non tardive');
SELECT is(pg_temp.tardive('c2'), true, 'c2 : tardive imputable au client → tardive');

-- ── 3. Demande confirmée par l'Admin : jugée à sa réception ──────────────────
-- d1 : demandée 3 jours avant, confirmée à 1 h → non tardive.
-- d2 : demandée à 1 h (horodatée par trg_horodater_annulation_demandee),
--      confirmée ensuite → tardive.
SELECT pg_temp.collecte('d1', 'zero_dechet', 'programmee', interval '1 hour');
SELECT pg_temp.collecte('d2', 'zero_dechet', 'programmee', interval '1 hour');
UPDATE plateforme.collectes SET statut = 'annulation_demandee'
 WHERE id IN ('a8e00000-0000-0000-0000-0000000000d1', 'a8e00000-0000-0000-0000-0000000000d2');
-- Le déclencheur d'horodatage pose now() : on recule la demande de d1 sans
-- toucher au statut (déclencheur muet).
UPDATE plateforme.collectes SET annulation_demandee_at = now() - interval '3 days'
 WHERE id = 'a8e00000-0000-0000-0000-0000000000d1';
SELECT pg_temp.annuler('d1');
SELECT pg_temp.annuler('d2');
SELECT is(pg_temp.tardive('d1'), false, 'd1 : demande reçue 3 jours avant → non tardive');
SELECT is(pg_temp.tardive('d2'), true, 'd2 : demande reçue moins de 4 h avant → tardive');

-- ── 4. Aucune prestation due : brouillon, refus du prestataire → false ───────
SELECT pg_temp.collecte('b1', 'zero_dechet', 'brouillon', interval '1 hour');
SELECT pg_temp.collecte('f1', 'zero_dechet', 'rejetee_par_prestataire', interval '1 hour');
SELECT pg_temp.annuler('b1');
SELECT pg_temp.annuler('f1');
SELECT is(pg_temp.tardive('b1'), false, 'b1 : brouillon annulé → non tardive');
SELECT is(pg_temp.tardive('f1'), false, 'f1 : refusée par le prestataire puis annulée → non tardive');

-- ── 5. Droits ────────────────────────────────────────────────────────────────
SELECT ok(NOT has_column_privilege('authenticated', 'plateforme.collectes', 'annulation_tardive', 'UPDATE'),
  'authenticated ne peut pas écrire annulation_tardive');
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.fn_trg_marquer_annulation_tardive()', 'EXECUTE'),
  'fonction du déclencheur fermée à authenticated');

SELECT * FROM finish();
ROLLBACK;
