-- =============================================================================
-- Template email « collecte_programmee » (CDC §06.02 template 3) — formule d'appel.
-- =============================================================================
-- Demande Val 2026-10-08 : l'email récapitulatif de programmation s'adresse au
-- programmeur par son prénom (« Bonjour Julie, »), vouvoiement conservé. Le CDC
-- §06.02 §3 ouvre déjà par « Bonjour {{prenom}}, » ; la base ouvrait par
-- « Bonjour, » (20260708120000).
--
-- État mesuré avant écriture (2026-10-08, dev et prod) : corps de 227 caractères
-- ouvrant par « <p>Bonjour,</p> », variables = nom_evenement, date_collecte,
-- tarif_ligne.
--
-- Le prénom est dans un bloc conditionnel, comme `infos_acces_collecte`
-- (20260715120000) : un compte au prénom vide reçoit « Bonjour, », jamais
-- « Bonjour , ». Une variable lue seulement dans un bloc conditionnel n'est pas
-- exigée à l'envoi (findMissingVariables, shared/email) : la liste `variables`
-- reste inchangée, et un appelant qui n'envoie pas `prenom` n'est pas refusé.
--
-- Portée : la première ligne du corps. Le reste du corps, l'objet et la liste de
-- variables sont ceux de 20260708120000, repris tels quels.
--
-- Backward-compatible : UPDATE d'une ligne de référentiel, aucune structure
-- modifiée, aucun droit touché. Idempotent : un rejeu réécrit le même corps.
--
-- Retour arrière : rejouer l'UPDATE de 20260708120000 (corps ouvrant par
-- « <p>Bonjour,</p> »).
-- =============================================================================

UPDATE plateforme.email_templates
SET corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>
<p>Votre collecte pour l'événement « {{nom_evenement}} » a bien été programmée pour le {{date_collecte}}.</p>
<p>{{tarif_ligne}}</p>
<p>Vous retrouverez le détail dans votre espace Savr.</p>
<p>L'équipe Savr</p>$tpl$,
    updated_at = now()
WHERE code = 'collecte_programmee';

-- Contrôle de fin, comme la migration 20261006130000 : la table est en FORCE
-- ROW LEVEL SECURITY, un rôle de migration sans BYPASSRLS mettrait à jour
-- 0 ligne sans erreur et la migration serait enregistrée. On compte la ligne
-- DANS L'ÉTAT ATTENDU (et non celle qui n'y est pas) : un rôle qui ne voit
-- aucune ligne échoue lui aussi.
DO $$
DECLARE
  v_a_jour integer;
BEGIN
  SELECT count(*) INTO v_a_jour
    FROM plateforme.email_templates
   WHERE code = 'collecte_programmee'
     AND starts_with(corps_html, '<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>');
  IF v_a_jour <> 1 THEN
    RAISE EXCEPTION
      'email_templates : % ligne collecte_programmee à la nouvelle formule d''appel, 1 attendue — le rôle de migration écrit-il sous RLS ?',
      v_a_jour;
  END IF;
END $$;
