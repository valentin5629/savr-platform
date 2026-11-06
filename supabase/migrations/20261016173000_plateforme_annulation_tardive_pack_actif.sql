-- =============================================================================
-- Annulation tardive AG : le crédit se débite sur le pack ACTIF de
-- l'organisation, pas sur le pack réservé à l'envoi
-- =============================================================================
-- Défaut relevé le 2026-10-16 par la revue de conformité de la PR
-- feat/admin-rattacher-collecte-pack, laissé hors de ce lot.
-- fn_trg_pack_debit_annulation_tardive débitait `OLD.pack_antgaspi_id`, le
-- pack réservé à l'envoi au transporteur, sans vérifier qu'il était encore
-- actif. Pack P1 à un crédit, collecte A réalisée (P1 épuisé), collecte B (qui
-- avait réservé P1) annulée à moins de 4 h : le débit dépassait
-- credits_initiaux et l'annulation ÉCHOUAIT sur chk_pack_credits_limite
-- (23514). À l'inverse, une collecte jamais envoyée (sans réservation),
-- annulée tardivement, ne débitait rien alors que l'organisation avait un pack
-- actif.
--
-- CDC §05 §3 « Débit d'un crédit », action identique pour les deux
-- déclencheurs (réalisation et annulation tardive) : crédit débité « sur le
-- pack actif unique de l'organisation programmatrice
-- (evenements.organisation_id) » ; sans pack actif à l'instant du
-- déclencheur, aucun débit et alerte `ag_annulee_tardive_sans_pack_actif`
-- (F3 ; scénario ag_realisee_sans_pack_actif_alerte_seule : « le même
-- comportement s'applique à l'annulation tardive sans pack actif »). Le code
-- rejoint le CDC, qui ne bouge pas : aucune fiche de divergence.
--
-- fn_trg_pack_debit_annulation_tardive : corps de 20261015180000 (§1), à
-- l'identique jusqu'au délai ; changent :
--   - le pack débité : le pack `actif` de l'organisation de l'événement, lu
--     sous FOR UPDATE comme dans fn_trg_pack_debit_realisee (même ordre de
--     verrous : la collecte, puis le pack) ;
--   - sans pack actif : la réservation est levée (`NEW.pack_antgaspi_id :=
--     NULL`), comme fn_trg_pack_debit_realisee depuis 20261016140000, puis
--     l'alerte. La collecte est alors rattachable à un pack pris plus tard
--     (f_collecte_rattachable_pack exige pack_antgaspi_id NULL et cette
--     alerte). Titre et message de l'alerte : « sans pack actif » au lieu de
--     « sans pack attaché » ;
--   - après le débit : `NEW.pack_antgaspi_id := v_pack_id` (§05 §3 action 3,
--     la collecte porte le pack consommé) ; alertes et audit_log portent ce
--     pack. Le journal garde son action, sa table et `old_values.collecte_id`,
--     que lit l'historique « Mon pack AG » du gestionnaire.
--
-- Backward-compatible, non destructive : un CREATE OR REPLACE (signature,
-- propriétaire et droits inchangés — un CREATE OR REPLACE ne touche pas aux
-- ACL, et la fonction n'est appelée que par son déclencheur). Aucune table,
-- aucun GRANT, aucune policy. Aucune donnée reprise : aucune annulation n'a pu
-- aboutir dans le cas qui échouait, et aucun utilisateur réel en production au
-- 2026-10-16.
-- Retour arrière : rejouer le corps de 20261015180000 (§1).
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_pack_id      uuid;
  v_organisation uuid;
  v_pack_statut  plateforme.pack_statut;
  v_reference    timestamptz;
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

  -- Instant de référence (Val 2026-10-15) : une demande d'annulation confirmée
  -- par l'Admin (annulation_demandee → annulee) se juge à sa réception ; toute
  -- autre annulation, à l'instant où elle est faite.
  v_reference := CASE
    WHEN OLD.statut = 'annulation_demandee'
      THEN COALESCE(OLD.annulation_demandee_at, now())
    ELSE now()
  END;

  -- Seule condition (Val 2026-10-15) : < 4h avant l'heure de collecte, strict.
  -- À 4h pile ou plus, aucun débit, que le prestataire soit mandaté ou non.
  -- Ancrage fuseau métier Europe/Paris : date_collecte (date) + heure_collecte (time)
  -- sont des wall-clocks naïfs ; sans AT TIME ZONE ils seraient interprétés en UTC
  -- (session Supabase = UTC), décalant le seuil de 1-2h (DST) — bug E2.
  v_delai_court := (
    ((NEW.date_collecte + COALESCE(NEW.heure_collecte, '00:00:00'::time))
       AT TIME ZONE 'Europe/Paris')
    - INTERVAL '4 hours'
  ) < v_reference;

  IF NOT v_delai_court THEN
    RETURN NEW; -- annulation à 4h ou plus du créneau → pas de débit
  END IF;

  -- Pack débité : le pack actif de l'organisation programmatrice (§05 §3), pas
  -- celui réservé à l'envoi au transporteur, qui a pu s'épuiser depuis.
  SELECT e.organisation_id INTO v_organisation
  FROM plateforme.evenements e
  WHERE e.id = NEW.evenement_id;

  -- Même verrou que fn_trg_pack_debit_realisee : FOR UPDATE, jamais SKIP LOCKED
  -- (le pack actif est la ressource partagée de l'organisation).
  SELECT id INTO v_pack_id
  FROM plateforme.packs_antgaspi
  WHERE organisation_id = v_organisation AND statut = 'actif'
  FOR UPDATE;

  IF v_pack_id IS NULL THEN
    -- Aucun pack actif (§05 §3 F3) : aucun débit, la réservation périmée est
    -- levée, la collecte reste rattachable à un pack pris plus tard.
    NEW.pack_antgaspi_id := NULL;
    PERFORM plateforme.f_upsert_alerte_admin(
      'ag_annulee_tardive_sans_pack_actif',
      'Annulation tardive AG sans pack actif',
      'La collecte ' || NEW.id::text || ' a été annulée tardivement sans pack AG actif : aucun crédit débité. La rattacher depuis sa fiche à un pack pris plus tard, ou imputer manuellement si nécessaire.',
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
  WHERE id = v_pack_id
  RETURNING statut, credits_initiaux, credits_consommes
    INTO v_pack_statut, v_initiaux, v_consommes;

  -- La collecte porte le pack consommé (§05 §3 action 3)
  NEW.pack_antgaspi_id := v_pack_id;

  -- Alerte si épuisé
  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || v_pack_id::text || ' est épuisé suite à une annulation tardive.',
      'pack_antgaspi',
      v_pack_id
    );
  ELSE
    -- BL-P2-30 (R22e) : franchissement du seuil « bientôt épuisé » ≤ 10 % (§05 l.1018)
    PERFORM plateforme.f_alerte_pack_bas(v_pack_id, v_initiaux, v_consommes);
  END IF;

  -- Audit
  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, old_values, new_values
  ) VALUES (
    'packs_antgaspi', v_pack_id,
    'pack_debite_annulation_tardive',
    jsonb_build_object('collecte_id', NEW.id),
    jsonb_build_object(
      'motif_delai_court', v_delai_court,
      'instant_reference', v_reference,
      'statut_apres', v_pack_statut
    )
  );

  RETURN NEW;
END;
$function$;
