/**
 * M0.6 — Page catalogue Grilles tarifaires ZD (BL-P2-04)
 * Vérifie : rendu du catalogue (mode + nb organisations + badge défaut),
 * création via POST (corps { nom, mode, paliers }), bandeau ops read-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const roleRef = vi.hoisted(() => ({ current: 'admin_savr' }));
vi.mock('@/lib/use-user-role', () => ({
  useUserRole: () => roleRef.current,
}));

import GrillesZdPage from './page';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
let calls: FetchCall[] = [];

const grille = {
  id: 'g-1',
  nom: 'Grille standard V1',
  description: null,
  mode: 'paliers',
  est_defaut: true,
  actif: true,
  valide_du: '2026-01-01',
  valide_jusqu: null,
  nb_organisations: 4,
  tarifs_zero_dechet: [],
};

function installFetch() {
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const payload = method === 'POST' ? { id: 'g-2' } : { data: [grille] };
    return Promise.resolve({
      ok: true,
      json: async () => payload,
    }) as unknown as Promise<Response>;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  roleRef.current = 'admin_savr';
  installFetch();
});
afterEach(() => vi.restoreAllMocks());

describe('M0.6 — Grilles ZD catalogue', () => {
  it('M0.6/grilles-zd/catalogue — rend le mode, le nb d’organisations et le badge défaut', async () => {
    render(<GrillesZdPage />);
    await waitFor(() =>
      expect(screen.getByText('Grille standard V1')).toBeDefined(),
    );
    expect(screen.getByText('Paliers (montant fixe)')).toBeDefined();
    expect(screen.getByText('4')).toBeDefined();
    expect(screen.getByText('Par défaut')).toBeDefined();
  });

  it('M0.6/grilles-zd/catalogue — crée une grille (POST { nom, mode, paliers })', async () => {
    render(<GrillesZdPage />);
    await waitFor(() =>
      expect(screen.getByText('Grille standard V1')).toBeDefined(),
    );
    fireEvent.click(screen.getByText('Créer une grille'));
    await waitFor(() =>
      expect(screen.getByText('Nouvelle grille tarifaire ZD')).toBeDefined(),
    );
    // nom
    const nom = screen
      .getAllByRole('textbox')
      .find((el) => (el as HTMLInputElement).type !== 'textarea');
    fireEvent.change(nom as HTMLElement, { target: { value: 'Grille 2026' } });
    // premier palier : pax_min + prix fixe
    const numbers = screen.getAllByRole('spinbutton');
    fireEvent.change(numbers[0]!, { target: { value: '1' } });
    fireEvent.change(numbers[2]!, { target: { value: '500' } });
    fireEvent.click(screen.getByText('Créer la grille'));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST');
      expect(post).toBeDefined();
    });
    const post = calls.find((c) => c.method === 'POST');
    const body = post?.body as {
      nom: string;
      mode: string;
      paliers: unknown[];
    };
    expect(body.nom).toBe('Grille 2026');
    expect(body.mode).toBe('paliers');
    expect(body.paliers).toHaveLength(1);
  });

  it('M0.6/grilles-zd/catalogue — bandeau lecture seule + création masquée si ops_savr', async () => {
    roleRef.current = 'ops_savr';
    render(<GrillesZdPage />);
    await waitFor(() =>
      expect(screen.getByText('Grille standard V1')).toBeDefined(),
    );
    expect(
      screen.getByText('Lecture seule — édition réservée admin.'),
    ).toBeDefined();
    expect(screen.queryByText('Créer une grille')).toBeNull();
  });
});
