-- R19 / BL-P1-TRAIT-04 — Email Ops « modification d'une collecte à venir ».
-- =============================================================================
-- CDC §05 (source unique) l.316-318 « Modification d'une collecte à venir » :
--   · Modification >= 12h avant créneau : email Ops standard (priorité normale)
--   · Modification < 12h avant créneau : email Ops priorité haute (+ modal côté
--     traiteur, câblée dans editer-collecte-form)
-- Un seul template avec une variable {{priorite}} (normale / haute) couvre les
-- deux cas (sobriété — pas de doublon de template). Câblé côté route PATCH
-- traiteur collectes/[id] (fn_modifier_collecte reste inchangé — mécanisme de
-- réacceptation route-level acté suffisant, arbitrage Val 2026-07-05, cf.
-- _Divergences/M3.1_20260705.md).
-- Charte §06.02 : vouvoiement, FR, 0 emoji, signature « L'équipe Savr ».
-- Data-only (INSERT ON CONFLICT DO NOTHING) — backward-compatible.
-- =============================================================================

INSERT INTO plateforme.email_templates (code, sujet, corps_html, actif, description, variables) VALUES
(
  'admin_modification_collecte_traiteur',
  'Modification d''une collecte à venir',
  '<p>Bonjour,</p><p>L''organisation {{organisation_nom}} ({{demandeur_nom}}) a modifié la collecte {{collecte_ref}} prévue le {{date_collecte}}.</p><p>Champs modifiés : {{champs_modifies}}</p><p>Priorité de traitement : {{priorite}}.</p><p>Merci de relayer au prestataire si nécessaire depuis le back-office.</p><p>L''équipe Savr</p>',
  true,
  'Notification Ops — modification d''une collecte à venir par le traiteur (§05 l.317-318 ; priorité normale >= 12h avant créneau / haute < 12h).',
  ARRAY['organisation_nom','demandeur_nom','collecte_ref','date_collecte','champs_modifies','priorite']
)
ON CONFLICT (code) DO NOTHING;
