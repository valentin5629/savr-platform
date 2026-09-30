-- =============================================================================
-- Demande « coordonnées du chauffeur en urgence » — garanties portées par la base
-- =============================================================================
-- §06.04 Fiche collecte, refonte pop-up (décision Val 2026-09-29, Q3). Vérifie :
--   · 1 demande OUVERTE par collecte (D10, arbitrage Val 2026-09-30) : l'index
--     unique partiel refuse une 2e alerte ouverte du même code sur la même
--     collecte (le double clic concurrent de la route retombe sur cette
--     violation), sans gêner les autres codes d'alerte ; une fois l'alerte
--     clôturée, une nouvelle demande en ouvre une nouvelle (historique gardé) ;
--   · clôture automatique « à réception des coordonnées » : chaque camion doit
--     avoir nom + téléphone + plaque (vélo cargo : pas de plaque) ; une chaîne
--     vide reste « En attente » ; retrait d'un camion incomplet ⇒ clôture ;
--     collecte sans aucun camion ⇒ jamais clôturée ;
--   · alertes_admin reste fermée aux rôles clients (ni INSERT ni SELECT direct) :
--     la route est le seul chemin d'écriture.
-- =============================================================================

BEGIN;
SELECT plan(21);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Statut de l'alerte urgente d'une collecte.
CREATE OR REPLACE FUNCTION test_statut_alerte(p_collecte uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT statut FROM plateforme.alertes_admin
   WHERE code = 'coordonnees_chauffeur_urgence' AND entity_id = p_collecte
$$;

-- ─── Fixtures ─────────────────────────────────────────────────────────────────
-- 5 collectes d'une même organisation, chacune avec son scénario de camions :
--   c1 : 2 camions incomplets (multi-camions)
--   c2 : 1 vélo cargo sans plaque
--   c3 : 1 camion au nom de chauffeur « blanc »
--   c4 : 1 camion complet + 1 incomplet (retrait de l'incomplet)
--   c5 : 1 camion incomplet (retrait du seul camion)
DO $$ BEGIN
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
    ('cd000000-0000-0000-0000-0000000000a1'::uuid, 'Org Urgence', 'Org Urgence SARL', 'traiteur', '43333333300053', true);

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
    ('cd100000-0000-0000-0000-0000000000a1'::uuid, 'cd000000-0000-0000-0000-0000000000a1'::uuid, 'Org Urgence SARL', '43333333300053', '3 Rue U', '75003', 'Paris');

  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
    ('cd200000-0000-0000-0000-0000000000a1'::uuid, 'cd000000-0000-0000-0000-0000000000a1'::uuid,
     'mgr@coordonnees-urgence.local', 'Mgr', 'U', 'traiteur_manager');

  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
    ('cd300000-0000-0000-0000-0000000000a1'::uuid, 'Salle Urgence', '10 rue Test', '75010', 'Paris', 'camionnette', 48.87, 2.36, 'idf');

  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
    ('cd400000-0000-0000-0000-0000000000a1'::uuid, 'GALA_CU', 'Gala Urgence', 1, true);

  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
    created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
    contact_principal_nom, contact_principal_telephone
  ) VALUES
    ('cd500000-0000-0000-0000-0000000000a1'::uuid, 'cd000000-0000-0000-0000-0000000000a1'::uuid,
     'cd000000-0000-0000-0000-0000000000a1'::uuid, 'cd100000-0000-0000-0000-0000000000a1'::uuid,
     'cd200000-0000-0000-0000-0000000000a1'::uuid, 'cd300000-0000-0000-0000-0000000000a1'::uuid,
     'cd400000-0000-0000-0000-0000000000a1'::uuid, 'Evt Urgence', '2026-10-28', 4200, 'Contact U', '0600000061');

  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, controle_acces_requis, nb_camions_demande) VALUES
    ('cd600000-0000-0000-0000-0000000000c1'::uuid, 'cd500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-10-28', '22:00', false, 2),
    ('cd600000-0000-0000-0000-0000000000c2'::uuid, 'cd500000-0000-0000-0000-0000000000a1'::uuid, 'anti_gaspi', 'validee', 'non_envoye', '2026-10-28', '22:30', false, 1),
    ('cd600000-0000-0000-0000-0000000000c3'::uuid, 'cd500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-10-29', '22:00', false, 1),
    ('cd600000-0000-0000-0000-0000000000c4'::uuid, 'cd500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-10-30', '22:00', false, 2),
    ('cd600000-0000-0000-0000-0000000000c5'::uuid, 'cd500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-10-31', '22:00', false, 1),
    ('cd600000-0000-0000-0000-0000000000c6'::uuid, 'cd500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-11-01', '22:00', false, 1),
    ('cd600000-0000-0000-0000-0000000000c7'::uuid, 'cd500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-11-02', '22:00', false, 1);

  INSERT INTO shared.prestataires (id, nom, code) VALUES
    ('90cd0000-0000-0000-0000-0000000000a1'::uuid, 'Presta CU', 'presta-cu') ON CONFLICT (id) DO NOTHING;

  INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut, type_vehicule) VALUES
    ('cd700000-0000-0000-0000-0000000000a1'::uuid, 'T-CU-1A', '2026-10-28', 'soir', '90cd0000-0000-0000-0000-0000000000a1'::uuid, 'planifiee', 'camionnette'),
    ('cd700000-0000-0000-0000-0000000000a2'::uuid, 'T-CU-1B', '2026-10-28', 'soir', '90cd0000-0000-0000-0000-0000000000a1'::uuid, 'planifiee', 'camionnette'),
    ('cd700000-0000-0000-0000-0000000000b1'::uuid, 'T-CU-2', '2026-10-28', 'soir', '90cd0000-0000-0000-0000-0000000000a1'::uuid, 'planifiee', 'velo_cargo'),
    ('cd700000-0000-0000-0000-0000000000c1'::uuid, 'T-CU-3', '2026-10-29', 'soir', '90cd0000-0000-0000-0000-0000000000a1'::uuid, 'planifiee', 'camionnette'),
    ('cd700000-0000-0000-0000-0000000000d1'::uuid, 'T-CU-4A', '2026-10-30', 'soir', '90cd0000-0000-0000-0000-0000000000a1'::uuid, 'planifiee', 'camionnette'),
    ('cd700000-0000-0000-0000-0000000000d2'::uuid, 'T-CU-4B', '2026-10-30', 'soir', '90cd0000-0000-0000-0000-0000000000a1'::uuid, 'planifiee', 'camionnette'),
    ('cd700000-0000-0000-0000-0000000000e1'::uuid, 'T-CU-5', '2026-10-31', 'soir', '90cd0000-0000-0000-0000-0000000000a1'::uuid, 'planifiee', 'camionnette'),
    ('cd700000-0000-0000-0000-0000000000f1'::uuid, 'T-CU-6', '2026-11-01', 'soir', '90cd0000-0000-0000-0000-0000000000a1'::uuid, 'planifiee', 'camionnette'),
    ('cd700000-0000-0000-0000-0000000000f2'::uuid, 'T-CU-7', '2026-11-02', 'soir', '90cd0000-0000-0000-0000-0000000000a1'::uuid, 'planifiee', 'camionnette');

  -- c4 : le camion A est complet dès le départ.
  UPDATE plateforme.tournees
     SET chauffeur_nom = 'Nadia', chauffeur_telephone = '0633333333', plaque_immatriculation = 'CU-400-AA'
   WHERE id = 'cd700000-0000-0000-0000-0000000000d1'::uuid;

  INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
    ('cd600000-0000-0000-0000-0000000000c1'::uuid, 'cd700000-0000-0000-0000-0000000000a1'::uuid, 1),
    ('cd600000-0000-0000-0000-0000000000c1'::uuid, 'cd700000-0000-0000-0000-0000000000a2'::uuid, 2),
    ('cd600000-0000-0000-0000-0000000000c2'::uuid, 'cd700000-0000-0000-0000-0000000000b1'::uuid, 1),
    ('cd600000-0000-0000-0000-0000000000c3'::uuid, 'cd700000-0000-0000-0000-0000000000c1'::uuid, 1),
    ('cd600000-0000-0000-0000-0000000000c4'::uuid, 'cd700000-0000-0000-0000-0000000000d1'::uuid, 1),
    ('cd600000-0000-0000-0000-0000000000c4'::uuid, 'cd700000-0000-0000-0000-0000000000d2'::uuid, 2),
    ('cd600000-0000-0000-0000-0000000000c5'::uuid, 'cd700000-0000-0000-0000-0000000000e1'::uuid, 1),
    ('cd600000-0000-0000-0000-0000000000c6'::uuid, 'cd700000-0000-0000-0000-0000000000f1'::uuid, 1),
    ('cd600000-0000-0000-0000-0000000000c7'::uuid, 'cd700000-0000-0000-0000-0000000000f2'::uuid, 1);

  -- Une demande urgente ouverte par collecte (écriture de la route, service_role).
  INSERT INTO plateforme.alertes_admin (code, titre, entity_type, entity_id)
  SELECT 'coordonnees_chauffeur_urgence', 'Coordonnées chauffeur demandées en urgence', 'collecte', c.id
    FROM plateforme.collectes c
   WHERE c.evenement_id = 'cd500000-0000-0000-0000-0000000000a1'::uuid;
