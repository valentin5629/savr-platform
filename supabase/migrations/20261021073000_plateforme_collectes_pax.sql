-- =============================================================================
-- Pax porté par la collecte (décision Val 2026-10-20) — lot 1 : saisie et
-- transmission
-- =============================================================================
-- DEMANDE : chaque collecte porte son nombre de convives. Jusqu'ici, le pax
-- n'existait que sur l'événement : un congrès sur deux soirées n'avait qu'un
-- chiffre pour ses quatre collectes. Arbitrages de Val du 2026-10-20 :
--   C1 — pax de l'événement = pour chaque jour de collecte, le plus grand pax
--        des collectes de ce jour, puis la somme des jours (une ZD et une AG du
--        même soir comptent une fois ; deux soirées s'additionnent) ;
--   C3 — le pax se saisit avec la date de collecte, plus à l'étape 1.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. `collectes.pax` (integer NOT NULL, >= 0), rempli avec le pax de
--      l'événement de chaque collecte existante (contrôle de fin positif).
--   2. Un pax absent (ou 0, défaut de la colonne) à l'INSERT prend celui de
--      la dernière collecte non annulée de l'événement au pax connu (date, puis
--      heure ; même règle que le pré-remplissage de « Ajouter une collecte »),
--      à défaut celui de
--      l'événement — jamais la somme des jours, qui gonflerait à chaque ajout
--      (écrivains qui ne le passent pas encore : back-office, fixtures, seeds).
--   3. `evenements.pax` devient CALCULÉ depuis ses collectes non annulées
--      (règle C1), par un déclencheur jumeau de `trg_set_date_evenement`, puis
--      recalculé une fois pour tous les événements existants : un événement
--      dont les collectes tombent sur plusieurs jours voit son pax multiplié
--      par le nombre de jours, et la valeur saisie n'est conservée nulle part.
--      La colonne reste : les écrans, vues et exports au niveau de l'événement
--      la lisent.
--   4. Volume de repas estimé AG = 10 % du pax de LA collecte.
--   5. Signal « modifiée après envoi » (`dirty_tms`) : le pax rejoint les champs
--      surveillés de la collecte ; le déclencheur de l'événement ne surveille
--      plus que les contacts (sinon chaque recalcul du pax de l'événement
--      armerait toutes ses collectes).
--   6. RPC : `fn_creer_collecte` et `fn_ajouter_collecte_evenement` prennent
--      `p_pax` (défaut NULL = règle du point 2) ; `fn_modifier_collecte`
--      accepte `pax` (entier de 1 à 100 000) et émet son E2 générique ;
--      `fn_modifier_evenement` refuse `pax` (PAX_SUR_COLLECTE).
--
-- HORS LOT 1 (lots 2 et 3) : facturation, algorithme AG, benchmark, déchets
-- labo, registre, PDF et dashboards lisent encore `evenements.pax`.
--
-- ACCÈS : aucun droit ouvert, aucune policy touchée, aucun GRANT à un rôle
-- client. Les trois fonctions nouvelles (fn_collectes_pax_par_defaut,
-- f_pax_evenement, fn_set_pax_evenement) et les quatre RPC SECURITY DEFINER
-- (fn_creer_collecte et fn_ajouter_collecte_evenement, recréées par DROP +
-- CREATE ; fn_modifier_collecte et fn_modifier_evenement) retirent l'exécution
-- à PUBLIC, anon et authenticated, sans dépendre des privilèges par défaut ;
-- fn_modifier_collecte et fn_modifier_evenement gardent leur GRANT à
-- service_role. Les deux fonctions de déclencheur remplacées par CREATE OR
-- REPLACE gardent leurs droits. service_role exécute le reste par les
-- privilèges par défaut du schéma. La nouvelle
-- colonne suit le SELECT de `collectes` (RLS), comme les autres colonnes de la
-- table ; elle reprend une valeur que les mêmes lecteurs lisent déjà sur
-- l'événement. Les écritures restent fermées aux clients (REVOKE INSERT/UPDATE
-- de 20260915160000) : seules les RPC et le service_role l'écrivent.
--
-- ORDRE : la recopie (1) passe AVANT la nouvelle définition du signal
-- `dirty_tms` (5) (sinon elle armerait toutes les collectes déjà envoyées) ; le
-- recalcul du pax des événements passe APRÈS la nouvelle définition du
-- déclencheur de l'événement, pour la même raison.
--
-- ROLLBACK : d'abord supprimer les deux signatures nouvelles
-- (`DROP FUNCTION plateforme.fn_creer_collecte(uuid, text, date, time,
-- smallint, boolean, text, text, jsonb, integer)` et
-- `DROP FUNCTION plateforme.fn_ajouter_collecte_evenement(uuid, text, date,
-- time, boolean, text, integer)`) : sinon l'ancienne définition s'ajoute à côté
-- et tout appel sans `p_pax` devient ambigu (« is not unique », mesuré). Puis
-- rejouer les définitions précédentes de fn_creer_collecte
-- (20260708120000), fn_ajouter_collecte_evenement (20260614130000),
-- fn_modifier_collecte (20260915220000), fn_modifier_evenement
-- (20260915140000), fn_set_volume_estime_repas (20260611171638) et des deux
-- fonctions de 20261009210000 ; supprimer les déclencheurs
-- trg_collectes_pax_par_defaut et trg_set_pax_evenement. La colonne
-- `collectes.pax` peut rester (inerte). Les pax d'événement recalculés ne
-- reviennent pas d'eux-mêmes à leur valeur saisie. La migration ne se rejoue
-- pas telle quelle (contrainte et fonctions déjà créées) : la chaîne supabase
-- ne l'applique qu'une fois.
-- =============================================================================

