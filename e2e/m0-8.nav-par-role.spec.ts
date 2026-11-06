/**
 * M0.8 — Tests Playwright : navigation par rôle via /api/nav
 * Vérifie que chaque rôle expose les bons items et que les items non autorisés sont absents.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

type NavResponse = { role: string; items: { label: string; href: string }[] };

const EXPECTED: Record<string, string[]> = {
  admin_savr: ['Clients', 'Paramètres', 'Collectes', 'Événements'],
  // Nav réalignée sur §06.04 §1 (4 entrées V1) en M3.1, plus « Événements »
  // (Val 2026-10-29). « Mon organisation » et « Mon profil » sont des onglets
  // de « Paramètres » (Val 2026-10-31). Plus d'entrée « Collectes » côté
  // client depuis le 2026-11-05 (Val) : cf. ABSENT ci-dessous.
  traiteur_manager: ['Dashboard', 'Événements', 'Paramètres'],
  traiteur_commercial: ['Dashboard', 'Événements', 'Paramètres'],
  agence: ['Dashboard', 'Événements', 'Paramètres'],
  gestionnaire_lieux: ['Mes lieux', 'Événements'],
  // « Mes événements » renommé « Dashboard » (Val 2026-10-29).
  client_organisateur: ['Dashboard', 'Événements'],
};

// Entrées qu'un rôle ne doit PAS avoir (Val 2026-11-05 : « Collectes »
// réservée à l'Admin).
const ABSENT: Record<string, string[]> = {
  traiteur_manager: ['Collectes'],
  traiteur_commercial: ['Collectes'],
  agence: ['Collectes'],
  gestionnaire_lieux: ['Collectes'],
  client_organisateur: ['Collectes'],
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
    for (const absent of ABSENT[role] ?? []) {
      expect(
        labels,
        `rôle ${role} ne doit pas exposer "${absent}"`,
      ).not.toContain(absent);
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
