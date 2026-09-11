/**
 * Cliquet — tout cron déclaré dans vercel.json doit répondre en GET.
 *
 * Vercel Cron invoque les chemins planifiés en HTTP GET (avec `Authorization: Bearer
 * $CRON_SECRET`). Jusqu'au 2026-09-11, 13 des 14 routes n'exportaient que POST (et 3
 * avaient un GET qui renvoyait 405 exprès) : en production, CHAQUE appel du scheduler
 * finissait en 405 — aucun cron n'avait jamais tourné (polling MTS-1, outbox, clôture
 * H+24, batchs PDF, Pennylane). Divergence CRON_20260911_methode-get.
 *
 * Le test part de vercel.json (source de ce que Vercel appelle réellement) : un cron
 * ajouté demain sans GET fait rougir la CI. Un GET sans jeton doit tomber sur la garde
 * fail-closed (401) — ni 405 (GET factice), ni 200 (route ouverte).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Rien ne doit être appelé : la garde répond avant tout accès aux dépendances.
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: vi.fn(() => {
    throw new Error('garde franchie : la base ne devait pas être touchée');
  }),
}));
vi.mock('@savr/adapters/src/outbox-worker.js', () => ({
  runOutboxWorker: vi.fn(),
}));
vi.mock('@savr/adapters/src/index.js', () => ({
  getLogistiqueProvider: vi.fn(),
}));

const vercel = JSON.parse(
  readFileSync(resolve(__dirname, '../../../vercel.json'), 'utf8'),
) as { crons: Array<{ path: string }> };

const CRONS = vercel.crons.map((c) => c.path.replace(/^\/api\/cron\//, ''));

type RouteModule = { GET?: (req: Request) => Promise<Response> };
// Import relatif avec extension explicite : résolu par Vite (dynamic-import-vars), chemin
// dérivé de vercel.json — un cron déclaré sans fichier de route fait échouer l'import.
const charger = (nom: string): Promise<RouteModule> =>
  import(`../../../src/app/api/cron/${nom}/route.ts`);

describe('crons Vercel — invoqués en GET (cliquet vercel.json)', () => {
  beforeEach(() => {
    process.env['CRON_SECRET'] = 'test-secret';
  });
  afterEach(() => {
    delete process.env['CRON_SECRET'];
  });

  it('vercel.json déclare bien des crons (garde anti-vacuité)', () => {
    expect(CRONS.length).toBeGreaterThanOrEqual(14);
  });

  for (const nom of CRONS) {
    it(`${nom} : exporte GET, et un GET sans jeton → 401 (garde fail-closed)`, async () => {
      const mod = await charger(nom);
      expect(typeof mod.GET).toBe('function');

      const res = await mod.GET!(
        new Request(`http://localhost/api/cron/${nom}`, { method: 'GET' }),
      );
      expect(res.status).toBe(401);
    });
  }
});
