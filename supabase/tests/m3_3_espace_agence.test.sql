-- pgTAP M3.3 — Espace client agence
-- Couvre les scénarios DB du §06.11 (test-scenarios lot ⑨) :
--   RPC f_completer_siret_shadow (5 gardes + succès), gate Cerfa brouillon shadow,
--   trigger trg_cerfa_debloque_siret (finalisation + idempotence), contraintes
--   shadow, isolation RLS agence (cross-org, registre deny, référentiel whitelist,
--   users self, factures self, shadow invisible cross-agence).

BEGIN;
SELECT plan(30);

-- ── Helpers JWT (identiques aux autres tests RLS) ───────────────────────────
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

-- ── Fixtures (superuser) ────────────────────────────────────────────────────
SELECT test_as_superuser();

-- Organisations : 2 agences, 2 traiteurs référencés, 2 fiches shadow
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, est_shadow, cree_par_organisation_id) VALUES
  ('a3000000-0000-0000-0000-0000000000a1'::uuid, 'WPM', 'WPM SAS', 'agence', NULL, true, false, NULL),
  ('a3000000-0000-0000-0000-0000000000a2'::uuid, 'Quintessence', 'Quintessence Event SARL', 'agence', NULL, true, false, NULL),
  ('a3000000-0000-0000-0000-0000000000b1'::uuid, 'Kaspia', 'Kaspia SARL', 'traiteur', NULL, true, false, NULL),
  ('a3000000-0000-0000-0000-0000000000b2'::uuid, 'Kardamome', 'Kardamome SARL', 'traiteur', NULL, true, false, NULL),
  -- shadow Maison Bertrand créée par WPM (siret NULL)
  ('a3000000-0000-0000-0000-0000000000c1'::uuid, 'Maison Bertrand', 'Maison Bertrand SARL', 'traiteur', NULL, true, true, 'a3000000-0000-0000-0000-0000000000a1'::uuid),
  -- shadow Pasta Co créée par Quintessence
  ('a3000000-0000-0000-0000-0000000000c2'::uuid, 'Pasta Co', 'Pasta Co SARL', 'traiteur', NULL, true, true, 'a3000000-0000-0000-0000-0000000000a2'::uuid);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('a3000000-0000-0000-0000-0000000000d1'::uuid, 'a3000000-0000-0000-0000-0000000000a1'::uuid, 'alice@wpm.test', 'Alice', 'W', 'agence'),
  ('a3000000-0000-0000-0000-0000000000d2'::uuid, 'a3000000-0000-0000-0000-0000000000a1'::uuid, 'bob@wpm.test', 'Bob', 'W', 'agence'),
  ('a3000000-0000-0000-0000-0000000000d3'::uuid, 'a3000000-0000-0000-0000-0000000000a2'::uuid, 'qui@quint.test', 'Q', 'U', 'agence'),
  ('a3000000-0000-0000-0000-0000000000d4'::uuid, 'a3000000-0000-0000-0000-0000000000b1'::uuid, 'mgr@kaspia.test', 'M', 'K', 'traiteur_manager');

-- Entité de facturation WPM (agence = payeur)
INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('a3000000-0000-0000-0000-0000000000e1'::uuid,
        'a3000000-0000-0000-0000-0000000000a1'::uuid,
        'WPM SAS', '99999999900009', '1 rue WPM', '75001', 'Paris');

INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region)
VALUES ('a3000000-0000-0000-0000-0000000000e2'::uuid,
        'Pavillon Gabriel', '5 av Gabriel', '75008', 'Paris', 'camionnette', 48.86, 2.31, 'idf');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('a3000000-0000-0000-0000-0000000000e3'::uuid, 'GALA_M33', 'Gala M3.3', 1, true);

-- Événement WPM (donneur d'ordre) — traiteur opérationnel = shadow Maison Bertrand
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'a3000000-0000-0000-0000-0000000000f1'::uuid,
  'a3000000-0000-0000-0000-0000000000a1'::uuid,
  'a3000000-0000-0000-0000-0000000000c1'::uuid,
  'a3000000-0000-0000-0000-0000000000e1'::uuid,
  'a3000000-0000-0000-0000-0000000000d1'::uuid,
  'a3000000-0000-0000-0000-0000000000e2'::uuid,
  'a3000000-0000-0000-0000-0000000000e3'::uuid,
  'Gala WPM', CURRENT_DATE, 300, 'Contact WPM', '0600000000'
);

