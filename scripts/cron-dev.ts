/**
 * Installe sur savr-dev les traitements planifiés de la production, lancés par
 * la base elle-même (pg_cron + pg_net), pour que dev réagisse comme la prod
 * (décisions Val 2026-11-13).
 *
 *   pnpm cron:dev:installer
 *
 * Vercel ne lance les crons de `packages/plateforme/vercel.json` que sur le
 * déploiement de production. Le workflow GitHub qui les appelait sur dev
 * (`cron-dev.yml`, #791) sautait la plupart des passages : mesuré le 2026-11-13,
 * aucun passage planifié de 07:44 à 10:37 UTC malgré une planification à 5 min,
 * donc des rapports jamais fabriqués. pg_cron passe à la minute et ne coûte rien.
 *
 * La liste des routes et leurs fréquences sont lues dans vercel.json à chaque
 * installation : un cron ajouté à la prod est installé sur dev au passage suivant
 * de cette commande. Seule différence voulue : outbox-worker et polling-mts1
 * passent toutes les 5 min au lieu de 15 (décisions Val #552 et 2026-11-12).
 *
 * Chaque tâche appelle `GET <alias dev>/api/cron/<route>` avec le secret des
 * crons et le secret de contournement de la protection Vercel. Les deux sont lus
 * dans `.env.local` (`CRON_SECRET_DEV`, `VERCEL_BYPASS_DEV`), rangés dans le
 * coffre de la base (Vault) et jamais écrits dans le dépôt, la ligne de commande
 * ou la sortie. L'installation est rejouable : elle remplace les tâches
 * `savr-dev-*` et retire celles dont la route a quitté vercel.json.
 *
 * Dev seulement : refuse toute base autre que savr-dev. Ces routes écrivent dans
 * la base de dev PARTAGÉE comme en production, et ce qu'elles écrivent ne se
 * défait pas (clôtures, numéros de documents, PDF, appels réels aux
 * prestataires). Jamais en production : la prod a les crons Vercel.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { DEV_PROJECT_REF } from '../packages/shared/src/seed/constants.js';

/** Alias stable du dernier déploiement de la branche `dev` (base savr-dev). */
export const BASE_URL_DEV =
  'https://savr-platform-git-dev-savr-s-projects.vercel.app';

/** Préfixe des tâches pg_cron posées par cette commande. */
export const PREFIXE_TACHE = 'savr-dev-';

/** Noms des secrets dans le coffre (Vault) de savr-dev. */
export const SECRET_CRON = 'savr_dev_cron_secret';
export const SECRET_BYPASS = 'savr_dev_vercel_bypass';

/** Routes passées toutes les 5 min sur dev au lieu de 15 (décisions Val). */
export const ROUTES_A_CINQ_MINUTES = ['outbox-worker', 'polling-mts1'];

/** Durée maximale la plus longue des routes (300 s) + marge. */
export const DELAI_APPEL_MS = 330_000;

export interface Planification {
  route: string;
  planification: string;
}

