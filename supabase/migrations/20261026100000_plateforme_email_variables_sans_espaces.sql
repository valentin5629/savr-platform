-- =============================================================================
-- Gabarits d'email : variables écrites sans espaces ({{ var }} → {{var}})
-- =============================================================================
-- Le moteur d'interpolation (`interpolate`, packages/shared/src/email/index.ts)
-- ne reconnaît que `{{var}}`, sans espace. Les trois gabarits Anti-Gaspi posés par
-- 20260615240000 (ag_attribution_association, ag_attribution_transporteur,
-- ag_a_toutes_indispo) écrivaient `{{ evenement_nom }}` : l'association et le
-- transporteur recevaient les accolades telles quelles au lieu du nom de
-- l'événement, de la date, de l'adresse et du volume.
--
-- Correction générale plutôt que gabarit par gabarit : toute variable simple
-- écrite avec des espaces, dans l'objet ou le corps de n'importe quel gabarit,
-- est réécrite sans espace. Les blocs `{{#if x}}` et `{{/if}}` ne sont pas
-- touchés (le motif n'admet que des lettres, chiffres et « _ » entre les
-- accolades). Le texte des emails ne change pas.
--
-- Portée : lignes de référentiel (sujet, corps_html, corps_texte). Aucune
-- structure modifiée, aucun droit touché. Idempotent : un rejeu ne trouve plus
-- rien à réécrire.
--
-- Retour arrière : sans objet (l'ancienne écriture n'était jamais interprétée).
-- =============================================================================

UPDATE plateforme.email_templates
SET
  sujet       = regexp_replace(sujet, '\{\{\s*(\w+)\s*\}\}', '{{\1}}', 'g'),
  corps_html  = regexp_replace(corps_html, '\{\{\s*(\w+)\s*\}\}', '{{\1}}', 'g'),
  corps_texte = regexp_replace(corps_texte, '\{\{\s*(\w+)\s*\}\}', '{{\1}}', 'g'),
  updated_at  = now()
WHERE sujet ~ '\{\{\s+\w+\s*\}\}|\{\{\w+\s+\}\}'
   OR corps_html ~ '\{\{\s+\w+\s*\}\}|\{\{\w+\s+\}\}'
   OR corps_texte ~ '\{\{\s+\w+\s*\}\}|\{\{\w+\s+\}\}';

-- Contrôle de fin : plus aucune variable avec espace (une ligne protégée par une
-- policy ou un trigger aurait laissé l'UPDATE à 0 sans erreur).
DO $$
DECLARE
  v_reste integer;
BEGIN
  SELECT count(*) INTO v_reste
  FROM plateforme.email_templates
  WHERE coalesce(sujet, '') || coalesce(corps_html, '') || coalesce(corps_texte, '')
        ~ '\{\{\s+\w+\s*\}\}|\{\{\w+\s+\}\}';
  IF v_reste > 0 THEN
    RAISE EXCEPTION 'email_templates : % gabarit(s) gardent une variable avec espace', v_reste;
  END IF;
END $$;