-- Événement Quintessence — traiteur opérationnel = Kaspia (référencé)
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'a3000000-0000-0000-0000-0000000000f2'::uuid,
  'a3000000-0000-0000-0000-0000000000a2'::uuid,
  'a3000000-0000-0000-0000-0000000000b1'::uuid,
  'a3000000-0000-0000-0000-0000000000e1'::uuid,
  'a3000000-0000-0000-0000-0000000000d3'::uuid,
  'a3000000-0000-0000-0000-0000000000e2'::uuid,
  'a3000000-0000-0000-0000-0000000000e3'::uuid,
  'Gala Quint', CURRENT_DATE, 200, 'Contact Q', '0611111111'
);

-- Collectes ZD clôturées
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte) VALUES
  ('a3000000-0000-0000-0000-0000000000a3'::uuid, 'a3000000-0000-0000-0000-0000000000f1'::uuid, 'zero_dechet', 'cloturee', CURRENT_DATE, '06:00'),
  ('a3000000-0000-0000-0000-0000000000a4'::uuid, 'a3000000-0000-0000-0000-0000000000f2'::uuid, 'zero_dechet', 'cloturee', CURRENT_DATE, '06:00');

-- Facture WPM
INSERT INTO plateforme.factures (id, entite_facturation_id, organisation_id, numero_facture, statut) VALUES
  ('a3000000-0000-0000-0000-0000000000a5'::uuid, 'a3000000-0000-0000-0000-0000000000e1'::uuid, 'a3000000-0000-0000-0000-0000000000a1'::uuid, 'FAC-M33-0001', 'emise');

-- Pack AG WPM (agence pré-achète du volume — décompte sur le pack agence)
INSERT INTO plateforme.tarifs_packs_ag (id, type_pack, credits, prix_unitaire_ht, valide_du)
VALUES ('a3000000-0000-0000-0000-0000000000a7'::uuid, 'pack_10', 10, 100, CURRENT_DATE);
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, date_achat)
VALUES ('a3000000-0000-0000-0000-0000000000a8'::uuid, 'a3000000-0000-0000-0000-0000000000a1'::uuid, 'pack_10', 10, CURRENT_DATE);

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Contraintes shadow (rappel Niveau 0 — P1 §06.11 cat 3)
-- ════════════════════════════════════════════════════════════════════════════
-- type non-traiteur valide (agence) + est_shadow=true → viole chk_shadow_only_traiteur
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id)
     VALUES ('Bad', 'agence', true, 'a3000000-0000-0000-0000-0000000000a1'::uuid) $$,
  '23514', NULL,
  'check_shadow_type_traiteur_seul — shadow non-traiteur rejeté'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id)
     VALUES ('Bad', 'traiteur', true, NULL) $$,
  '23514', NULL,
  'check_shadow_createur_obligatoire — créateur NULL rejeté'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.entites_facturation
       (organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
     VALUES ('a3000000-0000-0000-0000-0000000000c1'::uuid, 'MB', '11111111100009', 'x', '75001', 'Paris') $$,
  NULL, NULL,
  'entite_facturation_sur_shadow_rejetee — trigger BEFORE INSERT bloque'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. RPC f_completer_siret_shadow — 5 gardes (P1 cat 3) + succès (P1 cat 1)
-- ════════════════════════════════════════════════════════════════════════════

-- Garde rôle : un traiteur_manager ne peut pas appeler
SELECT test_set_jwt('traiteur_manager', 'a3000000-0000-0000-0000-0000000000b1'::uuid, 'a3000000-0000-0000-0000-0000000000d4'::uuid);
SELECT throws_ok(
  $$ SELECT plateforme.f_completer_siret_shadow('a3000000-0000-0000-0000-0000000000c1'::uuid, '83179309400017') $$,
  '42501', NULL,
  'rpc_siret_role_non_agence_rejete'
);

-- Garde format : 13 chiffres
SELECT test_set_jwt('agence', 'a3000000-0000-0000-0000-0000000000a1'::uuid, 'a3000000-0000-0000-0000-0000000000d1'::uuid);
SELECT throws_ok(
  $$ SELECT plateforme.f_completer_siret_shadow('a3000000-0000-0000-0000-0000000000c1'::uuid, '8317930940001') $$,
  '22023', NULL,
  'rpc_siret_format_invalide_rejete'
);

-- Garde est_shadow : cible non shadow (Kaspia)
SELECT throws_ok(
  $$ SELECT plateforme.f_completer_siret_shadow('a3000000-0000-0000-0000-0000000000b1'::uuid, '12345678901234') $$,
  '22023', NULL,
  'rpc_siret_sur_organisation_non_shadow_rejete'
);

-- Garde créateur : shadow d'une autre agence (Pasta Co créé par Quintessence)
SELECT throws_ok(
  $$ SELECT plateforme.f_completer_siret_shadow('a3000000-0000-0000-0000-0000000000c2'::uuid, '12345678901234') $$,
  '42501', NULL,
  'rpc_siret_shadow_autre_agence_rejete'
);

-- ── Bordereau brouillon sur la collecte WPM (producteur shadow s1, siret NULL) ──
SELECT test_as_superuser();
-- Tentative d'émission directe (statut emis) → le gate doit forcer brouillon
INSERT INTO plateforme.bordereaux_savr (id, collecte_id, numero, producteur_raison_sociale, statut)
VALUES ('a3000000-0000-0000-0000-0000000000a6'::uuid, 'a3000000-0000-0000-0000-0000000000a3'::uuid, 'BSAV-M33-1', 'Maison Bertrand SARL', 'emis');

SELECT is(
  (SELECT statut::text FROM plateforme.bordereaux_savr WHERE id = 'a3000000-0000-0000-0000-0000000000a6'::uuid),
  'brouillon',
  'bordereau_cerfa_brouillon_si_siret_shadow_manquant — gate force brouillon'
);

-- Succès RPC (agence WPM) — complète le SIRET de Maison Bertrand
SELECT test_set_jwt('agence', 'a3000000-0000-0000-0000-0000000000a1'::uuid, 'a3000000-0000-0000-0000-0000000000d1'::uuid);
SELECT lives_ok(
  $$ SELECT plateforme.f_completer_siret_shadow('a3000000-0000-0000-0000-0000000000c1'::uuid, '83179309400017') $$,
  'rpc_completer_siret_shadow_succes — appel valide ne lève pas'
);

SELECT test_as_superuser();
SELECT is(
  (SELECT siret FROM plateforme.organisations WHERE id = 'a3000000-0000-0000-0000-0000000000c1'::uuid),
  '83179309400017',
  'rpc_completer_siret_shadow_succes — SIRET enregistré'
);

-- Notification Admin in-app créée (F3)
SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin
   WHERE code = 'shadow_siret_complete' AND entity_id = 'a3000000-0000-0000-0000-0000000000c1'::uuid AND statut = 'ouverte'),
  1,
  'rpc_completer_siret_shadow_succes — alerte Admin in-app créée (F3)'
);

