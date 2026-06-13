import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const config: NextConfig = {
  transpilePackages: ['@savr/shared'],
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
