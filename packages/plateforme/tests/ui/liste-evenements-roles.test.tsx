/**
 * Liste Événements commune à tous les rôles (décision Val 2026-10-29) : une
 * seule implémentation, montée par la page Événements de chaque espace. Ici,
 * seuls les réglages par espace : le reste de la liste est couvert par
 * tests/ui/evenements-gestionnaire.m3-2.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/traiteur/evenements',
}));

import AdminEvenementsPage from '@/app/(admin)/admin/evenements/page.js';
import AgenceEvenementsPage from '@/app/(agence)/agence/evenements/page.js';
import OrganisateurEvenementsPage from '@/app/(client-organisateur)/organisateur/evenements/page.js';
import TraiteurEvenementsPage from '@/app/(traiteur)/traiteur/evenements/page.js';
import { ATTENTE_UI } from '@/test-utils/attente-ui';

const LIGNE = {
  id: 'e1',
  nom_evenement: 'Gala de printemps',
  date_evenement: '2026-11-02',
  pax: 300,
  client_nom: 'Maison X',
  lieu_nom: 'Pavillon',
  lieu_adresse: null,
  traiteur_nom: 'Potel',
  nb_collectes_zd: 1,
  nb_collectes_ag: 0,
  nb_realisees: 0,
  nb_sans_excedent: 0,
  tonnage_zd_kg: null,
  taux_recyclage: null,
  repas_donnes: null,
  co2_evite_kg: null,
  dechets_labo_kg: null,
  statut_consolide: 'À venir',
};

let appels: string[] = [];
beforeEach(() => {
  appels = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      appels.push(url);
      const body = url.includes('/evenements/filtres')
        ? {
            data: {
              lieux: [],
              traiteurs: [],
              clients: [{ id: 'o1', nom: 'Potel' }],
              types: [],
            },
          }
        : { data: [LIGNE], total: 1 };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      } as Response);
    }),
  );
});

async function tableau() {
  return screen.findByTestId('evenements-table', undefined, ATTENTE_UI);
}

describe('Liste Événements — réglages par espace', () => {
  it('M3.2/liste_evenements_route_commune — chaque espace lit la même route', async () => {
    render(<AgenceEvenementsPage />);
    await tableau();
    expect(appels.some((u) => u.startsWith('/api/v1/evenements?'))).toBe(true);
    expect(appels).toContain('/api/v1/evenements/filtres');
  });

  it('M3.2/liste_evenements_traiteur_sans_colonne_ni_filtre_traiteur', async () => {
    render(<TraiteurEvenementsPage />);
    const table = await tableau();
    expect(
      within(table).queryByRole('columnheader', { name: /traiteur/i }),
    ).toBeNull();
    expect(screen.queryByTestId('filtre-traiteur')).toBeNull();
    expect(screen.queryByTestId('filtre-client')).toBeNull();
    // Gestionnaire seul (§05 R_dechets_labo_estimes).
    expect(
      within(table).queryByRole('columnheader', { name: /déchets labo/i }),
    ).toBeNull();
    expect(
      screen.getByText('Vos événements, résultats cumulés sur leurs collectes'),
    ).toBeInTheDocument();
  });

  it('M3.2/liste_evenements_admin_filtre_client', async () => {
    render(<AdminEvenementsPage />);
    await tableau();
    expect(screen.getByTestId('filtre-client')).toBeInTheDocument();
    expect(screen.getByTestId('filtre-traiteur')).toBeInTheDocument();
  });

  it('M3.2/liste_evenements_sans_fiche_hors_gestionnaire — ligne non cliquable, pas de chevron', async () => {
    render(<OrganisateurEvenementsPage />);
    const table = await tableau();
    expect(
      within(table).queryByRole('row', { name: /Ouvrir l'événement/ }),
    ).toBeNull();
    // Pas de chevron « Ouvrir » (colonne absente).
    expect(
      within(table).queryByRole('columnheader', { name: 'Ouvrir' }),
    ).toBeNull();
    // Grille + carte mobile : le nom apparaît deux fois.
    expect(
      within(table).getAllByText('Gala de printemps').length,
    ).toBeGreaterThan(0);
  });
});
