-- =============================================================================
-- Gabarit d'email `admin_demande_annulation` désactivé (Val 2026-11-02)
-- =============================================================================
-- Le client annule désormais lui-même sa collecte (annulation cliente directe) :
-- il n'y a plus de demande d'annulation à faire traiter par l'Admin, et aucun
-- code n'envoie plus ce gabarit. CDC §06.02 template 24 et catalogue « fait
-- foi » : 18 gabarits actifs, 15 désactivés.
--
-- Même règle que la migration 20261029150000 : actif = false, ligne conservée
-- (migration non destructive). Un gabarit inactif n'est plus envoyé (sendEmail
-- renvoie SKIP_INACTIF).
--
-- Portée : une ligne de référentiel `plateforme.email_templates`. Aucune
-- structure, aucun droit. Idempotent. Retour arrière : remettre actif = true
-- sur ce code.
-- =============================================================================

UPDATE plateforme.email_templates
SET actif = false, updated_at = now()
WHERE code = 'admin_demande_annulation'
  AND actif;

-- Contrôle de fin : la ligne existe et est inactive (un UPDATE à 0 ligne
-- passerait sans erreur, y compris si le code avait disparu).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM plateforme.email_templates
    WHERE code = 'admin_demande_annulation' AND NOT actif
  ) THEN
    RAISE EXCEPTION 'email_templates : admin_demande_annulation absent ou encore actif';
  END IF;
END $$;
