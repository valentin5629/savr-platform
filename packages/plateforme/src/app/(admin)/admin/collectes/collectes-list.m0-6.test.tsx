/**
 * M0.6 — Liste collectes Admin (BL-P1-BOA-05).
 * Colonnes (client organisateur, contrôle d'accès), indicateurs (rapport, poids
 * ZD, taux, repas AG, info incomplète, statut attribution) et filtres (statut
 * multi, info incomplète, rapport non consulté). Câblage sur l'API existante.
 *
 * NB : DataTable rend simultanément la vue desktop (table) et mobile (cards) —
 * chaque libellé apparaît plusieurs fois → assertions en getAllByText.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import CollectesPage from './page';

const collecteZd = {
  id: 'zd-1',
  type: 'zero_dechet',
  statut: 'cloturee',
  statut_tms: 'acceptee',
  dirty_tms: false,
  date_collecte: '2026-04-23',
  heure_collecte: '08:30:00',
  controle_acces_requis: true,
  informations_completes: true,
  taux_recyclage: 78.4,
  attributions_antgaspi: null,
  collecte_flux: [{ poids_reel_kg: 10 }, { poids_reel_kg: 2.5 }],
  rapports_rse: [
    {
      disponible_a: '2026-04-24T06:00:00Z',
      genere_at: '2026-04-24T06:00:00Z',
      regenere_at: null,
      consulte_par_user_at: null,
      version: 1,
    },
  ],
  evenements: {
    nom_evenement: 'Gala ZD',
    pax: 120,
    nom_client_organisateur: null,
    organisations: { raison_sociale: 'Traiteur Alpha' },
    client_organisateur: { raison_sociale: 'Mairie de Paris' },
    lieux: {
      nom: 'Salle Wagram',
      adresse_acces: '39 av de Wagram',
      code_postal: '75017',
      ville: 'Paris',
    },
  },
};

const collecteAg = {
  id: 'ag-1',
  type: 'anti_gaspi',
  statut: 'programmee',
  statut_tms: 'non_envoye',
  dirty_tms: false,
  date_collecte: '2026-05-10',
  heure_collecte: '19:00:00',
  controle_acces_requis: false,
  informations_completes: false,
  taux_recyclage: null,
  attributions_antgaspi: null,
  collecte_flux: [],
  rapports_rse: [],
  evenements: {
    nom_evenement: 'Cocktail AG',
    pax: 80,
    nom_client_organisateur: 'Fondation X',
    organisations: { raison_sociale: 'Traiteur Beta' },
    client_organisateur: null,
    lieux: {
      nom: 'Pavillon',
      adresse_acces: null,
      code_postal: '75008',
      ville: 'Paris',
    },
  },
};

function mockCollectesFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/v1/admin/collectes')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [collecteZd, collecteAg], total: 2 }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('M0.6 — liste collectes Admin (BL-P1-BOA-05)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — colonnes client organisateur + contrôle d’accès rendues', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);

    // En-têtes de colonne exigées §06.06 §3
    expect(
      (await screen.findAllByText('Client organisateur')).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Contrôle accès').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Indicateurs').length).toBeGreaterThan(0);

    // Client organisateur : raison sociale liée (ZD) ou texte libre (AG)
    expect(screen.getAllByText('Mairie de Paris').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fondation X').length).toBeGreaterThan(0);
  });

  it('M0.6 — indicateurs ZD (poids + taux) et AG (info incomplète + à attribuer)', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);

    // ZD passée : poids total (10 + 2,5 = 12,5 kg) + taux recyclage
    expect((await screen.findAllByText(/12,5 kg/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/78,4/).length).toBeGreaterThan(0);

    // AG à venir avec informations_completes=false → badge « Info incomplète »
    expect(screen.getAllByText('Info incomplète').length).toBeGreaterThan(0);
    // AG programmée sans attribution → « À attribuer »
    expect(screen.getAllByText('À attribuer').length).toBeGreaterThan(0);
  });

  it('M0.6 — filtre statut multi ajoute le paramètre statuts à la requête', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Client organisateur');

    // Sélectionne le statut « Clôturée » (multi-sélection — bouton chip)
    fireEvent.click(screen.getByRole('button', { name: 'Clôturée' }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('statuts=cloturee'))).toBe(true);
    });
  });

  it('M0.6 — filtre « Info incomplète » ajoute info_incomplete=true', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Client organisateur');

    fireEvent.click(screen.getByLabelText('Info incomplète'));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('info_incomplete=true'))).toBe(true);
    });
  });

  it('M0.6 — filtres traiteur + lieu (autocomplete) et rapport non consulté présents', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Client organisateur');

    expect(screen.getByLabelText('Filtrer par traiteur')).toBeInTheDocument();
    expect(screen.getByLabelText('Filtrer par lieu')).toBeInTheDocument();
    expect(screen.getByLabelText('Rapport non consulté')).toBeInTheDocument();
  });
});
