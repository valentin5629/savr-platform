-- =============================================================================
-- f_dechets_labo_estimes — « coefficient non communiqué » remonte NULL, plus 0
-- =============================================================================
-- Divergence `clair` tracée : _Divergences/M3.2_20260921_dechets-labo-coalesce-zero.md
--
-- CONSTAT (source SQL lue, puis mesurée sous rôle `authenticated` avec un JWT
-- gestionnaire simulé — revue reviewer-rls-securite 2026-09-21) : la définition
-- de 20260611180000 (l.88) enveloppe son résultat dans COALESCE(…, 0), donc la
-- fonction ne renvoie JAMAIS NULL. Valeurs mesurées : traiteur avec coefficient
-- → 45.0000 ; traiteur SANS coefficient → 0 ; événement hors périmètre → 0.
--
-- POURQUOI C'EST UN DÉFAUT — §05 Règles métier « R_dechets_labo_estimes » :
--   « Aucun coefficient pour (traiteur opérationnel, année − 1) → estimation =
--     NULL → UI affiche `—`. Pas de fallback (un chiffre faux est pire qu'une
--     absence assumée). »
--   « Coefficient = 0 (traiteur déclarant zéro perte) → estimation = 0 kg
--     (affiché tel quel, DISTINCT de NULL). »
-- Et §06.05 §2 l.309 (colonne liste Événements) + §3 l.330 (détail événement) :
--   « `—` si le traiteur n'a pas communiqué de coefficient ».
-- Le COALESCE écrase précisément la distinction que la règle pose : le
-- gestionnaire lit « 0.0 kg » — l'affirmation d'une estimation nulle — là où la
-- bonne réponse est « inconnu ». Les deux routes appelantes propagent déjà la
-- valeur telle quelle et les deux écrans rendent déjà `—` sur NULL : ce cas
-- devient atteignable sans une ligne de code applicatif.
--
-- CORPS DE RÉFÉRENCE = celui de 20260611180000. Les deux migrations postérieures
-- qui nomment cette fonction ne l'ont PAS touché : 20260622140000 a posé
-- `ALTER FUNCTION … SET search_path` (durcissement C5) et 20260623140000 ne la
-- cite qu'en commentaire (elle traitait 5 AUTRES retardataires). Seul le
-- COALESCE(…, 0) est retiré ici ; garde de périmètre, tri et LIMIT inchangés.
--
-- SÉCURITÉ — aucune information nouvelle n'atteint l'appelant :
--   • aucun oracle créé. « Hors périmètre » et « sans coefficient » valaient
--     tous deux 0, ils valent désormais tous deux NULL → toujours
--     indistinguables entre eux. ⚠ Ce n'est PAS « la fonction en dit moins » :
--     mesuré, c'est une RELABELISATION à partition constante. Le repli
--     `COALESCE(NULL::numeric, 0)` rendait un numeric de scale 0, sérialisé
--     `0` sur le fil, là où un zéro RÉEL (`pax × coefficient`) est de scale 4,
--     sérialisé `0.0000` — un appelant PostgREST direct (schéma `plateforme`
--     exposé, cf. supabase/config.toml) séparait donc DÉJÀ les deux classes.
--     La partition observable passe de {45.0000 | 0.0000 | 0} à
--     {45.0000 | 0.0000 | null} : même granularité, seule l'étiquette de la
--     classe « pas de résultat » change. Le seul consommateur pour qui elle se
--     raffine est celui qui traverse JSON.parse (qui écrase 0.0000 en 0) —
--     c'est-à-dire les deux routes Savr, côté serveur de confiance, et ce
--     raffinement EST la sémantique exigée par §05 (revue sécurité
--     2026-09-21 : sérialisation `to_json` mesurée classe par classe, plus
--     4000 appels/classe en timing — aucune séparation stable) ;
--   • hors STOP CLAUDE.md §12-2bis : aucun GRANT, aucune policy, aucun RLS
--     touché. `CREATE OR REPLACE` conserve propriétaire et privilèges — l'ACL
--     posée par 20260611180000 (authenticated, anon) et l'arbitrage de
--     20260903130000 (fonction VOLONTAIREMENT laissée exécutable, garde de rôle
--     interne) restent en l'état, ni élargis ni réduits ;
--   • `SECURITY DEFINER` + `SET search_path = plateforme, pg_catalog` reconduits
--     à l'identique — `CREATE OR REPLACE` remplace `proconfig`, les omettre
--     aurait DÉFAIT le durcissement de 20260622140000.
--
-- Backward-compatible et non destructive : aucun objet créé/supprimé/renommé,
-- signature inchangée (`(uuid) RETURNS numeric`) → snapshot de types inchangé.
-- Hors périmètre du diff structurel DDL cible V2 (corps de fonction).
--
-- RÉSIDUEL CONNU, HORS LOT (ne pas le corriger ici) — la même règle §05 pose
-- « pax = 0 ou NULL → estimation NULL ». Ce lot ne le traite pas : le corriger
-- demande une garde explicite (`AND e.pax > 0`), pas le retrait du COALESCE.
-- Atteignabilité MESURÉE (revue conformité 2026-09-21, puis re-mesurée) :
--   • `pax IS NULL` : impossible, la colonne est NOT NULL depuis le Bloc 4 ;
--   • `pax = 0` : ATTEIGNABLE. La route de CRÉATION refuse bien `pax < 1`
--     (api/v1/programmation/evenements/route.ts), mais les deux routes
--     d'ÉDITION exposent `pax` sans borne inférieure
--     (programmation/evenements/[id] `EVENT_EDITABLE_FIELDS`, admin/evenements/[id]
--     `ALLOWED_FIELDS`) et `fn_modifier_evenement` (20260915140000) applique
--     `(p_updates->>'pax')::integer` tel quel ; aucun CHECK ne borne la colonne
--     (`UPDATE … SET pax = 0` accepté, sonde en transaction ROLLBACK sur la base
--     locale).
-- L'estimation vaudrait alors 0 kg au lieu de « — ». Préexistant et NON aggravé
-- par ce lot (0 × coefficient = 0, avec ou sans COALESCE). Tracé à part :
-- _Divergences/M3.2_20260921_dechets-labo-pax-zero.md.
-- Deux autres écarts de la même fonction sont tracés dans le fichier de
-- divergence de ce lot et traités à part : absence de la garde de date F3
-- (brouillon d'un traiteur tiers), et « année − 1 » du CDC contre
-- `ORDER BY annee_reference DESC LIMIT 1`.
--
-- ─── ROLLBACK (DoD « down-migration documentée ») ────────────────────────────
-- Rejouer la définition de 20260611180000, COALESCE compris, EN CONSERVANT le
-- `SET search_path` (l'original ne le portait pas ; il vient de 20260622140000
-- et ne doit pas être perdu) :
--
--   CREATE OR REPLACE FUNCTION plateforme.f_dechets_labo_estimes(p_evenement_id uuid)
--   RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
--   SET search_path = plateforme, pg_catalog AS
--   $fn$ SELECT COALESCE(( <le SELECT ci-dessous> ), 0) $fn$;
--
-- ⚠ Le rollback RÉTABLIT l'affichage « 0.0 kg » sur « coefficient non
-- communiqué » — il ne se justifie que pour restaurer l'état exact d'avant.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.f_dechets_labo_estimes(p_evenement_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS
$$
  -- NULL (et non 0) quand aucun coefficient n'existe pour le traiteur
  -- opérationnel, ou quand l'événement est hors périmètre de l'appelant.
  SELECT e.pax * c.coefficient_kg_couvert
  FROM plateforme.evenements e
  JOIN plateforme.coefficients_perte_labo c
    ON c.organisation_id = e.traiteur_operationnel_organisation_id
  WHERE e.id = p_evenement_id
    AND (
      plateforme.f_is_staff()
      OR e.lieu_id IN (
        SELECT lieu_id FROM plateforme.organisations_lieux
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
      )
      OR e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  ORDER BY c.annee_reference DESC
  LIMIT 1
$$;

COMMENT ON FUNCTION plateforme.f_dechets_labo_estimes(uuid) IS
  'Estimation kg des déchets labo amont (§05 R_dechets_labo_estimes). NULL = '
  'coefficient non communiqué OU événement hors périmètre → UI affiche « — ». '
  'Coefficient = 0 reste 0 kg, distinct de NULL. Le coefficient brut n''est '
  'jamais exposé.';
