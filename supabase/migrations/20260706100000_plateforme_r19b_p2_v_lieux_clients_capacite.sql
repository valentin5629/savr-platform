-- ============================================================
-- R19b-P2 (M3.2) — Expose capacite_maximum via v_lieux_clients
-- ============================================================
-- BL-P2-12 : la liste + le détail Lieux gestionnaire doivent afficher la colonne
-- « Capacité » (§06.05 §3, l.361 « Capacité d'accueil si renseignée »).
-- `plateforme.lieux.capacite_maximum` existe (ajout R17c 20260702030000) mais était
-- absent de la vue whitelist `v_lieux_clients` (créée 20260617170000) → le SELECT
-- de la route gestionnaire ne pouvait pas la lire.
--
-- Ajout ADDITIF (colonne non sensible, pas de suppression) → backward-compatible.
-- La vue reste SECURITY INVOKER : la RLS de `lieux` (lieux_clients_select) filtre les
-- lignes selon le rôle appelant, le masquage colonne des champs admin/ops
-- (commentaire_lieu, siren, email_gestionnaire, reference_citeo, commentaires_internes)
-- reste inchangé.
--
-- NB colonne « Type » (catégorie de lieu, §06.05 l.362) : `lieux.type` n'existe NI en
-- V1 NI dans le DDL cible V2 → colonne CDC spurieuse, non exposée
-- (cf. _Divergences/M3.2_20260706_lieux_type.md, type: clair).

DROP VIEW IF EXISTS plateforme.v_lieux_clients;

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
  l.capacite_maximum,
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
