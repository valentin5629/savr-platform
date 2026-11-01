/**
 * « Mon profil » : champ « Poste » (Val 2026-11-01), libre, sans effet sur les
 * droits. Prérempli depuis GET /api/me/profil, envoyé avec le reste du profil.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { RgpdComptePanel } from './rgpd-compte-panel';
import { renderAvecToasts } from '@/test-utils/toasts';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Mon profil — poste', () => {
  it(
    'profil_poste_prerempli_et_envoye',
    async () => {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data:
                init?.method === 'PATCH'
                  ? {}
                  : {
                      prenom: 'Valérie',
                      nom: 'Paris',
                      telephone: null,
                      poste: 'Chargée RSE',
                    },
            }),
            { status: 200 },
          ),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      renderAvecToasts(<RgpdComptePanel />);

      const poste = await screen.findByLabelText('Poste', {}, ATTENTE_UI);
      await waitFor(() => expect(poste).toHaveValue('Chargée RSE'), ATTENTE_UI);
      expect(poste).toHaveAttribute('maxlength', '100');
      fireEvent.change(poste, { target: { value: 'Responsable RSE' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          ([, init]) => init?.method === 'PATCH',
        );
        expect(JSON.parse(String(patch![1]!.body))).toMatchObject({
          prenom: 'Valérie',
          nom: 'Paris',
          poste: 'Responsable RSE',
        });
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it('profil_sans_preferences_ni_securite — cartes retirées (Val 2026-11-01)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderAvecToasts(<RgpdComptePanel />);
    expect(screen.queryByText('Préférences')).toBeNull();
    expect(screen.queryByText('Sécurité du compte')).toBeNull();
  });
});
