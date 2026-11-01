-- Poste de l'utilisateur (champ libre, Val 2026-11-01).
-- =============================================================================
-- « Mon profil » gagne un champ « Poste » : le rôle de la personne dans son
-- organisation, saisi librement. Information seule : il ne donne aucun droit
-- (les droits restent portés par `role`). Affiché aussi dans la liste des
-- membres.
--
-- 1. Colonne nullable, bornée à 100 caractères AU NIVEAU DE LA TABLE : l'écriture
--    passe par PATCH /api/me/profil, mais la policy `usr_self_update` laisse aussi
--    un UPDATE PostgREST direct sur sa propre ligne.
-- 2. fn_anonymize_user (effacement RGPD) efface désormais `poste` ET
--    `telephone` : le téléphone (20260705110000) n'y avait jamais été ajouté et
--    survivait à l'anonymisation. Même signature, mêmes droits (service_role).
--
-- ⚠ Divergence DDL cible (garde-fou 1) : `plateforme.users.poste` est absente du
-- DDL cible V2 → convergence V2 tracée dans
-- _Divergences/M3.1_20261101_mon-profil-poste-sans-securite-preferences.md.
-- =============================================================================

ALTER TABLE plateforme.users
  ADD COLUMN IF NOT EXISTS poste text;

ALTER TABLE plateforme.users
  ADD CONSTRAINT chk_users_poste_borne
  CHECK (poste IS NULL OR char_length(poste) <= 100);

-- Redéfinition de 20260625000002 : seules les lignes `telephone`/`poste` changent.
CREATE OR REPLACE FUNCTION plateforme.fn_anonymize_user(
  p_user_id       uuid,
  p_justification text,
  p_acteur        uuid,
  p_demande_id    uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
DECLARE
  v_vivant boolean;
BEGIN
  SELECT (deleted_at IS NULL) INTO v_vivant
  FROM plateforme.users
  WHERE id = p_user_id;

  IF v_vivant IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable : %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Idempotent : on ne ré-anonymise pas un compte déjà neutralisé (placeholder
  -- email unique déjà posé), on ferme seulement la demande le cas échéant.
  IF v_vivant THEN
    UPDATE plateforme.users
    SET prenom     = '(anonymisé)',
        nom        = '(anonymisé)',
        email      = 'anonymise+' || p_user_id::text || '@anonymise.invalid',
        telephone  = NULL,
        poste      = NULL,
        actif      = false,
        deleted_at = now()
    WHERE id = p_user_id;
  END IF;

  IF p_demande_id IS NOT NULL THEN
    UPDATE plateforme.demandes_suppression
    SET statut      = 'validee',
        traitee_le  = now(),
        traitee_par = p_acteur
    WHERE id = p_demande_id
      AND statut = 'en_attente';
  END IF;

  -- Audit trail : MÉTADONNÉES seules (jamais la PII brute — §15 : pas de stockage
  -- de données sensibles brutes dans l'audit). motif = justification (col. R3).
  INSERT INTO plateforme.audit_log
    (user_id, role, action, table_name, record_id, motif, new_values)
  VALUES (
    p_acteur,
    'admin_savr',
    'rgpd_anonymisation',
    'plateforme.users',
    p_user_id,
    p_justification,
    jsonb_build_object('demande_id', p_demande_id)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION plateforme.fn_anonymize_user(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_anonymize_user(uuid, text, uuid, uuid) TO service_role;

