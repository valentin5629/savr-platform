-- =============================================================================
-- FIX P1 — Masquage colonne-level de plateforme.lieux (dette sécurité transverse)
-- =============================================================================
-- Repérée pendant la revue de M3.4. Décision spec §09 (2026-06-12, P1 bloquant) :
-- les 4 colonnes admin/ops-only (`commentaire_lieu`, `siren`, `email_gestionnaire`,
-- `reference_citeo`) + la colonne interne `commentaires_internes` ne doivent JAMAIS
-- être lisibles par les rôles clients (traiteur_manager, traiteur_commercial,
-- agence, gestionnaire_lieux, client_organisateur).
--
-- Problème : la RLS filtre les LIGNES (policy `lieux_clients_select`), jamais les
-- COLONNES. Le blanket GRANT 0.4a (`GRANT SELECT ... ON ALL TABLES IN SCHEMA
-- plateforme TO authenticated`) accorde un SELECT *table-level* sur lieux → tout
-- rôle client peut lire en SELECT direct ces colonnes sensibles sur les lignes
-- de son périmètre.
--
-- ⚠ Un simple `REVOKE SELECT (colonne)` est INOPÉRANT tant que le privilège
-- SELECT *table-level* subsiste (PostgreSQL : le grant table couvre toutes les
-- colonnes et prime sur un revoke colonne). On retire donc d'abord le SELECT
-- table-level hérité du blanket grant 0.4a, PUIS on re-GRANT le SELECT sur la
-- liste blanche exacte des colonnes non sensibles.
--
-- Pattern identique au masquage F5 des `factures` (M3.5,
-- 20260616120000_plateforme_m3_5_vues_kpi.sql lignes 386+).
--
-- Le staff (admin_savr / ops_savr) lit/écrit lieux via service_role
-- (createAdminSupabaseClient — cf. routes /api/v1/admin/lieux) → privilèges
-- séparés, NON impactés par ce REVOKE (service_role garde le grant complet,
-- migration 20260617160000). Les colonnes sensibles restent donc pleinement
-- accessibles au staff via service_role.
--
-- Les policies de ligne existantes (lieux_admin, lieux_ops_read, lieux_ops_write,
-- lieux_clients_select — migration 0.4a) sont conservées telles quelles : elles
-- filtrent les lignes et restent nécessaires en plus de ce grant colonne.
-- =============================================================================

-- ── 1. Masquage colonne-level (REVOKE table-level PUIS GRANT whitelist) ──────
REVOKE SELECT ON plateforme.lieux FROM authenticated;

GRANT SELECT (
  id,
  nom,
  nom_alternatif,
  adresse_acces,
  code_postal,
  ville,
  latitude,
  longitude,
  region,
  acces_details,
  acces_office,
  stationnement,
  type_vehicule_max,
  contraintes_horaires,
  flux_autorises,
  volume_max_bacs,
  traiteurs_operant,
  controle_acces_requis_default,
  photos_urls,
  actif,
  created_at,
  updated_at
) ON plateforme.lieux TO authenticated;
-- Exclus (réservés admin/ops via service_role) :
--   commentaires_internes, commentaire_lieu, siren, email_gestionnaire, reference_citeo

-- ── 2. Vue whitelist canonique v_lieux_clients (spec §09) ────────────────────
-- Renomme v_lieux_public (M3.2) en v_lieux_clients, nom canonique attendu par la
-- spec §09 (décision 2026-06-12). Même périmètre de colonnes (22 colonnes non
-- sensibles), même mécanisme SECURITY INVOKER : la RLS de lieux
-- (lieux_clients_select) filtre les lignes selon le rôle appelant, et les
-- privilèges colonne ci-dessus s'appliquent à l'invoker.
--
-- Note : la spec mentionnait « SECURITY DEFINER », mais SECURITY INVOKER est le
-- choix retenu et implémenté dès M3.2 — il est plus sûr ici (le filtrage de
-- lignes reste assuré par la RLS de lieux, pas dupliqué dans un WHERE de vue
-- exécutée en owner qui bypasserait la RLS). Le masquage colonne est désormais
-- garanti par le REVOKE/GRANT ci-dessus, pas seulement par la projection de la vue.
DROP VIEW IF EXISTS plateforme.v_lieux_public;

CREATE VIEW plateforme.v_lieux_clients
  WITH (security_invoker = true)
AS
SELECT
  l.id,
  l.nom,
  l.nom_alternatif,
  l.adresse_acces,
  l.code_postal,
  l.ville,
  l.latitude,
  l.longitude,
  l.region,
  l.acces_details,
  l.acces_office,
  l.stationnement,
  l.type_vehicule_max,
  l.contraintes_horaires,
  l.flux_autorises,
  l.volume_max_bacs,
  l.traiteurs_operant,
  l.controle_acces_requis_default,
  l.photos_urls,
  l.actif,
  l.created_at,
  l.updated_at
  -- Exclus : commentaires_internes, commentaire_lieu, siren, email_gestionnaire, reference_citeo
FROM plateforme.lieux l;

GRANT SELECT ON plateforme.v_lieux_clients TO authenticated;
