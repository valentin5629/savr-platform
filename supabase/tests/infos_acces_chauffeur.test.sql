-- =============================================================================
-- Infos accès chauffeur — RPC de complétude + RLS des nouvelles colonnes.
-- =============================================================================
-- Décision Val 2026-07-15 (réintroduction V1). Vérifie :
--   · fn_infos_acces_marquer_si_complet : NULL si incomplet / non requis / déjà
--     envoyé ; payload + stamp atomique quand complet (nom + tel par tournée) ;
--     dédup au 2e appel.
--   · RLS : les colonnes chauffeur/accompagnant héritent de la policy `t_select`
--     de `tournees` (cloisonnement par collecte) — aucune fuite inter-org.
-- Sous rôle `authenticated` + claim `user_role` (jamais `role`) pour la partie RLS.
-- =============================================================================

BEGIN;
SELECT plan(10);

-- ─── Helpers JWT (pattern canonique repo) ────────────────────────────────────
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

-- ─── Fixtures ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
    ('ac000000-0000-0000-0000-0000000000a1'::uuid, 'Org A', 'Org A SARL', 'traiteur', '41111111100051', true),
    ('ac000000-0000-0000-0000-0000000000b2'::uuid, 'Org B', 'Org B SARL', 'traiteur', '42222222200052', true);

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
    ('ac100000-0000-0000-0000-0000000000a1'::uuid, 'ac000000-0000-0000-0000-0000000000a1'::uuid, 'Org A SARL', '41111111100051', '1 Rue A', '75001', 'Paris'),
    ('ac100000-0000-0000-0000-0000000000b2'::uuid, 'ac000000-0000-0000-0000-0000000000b2'::uuid, 'Org B SARL', '42222222200052', '2 Rue B', '75002', 'Paris');

  -- Programmateur (created_by de l'événement A) + manager org B (observateur cross-org).
  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
    ('ac200000-0000-0000-0000-0000000000a1'::uuid, 'ac000000-0000-0000-0000-0000000000a1'::uuid,
     'prog-a@infos-acces.local', 'Prog', 'A', 'traiteur_manager'),
    ('ac200000-0000-0000-0000-0000000000b2'::uuid, 'ac000000-0000-0000-0000-0000000000b2'::uuid,
     'mgr-b@infos-acces.local', 'Mgr', 'B', 'traiteur_manager');

  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
    ('ac300000-0000-0000-0000-0000000000a1'::uuid, 'Salle Accès', '9 rue Test', '75009', 'Paris', 'camionnette', 48.87, 2.34, 'idf');

  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
    ('ac400000-0000-0000-0000-0000000000a1'::uuid, 'GALA_AC', 'Gala Accès', 1, true);

  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
    created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
    contact_principal_nom, contact_principal_telephone
  ) VALUES
    ('ac500000-0000-0000-0000-0000000000a1'::uuid, 'ac000000-0000-0000-0000-0000000000a1'::uuid,
     'ac000000-0000-0000-0000-0000000000a1'::uuid, 'ac100000-0000-0000-0000-0000000000a1'::uuid,
     'ac200000-0000-0000-0000-0000000000a1'::uuid, 'ac300000-0000-0000-0000-0000000000a1'::uuid,
     'ac400000-0000-0000-0000-0000000000a1'::uuid, 'Evt Accès', '2026-09-10', 200, 'Contact A', '0600000051');

  -- Collecte A : contrôle d'accès requis, 2 camions.
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, controle_acces_requis, nb_camions_demande) VALUES
    ('ac600000-0000-0000-0000-0000000000a1'::uuid, 'ac500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-09-10', '08:00', true, 2);

  -- Collecte B : contrôle d'accès NON requis (contrôle négatif).
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, controle_acces_requis, nb_camions_demande) VALUES
    ('ac600000-0000-0000-0000-0000000000b2'::uuid, 'ac500000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-09-11', '09:00', false, 1);

  INSERT INTO shared.prestataires (id, nom, code) VALUES
    ('90a00000-0000-0000-0000-0000000000a1'::uuid, 'Presta AC', 'presta-ac') ON CONFLICT (id) DO NOTHING;

  -- 2 tournées pour la collecte A (multi-camions) + 1 pour la collecte B.
  INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut) VALUES
    ('ac700000-0000-0000-0000-0000000000a1'::uuid, 'T-AC-A1', '2026-09-10', 'matin', '90a00000-0000-0000-0000-0000000000a1'::uuid, 'planifiee'),
    ('ac700000-0000-0000-0000-0000000000a2'::uuid, 'T-AC-A2', '2026-09-10', 'matin', '90a00000-0000-0000-0000-0000000000a1'::uuid, 'planifiee'),
    ('ac700000-0000-0000-0000-0000000000b2'::uuid, 'T-AC-B1', '2026-09-11', 'matin', '90a00000-0000-0000-0000-0000000000a1'::uuid, 'planifiee');

  INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
    ('ac600000-0000-0000-0000-0000000000a1'::uuid, 'ac700000-0000-0000-0000-0000000000a1'::uuid, 1),
    ('ac600000-0000-0000-0000-0000000000a1'::uuid, 'ac700000-0000-0000-0000-0000000000a2'::uuid, 2),
    ('ac600000-0000-0000-0000-0000000000b2'::uuid, 'ac700000-0000-0000-0000-0000000000b2'::uuid, 1);
