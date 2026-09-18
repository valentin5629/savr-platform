-- =============================================================================
-- organisations : le gestionnaire_lieux ne lit plus les fiches traiteurs que par
-- une vue restreinte (id, nom, logo_url)
-- =============================================================================
-- Fuite mesurée (base locale 2026-09-18, gestionnaire.demo@savr-test.local, PostgREST
-- direct `GET /organisations?type=eq.traiteur`) : la policy
-- `org_gestionnaire_traiteur_select` (M3.2) ouvre au gestionnaire la LIGNE entière
-- des traiteurs intervenus sur ses lieux. Après 20260918100000 (liste blanche
-- SELECT), notes_internes et les tarifs sont fermés, mais siret, email_principal,
-- telephone, adresse et raison_sociale restent lisibles — une liste blanche
-- colonne-level s'applique à TOUTES les lignes, elle ne peut pas distinguer « ma
-- propre organisation » (profil : siret/email légitimes) de « la fiche d'un
-- traiteur tiers ».
--
-- CDC §06.05 : §4 « Traiteur (nom + logo, pas d'email / téléphone / SIRET) » ;
-- §5 « Détail traiteur — Logo, nom, ville (pas d'email / téléphone / SIRET) » ;
-- « ne voit pas : les données commerciales/personnelles des traiteurs au-delà du
-- nom/logo » ; RLS : « `traiteurs` (vue restreinte) WHERE organisation_id IN
-- (traiteurs intervenus sur ses lieux) ». « Ville » : aucune colonne sur
-- organisations (D2 2026-06-17) → non exposée.
--
-- Fermeture :
--   1. DROP de la policy `org_gestionnaire_traiteur_select` : le gestionnaire ne
--      lit plus sur plateforme.organisations que sa propre ligne
--      (org_gestionnaire_select, inchangée).
--   2. Vue `v_traiteurs_gestionnaire` (security_invoker = false, security_barrier)
--      qui ne projette QUE id, nom, logo_url, avec le MÊME prédicat de lignes que
--      l'ancienne policy (rôle gestionnaire_lieux + type traiteur +
--      f_traiteur_intervenu_lieux_gestionnaire). Aucune ligne n'est ajoutée au
--      périmètre du gestionnaire ; seules des colonnes lui sont retirées.
--      Les 6 routes /api/v1/gestionnaire/* (embeds traiteur opérationnel +
--      fiche traiteur) lisent la vue au lieu de la table.
--
-- Rôles recensés (pg_policies, 2026-09-18) — seul le gestionnaire lisait des
-- traiteurs tiers : agence = sa ligne + les fiches shadow qu'elle a créées
-- (§06.11, voulu : complétion SIRET) ; client_organisateur / traiteur_* = leur
-- seule ligne ; admin_savr / ops_savr = staff.
--
-- Effet de bord assumé : evt_gestionnaire_insert (WITH CHECK lisant organisations
-- sous RLS) ne voit plus aucun traiteur → un INSERT evenements par PostgREST direct
-- d'un gestionnaire est refusé. L'application programme en service_role
-- (/api/v1/programmation/evenements) : aucun parcours applicatif touché.
--
-- NON DESTRUCTIF (aucune donnée, aucune colonne). FERME un accès net (§12-2bis) :
-- la vue est un nouvel objet GRANT SELECT TO authenticated, mais elle n'expose
-- qu'un sous-ensemble strict (3 colonnes) de ce que la policy supprimée ouvrait,
-- sur les mêmes lignes. REVOKE anon/PUBLIC explicite. Preuve :
-- supabase/tests/SECU__organisations_traiteurs_gestionnaire_vue.test.sql.
-- =============================================================================

-- ─── 1. La table ne s'ouvre plus aux traiteurs tiers ─────────────────────────
DROP POLICY IF EXISTS org_gestionnaire_traiteur_select ON plateforme.organisations;

-- ─── 2. Vue restreinte ────────────────────────────────────────────────────────
-- security_invoker = false : lit organisations avec les droits du propriétaire
-- (la table n'ouvre plus ces lignes au gestionnaire). Le filtre de lignes est donc
-- ENTIÈREMENT porté par le WHERE ci-dessous. security_barrier : un filtre fourni par
-- l'appelant (PostgREST) n'est évalué qu'après ce WHERE → pas de fuite par
-- fonction « leaky » poussée sous le prédicat.
-- f_traiteur_intervenu_lieux_gestionnaire lit le claim organisation_id du JWT de
-- l'appelant (setting de session, inchangé par la vue).
CREATE OR REPLACE VIEW plateforme.v_traiteurs_gestionnaire
WITH (security_invoker = false, security_barrier = true)
AS
SELECT o.id,
       o.nom,
       o.logo_url
  FROM plateforme.organisations o
 WHERE plateforme.f_app_role() = 'gestionnaire_lieux'
   AND o.type = 'traiteur'::plateforme.organisation_type
   AND plateforme.f_traiteur_intervenu_lieux_gestionnaire(o.id);

-- Vue mono-table = auto-modifiable par PostgreSQL : un UPDATE/INSERT à travers elle
-- s'exécuterait avec les droits du propriétaire (RLS contournée). SELECT seul, posé
-- après un REVOKE ALL explicite (indépendant des privilèges par défaut du schéma).
REVOKE ALL ON plateforme.v_traiteurs_gestionnaire FROM PUBLIC, anon, authenticated;
GRANT SELECT ON plateforme.v_traiteurs_gestionnaire TO authenticated;

COMMENT ON VIEW plateforme.v_traiteurs_gestionnaire IS
  'Fiche traiteur vue par un gestionnaire_lieux (§06.05 : nom + logo, pas d''email / téléphone / SIRET) : traiteurs intervenus sur ses lieux (événement daté). Seul chemin de lecture des traiteurs tiers pour ce rôle depuis 20260918140000 (policy org_gestionnaire_traiteur_select supprimée). Toute colonne ajoutée ici élargit l''accès : revue sécurité + pgTAP SECU__organisations_traiteurs_gestionnaire_vue.';
