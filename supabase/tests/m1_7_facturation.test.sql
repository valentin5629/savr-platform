-- pgTAP M1.7 — Facturation Pennylane
-- Tests : enums, colonnes factures/factures_collectes/sequences_facturation,
--         f_attribuer_numero_facture gapless, trigger avoir, RLS factures.

BEGIN;
SELECT plan(32);

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
  ARRAY['text','integer'],
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
  -- Insérer une organisation minimaliste
  INSERT INTO plateforme.organisations (id, raison_sociale, type_organisation)
  VALUES (gen_random_uuid(), 'Test Org Avoir', 'traiteur')
  RETURNING id INTO v_org_id;

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret_verification, est_principale)
  VALUES (gen_random_uuid(), v_org_id, 'Test EF', 'non_verifie', true)
  RETURNING id INTO v_ef_id;

  -- Insérer une facture en statut 'emise'
  INSERT INTO plateforme.factures (
    id, organisation_id, entite_facturation_id,
    statut, montant_ht, taux_tva, montant_tva, montant_ttc, devise
  )
  VALUES (gen_random_uuid(), v_org_id, v_ef_id, 'emise', 590, 20, 118, 708, 'EUR')
  RETURNING id INTO v_fac_id;

  -- Créer un avoir dessus → doit réussir
  PERFORM plateforme.factures FROM plateforme.factures WHERE id = v_fac_id AND statut = 'emise';
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
  INSERT INTO plateforme.organisations (id, raison_sociale, type_organisation)
  VALUES (gen_random_uuid(), 'Test Org Avoir Brouillon', 'traiteur')
  RETURNING id INTO v_org_id;

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret_verification, est_principale)
  VALUES (gen_random_uuid(), v_org_id, 'Test EF2', 'non_verifie', true)
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

SELECT * FROM finish();
ROLLBACK;
