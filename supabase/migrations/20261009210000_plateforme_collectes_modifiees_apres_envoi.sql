-- =============================================================================
-- Drapeau « modifiée sans renvoi » (`collectes.dirty_tms`) : il s'arme dès que
-- la demande est partie vers le prestataire, pour la date, l'heure, le lieu, le
-- contrôle d'accès et l'information supplémentaire de la collecte, comme pour
-- le pax et les contacts de son événement.
-- =============================================================================
-- Constat E2E de Val, 2026-10-09 : l'Admin envoie une collecte ZD à son
-- prestataire, le traiteur la modifie deux minutes plus tard (date, pax,
-- contact) ; le filtre Admin « Modifiées sans renvoi TMS » reste à 0.
--
-- Mesuré sur savr-dev ce jour-là : le déclencheur n'armait le drapeau que si
-- `statut_tms <> 'non_envoye'`, c'est-à-dire une fois la commande réellement
-- reçue par le prestataire. Entre le clic de l'Admin et cette réception (un
-- passage du worker, jamais en dev), la collecte est pourtant déjà
-- « Programmée » à l'écran (décision Val 2026-10-07). Le pax et les contacts,
-- portés par l'événement, n'armaient jamais rien.
--
-- Arbitrage Val du 2026-10-09 : le filtre veut dire « un client a modifié après
-- mon envoi ». Il s'arme dès le clic de l'Admin, pour tout transporteur (y
-- compris joint par mail ou téléphone), et pour le pax et les contacts comme
-- pour la date. Il se vide au renvoi (`fn_dispatcher_collecte`, inchangée).
--
-- « Demande partie » = les quatre signaux de l'affichage Admin
-- (lib/statut-collecte-admin, `demandeEnvoyee`), dont un seul suffit : un
-- statut TMS sorti de « non envoyé », une référence de commande, un prestataire
-- posé sur la collecte, une attribution AG. Ils sont lus sur l'état d'AVANT la
-- modification : c'est une collecte déjà partie qui est modifiée.
--
-- 1. `fn_set_collectes_dirty_tms` (déclencheur de `collectes`, 20260611171638) :
--    mêmes cinq champs comparés, condition d'envoi élargie. La liste de ces
--    champs reste normative pour le payload E2 (test-cliquet côté adapters).
-- 2. `fn_evenement_marque_collectes_modifiees` (nouveau déclencheur de
--    `evenements`) : une modification du pax ou d'un contact arme le drapeau des
--    collectes de l'événement déjà parties ET encore à réaliser (programmée,
--    validée, en cours). Un événement peut porter une collecte terminée à côté
--    d'une collecte à venir : la terminée n'a plus rien à renvoyer, et rien ne
--    pourrait vider son drapeau. R22c avait écarté ce déclencheur pour éviter un
--    second envoi au prestataire quand la modification lui est déjà parvenue ;
--    Val accepte ce coût (l'Admin clique « Renvoyer » pour vider le filtre).
--
-- Aucun rattrapage des collectes déjà modifiées : le drapeau ne s'arme que pour
-- les modifications à venir.
--
-- Backward-compatible : deux fonctions de déclencheur et un déclencheur, aucune
-- table, aucune colonne, aucune policy, aucun droit ouvert. Fonctions en
-- SECURITY INVOKER : elles ne tournent que sous les écrivains de `collectes` et
-- d'`evenements` (RPC et service_role ; l'écriture directe est fermée aux
-- clients depuis 20260915160000 et 20260915190000).
--
-- Retour arrière : rejouer la seule définition de `fn_set_collectes_dirty_tms`
-- de 20260611171638 (lignes 241 à 256, pas le fichier entier), puis
--   DROP TRIGGER trg_evenement_marque_collectes_modifiees ON plateforme.evenements;
--   DROP FUNCTION plateforme.fn_evenement_marque_collectes_modifiees();
-- Les drapeaux déjà levés le restent : « Renvoyer » les vide.
-- =============================================================================

-- ─── 1. Collecte : champs transmis au prestataire ────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_set_collectes_dirty_tms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF (OLD.date_collecte IS DISTINCT FROM NEW.date_collecte
    OR OLD.heure_collecte IS DISTINCT FROM NEW.heure_collecte
    OR OLD.controle_acces_requis IS DISTINCT FROM NEW.controle_acces_requis
    OR OLD.informations_supplementaires IS DISTINCT FROM NEW.informations_supplementaires
    OR OLD.lieu_overrides IS DISTINCT FROM NEW.lieu_overrides) THEN
    -- Demande déjà partie vers le prestataire avant cette modification. Lu
    -- après la comparaison des champs : la recherche d'attribution n'est faite
    -- que pour une écriture qui change réellement l'un d'eux.
    IF (OLD.statut_tms <> 'non_envoye'
        OR OLD.tms_reference IS NOT NULL
        OR OLD.prestataire_logistique_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM plateforme.attributions_antgaspi a
          WHERE a.collecte_id = OLD.id
        ))
    THEN
      NEW.dirty_tms := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 2. Événement : pax et contacts ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_evenement_marque_collectes_modifiees()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF (OLD.pax IS DISTINCT FROM NEW.pax
      OR OLD.contact_principal_nom IS DISTINCT FROM NEW.contact_principal_nom
      OR OLD.contact_principal_telephone IS DISTINCT FROM NEW.contact_principal_telephone
      OR OLD.contact_secours_nom IS DISTINCT FROM NEW.contact_secours_nom
      OR OLD.contact_secours_telephone IS DISTINCT FROM NEW.contact_secours_telephone)
  THEN
    UPDATE plateforme.collectes c
       SET dirty_tms = true
     WHERE c.evenement_id = NEW.id
       AND c.dirty_tms = false
       AND c.statut IN ('programmee', 'validee', 'en_cours')
       AND (c.statut_tms <> 'non_envoye'
            OR c.tms_reference IS NOT NULL
            OR c.prestataire_logistique_id IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM plateforme.attributions_antgaspi a
              WHERE a.collecte_id = c.id
            ));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_evenement_marque_collectes_modifiees()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_evenement_marque_collectes_modifiees ON plateforme.evenements;
CREATE TRIGGER trg_evenement_marque_collectes_modifiees
  AFTER UPDATE ON plateforme.evenements
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_evenement_marque_collectes_modifiees();

COMMENT ON FUNCTION plateforme.fn_evenement_marque_collectes_modifiees() IS
  'Arme collectes.dirty_tms pour les collectes déjà parties vers le prestataire et encore à réaliser (programmee, validee, en_cours) quand le pax ou un contact de leur événement change (arbitrage Val 2026-10-09). Remis à false par fn_dispatcher_collecte.';