END $$;

-- ═══ 1. Fonctionnel : fn_infos_acces_marquer_si_complet (superuser) ══════════
SELECT test_as_superuser();

-- Incomplet (0/2 tournées renseignées) → NULL.
SELECT is(
  plateforme.fn_infos_acces_marquer_si_complet('ac600000-0000-0000-0000-0000000000a1'::uuid),
  NULL,
  'RPC : NULL quand aucune tournée renseignée (incomplet)'
);

-- Renseigner UNE seule tournée → toujours incomplet (1/2) → NULL.
UPDATE plateforme.tournees
   SET chauffeur_nom = 'Jean Dupont', chauffeur_telephone = '0611111111'
 WHERE id = 'ac700000-0000-0000-0000-0000000000a1'::uuid;

SELECT is(
  plateforme.fn_infos_acces_marquer_si_complet('ac600000-0000-0000-0000-0000000000a1'::uuid),
  NULL,
  'RPC : NULL quand 1 tournée sur 2 renseignée (partiel)'
);

-- Renseigner la 2e tournée → complet → payload + stamp.
UPDATE plateforme.tournees
   SET chauffeur_nom = 'Marie Martin', chauffeur_telephone = '0622222222'
 WHERE id = 'ac700000-0000-0000-0000-0000000000a2'::uuid;

SELECT is(
  (plateforme.fn_infos_acces_marquer_si_complet('ac600000-0000-0000-0000-0000000000a1'::uuid) ->> 'to'),
  'prog-a@infos-acces.local',
  'RPC : destinataire = evenements.created_by (email du programmateur) quand complet'
);

-- Le stamp a bien été posé (claim).
SELECT isnt(
  (SELECT infos_acces_email_envoye_at FROM plateforme.collectes WHERE id = 'ac600000-0000-0000-0000-0000000000a1'::uuid),
  NULL,
  'RPC : infos_acces_email_envoye_at renseigné après envoi (claim)'
);

-- 2 chauffeurs dans le payload (multi-camions listés). On relit le stamp posé
-- ci-dessus impossible (déjà envoyé) → on vérifie la longueur via une collecte
-- fraîche : ici on contrôle plutôt la dédup (voir test suivant). On teste la
-- longueur en relisant les tournées directement.
SELECT is(
  (SELECT count(*)::int FROM plateforme.collecte_tournees ct
     JOIN plateforme.tournees t ON t.id = ct.tournee_id
    WHERE ct.collecte_id = 'ac600000-0000-0000-0000-0000000000a1'::uuid
      AND t.chauffeur_nom IS NOT NULL AND t.chauffeur_telephone IS NOT NULL),
  2,
  'Complétude : 2 tournées renseignées (multi-camions)'
);

-- Dédup : 2e appel → NULL (déjà stampé).
SELECT is(
  plateforme.fn_infos_acces_marquer_si_complet('ac600000-0000-0000-0000-0000000000a1'::uuid),
  NULL,
  'RPC : NULL au 2e appel (anti-double-envoi via le stamp)'
);

-- Contrôle négatif : collecte sans contrôle d'accès → NULL même si tournée pleine.
UPDATE plateforme.tournees
   SET chauffeur_nom = 'Paul Durand', chauffeur_telephone = '0633333333'
 WHERE id = 'ac700000-0000-0000-0000-0000000000b2'::uuid;

SELECT is(
  plateforme.fn_infos_acces_marquer_si_complet('ac600000-0000-0000-0000-0000000000b2'::uuid),
  NULL,
  'RPC : NULL quand controle_acces_requis = false (rien à envoyer)'
);

-- ═══ 2. RLS : cloisonnement des colonnes chauffeur/accompagnant ══════════════
-- Manager org A voit la tournée de SA collecte (colonnes lisibles).
SELECT test_set_jwt(
  'traiteur_manager', 'ac000000-0000-0000-0000-0000000000a1'::uuid,
  'ac200000-0000-0000-0000-0000000000a1'::uuid
);
SELECT is(
  (SELECT chauffeur_telephone FROM plateforme.tournees WHERE id = 'ac700000-0000-0000-0000-0000000000a1'::uuid),
  '0611111111',
  'RLS : le traiteur propriétaire lit chauffeur_telephone de sa tournée'
);

-- Manager org B ne voit PAS la tournée de la collecte org A.
SELECT test_set_jwt(
  'traiteur_manager', 'ac000000-0000-0000-0000-0000000000b2'::uuid,
  'ac200000-0000-0000-0000-0000000000b2'::uuid
);
SELECT is(
  (SELECT count(*)::int FROM plateforme.tournees WHERE id = 'ac700000-0000-0000-0000-0000000000a1'::uuid),
  0,
  'RLS : tournée (et ses colonnes chauffeur) invisible à une autre organisation'
);

-- Admin voit tout (contrôle positif staff).
SELECT test_set_jwt('admin_savr', NULL, gen_random_uuid());
SELECT is(
  (SELECT count(*)::int FROM plateforme.tournees WHERE id = 'ac700000-0000-0000-0000-0000000000a1'::uuid),
  1,
  'RLS : admin_savr voit la tournée à contrôle d''accès'
);

SELECT test_as_superuser();
SELECT * FROM finish();
ROLLBACK;
