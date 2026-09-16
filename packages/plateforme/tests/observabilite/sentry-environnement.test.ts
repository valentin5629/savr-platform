/**
 * Environnement Sentry dérivé de VERCEL_ENV au build (next.config.ts `env`).
 *
 * Vercel pose NODE_ENV=production en Preview (base dev) comme en Production
 * (app.gosavr.io) : sans VERCEL_ENV, les erreurs des deux environnements
 * arrivaient sous la même étiquette et ne se distinguaient pas.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NextConfig } from 'next';

async function configNext(): Promise<NextConfig> {
  vi.resetModules();
  const exporte = (await import('../../next.config')).default as
    | NextConfig
    | ((phase: string, ctx: { defaultConfig: NextConfig }) => NextConfig);
  return typeof exporte === 'function'
    ? exporte('phase-production-build', { defaultConfig: {} })
    : exporte;
}

describe('M0.9 — environnement Sentry : Preview et Production distingués', () => {
  const vercelEnvAvant = process.env.VERCEL_ENV;

  afterEach(() => {
    if (vercelEnvAvant === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = vercelEnvAvant;
  });

  it.each(['production', 'preview'])(
    'VERCEL_ENV=%s → NEXT_PUBLIC_SENTRY_ENVIRONMENT identique',
    async (env) => {
      process.env.VERCEL_ENV = env;
      const config = await configNext();
      expect(config.env?.['NEXT_PUBLIC_SENTRY_ENVIRONMENT']).toBe(env);
    },
  );

  it('hors Vercel (poste local) → « local », jamais « production »', async () => {
    delete process.env.VERCEL_ENV;
    const config = await configNext();
    expect(config.env?.['NEXT_PUBLIC_SENTRY_ENVIRONMENT']).toBe('local');
  });
});
