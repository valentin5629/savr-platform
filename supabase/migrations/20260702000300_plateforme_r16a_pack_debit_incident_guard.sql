-- =============================================================================
-- R16a (BL-P1-RM-09) — Garde incident sur le débit de crédit pack AG.
-- =============================================================================
-- Corps de base : DERNIÈRE def = 20260623120000 (converge pack_statut, seuil TZ
-- Europe/Paris). Reproduit VERBATIM ; seul ajout : une garde INCIDENT en tête.
--
-- §05 §4bis « Collecte manquée par le prestataire » : `statut = annulee` +
-- `incident_imputable_a` renseigné → **PAS de facturation** (« ni ZD, ni débit de
-- pack AG »). Sans cette garde, un incident AG imputable au prestataire (annulé
-- < 12h ou déjà mandaté) déclencherait à tort le débit d'un crédit pack.
--
-- Discriminateur = `incident_imputable_a` posé dans le MÊME UPDATE que statut=annulee
-- (cf. fn_modifier_collecte RM-09) :
--   - NULL              → annulation « normale » → règle <12h / mandat inchangée (débit possible).
--   - 'client'          → annulation tardive imputable au client → débit (§05 §4bis annulation last-minute client).
--   - autre (prestataire/savr/association/externe) → incident non imputable au client → AUCUN débit.
--
-- ⚠ CREATE OR REPLACE réinitialise search_path → on RÉ-INCLUT `SET search_path`.
--
-- ── ROLLBACK (down-migration, DoD §rollback) ────────────────────────────────
-- Ré-appliquer le corps de fn_trg_pack_debit_annulation_tardive tel qu'AVANT R16a,
-- c.-à-d. le CREATE OR REPLACE de 20260623120000_plateforme_converge_pack_statut_
-- valeurs_g1_clusterB.sql (même signature, sans la garde incident) :
--   psql -f supabase/migrations/20260623120000_plateforme_converge_pack_statut_valeurs_g1_clusterB.sql
-- Effet : un incident AG imputable prestataire redéclencherait le débit pack (état
-- pré-R16a). Le trigger trg_pack_debit_annulation_tardive n'est pas re-créé (inchangé).
-- Non destructif.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_pack_statut  plateforme.pack_statut;
  v_delai_court  boolean;
  v_mandat_actif boolean;
BEGIN
  -- Uniquement AG → annulee depuis un statut NON realisee (trigger 3 couvre l'annulation post-realisee)
  IF NEW.statut != 'annulee' OR OLD.statut = 'annulee' OR OLD.statut = 'realisee' THEN
    RETURN NEW;
  END IF;
  IF NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  -- RM-09 : incident NON imputable au client → collecte manquée non facturable
  -- (§05 §4bis « Pas de facturation au client, ni débit de pack AG »). Seule une
  -- annulation tardive imputable au CLIENT (ou une annulation sans incident) débite.
  IF NEW.incident_imputable_a IS NOT NULL AND NEW.incident_imputable_a <> 'client' THEN
    RETURN NEW;
  END IF;

  -- Condition 1 : < 12h avant la collecte
  -- < 12h avant l'heure de collecte (spec §05 L187/356 : strict « < 12h »).
  -- Ancrage fuseau métier Europe/Paris : date_collecte (date) + heure_collecte (time)
  -- sont des wall-clocks naïfs ; sans AT TIME ZONE ils seraient interprétés en UTC
  -- (session Supabase = UTC), décalant le seuil de 1-2h (DST) — bug E2.
  v_delai_court := (
    ((NEW.date_collecte + COALESCE(NEW.heure_collecte, '00:00:00'::time))
       AT TIME ZONE 'Europe/Paris')
    - INTERVAL '12 hours'
  ) < now();

  -- Condition 2 : prestataire mandaté (ordre déjà envoyé au TMS)
  v_mandat_actif := (
    OLD.statut_tms IS NOT NULL
    AND OLD.statut_tms NOT IN ('non_envoye', 'a_attribuer')
  );

  IF NOT (v_delai_court OR v_mandat_actif) THEN
    RETURN NEW; -- pas de débit si annulation en avance sans mandat
  END IF;

  -- Condition tardive remplie mais aucun pack attaché → alerte Admin (§05 §3 F3)
  IF OLD.pack_antgaspi_id IS NULL THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'ag_annulee_tardive_sans_pack_actif',
      'Annulation tardive AG sans pack attaché',
      'La collecte ' || NEW.id::text || ' a été annulée tardivement sans pack AG attaché. Vérifier et imputer manuellement si nécessaire.',
      'collecte',
      NEW.id
    );
    RETURN NEW;
  END IF;

  -- Débit
  UPDATE plateforme.packs_antgaspi
  SET
    credits_consommes = credits_consommes + 1,
    statut = CASE
      WHEN credits_consommes + 1 >= credits_initiaux THEN 'epuise'::plateforme.pack_statut
      ELSE statut
    END,
    updated_at = now()
  WHERE id = OLD.pack_antgaspi_id
  RETURNING statut INTO v_pack_statut;

  -- Alerte si épuisé
  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || OLD.pack_antgaspi_id::text || ' est épuisé suite à une annulation tardive.',
      'pack_antgaspi',
      OLD.pack_antgaspi_id
    );
  END IF;

  -- Audit
  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, old_values, new_values
  ) VALUES (
    'packs_antgaspi', OLD.pack_antgaspi_id,
    'pack_debite_annulation_tardive',
    jsonb_build_object('collecte_id', NEW.id),
    jsonb_build_object(
      'motif_delai_court', v_delai_court,
      'motif_mandat', v_mandat_actif,
      'statut_apres', v_pack_statut
    )
  );

  RETURN NEW;
END;
$function$;
