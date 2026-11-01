/**
 * Ordre des onglets de « Paramètres » côté agence et client organisateur
 * (Val 2026-11-01) : Mon profil d'abord, ouvert par défaut, puis Organisation.
 * Traiteur et gestionnaire : mon-organisation-commercial.test.tsx et
 * mon-organisation-gestionnaire.m3-2.test.tsx.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('@/lib/page-auth', () => ({
  requirePageSession: vi.fn(async () => ({})),
}));

import ParametresAgencePage from '@/app/(agence)/agence/parametres/page';
import ParametresOrganisateurPage from '@/app/(client-organisateur)/organisateur/parametres/page';

const nomsOnglets = (): string[] =>
  screen.getAllByRole('tab').map((t) => t.textContent ?? '');
const ongletActif = (): string | null | undefined =>
  screen
    .getAllByRole('tab')
    .find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Paramètres — ordre des onglets', () => {
  it.each([
    ['agence', ParametresAgencePage],
    ['organisateur', ParametresOrganisateurPage],
  ] as const)(
    'parametres_ordre_onglets — %s : Mon profil puis Organisation',
    async (_nom, Page) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => {})),
      );
      render(await Page({ searchParams: Promise.resolve({}) }));
      // Facturation masquée : facturation hors plateforme (Val 2026-10-22).
      expect(nomsOnglets()).toEqual(['Mon profil', 'Organisation']);
      expect(ongletActif()).toBe('Mon profil');
    },
  );
});
