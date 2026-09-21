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
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

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

function installFetch(
  opts: { algo?: typeof ALGO; transporteursKo?: () => boolean } = {},
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/admin/transporteurs') && opts.transporteursKo?.()) {
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'x' }),
      } as Response);
    }
    const body = url.includes('/recommandation')
      ? { data: opts.algo ?? ALGO }
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
  it(
    'liste tous les transporteurs actifs, recommandé pré-sélectionné, sans motif',
    async () => {
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
    },
    ATTENTE_CAS_MS,
  );

  it(
    'choisir un autre transporteur exige un motif puis envoie ce transporteur',
    async () => {
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
    },
    ATTENTE_CAS_MS,
  );
  it(
    'aucun prestataire recommandé : liste vide au départ, choix dans la liste + motif obligatoire',
    async () => {
      installFetch({
        algo: {
          ...ALGO,
          transporteur: null,
          transporteurs: [],
          branche: 'aucun_prestataire',
          no_prestataire: true,
        } as unknown as typeof ALGO,
      });
      render(<AttributionDetailPage />);

      const select = (await screen.findByLabelText(
        'Transporteur',
        undefined,
        ATTENTE_UI,
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.options.length).toBe(3), ATTENTE_UI);
      expect(select.value).toBe('');
      const valider = screen.getByRole('button', {
        name: "Valider l'attribution",
      }) as HTMLButtonElement;
      expect(valider.disabled).toBe(true);

      fireEvent.change(select, { target: { value: 'tr-autre' } });
      expect(screen.getByText(/motif obligatoire/)).toBeTruthy();
      expect(valider.disabled).toBe(true);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'province : choisir le 2e du top 3 dans la liste = override avec motif',
    async () => {
      installFetch({
        algo: {
          ...ALGO,
          is_idf: false,
          branche: 'ag_province_proximite',
          transporteurs: [
            { id: 'tr-reco', nom: 'Transport Reco', type_tms: 'x' },
            { id: 'tr-autre', nom: 'Transport Autre', type_tms: 'x' },
          ],
        },
      });
      render(<AttributionDetailPage />);

      const select = (await screen.findByLabelText(
        'Transporteur',
        undefined,
        ATTENTE_UI,
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.options.length).toBe(3), ATTENTE_UI);
      expect(screen.queryByText(/motif obligatoire/)).toBeNull();

      fireEvent.change(select, { target: { value: 'tr-autre' } });
      expect(screen.getByText(/motif obligatoire/)).toBeTruthy();

      // Retour au choix vide : pas de transporteur, bouton désactivé.
      fireEvent.change(select, { target: { value: '' } });
      expect(select.value).toBe('');
      expect(
        (
          screen.getByRole('button', {
            name: "Valider l'attribution",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'échec du chargement des transporteurs : message + Réessayer, recommandé toujours affiché',
    async () => {
      let ko = true;
      installFetch({ transporteursKo: () => ko });
      render(<AttributionDetailPage />);

      expect(
        await screen.findByText(
          'Impossible de charger la liste des transporteurs.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      const select = screen.getByLabelText('Transporteur') as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe('tr-reco'), ATTENTE_UI);

      ko = false;
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      await waitFor(() => expect(select.options.length).toBe(3), ATTENTE_UI);
      expect(
        screen.queryByText('Impossible de charger la liste des transporteurs.'),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