END $$;

SELECT test_as_superuser();

-- ═══ 1. Une demande ouverte par collecte (index unique partiel) ═════════════
SELECT throws_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, entity_type, entity_id)
    VALUES ('coordonnees_chauffeur_urgence', 'Doublon', 'collecte', 'cd600000-0000-0000-0000-0000000000c1'::uuid)$$,
  '23505',
  NULL,
  'Unicité : une 2e demande urgente ouverte sur la même collecte est refusée par la base'
);

SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, entity_type, entity_id)
    VALUES ('collecte_aucun_repas', 'Autre alerte', 'collecte', 'cd600000-0000-0000-0000-0000000000c1'::uuid)$$,
  'Unicité : l''index est partiel — les autres codes d''alerte de la collecte restent libres'
);

-- ═══ 2. Clôture automatique ══════════════════════════════════════════════════
-- c1 : 1 camion sur 2 renseigné → l'alerte reste ouverte.
UPDATE plateforme.tournees
   SET chauffeur_nom = 'Jean', chauffeur_telephone = '0611111111', plaque_immatriculation = 'CU-100-AA'
 WHERE id = 'cd700000-0000-0000-0000-0000000000a1'::uuid;
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c1'::uuid), 'ouverte',
  'Multi-camions : 1 camion sur 2 renseigné → alerte toujours ouverte');

