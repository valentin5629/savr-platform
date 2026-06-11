-- Module 0.2 — Initialisation des schémas Savr V1
-- Nommage : YYYYMMDDHHMMSS_[schéma]_<slug>.sql (CLAUDE.md §2)
--
-- GARDE-FOU 1 TMS-Ready : seuls plateforme.* et shared.* sont créés.
-- Le schéma tms.* n'existe PAS en V1 — toute référence à tms.* est une violation.
-- Frontière TMS-Ready V1, garde-fou 1 : diff migrations ⊂ _DDL-CIBLE-V2/schema_cible_v2.sql

CREATE SCHEMA IF NOT EXISTS plateforme;
CREATE SCHEMA IF NOT EXISTS shared;
