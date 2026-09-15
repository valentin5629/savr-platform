-- =============================================================================
-- Garde-fou 4 TMS-Ready — pattern transactional outbox : 1 event par mutation
-- =============================================================================
-- Verifie que chaque mutation metier critique ecrit sa ligne
-- plateforme.outbox_events DANS LA MEME TRANSACTION (zero perte, zero orphelin) :
--   E1 collecte.creee | E2 collecte.modifiee | E3 collecte.annulee
--   E5 lieu.champ_critique_modifie
--
-- Pourquoi pgTAP (et pas Vitest) : l'emission vit au niveau DB (RPC metier
-- SECURITY DEFINER pour E1/E2/E3, trigger pour E5 ; cf. 04 - Data Model). Seul le
-- niveau DB peut prouver l'atomicite "meme transaction + rollback" — le client
-- Supabase auto-commit chaque statement et ne peut donc pas la demontrer.
--
-- AUTO-ACTIVATION (decision Val 2026-06-08) : tant que plateforme.outbox_events
-- ou les helpers de fixture n'existent pas (repo squelette), le test s'auto-skippe
-- (6 skips, plan respecte) → CI VERTE. Des que la table + le trigger + les helpers
-- sont crees, le test devient BLOQUANT automatiquement, sans intervention.
--
-- CONTRAT DES HELPERS DE FIXTURE (a fournir cote implementation — cf. 05 - Fixtures) :
--   tests.outbox_fixture_collecte(p_type text) RETURNS uuid
--       Insere une collecte minimale valide (toutes FK/NOT NULL satisfaites) du
--       type 'zd'|'ag', et RETOURNE son id. Encapsule les colonnes obligatoires
--       → le test reste stable si le data model evolue.
--       Modele d'emission acte (Val 2026-06-08, cf. 04 - Data Model) : E1/E2/E3
--         emis par les RPC metier (soumission/renvoi/annulation), E5 par trigger
--         lieux. L'edition brute d'un champ collecte ne fait que dirty_tms=true.
--       ⚠ Le helper monte l'etat POST-DISPATCH (une tournee portant
--         `external_ref_commande`, liee par `collecte_tournees`) mais N'EMET AUCUN
--         event de dispatch, et ne pose PAS `collectes.tms_reference` : le seul
--         event qu'il ecrit est le E1 de fn_creer_collecte. C'est au test de
--         provoquer E2 lui-meme via la RPC metier.
--         Historique (corrige le 2026-09-15) : le helper posait `tms_reference` a
--         la main puis appelait fn_dispatcher_collecte, si bien que l'assertion E2
--         ci-dessous comptait l'event du DISPATCH. Elle etait donc verte alors que
--         le predicat d'emission E2 etait TOUJOURS faux en production (la colonne
--         n'est ecrite par aucun code applicatif). Ne jamais reintroduire une
--         fixture qui pose a la main la valeur dont depend l'assertion.
--   tests.outbox_fixture_lieu() RETURNS uuid
--       Insere un lieu minimal valide et RETOURNE son id.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Permet de DEFINIR nos helpers de test meme si les tables metier n'existent pas
-- encore (repo squelette) : les references de tables dans les corps plpgsql ne
-- sont resolues qu'a l'execution, et on RETURN avant d'y toucher quand non-pret.
SET check_function_bodies = off;

CREATE SCHEMA IF NOT EXISTS tests;

-- Tout est-il implemente ? (table outbox + helpers de fixture)
CREATE OR REPLACE FUNCTION tests._outbox_ready() RETURNS boolean
LANGUAGE sql AS $$
  SELECT to_regclass('plateforme.outbox_events') IS NOT NULL
     AND to_regprocedure('tests.outbox_fixture_collecte(text)') IS NOT NULL
     AND to_regprocedure('tests.outbox_fixture_lieu()') IS NOT NULL;
$$;

