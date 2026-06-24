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
      // Types DB générés (G7) : artefact dérivé du schéma (régénéré par
      // `pnpm db:types:local`) — jamais édité à la main, ne pas lint-churner.
      'packages/shared/src/database.types.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
);
