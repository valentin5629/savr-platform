-- =============================================================================
-- Rattacher après coup une collecte Anti-Gaspi au pack actif de son organisation
-- =============================================================================
-- Décision Val du 2026-10-16 : sans pack actif, une collecte AG se programme et
-- est facturée à l'unité ; « l'admin a la possibilité de réattribuer la collecte
-- à un pack s'il est pris plus tard ». Arbitrages du même jour :
--   - collectes rattachables : réalisées, clôturées et annulées tardivement ;
--   - facture unitaire déjà créée : brouillon retiré ; facture envoyée à
--     Pennylane → rattachement permis, l'Admin émet l'avoir (avertissement
--     affiché par l'application).
--
-- Une collecte à venir n'a pas besoin de cette action : le pack actif est
-- réservé à l'envoi au transporteur et débité au passage à `realisee`
-- (fn_trg_pack_debit_realisee). Seules restent les collectes déjà réalisées ou
-- annulées tardivement sans pack, que ce déclencheur a laissées sans débit.
--
-- Réservation périmée (relevé de la revue de conformité) : si le pack réservé
-- à l'envoi s'épuise avant la réalisation (2 collectes pour 1 crédit restant),
-- la collecte était réalisée sans débit MAIS gardait `pack_antgaspi_id` sur le
-- pack épuisé : le batch la facturait au prix de ce pack (ou pas du tout pour
-- un pack `globale_achat`), contre la règle « sans pack actif, facturation à
-- l'unité », et le recrédit d'une annulation post-réalisation recréditait un
-- pack jamais débité. Le déclencheur lève désormais cette réservation.
--
-- Objets :
--   0. fn_trg_pack_debit_realisee : corps de 20261016120000, branche « aucun
--      pack actif » : `NEW.pack_antgaspi_id := NULL` + message qui mentionne
--      le rattachement.
--   1. f_collecte_rattachable_pack(uuid) : la collecte est AG, sans pack, sans
--      crédit annulé côté Savr, et `realisee` / `cloturee`, ou `annulee` après
--      une annulation tardive sans pack. Ce dernier cas n'est inscrit nulle part
--      sur la collecte : la trace est l'alerte `ag_annulee_tardive_sans_pack_actif`
--      que fn_trg_pack_debit_annulation_tardive émet à cet instant précis (et
--      seulement si l'incident n'est pas imputable à Savr, RM-09).
--   2. rpc_rattacher_collecte_pack(uuid, uuid, text) : sous verrou de la collecte puis
--      du pack actif (même ordre que le déclencheur de débit), débite un crédit
--      exactement comme fn_trg_pack_debit_realisee (bascule `epuise`, alertes
--      pack épuisé / pack bas), pose `collectes.pack_antgaspi_id`, retire la
--      ligne de la collecte de tout brouillon de facture actif (brouillon vidé
--      → `annulee` ; sinon totaux recalculés comme recomputeFactureTotaux),
--      résout les alertes « sans pack » de la collecte, trace l'audit_log
--      (auteur et rôle passés par la route, comme fn_accepter_mission_everest_manuelle).
--      Une collecte clôturée dont le brouillon est retiré est refacturée par le
--      batch suivant au prix du pack (`par_collecte`) ou pas du tout (pack
--      `globale_achat`, déjà facturé à l'achat) : calculer_tarif_ag lit
--      désormais son `pack_antgaspi_id`.
--
-- Accès : les deux fonctions sont réservées à `service_role` (route Admin
-- POST /api/v1/admin/collectes/:id/rattacher-pack et GET de la fiche). Aucun
-- client ne peut les appeler.
--
-- Backward-compatible, non destructive : un CREATE OR REPLACE (déclencheur de
-- débit, signature, propriétaire et droits inchangés) et deux fonctions neuves ;
-- aucune table ni colonne touchée, aucune policy. Les collectes déjà réalisées
-- avec une réservation périmée ne sont pas reprises (aucune donnée réelle en
-- production au 2026-10-16).
-- =============================================================================

-- ─── 0. Débit à la réalisation : réservation périmée levée ───────────────────
-- Corps de 20261016120000 (lui-même 20260709120000, messages réécrits), seule
-- la branche « aucun pack actif » change : `NEW.pack_antgaspi_id := NULL` et le
-- message mentionne le rattachement. Doit être appliquée APRÈS 20261016120000.
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_realisee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_pack_id      uuid;
  v_organisation uuid;
  v_pack_statut  plateforme.pack_statut;
  v_initiaux     integer;
  v_consommes    integer;
BEGIN
  -- Uniquement AG passant à realisee (depuis un statut différent)
  IF NEW.statut != 'realisee' OR OLD.statut = 'realisee' OR NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  -- Résoudre l'organisation via l'événement
  SELECT e.organisation_id INTO v_organisation
  FROM plateforme.evenements e
  WHERE e.id = NEW.evenement_id;

  IF v_organisation IS NULL THEN RETURN NEW; END IF;

  -- M6 : FOR UPDATE (et NON FOR UPDATE SKIP LOCKED) — le pack actif est l'unique
  -- ressource partagée de l'org ; sous concurrence (batch 6h), il FAUT attendre le
  -- verrou plutôt que de le sauter (sauter = débit perdu + fausse alerte).
  SELECT id INTO v_pack_id
  FROM plateforme.packs_antgaspi
  WHERE organisation_id = v_organisation AND statut = 'actif'
  FOR UPDATE;

  IF v_pack_id IS NULL THEN
    -- Aucun pack actif : aucun débit. La réservation posée à l'envoi au
    -- transporteur (pack devenu épuisé ou annulé entre-temps) est levée : la
    -- collecte est facturée à l'unité, et rattachable à un pack pris plus tard
    -- (décision Val 2026-10-16). Sans cela, le batch la facturait au prix d'un
    -- pack jamais débité (ou pas du tout s'il était facturé à l'achat).
    NEW.pack_antgaspi_id := NULL;
    -- Alerte Ops in-app (fonctionnelle, pas Slack — §07 Observabilité)
    PERFORM plateforme.f_upsert_alerte_admin(
      'ag_realisee_sans_pack_actif',
      'Collecte AG réalisée sans pack actif',
      'La collecte ' || NEW.id::text || ' est passée à réalisée sans pack AG actif : elle sera facturée à l''unité, ou rattachée depuis sa fiche à un pack pris plus tard.',
      'collecte',
      NEW.id
    );
    RETURN NEW;
  END IF;

  -- Décrémenter + basculer epuise si dernier crédit
  UPDATE plateforme.packs_antgaspi
  SET
    credits_consommes = credits_consommes + 1,
    statut = CASE
      WHEN credits_consommes + 1 >= credits_initiaux THEN 'epuise'::plateforme.pack_statut
      ELSE statut
    END,
    updated_at = now()
  WHERE id = v_pack_id
  RETURNING statut, credits_initiaux, credits_consommes
    INTO v_pack_statut, v_initiaux, v_consommes;

  -- Rattacher la collecte au pack
  NEW.pack_antgaspi_id := v_pack_id;

  -- Alerte si pack épuisé
  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || v_pack_id::text || ' est épuisé. Les prochaines collectes AG de l''organisation seront facturées à l''unité jusqu''à un nouveau pack.',
      'pack_antgaspi',
      v_pack_id
    );
  ELSE
    -- BL-P2-30 (R22e) : franchissement du seuil « bientôt épuisé » ≤ 10 % (§05 l.1018)
    PERFORM plateforme.f_alerte_pack_bas(v_pack_id, v_initiaux, v_consommes);
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 1. Éligibilité ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.f_collecte_rattachable_pack(p_collecte_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = plateforme, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM plateforme.collectes c
     WHERE c.id = p_collecte_id
       AND c.type = 'anti_gaspi'
       AND c.pack_antgaspi_id IS NULL
       AND c.annulee_cote_savr = false
       AND (
         c.statut IN ('realisee', 'cloturee')
         OR (
           c.statut = 'annulee'
           AND EXISTS (
             SELECT 1
               FROM plateforme.alertes_admin a
              WHERE a.code = 'ag_annulee_tardive_sans_pack_actif'
                AND a.entity_type = 'collecte'
                AND a.entity_id = c.id
           )
         )
       )
  );
$$;

COMMENT ON FUNCTION plateforme.f_collecte_rattachable_pack(uuid) IS
  'Collecte AG rattachable après coup au pack actif (décision Val 2026-10-16) : sans pack, sans crédit annulé côté Savr, realisee/cloturee, ou annulee après une annulation tardive sans pack (trace : alerte ag_annulee_tardive_sans_pack_actif). service_role uniquement.';

-- Fermeture explicite : un REVOKE FROM PUBLIC seul ne retire pas un GRANT nominatif
-- hérité des privilèges par défaut du schéma (cf. P0 20260903130000).
REVOKE EXECUTE ON FUNCTION plateforme.f_collecte_rattachable_pack(uuid)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_collecte_rattachable_pack(uuid)
  TO service_role;

-- ─── 2. Rattachement ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.rpc_rattacher_collecte_pack(
  p_collecte_id uuid,
  p_user_id uuid,
  p_role text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_organisation uuid;
  v_pack_id      uuid;
  v_pack_statut  plateforme.pack_statut;
  v_initiaux     integer;
  v_consommes    integer;
  v_brouillons   integer := 0;
  v_envoyee      boolean := false;
  r              record;
BEGIN
  -- Verrou de la collecte d'abord (même ordre que le déclencheur de débit :
  -- collecte, puis pack).
  PERFORM 1 FROM plateforme.collectes WHERE id = p_collecte_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte non trouvée' USING ERRCODE = 'P0002';
  END IF;

  IF NOT plateforme.f_collecte_rattachable_pack(p_collecte_id) THEN
    RAISE EXCEPTION 'Collecte non rattachable : seule une collecte Anti-Gaspi sans pack, réalisée, clôturée ou annulée tardivement peut l''être'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT e.organisation_id INTO v_organisation
    FROM plateforme.collectes c
    JOIN plateforme.evenements e ON e.id = c.evenement_id
   WHERE c.id = p_collecte_id;

  SELECT id INTO v_pack_id
    FROM plateforme.packs_antgaspi
   WHERE organisation_id = v_organisation AND statut = 'actif'
   FOR UPDATE;
  IF v_pack_id IS NULL THEN
    RAISE EXCEPTION 'Aucun pack Anti-Gaspi actif pour cette organisation'
      USING ERRCODE = 'P0006';
  END IF;

  -- Débit, à l'identique de fn_trg_pack_debit_realisee.
  UPDATE plateforme.packs_antgaspi
  SET
    credits_consommes = credits_consommes + 1,
    statut = CASE
      WHEN credits_consommes + 1 >= credits_initiaux THEN 'epuise'::plateforme.pack_statut
      ELSE statut
    END,
    updated_at = now()
  WHERE id = v_pack_id
  RETURNING statut, credits_initiaux, credits_consommes
    INTO v_pack_statut, v_initiaux, v_consommes;

  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || v_pack_id::text || ' est épuisé. Les prochaines collectes AG de l''organisation seront facturées à l''unité jusqu''à un nouveau pack.',
      'pack_antgaspi',
      v_pack_id
    );
  ELSE
    PERFORM plateforme.f_alerte_pack_bas(v_pack_id, v_initiaux, v_consommes);
  END IF;

  UPDATE plateforme.collectes
     SET pack_antgaspi_id = v_pack_id,
         updated_at = now()
   WHERE id = p_collecte_id;

  -- Facture unitaire : la ligne de la collecte quitte tout brouillon actif ;
  -- une facture déjà partie (en attente Pennylane, émise, payée) est laissée
  -- telle quelle, l'Admin émet l'avoir. « Active » = non annulée, hors avoir
  -- (définition du batch de brouillons et de fn_trg_fc_collecte_non_facturee).
  FOR r IN
    SELECT fc.id AS ligne_id, f.id AS facture_id, f.statut::text AS statut
      FROM plateforme.factures_collectes fc
      JOIN plateforme.factures f ON f.id = fc.facture_id
     WHERE fc.collecte_id = p_collecte_id
       AND f.statut <> 'annulee'
       AND f.type <> 'avoir'
     FOR UPDATE OF f
  LOOP
    IF r.statut = 'brouillon' THEN
      DELETE FROM plateforme.factures_collectes WHERE id = r.ligne_id;
      IF EXISTS (
        SELECT 1 FROM plateforme.factures_collectes WHERE facture_id = r.facture_id
      ) THEN
        -- Totaux recalculés comme recomputeFactureTotaux (lib/facturation).
        UPDATE plateforme.factures f
           SET montant_ht = round(t.ht, 2),
               montant_tva = round(t.tva, 2),
               montant_ttc = round(t.ht + t.tva, 2),
               updated_at = now()
          FROM (
            SELECT coalesce(sum(montant_ligne_ht * quantite), 0) AS ht,
                   coalesce(sum(montant_ligne_ht * quantite * taux_tva / 100), 0) AS tva
              FROM plateforme.factures_collectes
             WHERE facture_id = r.facture_id
          ) t
         WHERE f.id = r.facture_id;
      ELSE
        -- Brouillon vidé : annulé (jamais numéroté, aucune trace fiscale perdue).
        UPDATE plateforme.factures
           SET statut = 'annulee',
               montant_ht = 0,
               montant_tva = 0,
               montant_ttc = 0,
               updated_at = now()
         WHERE id = r.facture_id;
      END IF;
      v_brouillons := v_brouillons + 1;
    ELSE
      v_envoyee := true;
    END IF;
  END LOOP;

  -- Les alertes « sans pack » de la collecte sont traitées.
  UPDATE plateforme.alertes_admin
     SET statut = 'resolue',
         resolue_at = now(),
         resolue_par_user_id = p_user_id
   WHERE entity_type = 'collecte'
     AND entity_id = p_collecte_id
     AND code IN ('ag_realisee_sans_pack_actif', 'ag_annulee_tardive_sans_pack_actif')
     AND statut = 'ouverte';

  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, user_id, role, old_values, new_values
  ) VALUES (
    'collectes', p_collecte_id,
    'pack_rattache_collecte',
    p_user_id,
    p_role,
    jsonb_build_object('pack_antgaspi_id', NULL),
    jsonb_build_object(
      'pack_antgaspi_id', v_pack_id,
      'statut_pack_apres', v_pack_statut,
      'brouillons_retires', v_brouillons,
      'facture_envoyee', v_envoyee
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'pack_antgaspi_id', v_pack_id,
    'statut_pack', v_pack_statut,
    'brouillons_retires', v_brouillons,
    'facture_envoyee', v_envoyee
  );
END;
$$;

COMMENT ON FUNCTION plateforme.rpc_rattacher_collecte_pack(uuid, uuid, text) IS
  'Rattache après coup une collecte AG au pack actif de son organisation (décision Val 2026-10-16) : débit d''un crédit (comme fn_trg_pack_debit_realisee), pack_antgaspi_id posé, ligne retirée des brouillons de facture, alertes « sans pack » résolues, audit_log. Rend facture_envoyee=true si une facture déjà partie porte la collecte (avoir à émettre par l''Admin). service_role uniquement.';

REVOKE EXECUTE ON FUNCTION plateforme.rpc_rattacher_collecte_pack(uuid, uuid, text)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_rattacher_collecte_pack(uuid, uuid, text)
  TO service_role;

-- =============================================================================
-- ROLLBACK (down-migration) — rien de destructif à défaire : retirer les deux
-- fonctions neuves (la RPC d'abord, puis la fonction d'éligibilité), une fois
-- la route Admin retirée, et ré-appliquer le corps de fn_trg_pack_debit_realisee
-- de 20261016120000. La migration elle-même ne crée aucune donnée.
-- =============================================================================