-- ─── 0. Rôle de migration ────────────────────────────────────────────────────
-- `collectes` et `evenements` sont en RLS forcée : la recopie et le recalcul ne
-- voient toutes les lignes que si le rôle contourne la RLS (mesuré le
-- 2026-10-21 : `postgres` a BYPASSRLS sur savr-dev et savr-prod). Sinon les
-- contrôles de fin compteraient sous la même RLS et passeraient à vide.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'rôle % soumis à la RLS : la recopie et le recalcul du pax seraient partiels',
      current_user;
  END IF;
END $$;

-- ─── 1. Colonne et recopie ───────────────────────────────────────────────────
ALTER TABLE plateforme.collectes ADD COLUMN IF NOT EXISTS pax integer;

UPDATE plateforme.collectes c
   SET pax = e.pax
  FROM plateforme.evenements e
 WHERE e.id = c.evenement_id
   AND c.pax IS NULL;

-- Contrôle POSITIF (table en FORCE ROW LEVEL SECURITY : sans BYPASSRLS, l'UPDATE
-- ferait 0 ligne sans erreur) : toutes les collectes portent un pax.
DO $$
DECLARE
  v_total integer;
  v_remplies integer;
BEGIN
  SELECT count(*), count(pax) INTO v_total, v_remplies FROM plateforme.collectes;
  IF v_remplies <> v_total THEN
    RAISE EXCEPTION 'collectes.pax : % collecte(s) sur % sans pax après la recopie',
      v_total - v_remplies, v_total;
  END IF;
END $$;

ALTER TABLE plateforme.collectes ALTER COLUMN pax SET NOT NULL;
-- Plafond métier 100 000 convives par collecte (décision Val 2026-10-21) :
-- la somme des jours d'un événement reste loin de l'entier SQL.
ALTER TABLE plateforme.collectes
  ADD CONSTRAINT collectes_pax_bornes CHECK (pax >= 0 AND pax <= 100000);