-- Trigger Cerfa : bordereau brouillon finalisé (emis) + SIRET snapshoté
SELECT is(
  (SELECT statut::text FROM plateforme.bordereaux_savr WHERE id = 'a3000000-0000-0000-0000-0000000000a6'::uuid),
  'emis',
  'trigger_cerfa_finalise_bordereaux_apres_siret — sortie du statut brouillon'
);
SELECT is(
  (SELECT producteur_siret FROM plateforme.bordereaux_savr WHERE id = 'a3000000-0000-0000-0000-0000000000a6'::uuid),
  '83179309400017',
  'trigger_cerfa_finalise — SIRET producteur snapshoté'
);
SELECT is(
  (SELECT count(*)::int FROM plateforme.jobs_pdf
   WHERE entity_type = 'bordereaux_savr' AND entity_id = 'a3000000-0000-0000-0000-0000000000a6'::uuid AND statut = 'pending'),
  1,
  'trigger_cerfa_finalise — job PDF de régénération enqueué'
);

-- Garde écrasement : SIRET déjà renseigné
SELECT test_set_jwt('agence', 'a3000000-0000-0000-0000-0000000000a1'::uuid, 'a3000000-0000-0000-0000-0000000000d1'::uuid);
SELECT throws_ok(
  $$ SELECT plateforme.f_completer_siret_shadow('a3000000-0000-0000-0000-0000000000c1'::uuid, '11111111100009') $$,
  '22023', NULL,
  'rpc_siret_deja_renseigne_ecrasement_interdit'
);

