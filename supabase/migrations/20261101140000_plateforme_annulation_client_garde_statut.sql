-- Annulation d'une collecte par un client : le statut se vérifie sous le verrou.
--
-- Depuis la décision Val 2026-11-01 (PR #703), un traiteur, une agence ou un
-- gestionnaire de lieux qui annule une collecte en brouillon, programmée ou
-- validée la fait passer directement en `annulee`. Les routes lisaient le statut
-- sans verrou puis appelaient fn_modifier_collecte, qui ne garde pas la
-- transition : si la relève MTS-1 faisait passer la collecte en `en_cours` (ou
-- au-delà) entre les deux, l'annulation l'écrasait, l'ordre E3 partait et le
-- pack AG pouvait être débité.
--
-- fn_annuler_collecte_client prend le verrou de la collecte, vérifie que son
-- statut est encore annulable par un client, puis délègue à fn_modifier_collecte
-- (même transaction : E3, débit d'annulation tardive et journal inchangés). Sinon
-- elle refuse (ANNULATION_CLIENT_STATUT) et rien n'est écrit.
--
-- L'annulation par l'Admin (fn_modifier_collecte, y compris depuis `en_cours`)
-- ne change pas.

CREATE OR REPLACE FUNCTION plateforme.fn_annuler_collecte_client(p_id uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_statut plateforme.collecte_statut;
BEGIN
  -- Même verrou que fn_modifier_collecte, pris avant la vérification : la
  -- relève qui veut changer le statut attend la fin de cette transaction.
  SELECT statut INTO v_statut
    FROM plateforme.collectes
   WHERE id = p_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  IF v_statut NOT IN ('brouillon', 'programmee', 'validee') THEN
    RAISE EXCEPTION
      'ANNULATION_CLIENT_STATUT: une collecte au statut % ne peut plus être annulée par le client',
      v_statut USING ERRCODE = 'P0001';
  END IF;

  RETURN plateforme.fn_modifier_collecte(
    p_id,
    jsonb_build_object('statut', 'annulee', 'annulee_cote_savr_motif', p_motif),
    ARRAY['statut']
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_annuler_collecte_client(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_annuler_collecte_client(uuid, text) TO service_role;
