import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
  customer_id: string;
  source_id: string;
}

export interface PennylaneInvoicePage {
  invoices: PennylaneInvoice[];
  pagination: PennylanePagination;
}

export interface PennylanePaymentEvent {
  invoice_id: string;
  old_status: string;
  new_status: string;
  paid_at: string;
  payment_method: string;
  amount: string;
  source_id: string;
}

export type PennylaneError = {
  ok: false;
  status: number;
  error: string;
  message: string;
  retry_after?: number;
};

// ─── Injectable handlers ──────────────────────────────────────────────────────

export interface PennylaneHandlers {
  getCustomers: (
    page: number,
  ) => Promise<PennylaneCustomerPage | PennylaneError>;
  getInvoices: (
    page?: number,
  ) => Promise<PennylaneInvoicePage | PennylaneError>;
  createDraft: (
    payload: Record<string, unknown>,
  ) => Promise<{ ok: true; id: string } | PennylaneError>;
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

// ─── Fixture-based setup helpers ──────────────────────────────────────────────

export type PennylaneCustomerScenario = 'page1' | 'page2';
export type PennylaneInvoiceScenario =
  | 'poll_sans_borne'
  | 'error_429'
  | 'error_500';
export type PennylaneCreateScenario = 'success' | 'error_429' | 'error_500';

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

/**
 * Configure les handlers Pennylane avec des données fixture.
 * Retourne une fonction de teardown à appeler dans afterEach.
 *
 * @example
 * const restore = setupPennylaneMock({ customers: 'page1', invoices: 'poll_sans_borne' });
 * afterEach(restore);
 */
export function setupPennylaneMock(opts: {
  customers?: PennylaneCustomerScenario;
  invoices?: PennylaneInvoiceScenario;
  create?: PennylaneCreateScenario;
}): () => void {
  _setPennylaneHandlers({
    getCustomers: async (page: number) => {
      const scenario = opts.customers ?? 'page1';
      if (scenario === 'page1' && page === 2) {
        return loadFixture<PennylaneCustomerPage>('customers_page2.json');
      }
      if (scenario === 'page2') {
        return loadFixture<PennylaneCustomerPage>('customers_page2.json');
      }
      return loadFixture<PennylaneCustomerPage>('customers_page1.json');
    },
    getInvoices: async (_page?: number) => {
      const scenario = opts.invoices ?? 'poll_sans_borne';
      if (scenario === 'error_429') {
        const f = loadFixture<Error429Fixture>('error_429.json');
        return {
          ok: false,
          status: f.status,
          error: f.error,
          message: f.message,
          retry_after: f.retry_after,
        };
      }
      if (scenario === 'error_500') {
        const f = loadFixture<Error500Fixture>('error_500.json');
        return {
          ok: false,
          status: f.status,
          error: f.error,
          message: f.message,
        };
      }
      return loadFixture<PennylaneInvoicePage>('invoices_poll_sans_borne.json');
    },
    createDraft: async (_payload: Record<string, unknown>) => {
      const scenario = opts.create ?? 'success';
      if (scenario === 'error_429') {
        const f = loadFixture<Error429Fixture>('error_429.json');
        return {
          ok: false,
          status: f.status,
          error: f.error,
          message: f.message,
          retry_after: f.retry_after,
        };
      }
      if (scenario === 'error_500') {
        const f = loadFixture<Error500Fixture>('error_500.json');
        return {
          ok: false,
          status: f.status,
          error: f.error,
          message: f.message,
        };
      }
      return { ok: true as const, id: 'PL-INV-DRAFT-NEW-001' };
    },
  });

  return () => _setPennylaneHandlers(null);
}

/**
 * Charge les événements de paiement depuis la fixture invoice_payment_status.
 * Utilisé pour tester la transition emise→payee.
 */
export function loadPaymentEvents(): PennylanePaymentEvent[] {
  const f = loadFixture<{ events: PennylanePaymentEvent[] }>(
    'invoice_payment_status.json',
  );
  return f.events;
}
