-- =============================================================================
-- Jusqu'à 3 adresses de livraison par lieu (Val 2026-11-19)
-- =============================================================================
-- Un même lieu peut avoir plusieurs entrées logistiques (ex. Carrousel du Louvre :
-- public rue de Rivoli, livraison avenue du Général Lemonnier). Décisions Val du
-- 2026-11-19 :
--   1. PAS de nouvelle table : deux emplacements supplémentaires en COLONNES sur
--      `plateforme.lieux`, jamais plus de 3 adresses. L'adresse actuelle
--      (`adresse_acces`, `code_postal`, `ville`, `latitude`, `longitude`) reste
--      l'adresse n° 1, présélectionnée à la programmation.
--   2. Seuls Admin et Ops créent ou modifient ces adresses (routes service_role ;
--      l'écriture de `lieux` reste fermée à `authenticated`, 20260921210000).
--   3. L'adresse choisie à la programmation est COPIÉE dans la collecte
--      (`collectes.lieu_overrides`) : rien ne lit ces colonnes après coup pour une
--      collecte déjà programmée.
--   4. Accès ÉLARGI : les colonnes rejoignent la liste blanche SELECT des clients
--      sur `lieux` et la vue `v_lieux_clients` (le formulaire de programmation des
--      clients lit les lieux sous leur propre rôle). Feu vert explicite de Val pour
--      ce lot (CLAUDE.md §12 point 2bis). Les lignes visibles restent celles de la
--      policy `lieux_clients_select`, inchangée.
--
-- Pas d'ordre E5 (`lieu.champ_critique_modifie`) sur ces colonnes : le trigger
-- `trg_lieu_champ_critique_e5` (20260614000001) se déclenche sur une liste fermée
-- de colonnes (adresse n° 1 seulement), non touchée ici. Une collecte qui a choisi
-- l'adresse n° 2 ou n° 3 la porte déjà dans son `lieu_overrides`.
--
-- Écart au DDL cible V2 (garde-fou TMS-Ready G1) tracé dans
-- `_Divergences/M3.2_20261119_lieux-adresses-livraison.md`.
--
-- Backward-compatible : colonnes nullable, aucune donnée réécrite.
-- =============================================================================

ALTER TABLE plateforme.lieux
  ADD COLUMN libelle_adresse_1 text,
  ADD COLUMN libelle_adresse_2 text,
  ADD COLUMN adresse_acces_2 text,
  ADD COLUMN code_postal_2 text,
  ADD COLUMN ville_2 text,
  ADD COLUMN latitude_2 double precision,
  ADD COLUMN longitude_2 double precision,
  ADD COLUMN libelle_adresse_3 text,
  ADD COLUMN adresse_acces_3 text,
  ADD COLUMN code_postal_3 text,
  ADD COLUMN ville_3 text,
  ADD COLUMN latitude_3 double precision,
  ADD COLUMN longitude_3 double precision;

-- Un emplacement est vide ou complet (adresse + code postal + ville, non blancs) ;
-- libellé et coordonnées n'existent qu'avec une adresse. Bornes de longueur =
-- celles de `validerLieuOverrides` (adresse 200, code postal 16, ville 120) : une
-- adresse choisie à la programmation est recopiée dans `lieu_overrides`, qui les
-- applique ; plus longue, elle y serait refusée.
ALTER TABLE plateforme.lieux
  ADD CONSTRAINT chk_lieux_adresse_2_complete CHECK (
    (adresse_acces_2 IS NULL AND code_postal_2 IS NULL AND ville_2 IS NULL
      AND libelle_adresse_2 IS NULL AND latitude_2 IS NULL AND longitude_2 IS NULL)
    OR (
      -- IS NOT NULL explicite : `btrim(NULL) <> ''` vaut NULL, et un CHECK qui
      -- vaut NULL laisse passer la ligne (constaté par le test pgTAP C1).
      adresse_acces_2 IS NOT NULL AND code_postal_2 IS NOT NULL AND ville_2 IS NOT NULL
      AND btrim(adresse_acces_2) <> '' AND char_length(adresse_acces_2) <= 200
      AND btrim(code_postal_2) <> '' AND char_length(code_postal_2) <= 16
      AND btrim(ville_2) <> '' AND char_length(ville_2) <= 120
    )
  ),
  ADD CONSTRAINT chk_lieux_adresse_3_complete CHECK (
    (adresse_acces_3 IS NULL AND code_postal_3 IS NULL AND ville_3 IS NULL
      AND libelle_adresse_3 IS NULL AND latitude_3 IS NULL AND longitude_3 IS NULL)
    OR (
      adresse_acces_3 IS NOT NULL AND code_postal_3 IS NOT NULL AND ville_3 IS NOT NULL
      AND btrim(adresse_acces_3) <> '' AND char_length(adresse_acces_3) <= 200
      AND btrim(code_postal_3) <> '' AND char_length(code_postal_3) <= 16
      AND btrim(ville_3) <> '' AND char_length(ville_3) <= 120
    )
  ),
  -- Pas de trou : l'adresse n° 3 n'existe qu'avec une adresse n° 2.
  ADD CONSTRAINT chk_lieux_adresse_3_apres_2 CHECK (
    adresse_acces_3 IS NULL OR adresse_acces_2 IS NOT NULL
  ),
  ADD CONSTRAINT chk_lieux_libelles_adresses CHECK (
    (libelle_adresse_1 IS NULL OR (btrim(libelle_adresse_1) <> '' AND char_length(libelle_adresse_1) <= 60))
    AND (libelle_adresse_2 IS NULL OR (btrim(libelle_adresse_2) <> '' AND char_length(libelle_adresse_2) <= 60))
    AND (libelle_adresse_3 IS NULL OR (btrim(libelle_adresse_3) <> '' AND char_length(libelle_adresse_3) <= 60))
  );

COMMENT ON COLUMN plateforme.lieux.libelle_adresse_1 IS
  'Libellé facultatif de l''adresse n° 1 (adresse_acces), ex. « Entrée livraison ». Val 2026-11-19.';
COMMENT ON COLUMN plateforme.lieux.adresse_acces_2 IS
  'Adresse de livraison n° 2 (facultative ; emplacement vide ou complet avec code_postal_2 et ville_2). Choisie à la programmation, recopiée dans collectes.lieu_overrides. Saisie Admin/Ops seule. Val 2026-11-19.';
COMMENT ON COLUMN plateforme.lieux.adresse_acces_3 IS
  'Adresse de livraison n° 3 (facultative, seulement avec une adresse n° 2). Mêmes règles que adresse_acces_2. Val 2026-11-19.';

-- ── Liste blanche SELECT des clients (accès élargi, accord Val 2026-11-19) ──
GRANT SELECT (
  libelle_adresse_1,
  libelle_adresse_2,
  adresse_acces_2,
  code_postal_2,
  ville_2,
  latitude_2,
  longitude_2,
  libelle_adresse_3,
  adresse_acces_3,
  code_postal_3,
  ville_3,
  latitude_3,
  longitude_3
) ON plateforme.lieux TO authenticated;

-- ── v_lieux_clients : mêmes colonnes, ajoutées en fin de liste ───────────────
-- CREATE OR REPLACE (pas de DROP) : la vue garde ses droits et son
-- `security_invoker = true` ; seules des colonnes sont ajoutées à la fin.
CREATE OR REPLACE VIEW plateforme.v_lieux_clients
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
  l.updated_at,
  l.libelle_adresse_1,
  l.libelle_adresse_2,
  l.adresse_acces_2,
  l.code_postal_2,
  l.ville_2,
  l.latitude_2,
  l.longitude_2,
  l.libelle_adresse_3,
  l.adresse_acces_3,
  l.code_postal_3,
  l.ville_3,
  l.latitude_3,
  l.longitude_3
  -- Exclus : commentaires_internes, commentaire_lieu, siren, email_gestionnaire,
  -- reference_citeo, code_site_viparis
FROM plateforme.lieux l;
