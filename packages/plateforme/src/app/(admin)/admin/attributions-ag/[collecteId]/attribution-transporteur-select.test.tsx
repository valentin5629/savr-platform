/**
 * Écran Attribution AG — choix du transporteur par liste déroulante (revue écran
 * E2E 2026-09-17, BL-P1-ALGO-04). La recherche libre ne trouvait rien à la touche
 * Entrée ; l'Admin choisit désormais parmi TOUS les transporteurs actifs, le
 * recommandé pré-sélectionné. Choisir un autre transporteur = override → motif
 * obligatoire (CDC §06.09 §3), inchangé.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ collecteId: 'col-1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

import AttributionDetailPage from './page';
import { ATTENTE_UI } from '@/test-utils/attente-ui';

const ALGO = {
  associations: [
    {
      id: 'asso-1',
      nom: 'Asso Un',
      distance_km: 2,
      capacite_max_beneficiaires: 100,
      contact_email: 'a@asso.test',
    },
  ],
  assoc_count: 1,
  transporteur: { id: 'tr-reco', nom: 'Transport Reco', type_tms: 'x' },
  transporteurs: [{ id: 'tr-reco', nom: 'Transport Reco', type_tms: 'x' }],
  branche: 'ag_marathon_nuit',
  is_idf: true,
  no_asso: false,
  no_prestataire: false,
  delai_minutes: 600,
  nb_pax: 150,
};

const TRANSPORTEURS = [
  { id: 'tr-autre', nom: 'Transport Autre', type_tms: 'x', ville: 'Montreuil' },
  { id: 'tr-reco', nom: 'Transport Reco', type_tms: 'x', ville: 'Paris' },
];

function installFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = url.includes('/recommandation')
      ? { data: ALGO }
      : url.includes('/admin/transporteurs')
        ? { data: TRANSPORTEURS }
        : url.includes('/valider') && init?.method === 'POST'
          ? { data: { attribution_id: 'att-1' } }
          : { data: [] };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('M2.3 / Attribution AG — liste déroulante transporteur', () => {
  it('liste tous les transporteurs actifs, recommandé pré-sélectionné, sans motif', async () => {
    const fetchMock = installFetch();
    render(<AttributionDetailPage />);

    const select = (await screen.findByLabelText(
      'Transporteur',
      undefined,
      ATTENTE_UI,
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3), ATTENTE_UI);
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).includes('/api/v1/admin/transporteurs?actif=true'),
      ),
    ).toBe(true);
    expect(select.value).toBe('tr-reco');
    expect(
      screen.getByRole('option', {
        name: 'Transport Reco · Paris (recommandé)',
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/motif obligatoire/)).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: "Valider l'attribution",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('choisir un autre transporteur exige un motif puis envoie ce transporteur', async () => {
    const fetchMock = installFetch();
    render(<AttributionDetailPage />);

    const select = (await screen.findByLabelText(
      'Transporteur',
      undefined,
      ATTENTE_UI,
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3), ATTENTE_UI);

    fireEvent.change(select, { target: { value: 'tr-autre' } });

    const valider = screen.getByRole('button', {
      name: "Valider l'attribution",
    }) as HTMLButtonElement;
    expect(screen.getByText(/motif obligatoire/)).toBeTruthy();
    expect(valider.disabled).toBe(true);

    fireEvent.change(screen.getByDisplayValue('Choisir un motif…'), {
      target: { value: 'transporteur_top1_indispo' },
    });
    expect(valider.disabled).toBe(false);
    fireEvent.click(valider);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u]) =>
        String(u).includes('/valider'),
      );
      expect(post).toBeTruthy();
      const sent = JSON.parse(String(post![1]!.body)) as Record<
        string,
        unknown
      >;
      expect(sent.transporteur_id).toBe('tr-autre');
      expect(sent.mode_validation).toBe('manuel_override');
      expect(sent.motif_override).toBe('transporteur_top1_indispo');
    }, ATTENTE_UI);
  });
});
