import * as Sentry from '@sentry/nextjs';
import { setSentrySink } from '@savr/shared/src/alerting/sentry.js';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Pas de session replay, pas de tracing — Error monitoring only (V1)
    integrations: [],
    tracesSampleRate: 0,
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
