-- =============================================================================
-- associations : SELECT en liste blanche colonne-level (7 colonnes)
-- =============================================================================
-- Constat (reviewer-rls-securite, 2026-10-04, pendant la revue du lot
-- v_attributions_gestionnaire — antérieur à ce lot et indépendant de lui ;
-- re-mesuré le même jour) : `authenticated` porte le SELECT TABLE-LEVEL sur
-- plateforme.associations (blanket grant 0.4a, 20260611180000) et la policy
-- `asso_read` (même migration, USING auth.role() = 'authenticated') rend TOUTES
-- les lignes à tout utilisateur connecté. Une policy filtre des lignes, jamais
-- des colonnes : tout rôle client lisait donc la fiche entière par PostgREST
-- direct.
--   - Base rejouée depuis zéro (172 migrations de main) : relacl
--     `authenticated=arwd`, aucun privilège colonne, 26 colonnes sur 26 lisibles.
--   - PostgREST local, `GET /rest/v1/associations?select=*`, Accept-Profile
--     plateforme, JWT signé pour chacun des 5 rôles clients (gestionnaire_lieux,
--     traiteur_manager, traiteur_commercial, agence, client_organisateur) :
--     HTTP 200, les 5 associations présentes dans la base locale, 26 colonnes
--     — dont commentaires_internes, contact_nom, contact_email,
--     contact_telephone, id_point_collecte_mts1, siren, instructions_acces.
--     Témoin anon : 401 / 42501.
--
-- §04 : `commentaires_internes` = « Notes Admin Savr ». §09 (dette ouverte le
-- 2026-09-14) : « associations et transporteurs exposent noms, coordonnées et
-- rattachements à tout utilisateur connecté. Recenser les consommateurs réels
-- avant de trancher. » Ce lot solde le volet COLONNES de `associations`.
--
-- Même pattern que lieux (20260617170000), organisations (20260918100000),
-- tournees (20260930160000) et evenements (20261001103000) : on retire le
-- privilège TABLE-LEVEL puis on re-GRANT une liste blanche. Un REVOKE colonne
-- seul serait INOPÉRANT tant que le privilège table subsiste. Fail-closed : une
-- colonne ajoutée demain n'est pas lisible par authenticated, PARCE QUE le
-- privilège table-level n'existe plus (un ADD COLUMN n'hérite d'aucun grant
-- colonne). Ce qui rouvrirait tout : un `GRANT SELECT ON plateforme.associations`
-- ou un `GRANT … ON ALL TABLES IN SCHEMA plateforme TO authenticated` comme
-- celui de 0.4a. La liste est épinglée à l'identique par
-- SECU__associations_select_liste_blanche.test.sql.
--
-- LISTE BLANCHE (7 colonnes) = exactement ce que les rôles clients lisent sous
-- leur identité aujourd'hui, ni plus ni moins :
--   - id : clé de jointure de tous les embeds PostgREST
--     (`associations!association_id(...)` → WHERE associations.id = …, qui exige
--     le privilège sur la colonne) et clé de regroupement des « Top associations
--     bénéficiaires » ;
--   - nom, ville : fiche collecte client, dashboards (blocs AG, synthèse PDF),
--     détail événement et pack AG du gestionnaire, export CSV ;
--   - region : export CSV « Associations bénéficiaires AG » du traiteur_manager
--     (§12 : « Association, Ville, Région, Nb collectes, Repas donnés ») ;
--   - description_rapport_impact : fiche collecte client (§04 : « Description
--     publique de l'association, copiée dans rapport AG ») ;
--   - latitude, longitude : détail événement du gestionnaire, pour CALCULER la
--     distance association ↔ lieu (§06.05 §3, arbitrage Val 2026-09-21).
--     La route ne les restitue pas ; elles restent lisibles en direct, comme
--     avant ce lot.
--
-- COLONNES RETIRÉES à authenticated (19 — lues en service_role uniquement) :
--   - contact_nom, contact_email, contact_telephone : coordonnées d'une personne
--     physique ;
--   - commentaires_internes : notes Admin Savr (§04) ;
--   - id_point_collecte_mts1 : identifiant du point de collecte chez le
--     transporteur, lu par le worker outbox ;
--   - horaires_ouverture, capacite_max_beneficiaires : critères de l'algo
--     d'attribution (fn_calculer_algo_attribution_ag, SECURITY DEFINER) ;
--   - types_aliments_acceptes, instructions_acces : données opérationnelles du
--     référentiel, lues par le back-office seul ;
--   - siren, habilitee_attestation_fiscale, date_expiration_habilitation,
--     numero_rup : identité légale et habilitation fiscale. L'instantané figé à
--     l'émission vit dans attestations_don (association_habilitation,
--     association_numero_rup) ; la source n'a aucun lecteur client ;
--   - adresse : aucune lecture cliente (le client voit la ville) ;
--   - actif, derniere_verification, logo_url, created_at, updated_at : gestion du
--     référentiel, lues par le back-office seul. Le logo d'association n'est lu
--     par aucun générateur de PDF aujourd'hui (les logos des PDF viennent de
--     organisations).
--
-- LECTEURS RECENSÉS (2026-10-04, sans troncature) — 81 fichiers source du dépôt
-- (ts, tsx, mjs, js) mentionnent « associations ». Hors tests, les lectures de
-- la table s'y réduisent à 7 `.from('associations')` et 13 embeds
-- (`associations!association_id(...)`, `associations (...)`,
-- `associations:association_id(...)`) ; le reste : libellés, types, tests et
-- seed (connexion directe, hors PostgREST).
--   Sous l'identité de l'utilisateur (createSupabaseServerClient) — 7 embeds
--   dans 6 fichiers, tous dans la liste blanche :
--     gestionnaire/evenements/[id] (nom, ville, latitude, longitude ; nom),
--     gestionnaire/pack-ag (nom), lib/collectes/fiche-client (nom, ville,
--     description_rapport_impact), lib/exports/builders branche traiteur_manager
--     (nom, ville, region), lib/dashboards/loaders et synthese-snapshot
--     (id, nom, ville).
--   En service_role (privilèges intacts) — les 7 `.from('associations')` et les
--   6 autres embeds : routes admin/associations (liste `select=*`, fiche,
--     création, édition), admin/attributions-ag/[collecteId]/associations,
--     admin/collectes/[id], admin/config-auto-accept, lib/attribution-ag/job
--     (email à l'association), lib/pdf/batch-pdf-j1-ag (attestation de don),
--     lib/exports/builders branche staff, lib/dashboards/admin-dashboard-client,
--     et le worker outbox des adapters (point de collecte, adresse, contact).
--   Catalogue (base rejouée depuis main) : aucune vue ne dépend de la table ;
--     aucune policy d'une autre table ne la relit ; deux fonctions la lisent
--     (fn_calculer_algo_attribution_ag, rpc_evaluer_auto_accept_ag), toutes deux
--     SECURITY DEFINER et sans EXECUTE pour authenticated ; aucune fonction ne
--     rend le type ligne ; les deux triggers de la table
--     (trg_ops_immutable_cols, trg_garde_format_logo) ne lisent que OLD / NEW.
--   Lot en vol v_attributions_gestionnaire (20261004190000, non mergé à cette
--     date) : la vue est security_invoker = false, elle lit nom et ville avec
--     les droits de son propriétaire ; ses routes embarquent
--     `associations(latitude, longitude)` et
--     `associations(description_rapport_impact)` sous l'identité du
--     gestionnaire — colonnes de la liste blanche. Fonctionnellement
--     compatible dans les deux ordres d'application (mesuré : ses 2 fichiers
--     pgTAP et celui-ci verts dans chaque ordre). L'ordre de MERGE, lui, est
--     contraint par les préfixes : celui de ce lot (20261004100000) est
--     inférieur à ceux des deux lots en vol à cette date (20261004190000 et
--     20261004203000). Ce lot se merge donc AVANT eux, qui passent derrière
--     sans changer de préfixe ; si l'un d'eux est mergé d'abord, c'est ce lot
--     qui en change.
--
-- CE QUE CE LOT NE CHANGE PAS (relevé, hors périmètre — arbitrages Val) :
--   - latitude / longitude restent lisibles en direct : des coordonnées
--     précises permettent de retrouver l'adresse, que ce lot ferme. Les fermer
--     demande de servir la distance côté serveur (route du détail événement,
--     vue v_attributions_gestionnaire) ;
--   - les LIGNES : `asso_read` rend toujours tout le référentiel (associations
--     inactives comprises) à tout utilisateur connecté, sur les 7 colonnes ;
--   - l'ÉCRITURE : authenticated garde INSERT / UPDATE / DELETE table-level,
--     bornés par les policies asso_admin (admin_savr) et asso_ops_update
--     (ops_savr), que seuls ces deux rôles staff passent (épinglé par le test
--     sous traiteur_manager : UPDATE et DELETE = 0 ligne, INSERT refusé). Le
--     back-office écrit en service_role ;
--   - `transporteurs`, jumelle du même constat §09 (policy transp_read +
--     privilège table-level, 22 colonnes dont contacts et tarif) : lot séparé.
--
-- EFFET DE BORD ASSUMÉ : admin_savr / ops_savr portent eux aussi le rôle PG
-- `authenticated`. Par PostgREST direct avec leur JWT, les 19 colonnes retirées
-- leur sont fermées (42501) — même conséquence que tournees (#436),
-- organisations (#360) et evenements (#456). Le back-office lit associations
-- exclusivement en service_role : aucun écran Admin n'est touché.
-- Conséquence sur l'ÉCRITURE par JWT staff (mesuré sous admin_savr, épinglé par
-- le test) : un UPDATE d'une colonne fermée filtré sur `id` passe toujours ;
-- le même UPDATE avec `RETURNING` d'une colonne fermée ou `RETURNING *` — ce que
-- fait PostgREST sur `Prefer: return=representation` sans `select=` — est
-- refusé (42501), comme un WHERE sur une colonne fermée. Aucun code du dépôt
-- n'écrit associations sous JWT.
--
-- NON DESTRUCTIF : aucune donnée touchée, aucune colonne supprimée ou renommée.
-- FERME un accès (CLAUDE.md §12-2bis) — GO reviewer-rls-securite + pgTAP de
-- preuve. ORDRE code / migration : indifférent. Aucune route ne lit sous
-- l'identité de l'utilisateur une colonne fermée ici ; l'ancien code comme le
-- nouveau fonctionnent avant et après la migration. ORDRE entre migrations :
-- imposé par les préfixes (cf. « Lot en vol » plus haut) — sur une base, cette
-- migration passe AVANT celles de préfixe supérieur. Si l'une d'elles y est
-- déjà inscrite au registre, le db push de celle-ci est refusé (migration à
-- insérer avant la dernière appliquée) : mesurer le registre avant de pousser.
-- APRÈS APPLICATION, mesurer sur la base : has_table_privilege('authenticated',
-- 'plateforme.associations', 'SELECT') = false et 7 colonnes lisibles.
--
-- MESURE APRÈS (2026-10-04, PostgREST v14.12 branché sur la base rejouée + cette
-- migration, mêmes requêtes qu'avant) : `select=*` → 403 / 42501 pour les 5
-- rôles clients, admin_savr et ops_savr ; colonne par colonne, 7 lues et 19
-- refusées ; les requêtes exactes de la fiche collecte, de l'export CSV, des
-- dashboards, du détail événement et du pack AG rendent la même réponse
-- qu'avant ; un embed demandant contact et notes internes depuis une
-- attribution visible → 403 ; service_role lit les 26 colonnes. Suite pgTAP
-- complète : 116 fichiers / 1860 assertions avant, 117 / 1909 après, 0 échec —
-- aucun test existant à recaler.
-- =============================================================================

REVOKE SELECT ON plateforme.associations FROM authenticated;

GRANT SELECT (
  id,
  nom,
  ville,
  region,
  latitude,
  longitude,
  description_rapport_impact
) ON plateforme.associations TO authenticated;

COMMENT ON TABLE plateforme.associations IS
  'Référentiel des associations Anti-Gaspi, géré par Admin Savr. Lecture : depuis la fermeture du 2026-10-04 (migration associations_select_liste_blanche), `authenticated` n''a plus le SELECT table-level mais une LISTE BLANCHE de 7 colonnes (id, nom, ville, region, latitude, longitude, description_rapport_impact), épinglée par SECU__associations_select_liste_blanche. Contacts, notes internes, SIREN, habilitation, horaires, capacité, instructions d''accès et point de collecte sont hors privilège : le back-office les lit en service_role. Toute colonne ajoutée est fermée par défaut ; l''ouvrir est une ouverture d''accès (décision Val).';

COMMENT ON COLUMN plateforme.associations.commentaires_internes IS
  'Notes Admin Savr (§04). Hors GRANT SELECT authenticated depuis la fermeture du 2026-10-04 (migration associations_select_liste_blanche) : illisible par PostgREST direct, staff compris. Lue par le back-office en service_role. Aucune route servant un rôle client ne doit la rendre.';

COMMENT ON COLUMN plateforme.associations.contact_telephone IS
  'Téléphone du contact de l''association. Hors GRANT SELECT authenticated, comme contact_nom et contact_email, depuis la fermeture du 2026-10-04 (migration associations_select_liste_blanche) : lu en service_role par le back-office et par le worker qui transmet l''ordre au transporteur.';

-- ROLLBACK (rouvre des accès : décision explicite de Val, CLAUDE.md §12-2bis) :
--   GRANT SELECT ON plateforme.associations TO authenticated;
--   (le grant colonne-level des 7 colonnes devient alors redondant : le retirer
--   est optionnel et purement cosmétique. Les trois commentaires posés
--   ci-dessus deviennent faux : les réécrire dans la même migration.)
