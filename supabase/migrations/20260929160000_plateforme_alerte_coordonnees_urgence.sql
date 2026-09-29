-- =============================================================================
-- Demande « coordonnées du chauffeur en urgence » depuis la fiche collecte client
-- =============================================================================
-- §06.04 « Fiche collecte (vue détail) », refonte pop-up (décision Val 2026-09-29,
-- Q3) : le client (traiteur, agence, gestionnaire de lieux) peut demander en
-- urgence les coordonnées du chauffeur. Effets :
--   · une alerte in-app Ops (table alertes_admin, code
--     'coordonnees_chauffeur_urgence') — ni email, ni Slack ;
--   · UNE demande par collecte, garantie ICI par un index unique partiel : la
--     route insère sans lecture préalable et traite la violation d'unicité comme
--     « déjà demandée » → un double clic concurrent ne crée jamais 2 alertes
--     (f_upsert_alerte_admin, en SELECT-puis-INSERT, ne le garantit pas) ;
--   · clôture AUTOMATIQUE de l'alerte à réception des coordonnées : dès que
--     chaque camion rattaché à la collecte a un nom de chauffeur, un téléphone et
--     une plaque (vélo cargo : pas de plaque). Un trigger est le seul point qui
--     voit TOUS les écrivains de `tournees` (adapters logistiques, webhooks des
--     transporteurs, saisie Admin des infos d'accès).
--
-- Aucun accès n'est ouvert : pas de GRANT, pas de policy. L'INSERT client passe
-- par la route (service_role, après contrôle RLS de visibilité de la collecte) ;
-- alertes_admin reste fermée aux rôles clients (policy aa_admin seule).
-- Fonction trigger SECURITY INVOKER : ses seuls déclencheurs sont les écrivains
-- de `tournees` / `collecte_tournees` (service_role, admin_savr), qui ont déjà
-- le droit d'UPDATE sur alertes_admin.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uniq_alerte_coordonnees_urgence_par_collecte
  ON plateforme.alertes_admin (entity_id)
  WHERE code = 'coordonnees_chauffeur_urgence';

CREATE OR REPLACE FUNCTION plateforme.fn_cloturer_alerte_coordonnees_urgence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_collecte_ids uuid[];
BEGIN
  -- Collectes concernées par l'écriture : celles servies par la tournée
  -- modifiée, ou celle dont un camion vient d'être rattaché / retiré
  -- (réduction de N à chaud : les camions restants peuvent être complets).
  IF TG_TABLE_NAME = 'collecte_tournees' THEN
    IF TG_OP = 'DELETE' THEN
      v_collecte_ids := ARRAY[OLD.collecte_id];
    ELSE
      v_collecte_ids := ARRAY[NEW.collecte_id];
    END IF;
  ELSE
    SELECT array_agg(ct.collecte_id) INTO v_collecte_ids
      FROM plateforme.collecte_tournees ct
     WHERE ct.tournee_id = NEW.id;
  END IF;

  IF v_collecte_ids IS NULL THEN
    RETURN NULL;
  END IF;

  -- Clôture si la collecte a AU MOINS un camion et que TOUS ses camions ont
  -- leurs coordonnées complètes (une chaîne vide ne compte pas : c'est un
  -- « En attente » à l'écran ; vélo cargo = pas de plaque attendue).
  UPDATE plateforme.alertes_admin a
     SET statut = 'resolue',
         resolue_at = now()
   WHERE a.code = 'coordonnees_chauffeur_urgence'
     AND a.statut = 'ouverte'
     AND a.entity_id = ANY (v_collecte_ids)
     AND EXISTS (
       SELECT 1
         FROM plateforme.collecte_tournees ct1
        WHERE ct1.collecte_id = a.entity_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM plateforme.collecte_tournees ct2
         JOIN plateforme.tournees t ON t.id = ct2.tournee_id
        WHERE ct2.collecte_id = a.entity_id
          AND (
            NULLIF(btrim(t.chauffeur_nom), '') IS NULL
            OR NULLIF(btrim(t.chauffeur_telephone), '') IS NULL
            OR (
              NULLIF(btrim(t.plaque_immatriculation), '') IS NULL
              AND t.type_vehicule IS DISTINCT FROM 'velo_cargo'
            )
          )
     );

  RETURN NULL;
END;
$$;

-- Hygiène : fonction de trigger, jamais appelée directement.
REVOKE EXECUTE ON FUNCTION plateforme.fn_cloturer_alerte_coordonnees_urgence()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cloturer_alerte_coordonnees_urgence ON plateforme.tournees;
CREATE TRIGGER trg_cloturer_alerte_coordonnees_urgence
  AFTER INSERT OR UPDATE OF chauffeur_nom, chauffeur_telephone, plaque_immatriculation, type_vehicule
  ON plateforme.tournees
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_cloturer_alerte_coordonnees_urgence();

DROP TRIGGER IF EXISTS trg_cloturer_alerte_coordonnees_urgence ON plateforme.collecte_tournees;
CREATE TRIGGER trg_cloturer_alerte_coordonnees_urgence
  AFTER INSERT OR DELETE
  ON plateforme.collecte_tournees
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_cloturer_alerte_coordonnees_urgence();