-- Les 6 assertions reelles. Renvoie 0 ligne tant que le harnais est dormant
-- (les skips sont alors emis par l'appelant) → le plan reste a 6 dans tous les cas.
CREATE OR REPLACE FUNCTION tests._run_outbox_checks() RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE
  v_coll   uuid;
  v_lieu   uuid;
  v_before bigint;
BEGIN
  IF NOT tests._outbox_ready() THEN
    RETURN;  -- dormant : aucune ligne (l'appelant emet les skips)
  END IF;

  -- E1 — collecte.creee : l'INSERT collecte ecrit 1 event dans SA transaction.
  v_coll := tests.outbox_fixture_collecte('zd');
  RETURN NEXT is(
    (SELECT count(*) FROM plateforme.outbox_events
       WHERE aggregate_id = v_coll AND event_type = 'collecte.creee')::bigint,
    1::bigint,
    'E1 collecte.creee : 1 event ecrit dans la transaction de l''INSERT collecte');

  -- E2 — collecte.modifiee : sur collecte DEJA COMMANDEE chez le prestataire, la
  -- modif d'un champ critique emet 1 event. Passe par la RPC metier : un UPDATE
  -- brut ne pose que dirty_tms et n'emet RIEN (modele d'emission par RPC, cf.
  -- en-tete). L'ancienne version de ce bloc faisait justement cet UPDATE brut et
  -- comptait l'event qu'un dispatch cache dans le helper avait laisse — d'ou une
  -- assertion verte sans rapport avec ce qu'elle annonce.
  PERFORM plateforme.fn_modifier_collecte(
    v_coll,
    jsonb_build_object('date_collecte', (CURRENT_DATE + 31)::text),
    ARRAY['date_collecte']);
  RETURN NEXT is(
    (SELECT count(*) FROM plateforme.outbox_events
       WHERE aggregate_id = v_coll AND event_type = 'collecte.modifiee')::bigint,
    1::bigint,
    'E2 collecte.modifiee : 1 event ecrit a la modif d''un champ critique');

  -- E3 — collecte.annulee : l'annulation passe par la RPC metier fn_modifier_collecte
  -- (BL-P2-36 : event collecte emis INLINE par la RPC, plus par un trigger AFTER
  -- UPDATE — pattern interdit). Conforme a l'en-tete de ce fichier (E1/E2/E3 emis
  -- par les RPC metier). Un UPDATE brut ne doit PLUS emettre E3.
  PERFORM plateforme.fn_modifier_collecte(
    v_coll,
    jsonb_build_object('statut', 'annulee'),
    ARRAY['statut']);
  RETURN NEXT is(
    (SELECT count(*) FROM plateforme.outbox_events
       WHERE aggregate_id = v_coll AND event_type = 'collecte.annulee')::bigint,
    1::bigint,
    'E3 collecte.annulee : 1 event ecrit a l''annulation (RPC fn_modifier_collecte, pas trigger)');

  -- E5 — lieu.champ_critique_modifie : modif adresse (champ critique) → 1 event.
  v_lieu := tests.outbox_fixture_lieu();
  UPDATE plateforme.lieux
     SET adresse_acces = coalesce(adresse_acces, '') || ' (modif test)'
   WHERE id = v_lieu;
  RETURN NEXT is(
    (SELECT count(*) FROM plateforme.outbox_events
       WHERE aggregate_id = v_lieu AND event_type = 'lieu.champ_critique_modifie')::bigint,
    1::bigint,
    'E5 lieu.champ_critique_modifie : 1 event ecrit a la modif adresse');

  -- Atomicite collecte : "pas d'event sans mutation". Si la mutation est rollback
  -- (sous-transaction via bloc EXCEPTION), son event part avec elle → 0 orphelin.
  v_before := (SELECT count(*) FROM plateforme.outbox_events);
  BEGIN
    PERFORM tests.outbox_fixture_collecte('zd');  -- la soumission ecrit l'event...
    RAISE EXCEPTION 'rollback_probe';              -- ...puis on annule toute la sous-txn
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEXT is(
    (SELECT count(*) FROM plateforme.outbox_events)::bigint,
    v_before,
    'Atomicite collecte : rollback de la mutation → 0 event orphelin (meme transaction)');

  -- Atomicite lieu : idem cote lieu (UPDATE champ critique rollback).
  v_lieu := tests.outbox_fixture_lieu();
  v_before := (SELECT count(*) FROM plateforme.outbox_events);
  BEGIN
    UPDATE plateforme.lieux
       SET adresse_acces = coalesce(adresse_acces, '') || ' (rb test)'
     WHERE id = v_lieu;
    RAISE EXCEPTION 'rollback_probe';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEXT is(
    (SELECT count(*) FROM plateforme.outbox_events)::bigint,
    v_before,
    'Atomicite lieu : rollback de la mutation → 0 event orphelin (meme transaction)');

  RETURN;
END;
$$;

-- ------------------------------------------------------------------ plan : 6
SELECT plan(6);

-- Dormant (repo non encore implemente) → 6 skips, le plan reste satisfait.
SELECT skip(
  'Garde-fou 4 dormant : plateforme.outbox_events ou helpers de fixture absents (repo non encore implemente).',
  6)
  FROM (SELECT 1) AS g
 WHERE NOT tests._outbox_ready();

-- Actif (table + trigger + helpers presents) → 6 assertions reelles bloquantes.
SELECT * FROM tests._run_outbox_checks();

SELECT * FROM finish();
ROLLBACK;
