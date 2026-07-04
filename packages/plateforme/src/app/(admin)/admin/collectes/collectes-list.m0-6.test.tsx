/**
 * M0.6 — Liste collectes Admin (BL-P1-BOA-05).
 * Colonnes (client organisateur, contrôle d'accès), indicateurs (rapport
 * disponible/consulté/régénéré, poids ZD, taux, repas AG, info incomplète,
 * statut attribution AG : En attente / Validée / Auto-accept) et filtres (statut
 * multi, info incomplète, rapport non consulté). Câblage sur l'API existante.
 *
 * NB : DataTable rend simultanément la vue desktop (table) et mobile (cards) —
 * chaque libellé apparaît plusieurs fois → assertions en getAllBy*.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import CollectesPage from './page';

// ZD clôturée : poids + taux + rapport consulté ET régénéré (version > 1).
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
      regenere_at: '2026-04-25T09:00:00Z',
      consulte_par_user_at: '2026-04-24T10:00:00Z',
      version: 2,
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

function ag(overrides: Record<string, unknown>) {
  return {
    id: 'ag',
    type: 'anti_gaspi',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    dirty_tms: false,
    date_collecte: '2026-05-10',
    heure_collecte: '19:00:00',
    controle_acces_requis: false,
    informations_completes: true,
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
    ...overrides,
  };
}

// AG à venir sans attribution + info incomplète → « En attente » + badge orange.
const agEnAttente = ag({
  id: 'ag-attente',
  informations_completes: false,
  attributions_antgaspi: null,
});
// AG validée manuellement → « Validée ».
const agValidee = ag({
  id: 'ag-validee',
  statut: 'validee',
  attributions_antgaspi: {
    id: 'att-1',
    valide_at: '2026-05-01T12:00:00Z',
    mode_validation: 'manuel_top1',
    volume_repas_realise: null,
  },
});
// AG auto-acceptée → « Auto-accept ».
const agAuto = ag({
  id: 'ag-auto',
  statut: 'validee',
  attributions_antgaspi: {
    id: 'att-2',
    valide_at: '2026-05-01T12:00:00Z',
    mode_validation: 'auto_accept',
    volume_repas_realise: null,
  },
});
// AG réalisée → nombre de repas collectés.
const agRealisee = ag({
  id: 'ag-realisee',
  statut: 'realisee',
  attributions_antgaspi: {
    id: 'att-3',
    valide_at: '2026-05-01T12:00:00Z',
    mode_validation: 'manuel_top1',
    volume_repas_realise: 250,
  },
});

const ALL = [collecteZd, agEnAttente, agValidee, agAuto, agRealisee];

function mockCollectesFetch() {
  const fetchMock = vi.fn((url: string) => {
    // Compteurs des chips (endpoint dédié) — avant le catch-all /collectes.
    if (typeof url === 'string' && url.includes('/collectes/chip-counts')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          non_transmises: 3,
          attente_prestataire: 1,
          dirty_tms: 0,
          ag_attente_attribution: 2,
          zd_48h: 1,
          ag_48h: 4,
        }),
      });
    }
    if (typeof url === 'string' && url.startsWith('/api/v1/admin/collectes')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: ALL, total: ALL.length }),
      });
    }
    // Listes des menus déroulants (chargées au montage). Une 2e page vide
    // arrête la pagination.
    if (typeof url === 'string' && url.includes('/admin/organisations')) {
      const empty = /page=([2-9]|\d{2,})/.test(url);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: empty
            ? []
            : [{ id: 'org-1', raison_sociale: 'Traiteur Alpha' }],
          limit: 50,
        }),
      });
    }
    if (typeof url === 'string' && url.includes('/admin/lieux')) {
      const empty = /page=([2-9]|\d{2,})/.test(url);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: empty
            ? []
            : [{ id: 'lieu-1', nom: 'Salle Wagram', ville: 'Paris' }],
          total: 1,
        }),
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

    expect(
      (await screen.findAllByText('Client organisateur')).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Contrôle accès').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Indicateurs').length).toBeGreaterThan(0);
    // Colonne Statut TMS (maquette Admin V1)
    expect(screen.getAllByText('Statut TMS').length).toBeGreaterThan(0);

    // Client organisateur : raison sociale liée (ZD) ou texte libre (AG)
    expect(screen.getAllByText('Mairie de Paris').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fondation X').length).toBeGreaterThan(0);
  });

  it('M0.6 — les chips prédéfinis affichent leur compteur (chip-counts)', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);
    const chip = await screen.findByRole('button', {
      name: /Non transmises au TMS/,
    });
    // Pastille compteur = valeur renvoyée par /chip-counts (3).
    await waitFor(() => expect(chip).toHaveTextContent('3'));
  });

  it('M0.6 — indicateurs rapport (disponible/consulté/régénéré) + poids/taux ZD', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);

    // Rapport RSE disponible + consulté + régénéré (version 2 / regenere_at)
    expect(
      (await screen.findAllByLabelText('Rapport disponible')).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Rapport consulté').length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByLabelText('Rapport régénéré').length).toBeGreaterThan(
      0,
    );

    // ZD passée : poids total (10 + 2,5 = 12,5 kg) + taux recyclage
    expect(screen.getAllByText(/12,5 kg/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/78,4/).length).toBeGreaterThan(0);
  });

  it('M0.6 — statut attribution AG : En attente / Validée / Auto-accept + repas', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Client organisateur');

    // Les 3 états d'attribution dérivables (§06.06 §3 l.182)
    expect(screen.getAllByText('En attente').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Validée').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Auto-accept').length).toBeGreaterThan(0);

    // AG réalisée : nombre de repas collectés
    expect(screen.getAllByText(/250 repas/).length).toBeGreaterThan(0);

    // AG à venir avec informations_completes=false → « Info incomplète »
    expect(screen.getAllByText('Info incomplète').length).toBeGreaterThan(0);
  });

  it('M0.6 — filtre statut multi ajoute le paramètre statuts à la requête', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Client organisateur');

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

  it('M0.6 — filtre « Rapport non consulté » ajoute rapport_non_consulte=true', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Client organisateur');

    fireEvent.click(screen.getByLabelText('Rapport non consulté'));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('rapport_non_consulte=true'))).toBe(
        true,
      );
    });
  });

  it('M0.6 — filtres traiteur + lieu = menus déroulants peuplés + filtrage serveur', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Client organisateur');

    const traiteurSelect = screen.getByLabelText(
      'Filtrer par traiteur',
    ) as HTMLSelectElement;
    const lieuSelect = screen.getByLabelText(
      'Filtrer par lieu',
    ) as HTMLSelectElement;
    expect(traiteurSelect.tagName).toBe('SELECT');
    expect(lieuSelect.tagName).toBe('SELECT');

    // Options chargées au montage (listes complètes).
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Traiteur Alpha' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('option', { name: 'Salle Wagram — Paris' }),
    ).toBeInTheDocument();

    // Sélectionner un traiteur → requête collectes filtrée par organisation_id.
    fireEvent.change(traiteurSelect, { target: { value: 'org-1' } });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            typeof c[0] === 'string' &&
            c[0].startsWith('/api/v1/admin/collectes') &&
            c[0].includes('organisation_id=org-1'),
        ),
      ).toBe(true),
    );

    // Sélectionner un lieu → requête filtrée par lieu_id.
    fireEvent.change(lieuSelect, { target: { value: 'lieu-1' } });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            typeof c[0] === 'string' &&
            c[0].startsWith('/api/v1/admin/collectes') &&
            c[0].includes('lieu_id=lieu-1'),
        ),
      ).toBe(true),
    );
  });
});