-- c1 : le 2e camion reçoit nom + téléphone mais pas encore sa plaque → ouverte.
UPDATE plateforme.tournees
   SET chauffeur_nom = 'Marie', chauffeur_telephone = '0622222222'
 WHERE id = 'cd700000-0000-0000-0000-0000000000a2'::uuid;
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c1'::uuid), 'ouverte',
  'Multi-camions : plaque manquante sur un camion (hors vélo cargo) → alerte ouverte');

-- c1 : plaque reçue → tous les camions complets → clôturée, horodatée.
UPDATE plateforme.tournees
   SET plaque_immatriculation = 'CU-200-BB'
 WHERE id = 'cd700000-0000-0000-0000-0000000000a2'::uuid;
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c1'::uuid), 'resolue',
  'Multi-camions : dernier camion complet → alerte clôturée automatiquement');
SELECT isnt(
  (SELECT resolue_at FROM plateforme.alertes_admin
    WHERE code = 'coordonnees_chauffeur_urgence'
      AND entity_id = 'cd600000-0000-0000-0000-0000000000c1'::uuid),
  NULL,
  'Clôture automatique : resolue_at est posé'
);

-- La clôture ne touche QUE l'alerte urgente (l'autre alerte de c1 reste ouverte).
SELECT is(
  (SELECT statut FROM plateforme.alertes_admin
    WHERE code = 'collecte_aucun_repas'
      AND entity_id = 'cd600000-0000-0000-0000-0000000000c1'::uuid),
  'ouverte',
  'Clôture automatique : les autres alertes de la collecte ne sont pas touchées'
);

