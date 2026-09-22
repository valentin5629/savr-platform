-- =============================================================================
-- v_referentiel_traiteurs : un seul libellé, plus de colonne raison_sociale
-- =============================================================================
-- Constat (revue sécurité PR #363, 2026-09-21) : la vue `v_referentiel_traiteurs`
-- (security_invoker = false, GRANT SELECT à authenticated) expose `raison_sociale`
-- de TOUS les traiteurs actifs non-shadow à TOUT utilisateur connecté, y compris un
-- gestionnaire_lieux ou un client_organisateur sans lien avec ces traiteurs. §06.05
-- (« ne voit pas : les données commerciales/personnelles des traiteurs au-delà du
-- nom/logo ») ne laisse au gestionnaire que le nom et le logo — la PR #363 l'a
-- appliqué à la table `organisations` (vue v_traiteurs_gestionnaire), ce chemin-ci
-- restait ouvert. Décision Val 2026-09-22 : fusionner en un seul libellé.
--
-- La vue ne projette plus que `id` et `nom`, où `nom` = nom commercial, ou raison
-- sociale à défaut (traiteur sans nom commercial saisi). Aucun écran ne perd son
-- libellé, et plus aucune colonne « raison sociale » n'est lisible par ce chemin.
--
-- Ordre de préférence = nom commercial d'abord : §06.11 §3 spécifie « Traiteur
-- opérationnel : {{nom}} » sur la fiche collecte agence. Les 5 consommateurs
-- (fiche collecte agence, espace organisateur, exports CSV, snapshot synthèse,
-- dashboards) lisaient `id, nom, raison_sociale` et appliquaient eux-mêmes un repli
-- — trois préféraient la raison sociale, deux le nom : le repli devient unique et
-- centralisé ici. Effet visible : sur ces trois écrans, un traiteur qui a un nom
-- commercial s'affiche désormais sous ce nom, conformément à §06.11.
--
-- `DROP` puis `CREATE` (et non `CREATE OR REPLACE`) : remplacer une vue ne permet
-- pas de SUPPRIMER une colonne. Aucun objet ne dépend de cette vue (pg_depend
-- vérifié : 0 dépendant). Le DROP efface aussi les privilèges → ils sont reposés
-- ci-dessous, explicitement.
--
-- NON DESTRUCTIF : aucune donnée, aucune colonne de table touchée. FERME un accès
-- (CLAUDE.md §12-2bis) : la vue recréée expose STRICTEMENT moins que l'ancienne
-- (2 colonnes au lieu de 3, mêmes lignes) et son GRANT SELECT à authenticated est
-- le ré-octroi à l'identique de celui que le DROP retire. Preuve :
-- supabase/tests/SECU__referentiel_traiteurs_libelle_unique.test.sql.
-- =============================================================================

DROP VIEW IF EXISTS plateforme.v_referentiel_traiteurs;

-- security_invoker = false : la vue lit organisations avec les droits du
-- propriétaire — c'est ce qui permet à un client de résoudre le nom d'un traiteur
-- sur lequel la RLS ne lui donne aucune ligne. Le périmètre de lignes (référentiel
-- actif non-shadow) est donc ENTIÈREMENT porté par le WHERE ci-dessous, inchangé.
-- security_barrier : un filtre fourni par l'appelant (PostgREST) n'est évalué
-- qu'après ce WHERE.
CREATE VIEW plateforme.v_referentiel_traiteurs
WITH (security_invoker = false, security_barrier = true)
AS
SELECT o.id,
       COALESCE(NULLIF(btrim(o.nom), ''), o.raison_sociale) AS nom
  FROM plateforme.organisations o
 WHERE o.type = 'traiteur'::plateforme.organisation_type
   AND o.est_shadow = false
   AND o.actif = true;

-- Vue mono-table = auto-modifiable par PostgreSQL : une écriture à travers elle
-- s'exécuterait avec les droits du propriétaire (RLS contournée). SELECT seul.
REVOKE ALL ON plateforme.v_referentiel_traiteurs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON plateforme.v_referentiel_traiteurs TO authenticated;

COMMENT ON VIEW plateforme.v_referentiel_traiteurs IS
  'Référentiel des traiteurs Savr (actifs, non-shadow) pour tout rôle client : id + libellé unique (nom commercial, ou raison sociale si absent). La colonne raison_sociale a été retirée le 20260922080000 (§06.05 : au-delà du nom/logo, rien des données commerciales d''un traiteur tiers). Toute colonne ajoutée ici élargit l''accès de TOUS les rôles : revue sécurité + pgTAP SECU__referentiel_traiteurs_libelle_unique.';
