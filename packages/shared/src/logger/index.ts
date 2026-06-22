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

// Clés dont la VALEUR est masquée intégralement ([REDACTED]), à tout niveau
// d'imbrication. Match par sous-chaîne insensible à la casse (cohérent avec
// l'implémentation initiale). PII proscrites par §07/01 (Logs business) :
//   - secrets d'auth : password / mot_de_passe / token / secret / authorization
//   - coordonnées personnelles : telephone / phone / siret
// NB : `montant`/`iban` ne sont PAS masqués — §07/01 ne proscrit le montant que
// « hors payload strictement nécessaire », or le catalogue d'events l'exige en
// clair (facture.emise → montant_ttc, etc.). Masquer casserait le debug et le
// schéma figé. `iban` n'est pas listé par §07/01 → pas de sur-masquage.
const SENSITIVE_KEYS = [
  'password',
  'mot_de_passe',
  'token',
  'secret',
  'authorization',
  'telephone',
  'phone',
  'siret',
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Récursion sur une valeur sans clé propre (élément de tableau) : on plonge dans
// les objets/tableaux imbriqués mais une primitive sans clé n'est jamais une PII
// identifiable seule → laissée intacte.
function sanitizeNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeNested);
  if (isPlainObject(value)) return sanitizeRecord(value);
  return value;
}

function sanitizeEntry(key: string, value: unknown): unknown {
  // 1. Clé sensible → masquage total (même si la valeur est un objet/tableau).
  if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
    return '[REDACTED]';
  }

  // 2. Toute clé contenant « email » portant un email EN CLAIR → hash tronqué.
  //    Garde-fou `@` : préserve les valeurs déjà anonymisées (`email_hash`,
  //    `actor_email_hash` — cf. §07/01) et les non-emails (`email_confirmed_at`),
  //    qui ne sont pas des PII en clair → pas de sur-masquage (debug préservé).
  if (/email/i.test(key) && typeof value === 'string') {
    return value.includes('@') ? hashEmail(value) : value;
  }

  // 3. Récursion sur objets et tableaux imbriqués (ex. payload.user.email,
  //    payload.items[].email).
  return sanitizeNested(value);
}

function sanitizeRecord(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, sanitizeEntry(k, v)]),
  );
}

export function sanitizePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeRecord(payload);
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
