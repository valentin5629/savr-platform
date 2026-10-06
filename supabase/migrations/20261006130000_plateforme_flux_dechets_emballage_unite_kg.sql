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
