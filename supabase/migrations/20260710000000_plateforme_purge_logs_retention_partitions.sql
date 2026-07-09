-- =============================================================================
-- BL-P2-33 / R22g (M0.9) — rotation + rétention des journaux tiers.
-- =============================================================================
-- Comble deux manques latents du Bloc 7 :
--   1. integrations_logs et audit_log sont PARTITION BY RANGE(created_at) mais seule la
--      partition 2026 existe → tout INSERT ≥ 2027-01-01 échoue (aucune partition cible).
--   2. Aucune purge de rétention n'est câblée (§04 l.2312 / §08 l.639 : integrations_logs
--      2 ans ; §04 l.2351 : integrations_inbox 7 j).
--
-- Livré : f_ensure_partition_annee (rotation), f_purge_logs (job « purge_logs » §07/02),
-- pré-provisionnement des partitions futures, durcissement des droits.
--
-- ADDITIVE : aucune donnée existante n'est modifiée. La seule opération destructrice est
-- le DROP de partitions integrations_logs ENTIÈREMENT antérieures à now()-2 ans, exécuté
-- à l'appel du cron (pas au déploiement) — no-op avant 2028. audit_log n'est JAMAIS purgé
-- (§07/02 l.55 « purge_logs ne touche jamais audit_log », rétention légale 5 ans).
--
-- REVIEWED-DESTRUCTIVE: f_purge_logs — DROP TABLE des partitions integrations_logs > 2 ans
--   (rétention §04/§08, ne touche que des partitions entièrement hors fenêtre) + DELETE des
--   lignes integrations_inbox > 7 j (§04 l.2351). Jamais audit_log. Non destructif du présent.
-- =============================================================================

-- 1) f_ensure_partition_annee : crée (idempotent) la partition annuelle d'une table
--    partitionnée par RANGE(created_at) et active la RLS sur l'enfant (DENY ALL — accès
--    direct interdit, lecture via la policy du parent). Whitelist stricte (anti-injection).
CREATE OR REPLACE FUNCTION plateforme.f_ensure_partition_annee(
  p_parent text,
  p_annee  integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
DECLARE
  v_child text;
BEGIN
  IF p_parent NOT IN ('integrations_logs', 'audit_log') THEN
    RAISE EXCEPTION 'f_ensure_partition_annee: table non autorisee %', p_parent;
  END IF;
  v_child := p_parent || '_' || p_annee::text;
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS plateforme.%I PARTITION OF plateforme.%I FOR VALUES FROM (%L) TO (%L)',
    v_child, p_parent,
    (p_annee::text || '-01-01'), ((p_annee + 1)::text || '-01-01')
  );
  EXECUTE format('ALTER TABLE plateforme.%I ENABLE ROW LEVEL SECURITY', v_child);
  -- FORCE : l'owner (postgres) reste soumis à la RLS — cohérent avec les partitions
  -- _2026 (migration 20260611180002 §22) ; service_role conserve son BYPASSRLS.
  EXECUTE format('ALTER TABLE plateforme.%I FORCE ROW LEVEL SECURITY', v_child);
END;
$$;

-- 2) f_purge_logs : job « purge_logs » (§07/02). Rotation integrations_logs (année courante
--    + suivante) + purge integrations_logs > 2 ans + purge integrations_inbox > 7 j.
--    Ne touche JAMAIS audit_log (§07/02 l.55). Retourne un récap jsonb pour l'observabilité.
CREATE OR REPLACE FUNCTION plateforme.f_purge_logs(
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
DECLARE
  v_year    integer := extract(year FROM p_now)::integer;
  v_cutoff  date    := (p_now - interval '2 years')::date;
  v_rec     record;
  v_pyear   integer;
  v_upper   date;
  v_dropped text[]  := ARRAY[]::text[];
  v_inbox   integer;
BEGIN
  -- Rotation : garantir la partition de l'année courante et de la suivante.
  PERFORM plateforme.f_ensure_partition_annee('integrations_logs', v_year);
  PERFORM plateforme.f_ensure_partition_annee('integrations_logs', v_year + 1);

  -- Rétention integrations_logs : DROP des partitions ENTIÈREMENT antérieures à 2 ans
  -- (borne haute exclusive de la partition ≤ cutoff → toute la plage est hors fenêtre).
  FOR v_rec IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c     ON c.oid = i.inhrelid
    JOIN pg_class p     ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'plateforme'
      AND p.relname = 'integrations_logs'
      AND c.relname ~ '^integrations_logs_[0-9]{4}$'
  LOOP
    v_pyear := substring(v_rec.relname FROM '([0-9]{4})$')::integer;
    v_upper := make_date(v_pyear + 1, 1, 1);
    IF v_upper <= v_cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS plateforme.%I', v_rec.relname);
      v_dropped := array_append(v_dropped, v_rec.relname);
    END IF;
  END LOOP;

  -- Rétention integrations_inbox : 7 jours (§04 l.2351 — table non partitionnée, DELETE).
  DELETE FROM plateforme.integrations_inbox WHERE created_at < p_now - interval '7 days';
  GET DIAGNOSTICS v_inbox = ROW_COUNT;

  RETURN jsonb_build_object(
    'annee', v_year,
    'partitions_supprimees', v_dropped,
    'nb_partitions_supprimees', coalesce(array_length(v_dropped, 1), 0),
    'inbox_supprimes', v_inbox,
    'cutoff', v_cutoff
  );
END;
$$;

-- 3) Durcissement — ces fonctions font du DDL (SECURITY DEFINER) : réservées au service_role
--    (cron purge-logs), jamais exposées à authenticated/anon (cf. REVOKE PUBLIC R22e).
REVOKE EXECUTE ON FUNCTION plateforme.f_ensure_partition_annee(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION plateforme.f_purge_logs(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_ensure_partition_annee(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION plateforme.f_purge_logs(timestamptz) TO service_role;

-- 4) Pré-provisionnement des partitions futures (l'insert ne casse pas au changement d'année
--    même si le cron n'a pas encore tourné). integrations_logs : +1 an (le cron entretient
--    ensuite). audit_log : runway 5 ans (rétention §07/02 ; jamais purgé par f_purge_logs).
DO $$
BEGIN
  PERFORM plateforme.f_ensure_partition_annee('integrations_logs', 2027);
  PERFORM plateforme.f_ensure_partition_annee('audit_log', 2027);
  PERFORM plateforme.f_ensure_partition_annee('audit_log', 2028);
  PERFORM plateforme.f_ensure_partition_annee('audit_log', 2029);
  PERFORM plateforme.f_ensure_partition_annee('audit_log', 2030);
  PERFORM plateforme.f_ensure_partition_annee('audit_log', 2031);
END;
$$;
