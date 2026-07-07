import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'packages/plateforme/src'),
      // recharts → stub léger EN TEST uniquement (le vrai recharts hang vitest
      // sous jsdom via ResizeObserver). Le build Next.js n'est pas concerné.
      recharts: path.resolve(
        __dirname,
        'packages/plateforme/test-stubs/recharts.tsx',
      ),
    },
  },
  test: {
    include: [
      'packages/**/*.{test,spec}.{ts,tsx}',
      // Renderer PDF (apps/pdf-renderer) : tests unitaires de templates/dispatch.
      // Titrés « M1.6 / … » et « M2.4 / … » → routés par test:module comme les packages.
      'apps/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '_DEV-FACING/**',
      '**/e2e/**',
    ],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
  },
});
