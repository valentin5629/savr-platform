-- Format des clés de logo : « <bucket>/logos/<uuid>.(png|jpg) » (revue sécurité 2026-09-18).
--
-- Faille : `authenticated` a UPDATE colonne-level sur organisations.logo_url
-- (20260616130000) et le schéma plateforme est exposé à PostgREST. Un gestionnaire,
-- traiteur_manager ou une agence pouvait écrire n'importe quelle clé R2
-- (« <bucket>/bordereaux/… ») dans son logo, en contournant les routes API ; la
-- synthèse PDF et les batchs PDF téléchargent ensuite cette clé et l'inlinent dans
-- le PDF remis à l'utilisateur → exfiltration d'objets R2 d'autres organisations.
-- La garde principale est applicative (lib/logo-key.ts : bucket = R2_BUCKET_NAME
-- + préfixe logos/) ; ce trigger ferme l'écriture à la source.
--
-- Format = celui que produisent les 3 routes d'upload (admin, traiteur, gestionnaire) :
-- `${bucket}/logos/${randomUUID()}.${png|jpg}`. NULL et '' restent admis (logo retiré).
--
-- Même usage PDF → mêmes colonnes gardées : associations.logo_url (rapports AG) et
-- evenements.logo_client_organisateur_url (cascade logo du rapport, reçu tel quel
-- dans le corps de POST /programmation/evenements).
--
-- Backward-compatible : un trigger (et non un CHECK) ne contrôle la valeur QUE si
-- elle change. Une éventuelle valeur héritée hors format n'est ni rejetée ni ne
-- bloque les UPDATE des autres colonnes de la ligne (un CHECK NOT VALID, lui, est
-- réévalué à chaque UPDATE de la ligne). La lecture applicative ignore déjà ces
-- valeurs (fallback en-tête Savr).
--
-- Accès : ferme une écriture (aucun GRANT, aucune policy). Fonction de trigger
-- SECURITY INVOKER, EXECUTE retiré à tous les rôles applicatifs (le privilège n'est
-- vérifié qu'au CREATE TRIGGER, pas au déclenchement).

CREATE OR REPLACE FUNCTION plateforme.fn_garde_format_logo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_col text := TG_ARGV[0];
  v_new text := to_jsonb(NEW) ->> v_col;
BEGIN
  IF TG_OP = 'UPDATE' AND v_new IS NOT DISTINCT FROM (to_jsonb(OLD) ->> v_col) THEN
    RETURN NEW;
  END IF;
  -- Miroir SQL de parseCleLogo (lib/logo-key.ts). Regex inlinée : la
  -- fonction de trigger s'exécute sous le rôle appelant (authenticated), qui n'a
  -- EXECUTE sur aucun helper.
  IF v_new IS NOT NULL AND v_new <> ''
     AND v_new !~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]/logos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$'
  THEN
    RAISE EXCEPTION '%.% : clé de logo invalide (attendu <bucket>/logos/<uuid>.png|jpg)',
      TG_TABLE_NAME, v_col
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION plateforme.fn_garde_format_logo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_garde_format_logo ON plateforme.organisations;
CREATE TRIGGER trg_garde_format_logo
  BEFORE INSERT OR UPDATE OF logo_url ON plateforme.organisations
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_garde_format_logo('logo_url');

DROP TRIGGER IF EXISTS trg_garde_format_logo ON plateforme.associations;
CREATE TRIGGER trg_garde_format_logo
  BEFORE INSERT OR UPDATE OF logo_url ON plateforme.associations
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_garde_format_logo('logo_url');

DROP TRIGGER IF EXISTS trg_garde_format_logo ON plateforme.evenements;
CREATE TRIGGER trg_garde_format_logo
  BEFORE INSERT OR UPDATE OF logo_client_organisateur_url ON plateforme.evenements
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_garde_format_logo('logo_client_organisateur_url');

COMMENT ON TRIGGER trg_garde_format_logo ON plateforme.organisations IS
  'Refuse une clé de logo hors format <bucket>/logos/<uuid>.(png|jpg) (exfiltration R2 via le PDF, revue sécurité 2026-09-18). Contrôle seulement si la valeur change.';

-- ROLLBACK (rouvre l'écriture libre des clés de logo : décision explicite de Val,
-- CLAUDE.md §12-2bis) : supprimer les 3 triggers trg_garde_format_logo, puis la
-- fonction fn_garde_format_logo.