-- Idempotence trigger : UPDATE ne touchant pas siret → aucune refinalisation
SELECT test_as_superuser();
UPDATE plateforme.organisations SET nom = 'Maison Bertrand (MAJ)' WHERE id = 'a3000000-0000-0000-0000-0000000000c1'::uuid;
SELECT is(
  (SELECT count(*)::int FROM plateforme.jobs_pdf
   WHERE entity_type = 'bordereaux_savr' AND entity_id = 'a3000000-0000-0000-0000-0000000000a6'::uuid),
  1,
  'trigger_cerfa_idempotent_sur_update_sans_changement — pas de nouveau job'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. RLS agence — INSERT organisation non-shadow refusé (P1 cat 3)
-- ════════════════════════════════════════════════════════════════════════════
SELECT test_set_jwt('agence', 'a3000000-0000-0000-0000-0000000000a1'::uuid, 'a3000000-0000-0000-0000-0000000000d1'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow) VALUES ('Faux', 'traiteur', false) $$,
  '42501', NULL,
  'agence_insert_organisation_non_shadow_refuse'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. RLS agence — isolation (P1 cat 4)
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements WHERE organisation_id = 'a3000000-0000-0000-0000-0000000000a2'::uuid),
  0,
  'agence_cross_org_evenements_denied'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes),
  1,
  'agence_cross_org_collectes_denied — seules les collectes de WPM'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets),
  0,
  'agence_registre_reglementaire_denied'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_referentiel_traiteurs),
  2,
  'referentiel_traiteurs_vue_whitelist — référencés seuls, aucun shadow'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.users),
  1,
  'agence_users_select_self_only'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.factures),
  1,
  'agence_factures_select_self_org_only'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations WHERE id = 'a3000000-0000-0000-0000-0000000000c2'::uuid),
  0,
  'shadow_invisible_cross_agence'
);

-- UPDATE direct d'une fiche shadow par l'agence créatrice : refusé (org_agence_update self-only)
-- → 0 ligne affectée, raison_sociale inchangée (la complétion passe par la RPC F2, SIRET seul)
UPDATE plateforme.organisations SET raison_sociale = 'PIRATÉ'
WHERE id = 'a3000000-0000-0000-0000-0000000000c1'::uuid;
SELECT isnt(
  (SELECT raison_sociale FROM plateforme.organisations WHERE id = 'a3000000-0000-0000-0000-0000000000c1'::uuid),
  'PIRATÉ',
  'agence_update_direct_shadow_denied — UPDATE RLS no-op sur fiche shadow'
);

-- Pack AG : lecture self-org
SELECT is(
  (SELECT count(*)::int FROM plateforme.packs_antgaspi),
  1,
  'agence_pack_ag_lecture_seule_self'
);

-- INSERT users par l'agence : refusé (gestion users agence = Admin only, F1)
SELECT throws_ok(
  $$ INSERT INTO plateforme.users (organisation_id, email, prenom, nom, role)
     VALUES ('a3000000-0000-0000-0000-0000000000a1'::uuid, 'nouveau@wpm.test', 'N', 'W', 'agence') $$,
  '42501', NULL,
  'agence_users_insert_denied'
);

-- INSERT pack par l'agence : refusé (négociation commerciale = Admin only)
SELECT throws_ok(
  $$ INSERT INTO plateforme.packs_antgaspi
       (organisation_id, type_pack, credits_initiaux, date_achat)
     VALUES ('a3000000-0000-0000-0000-0000000000a1'::uuid,
             'pack_10', 10, CURRENT_DATE) $$,
  '42501', NULL,
  'agence_pack_ag_insert_denied'
);

-- UPDATE événement hors fenêtre d'édition (collecte cloturee) : refusé (f_collecte_editable=false)
UPDATE plateforme.evenements SET nom_evenement = 'PIRATÉ'
WHERE id = 'a3000000-0000-0000-0000-0000000000f1'::uuid;
SELECT isnt(
  (SELECT nom_evenement FROM plateforme.evenements WHERE id = 'a3000000-0000-0000-0000-0000000000f1'::uuid),
  'PIRATÉ',
  'agence_update_evenement_hors_fenetre_denied'
);

-- Réciproque §09 : le traiteur opérationnel (Kaspia) voit la collecte programmée par
-- l'agence (Quintessence) sur lui, mais ne peut pas l'éditer (organisation_id ≠ Kaspia)
SELECT test_set_jwt('traiteur_manager', 'a3000000-0000-0000-0000-0000000000b1'::uuid, 'a3000000-0000-0000-0000-0000000000d4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes WHERE id = 'a3000000-0000-0000-0000-0000000000a4'::uuid),
  1,
  'traiteur_operationnel_voit_collectes_programmees_par_agence'
);

SELECT * FROM finish();
ROLLBACK;
