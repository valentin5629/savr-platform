-- =============================================================================
-- Référentiel des flux ZD : exutoires renommés en noms courts, codes de
-- traitement du carton et du verre corrigés (décision Val 2026-11-16).
-- =============================================================================
-- Source : email de Val du 2026-11-16 (sites de traitement Veolia par flux).
-- « Mets des adresses courtes pour pas prendre trop de place » : le rapport de
-- recyclage imprime « exutoire, commune » dans son annexe ; les libellés Veolia
-- (« GENERIS VSG DCDT ») cèdent la place à des noms courts lisibles.
--
--   biodéchets      : Generis Veolia, Villeneuve-Saint-Georges, R3 (inchangé)
--   déchet résiduel : SUVE (Suez, unité de valorisation énergétique),
--                     Argenteuil, R1 (inchangé)
--   cartons         : Veolia Tais, Villeneuve-le-Roi, R3 → R5
--   verre           : Revival, Gennevilliers, R5 → R13
--   emballages      : même site (absent de l'email), nom raccourci
--                     « Paprec Trivalo 93 », Le Blanc-Mesnil, R3/R5 (inchangé)
--
-- `exutoire_adresse` garde le format « voie, code postal ville » (l'export du
-- registre en tire trois colonnes) ; seule la mention « ZI des Graviers » est
-- retirée des biodéchets.
--
-- Backward-compatible : UPDATE des 5 lignes de référentiel, aucun droit touché.
-- Idempotent. Les documents déjà émis ne changent pas (bordereaux figés) ; un
-- rapport de recyclage fabriqué après cette migration imprime les nouvelles
-- valeurs.
--
-- Retour arrière : reposer les valeurs de la migration 20261004203000 pour les
-- 5 flux.
-- =============================================================================

UPDATE plateforme.flux_dechets SET
  exutoire         = 'Generis Veolia',
  exutoire_adresse = '6 avenue Winston Churchill, 94190 Villeneuve-Saint-Georges',
  code_traitement  = 'R3'
WHERE code = 'biodechet';

UPDATE plateforme.flux_dechets SET
  exutoire         = 'SUVE',
  exutoire_adresse = '2 rue du Chemin Vert, 95100 Argenteuil',
  code_traitement  = 'R1'
WHERE code = 'dechet_residuel';

UPDATE plateforme.flux_dechets SET
  exutoire         = 'Veolia Tais',
  exutoire_adresse = '6 rue des Vœux Saint-Georges, 94290 Villeneuve-le-Roi',
  code_traitement  = 'R5'
WHERE code = 'carton';

UPDATE plateforme.flux_dechets SET
  exutoire         = 'Revival',
  exutoire_adresse = '9 route du Môle Central, 92230 Gennevilliers',
  code_traitement  = 'R13'
WHERE code = 'verre';

UPDATE plateforme.flux_dechets SET
  exutoire         = 'Paprec Trivalo 93',
  exutoire_adresse = '10 rue de la Victoire, 93150 Le Blanc-Mesnil',
  code_traitement  = 'R3/R5'
WHERE code = 'emballage';

-- Contrôle de fin : la table est en FORCE ROW LEVEL SECURITY ; un rôle de
-- migration sans BYPASSRLS mettrait à jour 0 ligne sans erreur. On compte les
-- lignes qui portent les nouvelles valeurs.
DO $$
DECLARE
  v_ok integer;
BEGIN
  SELECT count(*) INTO v_ok
    FROM plateforme.flux_dechets
   WHERE (code, exutoire, code_traitement) IN (
     ('biodechet', 'Generis Veolia', 'R3'),
     ('dechet_residuel', 'SUVE', 'R1'),
     ('carton', 'Veolia Tais', 'R5'),
     ('verre', 'Revival', 'R13'),
     ('emballage', 'Paprec Trivalo 93', 'R3/R5'));
  IF v_ok <> 5 THEN
    RAISE EXCEPTION
      'flux_dechets : % flux mis à jour sur 5 — le rôle de migration écrit-il sous RLS ?',
      v_ok;
  END IF;
END $$;
