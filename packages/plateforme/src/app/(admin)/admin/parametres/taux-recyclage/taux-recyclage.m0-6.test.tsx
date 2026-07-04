/**
 * M0.6 — Page Taux de recyclage (BL-P2-06)
 * Vérifie : modale Historique (consomme le GET, rend « Modifié par »),
 * en-tête Idempotency-Key envoyé au PUT (CDC §9 l.783), bandeau ops read-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const roleRef = vi.hoisted(() => ({ current: 'admin_savr' }));
vi.mock('@/lib/use-user-role', () => ({
  useUserRole: () => roleRef.current,
}));

import TauxRecyclagePage from './page';

interface FetchCall {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body: unknown;
}
let calls: FetchCall[] = [];

const filiere = {
  id: 'fil-1',
  code_filiere: 'biodechet',
  nom_filiere: 'Biodéchets',
  taux_captation: 0.87,
  prestataire: 'Veolia',
  source_donnee: 'ADEME 2017',
  actif: true,
};

const historyRow = {
  id: 'h-1',
  taux_captation_avant: 0.85,
  taux_captation_apres: 0.87,
  prestataire_avant: 'Veolia',
  prestataire_apres: 'Veolia',
  source_donnee_avant: 'ADEME 2015',
  source_donnee_apres: 'ADEME 2017',
  commentaire_modif: 'Mise à jour barème',
  modifie_par_nom: 'Valentin Le Blan',
  modifie_le: '2026-04-12T09:00:00Z',
};

function installFetch() {
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url,
      method,
      headers: init?.headers as Record<string, string> | undefined,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    let payload: unknown = { data: [] };
    const isDetail = /\/taux-recyclage\/fil-1$/.test(url);
    if (method === 'GET' && !isDetail) payload = { data: [filiere] };
    else if (method === 'GET' && isDetail) payload = { data: [historyRow] };
    else if (method === 'PUT') payload = { ...filiere, taux_captation: 0.9 };
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

describe('M0.6 — Taux recyclage page', () => {
  it('M0.6/taux-recyclage/page — rend les filières avec le bouton Historique', async () => {
    render(<TauxRecyclagePage />);
    await waitFor(() => expect(screen.getByText('Biodéchets')).toBeDefined());
    expect(screen.getByText('Historique')).toBeDefined();
  });

  it('M0.6/taux-recyclage/page — ouvre la modale Historique et rend « Modifié par »', async () => {
    render(<TauxRecyclagePage />);
    await waitFor(() => expect(screen.getByText('Biodéchets')).toBeDefined());
    fireEvent.click(screen.getByText('Historique'));
    await waitFor(() =>
      expect(screen.getByText('Valentin Le Blan')).toBeDefined(),
    );
    expect(screen.getByText('Mise à jour barème')).toBeDefined();
  });

  it('M0.6/taux-recyclage/page — le PUT envoie un en-tête Idempotency-Key', async () => {
    render(<TauxRecyclagePage />);
    await waitFor(() => expect(screen.getByText('Biodéchets')).toBeDefined());
    fireEvent.click(screen.getByText('Modifier'));
    await waitFor(() => expect(screen.getByText(/Modifier —/)).toBeDefined());
    const textarea = screen.getByPlaceholderText('Motif de la modification…');
    fireEvent.change(textarea, { target: { value: 'Correction ADEME' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put).toBeDefined();
    });
    const put = calls.find((c) => c.method === 'PUT');
    const headers = (put?.headers ?? {}) as Record<string, string>;
    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).toContain('idempotency-key');
    expect(headers['idempotency-key']).toBeTruthy();
  });

  it('M0.6/taux-recyclage/page — bandeau lecture seule + Modifier masqué si ops_savr', async () => {
    roleRef.current = 'ops_savr';
    render(<TauxRecyclagePage />);
    await waitFor(() => expect(screen.getByText('Biodéchets')).toBeDefined());
    expect(
      screen.getByText('Lecture seule — édition réservée admin.'),
    ).toBeDefined();
    expect(screen.queryByText('Modifier')).toBeNull();
  });
});
