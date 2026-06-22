-- Convergence G1 (Frontière TMS-Ready) — CLUSTER A : valeurs/TYPE des ENUM vers le DDL cible V2.
-- Suite du lot de RENOMMAGE (PR #83, migration 20260623100000) qui a convergé les NOMS purs.
-- Ce lot traite les 2 enums du « cluster A » (sûrs, sans décision Val), où la cible modélise la
-- colonne en TEXT (et non plus en enum) :
--   A.1  plateforme.serie_facturation_enum  -> sequences_facturation.serie  : TEXT
--   A.2  plateforme.job_statut_enum         -> jobs_pdf.statut              : TEXT + CHECK
--
-- ⚠ PROD LIVE : enum->text via USING col::text préserve les données (sans perte). Les clusters
--   B (pack/facture/email — réconciliation de valeurs), C (documents_generaux_savr.statut —
--   structurel) et l'outbox (rename de colonne statut->status, sous-lot dédié) restent HORS de ce
--   lot : décisions Val requises. Plan complet : scripts/g1-enums-valeurs-plan.md
--
-- DÉPLOIEMENT : ce lot s'applique APRÈS le lot de renommage #83 (20260623100000). Les deux sont
--   indépendants (types disjoints) ; l'ordre naturel est rename puis valeurs/type.
--
-- ⚠ PIÈGE corps PL/pgSQL (vécu PR #83) : un changement de type/colonne ne se propage PAS dans le
--   TEXTE des fonctions. Vérifié sur la base live : AUCUN corps (pg_proc.prosrc) ne mentionne
--   'serie_facturation_enum' ni 'job_statut_enum'. Seules 2 fonctions les portent en TYPE
--   D'ARGUMENT (f_next_numero_facture / f_attribuer_numero_facture) -> drop+recreate en signature
--   text. Le reste des dépendances (1 vue + 2 index partiels sur jobs_pdf) est traité explicitement.

-- ===========================================================================
-- CLUSTER A.1 — serie_facturation_enum -> text (le plus sûr : text = surensemble)
-- ===========================================================================
-- Colonne sequences_facturation.serie = composant de PK (serie, annee). Aucune FK ne la référence ;
-- changer le type d'une colonne de PK est OK (l'index PK est reconstruit automatiquement).
-- text accepte toutes les valeurs existantes -> aucune perte.

-- 1) Colonne : enum -> text
ALTER TABLE plateforme.sequences_facturation
  ALTER COLUMN serie TYPE text USING serie::text;

-- 2) Recréer les 2 fonctions avec signature text. Changer le type d'un argument change l'identité
--    de la fonction -> CREATE OR REPLACE impossible, il faut DROP + CREATE. f_attribuer appelle
--    f_next : on drop le caller d'abord, le callee ensuite. Corps verbatim (le cast ::text du
--    préfixe devient inutile). Posture sécurité reproduite (fix M1.7 20260615000200).
DROP FUNCTION IF EXISTS plateforme.f_attribuer_numero_facture(plateforme.serie_facturation_enum, smallint);
DROP FUNCTION IF EXISTS plateforme.f_next_numero_facture(plateforme.serie_facturation_enum, smallint);

