import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const config: NextConfig = {
  transpilePackages: ['@savr/shared'],
  env: {
    // Environnement Sentry figé AU BUILD (lu serveur ET navigateur) : Vercel pose
    // NODE_ENV=production en Preview comme en Production, seul VERCEL_ENV les
    // distingue (production = app.gosavr.io / base prod, preview = base dev).
    // Hors Vercel (poste local) : « local ».
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? 'local',
  },
  experimental: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    },
  },
};

export default withSentryConfig(config, {
  org: 'savr-aq',
  project: 'javascript-nextjs',
  // Source maps uploadés uniquement en prod (pas de token en dev)
  silent: true,
  disableLogger: true,
  // Pas de auto-instrumentation (on gère via le sink injectable)
  autoInstrumentServerFunctions: false,
  autoInstrumentMiddleware: false,
  autoInstrumentAppDirectory: false,
  widenClientFileUpload: false,
  sourcemaps: { disable: true },
});
