import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import os from 'node:os';

// Parallélisme LOCAL borné — pourquoi.
//
// Par défaut Vitest ouvre un worker par cœur. Sur le poste de dev, plusieurs
// sessions Claude Code travaillent en parallèle, et chacune rejoue la suite
// ENTIÈRE à deux moments imposés par le harnais : au commit (`pre-commit-gate`)
// et à la création de PR (`gate-pr`). Trois sessions × 10 cœurs = 30 workers
// pour 10 cœurs : chaque test reçoit trois fois moins de CPU qu'il n'en a besoin.
//
// Les tests de rendu attendent que le DOM se stabilise dans un budget d'HORLOGE
// (`ATTENTE_UI` = 4 s, plafond du cas = `ATTENTE_CAS_MS`). Sous cette
// sur-souscription, ce budget est consommé par l'attente du processeur, pas par
// le travail — et le cas expire sans aucune régression de code.
//
// Mesuré le 2026-09-23, même commit, aucune ligne changée entre les essais :
// 6 exécutions de `test:unit` ont donné 12, 1, 0, 4, 0 puis 6 échecs, tous des
// dépassements de délai, jamais deux fois les mêmes cas, avec une charge machine
// montée jusqu'à 90. En isolation, les mêmes fichiers passent en 3 s.
//
// La borne est DÉRIVÉE du nombre de cœurs (÷3), pas choisie au doigt mouillé :
// elle vise à laisser trois sessions coexister sans sur-souscrire la machine.
// En CI, un seul job tourne sur une machine dédiée à 2-4 cœurs : y appliquer la
// même borne ne ferait que ralentir, donc on garde le défaut.
//
// ⚠ Ne pas « corriger » ce flottement en relevant `testTimeout` : ça masquerait
// aussi les vraies lenteurs. Cf. l'en-tête de `src/test-utils/attente-ui.ts`.
const COEURS = os.availableParallelism?.() ?? os.cpus().length;
const WORKERS_LOCAUX = Math.max(2, Math.floor(COEURS / 3));

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
    // ⚠ `minWorkers` est OBLIGATOIRE dès qu'on pose `maxWorkers` : laissé libre, il
    // vaut le nombre de cœurs, donc plus que le plafond, et Tinypool refuse de
    // démarrer (« options.minThreads and options.maxThreads must not conflict »).
    // Vitest ne rattrape pas l'incohérence : la commande rend « no tests » avec
    // une erreur non gérée — un faux vert si on ne lit que le compte d'échecs.
    ...(process.env.CI ? {} : { maxWorkers: WORKERS_LOCAUX, minWorkers: 1 }),
  },
});