CREATE FUNCTION plateforme.f_next_numero_facture(p_serie text, p_annee smallint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO plateforme.sequences_facturation (serie, annee, dernier_numero)
  VALUES (p_serie, p_annee, 1)
  ON CONFLICT (serie, annee) DO UPDATE
    SET dernier_numero = plateforme.sequences_facturation.dernier_numero + 1,
        updated_at     = now()
  RETURNING dernier_numero INTO v_next;
  RETURN v_next;
END;
$function$;

CREATE FUNCTION plateforme.f_attribuer_numero_facture(p_serie text, p_annee smallint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_num    integer;
  v_prefix text;
BEGIN
  v_num    := plateforme.f_next_numero_facture(p_serie, p_annee);
  v_prefix := p_serie;   -- 'FZD', 'FAG', 'FPK', 'AV', ...
  RETURN v_prefix || '-' || p_annee::text || '-' || LPAD(v_num::text, 5, '0');
END;
$function$;

-- Reproduire la posture sécurité : CREATE FUNCTION accorde EXECUTE à PUBLIC par défaut.
REVOKE EXECUTE ON FUNCTION plateforme.f_next_numero_facture(text, smallint)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION plateforme.f_attribuer_numero_facture(text, smallint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION plateforme.f_next_numero_facture(text, smallint)      TO service_role;
GRANT  EXECUTE ON FUNCTION plateforme.f_attribuer_numero_facture(text, smallint) TO service_role;

-- 3) Plus aucun objet n'utilise le type -> drop
DROP TYPE plateforme.serie_facturation_enum;

-- ===========================================================================
-- CLUSTER A.2 — job_statut_enum -> text + CHECK (cible jobs_pdf.statut)
-- ===========================================================================
-- Cible : statut text NOT NULL DEFAULT 'pending'
--         CHECK (statut IN ('pending','processing','done','failed','dead')).
-- V1 enum a 'queued' et 'retrying' EN TROP, et le DEFAULT V1 = 'queued' (hors cible).
-- Les 3 INSERT applicatifs (triggers PDF) posent déjà statut='pending' ; 'queued'/'retrying' sont
-- des valeurs héritées non écrites par le code courant.

-- 0) GARDE-FOU PROD : aucune ligne ne doit porter une valeur hors de la cible CHECK. Sur prod, si
--    des 'queued'/'retrying' subsistent -> STOP net (mapping manuel Val avant de rejouer). La
--    migration ne corrompt jamais : elle s'arrête sur exception claire.
DO $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n
  FROM plateforme.jobs_pdf
  WHERE statut::text NOT IN ('pending','processing','done','failed','dead');
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'G1 cluster A.2 STOP : % ligne(s) jobs_pdf hors cible (queued/retrying). Mapping manuel requis avant convergence (cf. scripts/g1-enums-valeurs-plan.md).', v_n;
  END IF;
END $$;

-- 1) Lever les dépendances bloquant l'ALTER TYPE de la colonne : 1 vue + 2 index partiels dont les
--    prédicats castent l'enum.
DROP VIEW  IF EXISTS plateforme.v_ops_jobs_pdf;
DROP INDEX IF EXISTS plateforme.idx_jobs_pdf_anti_dupe;
DROP INDEX IF EXISTS plateforme.idx_jobs_pdf_queued;

-- 2) Colonne : drop default (enum) -> type text -> default text cible -> CHECK
ALTER TABLE plateforme.jobs_pdf ALTER COLUMN statut DROP DEFAULT;
ALTER TABLE plateforme.jobs_pdf ALTER COLUMN statut TYPE text USING statut::text;
ALTER TABLE plateforme.jobs_pdf ALTER COLUMN statut SET DEFAULT 'pending';
ALTER TABLE plateforme.jobs_pdf
  ADD CONSTRAINT jobs_pdf_statut_check
  CHECK (statut IN ('pending','processing','done','failed','dead'));

-- 3) Plus aucun objet n'utilise le type -> drop
DROP TYPE plateforme.job_statut_enum;

-- 4) Recréer les index partiels avec prédicats TEXT.
--    anti_dupe : prédicat ('pending','processing') -> valeurs cible, swap texte direct.
CREATE UNIQUE INDEX idx_jobs_pdf_anti_dupe
  ON plateforme.jobs_pdf (entity_type, entity_id, type_document)
  WHERE statut IN ('pending','processing');
--    queued : l'ancien prédicat ('queued','retrying') ne portait QUE les 2 valeurs retirées (jamais
--    écrites par le worker). Reconstruit sur l'ensemble retriable VALIDE sous la nouvelle CHECK =
--    ('pending','failed') = ce que pdf-worker.ts scanne réellement (retrying excepté, inexistant).
--    Nom conservé pour limiter le diff ; rôle inchangé (localiser les jobs à (re)traiter par retry).
CREATE INDEX idx_jobs_pdf_queued
  ON plateforme.jobs_pdf (next_retry_at)
  WHERE statut IN ('pending','failed');

-- 5) Recréer la vue ops avec prédicats TEXT (sans 'queued' qui n'existe plus).
--    security_invoker = true RESTAURÉ : posé par 20260613120000 (vue ops lisant une table RLS),
--    puis perdu par M1.6 (DROP VIEW … CREATE VIEW … sans l'option). Inerte fonctionnellement (seul
--    service_role, qui bypass RLS, lit la vue) mais rétablit la posture documentée.
CREATE VIEW plateforme.v_ops_jobs_pdf
  WITH (security_invoker = true) AS
  SELECT count(*)        FILTER (WHERE statut = 'pending')            AS nb_pending,
         count(*)        FILTER (WHERE statut = 'failed')             AS nb_failed,
         count(*)        FILTER (WHERE statut = 'dead')               AS nb_dead,
         max(attempts)   FILTER (WHERE statut IN ('failed','dead'))   AS max_attempts,
         min(created_at) FILTER (WHERE statut IN ('pending','failed')) AS plus_ancien_at
  FROM plateforme.jobs_pdf;

GRANT SELECT ON plateforme.v_ops_jobs_pdf TO service_role;
