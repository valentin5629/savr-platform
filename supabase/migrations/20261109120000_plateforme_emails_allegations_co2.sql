-- =============================================================================
-- Emails : vocabulaire environnemental exact (décisions Val 2026-11-09, revue
-- « greenwashing » C1, C3 et C7).
--
--   rapport_disponible  « kg de déchets détournés » → « kg de déchets collectés »
--                       « kg CO₂e évités »          → « kg CO₂e évités (estimation) »
--   verification_email  « les déchets sont triés et recyclés » → les déchets triés
--                       sont collectés, pesés et envoyés vers leur filière
--   invitation_utilisateur « ainsi que la collecte et le recyclage des déchets »
--                       → « (Anti-Gaspi) et collecte des déchets triés (Zéro Déchet) »
--
-- Portée : remplacement ciblé dans corps_html (replace), aucune structure, aucun
-- droit. Idempotent : un rejeu ne trouve plus l'ancien texte et ne change rien.
-- Contrôle de fin positif : l'ancien texte ne subsiste dans aucun gabarit et le
-- nouveau est présent (sous RLS forcée, un UPDATE muet ne passerait pas).
--
-- Retour arrière : remplacements inverses.
-- =============================================================================

UPDATE plateforme.email_templates
SET corps_html = replace(
      replace(corps_html,
        'kg de déchets détournés', 'kg de déchets collectés'),
        'kg CO₂e évités</li>', 'kg CO₂e évités (estimation)</li>'),
    updated_at = now()
WHERE code = 'rapport_disponible'
  AND corps_html LIKE '%kg de déchets détournés%';

UPDATE plateforme.email_templates
SET corps_html = replace(corps_html,
      'les déchets sont triés et recyclés (Zéro Déchet)',
      'les déchets triés sont collectés, pesés et envoyés vers leur filière de traitement (Zéro Déchet)'),
    updated_at = now()
WHERE corps_html LIKE '%les déchets sont triés et recyclés%';

-- Texte posé par 20261029150000 (avec un double espace après « associations »).
UPDATE plateforme.email_templates
SET corps_html = regexp_replace(corps_html,
      'associations\s+ainsi que la collecte et le recyclage des déchets\.',
      'associations (Anti-Gaspi) et collecte des déchets triés (Zéro Déchet).'),
    updated_at = now()
WHERE code = 'invitation_utilisateur'
  AND corps_html LIKE '%ainsi que la collecte et le recyclage des déchets.%';

DO $$
DECLARE n_ancien int; n_nouveau int;
BEGIN
  SELECT count(*) INTO n_ancien FROM plateforme.email_templates
   WHERE corps_html LIKE '%déchets détournés%'
      OR corps_html LIKE '%triés et recyclés%'
      OR corps_html LIKE '%recyclage des déchets%';
  SELECT count(*) INTO n_nouveau FROM plateforme.email_templates
   WHERE (code = 'rapport_disponible' AND actif
          AND corps_html LIKE '%kg de déchets collectés%'
          AND corps_html LIKE '%kg CO₂e évités (estimation)%')
      OR (code = 'verification_email'
          AND corps_html LIKE '%déchets triés sont collectés, pesés%')
      OR (code = 'invitation_utilisateur'
          AND corps_html LIKE '%et collecte des déchets triés (Zéro Déchet).%');
  IF n_ancien > 0 OR n_nouveau <> 3 THEN
    RAISE EXCEPTION 'emails allégations CO₂ : % gabarit(s) gardent l''ancien texte, % gabarit(s) à jour (attendu 0 et 3)', n_ancien, n_nouveau;
  END IF;
END $$;
