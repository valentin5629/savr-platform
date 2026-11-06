-- Forfait transport des collectes ZD : véhicule réel au lieu d'une benne de 26 t.
--
-- Le facteur `fe_camion_benne_kg_km` (parametres_co2_divers) était celui d'une
-- benne à ordures de 26 t au gazole (2,1 kgCO₂e/km, Base Carbone V23). Les
-- collectes sont faites en camion de 20 m³ de 3,5 t diesel. Décision Val
-- 2026-11-06 : intitulé « FE IVECO 20m3 Diesel 2024 », valeur 0,4 kgCO₂e/km.
--
-- La clé `fe_camion_benne_kg_km` ne change pas (lue par les calculs CO₂ et le
-- tableau de bord) : seuls l'intitulé affiché (`description`) et la valeur
-- changent.
-- La valeur n'est remplacée que si elle vaut encore 2,1 : une valeur déjà
-- saisie par un admin dans l'écran Paramètres CO₂ (tracée) est conservée.
-- L'intitulé est toujours remplacé.
--
-- Traçabilité : l'UPDATE passe par le déclencheur d'audit de la table
-- (`audit_log`), avec le motif ci-dessous.
-- Les collectes déjà calculées gardent leurs valeurs figées
-- (R_co2_snapshot_fige) : aucune n'est recalculée ici.
--
-- Retour arrière : remettre `description` à 'FE benne 26 t gazole (Base Carbone
-- V23)' et, si elle a été changée ici, `valeur` à 2.1.

DO $migration$
DECLARE
  v_n int;
BEGIN
  PERFORM set_config('savr.audit_motif',
    'Forfait transport : véhicule IVECO 20 m³ diesel, 0,4 kgCO₂e/km (décision Val 2026-11-06)',
    true);

  UPDATE plateforme.parametres_co2_divers
  SET description = 'FE IVECO 20m3 Diesel 2024',
      valeur      = CASE WHEN valeur = 2.1 THEN 0.4 ELSE valeur END,
      updated_at  = now()
  WHERE cle = 'fe_camion_benne_kg_km';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Contrôle de fin, en forme positive : sous RLS forcée, un rôle sans
  -- BYPASSRLS ne verrait aucune ligne et n'écrirait rien, sans erreur.
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fe_camion_benne_kg_km invisible au rôle de migration : rien n''a été corrigé';
  END IF;

  PERFORM set_config('savr.audit_motif', '', true);
END
$migration$;
