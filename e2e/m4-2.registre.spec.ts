/**
 * M4.2 — Tests Playwright (smoke API + nav) : registre réglementaire ZD.
 * Convention repo : E2E = smoke tests requête (protection des routes + nav par
 * rôle), pas de login UI. Le cloisonnement fin est couvert par pgTAP, le
 * comportement applicatif par Vitest ; ici on vérifie le câblage end-to-end :
 * routes protégées (401 anon) + entrée de menu présente (clients) / absente
 * (agence, F6).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

type NavResponse = { role: string; items: { label: string; href: string }[] };

test.describe('M4.2 / Registre / protection des routes', () => {
  const routes = [
    '/api/v1/registre',
    '/api/v1/registre/export-csv',
    '/api/v1/registre/export-zip',
    '/api/v1/registre/bordereaux/00000000-0000-0000-0000-000000000000/download',
  ];
  for (const route of routes) {
    test(`M4.2/e2e — ${route} sans auth → 401`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${route}`);
      expect(res.status()).toBe(401);
    });
  }
});

test.describe('M4.2 / Registre / entrée de menu par rôle', () => {
  const withRegistre = [
    'traiteur_manager',
    'traiteur_commercial',
    'gestionnaire_lieux',
    'client_organisateur',
  ];
  for (const role of withRegistre) {
    test(`M4.2/e2e — nav ${role} expose "Registre réglementaire"`, async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/nav?role=${role}`);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as NavResponse;
      const item = body.items.find((i) => i.label === 'Registre réglementaire');
      expect(item, `rôle ${role} doit exposer le Registre`).toBeTruthy();
      expect(item?.href).toBe('/registre');
    });
  }

  test("M4.2/e2e — nav agence n'expose PAS le Registre (F6)", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/nav?role=agence`);
    const body = (await res.json()) as NavResponse;
    const labels = body.items.map((i) => i.label);
    expect(labels).not.toContain('Registre réglementaire');
  });
});
