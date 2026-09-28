-- ============================================================================
-- organisations_domaines_email — fermeture de l'écriture client + backfill
-- ============================================================================
-- Cette migration FERME un accès (REVOKE). Elle n'en ouvre aucun.
--
-- MOTIF (mesuré en revue de sécurité, 2026-09-23)
-- -----------------------------------------------
-- `plateforme.organisations_domaines_email` décide à quelle organisation un
-- nouvel inscrit est rattaché (CDC §05 §8 « Logique de rattachement »). Deux faits
-- se combinaient en une chaîne de capture inter-organisation :
--
--   1. `POST /api/v1/traiteur/mon-organisation/domaines-email` laisse tout
--      `traiteur_manager` revendiquer n'importe quel domaine, sans la moindre
--      preuve de contrôle (seul contrôle : le format du domaine) ;
--   2. la colonne `verifie_at`, prévue depuis `20260612000001`, n'était écrite
--      NULLE PART — une revendication en l'air valait donc exactement un domaine
--      réellement contrôlé.
--
-- Il suffisait de créer un compte avec une adresse jetable, de revendiquer
-- « grandtraiteur.fr », et d'attendre : le premier salarié de ce domaine à
-- s'inscrire était rattaché en silence à l'organisation du revendiquant, qui en
-- est manager — et lit donc tout ce que ce salarié y crée.
--
-- `api/auth/verify-email` pose désormais `verifie_at` au clic sur le lien
-- d'activation, et `api/auth/signup` ne rattache plus que sur
-- `verifie_at IS NOT NULL`. Mais cette garde applicative N'EST PAS AUTORITAIRE
-- tant que le client peut écrire la colonne lui-même : `20260705120000` a posé
-- `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated` (table-level, donc
-- toutes colonnes) et la policy `ode_manager_write` est `FOR ALL` own-org. Un
-- manager pouvait donc poser `verifie_at` sur sa propre revendication en un seul
-- appel PostgREST direct (clé anon, publique par design — §07 l.289), sans passer
-- par aucune route. Mesuré : `INSERT … (organisation_id, domaine, verifie_at)`
-- → `INSERT 0 1`, `marque_prouvee = t`.
--
-- CE QUE FAIT CETTE MIGRATION
-- ---------------------------
--  1. REVOKE INSERT/UPDATE/DELETE table-level pour `authenticated` et `anon` :
--     l'écriture passe désormais par les routes, sous `service_role`, qui
--     valident déjà le rôle et l'organisation. Même pattern que `plateforme.lieux`
--     (`20260921210000`), `evenements`, `collectes` et `factures`
--     (`20260923150000`). SELECT est CONSERVÉ : « Mon organisation » lit la liste.
--  2. Backfill des rattachements LÉGITIMES déjà en base. Sans lui, toute ligne
--     existante resterait `verifie_at NULL` donc inerte, et le collègue d'un
--     client existant qui s'inscrirait tomberait sur un 409 sans issue — la
--     garde casserait le CDC §05 §8 pour l'existant.
--     Critère objectif, vérifiable, et volontairement étroit : on ne marque une
--     ligne que si l'organisation compte DÉJÀ un utilisateur dont l'adresse porte
--     ce domaine. Une revendication en l'air (domaine sans aucun utilisateur
--     correspondant) reste NULL, donc inerte — c'est exactement la signature de
--     la chaîne ci-dessus.
--
-- Les policies `ode_admin`, `ode_own_org_read` et `ode_manager_write` ne sont PAS
-- modifiées. `ode_manager_write` devient inerte pour l'écriture (plus de
-- privilège table-level), comme `lieux_admin` l'est depuis `20260921210000`.
-- ============================================================================

-- 1. Fermeture de l'écriture directe --------------------------------------
REVOKE INSERT, UPDATE, DELETE
  ON plateforme.organisations_domaines_email FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON plateforme.organisations_domaines_email FROM anon;

-- 2. Backfill des rattachements déjà prouvés par un utilisateur du domaine --
UPDATE plateforme.organisations_domaines_email d
   SET verifie_at = now()
 WHERE d.verifie_at IS NULL
   AND EXISTS (
     SELECT 1
       FROM plateforme.users u
      WHERE u.organisation_id = d.organisation_id
        AND lower(split_part(u.email, '@', 2)) = d.domaine
   );

COMMENT ON COLUMN plateforme.organisations_domaines_email.verifie_at IS
  'Horodatage de la PREUVE de contrôle du domaine : posé par api/auth/verify-email '
  'au clic sur le lien d''activation d''une adresse à ce domaine, dans cette '
  'organisation. Seules les lignes non NULL rattachent automatiquement un nouvel '
  'inscrit (api/auth/signup). Écriture réservée à service_role : authenticated n''a '
  'plus INSERT/UPDATE/DELETE sur cette table depuis 20260923180000.';