/** Les crons de vercel.json, avec la seule différence voulue sur dev. */
export function planificationsDev(
  crons: Array<{ path: string; schedule: string }>,
): Planification[] {
  return crons.map((c) => {
    const route = c.path.replace(/^\/api\/cron\//, '');
    if (!/^[a-z0-9-]+$/.test(route)) {
      throw new Error(`route de cron illisible : ${c.path}`);
    }
    if (!/^[0-9*/,\- ]+$/.test(c.schedule)) {
      throw new Error(`planification illisible : ${c.schedule}`);
    }
    return {
      route,
      planification: ROUTES_A_CINQ_MINUTES.includes(route)
        ? '*/5 * * * *'
        : c.schedule,
    };
  });
}

/**
 * Script psql d'installation. Il ne contient aucun secret : les valeurs sont
 * lues par `\getenv` dans l'environnement du processus psql. Limite : psql les
 * substitue dans le texte de l'instruction `set_config`, qu'il ré-afficherait
 * en partie si cette instruction échouait (et que le journal du serveur peut
 * garder) ; sa sortie normale est coupée par `\o /dev/null`.
 */
export function sqlInstallation(plans: Planification[]): string {
  const taches = plans.map((p) => {
    const commande = `SELECT net.http_get(
    url := '${BASE_URL_DEV}/api/cron/${p.route}',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${SECRET_CRON}'),
      'x-vercel-protection-bypass', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${SECRET_BYPASS}')
    ),
    timeout_milliseconds := ${DELAI_APPEL_MS}
  )`;
    return `SELECT cron.schedule('${PREFIXE_TACHE}${p.route}', '${p.planification}', $tache$${commande}$tache$);`;
  });
  const noms = plans.map((p) => `'${PREFIXE_TACHE}${p.route}'`).join(', ');

  return `\\set ON_ERROR_STOP on
\\getenv secret_cron CRON_SECRET_DEV
\\getenv secret_bypass VERCEL_BYPASS_DEV
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
-- pg_net n'est appelé que par les tâches (rôle postgres) : personne d'autre.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated;

\\o /dev/null
SELECT set_config('savr.secret_cron', :'secret_cron', true),
       set_config('savr.secret_bypass', :'secret_bypass', true);
\\o
DO $coffre$
DECLARE
  nom text;
  valeur text;
BEGIN
  FOREACH nom IN ARRAY ARRAY['${SECRET_CRON}', '${SECRET_BYPASS}'] LOOP
    valeur := current_setting(
      CASE nom WHEN '${SECRET_CRON}' THEN 'savr.secret_cron' ELSE 'savr.secret_bypass' END
    );
    IF coalesce(valeur, '') = '' THEN
      RAISE EXCEPTION 'secret vide : %', nom;
    END IF;
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = nom) THEN
      PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name = nom), valeur);
    ELSE
      PERFORM vault.create_secret(valeur, nom);
    END IF;
  END LOOP;
END
$coffre$;

${taches.join('\n')}

SELECT cron.unschedule(jobname) FROM cron.job
 WHERE jobname LIKE '${PREFIXE_TACHE}%' AND jobname <> ALL (ARRAY[${noms}]);
COMMIT;

SELECT jobname, schedule FROM cron.job WHERE jobname LIKE '${PREFIXE_TACHE}%' ORDER BY jobname;
`;
}

/**
 * Lève si l'environnement ne désigne pas, sans ambiguïté, la base savr-dev, ou
 * si un secret manque. `DIRECT_URL` est la connexion qu'ouvre la commande.
 */
export function refuserHorsDev(env: Record<string, string | undefined>): void {
  if (env['VERCEL_ENV']) {
    throw new Error(
      'refusé : commande locale, jamais sur un déploiement Vercel.',
    );
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error('refusé : NODE_ENV=production.');
  }
  let url: URL | null = null;
  try {
    url = new URL(env['DIRECT_URL'] ?? '');
  } catch {
    // URL absente ou illisible : `url` reste null, donc refus ci-dessous.
  }
  const viaPooler =
    url?.username === `postgres.${DEV_PROJECT_REF}` &&
    /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com(:[0-9]+)?$/.test(url.host);
  const direct =
    url?.username === 'postgres' &&
    url.hostname === `db.${DEV_PROJECT_REF}.supabase.co`;
  if (
    !url ||
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !(viaPooler || direct)
  ) {
    throw new Error('refusé : DIRECT_URL ne désigne pas la base savr-dev.');
  }
  for (const nom of ['CRON_SECRET_DEV', 'VERCEL_BYPASS_DEV']) {
    if (!env[nom]) {
      throw new Error(`refusé : ${nom} absent de .env.local.`);
    }
  }
}

export function main(): void {
  // En premier, avant toute connexion : c'est la seule barrière.
  refuserHorsDev(process.env);
  const url = new URL(process.env['DIRECT_URL']!);
  const vercel = JSON.parse(
    readFileSync(
      new URL('../packages/plateforme/vercel.json', import.meta.url),
      'utf8',
    ),
  ) as { crons: Array<{ path: string; schedule: string }> };
  const plans = planificationsDev(vercel.crons);

  // Connexion par variables d'environnement : ni mot de passe ni secret dans
  // la ligne de commande (visible de `ps`).
  const resultat = spawnSync('psql', ['-X', '-q', '-A', '-F', ' | '], {
    input: sqlInstallation(plans),
    stdio: ['pipe', 'inherit', 'inherit'],
    env: {
      NODE_ENV: 'development',
      PATH: process.env['PATH'],
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
      PGSSLMODE: 'require',
      CRON_SECRET_DEV: process.env['CRON_SECRET_DEV'],
      VERCEL_BYPASS_DEV: process.env['VERCEL_BYPASS_DEV'],
    },
  });
  if (resultat.error) throw resultat.error;
  if (resultat.status !== 0) {
    throw new Error(`échec : psql a rendu ${resultat.status}.`);
  }
  console.log(`${plans.length} tâches installées sur savr-dev.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (err: unknown) {
    console.error(
      `cron:dev:installer — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}
