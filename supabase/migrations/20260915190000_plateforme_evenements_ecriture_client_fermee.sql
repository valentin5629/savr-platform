-- =============================================================================
-- Intégrité de `plateforme.evenements` : fermer l'écriture PostgREST directe des
-- clients + borner EN BASE les deux contacts PRINCIPAUX.
--
-- Source : revue sécurité de la PR #321 (« contact de secours », 2026-09-15).
-- Suite directe de #318 (`20260915160000_plateforme_collectes_ecriture_client_fermee`),
-- qui a fermé `collectes` sans toucher `evenements`. CLAUDE.md §12 pt 2bis —
-- migration de FERMETURE.
--
-- ⚠ HORODATAGE : renumérotée depuis `20260915170000`. #322 a atterri sur `main`
-- PENDANT ce lot avec `20260915180000` ; une migration au timestamp antérieur est
-- SAUTÉE par `supabase db push`. La renumérotation reflète aussi l'ordre réel de
-- dépendance : le périmètre de bornes ci-dessous est le COMPLÉMENT de celui de #322.
--
-- LE DÉFAUT
-- ---------
-- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plateforme TO
-- authenticated` (0.4a) est table-level : la RLS filtre les LIGNES, jamais les
-- COLONNES. Sur `collectes` ce grant a été retiré par #318 ; sur `evenements` il
-- subsiste intégralement, et la table n'a AUCUN CHECK. Un client authentifié
-- légitime peut donc, avec la clé anon (publique) et son propre JWT :
--
--   PATCH /rest/v1/evenements?id=eq.<son-evenement>   (policies evt_*_update)
--   POST  /rest/v1/evenements                          (policies evt_*_insert)
--   DELETE /rest/v1/evenements?id=eq.<…>               (policy evt_manager_delete)
--
-- Mesuré sous rôle `authenticated` (DB locale à jour, 2026-09-15, transaction
-- rollbackée) sur un événement portant 7 collectes actives :
--   UPDATE … SET contact_secours_nom = repeat('X', 5000)  →  UPDATE 1
--   longueur stockée  = 5000        (aucune borne, ni route ni base)
--   outbox_events     = 6  →  6     (AUCUN `collecte.modifiee` émis)
--
-- Deux conséquences distinctes :
--
-- 1. AUCUN EVENT OUTBOX. Le chemin nominal (route → `fn_modifier_evenement`) émet
--    un E2 par collecte encore commandée chez un provider ; l'UPDATE direct, lui,
--    n'en émet aucun — et R22c a explicitement ÉCARTÉ un trigger `dirty_tms` sur
--    `evenements` (double push E2), donc rien ne le rattrape. Le chauffeur garde
--    l'ancien contact. Une rectification ou un effacement RGPD passé en direct
--    n'atteint jamais le sous-traitant, et l'`audit_log` (écrit par la route, pas
--    par la base) ne le voit pas non plus.
--
-- 2. BORNES INCOMPLÈTES. Les 4 champs de contact partent nativement au
--    transporteur — `contact_principal_nom`/`_telephone` et
--    `contact_secours_telephone` dans les payloads construits par les DEUX adapters
--    logistiques (`packages/adapters/`, champs natifs `phone` / `contactName` /
--    `phoneAlternatives` côté camion, `pickup.contact` côté vélo-cargo),
--    `contact_secours_nom` en tête du canal libre routé (#321).
--    #322 (`20260915180000`, mergée sur `main` pendant ce lot) a borné les DEUX
--    champs de SECOURS ; les deux champs PRINCIPAUX restaient sans aucune borne,
--    ni à l'entrée des routes, ni en base. Ce sont eux que ferme ce fichier.
--
-- Ce n'est PAS une fuite cross-organisation (le cloisonnement par org tient) :
-- c'est un défaut d'INTÉGRITÉ de la donnée transmise au transporteur, et un trou
-- dans la traçabilité RGPD — exactement le motif écrit dans le COMMENT de #318.
--
-- LA FERMETURE (deux verrous indépendants, volontairement redondants)
-- ------------------------------------------------------------------
-- 1. CHECK sur les deux colonnes de contact PRINCIPAL : borne quel que soit
--    l'écrivain — y compris service_role, c'est-à-dire les routes elles-mêmes.
--    C'est le SEUL verrou qui couvre le trou réellement atteignable par un
--    utilisateur nominal : aujourd'hui, un nom de 5 000 caractères saisi dans le
--    formulaire est accepté par la route et part au transporteur.
--    ⚠ Le verrou 2 rend `authenticated` incapable d'écrire la table : à partir de
--    cette migration, les CHECK de contact (les deux d'ici ET les deux de #322) ne
--    protègent plus que les écrivains NON-`authenticated` — RPC service_role,
--    seed, psql, et toute route future qui oublierait `validerChampsTexteLibre`.
--    C'est la même réduction de portée que #318 avait produite sur `collectes` ;
--    `bornes_texte_libre.test.sql` (section 6) est recalé en conséquence.
-- 2. REVOKE INSERT + UPDATE + DELETE : recentre TOUTE écriture sur les routes API
--    (service_role), seules à émettre l'outbox E2, tracer l'`audit_log` et
--    appliquer la matrice de rôles §09.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CHECK de bornes sur les deux contacts PRINCIPAUX
-- ─────────────────────────────────────────────────────────────────────────────
-- #322 (`20260915180000`) a borné `contact_secours_nom` (120) et
-- `contact_secours_telephone` (40) — et sa propre divergence déclarait les deux
-- contacts PRINCIPAUX « NON bornés, hors périmètre de ce lot [...] Les borner
-- serait cohérent — décision Val », au motif qu'ils ne transitent pas par le canal
-- de texte libre et n'exposent donc pas au risque d'ÉVICTION. C'est exact — mais
-- ils partent dans les champs NATIFS de la commande (`contact` / `phone` côté
-- camion, `pickup.contact` côté vélo-cargo) : un nom de 5 000 caractères y reste
-- une donnée aberrante transmise au transporteur, exactement le motif pour lequel
-- #322 bornait déjà le TÉLÉPHONE de secours. On ferme ce reliquat ici.
--
-- Mêmes valeurs que leurs homologues de secours (120 / 40) : un couple
-- nom/téléphone ne doit pas être borné différemment selon qu'il est principal ou de
-- secours. Même forme, même convention de nommage et même `DO $$ … EXCEPTION WHEN
-- duplicate_object` que #322, pour que les cinq contraintes se lisent comme un seul
-- jeu. Miroir applicatif : `BORNES_TEXTE_LIBRE`
-- (packages/plateforme/src/lib/champs-texte-libre.ts), dont ce lot étend la
-- constante plutôt que d'ouvrir un second validateur ;
-- `champs-texte-libre.bornes-db.test.ts` relit les DEUX fichiers de migration et
-- rougit si un nombre diverge.
--
-- Différence unique avec les champs de secours : `btrim(...) <> ''`. Les colonnes
-- sont NOT NULL et le §06.01 l.320 exige le contact principal « renseigné » dans
-- les validations bloquantes — un contact principal effacé, c'est un chauffeur sans
-- personne à appeler. Côté route, le drapeau `obligatoire` de `BORNES_TEXTE_LIBRE`
-- transforme la normalisation `'' → null` (qui produirait un 23502 → 500) en refus
-- 422.
--
-- Audit préalable des lignes existantes (lecture seule, 2026-09-15) :
--   dev  = 653 événements — max 19 car. (nom principal), 17 (tél. principal),
--          0 caractère de contrôle, 0 valeur vide ;
--   prod = 0 événement.
-- Aucune ligne à régulariser → contraintes posées VALIDES d'emblée, sans le détour
-- `NOT VALID` + `VALIDATE CONSTRAINT`.
DO $$ BEGIN
  ALTER TABLE plateforme.evenements
    ADD CONSTRAINT chk_evenements_contact_principal_nom_borne
    CHECK (
      length(contact_principal_nom) <= 120
      AND contact_principal_nom !~ '[[:cntrl:]]'
      AND btrim(contact_principal_nom) <> ''
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON CONSTRAINT chk_evenements_contact_principal_nom_borne
  ON plateforme.evenements IS
  'Borne d''intégrité : 120 caractères max, aucun caractère de contrôle, jamais vide. Ce nom part dans le champ NATIF de contact de la commande transmise au transporteur ; la colonne est NOT NULL et le §06.01 l.320 l''exige renseigné. Mêmes valeurs que chk_evenements_contact_secours_nom_borne (#322). Miroir de BORNES_TEXTE_LIBRE (packages/plateforme/src/lib/champs-texte-libre.ts).';


DO $$ BEGIN
  ALTER TABLE plateforme.evenements
    ADD CONSTRAINT chk_evenements_contact_principal_telephone_borne
    CHECK (
      length(contact_principal_telephone) <= 40
      AND contact_principal_telephone !~ '[[:cntrl:]]'
      AND btrim(contact_principal_telephone) <> ''
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON CONSTRAINT chk_evenements_contact_principal_telephone_borne
  ON plateforme.evenements IS
  'Borne d''intégrité : 40 caractères max, aucun caractère de contrôle, jamais vide. Format libre V1 (aucune normalisation E.164), comme chk_evenements_contact_secours_telephone_borne (#322) ; c''est le numéro que le chauffeur appelle en premier. Miroir de BORNES_TEXTE_LIBRE (packages/plateforme/src/lib/champs-texte-libre.ts).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REVOKE INSERT + UPDATE + DELETE sur `evenements` pour `authenticated`
-- ─────────────────────────────────────────────────────────────────────────────
-- Recensement exhaustif préalable des 15 fichiers portant `.from('evenements')` :
--   • 11 écrivent ou lisent sous `createAdminSupabaseClient` (service_role, non
--     concerné par un REVOKE sur `authenticated`) ;
--   • 4 lisent sous `createSupabaseServerClient` (clé anon + cookie utilisateur,
--     donc rôle `authenticated`) — et ce sont QUATRE SELECT, sans exception :
--     `gestionnaire/evenements` (liste), `gestionnaire/evenements/[id]`,
--     `gestionnaire/evenements/export-csv`, `dashboards/synthese-pdf/filtres`,
--     plus la lecture de cloisonnement en tête du PATCH programmation.
--   • `createBrowserSupabaseClient` n'est utilisé que pour `auth.*` (zéro
--     `.from(...)` navigateur) — même constat qu'en #318.
-- La liste blanche de colonnes ré-accordées est donc VIDE : aucun écran ne casse.
--
-- ⚠ Un REVOKE sur une seule colonne serait INOPÉRANT tant que le privilège
-- table-level subsiste (il couvre toutes les colonnes et prime) : on retire le
-- privilège table-level, et on ne re-GRANT rien.
--
-- DELETE est retiré AUSSI (là où #318 l'avait conservé sur `collectes`) : sur
-- `evenements` il n'a aucun usage applicatif — la suppression de brouillon passe par
-- `fn_supprimer_brouillon`, SECURITY DEFINER dont l'EXECUTE est révoqué de PUBLIC,
-- appelée en service_role — et la policy `evt_manager_delete` est plus permissive
-- que la règle §06.01, sur un point PRÉCIS : elle n'a AUCUNE garde d'ÉTAT. Son USING
-- se réduit à `f_app_role() = 'traiteur_manager' AND organisation_id = <org du JWT>`,
-- là où le §06.01 (l.309-310) et la RPC bornent la suppression au BROUILLON — une
-- collecte confirmée s'annule, elle ne se supprime pas.
--
-- ⚠ Ce qui suit est FAUX et ne doit pas être ré-invoqué (corrigé en revue
-- conformité-spec) : (1) le périmètre RÔLE/ORG de la policy n'est PAS plus large que
-- la matrice §09 tranchée par Val le 2026-09-14 — celle-ci accorde bien à
-- `traiteur_manager` le périmètre organisation, les deux COÏNCIDENT ; (2) l'absence
-- de trace `audit_log` n'est pas un argument, car AUCUN des deux chemins n'en écrit
-- sur une suppression — ni la policy, ni `fn_supprimer_brouillon`, ni le handler
-- DELETE de la route (le seul `audit_log.insert` du fichier est dans le PATCH). Ce
-- trou de traçabilité est préexistant, partagé, et hors périmètre de ce lot.
--
-- La FK `collectes_evenement_id_fkey` (pas de CASCADE) limite aujourd'hui les dégâts
-- aux événements sans collecte, mais c'est un effet de bord, pas un garde-fou.
--
-- service_role n'est pas concerné (privilèges séparés). `anon` n'a jamais rien reçu
-- (0.4a). SELECT reste accordé : les quatre lectures ci-dessus en dépendent.
--
-- Les policies `evt_*_insert` / `evt_*_update` / `evt_manager_delete` sont
-- CONSERVÉES (même arbitrage qu'en #318) : la fermeture se fait au niveau
-- privilège, pas RLS. Elles redeviendraient actives si un besoin JWT-scopé
-- réapparaissait.
--
-- ⚠ EFFET DE BORD ASSUMÉ — le DELETE client de `collectes` devient inatteignable.
-- Le trigger `trg_set_date_evenement` (AFTER INSERT / UPDATE OF date_collecte /
-- DELETE sur `collectes`) recalcule `evenements.date_evenement`, et sa fonction
-- `fn_set_date_evenement` n'est PAS SECURITY DEFINER : elle s'exécute avec les
-- droits de l'appelant. Sous `authenticated`, son `UPDATE plateforme.evenements`
-- lève désormais 42501, et le DELETE de la collecte échoue avec lui — alors que
-- #318 avait délibérément CONSERVÉ le privilège DELETE sur `collectes` pour
-- `col_delete_brouillon`. C'est une conséquence inévitable du retrait d'UPDATE sur
-- `evenements`, pas un choix séparé.
--
-- Aucun chemin de production n'est touché : le seul `.from('collectes').delete()`
-- du code tourne sous service_role (rollback de POST /programmation/evenements), et
-- la suppression de brouillon passe par `fn_supprimer_brouillon` (SECURITY DEFINER,
-- EXECUTE révoqué de PUBLIC). `col_delete_brouillon` n'avait déjà aucun appelant.
--
-- Les deux contournements possibles sont écartés : passer `fn_set_date_evenement`
-- en SECURITY DEFINER lui ferait faire un UPDATE inconditionnel sur `evenements` en
-- bypassant la RLS ; ré-accorder `UPDATE (date_evenement, updated_at)` en
-- colonne-level rouvrirait une colonne écrivable sans émission d'outbox — la classe
-- de défaut que cette migration ferme. Verrouillé tel quel dans
-- m3_1_espace_traiteur.test.sql T9/T10.
REVOKE INSERT, UPDATE, DELETE ON plateforme.evenements FROM authenticated;

-- Le COMMENT de `plateforme.collectes` posé par #318 le même jour annonce « SELECT et
-- DELETE (col_delete_brouillon) restent accordés » : le privilège DELETE reste bien
-- accordé, mais il devient INATTEIGNABLE sous `authenticated` (cf. l'effet de bord
-- ci-dessus). On corrige le catalogue plutôt que de laisser un dev lire une capacité
-- qui n'existe plus — sans toucher au privilège lui-même, qui relève de #318.
COMMENT ON TABLE plateforme.collectes IS
  'Collecte des invendus (AG / ZD). Écriture FERMÉE à `authenticated` depuis 2026-09-15 : UPDATE et INSERT retirés du GRANT table-level 0.4a, sans re-GRANT — toute écriture passe par les routes API (service_role), seules à émettre l''outbox E1/E2, tracer l''audit_log et poser dirty_tms. Les policies col_update_client / col_update_commercial / col_insert sont conservées mais INERTES pour PostgREST direct tant que le privilège n''est pas ré-accordé. SELECT reste accordé. Le privilège DELETE reste accordé lui aussi (col_delete_brouillon) mais est INATTEIGNABLE sous `authenticated` depuis la fermeture d''`evenements` : le trigger trg_set_date_evenement (fonction NON SECURITY DEFINER) y fait un UPDATE qui lève 42501. La suppression de brouillon passe par fn_supprimer_brouillon (service_role).';

COMMENT ON TABLE plateforme.evenements IS
  'Événement (réception) portant N collectes. Écriture FERMÉE à `authenticated` depuis 2026-09-15 : INSERT, UPDATE et DELETE retirés du GRANT table-level 0.4a, sans re-GRANT — toute écriture passe par les routes API (service_role), seules à émettre l''outbox E2 via fn_modifier_evenement, tracer l''audit_log et appliquer la matrice de rôles §09. Les policies evt_*_insert / evt_*_update / evt_manager_delete sont conservées mais INERTES pour PostgREST direct tant que le privilège n''est pas ré-accordé. SELECT reste accordé (lectures gestionnaire + filtres synthèse PDF + cloisonnement du PATCH).';
