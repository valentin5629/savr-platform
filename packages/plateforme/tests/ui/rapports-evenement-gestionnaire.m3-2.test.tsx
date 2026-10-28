/**
 * M3.2 — fiche Événement du gestionnaire, onglet « Bilan & documents » :
 * rapports CUMULÉS sur l'événement et radar du bilan consolidé ZD (décision Val
 * 2026-10-26).
 *  - en tête des documents, « Rapport RSE de l'événement » (ZD) ou « Rapport de
 *    don de l'événement » (AG, récapitulatif sans valeur fiscale), fabriqué au
 *    clic dès qu'une collecte du type a ses résultats ;
 *  - radar ZD avec sa barre « Comparer avec », à l'écran ; la case « Inclure
 *    le radar » envoie les filtres réglés avec la demande du rapport.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire/evenements',
}));
vi.mock('@/components/collecte/fiche-collecte-client-modal', () => ({
  FicheCollecteClientModal: () => null,
}));

import { FicheEvenementModal } from '@/components/gestionnaire/fiche-evenement-modal';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';

const EVT_ID = '22222222-2222-4222-8222-222222222222';
const BASE = `/api/v1/gestionnaire/evenements/${EVT_ID}`;

const FLUX_VIDES = {
  biodechet: 0,
  emballage: 0,
  carton: 0,
  verre: 0,
  dechet_residuel: 0,
};

function fiche(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'cloturee',
    date_collecte: '2026-09-10',
    heure_collecte: null,
    pax: 400,
    type_evenement_id: 't1',
    evenement: { id: EVT_ID, lieu: null },
    tournees: [],
    rapport_rse_disponible: true,
    rapport_mis_a_jour_at: null,
    rapport_reserve_donneur_ordre: false,
    rapport_etat: 'disponible',
    actions: { modifier: 'absent', annuler: 'absent', annulation: null },
    ...over,
  };
}

function detail(bilan: Record<string, unknown> = {}, fiches = [fiche()]) {
  return {
    id: EVT_ID,
    nom_evenement: 'Gala',
    date_evenement: '2026-09-10',
    pax: 800,
    taille_bracket: 'L',
    client_nom: null,
    lieu_nom: 'Paris Expo',
    lieu_adresse: null,
    lieu_acces_details: null,
    traiteur: null,
    dechets_labo_kg: null,
    ajouter_collecte: false,
    bilan: {
      nb_collectes_zd: 1,
      nb_collectes_ag: 0,
      nb_realisees_zd: 1,
      nb_realisees_ag: 0,
      nb_sans_excedent: 0,
      tonnage_zd_kg: 400,
      flux_kg: { ...FLUX_VIDES, biodechet: 400 },
      taux_recyclage: 70,
      co2_evite_zd_kg: 50,
      repas_donnes: null,
      co2_evite_ag_kg: null,
      associations: [],
      premiere_collecte: '2026-09-10',
      derniere_collecte: '2026-09-10',
      statut_consolide: 'Terminé',
      ...bilan,
    },
    fiches,
  };
}

const json = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

function stubFetch(evt: unknown, rapportStatus = 200) {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:rapport'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const mock = vi.fn((url: string, init?: { method?: string }) => {
    const u = String(url);
    if (u.includes('/benchmark/filtres'))
      return Promise.resolve(
        json(200, {
          data: {
            lieux: [],
            traiteurs: [],
            types: [{ id: 't1', libelle: 'Gala' }],
          },
        }),
      );
    if (u.startsWith(`${BASE}/benchmark`))
      return Promise.resolve(
        json(200, {
          data: {
            flux: { biodechet: { ratio_user: 0.5, benchmark_kg_pax: 0.4 } },
          },
        }),
      );
    if (init?.method === 'POST')
      return Promise.resolve(
        rapportStatus === 200
          ? ({
              ok: true,
              status: 200,
              headers: new Headers({
                'Content-Disposition':
                  'attachment; filename="rapport-evenement.pdf"',
              }),
              blob: () => Promise.resolve(new Blob(['%PDF'])),
            } as unknown as Response)
          : json(rapportStatus, { error: 'Motif du serveur.' }),
      );
    return Promise.resolve(json(200, { data: evt }));
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const demandes = (mock: ReturnType<typeof stubFetch>) =>
  mock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([u, init]) => ({
      url: String(u),
      corps: JSON.parse((init as { body: string }).body),
    }));

async function ouvrirBilan() {
  render(<FicheEvenementModal evenementId={EVT_ID} onClose={vi.fn()} />);
  await screen.findByTestId('statut-evenement', undefined, ATTENTE_UI);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Bilan & documents' }));
  return screen.findByTestId('document-evenement-cumul', undefined, ATTENTE_UI);
}

const telecharger = (ligne: HTMLElement) =>
  within(ligne).getByRole('button', { name: 'Télécharger' });
const caseRadar = () =>
  screen.getByRole('checkbox', {
    name: 'Inclure le radar de comparaison dans le rapport',
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('M3.2 / fiche Événement — rapports cumulés', () => {
  it(
    'EVT/rapport_cumule_zd — ligne « Rapport RSE de l’événement » en tête, fabriqué au clic sans radar par défaut',
    async () => {
      const mock = stubFetch(detail());
      const ligne = await ouvrirBilan();
      expect(ligne).toHaveTextContent('Rapport RSE de l’événement');
      expect(ligne).toHaveTextContent('Cumul des collectes réalisées');
      // En tête : avant le rapport de chaque collecte.
      const docs = screen.getByTestId('documents-evenement');
      expect(docs.firstElementChild).toBe(ligne);
      expect(caseRadar().getAttribute('aria-checked')).toBe('false');
      fireEvent.click(telecharger(ligne));
      await waitFor(
        () => expect(URL.createObjectURL).toHaveBeenCalledTimes(1),
        ATTENTE_UI,
      );
      expect(demandes(mock)).toEqual([
        {
          url: `${BASE}/rapport-rse`,
          corps: { options: { benchmark: false } },
        },
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/radar_evenement — radar du bilan consolidé à l’écran, ouvert sur le segment de l’événement ; la case envoie ses filtres',
    async () => {
      const mock = stubFetch(detail());
      const ligne = await ouvrirBilan();
      expect(
        await screen.findByTestId('radar-evenement', undefined, ATTENTE_UI),
      ).toHaveTextContent('Votre événement face aux événements comparables');
      // Segment initial : types des collectes ZD, taille de l'événement.
      await waitFor(() => {
        const appel = mock.mock.calls
          .map(([u]) => String(u))
          .find((u) => u.startsWith(`${BASE}/benchmark?`));
        if (!appel) throw new Error('radar non chargé');
        expect(appel).toContain('type_evenement_ids=t1');
        expect(appel).toContain('taille_evenement_codes=L');
      }, ATTENTE_UI);
      fireEvent.click(caseRadar());
      fireEvent.click(telecharger(ligne));
      await waitFor(() => expect(demandes(mock)).toHaveLength(1), ATTENTE_UI);
      expect(demandes(mock)[0]!.corps).toEqual({
        options: { benchmark: true },
        benchmark_filters: {
          lieu_ids: [],
          type_evenement_ids: ['t1'],
          taille_evenement_codes: ['L'],
        },
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/rapport_cumule_attente — aucune collecte réalisée : « Télécharger » grisé, pas de case, radar en attente',
    async () => {
      stubFetch(
        detail(
          { nb_realisees_zd: 0, tonnage_zd_kg: null, flux_kg: FLUX_VIDES },
          [fiche({ statut: 'validee', rapport_rse_disponible: false })],
        ),
      );
      const ligne = await ouvrirBilan();
      expect(ligne).toHaveTextContent(
        'Disponible dès la première collecte réalisée',
      );
      expect(telecharger(ligne).hasAttribute('disabled')).toBe(true);
      expect(screen.queryByTestId('option-rapport-evenement-radar')).toBeNull();
      expect(screen.queryByTestId('radar-evenement')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/rapport_cumule_ag — « Rapport de don de l’événement » : récapitulatif sans valeur fiscale, sans case radar',
    async () => {
      const mock = stubFetch(
        detail(
          {
            nb_collectes_zd: 0,
            nb_realisees_zd: 0,
            tonnage_zd_kg: null,
            nb_collectes_ag: 2,
            nb_realisees_ag: 1,
            repas_donnes: 80,
          },
          [fiche({ type: 'anti_gaspi' })],
        ),
      );
      const ligne = await ouvrirBilan();
      expect(ligne).toHaveTextContent('Rapport de don de l’événement');
      expect(ligne).toHaveTextContent('sans valeur fiscale');
      expect(screen.queryByTestId('option-rapport-evenement-radar')).toBeNull();
      fireEvent.click(telecharger(ligne));
      await waitFor(() => expect(demandes(mock)).toHaveLength(1), ATTENTE_UI);
      expect(demandes(mock)[0]).toEqual({
        url: `${BASE}/rapport-de-don`,
        corps: { options: { benchmark: false } },
      });
      // Pas de radar ni de repère parc demandé pour un événement sans ZD.
      expect(
        mock.mock.calls.some(([u]) =>
          String(u).startsWith(`${BASE}/benchmark`),
        ),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/rapport_cumule_refus — refus du serveur : son motif est affiché',
    async () => {
      stubFetch(detail(), 409);
      const ligne = await ouvrirBilan();
      fireEvent.click(telecharger(ligne));
      expect(
        await screen.findByRole('alert', {}, ATTENTE_UI),
      ).toHaveTextContent('Motif du serveur.');
    },
    ATTENTE_CAS_MS,
  );
});
