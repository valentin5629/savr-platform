-- =============================================================================
-- Référentiel des flux ZD : exutoire final, code déchet, code de traitement,
-- filière — renseignement des 5 lignes (jamais remplies depuis le seed bloc8).
-- =============================================================================
-- Décisions Val 2026-10-04 (export du registre au format du modèle de collecte
-- de données des gestionnaires de lieux, une ligne par flux) — trace :
-- _Divergences/M4.2_20261004_export-registre-ligne-par-flux.md.
--
-- Chaîne réelle : lieu de l'événement → entrepôt Savr (massification) → site de
-- traitement. Le référentiel porte le site de traitement HABITUEL de chaque
-- flux (« exutoire final » du registre) ; l'entrepôt, commun à tous les flux,
-- n'est pas une donnée du flux.
--
-- Sources :
--   - verre, déchet résiduel, biodéchets, cartons : export Veolia des
--     enlèvements à l'entrepôt (05/01 → 22/09/2026) — libellé de site et
--     adresse du site le plus fréquent, code CED, code de traitement final.
--     Ces codes remplacent ceux relevés le 2026-10-02 sur une ancienne
--     attestation (verre 20 01 02, cartons 20 01 01) : l'export fait foi.
--   - emballages : absents de l'export Veolia. Site donné par Val (centre de
--     tri Paprec Trivalo 93, adresse publique du site) ; code déchet et code de
--     traitement repris de l'attestation, seule source disponible — à confirmer.
--   - filière : biodéchets = méthanisation (Val), déchet résiduel = valorisation
--     énergétique (incinérateur, code R1). Le seed bloc8 disait compostage et
--     enfouissement. La filière n'entre dans aucun calcul (taux de recyclage et
--     CO₂ sont paramétrés à part) : seuls le registre et son export la lisent.
--
-- `exutoire_adresse` suit le format « voie, code postal ville » : l'export du
-- registre en tire trois colonnes (adresse, code postal, ville).
--
-- Backward-compatible : une colonne texte nullable + UPDATE de 5 lignes de
-- référentiel, dont deux filières qui changent de valeur (biodéchets,
-- résiduel). Aucun droit touché (lecture déjà ouverte au niveau table par la
-- policy fd_read). Idempotent : un rejeu repose les mêmes valeurs — une
-- correction de ces valeurs doit donc passer par une migration, pas par une
-- écriture directe en base.
--
-- Retour arrière : revenir d'abord sur le code (l'export sélectionne
-- code_traitement), puis remettre à NULL code_dechet_europeen, code_traitement,
-- exutoire et exutoire_adresse des 5 lignes, et filiere_valorisation à
-- 'compostage' (biodechet) et 'enfouissement' (dechet_residuel) — les valeurs
-- du seed bloc8. La colonne code_traitement peut rester (nullable, sans
-- lecteur) ; son retrait se ferait par une migration dédiée, après une release
-- sans usage.
-- =============================================================================

ALTER TABLE plateforme.flux_dechets
  ADD COLUMN IF NOT EXISTS code_traitement text;

COMMENT ON COLUMN plateforme.flux_dechets.code_traitement IS
  'Code de traitement final du flux (opération de valorisation R ou d''élimination D, '
  'ex. R3). Ajout 2026-10-04, divergence M4.2_20261004.';

UPDATE plateforme.flux_dechets SET
  code_dechet_europeen = '20 01 08',
  code_traitement      = 'R3',
  filiere_valorisation = 'methanisation',
  exutoire             = 'GENERIS VSG DCDT',
  exutoire_adresse     = 'ZI des Graviers, 6 avenue Winston Churchill, 94190 Villeneuve-Saint-Georges'
WHERE code = 'biodechet';

UPDATE plateforme.flux_dechets SET
  code_dechet_europeen = '15 01 06',
  code_traitement      = 'R3/R5',
  exutoire             = 'CENTRE DE TRI SELECTIF PAPREC TRIVALO 93',
  exutoire_adresse     = '10 rue de la Victoire, 93150 Le Blanc-Mesnil'
WHERE code = 'emballage';

UPDATE plateforme.flux_dechets SET
  code_dechet_europeen = '15 01 01',
  code_traitement      = 'R3',
  exutoire             = 'TAIS VILLENEUVE LE ROI TDI',
  exutoire_adresse     = '6 rue des Vœux Saint-Georges, 94290 Villeneuve-le-Roi'
WHERE code = 'carton';

UPDATE plateforme.flux_dechets SET
  code_dechet_europeen = '15 01 07',
  code_traitement      = 'R5',
  exutoire             = 'REVIVAL GENNEVILLIERS TRSFT',
  exutoire_adresse     = '9 route du Môle Central, 92230 Gennevilliers'
WHERE code = 'verre';

UPDATE plateforme.flux_dechets SET
  code_dechet_europeen = '20 03 01',
  code_traitement      = 'R1',
  filiere_valorisation = 'valorisation_energetique',
  exutoire             = 'NOVAZUR ARGENTEUIL UVEND',
  exutoire_adresse     = '2 rue du Chemin Vert, 95100 Argenteuil'
WHERE code = 'dechet_residuel';

-- Contrôle de fin. La table est en FORCE ROW LEVEL SECURITY : un rôle de
-- migration sans BYPASSRLS mettrait à jour 0 ligne sans erreur, la migration
-- serait enregistrée et l'export sortirait des colonnes vides. On compte les
-- lignes COMPLÈTES (et non les incomplètes) : un rôle qui ne voit aucune ligne
-- échoue lui aussi.
DO $$
DECLARE
  v_complets integer;
BEGIN
  SELECT count(*) INTO v_complets
    FROM plateforme.flux_dechets
   WHERE code IN ('biodechet', 'emballage', 'carton', 'verre', 'dechet_residuel')
     AND code_dechet_europeen IS NOT NULL
     AND code_traitement IS NOT NULL
     AND exutoire IS NOT NULL
     AND exutoire_adresse IS NOT NULL;
  IF v_complets <> 5 THEN
    RAISE EXCEPTION
      'flux_dechets : % flux renseigné(s) sur 5 après mise à jour — le rôle de migration écrit-il sous RLS ?',
      v_complets;
  END IF;
END $$;
