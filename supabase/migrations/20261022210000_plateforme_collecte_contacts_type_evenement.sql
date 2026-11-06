-- =============================================================================
-- Refonte du formulaire, lot A : type d'événement et contacts portés par
-- chaque collecte (décisions Val 2026-10-22, C1 et C2)
-- =============================================================================
-- DEMANDE : chaque collecte d'un événement porte son type d'événement et ses
-- contacts (formulaire refondu : une carte par collecte). Lot A = le rangement
-- en base, sans aucun changement visible : aujourd'hui toutes les collectes
-- d'un événement ont le type et les contacts de l'événement, et c'est ce que
-- la reprise ci-dessous leur donne.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. `collectes.type_evenement_id` (FK types_evenements, nullable : les
--      fixtures de test insèrent hors déclencheurs) ; reprise depuis
--      l'événement, contrôle positif ; un INSERT sans type prend celui de
--      l'événement (trg_collectes_type_evenement_par_defaut).
--   2. Table `collecte_contacts` (1–1 avec collectes) : contact principal et
--      contact de secours de LA collecte, mêmes bornes que ceux de l'événement.
--      Table à part (C2) : la RLS de `collectes` laisse lire toute la ligne à
--      tout rôle qui voit la collecte, dont le gestionnaire de lieux et le
--      client organisateur ; `evenements` cache ses contacts par une liste
--      blanche de colonnes (20261001103000). Ici : RLS activée et forcée, une
--      seule policy, qui refuse tout (USING false : règle « au moins une policy
--      par table », rls_0_4_smoke T43), aucun droit à anon / authenticated /
--      PUBLIC, service_role seul (il contourne la RLS).
--      Reprise depuis l'événement, contrôle positif ; un INSERT de collecte
--      crée sa ligne avec les contacts de l'événement
--      (trg_collecte_contacts_par_defaut).
--   3. `fn_modifier_evenement` (corps de 20261021073000) : une modification du
--      type ou des contacts au niveau de l'événement est recopiée sur toutes
--      ses collectes (transition : les écrans les modifient encore à ce
--      niveau). Le reste est inchangé, dont l'E2 des collectes actives
--      commandées sur un changement de contact.
--
-- L'envoi aux transporteurs lit désormais les contacts de la collecte
-- (packages/adapters/src/outbox-worker.ts) : la migration passe AVANT le code.
--
-- ACCÈS : aucun droit ouvert. Table nouvelle fermée aux rôles clients (REVOKE
-- explicite, policy qui refuse tout). Les deux fonctions de déclencheur nouvelles
-- retirent l'exécution à PUBLIC, anon et authenticated. fn_modifier_evenement
-- (SECURITY DEFINER) est remplacée par CREATE OR REPLACE, même signature ;
-- REVOKE et GRANT service_role rejoués. La colonne `collectes.type_evenement_id`
-- suit le SELECT de `collectes` : elle reprend une valeur que les mêmes
-- lecteurs lisent déjà sur l'événement (liste blanche de `evenements`).
--
-- ROLLBACK : rejouer fn_modifier_evenement de 20261021073000 ; supprimer les
-- déclencheurs trg_collectes_type_evenement_par_defaut et
-- trg_collecte_contacts_par_defaut, leurs fonctions, la table
-- collecte_contacts et la colonne collectes.type_evenement_id (après avoir
-- remis l'envoi aux transporteurs sur les contacts de l'événement).
-- =============================================================================

-- ─── 0. Rôle de migration ────────────────────────────────────────────────────
-- `collectes` et `evenements` sont en RLS forcée : la reprise ne voit toutes les
-- lignes que si le rôle contourne la RLS (même garde que 20261021073000).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'rôle % soumis à la RLS : la reprise des collectes serait partielle',
      current_user;
  END IF;
END $$;

-- ─── 1. collectes.type_evenement_id ──────────────────────────────────────────
ALTER TABLE plateforme.collectes
  ADD COLUMN IF NOT EXISTS type_evenement_id uuid
  REFERENCES plateforme.types_evenements(id);

