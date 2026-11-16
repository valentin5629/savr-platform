-- Email récapitulatif de programmation (collecte_programmee) : l'email d'accès
-- envoie le nom et la plaque d'immatriculation du chauffeur, plus son téléphone
-- (MTS-1 ne le fournit pas, Val 2026-11-16, PR #811). La phrase qui l'annonce
-- est alignée. Données seules (UPDATE d'un gabarit), aucun droit ni structure.

UPDATE plateforme.email_templates
SET corps_html = replace(
      corps_html,
      'vous recevrez le nom et le téléphone du chauffeur avant le jour J.',
      'vous recevrez le nom et la plaque d''immatriculation du chauffeur avant le jour J.'),
    updated_at = now()
WHERE code = 'collecte_programmee' AND actif;

-- Contrôle de fin : le gabarit actif porte la nouvelle phrase, plus l'ancienne.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM plateforme.email_templates
   WHERE code = 'collecte_programmee' AND actif
     AND strpos(corps_html, 'vous recevrez le nom et la plaque d''immatriculation du chauffeur avant le jour J.') > 0
     AND strpos(corps_html, 'le nom et le téléphone du chauffeur') = 0;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Email récapitulatif : % gabarit mis à jour sur 1', n;
  END IF;
END $$;
