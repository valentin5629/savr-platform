/**
 * R-UI-1 H1/H2 — Configuration auto-accept : le succès du basculement est un
 * Toast (plus de boîte verte inline) ; l'erreur API reste un bandeau AlertBar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

import AutoAcceptPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

const config = {
  id: 'cfg-1',
  organisation_id: 'org-1',
  auto_accept_actif: false,
  seuil_pax_min: null,
  seuil_pax_max: null,
  notes: null,
  created_at: '2026-10-01T00:00:00Z',
  organisations: { raison_sociale: 'Traiteur Test' },
  associations: null,
  transporteurs: null,
};

let patchOk = true;

beforeEach(() => {
  patchOk = true;
  global.fetch = vi.fn((_url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PATCH')
      return Promise.resolve({
        ok: patchOk,
        json: async () => (patchOk ? { data: config } : { error: 'Refusé' }),
      }) as unknown as Promise<Response>;
    return Promise.resolve({
      ok: true,
      json: async () => ({ data: [config] }),
    }) as unknown as Promise<Response>;
  }) as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

describe('R-UI-1 — auto-accept : feedback', () => {
  it(
    'activer → Toast « Auto-accept activé. », aucun bandeau inline',
    async () => {
      renderAvecToasts(<AutoAcceptPage />);
      // DataTable rend la vue bureau + la vue mobile : premier bouton.
      const [activer] = await screen.findAllByRole(
        'button',
        { name: 'Activer' },
        ATTENTE_UI,
      );
      fireEvent.click(activer!);
      expect(
        await screen.findByText('Auto-accept activé.', {}, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(
        document.querySelector('.bg-savr-success-subtle'),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'erreur API → bandeau AlertBar err avec le message serveur',
    async () => {
      patchOk = false;
      renderAvecToasts(<AutoAcceptPage />);
      // DataTable rend la vue bureau + la vue mobile : premier bouton.
      const [activer] = await screen.findAllByRole(
        'button',
        { name: 'Activer' },
        ATTENTE_UI,
      );
      fireEvent.click(activer!);
      const message = await screen.findByText('Refusé', {}, ATTENTE_UI);
      expect(message.closest('.bg-savr-error-subtle')).not.toBeNull();
      expect(screen.queryByText('Auto-accept activé.')).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
