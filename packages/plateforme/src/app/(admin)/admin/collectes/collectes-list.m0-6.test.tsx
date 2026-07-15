/**
 * M0.6 — Liste collectes Admin (BL-P1-BOA-05) — refonte UI en cartes.
 * La liste rend désormais des cartes groupées par semaine (plus de tableau) :
 * - contenu carte (traiteur, lieu, client organisateur, adresse, transporteur),
 * - segment Programmées / Historique (preset du filtre `statuts`),
 * - tuiles KPI « à dispatcher », chips + compteurs, recherche client, filtres
 *   avancés (traiteur / lieu → filtrage serveur), indicateurs Historique
 *   (poids/taux ZD, repas AG, rapport consulté).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// URL de la page pilotable par test (drill-down `?chip=` du Dashboard Admin).
const navState = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => navState.search,
}));

import CollectesPage from './page';

// ZD clôturée (terminale → vue Historique) : poids + taux + rapport, facturée.
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
      consulte_par_user_at: '2026-04-24T10:00:00Z',
      version: 1,
    },
  ],
  transporteur_nom: 'Strike',
  factures_collectes: [{ montant_ht: 300 }],
  packs_antgaspi: null,
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
    transporteur_nom: 'Marathon',
    factures_collectes: [],
    packs_antgaspi: { prix_unitaire_ht: 45 },
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

const agEnAttente = ag({ id: 'ag-attente', informations_completes: false });
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

const ALL = [collecteZd, agEnAttente, agValidee, agRealisee];

function mockCollectesFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (typeof url === 'string' && url.includes('/collectes/chip-counts')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          non_transmises: 3,
          non_transmises_zd: 2,
          non_transmises_ag: 1,
          attente_prestataire: 1,
          dirty_tms: 0,
          ag_attente_attribution: 2,
          zd_48h: 1,
          ag_48h: 4,
          ag_a_dispatcher: 2,
          zd_a_dispatcher: 3,
          ag_a_venir: 9,
          zd_a_venir: 7,
          controle_acces_a_envoyer: 4,
          infos_a_recuperer: 6,
        }),
      });
    }
    if (typeof url === 'string' && url.startsWith('/api/v1/admin/collectes')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: ALL, total: ALL.length }),
      });
    }
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

describe('M0.6 — liste collectes Admin en cartes (BL-P1-BOA-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navState.search = new URLSearchParams();
  });
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — cartes : traiteur, lieu, client organisateur, transporteur rendus', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);

    // Traiteur (ligne 1) + lieu
    expect(
      (await screen.findAllByText('Traiteur Alpha')).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Salle Wagram').length).toBeGreaterThan(0);
    // Client organisateur (ligne 2) : raison sociale liée (ZD) OU texte libre (AG)
    expect(screen.getAllByText('Mairie de Paris').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fondation X').length).toBeGreaterThan(0);
    // Transporteur (ligne 2)
    expect(screen.getAllByText('Marathon').length).toBeGreaterThan(0);
  });

  it('M0.6 — segment Historique repasse la requête sur les statuts terminaux', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Traiteur Alpha');

    fireEvent.click(screen.getByRole('tab', { name: 'Historique' }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(
        urls.some(
          (u) =>
            u.startsWith('/api/v1/admin/collectes?') &&
            u.includes('statuts=') &&
            u.includes('cloturee'),
        ),
      ).toBe(true);
    });
  });

  it('M0.6 — tuiles KPI « à dispatcher » AG/ZD affichent leur compteur', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);

    // Tuiles KPI = boutons cliquables, déjà présents au 1er rendu (compteur à
    // 0 avant résolution async de /chip-counts) → attendre la mise à jour du
    // texte, pas juste l'existence du bouton (sinon race avec setChipCounts,
    // flaky en CI).
    const agTile = await screen.findByRole('button', {
      name: /AG à dispatcher/,
    });
    const zdTile = screen.getByRole('button', { name: /ZD à dispatcher/ });
    await waitFor(() => expect(agTile).toHaveTextContent('2'));
    await waitFor(() => expect(zdTile).toHaveTextContent('3'));
  });

  it('M0.6 — cartes KPI « à venir » AG/ZD affichent leur volume (indicateurs)', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);

    // Indicateurs statiques (pas des boutons) → requête par texte, compteur lu
    // sur le conteneur (count + libellé + sous-libellé sont frères).
    const agVenir = await screen.findByText('AG à venir');
    const zdVenir = screen.getByText('ZD à venir');
    await waitFor(() => expect(agVenir.parentElement).toHaveTextContent('9'));
    await waitFor(() => expect(zdVenir.parentElement).toHaveTextContent('7'));
  });

  it('M0.6 — carte « Plaque à récupérer » : compteur + filtre controle_acces=true', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);

    const tile = await screen.findByRole('button', {
      name: /Plaque à récupérer/,
    });
    await waitFor(() => expect(tile).toHaveTextContent('4'));

    fireEvent.click(tile);
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('controle_acces=true'))).toBe(true);
    });
  });

  it('M0.6 — carte « Infos à récupérer » : compteur + filtre info_incomplete=true', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);

    const tile = await screen.findByRole('button', {
      name: /Infos à récupérer/,
    });
    await waitFor(() => expect(tile).toHaveTextContent('6'));

    fireEvent.click(tile);
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('info_incomplete=true'))).toBe(true);
    });
  });

  it('M0.6 — bouton de filtre par type « Anti-Gaspi » ajoute type=anti_gaspi', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Traiteur Alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Anti-Gaspi' }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(
        urls.some(
          (u) =>
            u.startsWith('/api/v1/admin/collectes?') &&
            u.includes('type=anti_gaspi'),
        ),
      ).toBe(true);
    });
  });

  it('M0.6 — chips prédéfinis affichent leur compteur (chip-counts)', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);
    // « En attente prestataire » = chip conservé dans la rangée par défaut
    // (« Non transmises ZD/AG » et « ZD/AG 48h » masqués — décision Val 2026-07-15).
    const chip = await screen.findByRole('button', {
      name: /En attente prestataire/,
    });
    await waitFor(() => expect(chip).toHaveTextContent('1'));
  });

  it('M0.6 — chips masqués (Non transmises ZD/AG, ZD/AG 48h) retirés de la rangée par défaut', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findByRole('button', { name: /En attente prestataire/ });
    expect(
      screen.queryByRole('button', { name: /Non transmises ZD/ }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Non transmises AG/ }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /ZD 48/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /AG 48/ })).toBeNull();
  });

  it('M0.6 — drill-down Dashboard Admin ?chip=non_transmises_zd → chip actif + liste filtrée', async () => {
    navState.search = new URLSearchParams('chip=non_transmises_zd');
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    // Chip pré-sélectionné à l'arrivée (miroir exact du compteur dashboard).
    const chip = await screen.findByRole('button', {
      name: /Non transmises ZD/,
    });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    // La requête liste porte le MÊME chip → prédicat serveur partagé.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u]) =>
            typeof u === 'string' &&
            u.startsWith('/api/v1/admin/collectes?') &&
            u.includes('chip=non_transmises_zd'),
        ),
      ).toBe(true),
    );
  });

  it('M0.6 — indicateurs Historique : poids/taux ZD + repas AG + rapport consulté', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Traiteur Alpha');

    // ZD clôturée : poids total (10 + 2,5 = 12,5 kg) + taux + rapport consulté
    expect(screen.getAllByText(/12,5 kg/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/78/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rapport consulté/).length).toBeGreaterThan(0);
    // AG réalisée : nombre de repas donnés
    expect(screen.getAllByText(/250 repas/).length).toBeGreaterThan(0);
  });

  it('M0.6 — carte AG à attribuer : badge Info incomplète + bouton Attribuer', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Traiteur Alpha');

    // agEnAttente : programmée, sans attribution, info incomplète
    expect(screen.getAllByText('Info incomplète').length).toBeGreaterThan(0);
    const attribuer = screen.getAllByRole('link', { name: /Attribuer/ });
    expect(attribuer.length).toBeGreaterThan(0);
    expect(attribuer[0]).toHaveAttribute(
      'href',
      '/admin/attributions-ag/ag-attente',
    );
  });

  it('M0.6 — recherche client filtre les cartes de la page chargée', async () => {
    mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Traiteur Alpha');

    fireEvent.change(screen.getByLabelText('Rechercher'), {
      target: { value: 'Wagram' },
    });

    // Ne reste que la carte du lieu « Salle Wagram » (Traiteur Alpha) ;
    // « Traiteur Beta » (AG, lieu Pavillon) disparaît.
    await waitFor(() =>
      expect(screen.queryByText('Traiteur Beta')).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText('Salle Wagram').length).toBeGreaterThan(0);
  });

  it('M0.6 — filtres avancés : traiteur/lieu peuplés + filtrage serveur', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Traiteur Alpha');

    // Panneau replié par défaut → ouvrir
    fireEvent.click(screen.getByRole('button', { name: /Filtres avancés/ }));

    const traiteurSelect = (await screen.findByLabelText(
      'Filtrer par traiteur',
    )) as HTMLSelectElement;
    const lieuSelect = screen.getByLabelText(
      'Filtrer par lieu',
    ) as HTMLSelectElement;
    expect(traiteurSelect.tagName).toBe('SELECT');

    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Traiteur Alpha' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('option', { name: 'Salle Wagram — Paris' }),
    ).toBeInTheDocument();

    fireEvent.change(traiteurSelect, { target: { value: 'org-1' } });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            typeof c[0] === 'string' &&
            c[0].startsWith('/api/v1/admin/collectes') &&
            // R24c : le filtre « Traiteur » = traiteur OPÉRATIONNEL (décision Val).
            c[0].includes('traiteur_operationnel_id=org-1'),
        ),
      ).toBe(true),
    );

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

  it('M0.6 — filtre statut (multi-sélection) ajoute le paramètre statuts à la requête', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Traiteur Alpha');

    fireEvent.click(screen.getByRole('button', { name: /Filtres avancés/ }));
    // Statut multi-sélection scopée à l'onglet Programmées (chip = bouton,
    // distinct de la même étiquette utilisée comme badge sur une carte).
    fireEvent.click(screen.getByRole('button', { name: 'Validée' }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(
        urls.some(
          (u) =>
            u.startsWith('/api/v1/admin/collectes?') &&
            u.includes('statuts=validee'),
        ),
      ).toBe(true);
    });
  });

  it('M0.6 — filtre « Info incomplète » ajoute info_incomplete=true', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Traiteur Alpha');

    fireEvent.click(screen.getByRole('button', { name: /Filtres avancés/ }));
    fireEvent.click(screen.getByLabelText('Info incomplète'));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('info_incomplete=true'))).toBe(true);
    });
  });

  it('M0.6 — filtre « Rapport non consulté » ajoute rapport_non_consulte=true', async () => {
    const fetchMock = mockCollectesFetch();
    render(<CollectesPage />);
    await screen.findAllByText('Traiteur Alpha');

    fireEvent.click(screen.getByRole('button', { name: /Filtres avancés/ }));
    fireEvent.click(screen.getByLabelText('Rapport non consulté'));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('rapport_non_consulte=true'))).toBe(
        true,
      );
    });
  });

  it('M0.6 — carte urgente (AG à attribuer < 48h) : badge Urgent affiché, pas sur la lointaine', async () => {
    const urgente = ag({
      id: 'ag-urgente',
      date_collecte: new Date(Date.now() + 2 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      heure_collecte: '10:00:00',
    });
    // AG à attribuer, mais loin (> 48h) : pas urgente.
    const lointaine = ag({
      id: 'ag-lointaine',
      date_collecte: '2027-01-15',
      heure_collecte: '10:00:00',
    });
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/collectes/chip-counts')) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      if (
        typeof url === 'string' &&
        url.startsWith('/api/v1/admin/collectes')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [lointaine, urgente], total: 2 }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CollectesPage />);

    await screen.findAllByText('Traiteur Beta');
    expect(screen.getAllByText('Urgent')).toHaveLength(1);
  });
});
