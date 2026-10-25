-- Auto-accept AG : l'association est obligatoire (décision Val I4 du 2026-10-25,
-- CDC §04 `config_auto_accept_ag` et §06.09 §6).
--
-- Une règle sans association ne pouvait jamais se déclencher :
-- `rpc_evaluer_auto_accept_ag` exige `association_id = <association top 1>`, et
-- une comparaison à NULL n'est jamais vraie. La colonne devient NOT NULL ; l'API
-- Admin refuse déjà une règle sans association (422).
--
-- Lignes existantes contrôlées en lecture seule le 2026-10-25 : savr-dev
-- 3 règles, 0 sans association ; savr-prod 0 règle. Le bloc ci-dessous arrête
-- la migration avec un message clair si une base en porte une malgré tout :
-- c'est à l'Admin de lui choisir une association ou de la retirer, pas à la
-- migration de décider.

DO $$
DECLARE
  v_sans_association integer;
BEGIN
  SELECT count(*) INTO v_sans_association
  FROM plateforme.config_auto_accept_ag
  WHERE association_id IS NULL;

  IF v_sans_association > 0 THEN
    RAISE EXCEPTION
      'config_auto_accept_ag : % règle(s) sans association. Leur choisir une association ou les retirer avant cette migration.',
      v_sans_association;
  END IF;
END
$$;

ALTER TABLE plateforme.config_auto_accept_ag
  ALTER COLUMN association_id SET NOT NULL;
