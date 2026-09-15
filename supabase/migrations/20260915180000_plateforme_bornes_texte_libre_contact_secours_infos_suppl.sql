-- =============================================================================
-- Bornes d'ENTRÉE de trois champs texte libre destinés au transporteur
--   plateforme.evenements.contact_secours_nom        (<= 120 car.)
--   plateforme.evenements.contact_secours_telephone  (<=  40 car.)
--   plateforme.collectes.informations_supplementaires (<= 1000 car., §08 E1)
-- =============================================================================
-- Prolongement de #308 (validation d'entrée de `lieu_overrides`) et de #312 (son
-- volet base). Même défaut, trois autres colonnes : des `text` SANS aucune
-- contrainte — 5 000 caractères acceptés, mesuré — que les routes d'écriture ne
-- filtraient que par une allowlist de CLÉS, jamais sur la valeur.
--
-- Pourquoi ces trois colonnes et pas « les colonnes text » en général : elles
-- partent au transporteur. Relevé sur le code d'émission des adapters, pas déduit
-- du nom des colonnes :
--   · `informations_supplementaires` ET `contact_secours_nom` transitent par le
--     canal de TEXTE LIBRE, agrégé par `composerInformationsSupplementaires`, où
--     les informations d'exploitation sont concaténées en un seul message. Une
--     valeur démesurée y évince les lignes voisines — et le nom de secours OUVRE
--     l'agrégat, donc il évince tout ce qui suit, adresse d'accès comprise ; un
--     nom multiligne y forge une fausse ligne d'en-tête ;
--   · `contact_secours_telephone` part dans un champ NATIF de la commande : pas
--     d'éviction possible, mais un numéro de 5 000 caractères reste une donnée
--     aberrante transmise telle quelle.
--
-- Le correctif porte à deux niveaux, et celui-ci est le second :
--   1. ÉCRITURE applicative — `validerChampsTexteLibre`
--      (packages/plateforme/src/lib/champs-texte-libre.ts) refuse en 422 sur les
--      10 routes qui écrivent ces colonnes ;
--   2. CETTE MIGRATION → le seul niveau qui tienne les écritures ne passant par
--      AUCUNE route Next :
--        · `fn_creer_collecte` / `fn_modifier_collecte` / `fn_modifier_evenement`
--          appelées directement sous service_role (script, seed, session psql) —
--          elles écrivent `p_updates->>'champ'`, qui coerce en texte n'importe
--          quel jsonb reçu, sans rien vérifier ;
--        · PostgREST direct sur `plateforme.evenements` — `authenticated` y garde
--          un GRANT UPDATE table-level (20260611180000, jamais révoqué : vérifié
--          sur dev) et `evt_manager_update` laisse un traiteur modifier son propre
--          événement non terminal. Les deux champs de contact sont donc écrivables
--          en direct, et le worker les relit SUR LA LIGNE au moment de consommer
--          l'event : ce qui est écrit par là atteint le transporteur. C'est le
--          vecteur que ces contraintes ferment.
--          Sur `plateforme.collectes`, 20260915160000 (#318) a révoqué UPDATE et
--          INSERT à `authenticated` : cette voie-là est déjà coupée en amont, et
--          le CHECK n'y couvre plus que les RPC, scripts et seed.
--      Cette migration NE touche AUCUN GRANT ni aucune policy (CLAUDE.md §12
--      pt 2bis) : restreindre le GRANT UPDATE d'`authenticated` à une liste
--      blanche de colonnes reste un arbitrage Val. Les contraintes, elles, sont
--      purement additives et valent pour TOUS les rôles, service_role compris.
--
-- PARITÉ AVEC LA GARDE APPLICATIVE — les deux niveaux refusent le MÊME ensemble :
--   - longueur : `length()` compte des CARACTÈRES, comme `String.length` côté TS,
--     à ceci près qu'un caractère hors BMP (emoji) compte 2 en JS et 1 ici — la
--     garde applicative est donc au pire plus stricte, jamais plus permissive ;
--   - caractères de contrôle : `[[:cntrl:]]` désigne ici exactement U+0000-U+001F
--     et U+007F-U+009F (vérifié codepoint par codepoint sur ce serveur, PG 17 :
--     U+00A0 et U+00E9 n'en sont pas), soit l'ensemble de la regex TS `CONTROLE`.
--     `informations_supplementaires` est saisi dans un `<textarea>` : tabulation
--     et sauts de ligne y sont légitimes, d'où le `translate()` qui les retire
--     avant le test — même exception que `CONTROLE_HORS_BLANCS` côté TS.
--   Aucune valeur acceptée par une route ne peut donc ressortir en 500 sur l'une
--   de ces contraintes. Les nombres (120 / 40 / 1000) sont dupliqués en TS et ici
--   par nécessité ; `champs-texte-libre.bornes-db.test.ts` relit CE fichier et
--   fait rougir la CI si les deux jeux divergent.
--
-- CHOIX D'ÉCRITURE : expressions INLINE, pas de fonction prédicat. Un CHECK
-- s'évalue avec les droits de celui qui ÉCRIT ; une fonction aurait exigé que son
-- EXECUTE reste à PUBLIC, contre le réflexe de REVOKE du repo (faille P0 #263) —
-- piège rencontré en #312, évité ici faute de sous-requête à faire.
--
-- ÉTAT DES DONNÉES VÉRIFIÉ AVANT POSE — dev (`savr-dev`) et prod (`savr-prod`,
-- lecture seule forcée `default_transaction_read_only=on`), le 2026-09-15 :
--   dev  : 653 evenements / 653 collectes, dont contact_secours_nom non NULL = 0,
--          contact_secours_telephone non NULL = 0, informations_supplementaires
--          non NULL = 0 ; caractères de contrôle = 0.
--   prod : 0 evenements, 0 collectes (aucun utilisateur réel, CLAUDE.md §12).
-- → AUCUNE ligne existante ne viole les bornes : contraintes posées VALIDÉES,
--   sans NOT VALID ni backfill. Un `NOT VALID` suivi d'un `VALIDATE` aurait été
--   du cérémonial sur un ensemble vide, et aurait laissé trois contraintes non
--   validées dans le catalogue si le VALIDATE était oublié.
-- ⚠ CONSÉQUENCE POUR LA MIGRATION BUBBLE (V5, non écrite à ce jour) : l'import de
--   l'historique devra normaliser ces trois colonnes (troncature + repli des
--   blancs) AVANT insertion, sous peine de 23514 sur les lignes hors bornes.
--
-- Backward-compatible / purement additive : aucune colonne ajoutée, renommée ou
-- supprimée, aucun type modifié, aucun GRANT/policy/RLS touché, aucun accès ouvert
-- ni élargi. Hors diff structurel G6 (schema-vs-cible compare les COLONNES ; le
-- DDL cible V2 n'embarque ni CHECK ni index).
--
-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
--   ALTER TABLE plateforme.evenements
--     DROP CONSTRAINT IF EXISTS chk_evenements_contact_secours_nom_borne;
--   ALTER TABLE plateforme.evenements
--     DROP CONSTRAINT IF EXISTS chk_evenements_contact_secours_telephone_borne;
--   ALTER TABLE plateforme.collectes
--     DROP CONSTRAINT IF EXISTS chk_collectes_informations_supplementaires_borne;
-- =============================================================================

-- ─── 1. evenements.contact_secours_nom — 120 caractères, sans contrôle ───────
-- `ADD CONSTRAINT` n'a pas d'IF NOT EXISTS : on absorbe le doublon pour rester
-- rejouable.

DO $$ BEGIN
  ALTER TABLE plateforme.evenements
    ADD CONSTRAINT chk_evenements_contact_secours_nom_borne
    CHECK (
      contact_secours_nom IS NULL
      OR (
        length(contact_secours_nom) <= 120
        AND contact_secours_nom !~ '[[:cntrl:]]'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON CONSTRAINT chk_evenements_contact_secours_nom_borne
  ON plateforme.evenements IS
  'Borne d''intégrité : 120 caractères max, aucun caractère de contrôle. Le nom du contact de secours OUVRE l''agrégat du canal de texte libre transmis au chauffeur : une valeur démesurée y évince toutes les lignes suivantes, dont l''adresse d''accès, et une valeur multiligne y forge une fausse ligne d''en-tête. Même nombre que LIMITE_NOM_SECOURS côté adapters. Miroir de BORNES_TEXTE_LIBRE (packages/plateforme/src/lib/champs-texte-libre.ts).';

-- ─── 2. evenements.contact_secours_telephone — 40 caractères ─────────────────
-- Téléphone « format libre V1 » (§08 common.schema.json, normalisation E.164
-- reportée) : on borne la longueur et le jeu de caractères, jamais le format.

DO $$ BEGIN
  ALTER TABLE plateforme.evenements
    ADD CONSTRAINT chk_evenements_contact_secours_telephone_borne
    CHECK (
      contact_secours_telephone IS NULL
      OR (
        length(contact_secours_telephone) <= 40
        AND contact_secours_telephone !~ '[[:cntrl:]]'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON CONSTRAINT chk_evenements_contact_secours_telephone_borne
  ON plateforme.evenements IS
  'Borne d''intégrité : 40 caractères max, aucun caractère de contrôle. Format libre V1 (aucune normalisation E.164) — miroir de BORNES_TEXTE_LIBRE (packages/plateforme/src/lib/champs-texte-libre.ts).';

-- ─── 3. collectes.informations_supplementaires — 1000 caractères (§08 E1) ────
-- Saisi dans un `<textarea>` : tabulation (chr 9) et sauts de ligne (chr 10, 13)
-- sont des caractères légitimes. `translate(..., '')` les retire avant le test —
-- sans lui, la contrainte refuserait toute saisie sur plusieurs lignes, que le
-- formulaire produit normalement.

DO $$ BEGIN
  ALTER TABLE plateforme.collectes
    ADD CONSTRAINT chk_collectes_informations_supplementaires_borne
    CHECK (
      informations_supplementaires IS NULL
      OR (
        length(informations_supplementaires) <= 1000
        AND translate(
              informations_supplementaires,
              chr(9) || chr(10) || chr(13),
              ''
            ) !~ '[[:cntrl:]]'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON CONSTRAINT chk_collectes_informations_supplementaires_borne
  ON plateforme.collectes IS
  'Borne d''intégrité : 1000 caractères max (CDC §06.01 l.167 / §08 E1), aucun caractère de contrôle hors tabulation et sauts de ligne — miroir de BORNES_TEXTE_LIBRE (packages/plateforme/src/lib/champs-texte-libre.ts).';
