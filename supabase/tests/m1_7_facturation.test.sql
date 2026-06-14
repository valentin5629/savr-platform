-- pgTAP M1.7 — Facturation Pennylane
-- Tests : enums, colonnes factures/factures_collectes/sequences_facturation,
--         f_attribuer_numero_facture gapless, trigger avoir, RLS factures.

BEGIN;
SELECT plan(37);

-- ── Helpers simulation JWT (identiques à rls_0_4_smoke.test.sql) ─────────────

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'role', p_role,
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

-- ── 1. Enums M1.7 ─────────────────────────────────────────────────────────

SELECT has_type('plateforme', 'facture_type', 'enum facture_type existe');
SELECT has_type('plateforme', 'facture_mode', 'enum facture_mode existe');
SELECT has_type('plateforme', 'tarif_source',  'enum tarif_source existe');

-- Valeurs enum facture_statut (inclut les nouvelles M1.7)
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'plateforme'
      AND t.typname = 'facture_statut_enum'
      AND e.enumlabel = 'en_attente_pennylane'
  ),
  'facture_statut_enum contient en_attente_pennylane'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'plateforme'
      AND t.typname = 'facture_statut_enum'
      AND e.enumlabel = 'emise'
  ),
  'facture_statut_enum contient emise'
);

-- ── 2. Colonnes factures M1.7 ─────────────────────────────────────────────

SELECT has_column('plateforme', 'factures', 'type',                           'col type sur factures');
SELECT has_column('plateforme', 'factures', 'mode_facturation',               'col mode_facturation');
SELECT has_column('plateforme', 'factures', 'pack_antgaspi_id',               'col pack_antgaspi_id');
SELECT has_column('plateforme', 'factures', 'erreur_synchro',                 'col erreur_synchro');
SELECT has_column('plateforme', 'factures', 'erreur_synchro_at',              'col erreur_synchro_at');
SELECT has_column('plateforme', 'factures', 'derniere_tentative_pennylane_at','col derniere_tentative_pennylane_at');
SELECT has_column('plateforme', 'factures', 'marge_logistique',               'col marge_logistique');
SELECT has_column('plateforme', 'factures', 'date_paiement',                  'col date_paiement');

-- numero_facture nullable (brouillons)
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'plateforme'
      AND table_name   = 'factures'
      AND column_name  = 'numero_facture'
      AND is_nullable  = 'NO'
  ),
  'numero_facture est nullable (brouillons sans numéro)'
);

-- ── 3. Colonnes factures_collectes M1.7 ───────────────────────────────────

SELECT has_column('plateforme', 'factures_collectes', 'designation',         'col designation');
SELECT has_column('plateforme', 'factures_collectes', 'quantite',            'col quantite');
SELECT has_column('plateforme', 'factures_collectes', 'taux_tva',            'col taux_tva');
SELECT has_column('plateforme', 'factures_collectes', 'tarif_applique_id',   'col tarif_applique_id');
SELECT has_column('plateforme', 'factures_collectes', 'tarif_applique_source','col tarif_applique_source');
SELECT has_column('plateforme', 'factures_collectes', 'tarif_detail',        'col tarif_detail');
SELECT has_column('plateforme', 'factures_collectes', 'montant_ligne_ht',    'col montant_ligne_ht');
SELECT has_column('plateforme', 'factures_collectes', 'libelle_ligne',       'col libelle_ligne');

-- ── 4. sequences_facturation — colonne dernier_numero ─────────────────────

SELECT has_column('plateforme', 'sequences_facturation', 'dernier_numero',
  'colonne renommée dernier → dernier_numero');

SELECT hasnt_column('plateforme', 'sequences_facturation', 'dernier',
  'ancienne colonne dernier supprimée');

-- ── 4b. Existence fonction et trigger M1.7 ──────────────────────────────

SELECT has_function('plateforme', 'f_attribuer_numero_facture',
  ARRAY['plateforme.serie_facturation_enum','smallint'],
  'fonction f_attribuer_numero_facture(serie, annee) existe');

SELECT has_trigger('plateforme', 'factures', 'trg_check_avoir_facture_valide',
  'trigger trg_check_avoir_facture_valide sur factures');

