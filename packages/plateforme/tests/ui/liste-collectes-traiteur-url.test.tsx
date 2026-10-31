/**
 * Liste Collectes traiteur — filtres synchronisés dans l'URL (FilterBar DS).
 *
 * Régression constatée en preview : onglet « Historique » (aujourd'hui vue
 * « Collectes passées ») puis type « Anti-Gaspi » en deux clics rapprochés →
 * l'URL perdait l'onglet,
 * parce qu'elle était réécrite depuis `useSearchParams` (en retard d'un rendu
 * après `router.replace`). L'URL est désormais reconstruite depuis l'état : ce
 * cas l'épingle avec un routeur dont l'URL ne suit JAMAIS (`replace` inerte),
 * le pire cas de ce retard.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  onTestFinished,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => searchParams,
  usePathname: () => '/traiteur/collectes',
}));

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}));

import TraiteurCollectesPage from '@/app/(traiteur)/traiteur/collectes/page.js';

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

const fetchParDefaut = (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/traiteur/collectes/filtres'))
    return jsonResponse({
      data: {
        lieux: [{ id: 'lieu-a', nom: 'Pavillon Gabriel' }],
        clients: [],
        programmateurs: [],
      },
    });
  // Détail d'une fiche ouverte en pop-up (?collecte=<id>).
  if (url.includes('/traiteur/collectes/c9'))
    return jsonResponse({ data: null });
  return jsonResponse({ data: [] });
};
const fetchMock = vi.fn(fetchParDefaut);

function derniereUrl(): URLSearchParams {
  const url = String(replace.mock.calls.at(-1)?.[0] ?? '');
  return new URLSearchParams(url.split('?')[1] ?? '');
}

describe('Liste Collectes traiteur — filtres dans l’URL', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    replace.mockClear();
    searchParams = new URLSearchParams();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it(
    'url/onglet_puis_type_conserve_les_deux',
    async () => {
      render(<TraiteurCollectesPage />);
      fireEvent.mouseDown(
        screen.getByRole('tab', { name: 'Collectes passées' }),
      );
      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      await waitFor(() => expect(replace).toHaveBeenCalledTimes(2), ATTENTE_UI);
      const usp = derniereUrl();
      expect(usp.get('onglet')).toBe('passees');
      expect(usp.get('type')).toBe('anti_gaspi');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'type/toutes_par_defaut_colonne_type_seulement_sur_toutes',
    async () => {
      // « Toutes » par défaut (Val 2026-10-31) : la liste part sans type et
      // chaque ligne porte son picto ZD / AG dans la colonne Type.
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/filtres'))
          return jsonResponse({
            data: { lieux: [], clients: [], programmateurs: [] },
          });
        return jsonResponse({
          data: [
            {
              id: 'z1',
              type: 'zero_dechet',
              statut: 'validee',
              date_collecte: '2099-01-02',
              heure_collecte: '10:00',
              programmee_par_tiers: false,
              rapport_reserve_donneur_ordre: false,
              poids_total_kg: null,
              taux_recyclage: null,
              co2_evite_kg: null,
              nb_repas_donnes: null,
              evenements: null,
            },
            {
              id: 'a1',
              type: 'anti_gaspi',
              statut: 'validee',
              date_collecte: '2099-01-03',
              heure_collecte: '10:00',
              programmee_par_tiers: false,
              rapport_reserve_donneur_ordre: false,
              poids_total_kg: null,
              taux_recyclage: null,
              co2_evite_kg: null,
              nb_repas_donnes: null,
              evenements: null,
            },
          ],
        });
      });
      onTestFinished(() => {
        fetchMock.mockImplementation(fetchParDefaut);
      });
      render(<TraiteurCollectesPage />);
      expect(screen.getByRole('radio', { name: 'Toutes' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      const table = await screen.findByTestId(
        'collectes-table',
        {},
        ATTENTE_UI,
      );
      expect(screen.getByRole('columnheader', { name: /Type/ })).toBeTruthy();
      // Chaque ligne porte le badge de SON type (tri par date : z1 puis a1).
      await waitFor(
        () => expect(within(table).getAllByRole('row')).toHaveLength(3),
        ATTENTE_UI,
      );
      const [, ligneZd, ligneAg] = within(table).getAllByRole('row');
      expect(within(ligneZd!).getByText('ZD')).toBeTruthy();
      expect(within(ligneZd!).queryByText('AG')).toBeNull();
      expect(within(ligneAg!).getByText('AG')).toBeTruthy();
      expect(within(ligneAg!).queryByText('ZD')).toBeNull();
      const liste = fetchMock.mock.calls
        .map(([u]) => String(u))
        .filter((u) => !u.includes('/filtres'))
        .at(-1)!;
      expect(new URLSearchParams(liste.split('?')[1]).has('type')).toBe(false);

      // Un seul type : la colonne disparaît, le type part dans la requête
      // et dans l'URL.
      fireEvent.click(screen.getByRole('radio', { name: 'Zéro Déchet' }));
      await waitFor(
        () =>
          expect(
            screen.queryByRole('columnheader', { name: /^Type/ }),
          ).toBeNull(),
        ATTENTE_UI,
      );
      expect(derniereUrl().get('type')).toBe('zero_dechet');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'url/fiche_popup_ouverte_depuis_l_url_puis_fermee_sans_perdre_les_filtres',
    async () => {
      // Lien profond (email, dashboard, ancienne route [id] redirigée) : la fiche
      // s'ouvre en pop-up par-dessus la liste filtrée.
      searchParams = new URLSearchParams(
        'onglet=historique&statut=cloturee&collecte=c9',
      );
      render(<TraiteurCollectesPage />);
      const dialog = await screen.findByRole('dialog', {}, ATTENTE_UI);
      await waitFor(
        () => expect(dialog).toHaveTextContent('Collecte introuvable.'),
        ATTENTE_UI,
      );
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).endsWith('/api/v1/traiteur/collectes/c9'),
        ),
      ).toBe(true);

      // Fermeture : le paramètre `collecte` disparaît, les filtres restent.
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(
        () => expect(screen.queryByRole('dialog')).toBeNull(),
        ATTENTE_UI,
      );
      const usp = derniereUrl();
      expect(usp.get('collecte')).toBeNull();
      // Un lien d'avant (`onglet=historique`) est réécrit sous son nom actuel.
      expect(usp.get('onglet')).toBe('passees');
      expect(usp.get('statut')).toBe('cloturee');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'url/barre_pre_remplie_depuis_l_url_et_filtre_ecrit_dans_l_url',
    async () => {
      searchParams = new URLSearchParams(
        'onglet=historique&statut=cloturee&from=2026-09-01&to=2026-09-30&commercial=u1',
      );
      render(<TraiteurCollectesPage />);
      // La barre reflète l'URL (rechargement / drill-down dashboard).
      expect(screen.getByTestId('filtre-statut')).toHaveTextContent('Réalisée');
      expect(screen.getByTestId('filtre-periode')).toHaveAttribute(
        'data-from',
        '2026-09-01',
      );
      // Cocher un lieu réécrit l'URL sans perdre le reste.
      fireEvent.click(screen.getByTestId('filtre-lieu'));
      fireEvent.click(
        await screen.findByRole(
          'checkbox',
          { name: 'Pavillon Gabriel' },
          ATTENTE_UI,
        ),
      );
      const usp = derniereUrl();
      expect(usp.get('lieu')).toBe('lieu-a');
      expect(usp.get('statut')).toBe('cloturee');
      expect(usp.get('from')).toBe('2026-09-01');
      // Un lien d'avant (`onglet=historique`) est réécrit sous son nom actuel.
      expect(usp.get('onglet')).toBe('passees');
      expect(usp.get('commercial')).toBe('u1');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'url/drill_down_top_lieux_chip_filtre_actif_puis_effacement',
    async () => {
      // CDC §06.04 Top lieux : drill-down → chip « Filtre actif » en tête.
      searchParams = new URLSearchParams(
        'onglet=historique&lieu=lieu-a&statut=cloturee&from=2026-09-01&to=2026-09-30&perimetre=organisation',
      );
      render(<TraiteurCollectesPage />);
      const chip = await screen.findByTestId('filtre-actif', {}, ATTENTE_UI);
      await waitFor(
        () => expect(chip).toHaveTextContent('Lieu : Pavillon Gabriel'),
        ATTENTE_UI,
      );
      expect(chip).toHaveTextContent('clôturées');
      // ✕ : sort du drill-down ET du périmètre miroir.
      fireEvent.click(chip.querySelector('button') as HTMLButtonElement);
      const usp = derniereUrl();
      expect(usp.get('lieu')).toBeNull();
      expect(usp.get('statut')).toBeNull();
      expect(usp.get('from')).toBeNull();
      expect(usp.get('perimetre')).toBeNull();
      // Un lien d'avant (`onglet=historique`) est réécrit sous son nom actuel.
      expect(usp.get('onglet')).toBe('passees');
      expect(screen.queryByTestId('filtre-actif')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
