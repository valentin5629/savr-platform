import type { LogContext, LogEntry, LogLevel, ServiceName } from './types.js';

export type { LogContext, LogEntry, LogLevel, ServiceName };

let _context: LogContext = {};

export function setLogContext(ctx: LogContext) {
  _context = { ..._context, ...ctx };
}

export function clearLogContext() {
  _context = {};
}

function hashEmail(email: string): string {
  // Tronque pour éviter PII en clair dans les logs
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  return `${local[0]}***@${domain}`;
}

export function sanitizePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const sensitive = [
    'password',
    'mot_de_passe',
    'token',
    'secret',
    'authorization',
  ];
  return Object.fromEntries(
    Object.entries(payload).map(([k, v]) => {
      if (sensitive.some((s) => k.toLowerCase().includes(s)))
        return [k, '[REDACTED]'];
      if (k === 'email' && typeof v === 'string') return [k, hashEmail(v)];
      return [k, v];
    }),
  );
}

function emit(
  level: LogLevel,
  event: string,
  payload: Record<string, unknown>,
  ctx?: LogContext,
) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    service: (ctx?.service ?? _context.service ?? 'platform') as ServiceName,
    event,
    actor_id: ctx?.actor_id ?? _context.actor_id ?? null,
    actor_role: ctx?.actor_role ?? _context.actor_role ?? null,
    org_id: ctx?.org_id ?? _context.org_id ?? null,
    trace_id: ctx?.trace_id ?? _context.trace_id ?? null,
    payload: sanitizePayload(payload),
  };

  console.log(JSON.stringify(entry));
}

export const logger = {
  info(event: string, payload: Record<string, unknown> = {}, ctx?: LogContext) {
    emit('info', event, payload, ctx);
  },
  warn(event: string, payload: Record<string, unknown> = {}, ctx?: LogContext) {
    emit('warn', event, payload, ctx);
  },
  error(
    event: string,
    payload: Record<string, unknown> = {},
    ctx?: LogContext,
  ) {
    emit('error', event, payload, ctx);
  },
};
