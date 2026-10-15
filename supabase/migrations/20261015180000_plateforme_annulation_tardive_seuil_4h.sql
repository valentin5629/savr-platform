-- =============================================================================
-- Annulation tardive : seuil de 4 h avant le créneau, seule condition.
-- =============================================================================
-- Décisions Val du 2026-10-15 (divergence M2.1_20261015_annulation-tardive-4h) :
--   1. une annulation est « tardive » à moins de 4 h avant le créneau
--      (date_collecte + heure_collecte, heure de Paris), au lieu de 12 h, pour
--      l'Anti-Gaspi (débit d'un crédit du pack) comme pour le Zéro Déchet
--      (facturation plein tarif, faite à la main par l'Admin) ;
--   2. la seconde condition « OU prestataire déjà mandaté » est RETIRÉE : une
--      annulation à 4 h ou plus du créneau ne débite rien, même si le
--      transporteur a déjà reçu ou accepté l'ordre.
-- Le seuil d'urgence des MODIFICATIONS de créneau (12 h, décision du
-- 2026-10-09) n'est pas concerné : il vit dans le code de l'application.
--
-- Trois objets :
--   1. fn_trg_pack_debit_annulation_tardive : corps de 20260709120000 (R22e),
--      seuls changent le seuil, la condition mandat et la ligne d'audit
--      (`motif_mandat` n'a plus de sens ; aucun lecteur, mesuré par grep) ;
--   2. fn_est_debit_pack_attendu (oracle G9, 20260624120000) : même règle. Sa
--      signature garde `p_old_statut_tms`, désormais ignoré : la changer
--      demanderait un DROP FUNCTION ;
--   3. template 22 `admin_collecte_annulee` : la ligne ATTENTION dit « 4h ».
--      Le libellé « moins de 4h » / « 4h ou plus » de `delai_avant_creneau` et
--      le drapeau `annulation_tardive` sont calculés par le code
--      (estAnnulationTardive) ; aucune variable n'est ajoutée ni retirée.
--
-- Backward-compatible, non destructive : deux CREATE OR REPLACE (signatures,
-- propriétaires et droits inchangés — un CREATE OR REPLACE ne touche pas aux
-- ACL) et l'UPDATE d'une ligne de référentiel. Aucun accès ouvert. Idempotent.
-- Retour arrière : rejouer les corps de 20260709120000 (§5) et de
-- 20260624120000 (oracle 1), et le corps du template de 20260708150000.
-- =============================================================================

-- ─── 1. Trigger débit annulation tardive ─────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_pack_statut  plateforme.pack_statut;
  v_delai_court  boolean;
  v_initiaux     integer;
  v_consommes    integer;
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

  -- Seule condition (Val 2026-10-15) : < 4h avant l'heure de collecte, strict.
  -- À 4h pile ou plus, aucun débit, que le prestataire soit mandaté ou non.
  -- Ancrage fuseau métier Europe/Paris : date_collecte (date) + heure_collecte (time)
  -- sont des wall-clocks naïfs ; sans AT TIME ZONE ils seraient interprétés en UTC
  -- (session Supabase = UTC), décalant le seuil de 1-2h (DST) — bug E2.
  v_delai_court := (
    ((NEW.date_collecte + COALESCE(NEW.heure_collecte, '00:00:00'::time))
       AT TIME ZONE 'Europe/Paris')
    - INTERVAL '4 hours'
  ) < now();

  IF NOT v_delai_court THEN
    RETURN NEW; -- annulation à 4h ou plus du créneau → pas de débit
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
  RETURNING statut, credits_initiaux, credits_consommes
    INTO v_pack_statut, v_initiaux, v_consommes;

  -- Alerte si épuisé
  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || OLD.pack_antgaspi_id::text || ' est épuisé suite à une annulation tardive.',
      'pack_antgaspi',
      OLD.pack_antgaspi_id
    );
  ELSE
    -- BL-P2-30 (R22e) : franchissement du seuil « bientôt épuisé » ≤ 10 % (§05 l.1018)
    PERFORM plateforme.f_alerte_pack_bas(OLD.pack_antgaspi_id, v_initiaux, v_consommes);
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
      'statut_apres', v_pack_statut
    )
  );

  RETURN NEW;
END;
$function$;

-- ─── 2. Oracle G9 : débit pack attendu sur annulation tardive AG ─────────────
CREATE OR REPLACE FUNCTION plateforme.fn_est_debit_pack_attendu(
  p_old_statut     text,
  p_new_statut     text,
  p_type           text,
  p_pack_id        uuid,
  p_date_collecte  date,
  p_heure_collecte time,
  p_old_statut_tms text,  -- ignoré depuis le 2026-10-15 (condition mandat retirée)
  p_now            timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_delai_court boolean;
BEGIN
  -- Garde de transition : annulee depuis un statut non-annulee et non-realisee.
  IF p_new_statut <> 'annulee' OR p_old_statut = 'annulee' OR p_old_statut = 'realisee' THEN
    RETURN false;
  END IF;
  IF p_type <> 'anti_gaspi' THEN
    RETURN false;
  END IF;

  -- Seule condition : < 4h avant la collecte (STRICT), ancrage métier Europe/Paris.
  v_delai_court := (
    ((p_date_collecte + COALESCE(p_heure_collecte, '00:00:00'::time))
       AT TIME ZONE 'Europe/Paris')
    - INTERVAL '4 hours'
  ) < p_now;

  IF NOT v_delai_court THEN
    RETURN false; -- annulation à 4h ou plus du créneau → pas de débit
  END IF;

  -- Condition tardive remplie mais aucun pack attaché → alerte Admin, PAS de débit.
  IF p_pack_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- ─── 3. Template 22 : ligne ATTENTION de l'alerte Admin ──────────────────────
UPDATE plateforme.email_templates
SET corps_html = replace(
      corps_html,
      'ATTENTION : annulation à moins de 12h du créneau',
      'ATTENTION : annulation à moins de 4h du créneau'
    ),
    description = replace(description, '(< 12h)', '(< 4h)'),
    updated_at = now()
WHERE code = 'admin_collecte_annulee';

-- Contrôle de fin, comme 20261009190000 : la table est en FORCE ROW LEVEL
-- SECURITY, un rôle de migration sans BYPASSRLS mettrait à jour 0 ligne sans
-- erreur. On compte la ligne DANS L'ÉTAT ATTENDU.
DO $$
DECLARE
  v_a_jour integer;
BEGIN
  SELECT count(*) INTO v_a_jour
    FROM plateforme.email_templates
   WHERE code = 'admin_collecte_annulee'
     AND strpos(corps_html, 'ATTENTION : annulation à moins de 4h du créneau') > 0
     AND strpos(corps_html, '12h') = 0
     AND strpos(description, '12h') = 0;
  IF v_a_jour <> 1 THEN
    RAISE EXCEPTION
      'email_templates : % ligne admin_collecte_annulee au seuil de 4h, 1 attendue — le rôle de migration écrit-il sous RLS ?',
      v_a_jour;
  END IF;
END $$;
