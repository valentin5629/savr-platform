import * as Sentry from '@sentry/nextjs';
import { setSentrySink } from '@savr/shared/src/alerting/sentry.js';
import { filtrerBreadcrumb, filtrerEvenement } from './src/lib/sentry-filtrage';

// ⚠ CHARGEMENT : ce fichier n'est exécuté QUE par `register()` de
// `src/instrumentation.ts` (Next 15 + @sentry/nextjs 10 ne l'injectent plus
// d'eux-mêmes). Sans ce fichier d'instrumentation, le sink restait le no-op et
// tout `captureException` serveur était perdu (constat revue #338, 2026-09-16).
// Cliquet : tests/observabilite/sentry-serveur-initialise.test.ts.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // production | preview | local — cf. next.config.ts (env).
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    // `integrations: []` ne désactive PAS les intégrations par défaut (v8+) :
    // breadcrumbs des fetch sortants et données de requête restent collectés.
    // D'où le filtrage ci-dessous, obligatoire (jeton Slack dans le chemin d'URL).
    integrations: [],
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeBreadcrumb: (breadcrumb) => filtrerBreadcrumb(breadcrumb),
    beforeSend: (event) => filtrerEvenement(event),
  });

  setSentrySink({
    captureException(error, context) {
      Sentry.withScope((scope) => {
        if (context.role) scope.setTag('role', context.role);
        if (context.organisation_id)
          scope.setTag('organisation_id', context.organisation_id);
        if (context.trace_id) scope.setTag('trace_id', context.trace_id);
        Sentry.captureException(error);
      });
    },
  });
}
