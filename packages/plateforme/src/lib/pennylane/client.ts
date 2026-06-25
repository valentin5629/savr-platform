// Client Pennylane API v2.
// En test : délègue aux handlers injectables (voir mock.ts).
// En prod : appels HTTP réels avec Bearer depuis env var.

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
  payload: Record<string, unknown>,
): Promise<PennylaneCreateCustomerResult> {
  const handlers = _getPennylaneHandlers();
  if (handlers) {
    if (handlers.createCustomer) return handlers.createCustomer(payload);
    // Mock partiel sans createCustomer (tests antérieurs FACT-06) : succès neutre.
    return {
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
  }

  const r = await pennylaneRequest<{ customer: PennylaneCustomer }>(
    'POST',
    '/customers',
    payload,
  );
  if (!r.ok) return r;
  return { ok: true, customer: r.data.customer };
}

export async function createInvoice(
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<PennylaneCreateResult> {
  const handlers = _getPennylaneHandlers();
  if (handlers) return handlers.createInvoice(payload);

  const r = await pennylaneRequest<{ invoice: PennylaneInvoice }>(
    'POST',
    '/customer_invoices',
    payload,
    idempotencyKey,
  );
  if (!r.ok) return r;
  return { ok: true, invoice: r.data.invoice };
}

export async function finalizeInvoice(
  pennylaneId: string,
): Promise<PennylaneFinalizeResult> {
  const handlers = _getPennylaneHandlers();
  if (handlers) return handlers.finalizeInvoice(pennylaneId);

  const r = await pennylaneRequest<{ invoice: PennylaneInvoice }>(
    'POST',
    `/customer_invoices/${pennylaneId}/finalize`,
  );
  if (!r.ok) return r;
  return { ok: true, invoice: r.data.invoice };
}

export async function sendInvoiceEmail(
  pennylaneId: string,
): Promise<PennylaneSendEmailResult> {
  const handlers = _getPennylaneHandlers();
  if (handlers) return handlers.sendEmail(pennylaneId);

  const r = await pennylaneRequest<Record<string, unknown>>(
    'POST',
    `/customer_invoices/${pennylaneId}/send_email`,
  );
  if (!r.ok) return r;
  return { ok: true };
}

export async function getInvoice(
  pennylaneId: string,
): Promise<PennylaneGetInvoiceResult> {
  const handlers = _getPennylaneHandlers();
  if (handlers) return handlers.getInvoice(pennylaneId);

  const r = await pennylaneRequest<{ invoice: PennylaneInvoice }>(
    'GET',
    `/customer_invoices/${pennylaneId}`,
  );
  if (!r.ok) return r;
  return { ok: true, invoice: r.data.invoice };
}

export async function listInvoices(
  page = 1,
): Promise<PennylaneInvoicePage | PennylaneError> {
  const handlers = _getPennylaneHandlers();
  if (handlers) return handlers.getInvoices(page);

  const r = await pennylaneRequest<PennylaneInvoicePage>(
    'GET',
    `/customer_invoices?page=${page}`,
  );
  if (!r.ok) return r;
  return r.data;
}

export function is4xx(err: PennylaneError): boolean {
  return err.status >= 400 && err.status < 500;
}

export function is5xx(err: PennylaneError): boolean {
  return err.status >= 500 || err.status === 0;
}
