import { AsyncLocalStorage } from 'node:async_hooks';

import type { LogContext, LogEntry, LogLevel, ServiceName } from './types.js';

export type { LogContext, LogEntry, LogLevel, ServiceName };

let _context: LogContext = {};

export function setLogContext(ctx: LogContext) {
  _context = { ..._context, ...ctx };
}

export function clearLogContext() {
  _context = {};
}

// ── OTel léger V1 : trace_id propagé par requête (BL-P2-44, §07/00 l.34) ──────
// §07/00 l.34 : « OpenTelemetry est instrumenté dès V1 (WRAPPER LÉGER sur les logs
// structurés) … c'est le seul anticipé ». On n'ajoute donc AUCUN SDK `@opentelemetry/*` :
// un `AsyncLocalStorage` (natif node:async_hooks) suffit à porter le `trace_id`
// « sur toute la chaîne d'une requête » (§07/01 l.30) sans refactoring des handlers.
//
// Pourquoi ALS et pas le `_context` module-global ci-dessus : en serverless une
// même instance sert des requêtes concurrentes ; un `trace_id` posé dans un état
// module fuirait d'une requête à l'autre (corrélation faussée). `runWithTrace`
// scope le store à l'exécution du callback ET à toutes ses opérations asynchrones,
// isolant chaque requête. `_context` reste comme fallback (actor_id/org_id/service
// posés par `setLogContext`) — non impacté.
const traceStore = new AsyncLocalStorage<{ trace_id: string }>();

/** En-tête de corrélation de requête (in/out interne). */
export const TRACE_HEADER = 'x-savr-trace-id';

/** UUID v4 (§07/01 l.20 : « <uuid requête, propagé OTel> »). Web Crypto = Node 18+. */
export function generateTraceId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback improbable (runtime sans Web Crypto) : id non-uuid mais unique-ish,
  // suffisant pour la corrélation de logs (jamais atteint en Node 18+/Edge).
  return `trace-${Date.now().toString(36)}-${Math.round(Math.random() * 1e9).toString(36)}`;
}

/**
 * Résout le `trace_id` d'une requête entrante : honore un id DÉJÀ propagé
 * (`x-savr-trace-id`, puis un `traceparent` W3C, puis `x-request-id`), sinon en
 * génère un (ticket BL-P2-44 : « Respecter un traceparent/x-request-id entrant
 * s'il existe déjà — sinon générer »). On ne PROPAGE jamais de `traceparent`
 * SORTANT vers les tiers (décision de périmètre V1 : chaîne interne uniquement).
 */
export function extractOrCreateTraceId(
  get: (name: string) => string | null | undefined,
): string {
  const own = get(TRACE_HEADER);
  if (own && own.trim()) return own.trim();
  const tp = get('traceparent'); // 00-<trace-id 32hex>-<span 16hex>-<flags>
  if (tp) {
    const seg = tp.split('-');
    if (seg.length >= 2 && seg[1] && /^[0-9a-f]{32}$/i.test(seg[1]))
      return seg[1];
  }
  const rid = get('x-request-id');
  if (rid && rid.trim()) return rid.trim();
  return generateTraceId();
}

/**
 * Enveloppe une exécution (handler de route, run de cron) dans un contexte de
 * trace : tous les `logger.*` émis PENDANT `fn` (y compris transitivement, dans
 * les adapters/clients appelés) portent ce `trace_id`. Isolation request-safe.
 */
export function runWithTrace<T>(trace_id: string, fn: () => T): T {
  return traceStore.run({ trace_id }, fn);
}

/** `trace_id` du contexte de trace courant, ou `null` hors requête tracée. */
export function getTraceId(): string | null {
  return traceStore.getStore()?.trace_id ?? null;
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
    // ALS (contexte de requête) prioritaire sur le fallback `_context` global.
    trace_id: ctx?.trace_id ?? getTraceId() ?? _context.trace_id ?? null,
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
