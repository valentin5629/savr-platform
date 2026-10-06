-- =============================================================================
-- Référentiel des flux ZD : unité de mesure des Emballages = kg.
-- =============================================================================
-- Décision Val 2026-10-06, sur un écart relevé par la revue du sync des specs :
-- le CDC (§04 Data Model, table flux_dechets, « Valeurs initiales ») donne les
-- 5 flux V1 en kg ; le seed bloc8 (20260611171642) avait semé les Emballages en
-- 'bac', et aucune migration ne l'a corrigé depuis. La spec a raison, la base
-- est alignée dessus.
--
-- État mesuré avant écriture (2026-10-06, dev et prod) : emballage = 'bac', les
-- 4 autres flux = 'kg'.
--
-- Portée : la seule ligne `emballage` du référentiel. Les pesées sont déjà
-- stockées en kg pour tous les flux (collecte_flux, pesees_tournees) ; aucun
-- code applicatif ne lit cette colonne aujourd'hui. L'enjeu est la justesse du
-- référentiel, que lisent l'export du registre réglementaire et, demain, le
-- bordereau et le rapport de recyclage.
--
-- Backward-compatible : UPDATE d'une ligne de référentiel, aucune structure
-- modifiée, aucun droit touché. L'enum plateforme.unite_mesure garde ses trois
-- valeurs ('kg', 'litre', 'bac'), conformes au DDL cible V2.
-- Idempotent : le filtre sur la valeur courante fait d'un rejeu une écriture
-- de 0 ligne.
--
-- Retour arrière : UPDATE plateforme.flux_dechets SET unite_mesure = 'bac'
-- WHERE code = 'emballage'; (sans effet sur les données de collecte).
-- =============================================================================

UPDATE plateforme.flux_dechets
   SET unite_mesure = 'kg'
 WHERE code = 'emballage'
   AND unite_mesure <> 'kg';

-- Contrôle de fin, comme la migration 20261004203000 : la table est en FORCE
-- ROW LEVEL SECURITY, un rôle de migration sans BYPASSRLS mettrait à jour
-- 0 ligne sans erreur et la migration serait enregistrée. On compte les flux
-- EN kg (et non ceux qui ne le sont pas) : un rôle qui ne voit aucune ligne
-- échoue lui aussi.
DO $$
DECLARE
  v_en_kg integer;
BEGIN
  SELECT count(*) INTO v_en_kg
    FROM plateforme.flux_dechets
   WHERE code IN ('biodechet', 'emballage', 'carton', 'verre', 'dechet_residuel')
     AND unite_mesure = 'kg';
  IF v_en_kg <> 5 THEN
    RAISE EXCEPTION
      'flux_dechets : % flux en kg sur 5 après mise à jour — le rôle de migration écrit-il sous RLS ?',
      v_en_kg;
  END IF;
END $$;