-- ── 5. f_attribuer_numero_facture — séquence gapless ─────────────────────

DELETE FROM plateforme.sequences_facturation WHERE serie IN ('FZD','FAG','FPK','AV') AND annee = 2099;

SELECT is(
  plateforme.f_attribuer_numero_facture('FZD', 2099),
  'FZD-2099-00001',
  'premier numéro FZD-2099-00001'
);

SELECT is(
  plateforme.f_attribuer_numero_facture('FZD', 2099),
  'FZD-2099-00002',
  'deuxième FZD-2099-00002 gapless'
);

SELECT is(
  plateforme.f_attribuer_numero_facture('AV', 2099),
  'AV-2099-00001',
  'premier numéro avoir AV-2099-00001'
);

SELECT is(
  plateforme.f_attribuer_numero_facture('FAG', 2099),
  'FAG-2099-00001',
  'premier numéro AG FAG-2099-00001'
);

-- ── 6. Trigger avoir — emise/payee autorisé, brouillon bloqué ─────────────

-- Utiliser SET LOCAL pour contourner RLS en mode test
SET LOCAL ROLE postgres;

DO $$
DECLARE
  v_org_id   uuid;
  v_ef_id    uuid;
  v_fac_id   uuid;
BEGIN
  INSERT INTO plateforme.organisations (id, nom, type)
  VALUES (gen_random_uuid(), 'Test Org Avoir', 'traiteur')
  RETURNING id INTO v_org_id;

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
  VALUES (gen_random_uuid(), v_org_id, 'Test EF', '00000000000001', '1 rue test', '75001', 'Paris')
  RETURNING id INTO v_ef_id;

  -- Insérer une facture en statut 'emise'
  INSERT INTO plateforme.factures (
    id, organisation_id, entite_facturation_id,
    statut, montant_ht, taux_tva, montant_tva, montant_ttc, devise
  )
  VALUES (gen_random_uuid(), v_org_id, v_ef_id, 'emise', 590, 20, 118, 708, 'EUR')
  RETURNING id INTO v_fac_id;

  -- Créer un avoir dessus → doit réussir (trigger autorise avoir sur emise)
  INSERT INTO plateforme.factures (
    id, organisation_id, entite_facturation_id,
    statut, montant_ht, taux_tva, montant_tva, montant_ttc, devise,
    facture_origine_id
  )
  VALUES (gen_random_uuid(), v_org_id, v_ef_id, 'brouillon', -590, 20, -118, -708, 'EUR', v_fac_id);
END;
$$;

SELECT ok(true, 'INSERT avoir sur facture emise : aucune exception');

-- Tenter un avoir sur brouillon → trigger doit bloquer
DO $$
DECLARE
  v_org_id   uuid;
  v_ef_id    uuid;
  v_fac_id   uuid;
  v_av_id    uuid;
  raised     boolean := false;
BEGIN
  INSERT INTO plateforme.organisations (id, nom, type)
  VALUES (gen_random_uuid(), 'Test Org Avoir Brouillon', 'traiteur')
  RETURNING id INTO v_org_id;

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
  VALUES (gen_random_uuid(), v_org_id, 'Test EF2', '00000000000002', '2 rue test', '75002', 'Paris')
  RETURNING id INTO v_ef_id;

  INSERT INTO plateforme.factures (
    id, organisation_id, entite_facturation_id,
    statut, montant_ht, taux_tva, montant_tva, montant_ttc, devise
  )
  VALUES (gen_random_uuid(), v_org_id, v_ef_id, 'brouillon', 590, 20, 118, 708, 'EUR')
  RETURNING id INTO v_fac_id;

  BEGIN
    INSERT INTO plateforme.factures (
      id, organisation_id, entite_facturation_id,
      statut, montant_ht, taux_tva, montant_tva, montant_ttc, devise,
      facture_origine_id
    )
    VALUES (gen_random_uuid(), v_org_id, v_ef_id, 'brouillon', -590, 20, -118, -708, 'EUR', v_fac_id)
    RETURNING id INTO v_av_id;
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'trigger avoir aurait dû bloquer sur brouillon';
  END IF;
