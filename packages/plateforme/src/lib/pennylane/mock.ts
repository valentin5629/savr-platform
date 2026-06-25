// Handler injectables Pennylane (pattern injectable mock, identique aux adapters logistiques).
// Production : _handlers = null → appels HTTP réels dans client.ts.
// Test : setupPennylaneMock(opts) injecte des handlers fixture-based.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/plateforme/src/lib/pennylane/ → 5 niveaux → fixtures/
const FIXTURES_DIR = resolve(
  __dirname,
  '../../../../../fixtures/api/pennylane',
);

function loadFixture<T>(filename: string): T {
  return JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, filename), 'utf-8'),
  ) as T;
}

// ─── Types Pennylane v2 ───────────────────────────────────────────────────────

export interface PennylaneCustomer {
  id: string;
  name: string;
  billing_email: string;
  vat_number: string;
  siret: string;
  payment_conditions: string;
  source_id: string;
}

export interface PennylanePagination {
  current_page: number;
  next_page: number | null;
  total_pages: number;
  total_count: number;
  per_page: number;
}

export interface PennylaneCustomerPage {
  customers: PennylaneCustomer[];
  pagination: PennylanePagination;
}

export interface PennylaneInvoice {
  id: string;
  number: string;
  status: 'draft' | 'outstanding' | 'paid' | 'cancelled';
  total_amount: string;
  currency: string;
  issued_at: string;
  due_at: string;
  paid_at?: string;
  customer_id: string;
  source_id: string;
  file_url: string | null;
}

export interface PennylaneInvoicePage {
  invoices: PennylaneInvoice[];
  pagination: PennylanePagination;
}

export type PennylaneError = {
  ok: false;
  status: number;
  error: string;
  message: string;
  retry_after?: number;
};

export type PennylaneCreateResult =
  | { ok: true; invoice: PennylaneInvoice }
  | PennylaneError;

export type PennylaneFinalizeResult =
  | { ok: true; invoice: PennylaneInvoice }
  | PennylaneError;

export type PennylaneSendEmailResult = { ok: true } | PennylaneError;

export type PennylaneGetInvoiceResult =
  | { ok: true; invoice: PennylaneInvoice }
  | PennylaneError;

export type PennylaneCreateCustomerResult =
  | { ok: true; customer: PennylaneCustomer }
  | PennylaneError;

// ─── Handler injection ────────────────────────────────────────────────────────

export interface PennylaneHandlers {
  getCustomers: (
    page: number,
  ) => Promise<PennylaneCustomerPage | PennylaneError>;
  getInvoices: (
    page?: number,
  ) => Promise<PennylaneInvoicePage | PennylaneError>;
  createInvoice: (
    payload: Record<string, unknown>,
  ) => Promise<PennylaneCreateResult>;
  finalizeInvoice: (pennylaneId: string) => Promise<PennylaneFinalizeResult>;
  sendEmail: (pennylaneId: string) => Promise<PennylaneSendEmailResult>;
  getInvoice: (pennylaneId: string) => Promise<PennylaneGetInvoiceResult>;
  createDraft: (
    payload: Record<string, unknown>,
  ) => Promise<{ ok: true; id: string } | PennylaneError>;
  // Optionnel : les mocks partiels antérieurs (FACT-06) ne le fournissent pas →
  // client.ts retombe sur un succès neutre déterministe en test.
  createCustomer?: (
    payload: Record<string, unknown>,
  ) => Promise<PennylaneCreateCustomerResult>;
}

let _handlers: PennylaneHandlers | null = null;

export function _setPennylaneHandlers(
  handlers: PennylaneHandlers | null,
): void {
  _handlers = handlers;
}

