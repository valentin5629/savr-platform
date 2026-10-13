-- =============================================================================
-- Gabarit d'email « attestation_don_disponible » : « Votre rapport de don est
-- disponible » (CDC §12 §1.3-bis, décision Val 2026-10-13).
-- =============================================================================
-- Deux corrections dans la même ligne du référentiel.
--
-- 1. Le nom. Le document d'une collecte Anti-Gaspi s'appelle « Rapport de don »
--    partout : écrans, titre imprimé des PDF, nom des fichiers, et cet email.
--    L'objet disait « Votre attestation de don est disponible ».
--
-- 2. L'email ne partait pas. La ligne posée par le seed bloc8 (20260611171642)
--    déclarait les variables prenom, association_nom et lien_pdf, que le batch AG
--    J+1 n'a jamais fournies : une variable déclarée et absente fait refuser
--    l'envoi (findMissingVariables, shared/email). Mesuré sur savr-dev le
--    2026-10-13 : 24 attestations émises le 2026-10-09, 24 traces
--    « MISSING_VARIABLE: attestation_don_disponible [prenom, association_nom,
--    lien_pdf] », aucune ligne dans emails_envoyes. Le corps était une ébauche
--    d'une phrase, sans lien.
--
-- Texte arbitré par Val le 2026-10-13 (le CDC §06.02 liste ce gabarit sans en
-- donner l'objet ni le corps) : objet « Votre rapport de don est disponible —
-- {{nom_evenement}} », corps court avec la date de l'événement et un lien vers
-- la collecte, sur le modèle de l'email du rapport ZD (rapport_disponible,
-- 20261002100000).
--
-- Variables déclarées = celles que le batch fournit depuis ce même lot
-- (batch-pdf-j1-ag.ts, étape 10) : nom_evenement, date_evenement, lien_rapport.
-- Le prénom est dans un bloc conditionnel, comme celui de collecte_programmee
-- (20261008150000) : il n'est pas exigé à l'envoi, et un prénom vide donne
-- « Bonjour, », jamais « Bonjour , ».
--
-- Le code du gabarit ne change pas : c'est un identifiant interne, celui que le
-- batch envoie et que le catalogue §06.02 nomme.
--
-- Portée : une ligne de référentiel (objet, corps, description, variables).
-- Aucune structure modifiée, aucun droit touché. Idempotent : un rejeu réécrit
-- les mêmes valeurs.
--
-- Retour arrière : réécrire la ligne avec l'objet, le corps et les variables du
-- seed bloc8 (20260611171642).
-- =============================================================================

UPDATE plateforme.email_templates
SET sujet = 'Votre rapport de don est disponible — {{nom_evenement}}',
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>
<p>Le rapport de don de votre événement « {{nom_evenement}} » du {{date_evenement}} est prêt.</p>
<p>Vous pouvez le consulter et le télécharger en PDF directement depuis votre espace.</p>
<p><a href="{{lien_rapport}}">Voir le rapport de don</a></p>
<p>Belle suite,<br>L'équipe Savr</p>$tpl$,
    description =
      'Rapport de don disponible (collecte AG avec excédents : attestation de don). '
      || 'Envoyé par le batch AG J+1 6h (batch-pdf-j1-ag.ts) à '
      || 'organisations.email_principal de l''organisation programmatrice.',
    variables = ARRAY['nom_evenement','date_evenement','lien_rapport'],
    updated_at = now()
WHERE code = 'attestation_don_disponible';

-- Contrôle de fin, comme la migration 20261008150000 : la table est en FORCE
-- ROW LEVEL SECURITY, un rôle de migration sans BYPASSRLS mettrait à jour
-- 0 ligne sans erreur et la migration serait enregistrée. On compte la ligne
-- DANS L'ÉTAT ATTENDU (et non celle qui n'y est pas) : un rôle qui ne voit
-- aucune ligne, ou une base où la ligne manque, échoue lui aussi.
DO $$
DECLARE
  v_a_jour integer;
BEGIN
  SELECT count(*) INTO v_a_jour
    FROM plateforme.email_templates
   WHERE code = 'attestation_don_disponible'
     AND sujet = 'Votre rapport de don est disponible — {{nom_evenement}}'
     AND variables = ARRAY['nom_evenement','date_evenement','lien_rapport']::text[];
  IF v_a_jour <> 1 THEN
    RAISE EXCEPTION
      'email_templates : % ligne attestation_don_disponible au nouvel objet, 1 attendue — le rôle de migration écrit-il sous RLS ?',
      v_a_jour;
  END IF;
END $$;