-- c2 : vélo cargo, nom + téléphone sans plaque → clôturée.
UPDATE plateforme.tournees
   SET chauffeur_nom = 'Lina', chauffeur_telephone = '0644444444'
 WHERE id = 'cd700000-0000-0000-0000-0000000000b1'::uuid;
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c2'::uuid), 'resolue',
  'Vélo cargo : aucune plaque attendue → clôture sur nom + téléphone');

-- c3 : nom du chauffeur « blanc » → reste « En attente » à l'écran → ouverte.
UPDATE plateforme.tournees
   SET chauffeur_nom = '   ', chauffeur_telephone = '0655555555', plaque_immatriculation = 'CU-300-CC'
 WHERE id = 'cd700000-0000-0000-0000-0000000000c1'::uuid;
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c3'::uuid), 'ouverte',
  'Chaîne vide : un nom de chauffeur blanc ne compte pas comme reçu');

-- c4 : retrait du camion incomplet (réduction de N) → le camion restant est
-- complet → clôturée.
DELETE FROM plateforme.collecte_tournees
 WHERE collecte_id = 'cd600000-0000-0000-0000-0000000000c4'::uuid
   AND tournee_id = 'cd700000-0000-0000-0000-0000000000d2'::uuid;
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c4'::uuid), 'resolue',
  'Retrait d''un camion : les camions restants complets → alerte clôturée');

-- c3 (suite) : nom renseigné + plaque, mais PAS de téléphone → reste ouverte
-- (le téléphone est l'une des trois coordonnées attendues).
UPDATE plateforme.tournees
   SET chauffeur_nom = 'Karim', chauffeur_telephone = NULL
 WHERE id = 'cd700000-0000-0000-0000-0000000000c1'::uuid;
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c3'::uuid), 'ouverte',
  'Téléphone manquant : nom + plaque ne suffisent pas');

-- Écrivains RÉELS de tournees (et non le superuser des fixtures) :
-- c6 : l'Admin Savr saisit les coordonnées sous son JWT (policy t_admin) ;
-- c7 : un adapter / webhook écrit en service_role.
SELECT test_set_jwt('admin_savr', NULL, gen_random_uuid());
UPDATE plateforme.tournees
   SET chauffeur_nom = 'Sami', chauffeur_telephone = '0677777777', plaque_immatriculation = 'CU-600-AA'
 WHERE id = 'cd700000-0000-0000-0000-0000000000f1'::uuid;
SELECT test_as_superuser();
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c6'::uuid), 'resolue',
  'Écrivain admin_savr (JWT) : la saisie des coordonnées clôture l''alerte');

SELECT set_config('role', 'service_role', true);
UPDATE plateforme.tournees
   SET chauffeur_nom = 'Inès', chauffeur_telephone = '0688888888', plaque_immatriculation = 'CU-700-AA'
 WHERE id = 'cd700000-0000-0000-0000-0000000000f2'::uuid;
SELECT test_as_superuser();
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c7'::uuid), 'resolue',
  'Écrivain service_role (adapter / webhook) : la clôture automatique fonctionne');

