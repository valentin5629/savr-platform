-- =============================================================================
-- R7 / BL-P0-09 + BL-P1-OBS-04 + BL-P2-27 — RGPD : effacement (anonymisation PII),
-- export, rectification self-service (Cluster C5 — Art.15/16/17/20).
-- =============================================================================
-- Source de vérité : specs/cdc/01 - Cahier des charges App/15 - Sécurité et conformité.md
--   §3.3 l.101 (demande suppression → validation Admin Savr sous 48h ouvrées)
--   l.105/109 (export JSON des données personnelles), l.106 (rectification directe),
--   l.107/111 + l.238 (soft delete par défaut ; anonymisation PII sur demande RGPD).
--
-- Décisions (tranchées par le CDC, cf. brief R7 — aucune interprétation) :
--   (1) Suppression RGPD = ANONYMISATION PII (pas de hard-delete Auth). Contrainte
--       légale l.111 : factures / bordereaux / registres réglementaires non
--       supprimables avant échéance légale → seules les PII identifiantes (nom,
--       email, téléphone) sont anonymisées. Un hard-delete casserait les FK
--       comptables (audit_log.user_id, shared.fichiers.created_by, collectes…
--       → plateforme.users(id)).
--   (2) Périmètre PII utilisateur = plateforme.users.{prenom, nom, email}. Pas de
--       colonne téléphone sur users (le tél est porté par plateforme.organisations
--       = entité légale, hors périmètre RGPD individuel). organisations / factures /
--       collectes / contacts_traiteurs NON touchés.
--   (3) Soft-delete : colonne deleted_at + actif=false. Les policies de LECTURE de
--       users sont gatées « deleted_at IS NULL » (un user anonymisé devient invisible
--       en lecture), SAUF usr_admin (FOR ALL) qui conserve la visibilité audit RGPD.
--   (4) Notification = file in-app admin (GET /api/v1/admin/demandes-suppression),
--       PAS d'email : le CDC §15 ne mandate aucun email et le catalogue est gelé à
--       19 templates (décision Val 2026-06-25).
--
-- Divergence DDL cible : users.deleted_at + demandes_suppression + fn_anonymize_user
-- sont des structures V1 absentes du DDL cible V2 (dérivé du §04 Data Model, qui ne
-- modélise pas encore l'effacement RGPD pourtant requis par §15). Tracé dans
-- _Divergences/ (type clair, convergence V2). schema-vs-cible = report-only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Soft-delete sur plateforme.users
-- ---------------------------------------------------------------------------
ALTER TABLE plateforme.users
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN plateforme.users.deleted_at IS
  'Soft-delete RGPD (§15 l.107/238). NULL = compte vivant. Non NULL = anonymisé/'
  'supprimé : exclu des lectures non-admin (RLS deleted_at IS NULL).';

-- Index partiel des comptes vivants (lectures listées par organisation).
CREATE INDEX IF NOT EXISTS idx_users_vivants
  ON plateforme.users (organisation_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Enum + table demandes_suppression (workflow Admin 48h)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE plateforme.statut_demande_suppression_enum AS ENUM
    ('en_attente', 'validee', 'refusee');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS plateforme.demandes_suppression (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL
                  CONSTRAINT demandes_suppression_user_id_fkey
                  REFERENCES plateforme.users(id),
  statut        plateforme.statut_demande_suppression_enum NOT NULL DEFAULT 'en_attente',
  justification text,
  demande_le    timestamptz NOT NULL DEFAULT now(),
  traitee_le    timestamptz,
  traitee_par   uuid
                  CONSTRAINT demandes_suppression_traitee_par_fkey
                  REFERENCES plateforme.users(id)
);

CREATE INDEX IF NOT EXISTS idx_demandes_suppression_en_attente
  ON plateforme.demandes_suppression (demande_le) WHERE statut = 'en_attente';
CREATE INDEX IF NOT EXISTS idx_demandes_suppression_user
  ON plateforme.demandes_suppression (user_id);

-- RLS DENY ALL par défaut + policies explicites.
ALTER TABLE plateforme.demandes_suppression ENABLE ROW LEVEL SECURITY;

-- L'utilisateur crée et relit SA propre demande.
CREATE POLICY ds_self_insert ON plateforme.demandes_suppression
  FOR INSERT TO public
  WITH CHECK (user_id = auth.uid());

CREATE POLICY ds_self_select ON plateforme.demandes_suppression
  FOR SELECT TO public
  USING (user_id = auth.uid());

-- Admin Savr : lecture de la file + validation/refus (UPDATE).
CREATE POLICY ds_admin_all ON plateforme.demandes_suppression
  FOR ALL TO public
  USING (plateforme.f_app_role() = 'admin_savr')
  WITH CHECK (plateforme.f_app_role() = 'admin_savr');

-- GRANT explicite : le blanket grant TO authenticated n'est pas rétroactif
-- (table créée après 0.4a). service_role couvert par ALTER DEFAULT PRIVILEGES.
GRANT SELECT, INSERT, UPDATE, DELETE ON plateforme.demandes_suppression TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. fn_anonymize_user — effacement RGPD = anonymisation PII (réservé service_role)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER : exécute l'anonymisation + la clôture de demande + la ligne
-- d'audit de façon atomique avec les droits du propriétaire (patron audit-write
-- service-role, R3). Réservé service_role (les routes admin appellent en
-- service-role après requireAdmin). Préserve toutes les pièces comptables
-- (n'écrit QUE plateforme.users + demandes_suppression + audit_log).
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

REVOKE ALL ON FUNCTION plateforme.fn_anonymize_user(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_anonymize_user(uuid, text, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Lectures users gatées « deleted_at IS NULL » (soft-delete invisible)
--    usr_admin (FOR ALL) NON modifié → visibilité audit RGPD conservée.
--    Régénéré depuis l'état HEAD (fix_role_claim + 0_4a) en ajoutant la garde.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS usr_self_select ON plateforme.users;
CREATE POLICY usr_self_select ON plateforme.users
  FOR SELECT TO public
  USING (id = auth.uid() AND deleted_at IS NULL);

DROP POLICY IF EXISTS usr_agence_self ON plateforme.users;
CREATE POLICY usr_agence_self ON plateforme.users
  FOR SELECT TO public
  USING (plateforme.f_app_role() = 'agence'
    AND id = auth.uid()
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS usr_commercial_select ON plateforme.users;
CREATE POLICY usr_commercial_select ON plateforme.users
  FOR SELECT TO public
  USING (plateforme.f_app_role() = 'traiteur_commercial'
    AND organisation_id = ((auth.jwt() ->> 'organisation_id'))::uuid
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS usr_gestionnaire_select ON plateforme.users;
CREATE POLICY usr_gestionnaire_select ON plateforme.users
  FOR SELECT TO public
  USING (plateforme.f_app_role() = 'gestionnaire_lieux'
    AND organisation_id = ((auth.jwt() ->> 'organisation_id'))::uuid
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS usr_manager_select ON plateforme.users;
CREATE POLICY usr_manager_select ON plateforme.users
  FOR SELECT TO public
  USING (plateforme.f_app_role() = 'traiteur_manager'
    AND organisation_id = ((auth.jwt() ->> 'organisation_id'))::uuid
    AND deleted_at IS NULL);

DROP POLICY IF EXISTS usr_ops_select ON plateforme.users;
CREATE POLICY usr_ops_select ON plateforme.users
  FOR SELECT TO public
  USING (plateforme.f_app_role() = 'ops_savr'
    AND deleted_at IS NULL);

-- ---------------------------------------------------------------------------
-- 5. Écritures users gatées « deleted_at IS NULL » (immutabilité non-admin)
--    Symétrie des lectures : un user anonymisé ne peut plus être édité par un
--    non-admin (y compris lui-même tant que son JWT n'a pas expiré → il ne peut
--    pas « dé-anonymiser » son profil). usr_admin (FOR ALL) NON modifié.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS usr_self_update ON plateforme.users;
CREATE POLICY usr_self_update ON plateforme.users
  FOR UPDATE TO public
  USING (id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS usr_agence_update_self ON plateforme.users;
CREATE POLICY usr_agence_update_self ON plateforme.users
  FOR UPDATE TO public
  USING (plateforme.f_app_role() = 'agence'
    AND id = auth.uid()
    AND deleted_at IS NULL)
  WITH CHECK (plateforme.f_app_role() = 'agence' AND id = auth.uid());

DROP POLICY IF EXISTS usr_commercial_update_self ON plateforme.users;
CREATE POLICY usr_commercial_update_self ON plateforme.users
  FOR UPDATE TO public
  USING (plateforme.f_app_role() = 'traiteur_commercial'
    AND id = auth.uid()
    AND deleted_at IS NULL)
  WITH CHECK (plateforme.f_app_role() = 'traiteur_commercial' AND id = auth.uid());

DROP POLICY IF EXISTS usr_manager_update ON plateforme.users;
CREATE POLICY usr_manager_update ON plateforme.users
  FOR UPDATE TO public
  USING (plateforme.f_app_role() = 'traiteur_manager'
    AND organisation_id = ((auth.jwt() ->> 'organisation_id'))::uuid
    AND deleted_at IS NULL)
  WITH CHECK (plateforme.f_app_role() = 'traiteur_manager'
    AND organisation_id = ((auth.jwt() ->> 'organisation_id'))::uuid);

DROP POLICY IF EXISTS usr_gestionnaire_update ON plateforme.users;
CREATE POLICY usr_gestionnaire_update ON plateforme.users
  FOR UPDATE TO public
  USING (plateforme.f_app_role() = 'gestionnaire_lieux'
    AND organisation_id = ((auth.jwt() ->> 'organisation_id'))::uuid
    AND deleted_at IS NULL)
  WITH CHECK (plateforme.f_app_role() = 'gestionnaire_lieux'
    AND organisation_id = ((auth.jwt() ->> 'organisation_id'))::uuid);

DROP POLICY IF EXISTS usr_ops_write ON plateforme.users;
CREATE POLICY usr_ops_write ON plateforme.users
  FOR UPDATE TO public
  USING (plateforme.f_app_role() = 'ops_savr'
    AND deleted_at IS NULL)
  WITH CHECK (plateforme.f_app_role() = 'ops_savr');
