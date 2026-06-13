import { afterEach, describe, expect, it } from 'vitest';

import {
  _getPennylaneHandlers,
  _setPennylaneHandlers,
  loadPaymentEvents,
  setupPennylaneMock,
} from './pennylane.js';

afterEach(() => {
  _setPennylaneHandlers(null);
});

describe('M0.11 / Pennylane — infrastructure mock', () => {
  it('M0.11 / Pennylane — _setPennylaneHandlers / _getPennylaneHandlers injectable', () => {
    expect(_getPennylaneHandlers()).toBeNull();

    const restore = setupPennylaneMock({ customers: 'page1' });
    expect(_getPennylaneHandlers()).not.toBeNull();

    restore();
    expect(_getPennylaneHandlers()).toBeNull();
  });
});

describe('M0.11 / Pennylane — pagination customers', () => {
  it('M0.11 / Pennylane — page 1 retourne 3 customers avec pagination.next_page=2', async () => {
    const restore = setupPennylaneMock({ customers: 'page1' });
    const handlers = _getPennylaneHandlers()!;
    const result = await handlers.getCustomers(1);

    expect('customers' in result).toBe(true);
    if ('customers' in result) {
      expect(result.customers).toHaveLength(3);
      expect(result.pagination.next_page).toBe(2);
      expect(result.pagination.total_pages).toBe(2);
    }
    restore();
  });

  it('M0.11 / Pennylane — page 2 retourne les customers restants avec next_page=null', async () => {
    const restore = setupPennylaneMock({ customers: 'page2' });
    const handlers = _getPennylaneHandlers()!;
    const result = await handlers.getCustomers(2);

    expect('customers' in result).toBe(true);
    if ('customers' in result) {
      expect(result.pagination.next_page).toBeNull();
    }
    restore();
  });

  it('M0.11 / Pennylane — customers page1 portent un source_id (lien Savr→Pennylane)', async () => {
    const restore = setupPennylaneMock({ customers: 'page1' });
    const handlers = _getPennylaneHandlers()!;
    const result = await handlers.getCustomers(1);

    if ('customers' in result) {
      for (const c of result.customers) {
        expect(c.source_id).toBeTruthy();
      }
    }
    restore();
  });
});

describe('M0.11 / Pennylane — polling factures sans borne', () => {
  it('M0.11 / Pennylane — polling sans borne retourne des factures dont une ancienne (idempotence requise)', async () => {
    const restore = setupPennylaneMock({ invoices: 'poll_sans_borne' });
    const handlers = _getPennylaneHandlers()!;
    const result = await handlers.getInvoices();

    expect('invoices' in result).toBe(true);
    if ('invoices' in result) {
      expect(result.invoices.length).toBeGreaterThan(0);
      const ancienne = result.invoices.find((i) => i.id === 'PL-INV-2025-001');
      expect(ancienne).toBeDefined();
    }
    restore();
  });

  it('M0.11 / Pennylane — toutes les factures poll_sans_borne portent un source_id', async () => {
    const restore = setupPennylaneMock({ invoices: 'poll_sans_borne' });
    const handlers = _getPennylaneHandlers()!;
    const result = await handlers.getInvoices();

    if ('invoices' in result) {
      for (const inv of result.invoices) {
        expect(inv.source_id).toBeTruthy();
      }
    }
    restore();
  });
});

describe('M0.11 / Pennylane — transition de statut paiement', () => {
  it('M0.11 / Pennylane — loadPaymentEvents retourne 2 événements emise→payee', () => {
    const events = loadPaymentEvents();

    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.new_status).toBe('paid');
      expect(e.invoice_id).toBeTruthy();
      expect(e.source_id).toBeTruthy();
    }
  });

  it('M0.11 / Pennylane — événement paiement porte amount et paid_at', () => {
    const events = loadPaymentEvents();
    const event = events[0]!;

    expect(event.amount).toBeTruthy();
    expect(event.paid_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('M0.11 / Pennylane — gestion erreurs', () => {
  it('M0.11 / Pennylane — 429 porte ok: false, status 429 et retry_after de 60s', async () => {
    const restore = setupPennylaneMock({ invoices: 'error_429' });
    const handlers = _getPennylaneHandlers()!;
    const result = await handlers.getInvoices();

    expect('ok' in result && result.ok === false).toBe(true);
    if ('ok' in result && !result.ok) {
      expect(result.status).toBe(429);
      expect(result.retry_after).toBe(60);
    }
    restore();
  });

  it('M0.11 / Pennylane — 500 porte ok: false et status 500 (retry attendu)', async () => {
    const restore = setupPennylaneMock({ invoices: 'error_500' });
    const handlers = _getPennylaneHandlers()!;
    const result = await handlers.getInvoices();

    expect('ok' in result && result.ok === false).toBe(true);
    if ('ok' in result && !result.ok) {
      expect(result.status).toBe(500);
    }
    restore();
  });

  it('M0.11 / Pennylane — createDraft 429 porte retry_after', async () => {
    const restore = setupPennylaneMock({ create: 'error_429' });
    const handlers = _getPennylaneHandlers()!;
    const result = await handlers.createDraft({ customer_id: 'test' });

    expect('ok' in result && result.ok === false).toBe(true);
    if ('ok' in result && !result.ok) {
      expect(result.retry_after).toBeDefined();
    }
    restore();
  });

  it('M0.11 / Pennylane — createDraft success retourne ok: true et un id', async () => {
    const restore = setupPennylaneMock({ create: 'success' });
    const handlers = _getPennylaneHandlers()!;
    const result = await handlers.createDraft({ customer_id: 'PL-CUST-001' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBeTruthy();
    }
    restore();
  });
});
