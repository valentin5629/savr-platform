import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
      // Tooling d'audit hors runtime applicatif : workflows (globals injectés
      // agent/pipeline/log/args) + scripts de recompte de registres (Node CLI).
      'docs/audit/**',
      '.claude/workflows/**',
      // Worktrees git imbriqués (sessions parallèles isolées) : checkouts
      // indépendants avec leur propre cycle de lint — jamais linter depuis le
      // clone parent, sinon leur code en cours casse le gate pre-commit ici.
      '.claude/worktrees/**',
      // Types DB générés (G7) : artefact dérivé du schéma (régénéré par
      // `pnpm db:types:local`) — jamais édité à la main, ne pas lint-churner.
      'packages/shared/src/database.types.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // R15 (BL-P1-OBS-01) : tout log de prod passe par le logger @savr/shared
      // (§07/01, sanitizePayload). Les `console.*` ad-hoc sont interdits — sauf
      // les puits sanctionnés + l'outillage CLI ci-dessous (overrides).
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  // Puits stdout sanctionné du logger (émet via console.log) + puits d'erreur
  // Slack (fallback console.error si l'alerte HTTP échoue).
  {
    files: [
      'packages/shared/src/logger/**/*.ts',
      'packages/shared/src/alerting/slack.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  // Outillage CLI dev (seed, scripts de gates/registres) + microservice Railway
  // pdf-renderer (Express standalone, hors runtime applicatif Next.js) : console
  // légitime (bootstrap / logs infra). Le périmètre no-console = plateforme+adapters.
  {
    files: [
      'packages/shared/src/seed/**/*.ts',
      'scripts/**/*.ts',
      'apps/pdf-renderer/**/*.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  // Fichiers de test : console.log de debug toléré (jamais du code de prod).
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    rules: { 'no-console': 'off' },
  },
);
