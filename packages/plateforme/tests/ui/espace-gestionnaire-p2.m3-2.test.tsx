/**
 * M3.2 — Tests UI R19b-P2 (§06.05).
 * Couvre :
 *  - BL-P2-13 : nav — « Mon pack AG » masqué via hiddenNavHrefs (conditionnel pack,
 *    l.71) ; Collectes + Registre conservés (override Val 2026-07-06) ;
 *  - BL-P2-12 : barre de filtres globale dashboard (Lieux/Traiteurs/Type/Taille) +
 *    compteur + cartes KPI non cliquables (Val 2026-07-10) ;
 *    héritage Type/Taille de l'encart benchmark (l.160) ;
 *    liste Lieux colonne Capacité ; liste Traiteurs colonne Lieux d'intervention ;
 *  - chargement des KPI du dashboard (hook partagé avec la fiche traiteur) :
 *    filtres parc transmis, panne distincte du vide, réponse périmée ignorée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react';

const routerPush = vi.fn();
const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire',
}));

import { Sidebar } from '@/components/layout/sidebar.js';
import { BenchmarkFilterBar } from '@/components/dashboards/BenchmarkFilterBar.js';
import GestionnaireDashboardPage from '@/app/(gestionnaire)/gestionnaire/page.js';
import GestionnaireLieuxPage from '@/app/(gestionnaire)/gestionnaire/lieux/page.js';
import GestionnaireTraiteursPage from '@/app/(gestionnaire)/gestionnaire/traiteurs/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { previousWindow } from '@/lib/dashboards/cockpit-derive';

const KPIS_ZD = {
  nb_collectes: 5,
  tonnage_kg: 1200,
  taux_recyclage_pondere: 68.5,
  kg_par_pax: 1.4,
  nb_repas_donnes: null,
  pax_total: null,
  repas_par_pax: null,
};

const KPIS_AG = {
  nb_collectes: 3,
  nb_repas_donnes: 120,
  pax_total: 400,
  repas_par_pax: 0.3,
};

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

const PARC = {
  lieux: [{ id: 'l1', nom: 'Palais des Congrès' }],
  traiteurs: [{ id: 'tr1', nom: 'Kaspia' }],
  types: [{ id: 'ty1', libelle: 'Gala' }],
};

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/gestionnaire/filtres'))
    return jsonResponse({ data: PARC });
  if (url.includes('/gestionnaire/dashboard'))
    return jsonResponse({
      data: {
        kpis: KPIS_ZD,
        pack: null,
        kg_par_pax_par_flux: { biodechet: 0.6 },
      },
    });
  if (url.includes('/gestionnaire/lieux'))
    return jsonResponse({
      data: [
        {
          id: 'l1',
          nom: 'Palais des Congrès',
          adresse_acces: '2 place de la Porte Maillot',
          code_postal: '75017',
          ville: 'Paris',
          type_vehicule_max: 'poids_lourd',
          capacite_maximum: 3500,
          actif: true,
          nb_collectes_12m: 4,
          tonnage_12m_kg: 1200,
        },
      ],
    });
  if (url.includes('/gestionnaire/traiteurs'))
    return jsonResponse({
      data: [
        {
          id: 'tr1',
          nom: 'Kaspia',
          // Clé R2 comme en base depuis 20260919100000 (et non une URL).
          logo_url: 'savr-dev/logos/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png',
          nb_collectes_12m: 3,
          tonnage_12m_kg: 900,
          taux_recyclage_moyen: 72.4,
          repas_donnes_12m: 120,
          lieux_intervention: [{ id: 'l1', nom: 'Palais des Congrès' }],
        },
      ],
    });
  if (url.includes('/dashboards/benchmark/filtres'))
    return jsonResponse({ data: PARC });
  if (url.includes('/dashboards/benchmark')) return jsonResponse({ data: [] });
  return jsonResponse({});
});

function makeLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
}

beforeEach(() => {
  cleanup();
  routerPush.mockClear();
  routerReplace.mockClear();
  vi.stubGlobal('localStorage', makeLocalStorage());
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

// ── BL-P2-13 nav ──────────────────────────────────────────────────────────────
describe('M3.2 / P2 nav gestionnaire', () => {
  it('M3.2/P2_nav_pack_masque_si_absent — hiddenNavHrefs masque « Mon pack AG »', () => {
    render(
      <Sidebar
        role="gestionnaire_lieux"
        hiddenNavHrefs={['/gestionnaire/mon-pack-ag']}
      />,
    );
    expect(screen.queryByText('Mon pack AG')).not.toBeInTheDocument();
    // Override Val : Collectes + Registre réglementaire conservés.
    expect(screen.getByText('Collectes')).toBeInTheDocument();
    expect(screen.getByText('Registre réglementaire')).toBeInTheDocument();
  });

  it('M3.2/P2_nav_pack_affiche_si_present — sans masquage, « Mon pack AG » visible', () => {
    render(<Sidebar role="gestionnaire_lieux" />);
    expect(screen.getByText('Mon pack AG')).toBeInTheDocument();
  });
});

// ── BL-P2-12 barre globale dashboard ──────────────────────────────────────────
describe('M3.2 / P2 dashboard filtres globaux', () => {
  it(
    'M3.2/P2_dashboard_barre_5_filtres — Lieux/Traiteurs/Type/Taille montés',
    async () => {
      render(<GestionnaireDashboardPage />);
      expect(
        await screen.findByTestId(
          'dashboard-filter-lieux',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('dashboard-filter-traiteurs'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-filter-type')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-filter-taille')).toBeInTheDocument();
      // « Réinitialiser les filtres » n'apparaît qu'une fois un filtre posé
      // (R-UI-4b, D5 : `FilterBar actif`) — tout est au défaut au montage.
      expect(screen.queryByTestId('dashboard-filter-reinitialiser')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/P2_dashboard_compteur_collectes — « X collectes correspondent »',
    async () => {
      render(<GestionnaireDashboardPage />);
      const count = await screen.findByTestId(
        'dashboard-collectes-count',
        undefined,
        ATTENTE_UI,
      );
      expect(count).toHaveTextContent(/5 collectes correspondent/i);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/P2_dashboard_carte_kpi_non_cliquable — cartes KPI non cliquables (Val 2026-07-10)',
    async () => {
      render(<GestionnaireDashboardPage />);
      const carte = await screen.findByText(
        'Nombre de collectes',
        undefined,
        ATTENTE_UI,
      );
      routerPush.mockClear();
      fireEvent.click(carte);
      // R24 Cockpit — décision Val GO-VISUAL 2026-07-10 : les cartes KPI ne sont
      // plus cliquables (aucune navigation, aucun lien vers Événements).
      expect(routerPush).not.toHaveBeenCalled();
      const liens = screen
        .queryAllByRole('link')
        .filter((a) =>
          a.getAttribute('href')?.includes('/gestionnaire/evenements'),
        );
      expect(liens).toHaveLength(0);
    },
    ATTENTE_CAS_MS,
  );
});

// ── Chargement des KPI du dashboard (hook partagé avec la fiche traiteur) ─────
describe('M3.2 / dashboard — chargement des KPI', () => {
  const appelsKpi = (mock: typeof fetchMock) =>
    mock.mock.calls
      .map(([input]) => String(input))
      .filter((u) => u.includes('/gestionnaire/dashboard'))
      .map((u) => new URL(u, 'http://x').searchParams);

  it(
    'M3.2/dashboard_kpi_filtres_parc_transmis — la période et la période précédente portent les 4 filtres parc',
    async () => {
      const filtres = {
        from: '2026-01-01',
        to: '2026-03-31',
        lieu_ids: ['l1'],
        traiteur_ids: ['tr1'],
        type_evenement_ids: ['ty1'],
        taille_evenement_codes: ['M'],
      };
      localStorage.setItem('gestionnaire-dashboard', JSON.stringify(filtres));
      render(<GestionnaireDashboardPage />);
      await screen.findByText('Nombre de collectes', undefined, ATTENTE_UI);

      const appels = appelsKpi(fetchMock);
      const avant = previousWindow(filtres.from, filtres.to)!;
      expect(
        new Set(appels.map((p) => `${p.get('from')}→${p.get('to')}`)),
      ).toEqual(
        new Set([`${filtres.from}→${filtres.to}`, `${avant.from}→${avant.to}`]),
      );
      for (const p of appels) {
        expect(p.get('type')).toBe('zero_dechet');
        expect(p.getAll('lieu_ids[]')).toEqual(['l1']);
        expect(p.getAll('traiteur_ids[]')).toEqual(['tr1']);
        expect(p.getAll('type_evenement_ids[]')).toEqual(['ty1']);
        expect(p.getAll('taille_evenements[]')).toEqual(['M']);
      }
    },
    ATTENTE_CAS_MS,
  );

  // §10 §7 : état Error distinct de l'état Empty. Avant, `r.json()` sans contrôle
  // de `r.ok` rendait « Aucune collecte sur la période sélectionnée. » quand
  // l'API tombait : une panne se lisait comme un parc sans collecte.
  it(
    'M3.2/dashboard_kpi_erreur_distincte_du_vide — une panne affiche une erreur + Réessayer, jamais « Aucune collecte »',
    async () => {
      let panne: 'http' | 'reseau' | null = 'http';
      const fetchPanne = vi.fn((input: RequestInfo | URL) => {
        if (!String(input).includes('/gestionnaire/dashboard') || !panne)
          return fetchMock(input);
        return panne === 'http'
          ? Promise.resolve({
              ok: false,
              status: 500,
              json: () => Promise.resolve({ error: 'boom' }),
            } as Response)
          : Promise.reject(new TypeError('Failed to fetch'));
      });
      vi.stubGlobal('fetch', fetchPanne);
      render(<GestionnaireDashboardPage />);

      const enErreur = async () => {
        expect(
          await screen.findByRole('alert', {}, ATTENTE_UI),
        ).toHaveTextContent('Impossible de charger le dashboard');
        expect(screen.queryByTestId('empty-dashboard-state')).toBeNull();
        expect(screen.queryByTestId('dashboard-collectes-count')).toBeNull();
        expect(screen.queryByText('Nombre de collectes')).toBeNull();
      };
      await enErreur();

      // « Réessayer » relance l'appel ; une coupure réseau reste une erreur.
      panne = 'reseau';
      const avantRelance = appelsKpi(fetchPanne).length;
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      await waitFor(
        () =>
          expect(appelsKpi(fetchPanne).length).toBeGreaterThan(avantRelance),
        ATTENTE_UI,
      );
      await enErreur();

      // Service revenu : les cartes s'affichent, l'erreur disparaît.
      panne = null;
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(
        await screen.findByText('Nombre de collectes', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByTestId('dashboard-collectes-count')).toHaveTextContent(
        /5 collectes correspondent/i,
      );

      // Nouvelle panne après un chargement réussi : aucun chiffre de l'ancien
      // chargement ne reste affiché à côté de l'erreur.
      panne = 'http';
      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      await enErreur();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/dashboard_kpi_reponse_perimee_ignoree — une réponse arrivée après un changement de type ne remplace pas les chiffres affichés',
    async () => {
      // Les KPI Zéro Déchet ne répondent qu'à la demande du test.
      let livrerZd!: () => void;
      const zdEnAttente = new Promise<Response>((resolve) => {
        livrerZd = () =>
          resolve({
            ok: true,
            json: () => Promise.resolve({ data: { kpis: KPIS_ZD } }),
          } as Response);
      });
      const fetchLent = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.includes('/gestionnaire/dashboard')) return fetchMock(input);
        return url.includes('type=anti_gaspi')
          ? jsonResponse({ data: { kpis: KPIS_AG, pack: null } })
          : zdEnAttente;
      });
      vi.stubGlobal('fetch', fetchLent);
      render(<GestionnaireDashboardPage />);
      await waitFor(
        () => expect(appelsKpi(fetchLent).length).toBeGreaterThan(0),
        ATTENTE_UI,
      );

      // Bascule sur Anti-Gaspi pendant que Zéro Déchet charge encore.
      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      await screen.findByText('Repas donnés', undefined, ATTENTE_UI);
      const compteur = screen.getByTestId('dashboard-collectes-count');
      expect(compteur).toHaveTextContent(/3 collectes correspondent/i);

      // La réponse Zéro Déchet arrive enfin : elle n'est plus attendue.
      await act(async () => {
        livrerZd();
        await zdEnAttente;
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(compteur).toHaveTextContent(/3 collectes correspondent/i);
      expect(screen.getByText('Repas donnés')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});

// ── BL-P2-12 héritage encart ──────────────────────────────────────────────────
describe('M3.2 / P2 encart héritage', () => {
  it(
    'M3.2/P2_encart_herite_type_taille — init émet Type/Taille des filtres globaux (l.160)',
    async () => {
      const onChange = vi.fn();
      render(
        <BenchmarkFilterBar
          onChange={onChange}
          initialTypeEvenementIds={['ty1']}
          initialTailleCodes={['M']}
        />,
      );
      await waitFor(() => expect(onChange).toHaveBeenCalled(), ATTENTE_UI);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type_evenement_ids: ['ty1'],
          taille_evenement_codes: ['M'],
        }),
      );
    },
    ATTENTE_CAS_MS,
  );
});

// ── BL-P2-12 listes ───────────────────────────────────────────────────────────
describe('M3.2 / P2 listes colonnes', () => {
  it(
    'M3.2/P2_lieux_colonne_capacite — Capacité rendue',
    async () => {
      render(<GestionnaireLieuxPage />);
      // DataTable rend chaque colonne deux fois (tableau >= 640px + cards
      // mobile, §10 §8) : les deux variantes coexistent dans le DOM jsdom.
      expect(
        (await screen.findAllByText('Capacité', undefined, ATTENTE_UI)).length,
      ).toBeGreaterThan(0);
      // Séparateur de milliers français (lib/format, DS §3).
      expect(screen.getAllByText(/^3\s500 pers\.$/).length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/P2_lieux_etat_erreur_distinct_du_vide — échec de chargement ≠ liste vide',
    async () => {
      // §10 §7 « Error » : avant correction, le fetch sans .catch laissait
      // rows=[] → une 500 s'affichait à l'identique d'un parc réellement vide.
      const enEchec = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        } as Response),
      );
      vi.stubGlobal('fetch', enEchec);
      render(<GestionnaireLieuxPage />);

      expect(
        await screen.findByText(
          /Impossible de charger vos lieux/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      // ErrorState (R-UI-1 H5) : bandeau role=alert + « Réessayer ».
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Impossible de charger vos lieux',
      );
      expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
      expect(enEchec).toHaveBeenCalled();
      expect(screen.queryByText('Aucun lieu associé')).toBeNull();

      // « Réessayer » relance réellement l'appel, et la liste se peuple.
      vi.stubGlobal('fetch', fetchMock);
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(
        (
          await screen.findAllByText(
            'Palais des Congrès',
            undefined,
            ATTENTE_UI,
          )
        ).length,
      ).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M3.2/P2_lieux_etat_vide — parc vide rend l'EmptyState, pas un tableau nu",
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => jsonResponse({ data: [] })),
      );
      render(<GestionnaireLieuxPage />);
      expect(
        await screen.findByText('Aucun lieu associé', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.queryByText('Capacité')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M3.2/P2_traiteurs_colonne_lieux — Lieux d'intervention rendus",
    async () => {
      render(<GestionnaireTraiteursPage />);
      const table = within(
        await screen.findByRole('table', undefined, ATTENTE_UI),
      );
      expect(
        table.getByRole('columnheader', { name: /Lieux d'intervention/ }),
      ).toBeInTheDocument();
      expect(table.getByText('Palais des Congrès')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  // `organisations.logo_url` porte une CLÉ R2 (20260919100000) : la poser dans
  // src n'affiche rien. La vignette doit passer par le proxy scopé.
  it(
    'M3.2/P2_traiteurs_logo_par_proxy — src = proxy, jamais la clé R2',
    async () => {
      render(<GestionnaireTraiteursPage />);
      // Double rendu DataGrid (tableau + carte mobile) : les deux vignettes
      // doivent passer par le proxy, on les vérifie toutes.
      const noms = await screen.findAllByText('Kaspia', undefined, ATTENTE_UI);
      expect(noms).toHaveLength(2);
      for (const nom of noms) {
        const img = nom.closest('div')!.querySelector('img')!;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe(
          '/api/v1/gestionnaire/traiteurs/tr1/logo',
        );
        // Sonde du bug corrigé : la clé de stockage ne doit jamais atterrir dans src.
        expect(img.getAttribute('src')).not.toContain('savr-dev/logos/');
      }
    },
    ATTENTE_CAS_MS,
  );

  // §10 §7 : état Error distinct de l'état Empty. Avant, `r.json()` sans contrôle
  // de `r.ok` rendait « Aucun traiteur » quand l'API tombait : une panne se
  // lisait comme un parc sans traiteur.
  it(
    'M3.2/P2_traiteurs_erreur_api — une panne affiche une erreur + Réessayer, jamais « Aucun traiteur »',
    async () => {
      let appels = 0;
      // Mock dédié (le beforeEach ré-installe fetchMock : aucune fuite).
      const fetchPanne = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/gestionnaire/traiteurs')) {
          appels += 1;
          // 1er appel en panne, le « Réessayer » réussit.
          if (appels === 1)
            return Promise.resolve({
              ok: false,
              status: 500,
              json: () => Promise.resolve({ error: 'boom' }),
            } as Response);
          return jsonResponse({ data: [] });
        }
        return jsonResponse({});
      });
      vi.stubGlobal('fetch', fetchPanne);
      render(<GestionnaireTraiteursPage />);

      expect(
        await screen.findByText(
          'Le chargement des traiteurs a échoué.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('Aucun traiteur')).not.toBeInTheDocument();

      // « Réessayer » relance l'appel ; une réponse vide donne alors l'état Empty.
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(
        await screen.findByText('Aucun traiteur', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Le chargement des traiteurs a échoué.'),
      ).not.toBeInTheDocument();
      expect(appels).toBe(2);
    },
    ATTENTE_CAS_MS,
  );
});