export function _getPennylaneHandlers(): PennylaneHandlers | null {
  return _handlers;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

export type PennylaneCreateScenario =
  | 'success'
  | 'error_4xx'
  | 'error_429'
  | 'error_500';
export type PennylaneFinalizeScenario = 'success' | 'error_500';
export type PennylaneSendEmailScenario = 'success' | 'error_500';
export type PennylaneGetInvoiceScenario = 'outstanding' | 'paid' | 'error_500';

interface Error429Fixture {
  status: number;
  error: string;
  message: string;
  retry_after: number;
}
interface Error500Fixture {
  status: number;
  error: string;
  message: string;
}
interface Error4xxFixture {
  status: number;
  error: string;
  message: string;
}

export function setupPennylaneMock(opts: {
  create?: PennylaneCreateScenario;
  finalize?: PennylaneFinalizeScenario;
  sendEmail?: PennylaneSendEmailScenario;
  getInvoice?: PennylaneGetInvoiceScenario;
}): () => void {
  _setPennylaneHandlers({
    getCustomers: async (_page) =>
      loadFixture<PennylaneCustomerPage>('customers_page1.json'),

    getInvoices: async (_page) =>
      loadFixture<PennylaneInvoicePage>('invoices_poll_sans_borne.json'),

    createInvoice: async (_payload) => {
      const scenario = opts.create ?? 'success';
      if (scenario === 'error_4xx') {
        const f = loadFixture<Error4xxFixture>('create_invoice_4xx.json');
        return {
          ok: false as const,
          status: f.status,
          error: f.error,
          message: f.message,
        };
      }
      if (scenario === 'error_429') {
        const f = loadFixture<Error429Fixture>('error_429.json');
        return {
          ok: false as const,
          status: f.status,
          error: f.error,
          message: f.message,
          retry_after: f.retry_after,
        };
      }
      if (scenario === 'error_500') {
        const f = loadFixture<Error500Fixture>('error_500.json');
        return {
          ok: false as const,
          status: f.status,
          error: f.error,
          message: f.message,
        };
      }
      const f = loadFixture<{ invoice: PennylaneInvoice }>(
        'create_invoice_success.json',
      );
      return { ok: true as const, invoice: f.invoice };
    },

    finalizeInvoice: async (_pennylaneId) => {
      const scenario = opts.finalize ?? 'success';
      if (scenario === 'error_500') {
        const f = loadFixture<Error500Fixture>('error_500.json');
        return {
          ok: false as const,
          status: f.status,
          error: f.error,
          message: f.message,
        };
      }
      const f = loadFixture<{ invoice: PennylaneInvoice }>(
        'finalize_success.json',
      );
      return { ok: true as const, invoice: f.invoice };
    },

    sendEmail: async (_pennylaneId) => {
      const scenario = opts.sendEmail ?? 'success';
      if (scenario === 'error_500') {
        const f = loadFixture<Error500Fixture>('error_500.json');
        return {
          ok: false as const,
          status: f.status,
          error: f.error,
          message: f.message,
        };
      }
      return { ok: true as const };
    },

    getInvoice: async (_pennylaneId) => {
      const scenario = opts.getInvoice ?? 'outstanding';
      if (scenario === 'error_500') {
        const f = loadFixture<Error500Fixture>('error_500.json');
        return {
          ok: false as const,
          status: f.status,
          error: f.error,
          message: f.message,
        };
      }
      if (scenario === 'paid') {
        const f = loadFixture<{ invoice: PennylaneInvoice }>(
          'get_invoice_paid.json',
        );
        return { ok: true as const, invoice: f.invoice };
      }
      const f = loadFixture<{ invoice: PennylaneInvoice }>(
        'get_invoice_outstanding.json',
      );
      return { ok: true as const, invoice: f.invoice };
    },

    createDraft: async (payload) => {
      const r = await _handlers!.createInvoice(payload);
      if (!r.ok) return r;
      return { ok: true as const, id: r.invoice.id };
    },

    createCustomer: async (_payload) => {
      const f = loadFixture<PennylaneCustomerPage>('customers_page1.json');
      return { ok: true as const, customer: f.customers[0]! };
    },
  });

  return () => _setPennylaneHandlers(null);
}
