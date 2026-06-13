export interface SentryContext {
  role?: string | null;
  organisation_id?: string | null;
  trace_id?: string | null;
}

export interface SentrySink {
  captureException(error: Error, context: SentryContext): void;
}

// Sink no-op utilisé quand SENTRY_DSN est absent (tests, CI)
class NoopSentrySink implements SentrySink {
  captureException(_error: Error, _context: SentryContext) {
    // intentionally empty
  }
}

let _sink: SentrySink = new NoopSentrySink();

export function setSentrySink(sink: SentrySink) {
  _sink = sink;
}

export function captureException(error: Error, context: SentryContext = {}) {
  _sink.captureException(error, context);
}
