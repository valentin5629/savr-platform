-- =============================================================================
-- Pack Anti-Gaspi non bloquant : sans pack actif, la collecte AG est facturée à
-- l'unité.
-- =============================================================================
-- Décision Val du 2026-10-16 : n'importe qui peut programmer une collecte AG,
-- pack actif ou non. Sans pack actif, la facturation unitaire s'applique (tarif
-- `tarifs_packs_ag` type `unitaire` moins la remise négociée, déjà calculé par
-- `calculer_tarif_ag`). Le blocage applicatif est retiré dans le formulaire et
-- dans les trois routes de programmation (code de l'application) ; cette
-- migration ne corrige que les textes qui annonçaient encore ce blocage.
--
-- Objets :
--   1. fn_trg_pack_debit_realisee : corps de 20260709120000 (R22e), verbatim ;
--      seuls changent deux messages d'alerte Admin :
--        - `ag_realisee_sans_pack_actif` : « Vérifier et imputer manuellement »
--          devient « elle sera facturée à l'unité » (plus rien à arbitrer ;
--          l'alerte passe en « Info » côté application) ;
--        - `pack_ag_epuise` : « Renouvellement requis avant la prochaine
--          programmation AG » devient « les prochaines collectes AG seront
--          facturées à l'unité jusqu'à un nouveau pack ».
--   2. template 9 `admin_pack_ag_etat` : la phrase du bloc `niveau_epuise`
--      (« La programmation … est désormais bloquée ») est remplacée. Aucune
--      variable ajoutée ni retirée.
--
-- Backward-compatible, non destructive : un CREATE OR REPLACE (signature,
-- propriétaire et droits inchangés — un CREATE OR REPLACE ne touche pas aux
-- ACL) et l'UPDATE d'une ligne de référentiel. Aucun GRANT, aucune policy.
-- Les alertes déjà ouvertes gardent leur ancien message.
-- =============================================================================

-- ─── 1. Trigger débit sur collecte AG realisee : messages d'alerte ───────────
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
    -- Aucun pack actif : alerte Ops in-app (fonctionnelle, pas Slack — §07 Observabilité)
    PERFORM plateforme.f_upsert_alerte_admin(
      'ag_realisee_sans_pack_actif',
      'Collecte AG réalisée sans pack actif',
      'La collecte ' || NEW.id::text || ' est passée à réalisée sans pack AG actif : elle sera facturée à l''unité.',
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

-- ─── 2. Template 9 : bloc « pack épuisé » ────────────────────────────────────
UPDATE plateforme.email_templates
SET corps_html = replace(
      corps_html,
      'La programmation de nouvelles collectes Anti-Gaspi est désormais bloquée pour cette organisation jusqu''à l''acquisition d''un nouveau pack.',
      'Les prochaines collectes Anti-Gaspi de cette organisation seront facturées à l''unité jusqu''à l''acquisition d''un nouveau pack.'
    ),
    updated_at = now()
WHERE code = 'admin_pack_ag_etat';

-- Contrôle de fin, comme 20261015180000 : la table est en FORCE ROW LEVEL
-- SECURITY, un rôle de migration sans BYPASSRLS mettrait à jour 0 ligne sans
-- erreur. On compte la ligne DANS L'ÉTAT ATTENDU.
DO $$
DECLARE
  v_a_jour integer;
BEGIN
  SELECT count(*) INTO v_a_jour
    FROM plateforme.email_templates
   WHERE code = 'admin_pack_ag_etat'
     AND strpos(corps_html, 'seront facturées à l''unité jusqu''à l''acquisition d''un nouveau pack') > 0
     AND strpos(corps_html, 'bloquée') = 0;
  IF v_a_jour <> 1 THEN
    RAISE EXCEPTION
      'email_templates : % ligne admin_pack_ag_etat sans blocage, 1 attendue — le rôle de migration écrit-il sous RLS ?',
      v_a_jour;
  END IF;
END $$;

-- =============================================================================
-- ROLLBACK (down-migration) — rien de destructif à défaire :
--   1. ré-appliquer le corps de fn_trg_pack_debit_realisee de
--      20260709120000_plateforme_r22e_pack_etat_alertes.sql (verbatim) ;
--   2. UPDATE inverse du template `admin_pack_ag_etat` (replace des deux
--      phrases ci-dessus, dans l'autre sens).
-- =============================================================================
