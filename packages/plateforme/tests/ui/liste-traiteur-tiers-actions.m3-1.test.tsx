/**
 * M3.1 — Liste Collectes traiteur : collecte programmée par un tiers (§06.04,
 * décision Val 2026-10-10). Le traiteur opérationnel ne la modifie ni ne
 * l'annule : dans le menu « ⋯ » de la ligne (revue écran 2026-10-29), ces
 * actions sont grisées avec leur raison, comme sur la fiche — même pour un
 * manager. Épingle le câblage page → table (`canWrite` de la liste).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  within,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('type=zero_dechet'),
  usePathname: () => '/traiteur/collectes',
}));

// Jeton du manager (claim métier `user_role`, lu par la liste).
const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
const JETON_MANAGER = `${b64url({ alg: 'HS256' })}.${b64url({
  sub: 'u-manager',
  user_role: 'traiteur_manager',
})}.sig`;
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: JETON_MANAGER } },
        }),
    },
  }),
}));

import TraiteurCollectesPage from '@/app/(traiteur)/traiteur/collectes/page.js';

function collecteZd(id: string, lieu: string, tiers: boolean) {
  return {
    id,
    type: 'zero_dechet',
    statut: 'validee',
    date_collecte: '2099-01-10',
    heure_collecte: '22:00:00',
    programmee_par_tiers: tiers,
    rapport_reserve_donneur_ordre: false,
    poids_total_kg: null,
    taux_recyclage: null,
    co2_evite_kg: null,
    nb_repas_donnes: null,
    pax: 200,
    evenements: {
      created_by: 'u-autre',
      pax: 200,
      nom_client_organisateur: null,
      lieux: { nom: lieu, adresse_acces: null, code_postal: null, ville: null },
    },
  };
}

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  const data = url.includes('/traiteur/collectes/filtres')
    ? { lieux: [], clients: [], programmateurs: [] }
    : [
        collecteZd('zd-tiers', 'Pavillon Tiers', true),
        collecteZd('zd-propre', 'Pavillon Propre', false),
      ];
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data }),
  } as Response);
});

// Ouvre le menu « ⋯ » d'une ligne, lit l'état de ses entrées, le referme.
async function etatsMenu(lieu: string) {
  const table = within(await screen.findByRole('table', {}, ATTENTE_UI));
  const ligne = within(
    (await table.findByText(lieu, {}, ATTENTE_UI)).closest('tr') as HTMLElement,
  );
  fireEvent.keyDown(
    ligne.getByRole('button', { name: 'Actions sur la collecte' }),
    { key: 'Enter' },
  );
  const menu = screen.getByRole('menu');
  try {
    const entree = (nom: RegExp) =>
      within(menu).getByRole('menuitem', { name: nom });
    return {
      modifier: entree(/^Modifier la collecte/).getAttribute('aria-disabled'),
      annuler: entree(/^Annuler la collecte/).getAttribute('aria-disabled'),
      texte: menu.textContent ?? '',
    };
  } finally {
    fireEvent.keyDown(menu, { key: 'Escape' });
  }
}

describe('M3.1 / liste traiteur — actions d’une collecte programmée par un tiers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it(
    'M3.1/liste_tiers_actions_grisees — manager : Modifier / Annuler grisés avec leur raison sur la collecte du tiers, actifs sur la sienne',
    async () => {
      render(<TraiteurCollectesPage />);
      // Le rôle arrive de la session après coup : attendre que la collecte
      // propre soit modifiable (manager reconnu).
      await waitFor(async () => {
        expect((await etatsMenu('Pavillon Propre')).modifier).not.toBe('true');
      }, ATTENTE_UI);
      const propre = await etatsMenu('Pavillon Propre');
      expect(propre.annuler).not.toBe('true');

      const tiers = await etatsMenu('Pavillon Tiers');
      expect(tiers.modifier).toBe('true');
      expect(tiers.annuler).toBe('true');
      expect(tiers.texte).toContain('Collecte programmée par un tiers');
    },
    ATTENTE_CAS_MS,
  );
});