UPDATE plateforme.collectes c
   SET type_evenement_id = e.type_evenement_id
  FROM plateforme.evenements e
 WHERE e.id = c.evenement_id
   AND c.type_evenement_id IS NULL;

DO $$
DECLARE
  v_total integer;
  v_remplies integer;
BEGIN
  SELECT count(*), count(type_evenement_id) INTO v_total, v_remplies
    FROM plateforme.collectes;
  IF v_remplies <> v_total THEN
    RAISE EXCEPTION 'collectes.type_evenement_id : % collecte(s) sur % sans type après la reprise',
      v_total - v_remplies, v_total;
  END IF;
END $$;

COMMENT ON COLUMN plateforme.collectes.type_evenement_id IS
  'Type d''événement (format de service) de LA collecte (refonte Val 2026-10-22, C1). Absent à l''INSERT : celui de l''événement (trg_collectes_type_evenement_par_defaut). evenements.type_evenement_id garde celui de la collecte n°1 pendant la transition.';

CREATE OR REPLACE FUNCTION plateforme.fn_collectes_type_evenement_par_defaut()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF NEW.type_evenement_id IS NULL THEN
    SELECT e.type_evenement_id INTO NEW.type_evenement_id
      FROM plateforme.evenements e
     WHERE e.id = NEW.evenement_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_collectes_type_evenement_par_defaut()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_collectes_type_evenement_par_defaut ON plateforme.collectes;
CREATE TRIGGER trg_collectes_type_evenement_par_defaut
  BEFORE INSERT ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_collectes_type_evenement_par_defaut();

-- ─── 2. collecte_contacts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plateforme.collecte_contacts (
  collecte_id                 uuid PRIMARY KEY
                              REFERENCES plateforme.collectes(id) ON DELETE CASCADE,
  contact_principal_nom       text NOT NULL,
  contact_principal_telephone text NOT NULL,
  contact_secours_nom         text,
  contact_secours_telephone   text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  -- Mêmes bornes que les contacts de l'événement (20260915180000,
  -- 20260915190000 ; miroir de BORNES_TEXTE_LIBRE) : ces valeurs partent au
  -- transporteur (contact natif de la commande, commentaire).
  CONSTRAINT chk_collecte_contacts_principal_nom_borne CHECK (
    length(contact_principal_nom) <= 120
    AND contact_principal_nom !~ '[[:cntrl:]]'
    AND btrim(contact_principal_nom) <> ''
  ),
  CONSTRAINT chk_collecte_contacts_principal_telephone_borne CHECK (
    length(contact_principal_telephone) <= 40
    AND contact_principal_telephone !~ '[[:cntrl:]]'
    AND btrim(contact_principal_telephone) <> ''
  ),
  CONSTRAINT chk_collecte_contacts_secours_nom_borne CHECK (
    contact_secours_nom IS NULL
    OR (length(contact_secours_nom) <= 120 AND contact_secours_nom !~ '[[:cntrl:]]')
  ),
  CONSTRAINT chk_collecte_contacts_secours_telephone_borne CHECK (
    contact_secours_telephone IS NULL
    OR (length(contact_secours_telephone) <= 40 AND contact_secours_telephone !~ '[[:cntrl:]]')
  )
);

ALTER TABLE plateforme.collecte_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plateforme.collecte_contacts FORCE ROW LEVEL SECURITY;
-- Une seule policy, qui ne laisse rien passer : seul un rôle qui contourne la
-- RLS (service_role) lit et écrit. Elle n'ouvre rien : aucun droit de table
-- n'est accordé aux rôles clients.
DROP POLICY IF EXISTS collecte_contacts_ferme ON plateforme.collecte_contacts;
CREATE POLICY collecte_contacts_ferme ON plateforme.collecte_contacts
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON plateforme.collecte_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON plateforme.collecte_contacts TO service_role;

