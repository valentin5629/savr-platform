/**
 * savr-dev-cron — dev réagit comme la production (décisions Val 2026-11-13,
 * option C1). Ce fichier prouve que :
 *   - le projet planifie chaque cron de packages/plateforme/vercel.json, à la
 *     fréquence de la prod, sauf outbox-worker et polling-mts1 à 5 min ;
 *   - la fonction refuse tout appelant sans le secret du projet, toute route
 *     hors liste, et n'appelle dev qu'avec les deux secrets de dev ;
 *   - sa réponse ne contient ni secret ni corps de la route appelée.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { BASE_URL_DEV, ROUTES, appeler } from '../api/[route]';

const racine = resolve(__dirname, '../../..');
type Cron = { path: string; schedule: string };
const lire = (f: string) =>
  JSON.parse(readFileSync(resolve(racine, f), 'utf8')) as {
    crons: Cron[];
    functions?: Record<string, { maxDuration?: number }>;
  };
const prod = lire('packages/plateforme/vercel.json');
const dev = lire('apps/cron-dev/vercel.json');

// Écrites en dur (décisions Val #552 et 2026-11-12) : ne pas relire la source.
const EXCEPTIONS_ATTENDUES = ['outbox-worker', 'polling-mts1'];

describe('savr-dev-cron — planification', () => {
  it('chaque cron de la prod est planifié sur dev, et rien de plus', () => {
    expect(dev.crons.map((c) => c.path).sort()).toEqual(
      prod.crons.map((c) => c.path.replace('/api/cron/', '/api/')).sort(),
    );
  });

  it.each(prod.crons.map((c) => [c.path, c.schedule] as const))(
    '%s garde la fréquence de la prod (sauf exception voulue)',
    (path, schedule) => {
      const route = path.replace('/api/cron/', '');
      const planif = dev.crons.find((c) => c.path === `/api/${route}`);
      expect(planif?.schedule).toBe(
        EXCEPTIONS_ATTENDUES.includes(route) ? '*/5 * * * *' : schedule,
      );
    },
  );

  it('la liste des routes autorisées est celle des crons du projet', () => {
    expect([...ROUTES].sort()).toEqual(
      dev.crons.map((c) => c.path.replace('/api/', '')).sort(),
    );
  });

  it("la durée maximale de la fonction couvre celle d'une route (300 s)", () => {
    expect(dev.functions?.['api/[route].ts']?.maxDuration).toBe(300);
  });
});

const ENV = {
  CRON_SECRET: 'secret-du-projet',
  CRON_SECRET_DEV: 'secret-dev',
  VERCEL_BYPASS_DEV: 'contournement-dev',
};

function requete(route: string, auth?: string): Request {
  return new Request(`https://savr-dev-cron.vercel.app/api/${route}`, {
    headers: auth ? { authorization: auth } : {},
  });
}

function fetchQuiRend(statut: number, corps = 'corps-de-la-route') {
  return vi.fn(async () => new Response(corps, { status: statut }));
}

describe('savr-dev-cron — garde', () => {
  it.each([
    ['sans en-tête', undefined],
    ['mauvais secret', 'Bearer autre'],
    ['secret sans « Bearer »', 'secret-du-projet'],
    ['secret en préfixe', 'Bearer secret-du-projet-et-plus'],
  ])('refuse un appelant %s (401, aucun appel)', async (_nom, auth) => {
    const f = fetchQuiRend(200);
    const r = await appeler(requete('pdf-worker', auth), ENV, f);
    expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('refuse tout appel si CRON_SECRET du projet est absent', async () => {
    const f = fetchQuiRend(200);
    const env = { ...ENV, CRON_SECRET: undefined };
    const r = await appeler(requete('pdf-worker', 'Bearer '), env, f);
    expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it.each(['inconnue', 'cron/pdf-worker', '../cron/pdf-worker', ''])(
    'refuse la route « %s » (404, aucun appel)',
    async (route) => {
      const f = fetchQuiRend(200);
      const r = await appeler(
        requete(route, 'Bearer secret-du-projet'),
        ENV,
        f,
      );
      expect(r.status).toBe(404);
      expect(f).not.toHaveBeenCalled();
    },
  );

  it.each(['CRON_SECRET_DEV', 'VERCEL_BYPASS_DEV'])(
    "n'appelle pas dev sans %s (500)",
    async (nom) => {
      const f = fetchQuiRend(200);
      const r = await appeler(
        requete('pdf-worker', 'Bearer secret-du-projet'),
        { ...ENV, [nom]: undefined },
        f,
      );
      expect(r.status).toBe(500);
      expect(f).not.toHaveBeenCalled();
    },
  );
});

describe('savr-dev-cron — appel de dev', () => {
  it.each(ROUTES)(
    'appelle la route %s de dev avec les secrets de dev',
    async (route) => {
      const f = fetchQuiRend(200);
      const r = await appeler(
        requete(route, 'Bearer secret-du-projet'),
        ENV,
        f,
      );
      expect(r.status).toBe(200);
      expect(f).toHaveBeenCalledTimes(1);
      const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`${BASE_URL_DEV}/api/cron/${route}`);
      expect(init.headers).toEqual({
        Authorization: 'Bearer secret-dev',
        'x-vercel-protection-bypass': 'contournement-dev',
      });
    },
  );

  it('répond 502 quand la route de dev échoue, sans recopier son corps ni un secret', async () => {
    const f = fetchQuiRend(401, 'Bearer secret-dev contournement-dev');
    const r = await appeler(
      requete('pdf-worker', 'Bearer secret-du-projet'),
      ENV,
      f,
    );
    expect(r.status).toBe(502);
    const texte = await r.text();
    expect(JSON.parse(texte)).toEqual({ route: 'pdf-worker', statut: 401 });
    for (const s of Object.values(ENV)) expect(texte).not.toContain(s);
  });

  it('répond 502 quand dev ne répond pas', async () => {
    const f = vi.fn(async () => {
      throw new Error('réseau');
    });
    const r = await appeler(
      requete('pdf-worker', 'Bearer secret-du-projet'),
      ENV,
      f,
    );
    expect(r.status).toBe(502);
  });
});