-- c5 : retrait du SEUL camion → aucune coordonnée reçue → reste ouverte.
DELETE FROM plateforme.collecte_tournees
 WHERE collecte_id = 'cd600000-0000-0000-0000-0000000000c5'::uuid;
SELECT is(test_statut_alerte('cd600000-0000-0000-0000-0000000000c5'::uuid), 'ouverte',
  'Collecte sans camion : jamais clôturée (aucune coordonnée reçue)');

-- ═══ 2bis. Nouvelle demande après clôture (D10) ══════════════════════════════
-- c2 : l'alerte est clôturée (vélo cargo, ci-dessus). Une réattribution efface
-- le téléphone du chauffeur, le client redemande : une NOUVELLE alerte s'ouvre.
UPDATE plateforme.tournees
   SET chauffeur_telephone = NULL
 WHERE id = 'cd700000-0000-0000-0000-0000000000b1'::uuid;
SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, entity_type, entity_id)
    VALUES ('coordonnees_chauffeur_urgence', 'Relance', 'collecte', 'cd600000-0000-0000-0000-0000000000c2'::uuid)$$,
  'Après clôture : une nouvelle demande ouvre une nouvelle alerte'
);
SELECT throws_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, entity_type, entity_id)
    VALUES ('coordonnees_chauffeur_urgence', 'Doublon relance', 'collecte', 'cd600000-0000-0000-0000-0000000000c2'::uuid)$$,
  '23505',
  NULL,
  'Après réouverture : un nouveau clic reste refusé tant que la demande est ouverte'
);
SELECT is(
  (SELECT array_agg(statut ORDER BY statut) FROM plateforme.alertes_admin
    WHERE code = 'coordonnees_chauffeur_urgence'
      AND entity_id = 'cd600000-0000-0000-0000-0000000000c2'::uuid),
  ARRAY['ouverte', 'resolue']::text[],
  'Historique conservé : l''alerte clôturée reste, à côté de la nouvelle'
);
-- Le téléphone revient : la nouvelle alerte se clôture à son tour, et la base
-- accepte deux alertes clôturées sur la même collecte.
UPDATE plateforme.tournees
   SET chauffeur_telephone = '0644444445'
 WHERE id = 'cd700000-0000-0000-0000-0000000000b1'::uuid;
SELECT is(
  (SELECT array_agg(statut ORDER BY statut) FROM plateforme.alertes_admin
    WHERE code = 'coordonnees_chauffeur_urgence'
      AND entity_id = 'cd600000-0000-0000-0000-0000000000c2'::uuid),
  ARRAY['resolue', 'resolue']::text[],
  'Coordonnées revenues : la nouvelle alerte est clôturée, deux clôturées coexistent'
);

-- ═══ 3. alertes_admin fermée aux rôles clients ═══════════════════════════════
-- Non-vacuité : la table porte bien des alertes de l'organisation testée.
SELECT cmp_ok(
  (SELECT count(*)::int FROM plateforme.alertes_admin
    WHERE entity_id IN (SELECT id FROM plateforme.collectes
                         WHERE evenement_id = 'cd500000-0000-0000-0000-0000000000a1'::uuid)),
  '>=', 7,
  'Non-vacuité : les alertes de l''organisation existent (sous superuser)'
);

SELECT test_set_jwt('traiteur_manager', 'cd000000-0000-0000-0000-0000000000a1'::uuid,
                    'cd200000-0000-0000-0000-0000000000a1'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin),
  0,
  'RLS : un traiteur ne lit aucune alerte Ops, même sur ses propres collectes'
);

SELECT throws_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, entity_type, entity_id)
    VALUES ('coordonnees_chauffeur_urgence', 'Forgée', 'collecte', 'cd600000-0000-0000-0000-0000000000c3'::uuid)$$,
  '42501',
  NULL,
  'RLS : un traiteur ne peut pas insérer d''alerte en direct (la route est le seul chemin)'
);

SELECT test_as_superuser();

SELECT * FROM finish();
ROLLBACK;
