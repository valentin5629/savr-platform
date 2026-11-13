-- Un fichier vivant au plus par objet de stockage (bucket, clé).
--
-- Constat (savr-dev, 2026-11-13) : une collecte AG montrait chaque photo MTS-1
-- deux fois. MTS-1 envoie plusieurs notifications à la fin d'une mission ;
-- chacune relance une relève, et deux relèves simultanées ont toutes deux vu
-- « photo absente » (recherche par clé) avant que l'autre l'enregistre : deux
-- lignes shared.fichiers pour la même clé, à 0,2 s d'écart. 19 clés en double
-- sur savr-dev, toutes des photos.
--
-- Les clés des photos remontées par un transporteur sont déterministes (la
-- dédup les cherche) ; toutes les autres écritures (PDF, photos importées par
-- l'Admin, logos) prennent une clé neuve à chaque fois. L'index n'interdit donc
-- qu'un doublon : la seconde relève reçoit 23505 et passe son tour.
--
-- Avant l'index, les doublons vivants sont marqués supprimés (deleted_at), pas
-- effacés : on garde la photo choisie pour le client s'il y en a une, sinon la
-- plus ancienne. L'objet R2 est le même pour toutes (même clé), rien n'y change.

UPDATE shared.fichiers f
SET deleted_at = now()
FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY bucket, key
           ORDER BY (rang_client IS NULL), created_at, id
         ) AS rang
  FROM shared.fichiers
  WHERE deleted_at IS NULL
) d
WHERE f.id = d.id
  AND d.rang > 1;

CREATE UNIQUE INDEX uniq_fichiers_objet_vivant
  ON shared.fichiers (bucket, key)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX shared.uniq_fichiers_objet_vivant IS
  'Un fichier vivant au plus par objet (bucket, clé) : deux relèves simultanées ne doublent plus une photo du transporteur (constat du 2026-11-13).';
