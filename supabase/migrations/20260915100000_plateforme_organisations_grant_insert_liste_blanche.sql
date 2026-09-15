-- organisations : liste blanche de colonnes à la CRÉATION (privilège, pas garde de valeur)
--
-- CONTEXTE — suite structurelle de 20260914200000 (PR #302).
-- Cette migration-là fermait le volet INSERT par un trigger BEFORE INSERT qui refuse
-- 5 colonnes staff-only NOMMÉES. C'est une liste à tenir à jour : `mode_facturation_zd`
-- avait précisément échappé à la liste blanche UPDATE de M3.1 (20260616130000) parce
-- qu'elle a été ajoutée après (20260619150000). Restaient hors de toute matrice `id` et
-- `created_at`, qu'une `agence` pouvait forger à la création via `org_agence_insert_shadow`
-- (20260611180000) + le GRANT INSERT **table-level** de 0.4a (`GRANT SELECT, INSERT,
-- UPDATE, DELETE ON ALL TABLES IN SCHEMA plateforme TO authenticated`).
-- Impact borné aujourd'hui (`id` est la PK → une collision échoue ; `created_at`
-- n'alimente aucune logique de sécurité ni de facturation — vérifié par grep), mais le
-- régime d'écriture de ces 2 colonnes n'était tranché nulle part.
--
-- REMÈDE — exactement le pattern que M3.1 a appliqué à l'UPDATE, transposé à l'INSERT :
-- on retire le privilège table-level, puis on le re-GRANT sur la liste blanche exacte.
-- Fail-closed par construction : une colonne ajoutée demain n'est PAS insérable par un
-- JWT applicatif tant que personne ne l'ajoute ici explicitement — au lieu d'être ouverte
-- par défaut et oubliée (la cause racine du cas `mode_facturation_zd`).
--
-- ⚠ Un REVOKE INSERT (colonne) serait INOPÉRANT tant que le privilège INSERT *table-level*
-- subsiste : le grant table couvre toutes les colonnes et prime (note M3.1 l.25-28).
--
-- LISTE BLANCHE — dérivée de l'unique policy INSERT non-admin de la table,
-- `org_agence_insert_shadow` (création de fiche traiteur shadow par une agence), croisée
-- avec le CDC §06.11 différence #4 + §06.01 §Cas Agence :
--   • `nom` (← « Nom commercial » du modal, NOT NULL) et `raison_sociale` : obligatoires ;
--   • `siret` : « fortement recommandé, non bloquant » (D2 2026-06-17) — il débloque le
--     Cerfa via trg_cerfa_debloque_siret, donc il doit rester posable à la création ;
--   • `type`, `est_shadow`, `cree_par_organisation_id` : imposés par le WITH CHECK de la
--     policy — sans le privilège, la policy deviendrait inapplicable (INSERT toujours
--     refusé) et l'on aurait supprimé une capacité du CDC au lieu de la border.
-- Pas de champ Ville au modal (D2), et `organisations` ne porte ni adresse ni contact du
-- shadow (source de vérité SIRET = `entites_facturation`) → `email_principal`,
-- `telephone`, `adresse`, `logo_url` ne sont PAS insérables par un JWT applicatif. Ils
-- restent modifiables par le traiteur sur SA PROPRE fiche (GRANT UPDATE M3.1) : aucun
-- rôle non-staff ne crée sa propre organisation (l'inscription passe par
-- /api/auth/signup, service_role).
--
-- PÉRIMÈTRE DU GRANT — `authenticated` seul. Les 3 seuls chemins applicatifs qui
-- INSÈRENT une organisation écrivent en service_role (`createAdminSupabaseClient`) :
--   • POST /api/v1/programmation/organisations/shadow (fiche shadow agence)
--   • POST /api/v1/admin/organisations (back-office Admin)
--   • POST /api/auth/signup → creerNouvelleOrga (inscription)
-- `service_role` (BYPASSRLS + privilèges propres), `postgres` (seed, migrations) et
-- `supabase_admin` ne sont pas concernés par ce REVOKE. `anon` n'a jamais rien reçu (0.4a).
-- Le GRANT ne gouverne donc QUE le chemin PostgREST direct d'un JWT `agence`.
--
-- DÉFENSE EN PROFONDEUR — le trigger 20260914200000 est CONSERVÉ, décision explicite :
-- il garde la VALEUR, le GRANT garde le DROIT D'ÉCRIRE la colonne. Deux raisons de ne pas
-- le retirer maintenant qu'il paraît redondant sur ses 5 colonnes :
--   (1) le GRANT colonne est réversible par accident. Précision factuelle, relevée par
--       `reviewer-rls-securite` et vérifiée : la forme `GRANT ... ON ALL TABLES IN SCHEMA
--       plateforme TO authenticated` n'apparaît QU'UNE FOIS dans tout supabase/migrations/
--       (0.4a l.27) — les migrations postérieures octroient table par table, conformément
--       à la règle « GRANT explicite tables post-M0.4a ». Le risque n'est donc pas la
--       répétition de la forme globale mais un `GRANT INSERT ON plateforme.organisations
--       TO authenticated` par table, copié-collé depuis une table voisine : il ré-ouvrirait
--       les 18 colonnes sans rien casser d'autre. Le cliquet pgTAP (cas 16) attrape
--       précisément ce cas en CI ; la valeur propre du trigger est la fenêtre entre
--       l'accident et la CI — et le fait qu'il parle même quand le privilège se tait.
--   (2) le trigger couvre tout rôle applicatif non-admin, pas seulement celui qui porte
--       aujourd'hui le privilège.
-- Le retirer serait de surcroît une migration à risque pour un gain nul (coût d'exécution
-- négligeable à l'échelle de la table, ~80 organisations).
-- Les deux mécanismes sont documentés par COMMENT ci-dessous pour qu'aucun lecteur futur
-- ne prenne l'un pour un doublon oublié de l'autre, et le test pgTAP
-- supabase/tests/SECU__admin_only_cols_insert.test.sql épingle désormais les DEUX
-- (jeu de colonnes ET correspondance colonne → régime d'écriture).
--
-- NON DESTRUCTIF : aucune donnée touchée, aucune colonne supprimée ou renommée. FERME un
-- accès, ne l'élargit jamais — CLAUDE.md §12-2bis (REVOKE + re-GRANT strictement inclus
-- dans le privilège retiré).

REVOKE INSERT ON plateforme.organisations FROM authenticated;

GRANT INSERT (
  nom,                      -- « Nom commercial » du modal shadow (NOT NULL)
  raison_sociale,           -- obligatoire au modal shadow
  siret,                    -- recommandé non bloquant (D2) — débloque le Cerfa
  type,                     -- imposé = 'traiteur' par le WITH CHECK de la policy
  est_shadow,               -- imposé = true par le WITH CHECK
  cree_par_organisation_id  -- imposé = org du JWT par le WITH CHECK
) ON plateforme.organisations TO authenticated;

COMMENT ON TRIGGER trg_block_org_staff_cols_insert ON plateforme.organisations IS
  'Garde de VALEUR à la création (staff-only : tarif_refacture_pax_zd, grille_tarifaire_zd_id, notes_internes, actif, mode_facturation_zd). Complémentaire, et NON redondant, du GRANT INSERT colonne-level de 20260915100000 qui garde le DROIT D''ÉCRIRE la colonne : le GRANT est ré-ouvrable par accident (un GRANT INSERT table-level copié-collé depuis une table voisine ré-ouvrirait les 18 colonnes), et le trigger reste alors la dernière barrière le temps que la CI le rattrape. Ne retirer ni l''un ni l''autre sans trancher explicitement.';

COMMENT ON COLUMN plateforme.organisations.id IS
  'PK technique. Non forgeable par un JWT applicatif depuis 20260915100000 (hors liste blanche GRANT INSERT) : la création d''une fiche shadow laisse le défaut gen_random_uuid().';

COMMENT ON COLUMN plateforme.organisations.created_at IS
  'Horodatage de création. Non forgeable par un JWT applicatif depuis 20260915100000 (hors liste blanche GRANT INSERT) : toujours now() côté serveur.';

-- ROLLBACK (rétablit le privilège table-level de 0.4a — élargit un accès, donc à ne
-- jouer que sur décision explicite de Val, cf. CLAUDE.md §12-2bis) : re-accorder INSERT
-- au niveau table sur plateforme.organisations au rôle authenticated, puis retirer le
-- grant colonne devenu sans objet. Aucune donnée n'est concernée.
