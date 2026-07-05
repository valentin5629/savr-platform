-- R19a · BL-P1-TRAIT-01 — « Mon organisation » traiteur éditable (M3.1).
-- =============================================================================
-- CDC §06.04 §6 (l.659-663) : le traiteur_manager édite les Informations légales,
-- les Entités de facturation (multi-SIRET) et les Domaines email autorisés de SON
-- organisation. Jusqu'ici, l'écriture CLIENT sur ces deux tables était FERMÉE en
-- RLS (`entites_facturation` : « Écriture clients : FERMÉE V1 » ; `organisations_
-- domaines_email` : seul `ode_admin` en écriture). La page « Mon organisation »
-- était donc 100 % read-only (défaut backlog BL-P1-TRAIT-01).
--
-- Ce patch ouvre l'écriture au SEUL `traiteur_manager`, scoped à SON organisation,
-- au niveau RLS (défense en profondeur : le cloisonnement inter-org est garanti
-- par la base, pas seulement par le code de la route). Le `traiteur_commercial`
-- reste en lecture seule (aucune policy d'écriture pour lui → RLS bloque).
--
-- POLICY-ONLY : aucune modification de structure (colonne/type/PK) → garde-fou 1
-- (data model V1 ⊂ DDL cible) intact, pas de régénération DDL cible nécessaire.
--
-- L'édition des Informations légales de `organisations` (raison_sociale, siret
-- shadow, adresse, logo_url, contact_facturation) réutilise la policy EXISTANTE
-- `org_manager_update` (déjà own-org scoped) ; l'audit_log est écrit côté route
-- (service_role). Le transfert de collectes (réassignation evenements.created_by)
-- passe côté route en service_role (evt_manager_update est gated par
-- f_collecte_editable → inadapté aux collectes clôturées d'un commercial parti).
-- =============================================================================

-- ── entites_facturation : écriture manager own-org ──────────────────────────
-- GRANT : couvert par le blanket `GRANT … TO authenticated` de 0.4a (table bloc1,
-- antérieure à 0.4a). SELECT own-org déjà ouvert par `ef_select_own_org`.
DROP POLICY IF EXISTS ef_manager_write ON plateforme.entites_facturation;
CREATE POLICY ef_manager_write ON plateforme.entites_facturation
  AS PERMISSIVE FOR ALL TO public
  USING (
    plateforme.f_app_role() = 'traiteur_manager'
    AND organisation_id = (auth.jwt() ->> 'organisation_id')::uuid
  )
  WITH CHECK (
    plateforme.f_app_role() = 'traiteur_manager'
    AND organisation_id = (auth.jwt() ->> 'organisation_id')::uuid
  );

-- ── organisations_domaines_email : écriture manager own-org ─────────────────
-- GRANT explicite : le blanket `GRANT … TO authenticated` de 0.4a n'est PAS
-- rétroactif (cette table est post-0.4a — `20260612000001`). Sans lui, un JWT
-- `authenticated` ne pourrait ni lire ni écrire malgré la policy.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON plateforme.organisations_domaines_email TO authenticated;

DROP POLICY IF EXISTS ode_manager_write ON plateforme.organisations_domaines_email;
CREATE POLICY ode_manager_write ON plateforme.organisations_domaines_email
  AS PERMISSIVE FOR ALL TO public
  USING (
    plateforme.f_app_role() = 'traiteur_manager'
    AND organisation_id = (auth.jwt() ->> 'organisation_id')::uuid
  )
  WITH CHECK (
    plateforme.f_app_role() = 'traiteur_manager'
    AND organisation_id = (auth.jwt() ->> 'organisation_id')::uuid
  );
