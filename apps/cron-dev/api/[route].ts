/**
 * savr-dev-cron — lance sur dev les traitements planifiés de la production
 * (décisions Val 2026-11-13 : « dev doit réagir comme la prod », option C1).
 *
 * Vercel ne lance les crons de `packages/plateforme/vercel.json` que sur le
 * déploiement de production de l'app. Ce mini-projet Vercel, séparé et sans
 * aucun code ni accès de l'app, a ses propres crons (`apps/cron-dev/vercel.json`,
 * mêmes routes et mêmes fréquences, outbox-worker et polling-mts1 à 5 min) : à
 * chaque passage, Vercel appelle `GET /api/<route>` ici, et cette fonction
 * appelle à son tour `GET <alias dev>/api/cron/<route>`.
 *
 * Écartés (mesurés le 2026-11-13) : le workflow GitHub `cron-dev.yml`, dont
 * GitHub sautait la plupart des passages (aucun de 07:44 à 10:37 UTC) ; pg_cron +
 * pg_net dans savr-dev, car Supabase ouvre pg_net à anon et authenticated sans
 * que notre rôle puisse le refermer.
 *
 * Variables du projet Vercel `savr-dev-cron` (jamais dans le dépôt) :
 *   CRON_SECRET        propre à ce projet ; Vercel l'envoie à chaque passage de
 *                      cron, et il refuse tout autre appelant
 *   CRON_SECRET_DEV    = CRON_SECRET de l'environnement Preview de l'app
 *   VERCEL_BYPASS_DEV  = secret « Protection Bypass for Automation » de l'app
 *
 * Ces routes écrivent dans la base de dev PARTAGÉE comme en production, et ce
 * qu'elles écrivent ne se défait pas (clôtures, numéros de documents, PDF,
 * appels réels aux prestataires). La réponse ne renvoie jamais le corps de la
 * route appelée ni un secret : seulement la route et son code HTTP.
 */
/* eslint-disable no-console -- journal Vercel du projet savr-dev-cron : seule
   trace de chaque passage (route et code HTTP, jamais de secret). */
import { timingSafeEqual } from 'node:crypto';

/** Alias stable du dernier déploiement de la branche `dev` de l'app. */
export const BASE_URL_DEV =
  'https://savr-platform-git-dev-savr-s-projects.vercel.app';

/** Routes autorisées : celles de `apps/cron-dev/vercel.json` (cliquet). */
export const ROUTES: readonly string[] = [
  'cloture-embargo',
  'outbox-worker',
  'polling-mts1',
  'batch-pdf-j1',
  'pdf-worker',
  'batch-brouillons-j1',
  'pennylane-retry',
  'email-retry',
  'process-attributions-ag',
  'revalidation-siret',
  'polling-pennylane',
  'refresh-benchmark',
  'notify-pack-etat',
  'purge-logs',
];

/** Sous la durée maximale de la fonction (300 s, vercel.json). */
export const DELAI_APPEL_MS = 290_000;

type Env = Record<string, string | undefined>;

function reponse(statut: number, corps: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}

/** Comparaison en temps constant (longueurs différentes : refus). */
function egal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function appeler(
  request: Request,
  env: Env,
  f: typeof fetch,
): Promise<Response> {
  const secret = env['CRON_SECRET'];
  const recu = request.headers.get('authorization') ?? '';
  // Sans secret configuré : refus (jamais d'ouverture par défaut).
  if (!secret || !egal(recu, `Bearer ${secret}`)) {
    return reponse(401, { erreur: 'non autorisé' });
  }

  const route = new URL(request.url).pathname.replace(/^\/api\//, '');
  if (!ROUTES.includes(route)) {
    return reponse(404, { erreur: 'route inconnue' });
  }

  const secretDev = env['CRON_SECRET_DEV'];
  const contournement = env['VERCEL_BYPASS_DEV'];
  if (!secretDev || !contournement) {
    return reponse(500, { route, erreur: 'secrets de dev absents' });
  }

  let r: Response;
  try {
    r = await f(`${BASE_URL_DEV}/api/cron/${route}`, {
      headers: {
        Authorization: `Bearer ${secretDev}`,
        'x-vercel-protection-bypass': contournement,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(DELAI_APPEL_MS),
    });
  } catch {
    console.error(`${route} -> appel impossible`);
    return reponse(502, { route, erreur: 'appel impossible' });
  }
  console.log(`${route} -> HTTP ${r.status}`);
  return reponse(r.ok ? 200 : 502, { route, statut: r.status });
}

export function GET(request: Request): Promise<Response> {
  return appeler(request, process.env, fetch);
}
