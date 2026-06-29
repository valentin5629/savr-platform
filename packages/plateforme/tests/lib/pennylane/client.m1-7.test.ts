// BL-P1-API-08 — observabilité Pennylane : chaque opération trace un appel dans
// integrations_logs (integration='pennylane'). Sans mock du chemin sous test
// (le client réel est exercé) : on injecte les handlers Pennylane (fixtures) et
// un supabase espion qui capture les INSERT integrations_logs.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createInvoice,
  finalizeInvoice,
  getInvoice,
  listInvoices,
} from '@/lib/pennylane/client.js';
import {
  setupPennylaneMock,
  _setPennylaneHandlers,
} from '@/lib/pennylane/mock.js';

const logInserts: Record<string, unknown>[] = [];

const mockSupabase = {
  from: vi.fn((table: string) => ({
    insert: vi.fn((data: Record<string, unknown>) => {
      if (table === 'integrations_logs') logInserts.push(data);
      return Promise.resolve({ data: null, error: null });
    }),
  })),
} as unknown as import('@savr/shared/src/supabase-client.js').SupabaseClient;

describe('M1.7 / Pennylane integrations_logs (BL-P1-API-08)', () => {
  afterEach(() => {
    _setPennylaneHandlers(null);
    logInserts.length = 0;
  });

  it('createInvoice succès → log pennylane sortant statut 200 + correlation_id', async () => {
    const restore = setupPennylaneMock({ create: 'success' });
    const res = await createInvoice(
      mockSupabase,
      { foo: 'bar' },
      'facture-123',
    );
    restore();

    expect(res.ok).toBe(true);
    const log = logInserts.find(
      (l) => l['endpoint'] === '/customer_invoices' && l['methode'] === 'POST',
    );
    expect(log).toBeDefined();
    expect(log!['integration']).toBe('pennylane');
    expect(log!['direction']).toBe('sortant');
    expect(log!['statut_http']).toBe(200);
    expect(log!['correlation_id']).toBe('facture-123');
    expect(log!['erreur']).toBeNull();
  });

  it('createInvoice 4xx → log pennylane avec statut_http=4xx + erreur renseignée', async () => {
    const restore = setupPennylaneMock({ create: 'error_4xx' });
    const res = await createInvoice(
      mockSupabase,
      { foo: 'bar' },
      'facture-456',
    );
    restore();

    expect(res.ok).toBe(false);
    const log = logInserts.find((l) => l['endpoint'] === '/customer_invoices');
    expect(log).toBeDefined();
    expect(log!['integration']).toBe('pennylane');
    expect(log!['statut_http']).toBeGreaterThanOrEqual(400);
    expect(log!['statut_http']).toBeLessThan(500);
    expect(typeof log!['erreur']).toBe('string');
  });

  it('finalizeInvoice → log avec endpoint /finalize + correlation_id', async () => {
    const restore = setupPennylaneMock({ finalize: 'success' });
    await finalizeInvoice(mockSupabase, 'PL-INV-1');
    restore();

    const log = logInserts.find((l) =>
      String(l['endpoint']).endsWith('/finalize'),
    );
    expect(log).toBeDefined();
    expect(log!['integration']).toBe('pennylane');
    expect(log!['correlation_id']).toBe('PL-INV-1');
  });

  it('getInvoice → log GET /customer_invoices/{id}', async () => {
    const restore = setupPennylaneMock({ getInvoice: 'outstanding' });
    await getInvoice(mockSupabase, 'PL-INV-2');
    restore();

    const log = logInserts.find(
      (l) =>
        l['methode'] === 'GET' &&
        String(l['endpoint']).includes('/customer_invoices/PL-INV-2'),
    );
    expect(log).toBeDefined();
    expect(log!['integration']).toBe('pennylane');
  });

  it('listInvoices succès (page sans .ok) → log statut 200', async () => {
    const restore = setupPennylaneMock({});
    await listInvoices(mockSupabase, 1);
    restore();

    const log = logInserts.find(
      (l) => l['methode'] === 'GET' && l['endpoint'] === '/customer_invoices',
    );
    expect(log).toBeDefined();
    expect(log!['statut_http']).toBe(200);
    expect(log!['erreur']).toBeNull();
  });
});
