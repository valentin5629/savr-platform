-- =============================================================================
-- Gabarit d'email « invitation_utilisateur » : le lien est valable 7 jours
-- (CDC §06.02 §17, décision Val 2026-10-28)
-- =============================================================================
-- Le lien de l'invitation n'est plus un lien de récupération Supabase (24 h au
-- plus, consommé par les messageries qui analysent les liens) mais un lien Savr
-- signé, valable 7 jours et à usage unique, vers la page /invitation
-- (packages/plateforme/src/lib/auth/jeton-invitation.ts). L'email peut donc
-- annoncer la durée prévue par le CDC, ce que 20261028190000 s'était interdit.
--
-- Portée : une phrase du corps d'une ligne de référentiel. Aucune structure,
-- aucun droit. Idempotent : un rejeu ne trouve plus l'ancienne phrase et ne
-- change rien ; le contrôle de fin vérifie la nouvelle.
--
-- Retour arrière : remettre « Ce lien vous est personnel. » (20261028190000).
-- =============================================================================

UPDATE plateforme.email_templates
SET
  corps_html = replace(
    corps_html,
    '<p>Ce lien vous est personnel. Si vous ne vous attendiez pas',
    '<p>Ce lien vous est personnel et reste valable 7 jours. Si vous ne vous attendiez pas'
  ),
  updated_at = now()
WHERE code = 'invitation_utilisateur'
  AND strpos(corps_html, '<p>Ce lien vous est personnel. Si vous ne vous attendiez pas') > 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM plateforme.email_templates
    WHERE code = 'invitation_utilisateur'
      AND strpos(corps_html, 'valable 7 jours') > 0
      AND strpos(corps_html, '<a href="{{lien_invitation}}">') > 0
  ) THEN
    RAISE EXCEPTION 'invitation_utilisateur : mention « valable 7 jours » absente';
  END IF;
END $$;
