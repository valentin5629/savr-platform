-- =============================================================================
-- RLS — Catalogue tarifaire : lecture restreinte au staff (FERMETURE d'accès)
-- =============================================================================
-- Constat : `gtz_read` / `tzd_read` / `tpa_read` étaient `auth.role() =
-- 'authenticated'` — tout utilisateur connecté pouvait énumérer, via PostgREST,
-- l'intégralité du catalogue tarifaire ZD/AG, paliers compris.
--
-- Le CDC (§09 §3ter A5 + §04, audit RLS V1 2026-06-05) prévoyait bien la lecture
-- authentifiée, mais sur une prémisse que le CDC contredit lui-même : A5 justifie
-- l'ouverture par « aucune donnée sensible par orga dans la grille publique »,
-- alors que §04 (`tarifs_negocie` → bloc Migration) prévoit qu'« un tarif de base
-- négocié devient une grille dédiée du catalogue affectée à l'organisation ».
-- Le négocié a donc DEUX logements : les remises % (`tarifs_negocie`, restreint)
-- ET la base elle-même (une grille du catalogue, jusqu'ici lisible par tous).
-- Un traiteur A pouvait lire la grille et les paliers négociés du traiteur B.
--
-- Arbitrage Val 2026-09-14 (divergence `ambigu` SECU-RLS_20260914) : **staff only**
-- — option retenue parce qu'aucun rôle client n'a besoin de ces tables :
--   · `calculer_tarif_zd` et ses 2 appelants (cron `batch-brouillons-j1`,
--     `recap-email`) tournent en SERVICE_ROLE → RLS bypassée, aucun impact ;
--   · `/api/v1/admin/grilles-tarifaires-zd` (+ écrans `/admin/parametres/grilles-zd`
--     et onglet grille de la fiche client) = `createAdminSupabaseClient()` + requireStaff ;
--   · le formulaire de programmation n'affiche aucun tarif (règle UI « Sujet 5 ») ;
--   · aucun usage de ces tables via `createBrowserSupabaseClient`.
-- Le prix résolu reste restitué au client par `factures_collectes.tarif_detail` (A4).
--
-- Migration NON destructive et qui **ferme** un accès (jamais n'en ouvre) :
-- conforme CLAUDE.md §12 (2bis). Prédicat = `plateforme.f_is_staff()`, forme
-- canonique post-fix claim 20260617180000 (`f_app_role()` lit `user_role`) —
-- et non `auth.role()`, qui est précisément ce qui rendait ces policies laxistes.
-- Preuve de fermeture : supabase/tests/SECU__catalogue_tarifaire_staff_only.test.sql
-- =============================================================================

DROP POLICY IF EXISTS gtz_read ON plateforme.grilles_tarifaires_zd;
CREATE POLICY gtz_read ON plateforme.grilles_tarifaires_zd
  FOR SELECT USING (plateforme.f_is_staff());

DROP POLICY IF EXISTS tzd_read ON plateforme.tarifs_zero_dechet;
CREATE POLICY tzd_read ON plateforme.tarifs_zero_dechet
  FOR SELECT USING (plateforme.f_is_staff());

DROP POLICY IF EXISTS tpa_read ON plateforme.tarifs_packs_ag;
CREATE POLICY tpa_read ON plateforme.tarifs_packs_ag
  FOR SELECT USING (plateforme.f_is_staff());
