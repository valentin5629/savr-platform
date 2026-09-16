-- =============================================================================
-- Garde : le lien transporteur → prestataire ne se défait pas sous des collectes
-- vivantes.
-- =============================================================================
--
-- CONTEXTE. Le cloisonnement par provider (#313, #323, #327) reconnaît « une
-- tournée exécutée par tel provider » en deux temps : `tournees.prestataire_
-- logistique_id` (figé au dispatch) → le transporteur qui porte ce prestataire →
-- son `type_tms`. L'index `uniq_transporteur_par_prestataire` (#323) garantit
-- qu'un prestataire n'est rattaché qu'à UN transporteur. Conséquence : ce lien
-- et ce type sont la seule chose qui rattache les tournées en cours à leur
-- adapter.
--
-- Ce que ferait une modification du lien sous des collectes vivantes :
--   - changer le prestataire (A → B) ou supprimer le transporteur : A n'est plus
--     rattaché à aucun type → ses tournées sortent de tous les ensembles →
--     E2/E3 finissent en `noop_no_remote` marqué `done`, les pesées entrantes
--     ne se rapprochent plus. Silence, pas d'erreur.
--   - changer le type (de MTS-1 vers A Toutes!) : les tournées MTS-1 de A
--     deviennent visibles à l'adapter vélo-cargo → la fuite inter-provider
--     fermée par #327.
--
-- L'écran Admin sait désormais écrire ce lien. Or `admin_savr` et `ops_savr`
-- ont aussi UPDATE/DELETE sur la table par PostgREST (policies transp_admin /
-- transp_ops_write), et une correction SQL à la main passe par le même chemin :
-- la garde est donc posée en base, pas dans la route.
--
-- « VIVANTE » = statut hors {cloturee, annulee, rejetee_par_prestataire}.
-- `realisee` et `realisee_sans_collecte` restent vivantes : les pesées MTS-1
-- continuent d'être rapprochées jusqu'à la clôture (CLAUDE.md §2, idempotence
-- entrante). Deux voies de dépendance, parce qu'elles divergent après un
-- redispatch vers un autre prestataire (cas #327) :
--   - `collectes.prestataire_logistique_id` = routage du worker outbox ;
--   - `tournees.prestataire_logistique_id` = rapprochement par l'adapter.
--
-- Hors garde, volontairement : premier rattachement (NULL → B) — rien ne
-- dépendait du lien ; mise à jour ne changeant ni le prestataire ni le type
-- (l'écran renvoie tous les champs, et `seed:demo` réécrit les mêmes valeurs
-- en upsert) ; TRUNCATE (reset dev) — les triggers de ligne n'y sont pas
-- déclenchés.
--
-- SECURITY DEFINER : le décompte ne doit pas dépendre de ce que les policies
-- laissent voir à l'appelant. EXECUTE retiré à tous (P0 #263) — PostgreSQL ne
-- vérifie ce droit qu'à la création du trigger, pas au déclenchement ; le test
-- pgTAP le prouve sous `authenticated`.
--
-- Migration fermante : aucun GRANT, aucune policy, aucun élargissement.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_garde_lien_prestataire_transporteur()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_presta     uuid := OLD.prestataire_logistique_id;
  v_nb_vivantes integer;
BEGIN
  IF v_presta IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.prestataire_logistique_id IS NOT DISTINCT FROM OLD.prestataire_logistique_id
     AND NEW.type_tms IS NOT DISTINCT FROM OLD.type_tms THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_nb_vivantes
  FROM plateforme.collectes c
  WHERE c.statut NOT IN ('cloturee', 'annulee', 'rejetee_par_prestataire')
    AND (
      c.prestataire_logistique_id = v_presta
      OR EXISTS (
        SELECT 1
        FROM plateforme.collecte_tournees ct
        JOIN plateforme.tournees t ON t.id = ct.tournee_id
        WHERE ct.collecte_id = c.id
          AND t.prestataire_logistique_id = v_presta
      )
    );

  IF v_nb_vivantes > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'restrict_violation',
      MESSAGE = format(
        'transporteur %s : prestataire logistique ou type TMS non modifiable, %s collecte(s) non clôturée(s) en dépendent',
        OLD.id, v_nb_vivantes
      ),
      -- Pas « redispatcher » : un redispatch change le prestataire de la
      -- collecte, pas celui de la tournée déjà commandée, qui reste bloquante.
      HINT = 'Attendre la clôture ou l''annulation de ces collectes ; pour changer de prestataire, créer un nouveau transporteur.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_trg_garde_lien_prestataire_transporteur()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_garde_lien_prestataire_transporteur ON plateforme.transporteurs;
CREATE TRIGGER trg_garde_lien_prestataire_transporteur
  BEFORE UPDATE OF prestataire_logistique_id, type_tms OR DELETE
  ON plateforme.transporteurs
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_trg_garde_lien_prestataire_transporteur();