-- Défaut 0 = « inconnu » (valeur déjà admise pour la reprise Bubble), posé
-- APRÈS la recopie (sinon les lignes existantes le recevraient avant elle). Il
-- sert les INSERT qui ne déclenchent rien (fixtures de test en
-- session_replication_role = replica) ; sinon trg_collectes_pax_par_defaut
-- remplace 0 ou NULL (point 2 de l'en-tête).
ALTER TABLE plateforme.collectes ALTER COLUMN pax SET DEFAULT 0;

COMMENT ON COLUMN plateforme.collectes.pax IS
  'Nombre de convives de la collecte (décision Val 2026-10-20), saisi avec sa date. Absent ou 0 à l''INSERT : celui de la dernière collecte non annulée de l''événement, sinon celui de l''événement (trg_collectes_pax_par_defaut). 0 = inconnu (reprise Bubble sans pax ; défaut de la colonne). Plafond 100 000 (décision Val 2026-10-21).';

-- ─── 2. Pax absent à l'INSERT : celui de la dernière collecte ──────────────
-- Nom choisi pour passer AVANT trg_set_volume_estime_repas (les déclencheurs
-- BEFORE d'une table se suivent par ordre alphabétique) : le volume lit NEW.pax.
CREATE OR REPLACE FUNCTION plateforme.fn_collectes_pax_par_defaut()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  -- 0 = inconnu (défaut de la colonne) : une saisie vaut toujours au moins 1
  -- (routes, fn_creer_collecte, fn_modifier_collecte) ; seule la reprise Bubble
  -- écrit 0, et son événement porte alors 0 aussi (1 collecte = 1 événement).
  -- Le pax de la dernière collecte connue, pas celui de l'événement : celui-ci
  -- est la somme des jours, il gonflerait à chaque ajout (mesuré : 1 200, puis
  -- 2 400, puis 4 800).
  IF NEW.pax IS NULL OR NEW.pax = 0 THEN
    NEW.pax := NULL;
    SELECT c.pax INTO NEW.pax
      FROM plateforme.collectes c
     WHERE c.evenement_id = NEW.evenement_id
       AND c.statut <> 'annulee'
       AND c.pax > 0
     ORDER BY c.date_collecte DESC, c.heure_collecte DESC, c.created_at DESC
     LIMIT 1;
    IF NEW.pax IS NULL THEN
      SELECT e.pax INTO NEW.pax
        FROM plateforme.evenements e
       WHERE e.id = NEW.evenement_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_collectes_pax_par_defaut()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_collectes_pax_par_defaut ON plateforme.collectes;
CREATE TRIGGER trg_collectes_pax_par_defaut
  BEFORE INSERT ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_collectes_pax_par_defaut();

-- ─── 3. Volume de repas estimé AG : 10 % du pax de la collecte ──────────────
-- Corps de 20260611171638, seule la source du pax change (NEW.pax).
CREATE OR REPLACE FUNCTION plateforme.fn_set_volume_estime_repas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF NEW.type = 'anti_gaspi' AND NEW.statut NOT IN ('realisee','realisee_sans_collecte','cloturee') THEN
    NEW.volume_estime_repas := ROUND(0.10 * COALESCE(NEW.pax, 0));
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. Signal « modifiée après envoi » : le pax de la collecte ─────────────
-- Corps de 20261009210000 ; ajout de la comparaison du pax. La liste reste
-- normative pour le payload E2 (cliquet adapter.e2-repush-champs-propages).
CREATE OR REPLACE FUNCTION plateforme.fn_set_collectes_dirty_tms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF (OLD.date_collecte IS DISTINCT FROM NEW.date_collecte
    OR OLD.heure_collecte IS DISTINCT FROM NEW.heure_collecte
    OR OLD.pax IS DISTINCT FROM NEW.pax
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

-- Événement : les contacts seuls (corps de 20261009210000 sans le pax).
CREATE OR REPLACE FUNCTION plateforme.fn_evenement_marque_collectes_modifiees()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF (OLD.contact_principal_nom IS DISTINCT FROM NEW.contact_principal_nom
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

COMMENT ON FUNCTION plateforme.fn_evenement_marque_collectes_modifiees() IS
  'Arme collectes.dirty_tms pour les collectes déjà parties vers le prestataire et encore à réaliser (programmee, validee, en_cours) quand un contact de leur événement change (arbitrage Val 2026-10-09). Le pax, porté par la collecte depuis le 2026-10-20, est surveillé par fn_set_collectes_dirty_tms. Remis à false par fn_dispatcher_collecte.';

-- ─── 5. Pax de l'événement calculé depuis ses collectes (règle C1) ──────────
-- Pour chaque jour de collecte, le plus grand pax des collectes non annulées de
-- ce jour ; puis la somme des jours. NULL si l'événement n'a aucune collecte
-- non annulée (son pax est alors laissé tel quel).
CREATE OR REPLACE FUNCTION plateforme.f_pax_evenement(p_evenement_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = plateforme, pg_catalog
AS $$
  SELECT sum(j.pax_jour)::integer
    FROM (
      SELECT max(c.pax) AS pax_jour
        FROM plateforme.collectes c
       WHERE c.evenement_id = p_evenement_id
         AND c.statut != 'annulee'
       GROUP BY c.date_collecte
    ) j;
$$;

-- Fonction interne (seul fn_set_pax_evenement l'appelle) : aucun rôle client.
-- service_role l'exécute par les privilèges par défaut du schéma.
REVOKE EXECUTE ON FUNCTION plateforme.f_pax_evenement(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plateforme.f_pax_evenement(uuid) IS
  'Pax d''un événement (décision Val 2026-10-20, C1) : par jour de collecte, le plus grand pax des collectes non annulées, puis la somme des jours. SECURITY INVOKER : lit les collectes sous la RLS de l''appelant.';

-- Jumeau de fn_set_date_evenement (même table, mêmes écrivains, SECURITY
-- INVOKER). Ne recalcule que si l'événement garde au moins une collecte non
-- annulée, et n'écrit que si la valeur change.
-- Verrou de l'événement AVANT le calcul : deux modifications concurrentes de
-- ses collectes se succèdent, et la seconde recalcule avec la première (sans
-- lui, elle écrivait un pax périmé ; mesuré : 1 800 au lieu de 1 300). FOR NO
-- KEY UPDATE et non FOR UPDATE : ce dernier heurte le verrou KEY SHARE que la
-- clé étrangère `collectes.evenement_id` pose sur l'événement à chaque INSERT,
-- et deux créations simultanées sur le même événement s'interbloquaient
-- (mesuré : 9 sur 10 à 8 clients ; 0 avec NO KEY UPDATE). Un UPDATE qui ne
-- change ni le pax, ni la date, ni l'annulation, ni l'événement ne verrouille
-- rien.
CREATE OR REPLACE FUNCTION plateforme.fn_set_pax_evenement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_ids uuid[];
  v_id  uuid;
  v_pax integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.pax IS NOT DISTINCT FROM NEW.pax
     AND OLD.date_collecte IS NOT DISTINCT FROM NEW.date_collecte
     AND (OLD.statut = 'annulee') IS NOT DISTINCT FROM (NEW.statut = 'annulee')
     AND OLD.evenement_id IS NOT DISTINCT FROM NEW.evenement_id THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.evenement_id];
  ELSIF TG_OP = 'UPDATE' AND OLD.evenement_id IS DISTINCT FROM NEW.evenement_id THEN
    v_ids := ARRAY[OLD.evenement_id, NEW.evenement_id];
  ELSE
    v_ids := ARRAY[NEW.evenement_id];
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM plateforme.evenements WHERE id = v_id FOR NO KEY UPDATE;
    v_pax := plateforme.f_pax_evenement(v_id);
    IF v_pax IS NOT NULL THEN
      UPDATE plateforme.evenements e
         SET pax = v_pax,
             updated_at = now()
       WHERE e.id = v_id
         AND e.pax IS DISTINCT FROM v_pax;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_set_pax_evenement()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_set_pax_evenement ON plateforme.collectes;
CREATE TRIGGER trg_set_pax_evenement
  AFTER INSERT OR DELETE OR UPDATE OF pax, date_collecte, statut, evenement_id
  ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_set_pax_evenement();

COMMENT ON COLUMN plateforme.evenements.pax IS
  'Nombre de convives de l''événement, CALCULÉ depuis ses collectes non annulées depuis le 2026-10-20 (f_pax_evenement, déclencheur trg_set_pax_evenement) : par jour, le plus grand pax ; puis la somme des jours. Saisi seulement à la création, en attendant ses collectes.';

-- Recalcul une fois pour tous les événements existants (après la nouvelle
-- définition du déclencheur de l'événement : il ne surveille plus le pax).
UPDATE plateforme.evenements e
   SET pax = plateforme.f_pax_evenement(e.id)
 WHERE plateforme.f_pax_evenement(e.id) IS NOT NULL
   AND e.pax IS DISTINCT FROM plateforme.f_pax_evenement(e.id);

-- Contrôle POSITIF : tout événement qui a une collecte non annulée porte le pax
-- calculé.
DO $$
DECLARE
  v_attendus integer;
  v_conformes integer;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE e.pax = plateforme.f_pax_evenement(e.id))
    INTO v_attendus, v_conformes
    FROM plateforme.evenements e
   WHERE plateforme.f_pax_evenement(e.id) IS NOT NULL;
  IF v_conformes <> v_attendus THEN
    RAISE EXCEPTION 'evenements.pax : % événement(s) sur % sans le pax calculé',
      v_attendus - v_conformes, v_attendus;
  END IF;
END $$;

-- ─── 6. fn_creer_collecte : paramètre p_pax ─────────────────────────────────
-- Corps de 20260708120000 ; ajout de p_pax (DEFAULT NULL = règle du point 2 de
-- l'en-tête, posée par trg_collectes_pax_par_defaut). Signature modifiée → remplacement de
-- la fonction (CREATE OR REPLACE ne change pas une signature), droits reposés.
-- Le payload E1 ne change pas : l'outbox-worker relit la collecte en base.
DROP FUNCTION IF EXISTS plateforme.fn_creer_collecte(
  uuid, text, date, time, smallint, boolean, text, text, jsonb
);

CREATE FUNCTION plateforme.fn_creer_collecte(
  p_evenement_id uuid,
  p_type text,
  p_date_collecte date,
  p_heure_collecte time without time zone,
  p_nb_camions smallint DEFAULT 1,
  p_controle_acces boolean DEFAULT false,
  p_notes text DEFAULT NULL::text,
  p_info_suppl text DEFAULT NULL::text,
  p_lieu_overrides jsonb DEFAULT NULL::jsonb,
  p_pax integer DEFAULT NULL::integer
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_collecte_id    uuid;
  v_type_enum      plateforme.collecte_type;
BEGIN
  -- Normalisation alias courts → valeurs de l'enum (conservée depuis 20260614000004)
  v_type_enum := CASE p_type
    WHEN 'zd'  THEN 'zero_dechet'::plateforme.collecte_type
    WHEN 'ag'  THEN 'anti_gaspi'::plateforme.collecte_type
    ELSE p_type::plateforme.collecte_type
  END;

  IF p_pax IS NOT NULL AND (p_pax < 1 OR p_pax > 100000) THEN
    RAISE EXCEPTION
      'PAX_INVALIDE: le nombre de convives doit être un entier de 1 à 100 000 (reçu %)', p_pax
      USING ERRCODE = 'P0001';
  END IF;

  -- Volume estimé repas AG : posé par trg_set_volume_estime_repas (10 % de
  -- NEW.pax) ; pax NULL = règle du point 2 de l'en-tête (trg_collectes_pax_par_defaut).
  INSERT INTO plateforme.collectes (
    evenement_id, type, date_collecte, heure_collecte,
    nb_camions_demande, controle_acces_requis, notes_internes,
    informations_supplementaires, lieu_overrides, pax,
    statut, statut_tms
  ) VALUES (
    p_evenement_id,
    v_type_enum,
    p_date_collecte,
    p_heure_collecte,
    p_nb_camions,
    p_controle_acces,
    p_notes,
    p_info_suppl,
    p_lieu_overrides,
    p_pax,
    'programmee',
    'non_envoye'
  ) RETURNING id INTO v_collecte_id;

  -- E1 uniquement pour ZD (AG reste non_envoye jusqu'à attribution Admin, module M1.4).
  -- Payload enrichi (PROG-03/PROG-01) : controle_acces_requis + informations_supplementaires
  -- + lieu_overrides, en plus des clés historiques. Contrat E1 §08 l.68 / §06.01 l.396+l.110.
  IF v_type_enum = 'zero_dechet' THEN
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte',
      v_collecte_id,
      'collecte.creee',
      jsonb_build_object(
        'collecte_id',                 v_collecte_id,
        'type',                        v_type_enum::text,
        'date_collecte',               p_date_collecte,
        'controle_acces_requis',       p_controle_acces,
        'informations_supplementaires', p_info_suppl,
        'lieu_overrides',              p_lieu_overrides
      ),
      'adapter_mts1'
    );
  END IF;

  RETURN v_collecte_id;
END;
$function$
;

-- Le service_role (routes Next.js) est le seul appelant autorisé.
REVOKE EXECUTE ON FUNCTION plateforme.fn_creer_collecte(
  uuid, text, date, time, smallint, boolean, text, text, jsonb, integer
) FROM PUBLIC, anon, authenticated;

-- ─── 7. fn_ajouter_collecte_evenement : paramètre p_pax ─────────────────────
-- Corps de 20260614130000 ; ajout de p_pax, transmis à fn_creer_collecte.
DROP FUNCTION IF EXISTS plateforme.fn_ajouter_collecte_evenement(
  uuid, text, date, time, boolean, text
);

CREATE FUNCTION plateforme.fn_ajouter_collecte_evenement(
  p_evenement_id   uuid,
  p_type           text,
  p_date_collecte  date,
  p_heure_collecte time,
  p_controle_acces boolean DEFAULT false,
  p_info_suppl     text    DEFAULT NULL,
  p_pax            integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_collecte_id uuid;
BEGIN
  -- Vérifie que l'événement existe et est éditable
  IF NOT plateforme.f_collecte_editable(p_evenement_id) THEN
    RAISE EXCEPTION 'Événement non éditable (statut terminal)';
  END IF;

  v_collecte_id := plateforme.fn_creer_collecte(
    p_evenement_id   := p_evenement_id,
    p_type           := p_type,
    p_date_collecte  := p_date_collecte,
    p_heure_collecte := p_heure_collecte,
    p_controle_acces := p_controle_acces,
    p_info_suppl     := p_info_suppl,
    p_pax            := p_pax
  );

  RETURN v_collecte_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_ajouter_collecte_evenement(
  uuid, text, date, time, boolean, text, integer
) FROM PUBLIC, anon, authenticated;

-- ─── 8. fn_modifier_collecte : le pax devient modifiable ────────────────────
-- Corps de 20260915220000 ; ajout de la garde du pax et de sa colonne dans
-- l'UPDATE. L'E2 générique (`champs_modifies`) le porte au prestataire.
CREATE OR REPLACE FUNCTION plateforme.fn_modifier_collecte(p_id uuid, p_updates jsonb, p_champs_modifies text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_row            plateforme.collectes;
  v_commandee      boolean;
  v_old_statut     plateforme.collecte_statut;
  v_old_nb_camions smallint;
  v_old_date       date;
  v_old_heure      time;
  v_new_nb_camions smallint;
  v_passe_annulee  boolean;
  v_pax_invalide   boolean;
BEGIN
  -- Row lock + lecture de l'état courant (AVANT UPDATE et INSERT outbox). On lit
  -- aussi nb_camions_demande + date/heure pour les gardes RM-02/RM-05 sous le verrou.
  SELECT statut, nb_camions_demande, date_collecte, heure_collecte
  INTO   v_old_statut, v_old_nb_camions, v_old_date, v_old_heure
  FROM plateforme.collectes
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- ── RM-02 : nb_camions_demande interdit hors (programmee, validee, en_cours) ──
  -- Jamais de régression d'un état terminal (§05 l.271, CLAUDE.md §4). Un camion
  -- après coup sur un statut terminal = flux incident Admin, pas une modif de N.
  IF p_updates ? 'nb_camions_demande'
     AND v_old_statut NOT IN ('programmee', 'validee', 'en_cours') THEN
    RAISE EXCEPTION
      'NB_CAMIONS_STATUT_TERMINAL: nb_camions_demande non modifiable au statut % (jamais de régression d''un état terminal)',
      v_old_statut USING ERRCODE = 'P0001';
  END IF;

  -- ── RM-05 : réduction de N bloquée à moins d'1h de la mission ────────────────
  -- date/heure sont des wall-clocks naïfs → AT TIME ZONE 'Europe/Paris' (bug E2).
  IF p_updates ? 'nb_camions_demande' THEN
    v_new_nb_camions := (p_updates->>'nb_camions_demande')::smallint;
    -- Garde de domaine : au moins 1 camion (la colonne n'a pas de CHECK >= 1).
    -- Évite une donnée absurde (0 camion) ET un faux positif RM-05 (0 < N_old).
    IF v_new_nb_camions < 1 THEN
      RAISE EXCEPTION
        'NB_CAMIONS_INVALIDE: nb_camions_demande doit être >= 1 (reçu %)', v_new_nb_camions
        USING ERRCODE = 'P0001';
    END IF;
    IF v_new_nb_camions < COALESCE(v_old_nb_camions, 1)
       AND (((v_old_date + COALESCE(v_old_heure, '00:00:00'::time))
              AT TIME ZONE 'Europe/Paris') - interval '1 hour') <= now() THEN
      RAISE EXCEPTION
        'REDUCTION_CANCEL_WINDOW_CLOSED: réduction du nombre de camions bloquée à moins d''1h avant la mission'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── Pax de la collecte (décision Val 2026-10-20) : entier de 1 à 100 000 ───
  -- La colonne admet 0 (reprise Bubble sans pax) ; une modification, jamais.
  -- CASE (et non OR) : l'ordre d'évaluation d'un OR n'est pas garanti en SQL, et
  -- le cast d'une valeur non numérique sortirait en 22P02 au lieu de ce refus.
  -- Calculé à part : dans un IF, PL/pgSQL couperait la condition au THEN du CASE.
  v_pax_invalide := CASE WHEN jsonb_typeof(p_updates->'pax') = 'number'
                         THEN (p_updates->>'pax')::numeric < 1
                           OR (p_updates->>'pax')::numeric > 100000
                           OR (p_updates->>'pax')::numeric <> trunc((p_updates->>'pax')::numeric)
                         ELSE true
                    END;
  IF p_updates ? 'pax' AND v_pax_invalide THEN
    RAISE EXCEPTION
      'PAX_INVALIDE: le nombre de convives doit être un entier de 1 à 100 000 (reçu %)', p_updates->'pax'
      USING ERRCODE = 'P0001';
  END IF;

  -- UPDATE avec CASE WHEN pour honorer les mises à null explicites
  UPDATE plateforme.collectes c SET
    date_collecte = CASE WHEN p_updates ? 'date_collecte'
      THEN (p_updates->>'date_collecte')::date ELSE c.date_collecte END,
    heure_collecte = CASE WHEN p_updates ? 'heure_collecte'
      THEN (p_updates->>'heure_collecte')::time ELSE c.heure_collecte END,
    nb_camions_demande = CASE WHEN p_updates ? 'nb_camions_demande'
      THEN (p_updates->>'nb_camions_demande')::smallint ELSE c.nb_camions_demande END,
    pax = CASE WHEN p_updates ? 'pax'
      THEN (p_updates->>'pax')::integer ELSE c.pax END,
    controle_acces_requis = CASE WHEN p_updates ? 'controle_acces_requis'
      THEN (p_updates->>'controle_acces_requis')::boolean ELSE c.controle_acces_requis END,
    notes_internes = CASE WHEN p_updates ? 'notes_internes'
      THEN p_updates->>'notes_internes' ELSE c.notes_internes END,
    informations_supplementaires = CASE WHEN p_updates ? 'informations_supplementaires'
      THEN p_updates->>'informations_supplementaires' ELSE c.informations_supplementaires END,
    prestataire_logistique_id = CASE WHEN p_updates ? 'prestataire_logistique_id'
      THEN (p_updates->>'prestataire_logistique_id')::uuid ELSE c.prestataire_logistique_id END,
    motif_override_prestataire = CASE WHEN p_updates ? 'motif_override_prestataire'
      THEN p_updates->>'motif_override_prestataire' ELSE c.motif_override_prestataire END,
    statut = CASE WHEN p_updates ? 'statut'
      THEN (p_updates->>'statut')::plateforme.collecte_statut ELSE c.statut END,
    annulee_cote_savr = CASE WHEN p_updates ? 'annulee_cote_savr'
      THEN (p_updates->>'annulee_cote_savr')::boolean ELSE c.annulee_cote_savr END,
    annulee_cote_savr_motif = CASE WHEN p_updates ? 'annulee_cote_savr_motif'
      THEN p_updates->>'annulee_cote_savr_motif' ELSE c.annulee_cote_savr_motif END,
    lieu_overrides = CASE WHEN p_updates ? 'lieu_overrides'
      THEN p_updates->'lieu_overrides' ELSE c.lieu_overrides END,
    -- RM-09 : champs incident (flux collecte manquée / imputabilité §05 §4bis)
    incident_imputable_a = CASE WHEN p_updates ? 'incident_imputable_a'
      THEN (p_updates->>'incident_imputable_a')::plateforme.incident_imputable ELSE c.incident_imputable_a END,
    motif_incident = CASE WHEN p_updates ? 'motif_incident'
      THEN p_updates->>'motif_incident' ELSE c.motif_incident END,
    collecte_remplacee_id = CASE WHEN p_updates ? 'collecte_remplacee_id'
      THEN (p_updates->>'collecte_remplacee_id')::uuid ELSE c.collecte_remplacee_id END,
    updated_at = now()
  WHERE c.id = p_id
  RETURNING * INTO v_row;

  -- Gate E2 : « une commande existe deja chez le prestataire CIBLE ». Lu sous le
  -- verrou de l'agregat (pris en tete), et APRES l'UPDATE : le patch peut changer
  -- `prestataire_logistique_id`, auquel cas la question porte sur le nouveau.
  v_commandee := plateforme.fn_collecte_commandee_chez_provider(p_id);

  -- Transition vers 'annulee' (miroir exact de l'ex-trigger trg_collecte_annulee_e3).
  v_passe_annulee := (p_updates ? 'statut'
                      AND p_updates->>'statut' = 'annulee'
                      AND v_old_statut <> 'annulee');

  -- Outbox E2 si une commande existe chez le prestataire — jamais quand le patch
  -- pose statut='annulee' (E3 prend le relais — condition originale conservée).
  IF v_commandee
     AND NOT (p_updates ? 'statut' AND p_updates->>'statut' = 'annulee')
  THEN
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte',
      p_id,
      'collecte.modifiee',
      jsonb_build_object(
        'collecte_id',    p_id,
        'champs_modifies', to_jsonb(p_champs_modifies)
      ),
      'adapter_mts1'
    );
  END IF;

  -- E3 collecte.annulee émise INLINE (pattern RPC, plus de trigger).
  IF v_passe_annulee THEN
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte',
      p_id,
      'collecte.annulee',
      jsonb_build_object('collecte_id', p_id, 'type', v_row.type::text),
      'adapter_mts1'
    );
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_modifier_collecte(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_modifier_collecte(uuid, jsonb, text[]) TO service_role;

-- ─── 9. fn_modifier_evenement : le pax n'est plus un champ de l'événement ──
-- Corps de 20260915140000 ; le pax est refusé (PAX_SUR_COLLECTE), retiré de
-- l'UPDATE, du set TMS-pertinent et du recalcul du volume AG (porté par la
-- collecte).
CREATE OR REPLACE FUNCTION plateforme.fn_modifier_evenement(
  p_id              uuid,
  p_updates         jsonb,
  p_champs_modifies text[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_evt          plateforme.evenements;
  v_tms_pertinent boolean;
  v_c            record;
BEGIN
  -- Le pax n'est plus un champ de l'événement (décision Val 2026-10-20) : il se
  -- modifie sur chaque collecte (fn_modifier_collecte), et le pax de l'événement
  -- en est calculé (fn_set_pax_evenement). Refus explicite plutôt qu'ignoré.
  IF p_updates ? 'pax' THEN
    RAISE EXCEPTION
      'PAX_SUR_COLLECTE: le nombre de convives se modifie sur chaque collecte'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 1. UPDATE événement (whitelist via CASE WHEN — honore les mises à null) ──
  -- lieu_id et type_evenement n'incluent PAS lieu_id verrouillé (§05 l.314 / §06.04
  -- l.459) : changer le lieu = annuler + reprogrammer. organisation_id /
  -- traiteur_operationnel / entite_facturation : immuables (jamais exposés).
  -- lieu_id / date_evenement : exposés UNIQUEMENT au back-office Admin (route
  -- admin/evenements). La route programmation/ bloque lieu_id (EVENT_LOCKED_FIELDS).
  -- lieu_id n'est PAS dans le set TMS-pertinent → un changement de lieu n'émet jamais
  -- de PATCH lieu_id (interdit §08 l.158 ; flux normal = annuler + reprogrammer).
  UPDATE plateforme.evenements e SET
    nom_evenement = CASE WHEN p_updates ? 'nom_evenement'
      THEN p_updates->>'nom_evenement' ELSE e.nom_evenement END,
    lieu_id = CASE WHEN p_updates ? 'lieu_id'
      THEN (p_updates->>'lieu_id')::uuid ELSE e.lieu_id END,
    date_evenement = CASE WHEN p_updates ? 'date_evenement'
      THEN (p_updates->>'date_evenement')::date ELSE e.date_evenement END,
    type_evenement_id = CASE WHEN p_updates ? 'type_evenement_id'
      THEN (p_updates->>'type_evenement_id')::uuid ELSE e.type_evenement_id END,
    contact_principal_nom = CASE WHEN p_updates ? 'contact_principal_nom'
      THEN p_updates->>'contact_principal_nom' ELSE e.contact_principal_nom END,
    contact_principal_telephone = CASE WHEN p_updates ? 'contact_principal_telephone'
      THEN p_updates->>'contact_principal_telephone' ELSE e.contact_principal_telephone END,
    contact_secours_nom = CASE WHEN p_updates ? 'contact_secours_nom'
      THEN p_updates->>'contact_secours_nom' ELSE e.contact_secours_nom END,
    contact_secours_telephone = CASE WHEN p_updates ? 'contact_secours_telephone'
      THEN p_updates->>'contact_secours_telephone' ELSE e.contact_secours_telephone END,
    nom_client_organisateur = CASE WHEN p_updates ? 'nom_client_organisateur'
      THEN p_updates->>'nom_client_organisateur' ELSE e.nom_client_organisateur END,
    logo_client_organisateur_url = CASE WHEN p_updates ? 'logo_client_organisateur_url'
      THEN p_updates->>'logo_client_organisateur_url' ELSE e.logo_client_organisateur_url END,
    client_organisateur_organisation_id = CASE WHEN p_updates ? 'client_organisateur_organisation_id'
      THEN (p_updates->>'client_organisateur_organisation_id')::uuid ELSE e.client_organisateur_organisation_id END,
    reference_affaire = CASE WHEN p_updates ? 'reference_affaire'
      THEN p_updates->>'reference_affaire' ELSE e.reference_affaire END,
    notes_internes = CASE WHEN p_updates ? 'notes_internes'
      THEN p_updates->>'notes_internes' ELSE e.notes_internes END,
    updated_at = now()
  WHERE e.id = p_id
  RETURNING * INTO v_evt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evenement_introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- TMS ne persiste de l'événement que les contacts (§08 l.156/l.411) ; le pax
  -- est désormais porté par la collecte (E2 de fn_modifier_collecte). Les autres
  -- champs (nom, type d'événement, notes, référence affaire) sont diffés mais
  -- ignorés côté TMS → inutile de réveiller l'outbox pour eux.
  v_tms_pertinent := p_champs_modifies && ARRAY[
    'contact_principal_nom', 'contact_principal_telephone',
    'contact_secours_nom', 'contact_secours_telephone'
  ]::text[];

  -- ── 2. Par collecte ACTIVE de l'événement (R22c : programmee/validee/en_cours) ──
  -- lock (FOR UPDATE) AVANT toute écriture/INSERT outbox → ordering seq intra-agrégat.
  -- `en_cours` ajouté (R22c/BL-P2-10, Val 2026-07-08) : une édition Admin de contact
  -- sur une collecte en cours d'exécution doit aussi être poussée au TMS. Les états
  -- terminaux (realisee, realisee_sans_collecte, cloturee, rejetee_par_prestataire)
  -- restent exclus — rien à mettre à jour sur une collecte terminée.
  FOR v_c IN
    SELECT id, type
    FROM plateforme.collectes
    WHERE evenement_id = p_id
      AND statut IN ('programmee', 'validee', 'en_cours')
    ORDER BY id
    FOR UPDATE
  LOOP
    -- E2 collecte.modifiee si une commande existe chez le prestataire ET champ
    -- TMS-pertinent changé. Le gate est lu sous le verrou de la collecte (FOR
    -- UPDATE de la boucle), jamais avant — ordering seq intra-agrégat.
    IF plateforme.fn_collecte_commandee_chez_provider(v_c.id) AND v_tms_pertinent THEN
      INSERT INTO plateforme.outbox_events (
        aggregate_type, aggregate_id, event_type, payload, consumer
      ) VALUES (
        'collecte',
        v_c.id,
        'collecte.modifiee',
        jsonb_build_object(
          'collecte_id',     v_c.id,
          'champs_modifies', to_jsonb(p_champs_modifies),
          'source',          'evenement'
        ),
        'adapter_mts1'
      );
    END IF;
  END LOOP;

  RETURN to_jsonb(v_evt);
END;
$function$
;

REVOKE EXECUTE ON FUNCTION plateforme.fn_modifier_evenement(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_modifier_evenement(uuid, jsonb, text[]) TO service_role;
