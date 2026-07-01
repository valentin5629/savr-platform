// Client Pennylane API v2.
// En test : délègue aux handlers injectables (voir mock.ts).
// En prod : appels HTTP réels avec Bearer depuis env var.
//
// BL-P1-API-08 — observabilité financière : chaque opération trace un appel dans
// plateforme.integrations_logs (integration='pennylane'), sur le modèle du
// wrapper log() du client adapter logistique (cf. packages/adapters/). Sans cette
// trace, un échec Pennylane (4xx/5xx/timeout) était invisible côté Ops. Le
// `supabase` (service_role côté jobs/routes facturation) est threadé des appelants.

import { logger } from '@savr/shared/src/logger/index.js';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

import {
  _getPennylaneHandlers,
  type PennylaneCreateResult,
  type PennylaneFinalizeResult,
  type PennylaneSendEmailResult,
  type PennylaneGetInvoiceResult,
  type PennylaneCreateCustomerResult,
  type PennylaneError,
  type PennylaneInvoice,
  type PennylaneCustomer,
  type PennylaneInvoicePage,
} from './mock.js';

const BASE_URL = 'https://app.pennylane.com/api/external/v2';
const TIMEOUT_MS = 30_000;

// Trace un appel Pennylane dans integrations_logs. Best-effort : l'observabilité
// ne doit JAMAIS faire échouer le flux de facturation (try/catch silencieux).
async function logPennylane(
  supabase: SupabaseClient,
  entry: {
    methode: string;
    endpoint: string;
    ok: boolean;
    status?: number;
    erreur?: string;
    correlationId?: string;
    t0: number;
  },
): Promise<void> {
  try {
    await supabase.from('integrations_logs').insert({
      integration: 'pennylane',
      direction: 'sortant',
      methode: entry.methode,
      endpoint: entry.endpoint,
      statut_http: entry.ok ? 200 : (entry.status ?? null),
      duree_ms: Date.now() - entry.t0,
      correlation_id: entry.correlationId ?? null,
      erreur: entry.ok ? null : (entry.erreur ?? null),
    });
  } catch {
    /* l'observabilité ne casse jamais la facturation */
  }
}

// Dérive (statut_http, erreur) d'un résultat d'opération pour le log.
function logFieldsFromResult(r: { ok: true } | PennylaneError): {
  ok: boolean;
  status?: number;
  erreur?: string;
} {
  return r.ok
    ? { ok: true }
    : { ok: false, status: r.status, erreur: `${r.error}: ${r.message}` };
}

function apiKey(): string {
  const key = process.env['PENNYLANE_API_KEY'];
  if (!key) throw new Error('PENNYLANE_API_KEY non définie');
  return key;
}

