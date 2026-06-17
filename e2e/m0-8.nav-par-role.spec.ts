/**
 * M0.8 — Tests Playwright : navigation par rôle via /api/nav
 * Vérifie que chaque rôle expose les bons items et que les items non autorisés sont absents.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

type NavResponse = { role: string; items: { label: string; href: string }[] };

const EXPECTED: Record<string, string[]> = {
  admin_savr: ['Clients', 'Paramètres', 'Collectes'],
  // Nav réalignée sur §06.04 §1 (4 entrées V1) en M3.1.
  traiteur_manager: [
    'Dashboard',
    'Collectes',
    'Mon organisation',
    'Mon profil',
  ],
  traiteur_commercial: [
    'Dashboard',
    'Collectes',
    'Mon organisation',
    'Mon profil',
  ],
  agence: ['Dashboard', 'Collectes', 'Mon organisation', 'Mon profil'],
  gestionnaire_lieux: ['Mes lieux', 'Collectes'],
  client_organisateur: ['Mes événements', 'Collectes'],
};

for (const [role, expectedLabels] of Object.entries(EXPECTED)) {
  test(`M0.8 — nav ${role} contient les entrées attendues`, async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/nav?role=${role}`);
    expect(res.status()).toBe(200);

    const body = (await res.json()) as NavResponse;
    expect(body.role).toBe(role);
    expect(Array.isArray(body.items)).toBe(true);

    const labels = body.items.map((i) => i.label);
    for (const expected of expectedLabels) {
      expect(labels, `rôle ${role} doit exposer "${expected}"`).toContain(
        expected,
      );
    }
  });
}

test('M0.8 — /api/nav sans role retourne 400', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/nav`);
  expect(res.status()).toBe(400);
});

test('M0.8 — nav admin_savr ne contient pas les entrées exclusives aux autres rôles', async ({
  request,
}) => {
  // admin_savr ne doit pas avoir "Mes lieux" (gestionnaire) ni "Mes événements" (organisateur)
  const res = await request.get(`${BASE_URL}/api/nav?role=admin_savr`);
  const body = (await res.json()) as NavResponse;
  const labels = body.items.map((i) => i.label);
  expect(labels).not.toContain('Mes lieux');
  expect(labels).not.toContain('Mes événements');
});
