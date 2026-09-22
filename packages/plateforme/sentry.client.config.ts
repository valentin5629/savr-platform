import * as Sentry from '@sentry/nextjs';
import { setSentrySink } from '@savr/shared/src/alerting/sentry.js';
import { filtrerBreadcrumb, filtrerEvenement } from './src/lib/sentry-filtrage';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // production | preview | local — cf. next.config.ts (env).
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    // Pas de session replay, pas de tracing — Error monitoring only (V1)
    integrations: [],
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Même filtrage que le serveur : les breadcrumbs de navigation gardent
    // l'URL complète, fragment compris (`#access_token=` d'un lien Supabase).
    beforeBreadcrumb: (breadcrumb) => filtrerBreadcrumb(breadcrumb),
    beforeSend: (event) => filtrerEvenement(event),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
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
