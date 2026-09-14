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
      // specs/ = miroir DÉRIVÉ du Vault CDC (jamais du runtime applicatif) :
      // Markdown + artefacts CDC (ex. savr-api-contracts/validate.mjs, script de
      // validation JSON Schema en Node CLI) — jamais linté.
      'specs/**',
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
      // Fuseau métier unique (Europe/Paris) — voir packages/shared/src/temps/.
      // Sans ces règles, le jour et l'heure dépendent du fuseau du process : UTC
      // sur Vercel / Railway / CI, Europe/Paris sur un poste de dev — donc des
      // bugs invisibles en local (jour décalé entre 22h et minuit, heure affichée
      // 2h en arrière l'été).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.callee.property.name='toISOString'][callee.property.name=/^(slice|split|substring|substr)$/]",
          message:
            "Jour calculé en UTC : toISOString() renvoie la VEILLE entre 22h et minuit à Paris. Utiliser jourParis() de '@savr/shared/src/temps/index.js'.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)String$/]:not(:has(ObjectExpression > Property[key.name='timeZone']))",
          message:
            "Date formatée dans le fuseau du process (UTC en prod). Ajouter { timeZone: 'Europe/Paris' } ou utiliser formatDateParis/formatHeureParis de '@savr/shared/src/temps/index.js'.",
        },
        {
          selector:
            "CallExpression[callee.property.name='toLocaleString']:has(ObjectExpression > Property[key.name=/^(day|month|year|weekday|hour|minute|second|dateStyle|timeStyle)$/]):not(:has(ObjectExpression > Property[key.name='timeZone']))",
          message:
            "Date formatée dans le fuseau du process (UTC en prod). Ajouter { timeZone: 'Europe/Paris' }.",
        },
        {
          selector:
            "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']:not(:has(Property[key.name='timeZone']))",
          message:
            "Intl.DateTimeFormat sans timeZone : suit le fuseau du process (UTC en prod). Ajouter timeZone: 'Europe/Paris' — ou utiliser les helpers de '@savr/shared/src/temps/index.js'.",
        },
        {
          selector: "NewExpression[callee.name='Date'] > TemplateLiteral",
          message:
            "Instant construit depuis une chaîne : interprété dans le fuseau du process (UTC en prod). Utiliser instantParis(jour, heure) pour une heure murale, ou les helpers de calendrier (decalerJour, lundiDeLaSemaine, formatJour) pour une valeur date-seule — '@savr/shared/src/temps/index.js'.",
        },
        {
          selector:
            "Property[key.name='timeZone'][value.type='Literal'][value.value!='Europe/Paris']",
          message:
            "Fuseau autre qu'Europe/Paris : le projet n'en a qu'un (§16). Exception délibérée → eslint-disable avec justification.",
        },
        {
          selector:
            "CallExpression[callee.object.type='NewExpression'][callee.object.callee.name='Date'][callee.property.name='toLocaleString']:not(:has(ObjectExpression > Property[key.name='timeZone']))",
          message:
            "Horodatage formaté dans le fuseau du process (UTC en prod). Ajouter { timeZone: 'Europe/Paris' } ou utiliser formatDateHeureParis de '@savr/shared/src/temps/index.js'.",
        },
      ],
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
