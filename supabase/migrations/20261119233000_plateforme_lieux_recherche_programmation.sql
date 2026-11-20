-- Recherche de lieux du formulaire de programmation ouverte à tout le
-- référentiel (décision Val 2026-11-19).
--
-- Besoin : un traiteur ou une agence doit pouvoir programmer une collecte sur
-- n'importe quel lieu actif du référentiel, mais ne voir les données (listes,
-- fiches, tableaux de bord) que des lieux où il a programmé. Ce second point
-- est déjà tenu par la policy `lieux_clients_select`, inchangée : dès qu'un
-- événement est créé sur un lieu, la branche « lieu d'un événement que
-- l'organisation a programmé » le rend visible à l'organisation.
--
-- Cette fonction ne sert QUE la recherche du formulaire :
--  - rôles `traiteur_manager`, `traiteur_commercial`, `agence` seulement ; le
--    gestionnaire de lieux reste limité à ses lieux (CDC §09, route inchangée
--    pour lui), l'équipe Savr a son propre chemin ; tout autre rôle = 42501 ;
--  - lieux actifs, recherche sur nom, adresse ou ville, 20 lignes au plus ;
--  - colonnes du formulaire seulement (celles de COLONNES_LIEU de
--    GET /api/v1/programmation/lieux) : ni SIREN, ni commentaires, ni email du
--    gestionnaire, ni champs Admin.
-- Aucune policy n'est modifiée : `lieux` et `v_lieux_clients` restent filtrées
-- comme avant.
--
-- Accès élargi au sens de CLAUDE.md §12 (2bis) : accord explicite de Val le
-- 2026-11-19 (« Oui, lance-la », traiteurs et agences, gestionnaire inchangé).

CREATE OR REPLACE FUNCTION plateforme.f_rechercher_lieux_programmation(
  p_recherche text DEFAULT ''
)
RETURNS TABLE (
  id                            uuid,
  nom                           text,
  adresse_acces                 text,
  code_postal                   text,
  ville                         text,
  acces_details                 text,
  acces_office                  text,
  stationnement                 text,
  type_vehicule_max             text,
  controle_acces_requis_default boolean,
  contraintes_horaires          text,
  flux_autorises                text[],
  libelle_adresse_1             text,
  libelle_adresse_2             text,
  adresse_acces_2               text,
  code_postal_2                 text,
  ville_2                       text,
  libelle_adresse_3             text,
  adresse_acces_3               text,
  code_postal_3                 text,
  ville_3                       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_motif text;
BEGIN
  -- Code de vérification (20261104200000) : refus avant toute lecture.
  IF NOT plateforme.f_code_verification_ok() THEN
    RAISE EXCEPTION 'Code de vérification requis' USING ERRCODE = '42501';
  END IF;

  IF plateforme.f_app_role() IS DISTINCT FROM 'traiteur_manager'
     AND plateforme.f_app_role() IS DISTINCT FROM 'traiteur_commercial'
     AND plateforme.f_app_role() IS DISTINCT FROM 'agence' THEN
    RAISE EXCEPTION 'Recherche du référentiel réservée aux traiteurs et aux agences'
      USING ERRCODE = '42501';
  END IF;

  -- Saisie prise littéralement : %, _ et \ n'y sont pas des jokers.
  v_motif := '%' || replace(replace(replace(btrim(coalesce(p_recherche, '')),
               '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT l.id, l.nom, l.adresse_acces, l.code_postal, l.ville,
         l.acces_details, l.acces_office::text, l.stationnement::text,
         l.type_vehicule_max::text, l.controle_acces_requis_default,
         l.contraintes_horaires, l.flux_autorises,
         l.libelle_adresse_1,
         l.libelle_adresse_2, l.adresse_acces_2, l.code_postal_2, l.ville_2,
         l.libelle_adresse_3, l.adresse_acces_3, l.code_postal_3, l.ville_3
    FROM plateforme.lieux l
   WHERE l.actif
     AND (l.nom ILIKE v_motif
          OR l.adresse_acces ILIKE v_motif
          OR l.ville ILIKE v_motif)
   ORDER BY l.nom, l.id
   LIMIT 20;
END;
$$;

COMMENT ON FUNCTION plateforme.f_rechercher_lieux_programmation(text) IS
  'Recherche de lieux du formulaire de programmation (Val 2026-11-19) : tout le référentiel actif, pour traiteur_manager, traiteur_commercial et agence seulement (sinon 42501). Colonnes du formulaire seules, 20 lignes, recherche sur nom, adresse, ville. Ne modifie aucune visibilité : listes, fiches et tableaux de bord restent sous lieux_clients_select. SECURITY DEFINER, garde du code de vérification.';

REVOKE EXECUTE ON FUNCTION plateforme.f_rechercher_lieux_programmation(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.f_rechercher_lieux_programmation(text)
  TO authenticated, service_role;
