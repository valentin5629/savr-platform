/**
 * M3.2 — Tests UI R19b-P2 (§06.05).
 * Couvre :
 *  - BL-P2-13 : nav — « Mon pack AG » masqué via hiddenNavHrefs (conditionnel pack,
 *    l.71) ; Collectes + Registre conservés (override Val 2026-07-06) ;
 *  - BL-P2-12 : barre de filtres globale dashboard (Lieux/Traiteurs/Type/Taille) +
 *    compteur + carte KPI cliquable → liste Événements filtrée (l.130) ;
 *    héritage Type/Taille de l'encart benchmark (l.160) ;
 *    liste Événements colonnes (Tonnage/Déchets labo/Repas) + barre de filtres ;
 *    liste Lieux colonne Capacité ; liste Traiteurs colonne Lieux d'intervention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
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
import GestionnaireEvenementsPage from '@/app/(gestionnaire)/gestionnaire/evenements/page.js';
import GestionnaireLieuxPage from '@/app/(gestionnaire)/gestionnaire/lieux/page.js';
import GestionnaireTraiteursPage from '@/app/(gestionnaire)/gestionnaire/traiteurs/page.js';

const KPIS_ZD = {
  nb_collectes: 5,
  tonnage_kg: 1200,
  taux_recyclage_pondere: 68.5,
  kg_par_pax: 1.4,
  nb_repas_donnes: null,
  pax_total: null,
  repas_par_pax: null,
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
  if (url.includes('/gestionnaire/evenements'))
    return jsonResponse({
      data: [
        {
          id: 'e1',
          nom_evenement: 'Gala',
          date_evenement: '2026-06-01',
          pax: 600,
          taille_bracket: 'M',
          lieu_nom: 'Palais',
          lieu_ville: 'Paris',
          traiteur_nom: 'Kaspia',
          statut_consolide: 'Terminé',
          nb_collectes_zd: 1,
          nb_collectes_ag: 1,
          tonnage_zd_kg: 300,
          dechets_labo_kg: 12,
          repas_donnes: 40,
          programmee_par_moi: true,
        },
      ],
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
          logo_url: null,
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
  it('M3.2/P2_dashboard_barre_5_filtres — Lieux/Traiteurs/Type/Taille montés', async () => {
    render(<GestionnaireDashboardPage />);
    expect(
      await screen.findByTestId('dashboard-filter-lieux'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('dashboard-filter-traiteurs'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-filter-type')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-filter-taille')).toBeInTheDocument();
    expect(
      screen.getByTestId('dashboard-filter-reinitialiser'),
    ).toBeInTheDocument();
  });

  it('M3.2/P2_dashboard_compteur_collectes — « X collectes correspondent »', async () => {
    render(<GestionnaireDashboardPage />);
    const count = await screen.findByTestId('dashboard-collectes-count');
    expect(count).toHaveTextContent(/5 collectes correspondent/i);
  });

  it('M3.2/P2_dashboard_carte_kpi_cliquable — navigue vers Événements filtrés (l.130)', async () => {
    render(<GestionnaireDashboardPage />);
    const carte = await screen.findByText('Nombre de collectes');
    fireEvent.click(carte);
    await waitFor(() => expect(routerPush).toHaveBeenCalled());
    const target = String(routerPush.mock.calls.at(-1)?.[0] ?? '');
    expect(target).toContain('/gestionnaire/evenements');
    expect(target).toContain('type_collecte=avec_zd');
  });
});

// ── BL-P2-12 héritage encart ──────────────────────────────────────────────────
describe('M3.2 / P2 encart héritage', () => {
  it('M3.2/P2_encart_herite_type_taille — init émet Type/Taille des filtres globaux (l.160)', async () => {
    const onChange = vi.fn();
    render(
      <BenchmarkFilterBar
        onChange={onChange}
        initialTypeEvenementIds={['ty1']}
        initialTailleCodes={['M']}
      />,
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type_evenement_ids: ['ty1'],
        taille_evenement_codes: ['M'],
      }),
    );
  });
});

// ── BL-P2-12 listes ───────────────────────────────────────────────────────────
describe('M3.2 / P2 listes colonnes', () => {
  it('M3.2/P2_evenements_colonnes_rendues — Tonnage/Déchets labo/Repas + barre de filtres', async () => {
    render(<GestionnaireEvenementsPage />);
    expect(
      await screen.findByTestId('evenements-filter-bar'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Tonnage total')).toBeInTheDocument();
    expect(screen.getByText('Déchets labo est.')).toBeInTheDocument();
    expect(screen.getByText('Repas donnés')).toBeInTheDocument();
    // Valeurs rendues (data prête côté route).
    expect(screen.getByText('300 kg')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('M3.2/P2_lieux_colonne_capacite — Capacité rendue', async () => {
    render(<GestionnaireLieuxPage />);
    expect(await screen.findByText('Capacité')).toBeInTheDocument();
    expect(screen.getByText('3500 pers.')).toBeInTheDocument();
  });

  it("M3.2/P2_traiteurs_colonne_lieux — Lieux d'intervention rendus", async () => {
    render(<GestionnaireTraiteursPage />);
    expect(await screen.findByText("Lieux d'intervention")).toBeInTheDocument();
    expect(screen.getByText('Palais des Congrès')).toBeInTheDocument();
  });
});
