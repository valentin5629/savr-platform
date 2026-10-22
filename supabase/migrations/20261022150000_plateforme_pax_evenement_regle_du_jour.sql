-- =============================================================================
-- Pax de l'événement — règle du jour révisée (décision Val 2026-10-21)
-- =============================================================================
-- DEMANDE : la règle C1 du 2026-10-20 prenait, pour chaque jour de collecte, le
-- plus grand pax des collectes non annulées de ce jour. Deux collectes du même
-- type le même jour pour des convives différents (un congrès : salle plénière
-- 700, espace exposants 400) donnaient 700 au lieu de 1 100. Val a révisé la
-- règle le 2026-10-21 (question Q1 de la fiche
-- `M1.2_20261020_pax-par-collecte`, patchée au CDC le même jour) :
--
--   pour chaque jour de collecte, le plus grand des deux totaux du jour —
--   somme des pax des collectes ZD non annulées, somme des pax des collectes
--   AG non annulées —, puis la somme des jours.
--
-- Une ZD et une AG du même soir comptent une fois ; deux ZD ou deux AG du même
-- jour s'additionnent ; deux soirées s'additionnent. Contre-cas assumé par Val :
-- un déjeuner et un dîner du même jour pour les mêmes convives comptent deux
-- fois.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. `f_pax_evenement` calcule la nouvelle règle. Le déclencheur qui l'appelle
--      (`trg_set_pax_evenement`, migration 20261021073000) ne change pas : il
--      surveille déjà le pax, la date, l'annulation et l'événement d'une
--      collecte. Le type d'une collecte n'est écrit qu'à sa création : aucune
--      RPC ni route ne le modifie.
--   2. Recalcul une fois des événements existants, puis contrôle positif. Seuls
--      changent les événements qui ont, un même jour, plusieurs collectes non
--      annulées du même type.
--
-- ACCÈS : aucun droit ouvert. `f_pax_evenement` garde ses droits (CREATE OR
-- REPLACE les conserve) ; le REVOKE est rejoué pour ne pas en dépendre. Fonction
-- SECURITY INVOKER, inchangé.
--
-- ROLLBACK : rejouer la définition de `f_pax_evenement` de 20261021073000, puis
-- le même recalcul. Les pax d'événement reviennent à l'ancienne règle.
-- =============================================================================

-- ─── 0. Rôle de migration ────────────────────────────────────────────────────
-- `collectes` et `evenements` sont en RLS forcée : le recalcul ne voit toutes
-- les lignes que si le rôle contourne la RLS (même garde qu'en 20261021073000).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'rôle % soumis à la RLS : le recalcul du pax serait partiel',
      current_user;
  END IF;
END $$;

-- ─── 1. Nouvelle règle ───────────────────────────────────────────────────────
-- GREATEST ignore un total absent (aucune collecte de ce type ce jour-là).
CREATE OR REPLACE FUNCTION plateforme.f_pax_evenement(p_evenement_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = plateforme, pg_catalog
AS $$
  SELECT sum(j.pax_jour)::integer
    FROM (
      SELECT GREATEST(
               sum(c.pax) FILTER (WHERE c.type = 'zero_dechet'),
               sum(c.pax) FILTER (WHERE c.type = 'anti_gaspi')
             ) AS pax_jour
        FROM plateforme.collectes c
       WHERE c.evenement_id = p_evenement_id
         AND c.statut != 'annulee'
       GROUP BY c.date_collecte
    ) j;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.f_pax_evenement(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plateforme.f_pax_evenement(uuid) IS
  'Pax d''un événement (règle du jour révisée par Val le 2026-10-21) : pour chaque jour de collecte, le plus grand des deux totaux du jour (somme des pax des collectes ZD non annulées, somme des pax des collectes AG non annulées), puis la somme des jours. SECURITY INVOKER : lit les collectes sous la RLS de l''appelant.';

COMMENT ON COLUMN plateforme.evenements.pax IS
  'Nombre de convives de l''événement, CALCULÉ depuis ses collectes non annulées (f_pax_evenement, déclencheur trg_set_pax_evenement) : pour chaque jour, le plus grand des deux totaux (somme des pax ZD, somme des pax AG), puis la somme des jours (règle révisée par Val le 2026-10-21). Inchangé si l''événement n''a plus de collecte non annulée.';

-- ─── 2. Recalcul des événements existants ────────────────────────────────────
-- Le déclencheur de l'événement ne surveille que les contacts (20261021073000) :
-- ce recalcul n'arme aucune collecte « modifiée après envoi ».
UPDATE plateforme.evenements e
   SET pax = plateforme.f_pax_evenement(e.id),
       updated_at = now()
 WHERE plateforme.f_pax_evenement(e.id) IS NOT NULL
   AND e.pax IS DISTINCT FROM plateforme.f_pax_evenement(e.id);

-- Contrôle POSITIF : tout événement qui a une collecte non annulée porte le pax
-- calculé.
DO $$
DECLARE
  v_attendus integer;
  v_conformes integer;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE e.pax = plateforme.f_pax_evenement(e.id))
    INTO v_attendus, v_conformes
    FROM plateforme.evenements e
   WHERE plateforme.f_pax_evenement(e.id) IS NOT NULL;
  IF v_conformes <> v_attendus THEN
    RAISE EXCEPTION 'evenements.pax : % événement(s) sur % sans le pax calculé',
      v_attendus - v_conformes, v_attendus;
  END IF;
END $$;
