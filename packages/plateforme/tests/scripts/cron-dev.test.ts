/**
 * `pnpm cron:dev:installer` — dev réagit comme la production (décisions Val
 * 2026-11-13) : la base savr-dev appelle elle-même (pg_cron + pg_net) les routes
 * cron de vercel.json. Ce fichier prouve que :
 *   - chaque cron de vercel.json devient une tâche, à la fréquence de la prod,
 *     sauf outbox-worker et polling-mts1 à 5 min ;
 *   - le script SQL ne contient aucun secret et retire les tâches orphelines ;
 *   - la commande refuse toute base autre que savr-dev, et sans secret.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEV_PROJECT_REF } from '../../../shared/src/seed/constants.js';
import {
  BASE_URL_DEV,
  PREFIXE_TACHE,
  ROUTES_A_CINQ_MINUTES,
  planificationsDev,
  refuserHorsDev,
  sqlInstallation,
} from '../../../../scripts/cron-dev.js';

const racine = resolve(__dirname, '../../../..');
const vercel = JSON.parse(
  readFileSync(resolve(racine, 'packages/plateforme/vercel.json'), 'utf8'),
) as { crons: Array<{ path: string; schedule: string }> };

const plans = planificationsDev(vercel.crons);
const sql = sqlInstallation(plans);

describe('cron:dev:installer — couverture de vercel.json', () => {
  it('chaque cron de vercel.json devient une tâche, et rien de plus', () => {
    expect(plans.map((p) => `/api/cron/${p.route}`).sort()).toEqual(
      vercel.crons.map((c) => c.path).sort(),
    );
  });

  // Exceptions écrites en dur (décisions Val #552 et 2026-11-12) : le test ne
  // relit pas la liste de la source, sinon la retirer ne rougirait rien.
  const EXCEPTIONS_ATTENDUES = ['outbox-worker', 'polling-mts1'];

  it('les exceptions à 5 min sont exactement outbox-worker et polling-mts1', () => {
    expect([...ROUTES_A_CINQ_MINUTES].sort()).toEqual(EXCEPTIONS_ATTENDUES);
    const routes = plans.map((p) => p.route);
    for (const r of EXCEPTIONS_ATTENDUES) expect(routes).toContain(r);
  });

  it.each(vercel.crons.map((c) => [c.path, c.schedule] as const))(
    '%s est planifiée dans le SQL à la fréquence attendue',
    (path, schedule) => {
      const route = path.replace('/api/cron/', '');
      const attendue = EXCEPTIONS_ATTENDUES.includes(route)
        ? '*/5 * * * *'
        : schedule;
      expect(plans.find((p) => p.route === route)!.planification).toBe(
        attendue,
      );
      // La chaîne réellement écrite dans le script installé.
      expect(sql).toContain(
        `cron.schedule('${PREFIXE_TACHE}${route}', '${attendue}', `,
      );
      expect(sql).toContain(`url := '${BASE_URL_DEV}/api/cron/${route}'`);
    },
  );

  it('les tâches dont la route a quitté vercel.json sont retirées', () => {
    expect(sql).toMatch(
      /cron\.unschedule\(jobname\) FROM cron\.job\s+WHERE jobname LIKE 'savr-dev-%' AND jobname <> ALL/,
    );
  });

  it('refuse une route ou une planification illisible', () => {
    expect(() =>
      planificationsDev([
        { path: "/api/cron/x'; DROP", schedule: '* * * * *' },
      ]),
    ).toThrow(/route/);
    expect(() =>
      planificationsDev([{ path: '/api/cron/x', schedule: "* * * * *'" }]),
    ).toThrow(/planification/);
  });
});

describe('cron:dev:installer — secrets', () => {
  it('le script lit les secrets dans son environnement, sans les contenir', () => {
    expect(sql).toContain('\\getenv secret_cron CRON_SECRET_DEV');
    expect(sql).toContain('\\getenv secret_bypass VERCEL_BYPASS_DEV');
    // La lecture des secrets ne s'affiche pas.
    expect(sql).toMatch(
      /\\o \/dev\/null\nSELECT set_config\('savr\.secret_cron'[\s\S]*?\n\\o\n/,
    );
  });

  it('ferme pg_net à tout autre rôle que celui des tâches', () => {
    expect(sql).toContain(
      'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated;',
    );
  });
});

describe('cron:dev:installer — garde « savr-dev seulement »', () => {
  const secrets = { CRON_SECRET_DEV: 'a', VERCEL_BYPASS_DEV: 'b' };
  const POOLER = `postgresql://postgres.${DEV_PROJECT_REF}:mdp@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`;
  const DIRECT = `postgresql://postgres:mdp@db.${DEV_PROJECT_REF}.supabase.co:5432/postgres`;

  it.each([POOLER, DIRECT])('accepte la base savr-dev (%s)', (url) => {
    expect(() => refuserHorsDev({ DIRECT_URL: url, ...secrets })).not.toThrow();
  });

  const refus: Array<[string, Record<string, string | undefined>]> = [
    ['URL absente', { ...secrets }],
    ['URL illisible', { DIRECT_URL: 'pas-une-url', ...secrets }],
    [
      'un autre projet via le pooler',
      {
        DIRECT_URL: POOLER.replace(DEV_PROJECT_REF, 'abcdefghijklmnopqrst'),
        ...secrets,
      },
    ],
    [
      'un autre projet en direct',
      {
        DIRECT_URL: DIRECT.replace(DEV_PROJECT_REF, 'abcdefghijklmnopqrst'),
        ...secrets,
      },
    ],
    [
      'la référence dev sur un autre hôte',
      {
        DIRECT_URL: `postgresql://postgres.${DEV_PROJECT_REF}:mdp@exemple.test:5432/postgres`,
        ...secrets,
      },
    ],
    [
      'un déploiement Vercel',
      { DIRECT_URL: POOLER, VERCEL_ENV: 'preview', ...secrets },
    ],
    [
      'NODE_ENV=production',
      { DIRECT_URL: POOLER, NODE_ENV: 'production', ...secrets },
    ],
    ['secret des crons absent', { DIRECT_URL: POOLER, VERCEL_BYPASS_DEV: 'b' }],
    [
      'secret de contournement absent',
      { DIRECT_URL: POOLER, CRON_SECRET_DEV: 'a' },
    ],
  ];

  it.each(refus)('refuse : %s', (_nom, env) => {
    expect(() => refuserHorsDev(env)).toThrow(/refusé/);
  });
});