END;
$$;

SELECT ok(true, 'trigger avoir bloque sur facture brouillon');

-- ── 7. v_factures_client — colonnes sensibles exclues (D-B) ──────────────────

SELECT hasnt_column('plateforme', 'v_factures_client', 'marge_logistique',
  'marge_logistique masqué dans v_factures_client (non visible clients)');

SELECT hasnt_column('plateforme', 'v_factures_client', 'erreur_synchro',
  'erreur_synchro masqué dans v_factures_client (non visible clients)');

-- ── 8. EXECUTE non accordé à PUBLIC sur fonctions numérotation (SEC-1) ───────

SELECT ok(
  (SELECT COUNT(*) = 0
   FROM information_schema.role_routine_grants
   WHERE routine_schema = 'plateforme'
     AND routine_name = 'f_attribuer_numero_facture'
     AND grantee = 'PUBLIC'
     AND privilege_type = 'EXECUTE'),
  'f_attribuer_numero_facture : EXECUTE non accordé à PUBLIC (protection séquence gapless)'
);

-- ── 9. CHECK chk_fc_collecte_ou_designation — ligne sans collecte ni désignation (D-C) ─

SET LOCAL ROLE postgres;

DO $$
DECLARE
  v_org_id uuid;
  v_ef_id  uuid;
  v_fac_id uuid;
  raised   boolean := false;
BEGIN
  INSERT INTO plateforme.organisations (id, nom, type)
  VALUES (gen_random_uuid(), 'Test Org CHECK', 'traiteur')
  RETURNING id INTO v_org_id;

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
  VALUES (gen_random_uuid(), v_org_id, 'Test EF CHECK', '00000000000003', '3 rue test', '75003', 'Paris')
  RETURNING id INTO v_ef_id;

  INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, statut, montant_ht, taux_tva, montant_tva, montant_ttc, devise)
  VALUES (gen_random_uuid(), v_org_id, v_ef_id, 'brouillon', 100, 20, 20, 120, 'EUR')
  RETURNING id INTO v_fac_id;

  BEGIN
    -- collecte_id=NULL ET designation=NULL → doit lever check_violation
    INSERT INTO plateforme.factures_collectes (facture_id, collecte_id, designation, montant_ht, montant_ligne_ht)
    VALUES (v_fac_id, NULL, NULL, 100, 100);
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'CHECK chk_fc_collecte_ou_designation aurait dû bloquer';
  END IF;
END;
$$;

SELECT ok(true, 'chk_fc_collecte_ou_designation : INSERT collecte_id=NULL + designation=NULL bloqué');

-- ── 10. v_factures_client — isolation cross-org sous authenticated ────────────

SET LOCAL ROLE postgres;

DO $$
DECLARE
  v_org_a  uuid;
  v_ef_a   uuid;
  v_org_b  uuid;
  v_uid_b  uuid := gen_random_uuid();
BEGIN
  INSERT INTO plateforme.organisations (id, nom, type)
  VALUES (gen_random_uuid(), 'Org A (cross-org test)', 'traiteur')
  RETURNING id INTO v_org_a;

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
  VALUES (gen_random_uuid(), v_org_a, 'EF A', '00000000000004', '4 rue test', '75004', 'Paris')
  RETURNING id INTO v_ef_a;

  INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, statut, montant_ht, taux_tva, montant_tva, montant_ttc, devise)
  VALUES (gen_random_uuid(), v_org_a, v_ef_a, 'emise', 590, 20, 118, 708, 'EUR');

  INSERT INTO plateforme.organisations (id, nom, type)
  VALUES (gen_random_uuid(), 'Org B (cross-org reader)', 'traiteur')
  RETURNING id INTO v_org_b;

  PERFORM test_set_jwt('traiteur_manager', v_org_b, v_uid_b);
END;
$$;

SELECT ok(
  (SELECT count(*) FROM plateforme.v_factures_client) = 0,
  'v_factures_client : org B ne voit pas les factures d''org A (isolation cross-org)'
);

SELECT test_as_superuser();

SELECT * FROM finish();
ROLLBACK;
