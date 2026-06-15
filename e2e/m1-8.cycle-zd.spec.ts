/**
 * M1.8 — Smoke tests API : protection des routes du cycle ZD.
 * Vérifie 401/403 sans auth sur les endpoints batch + facturation.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

test.describe('M1.8 / Cycle ZD / Endpoints batch PDF', () => {
  test('M1.8/e2e — batch-pdf-j1 sans Authorization → 401', async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/cron/batch-pdf-j1`);
    expect([401, 403]).toContain(res.status());
  });

  test('M1.8/e2e — batch-pdf-j1 mauvais token → 401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/cron/batch-pdf-j1`, {
      headers: { Authorization: 'Bearer mauvais-token' },
    });
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('M1.8 / Cycle ZD / Endpoints batch brouillons', () => {
  test('M1.8/e2e — batch-brouillons-j1 sans Authorization → 401', async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/cron/batch-brouillons-j1`);
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('M1.8 / Cycle ZD / Endpoints facturation', () => {
  test('M1.8/e2e — valider facture sans auth → 401', async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/v1/admin/factures/any-id/valider`,
    );
    expect(res.status()).toBe(401);
  });

  test('M1.8/e2e — avoir facture sans auth → 401', async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/v1/admin/factures/any-id/avoir`,
    );
    expect(res.status()).toBe(401);
  });
});

test.describe('M1.8 / Cycle ZD / Endpoints cron polling', () => {
  test('M1.8/e2e — cron polling sync sans Authorization → 401 ou 405', async ({
    request,
  }) => {
    // L'endpoint de polling logistique (quelque soit le provider) est protégé
    const res = await request.post(`${BASE_URL}/api/cron/polling-logistique`);
    expect([401, 403, 404, 405]).toContain(res.status());
  });
});