async function pennylaneRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<{ ok: true; data: T } | PennylaneError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      let errBody: Record<string, unknown> = {};
      try {
        errBody = (await res.json()) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      // §07/01 api.external.failed (service=pennylane) → alerte « API tierce HS »
      // §07/03 (3× 5xx/timeout consécutifs), agrégée côté plateforme.
      logger.error('api.external.failed', {
        service: 'pennylane',
        endpoint: path,
        error_code: String(res.status),
        retry_count: 0,
      });
      return {
        ok: false,
        status: res.status,
        error: (errBody['error'] as string) ?? 'api_error',
        message: (errBody['message'] as string) ?? res.statusText,
      };
    }

    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    // AbortError (timeout) ou réseau → 5xx-like pour retry
    logger.error('api.external.failed', {
      service: 'pennylane',
      endpoint: path,
      error_code: 'network_error',
      retry_count: 0,
    });
    return {
      ok: false,
      status: 503,
      error: 'network_error',
      message: String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Opérations ──────────────────────────────────────────────────────────────

export async function createCustomer(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<PennylaneCreateCustomerResult> {
  const t0 = Date.now();
  const handlers = _getPennylaneHandlers();
  let result: PennylaneCreateCustomerResult;
  if (handlers) {
    result = handlers.createCustomer
      ? await handlers.createCustomer(payload)
      : {
          // Mock partiel sans createCustomer (tests antérieurs FACT-06) : succès neutre.
          ok: true as const,
          customer: {
            id: 'PL-CUST-MOCK',
            name: '',
            billing_email: '',
            vat_number: '',
            siret: '',
            payment_conditions: '',
            source_id: '',
          } satisfies PennylaneCustomer,
        };
  } else {
    const r = await pennylaneRequest<{ customer: PennylaneCustomer }>(
      'POST',
      '/customers',
      payload,
    );
    result = r.ok ? { ok: true, customer: r.data.customer } : r;
  }
  await logPennylane(supabase, {
    methode: 'POST',
    endpoint: '/customers',
    t0,
    ...logFieldsFromResult(result),
  });
  return result;
}

export async function createInvoice(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<PennylaneCreateResult> {
  const t0 = Date.now();
  const handlers = _getPennylaneHandlers();
  let result: PennylaneCreateResult;
  if (handlers) {
    result = await handlers.createInvoice(payload);
  } else {
    const r = await pennylaneRequest<{ invoice: PennylaneInvoice }>(
      'POST',
      '/customer_invoices',
      payload,
      idempotencyKey,
    );
    result = r.ok ? { ok: true, invoice: r.data.invoice } : r;
  }
  await logPennylane(supabase, {
    methode: 'POST',
    endpoint: '/customer_invoices',
    correlationId: idempotencyKey,
    t0,
    ...logFieldsFromResult(result),
  });
  return result;
}

export async function finalizeInvoice(
  supabase: SupabaseClient,
  pennylaneId: string,
): Promise<PennylaneFinalizeResult> {
  const t0 = Date.now();
  const handlers = _getPennylaneHandlers();
  let result: PennylaneFinalizeResult;
  if (handlers) {
    result = await handlers.finalizeInvoice(pennylaneId);
  } else {
    const r = await pennylaneRequest<{ invoice: PennylaneInvoice }>(
      'POST',
      `/customer_invoices/${pennylaneId}/finalize`,
    );
    result = r.ok ? { ok: true, invoice: r.data.invoice } : r;
  }
  await logPennylane(supabase, {
    methode: 'POST',
    endpoint: `/customer_invoices/${pennylaneId}/finalize`,
    correlationId: pennylaneId,
    t0,
    ...logFieldsFromResult(result),
  });
  return result;
}

export async function sendInvoiceEmail(
  supabase: SupabaseClient,
  pennylaneId: string,
): Promise<PennylaneSendEmailResult> {
  const t0 = Date.now();
  const handlers = _getPennylaneHandlers();
  let result: PennylaneSendEmailResult;
  if (handlers) {
    result = await handlers.sendEmail(pennylaneId);
  } else {
    const r = await pennylaneRequest<Record<string, unknown>>(
      'POST',
      `/customer_invoices/${pennylaneId}/send_email`,
    );
    result = r.ok ? { ok: true } : r;
  }
  await logPennylane(supabase, {
    methode: 'POST',
    endpoint: `/customer_invoices/${pennylaneId}/send_email`,
    correlationId: pennylaneId,
    t0,
    ...logFieldsFromResult(result),
  });
  return result;
}

export async function getInvoice(
  supabase: SupabaseClient,
  pennylaneId: string,
): Promise<PennylaneGetInvoiceResult> {
  const t0 = Date.now();
  const handlers = _getPennylaneHandlers();
  let result: PennylaneGetInvoiceResult;
  if (handlers) {
    result = await handlers.getInvoice(pennylaneId);
  } else {
    const r = await pennylaneRequest<{ invoice: PennylaneInvoice }>(
      'GET',
      `/customer_invoices/${pennylaneId}`,
    );
    result = r.ok ? { ok: true, invoice: r.data.invoice } : r;
  }
  await logPennylane(supabase, {
    methode: 'GET',
    endpoint: `/customer_invoices/${pennylaneId}`,
    correlationId: pennylaneId,
    t0,
    ...logFieldsFromResult(result),
  });
  return result;
}

export async function listInvoices(
  supabase: SupabaseClient,
  page = 1,
): Promise<PennylaneInvoicePage | PennylaneError> {
  const t0 = Date.now();
  const handlers = _getPennylaneHandlers();
  let result: PennylaneInvoicePage | PennylaneError;
  if (handlers) {
    result = await handlers.getInvoices(page);
  } else {
    const r = await pennylaneRequest<PennylaneInvoicePage>(
      'GET',
      `/customer_invoices?page=${page}`,
    );
    result = r.ok ? r.data : r;
  }
  // PennylaneInvoicePage (succès) n'a pas de `.ok` ; PennylaneError a `.ok=false`.
  const isErr = 'ok' in result && (result as { ok?: boolean }).ok === false;
  await logPennylane(supabase, {
    methode: 'GET',
    endpoint: '/customer_invoices',
    t0,
    ok: !isErr,
    status: isErr ? (result as PennylaneError).status : undefined,
    erreur: isErr
      ? `${(result as PennylaneError).error}: ${(result as PennylaneError).message}`
      : undefined,
  });
  return result;
}

export function is4xx(err: PennylaneError): boolean {
  return err.status >= 400 && err.status < 500;
}

export function is5xx(err: PennylaneError): boolean {
  return err.status >= 500 || err.status === 0;
}
