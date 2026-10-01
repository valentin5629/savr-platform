/**
 * Liste Collectes traiteur — filtres synchronisés dans l'URL (FilterBar DS).
 *
 * Régression constatée en preview : onglet « Historique » puis type
 * « Anti-Gaspi » en deux clics rapprochés → l'URL perdait `onglet=historique`,
 * parce qu'elle était réécrite depuis `useSearchParams` (en retard d'un rendu
 * après `router.replace`). L'URL est désormais reconstruite depuis l'état : ce
 * cas l'épingle avec un routeur dont l'URL ne suit JAMAIS (`replace` inerte),
 * le pire cas de ce retard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
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

const fetchMock = vi.fn((input: RequestInfo | URL) => {
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
});

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
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Historique' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      await waitFor(() => expect(replace).toHaveBeenCalledTimes(2), ATTENTE_UI);
      const usp = derniereUrl();
      expect(usp.get('onglet')).toBe('historique');
      expect(usp.get('type')).toBe('anti_gaspi');
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
      expect(usp.get('onglet')).toBe('historique');
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
      expect(usp.get('onglet')).toBe('historique');
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
      expect(usp.get('onglet')).toBe('historique');
      expect(screen.queryByTestId('filtre-actif')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
