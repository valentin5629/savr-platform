/**
 * M0.6 — Liste collectes Admin (BL-P1-BOA-05).
 * La liste est une Data Table plate (DataGrid, décision Val 2026-09-28) : une
 * ligne par collecte, tri serveur par en-tête, actions dans le menu « ⋯ » :
 * - contenu ligne (traiteur, lieu, client organisateur, adresse, transporteur),
 * - segment Programmées / Historique (preset du filtre `statuts`),
 * - tuiles KPI « à dispatcher », chips + compteurs, barre de filtres toujours
 *   visible, sans recherche libre (traiteur / lieu → filtrage serveur),
 *   indicateurs Historique (poids/taux ZD, repas AG, rapport consulté).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';

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
import { jourParis } from '@savr/shared/src/temps/index.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

// La liste est une Data Table (décision Val 2026-09-28) : DataGrid rend aussi
// chaque ligne en carte mobile → requêtes bornées au <table> pour ne pas
// compter deux fois. Les actions Attribuer / Dispatcher vivent dans le menu
// « ⋯ » de fin de ligne, ouvert ici au clavier (Entrée, comme un utilisateur).
function tableau() {
  return within(screen.getByRole('table'));
}
function menusActionAttendue(): HTMLElement[] {
  return tableau().queryAllByRole('button', { name: /action attendue/ });
}
async function ouvrirMenu(declencheur: HTMLElement) {
  fireEvent.keyDown(declencheur, { key: 'Enter' });
  return screen.findByRole('menu', undefined, ATTENTE_UI);
}

// ZD clôturée (terminale → vue Historique) : poids + taux + rapport, facturée.
const collecteZd = {
  id: 'zd-1',
  type: 'zero_dechet',
  statut: 'cloturee',
  statut_tms: 'acceptee',
  tms_reference: 'CO-ZD-1',
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
    tms_reference: null,
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
          // Même nombre que les tuiles « à dispatcher » : la route les tire du
          // même compteur (kpi_a_dispatcher_predicat_unique).
          non_transmises_zd: 3,
          non_transmises_ag: 2,
          attente_prestataire: 1,
          dirty_tms: 0,
          ag_attente_attribution: 2,
          zd_48h: 1,
          ag_48h: 4,
          ag_a_dispatcher: 2,
          zd_a_dispatcher: 3,
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
            : [
                { id: 'org-1', raison_sociale: 'Traiteur Alpha' },
                { id: 'org-2', raison_sociale: 'Traiteur Gamma' },
                { id: 'org-3', raison_sociale: 'Traiteur Delta' },
              ],
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

// Paramètres de la dernière requête de la liste (hors compteurs de chips).
function derniereRequeteListe(
  fetchMock: ReturnType<typeof mockCollectesFetch>,
): URLSearchParams {
  const url =
    fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.startsWith('/api/v1/admin/collectes?'))
      .at(-1) ?? '';
  return new URL(url, 'http://savr.test').searchParams;
}

describe('M0.6 — liste collectes Admin en cartes (BL-P1-BOA-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navState.search = new URLSearchParams();
  });
  afterEach(() => vi.restoreAllMocks());

  it(
    'M0.6 — cartes : traiteur, lieu, client organisateur, transporteur rendus',
    async () => {
      mockCollectesFetch();
      render(<CollectesPage />);

      // Traiteur (ligne 1) + lieu
      expect(
        (await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI))
          .length,
      ).toBeGreaterThan(0);
      expect(screen.getAllByText('Salle Wagram').length).toBeGreaterThan(0);
      // Client organisateur (ligne 2) : raison sociale liée (ZD) OU texte libre (AG)
      expect(screen.getAllByText('Mairie de Paris').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Fondation X').length).toBeGreaterThan(0);
      // Transporteur (ligne 2)
      expect(screen.getAllByText('Marathon').length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — segment Historique repasse la requête sur les statuts terminaux',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Historique' }));

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
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — tuiles KPI « à dispatcher » AG/ZD affichent leur compteur',
    async () => {
      mockCollectesFetch();
      render(<CollectesPage />);

      // Tuiles KPI = boutons cliquables, déjà présents au 1er rendu (compteur à
      // 0 avant résolution async de /chip-counts) → attendre la mise à jour du
      // texte, pas juste l'existence du bouton (sinon race avec setChipCounts,
      // flaky en CI).
      const agTile = await screen.findByRole(
        'button',
        {
          name: /AG à dispatcher/,
        },
        ATTENTE_UI,
      );
      const zdTile = screen.getByRole('button', { name: /ZD à dispatcher/ });
      await waitFor(() => expect(agTile).toHaveTextContent('2'), ATTENTE_UI);
      await waitFor(() => expect(zdTile).toHaveTextContent('3'), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — kpi_a_dispatcher_predicat_unique : clic sur une tuile « à dispatcher » → chip « Non transmises » du même type, re-clic le retire',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      const zdTile = await screen.findByRole(
        'button',
        { name: /ZD à dispatcher/ },
        ATTENTE_UI,
      );
      await waitFor(() => expect(zdTile).toHaveTextContent('3'), ATTENTE_UI);
      // Sous-libellé : 4e surface du scénario, exact depuis que la tuile
      // compte aussi les collectes validées transporteur.
      expect(zdTile).toHaveTextContent('validées transporteur');

      // Le segmenté porte déjà un AUTRE type : sans effacement, le clic sur la
      // tuile ZD rendrait une liste vide alors que la tuile affiche 3.
      const pastilleAg = screen.getByRole('radio', { name: 'Anti-Gaspi' });
      fireEvent.click(pastilleAg);
      await waitFor(
        () =>
          expect(derniereRequeteListe(fetchMock).get('types')).toBe(
            'anti_gaspi',
          ),
        ATTENTE_UI,
      );

      // Clic : la liste est filtrée par le prédicat MÊME que compte la tuile
      // (chip serveur), et le filtre Type est effacé (décisions Val 2026-10-01).
      fireEvent.click(zdTile);
      await waitFor(() => {
        const q = derniereRequeteListe(fetchMock);
        expect(q.get('chip')).toBe('non_transmises_zd');
        expect(q.get('types')).toBeNull();
      }, ATTENTE_UI);
      expect(zdTile).toHaveAttribute('aria-pressed', 'true');
      expect(pastilleAg).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('radio', { name: 'Toutes' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      // Le chip masqué apparaît actif dans la rangée, avec le même compteur.
      const chip = screen.getByRole('button', { name: /Non transmises ZD/ });
      expect(chip).toHaveAttribute('aria-pressed', 'true');
      expect(chip).toHaveTextContent('3');

      // L'autre tuile remplace le chip (un seul filtre rapide à la fois).
      const agTile = screen.getByRole('button', { name: /AG à dispatcher/ });
      fireEvent.click(agTile);
      await waitFor(
        () =>
          expect(derniereRequeteListe(fetchMock).get('chip')).toBe(
            'non_transmises_ag',
          ),
        ATTENTE_UI,
      );
      expect(agTile).toHaveAttribute('aria-pressed', 'true');
      expect(zdTile).toHaveAttribute('aria-pressed', 'false');

      // Re-clic : retour à la liste Programmées complète.
      fireEvent.click(agTile);
      await waitFor(() => {
        const q = derniereRequeteListe(fetchMock);
        expect(q.get('chip')).toBeNull();
        expect(q.get('statuts')).toBe('creee,programmee,validee,en_cours');
      }, ATTENTE_UI);
      expect(agTile).toHaveAttribute('aria-pressed', 'false');
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M0.6 — KPI de tête : 4 files d'action sur une ligne, sans tuiles « à venir » (décision Val 2026-10-01)",
    async () => {
      mockCollectesFetch();
      render(<CollectesPage />);

      const ordre = [
        /AG à dispatcher/,
        /ZD à dispatcher/,
        /Infos accès à envoyer/,
        /Infos à récupérer/,
      ];
      const tuiles = await Promise.all(
        ordre.map((name) => screen.findByRole('button', { name }, ATTENTE_UI)),
      );
      // Ordre d'affichage = ordre demandé (gauche → droite).
      for (let i = 1; i < tuiles.length; i++) {
        expect(
          tuiles[i - 1]!.compareDocumentPosition(tuiles[i]!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
      // Même grille, 4 colonnes en desktop.
      expect(tuiles[0]!.parentElement).toBe(tuiles[3]!.parentElement);
      expect(tuiles[0]!.parentElement!.className).toContain('xl:grid-cols-4');
      expect(screen.queryByText('AG à venir')).toBeNull();
      expect(screen.queryByText('ZD à venir')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — carte « Infos accès à envoyer » : compteur + filtre controle_acces=true',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);

      const tile = await screen.findByRole(
        'button',
        {
          name: /Infos accès à envoyer/,
        },
        ATTENTE_UI,
      );
      await waitFor(() => expect(tile).toHaveTextContent('4'), ATTENTE_UI);

      fireEvent.click(tile);
      await waitFor(() => {
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes('controle_acces=true'))).toBe(true);
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — carte « Infos à récupérer » : compteur + filtre info_incomplete=true',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);

      const tile = await screen.findByRole(
        'button',
        {
          name: /Infos à récupérer/,
        },
        ATTENTE_UI,
      );
      await waitFor(() => expect(tile).toHaveTextContent('6'), ATTENTE_UI);

      fireEvent.click(tile);
      await waitFor(() => {
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes('info_incomplete=true'))).toBe(true);
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — segmenté de type « Anti-Gaspi » ajoute types=anti_gaspi',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      // Le segmenté (ToggleGroup, R-UI-4b D1) est l'unique contrôle de type.
      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      await waitFor(
        () =>
          expect(derniereRequeteListe(fetchMock).get('types')).toBe(
            'anti_gaspi',
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — chips prédéfinis affichent leur compteur (chip-counts)',
    async () => {
      mockCollectesFetch();
      render(<CollectesPage />);
      // « En attente prestataire » = chip conservé dans la rangée par défaut
      // (« Non transmises ZD/AG » et « ZD/AG 48h » masqués — décision Val 2026-07-15).
      const chip = await screen.findByRole(
        'button',
        {
          name: /En attente prestataire/,
        },
        ATTENTE_UI,
      );
      await waitFor(() => expect(chip).toHaveTextContent('1'), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — chips masqués (Non transmises ZD/AG, ZD/AG 48h, AG en attente attribution) retirés de la rangée par défaut',
    async () => {
      mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findByRole(
        'button',
        { name: /En attente prestataire/ },
        ATTENTE_UI,
      );
      expect(
        screen.queryByRole('button', { name: /Non transmises ZD/ }),
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: /Non transmises AG/ }),
      ).toBeNull();
      expect(screen.queryByRole('button', { name: /ZD 48/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /AG 48/ })).toBeNull();
      expect(
        screen.queryByRole('button', { name: /AG en attente attribution/ }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — drill-down Dashboard Admin ?chip=non_transmises_zd → chip actif + liste filtrée',
    async () => {
      navState.search = new URLSearchParams('chip=non_transmises_zd');
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      // Chip pré-sélectionné à l'arrivée (miroir exact du compteur dashboard).
      const chip = await screen.findByRole(
        'button',
        {
          name: /Non transmises ZD/,
        },
        ATTENTE_UI,
      );
      expect(chip).toHaveAttribute('aria-pressed', 'true');
      // La requête liste porte le MÊME chip → prédicat serveur partagé.
      await waitFor(
        () =>
          expect(
            fetchMock.mock.calls.some(
              ([u]) =>
                typeof u === 'string' &&
                u.startsWith('/api/v1/admin/collectes?') &&
                u.includes('chip=non_transmises_zd'),
            ),
          ).toBe(true),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — drill-down Dashboard Admin ?chip=collectes_48h_non_validees → chip actif + liste filtrée',
    async () => {
      navState.search = new URLSearchParams('chip=collectes_48h_non_validees');
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      // Carte fusionnée « Collecte <48h non validée » (revue E2E 2026-07-15) : chip
      // masqué mais pré-sélectionné à l'arrivée (miroir exact du compteur dashboard).
      const chip = await screen.findByRole(
        'button',
        {
          name: /Collecte <48 h non validée/,
        },
        ATTENTE_UI,
      );
      expect(chip).toHaveAttribute('aria-pressed', 'true');
      await waitFor(
        () =>
          expect(
            fetchMock.mock.calls.some(
              ([u]) =>
                typeof u === 'string' &&
                u.startsWith('/api/v1/admin/collectes?') &&
                u.includes('chip=collectes_48h_non_validees'),
            ),
          ).toBe(true),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — indicateurs Historique : poids/taux ZD + repas AG + rapport consulté',
    async () => {
      mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      // ZD clôturée : poids total (10 + 2,5 = 12,5 kg) + taux + rapport consulté
      expect(screen.getAllByText(/12,5 kg/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/78/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Rapport consulté/).length).toBeGreaterThan(0);
      // AG réalisée : nombre de repas donnés
      expect(screen.getAllByText(/250 repas/).length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — carte AG à attribuer : badge Info incomplète + bouton Attribuer',
    async () => {
      mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      // agEnAttente : programmée, sans attribution, info incomplète
      expect(screen.getAllByText('Info incomplète').length).toBeGreaterThan(0);
      const [declencheur] = menusActionAttendue();
      const menu = await ouvrirMenu(declencheur!);
      const attribuer = within(menu).getByRole('menuitem', {
        name: /Attribuer/,
      });
      expect(attribuer).toHaveAttribute(
        'href',
        '/admin/attributions-ag/ag-attente',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — cartes ZD à dispatcher (non transmises, programmée OU validée) : bouton Dispatcher → drawer',
    async () => {
      // « À dispatcher » = ZD non transmise au TMS (statut_tms non_envoye) et
      // encore ouverte (programmée OU validée transporteur) — miroir du chip
      // « Non transmises ZD ». Le bouton ouvre la fiche dans le panneau latéral
      // (drawer, ?collecte=<id>) — Bloc 0 envoi MTS-1.
      const zdProgrammee = {
        ...collecteZd,
        id: 'zd-disp',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        collecte_flux: [],
        rapports_rse: [],
        factures_collectes: [],
      };
      const zdValidee = {
        ...zdProgrammee,
        id: 'zd-disp-validee',
        statut: 'validee',
      };
      // ZD déjà transmise (acceptée presta) → PAS de bouton (anti-vacuité).
      const zdTransmise = {
        ...zdProgrammee,
        id: 'zd-envoyee',
        statut: 'validee',
        statut_tms: 'acceptee',
        tms_reference: 'CO-ZD-9',
      };
      // AG programmée + non transmise (même forme statut/statut_tms qu'une ZD à
      // dispatcher) → PAS de « Dispatcher » (garde de type) mais « Attribuer ».
      const agNonTransmise = ag({ id: 'ag-x' });
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
            json: async () => ({
              data: [zdProgrammee, zdValidee, zdTransmise, agNonTransmise],
              total: 4,
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<CollectesPage />);

      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);
      // Exactement 3 lignes à action attendue : les 2 ZD non transmises
      // (programmée + validée) et l'AG à attribuer — pas la ZD transmise.
      expect(menusActionAttendue()).toHaveLength(3);
      // Menu de chaque ligne (ordre d'affichage indifférent : les urgences
      // remontent en tête).
      const menus: string[][] = [];
      for (const declencheur of tableau().getAllByRole('button', {
        name: /Actions sur la collecte/,
      })) {
        const menu = await ouvrirMenu(declencheur);
        menus.push(
          within(menu)
            .getAllByRole('menuitem')
            .map((m) => m.textContent ?? ''),
        );
        fireEvent.keyDown(menu, { key: 'Escape' });
        await waitFor(
          () => expect(screen.queryByRole('menu')).toBeNull(),
          ATTENTE_UI,
        );
      }
      const avec = (action: string) =>
        menus.filter((m) => m.includes(action)).length;
      expect(menus).toHaveLength(4);
      expect(avec('Dispatcher')).toBe(2);
      // Anti-vacuité : l'AG porte « Attribuer », jamais « Dispatcher »
      // (affordances mutuellement exclusives par type) ; la ZD transmise n'a
      // que l'ouverture de fiche.
      expect(avec('Attribuer')).toBe(1);
      expect(
        menus.filter(
          (m) => m.includes('Attribuer') && m.includes('Dispatcher'),
        ),
      ).toHaveLength(0);
      expect(menus.filter((m) => m.length === 1)).toEqual([
        ['Ouvrir la fiche'],
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — clic « Dispatcher » ouvre le drawer et charge la fiche de CETTE collecte',
    async () => {
      const zdDisp = {
        ...collecteZd,
        id: 'zd-open',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        collecte_flux: [],
        rapports_rse: [],
        factures_collectes: [],
      };
      // Fiche détail renvoyée à l'ouverture du panneau (shape CollecteDetail).
      const detail = {
        id: 'zd-open',
        type: 'zero_dechet',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        statut_tms_at: null,
        dirty_tms: false,
        date_collecte: '2026-04-23',
        heure_collecte: '08:30:00',
        nb_camions_demande: 1,
        tms_reference: null,
        volume_estime_repas: null,
        controle_acces_requis: false,
        infos_acces_email_envoye_at: null,
        notes_internes: null,
        informations_supplementaires: null,
        motif_override_prestataire: null,
        annulee_cote_savr: false,
        pack_antgaspi_id: null,
        packs_antgaspi: null,
        attributions_antgaspi: null,
        prestataire_logistique_id: null,
        evenements: {
          nom_evenement: 'Gala',
          pax: 120,
          organisations: { raison_sociale: 'Traiteur Alpha' },
          lieux: {
            nom: 'Salle Wagram',
            ville: 'Paris',
            adresse_acces: '1 av.',
          },
          types_evenements: { libelle: 'Gala' },
        },
        collecte_flux: [],
        collecte_tournees: [],
        factures_collectes: [],
      };
      const fetchMock = vi.fn((url: string) => {
        if (url.includes('/chip-counts'))
          return Promise.resolve({ ok: true, json: async () => ({}) });
        if (url.startsWith('/api/v1/admin/transporteurs'))
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [] }),
          });
        if (url.includes('/recommandation'))
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: null }),
          });
        if (url.endsWith('/documents'))
          return Promise.resolve({
            ok: true,
            json: async () => ({
              rapport: null,
              bordereau: null,
              attestation: null,
              photos: [],
            }),
          });
        if (url.endsWith('/audit'))
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [], recredit_at: null }),
          });
        if (url === '/api/v1/admin/collectes/zd-open')
          return Promise.resolve({ ok: true, json: async () => detail });
        if (url.startsWith('/api/v1/admin/collectes'))
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [zdDisp], total: 1 }),
          });
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      // Drawer fermé au départ.
      expect(screen.queryByRole('tab', { name: 'Logistique' })).toBeNull();

      // Menu « ⋯ » → « Dispatcher » → ouvre le panneau latéral…
      const menu = await ouvrirMenu(menusActionAttendue()[0]!);
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: /Dispatcher/ }),
      );
      expect(
        await screen.findByRole('tab', { name: 'Logistique' }, ATTENTE_UI),
      ).toBeInTheDocument();

      // …et charge la fiche de CETTE collecte (appariement id↔bouton — remplace
      // l'ex-assertion href supprimée avec le passage lien → bouton drawer).
      await waitFor(
        () =>
          expect(
            fetchMock.mock.calls.some(
              (c) => String(c[0]) === '/api/v1/admin/collectes/zd-open',
            ),
          ).toBe(true),
        ATTENTE_UI,
      );

      // Fermeture via la croix du Sheet → le panneau disparaît.
      fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
      await waitFor(
        () =>
          expect(screen.queryByRole('tab', { name: 'Logistique' })).toBeNull(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — barre de filtres visible par défaut : traiteur/lieu peuplés + filtrage serveur',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      // Décision Val 2026-09-30 : barre affichée d'emblée, ni bouton de repli
      // « Filtres avancés » ni recherche libre « Traiteur, lieu, ville… ».
      expect(screen.getByTestId('collectes-filtres')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Filtres avancés/ }),
      ).toBeNull();
      expect(screen.queryByPlaceholderText(/Traiteur, lieu, ville/)).toBeNull();

      // Période en premier dans la ligne de filtres (décision Val 2026-09-30) ;
      // le type est le segmenté de l'en-tête de la barre (R-UI-4b, D1).
      const barre = screen.getByTestId('collectes-filtres');
      const periode = within(barre).getByTestId('collectes-filtre-periode');
      expect(
        periode.compareDocumentPosition(
          within(barre).getByTestId('collectes-filtre-traiteur'),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        within(barre).getByTestId('collectes-filtre-type'),
      ).toHaveAttribute('role', 'radiogroup');

      // Traiteur : choix multiple (liste à cocher), « Tous » coché par défaut.
      // R24c : le filtre « Traiteur » = traiteur OPÉRATIONNEL (décision Val).
      fireEvent.click(screen.getByTestId('collectes-filtre-traiteur'));
      const listeTraiteurs = await screen.findByRole(
        'list',
        { name: 'Traiteur' },
        ATTENTE_UI,
      );
      const tous = within(listeTraiteurs).getByRole('checkbox', {
        name: 'Tous',
      });
      expect(tous).toBeChecked();
      fireEvent.click(
        within(listeTraiteurs).getByRole('checkbox', {
          name: 'Traiteur Alpha',
        }),
      );
      fireEvent.click(
        within(listeTraiteurs).getByRole('checkbox', {
          name: 'Traiteur Gamma',
        }),
      );
      await waitFor(
        () =>
          expect(
            derniereRequeteListe(fetchMock).get('traiteur_operationnel_ids'),
          ).toBe('org-1,org-2'),
        ATTENTE_UI,
      );
      expect(tous).not.toBeChecked();

      // « Tous » efface la sélection → plus de filtre traiteur.
      fireEvent.click(tous);
      await waitFor(
        () =>
          expect(
            derniereRequeteListe(fetchMock).get('traiteur_operationnel_ids'),
          ).toBeNull(),
        ATTENTE_UI,
      );

      fireEvent.click(screen.getByTestId('collectes-filtre-lieu'));
      fireEvent.click(
        within(
          await screen.findByRole('list', { name: 'Lieu' }, ATTENTE_UI),
        ).getByRole('checkbox', { name: 'Salle Wagram — Paris' }),
      );
      await waitFor(
        () =>
          expect(derniereRequeteListe(fetchMock).get('lieu_ids')).toBe(
            'lieu-1',
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — segmenté de type : un type → types=… ; « Toutes » = aucun paramètre',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      const segmente = within(screen.getByTestId('collectes-filtre-type'));
      fireEvent.click(segmente.getByRole('radio', { name: 'Zéro Déchet' }));
      await waitFor(
        () =>
          expect(derniereRequeteListe(fetchMock).get('types')).toBe(
            'zero_dechet',
          ),
        ATTENTE_UI,
      );

      // « Toutes » lève le filtre → aucun paramètre `types`.
      fireEvent.click(segmente.getByRole('radio', { name: 'Toutes' }));
      await waitFor(
        () => expect(derniereRequeteListe(fetchMock).get('types')).toBeNull(),
        ATTENTE_UI,
      );
      expect(segmente.getByRole('radio', { name: 'Toutes' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — filtre statut (multi-sélection) ajoute le paramètre statuts à la requête',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      // Statut multi-sélection scopée à l'onglet Programmées : filtre en ligne
      // « Statut  Tous ▾ » → liste à cocher (case distincte du badge de carte).
      fireEvent.click(screen.getByTestId('collectes-filtre-statut'));
      fireEvent.click(
        await screen.findByRole('checkbox', { name: 'Validée' }, ATTENTE_UI),
      );

      await waitFor(() => {
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(
          urls.some(
            (u) =>
              u.startsWith('/api/v1/admin/collectes?') &&
              u.includes('statuts=validee'),
          ),
        ).toBe(true);
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6/statut_admin_filtre_creee_programmee — le filtre Statut propose « Créée » et « Programmée » séparément',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      fireEvent.click(screen.getByTestId('collectes-filtre-statut'));
      // « Programmée » reste proposée, à côté de « Créée ».
      await screen.findByRole('checkbox', { name: 'Programmée' }, ATTENTE_UI);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Créée' }));

      await waitFor(() => {
        const q = derniereRequeteListe(fetchMock);
        // La sélection remplace le preset de l'onglet.
        expect(q.get('statuts')).toBe('creee');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6/statut_admin_filtre_creee_programmee — pastille active + « Créée » : chip ET statuts=creee',
    async () => {
      navState.search = new URLSearchParams('chip=non_transmises_ag');
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      fireEvent.click(screen.getByTestId('collectes-filtre-statut'));
      fireEvent.click(
        await screen.findByRole('checkbox', { name: 'Créée' }, ATTENTE_UI),
      );

      await waitFor(() => {
        const q = derniereRequeteListe(fetchMock);
        expect(q.get('chip')).toBe('non_transmises_ag');
        expect(q.get('statuts')).toBe('creee');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6/statut_admin_brouillon_absent — ?statut=brouillon sur Programmées : aucun résultat, sans appel API (jamais une liste élargie)',
    async () => {
      navState.search = new URLSearchParams('statut=brouillon');
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findByTestId(
        'collectes-filtre-statut',
        undefined,
        ATTENTE_UI,
      );

      const listes = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter(
          (u) =>
            u.startsWith('/api/v1/admin/collectes?') &&
            !u.includes('chip-counts'),
        );
      expect(listes).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — filtre « Info incomplète » ajoute info_incomplete=true',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      fireEvent.click(screen.getByLabelText('Info incomplète'));

      await waitFor(() => {
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes('info_incomplete=true'))).toBe(true);
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — filtre « Rapport non consulté » ajoute rapport_non_consulte=true',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      fireEvent.click(screen.getByLabelText('Rapport non consulté'));

      await waitFor(() => {
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls.some((u) => u.includes('rapport_non_consulte=true'))).toBe(
          true,
        );
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — carte urgente (AG à attribuer < 48h) : badge Urgent affiché, pas sur la lointaine',
    async () => {
      const urgente = ag({
        id: 'ag-urgente',
        date_collecte: jourParis(new Date(Date.now() + 2 * 60 * 60 * 1000)),
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

      await screen.findAllByText('Traiteur Beta', undefined, ATTENTE_UI);
      expect(tableau().getAllByText('Urgent')).toHaveLength(1);
      // Reçue en 2e position, l'urgente remonte en tête (§06.09 §1).
      const premiere = tableau().getAllByRole('row')[1]!;
      expect(within(premiere).getByText('Urgent')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — tri de la Data Table envoyé au serveur (liste paginée) : défaut par onglet + clic en-tête',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);
      const urls = () =>
        fetchMock.mock.calls
          .map((c) => String(c[0]))
          .filter((u) => u.startsWith('/api/v1/admin/collectes?'));

      // Programmées : prochaines collectes d'abord.
      expect(urls().at(-1)).toContain('tri=date&ordre=asc');

      // Clic sur « Type » → tri serveur par type, retour page 1.
      fireEvent.click(
        within(screen.getByRole('table')).getByRole('button', {
          name: /Type/,
        }),
      );
      await waitFor(
        () => expect(urls().at(-1)).toMatch(/page=1&tri=type&ordre=/),
        ATTENTE_UI,
      );

      // Historique : les plus récentes d'abord.
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Historique' }));
      await waitFor(
        () => expect(urls().at(-1)).toContain('tri=date&ordre=desc'),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
  it(
    'M0.6 — pastille rapide ET barre se cumulent (décision Val 2026-09-30)',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      fireEvent.click(
        screen.getByRole('button', { name: /En attente prestataire/ }),
      );
      fireEvent.click(screen.getByTestId('collectes-filtre-traiteur'));
      fireEvent.click(
        within(
          await screen.findByRole('list', { name: 'Traiteur' }, ATTENTE_UI),
        ).getByRole('checkbox', { name: 'Traiteur Alpha' }),
      );
      // La pastille reste active et le filtre Traiteur part avec elle.
      await waitFor(() => {
        const q = derniereRequeteListe(fetchMock);
        expect(q.get('chip')).toBe('attente_prestataire');
        expect(q.get('traiteur_operationnel_ids')).toBe('org-1');
      }, ATTENTE_UI);
      expect(
        screen.getByRole('button', { name: /En attente prestataire/ }),
      ).toHaveAttribute('aria-pressed', 'true');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — Historique : pastille Annulées × Statut Clôturée = aucun résultat, sans appel API',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Historique' }));
      // Les pastilles Anti-Gaspi / Zéro Déchet n'existent plus (R-UI-4b, D1) :
      // le type ne se filtre que par le segmenté.
      const rapides = within(
        screen.getByRole('group', { name: 'Filtres rapides' }),
      );
      expect(rapides.queryByRole('button', { name: 'Anti-Gaspi' })).toBeNull();
      expect(rapides.queryByRole('button', { name: 'Zéro Déchet' })).toBeNull();
      fireEvent.click(rapides.getByRole('button', { name: 'Annulées' }));
      await waitFor(
        () =>
          expect(derniereRequeteListe(fetchMock).get('statuts')).toBe(
            'annulee,rejetee_par_prestataire',
          ),
        ATTENTE_UI,
      );
      const avant = fetchMock.mock.calls.length;

      fireEvent.click(screen.getByTestId('collectes-filtre-statut'));
      fireEvent.click(
        within(
          await screen.findByRole('list', { name: 'Statut' }, ATTENTE_UI),
        ).getByRole('checkbox', { name: 'Clôturée' }),
      );
      expect(
        await screen.findByText('Aucune collecte', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(
        fetchMock.mock.calls
          .slice(avant)
          .some(([u]) => String(u).startsWith('/api/v1/admin/collectes?')),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — drill-down Dashboard Client (?traiteur / ?type / ?statut / ?perimetre) → filtres multiples pré-cochés',
    async () => {
      const t = '11111111-1111-1111-1111-111111111111';
      const p = '22222222-2222-2222-2222-222222222222';
      navState.search = new URLSearchParams(
        `traiteur=${t}&type=zero_dechet&statut=cloturee&perimetre=${p}`,
      );
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await waitFor(() => {
        const q = derniereRequeteListe(fetchMock);
        expect(q.get('traiteur_operationnel_ids')).toBe(t);
        expect(q.get('types')).toBe('zero_dechet');
        expect(q.get('statuts')).toBe('cloturee');
        expect(q.getAll('perimetre_org_ids[]')).toEqual([p]);
      }, ATTENTE_UI);
      // Onglet Historique, segmenté de type sur Zéro Déchet.
      expect(screen.getByRole('tab', { name: 'Historique' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        screen.getByRole('radio', { name: 'Zéro Déchet' }),
      ).toHaveAttribute('aria-checked', 'true');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — une réponse plus ancienne arrivée en dernier n’écrase pas la liste',
    async () => {
      const fetchMock = mockCollectesFetch();
      render(<CollectesPage />);
      await screen.findAllByText('Traiteur Alpha', undefined, ATTENTE_UI);

      let libererAncienne: () => void = () => {};
      const ancienne = new Promise<void>((r) => {
        libererAncienne = r;
      });
      const base = fetchMock.getMockImplementation()!;
      const reponse = (data: unknown[]) => ({
        ok: true,
        json: async () => ({ data, total: data.length }),
      });
      fetchMock.mockImplementation(((url: string) => {
        if (url.startsWith('/api/v1/admin/collectes?')) {
          const ids = new URL(url, 'http://savr.test').searchParams.get(
            'traiteur_operationnel_ids',
          );
          if (ids === 'org-1')
            return ancienne.then(() => reponse([collecteZd]));
          if (ids === 'org-1,org-2')
            return Promise.resolve(reponse([agEnAttente]));
        }
        return base(url);
      }) as never);

      fireEvent.click(screen.getByTestId('collectes-filtre-traiteur'));
      const liste = await screen.findByRole(
        'list',
        { name: 'Traiteur' },
        ATTENTE_UI,
      );
      fireEvent.click(
        within(liste).getByRole('checkbox', { name: 'Traiteur Alpha' }),
      );
      fireEvent.click(
        within(liste).getByRole('checkbox', { name: 'Traiteur Gamma' }),
      );
      // La réponse la plus récente (Alpha + Gamma) s'affiche…
      await waitFor(
        () => expect(tableau().queryByText('Salle Wagram')).toBeNull(),
        ATTENTE_UI,
      );
      expect(tableau().getAllByText('Pavillon').length).toBeGreaterThan(0);
      // … et l'ancienne (Alpha seul), libérée ensuite, est ignorée.
      libererAncienne();
      await new Promise((r) => setTimeout(r, 50));
      expect(tableau().queryByText('Salle Wagram')).toBeNull();
      expect(tableau().getAllByText('Pavillon').length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );
});