COMMENT ON TABLE plateforme.collecte_contacts IS
  'Contacts sur place d''UNE collecte (refonte Val 2026-10-22, C1–C2), lus par l''envoi aux transporteurs. Fermée aux rôles clients (policy qui refuse tout, aucun droit) : la RLS de collectes laisserait lire la ligne entière à tout rôle qui voit la collecte. Servie par les routes (service_role) selon les règles des contacts de l''événement (§09, arbitrages C2 et C5 du 2026-10-01).';

INSERT INTO plateforme.collecte_contacts (
  collecte_id, contact_principal_nom, contact_principal_telephone,
  contact_secours_nom, contact_secours_telephone
)
SELECT c.id, e.contact_principal_nom, e.contact_principal_telephone,
       e.contact_secours_nom, e.contact_secours_telephone
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
ON CONFLICT (collecte_id) DO NOTHING;

DO $$
DECLARE
  v_collectes integer;
  v_contacts integer;
BEGIN
  SELECT count(*) INTO v_collectes FROM plateforme.collectes;
  SELECT count(*) INTO v_contacts
    FROM plateforme.collectes c
    JOIN plateforme.collecte_contacts cc ON cc.collecte_id = c.id;
  IF v_contacts <> v_collectes THEN
    RAISE EXCEPTION 'collecte_contacts : % collecte(s) sur % sans contacts après la reprise',
      v_collectes - v_contacts, v_collectes;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION plateforme.fn_collecte_contacts_par_defaut()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  INSERT INTO plateforme.collecte_contacts (
    collecte_id, contact_principal_nom, contact_principal_telephone,
    contact_secours_nom, contact_secours_telephone
  )
  SELECT NEW.id, e.contact_principal_nom, e.contact_principal_telephone,
         e.contact_secours_nom, e.contact_secours_telephone
    FROM plateforme.evenements e
   WHERE e.id = NEW.evenement_id
  ON CONFLICT (collecte_id) DO NOTHING;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_collecte_contacts_par_defaut()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_collecte_contacts_par_defaut ON plateforme.collectes;
CREATE TRIGGER trg_collecte_contacts_par_defaut
  AFTER INSERT ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_collecte_contacts_par_defaut();

-- ─── 3. fn_modifier_evenement : recopie sur les collectes ───────────────────
-- Corps de 20261021073000, bloc « Transition » ajouté après l'UPDATE.
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

  -- ── Transition (refonte Val 2026-10-22, lot A) ────────────────────────────
  -- Le type d'événement et les contacts sont portés par chaque collecte
  -- (collectes.type_evenement_id, collecte_contacts) ; l'événement en garde une
  -- copie. Tant que les écrans les modifient au niveau de l'événement, une
  -- modification ici vaut pour TOUTES ses collectes, comme avant la refonte (un
  -- contact et un type pour toutes). Recopie faite ici, jamais par trigger : une
  -- future synchronisation collecte n°1 → événement ne doit pas redescendre
  -- écraser les valeurs propres des autres collectes.
  IF p_updates ?| ARRAY['contact_principal_nom', 'contact_principal_telephone',
                        'contact_secours_nom', 'contact_secours_telephone'] THEN
    UPDATE plateforme.collecte_contacts cc SET
      contact_principal_nom       = v_evt.contact_principal_nom,
      contact_principal_telephone = v_evt.contact_principal_telephone,
      contact_secours_nom         = v_evt.contact_secours_nom,
      contact_secours_telephone   = v_evt.contact_secours_telephone,
      updated_at                  = now()
      FROM plateforme.collectes c
     WHERE c.id = cc.collecte_id
       AND c.evenement_id = p_id;
  END IF;

  IF p_updates ? 'type_evenement_id' THEN
    UPDATE plateforme.collectes c
       SET type_evenement_id = v_evt.type_evenement_id
     WHERE c.evenement_id = p_id
       AND c.type_evenement_id IS DISTINCT FROM v_evt.type_evenement_id;
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
