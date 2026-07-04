/**
 * M0.6 — Tarifs packs AG : modale Historique (BL-P2-07)
 * Vérifie que la modale Historique consomme le GET /history et rend les versions
 * (crédits, validité, « Modifié par »). L'historique = versions de la ligne
 * versionnée (pas de table _history — garde-fou 1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const roleRef = vi.hoisted(() => ({ current: 'admin_savr' }));
vi.mock('@/lib/use-user-role', () => ({
  useUserRole: () => roleRef.current,
}));

import TarifsPacksAGPage from './page';

const historyRow = {
  id: 'v-1',
  type_pack: 'unitaire',
  credits: 1,
  prix_unitaire_ht: 590,
  montant_total_ht: 590,
  mensualisable: false,
  nb_mensualites: null,
  valide_du: '2026-01-01',
  valide_jusqu_au: null,
  modifie_par_nom: 'Louis Martin',
  date_modif: '2026-01-01T08:00:00Z',
};

function installFetch() {
  global.fetch = vi.fn((url: string) => {
    const payload = url.includes('/history')
      ? { data: [historyRow] }
      : { data: [] };
    return Promise.resolve({
      ok: true,
      json: async () => payload,
    }) as unknown as Promise<Response>;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  roleRef.current = 'admin_savr';
  installFetch();
});
afterEach(() => vi.restoreAllMocks());

describe('M0.6 — Tarifs AG historique', () => {
  it('M0.6/tarifs-ag/history — ouvre la modale et rend les versions + « Modifié par »', async () => {
    render(<TarifsPacksAGPage />);
    await waitFor(() =>
      expect(screen.getAllByText('Historique').length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByText('Historique')[0]!);
    await waitFor(() => expect(screen.getByText('Louis Martin')).toBeDefined());
    // en-têtes de la modale historique
    expect(screen.getByText('Modifié par')).toBeDefined();
    expect(screen.getByText('Date modif')).toBeDefined();
  });
});
