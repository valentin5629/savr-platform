-- M2.4 fix ECR-3 — Aligner attestation_statut sur le DDL V2
-- DDL V2 cible : ('brouillon', 'emise', 'corrigee', 'annulee')
-- Avant fix : ('en_attente', 'emise', 'corrigee')
--
-- Convention repo (leçon M1.6/M1.7) : ADD VALUE dans une migration isolée ;
-- la migration suivante peut alors consommer 'annulee' et le DEFAULT 'brouillon'.
-- RENAME VALUE est une DDL régulière (pas de restriction de transaction) mais
-- on l'isole ici avec ADD VALUE pour garder la migration suivante propre.

ALTER TYPE plateforme.attestation_statut RENAME VALUE 'en_attente' TO 'brouillon';
ALTER TYPE plateforme.attestation_statut ADD VALUE IF NOT EXISTS 'annulee';
