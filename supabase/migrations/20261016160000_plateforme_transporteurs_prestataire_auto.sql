-- =============================================================================
-- transporteurs : la fiche prestataire logistique est créée par la base à
-- l'insertion d'un transporteur routé vers un adapter, plus choisie à l'écran.
-- =============================================================================
--
-- SOURCE. Décision Val 2026-10-16 (choix C1, divergence
--   M1.1b_20261016_transporteur-prestataire-auto) : « la fiche prestataire est
--   créée automatiquement à la création du transporteur et le champ disparaît
--   du formulaire ». Remplace, pour les nouveaux transporteurs, la liste
--   déroulante « Prestataire logistique » de 06.06 §6 et la phrase « Pas
--   d'écran de création de prestataire en V1 : shared.prestataires reste
--   alimenté par l'équipe technique ».
--
-- POURQUOI. En V1 le transporteur et son prestataire sont une seule et même
--   société (index unique 1-1, mêmes noms partout). Mesuré le 2026-10-16 en
--   lecture seule : dev = 4 liens, tous entre fiches du même nom ; prod = 1
--   seule fiche prestataire (A Toutes!), déjà liée. En prod, la liste ne
--   proposait donc rien : aucun transporteur MTS-1 n'était créable à l'écran.
--
-- CE QUE FAIT LE TRIGGER. Avant l'insertion d'un transporteur `mts1` ou
--   `a_toutes` arrivé SANS lien, il insère la fiche `shared.prestataires` et
--   pose le lien sur la ligne, dans la même transaction :
--     - nom             = nom du transporteur (l'algo AG province rapproche
--                         transporteur et prestataire par le nom) ;
--     - code            = nom en majuscules sans accents ni ponctuation,
--                         suffixé « -2 », « -3 »… s'il est déjà pris (UNIQUE) ;
--     - type_prestation = flux de `types_collecte` (anti_gaspi → ag,
--                         zero_dechet → zd ; l'algo AG exige « ag ») ;
--     - mode_integration = même valeur que les fiches existantes et les seeds ;
--     - siret non renseigné : le formulaire transporteur ne recueille qu'un
--       SIREN, dont on ne déduit pas le SIRET.
--   Un lien déjà fourni est respecté (seeds, fixtures) : rien n'est créé.
--   Les types manuels (`autre`, `par_mail`, `par_telephone`) ne passent par
--   aucun adapter et n'ont toujours pas de prestataire.
--
-- CE QUI NE CHANGE PAS. Les transporteurs existants et leurs fiches. Le lien
--   reste immuable (trg_transporteur_cols_immuables) ; le nom et les flux de la
--   fiche sont copiés à la création, pas resynchronisés ensuite.
--
-- DROITS. SECURITY INVOKER : l'écran crée par la route serveur (service_role,
--   qui écrit `shared.prestataires`). Un `admin_savr` qui insère directement
--   par PostgREST un transporteur `mts1`/`a_toutes` sans lien est refusé par la
--   RLS de `shared.prestataires` (aucune policy d'écriture) au lieu de créer un
--   transporteur inopérant : aucun accès n'est ouvert. EXECUTE retiré à PUBLIC,
--   anon et authenticated (P0 #263) ; un trigger s'exécute sans ce droit.
--
-- UPSERT. Le trigger s'exécute avant la détection d'un conflit : un
--   `INSERT … ON CONFLICT` sans lien sur un transporteur `mts1`/`a_toutes` déjà
--   présent laisse une fiche orpheline (DO NOTHING) ou est refusé en P0045 par
--   trg_transporteur_cols_immuables (DO UPDATE du lien). Aucun chemin actuel ne
--   le fait (route : INSERT simple ; seeds : upsert juste après le vidage des
--   tables, donc sans conflit) ; un script de reprise doit fournir le lien.
--
-- RETOUR ARRIÈRE. `DROP TRIGGER trg_transporteur_prestataire_auto ON
--   plateforme.transporteurs;` puis `DROP FUNCTION
--   plateforme.fn_trg_transporteur_prestataire_auto();` : aucun résidu. Les
--   fiches déjà créées restent liées (lien immuable, possiblement référencé par
--   des tournées). La route et la modale n'envoyant plus le lien, les revenir
--   en même temps, sinon un transporteur mts1/a_toutes créé à l'écran resterait
--   sans prestataire.
--
-- NATURE. Additive et non destructive : aucun DROP, RENAME ni backfill, aucun
--   GRANT, aucune policy, aucune fonction SECURITY DEFINER.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_transporteur_prestataire_auto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_base text;
  v_code text;
  v_rang integer := 1;
BEGIN
  IF NEW.type_tms::text NOT IN ('mts1', 'a_toutes')
     OR NEW.prestataire_logistique_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_base := regexp_replace(
    upper(translate(
      NEW.nom,
      'àâäçéèêëîïôöùûüÿÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ',
      'aaaceeeeiioouuuyAAACEEEEIIOOUUUY'
    )),
    '[^A-Z0-9]+', '', 'g'
  );
  IF v_base = '' THEN
    v_base := 'PRESTATAIRE';
  END IF;
  v_code := v_base;
  WHILE EXISTS (SELECT 1 FROM shared.prestataires p WHERE p.code = v_code) LOOP
    v_rang := v_rang + 1;
    v_code := v_base || '-' || v_rang;
  END LOOP;

  INSERT INTO shared.prestataires (nom, code, type_prestation, mode_integration)
  VALUES (
    NEW.nom,
    v_code,
    ARRAY(
      SELECT CASE f WHEN 'anti_gaspi' THEN 'ag' ELSE 'zd' END
        FROM unnest(NEW.types_collecte) AS f
       WHERE f IN ('anti_gaspi', 'zero_dechet')
    ),
    CASE NEW.type_tms::text WHEN 'a_toutes' THEN 'everest' ELSE 'mts1' END
  )
  RETURNING id INTO NEW.prestataire_logistique_id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_trg_transporteur_prestataire_auto()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_transporteur_prestataire_auto ON plateforme.transporteurs;
CREATE TRIGGER trg_transporteur_prestataire_auto
  BEFORE INSERT ON plateforme.transporteurs
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_trg_transporteur_prestataire_auto();
