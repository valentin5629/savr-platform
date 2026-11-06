/**
 * Ligne « Logo du client » des fiches collecte (décision Val 2026-10-30).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';
import { LogoClientRapport } from './logo-client-rapport';

const ENDPOINT = '/api/v1/traiteur/collectes/c1/logo-client';

afterEach(() => vi.unstubAllGlobals());

function monter() {
  return renderAvecToasts(
    <LogoClientRapport id="logo-test" endpoint={ENDPOINT} />,
  );
}

describe('LogoClientRapport', () => {
  it('sans logo (aperçu en 404) : « Ajouter le logo », pas de « Retirer »', () => {
    const { container } = monter();
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`${ENDPOINT}?v=0`);
    fireEvent.error(img);
    expect(screen.getByText('Ajouter le logo')).toBeInTheDocument();
    expect(screen.queryByText('Retirer')).not.toBeInTheDocument();
  });

  it('avec logo : aperçu affiché, « Remplacer le logo » et « Retirer »', () => {
    const { container } = monter();
    fireEvent.load(container.querySelector('img')!);
    expect(screen.getByText('Remplacer le logo')).toBeInTheDocument();
    expect(screen.getByText('Retirer')).toBeInTheDocument();
  });

  it(
    'dépôt : POST multipart sur la route de l’espace, puis aperçu rechargé',
    async () => {
      const fetchMock = vi.fn(async () =>
        Response.json({ logo: true, rapports_refaits: 1 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const { container } = monter();
      const file = new File(['x'], 'logo.png', { type: 'image/png' });
      fireEvent.change(container.querySelector('#logo-test')!, {
        target: { files: [file] },
      });
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }, ATTENTE_UI);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(ENDPOINT);
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      expect(
        await screen.findByText(
          'Logo du client enregistré.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Les rapports de don déjà disponibles sont en cours de mise à jour.',
        ),
      ).toBeInTheDocument();
      expect(container.querySelector('img')!.getAttribute('src')).toBe(
        `${ENDPOINT}?v=1`,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'refus du serveur : message affiché',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            { error: 'Fichier trop volumineux (2 Mo maximum)' },
            { status: 422 },
          ),
        ),
      );
      const { container } = monter();
      fireEvent.change(container.querySelector('#logo-test')!, {
        target: { files: [new File(['x'], 'l.png', { type: 'image/png' })] },
      });
      expect(
        await screen.findByText(
          'Fichier trop volumineux (2 Mo maximum)',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'retrait : DELETE sur la route de l’espace',
    async () => {
      const fetchMock = vi.fn(async () =>
        Response.json({ logo: false, rapports_refaits: 0 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const { container } = monter();
      fireEvent.load(container.querySelector('img')!);
      fireEvent.click(screen.getByText('Retirer'));
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, { method: 'DELETE' });
      }, ATTENTE_UI);
      expect(
        await screen.findByText(
          'Logo du client retiré.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
