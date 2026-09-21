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
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

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
        // Les deux lignes suivantes portent les cas que le CDC §06.05 §2 l.309
        // distingue et que le COALESCE(…, 0) de f_dechets_labo_estimes rendait
        // indistinguables jusqu'à 20260921190000 : coefficient NON COMMUNIQUÉ
        // (null → « — ») contre coefficient DÉCLARÉ À ZÉRO (0 → « 0 kg »).
        {
          id: 'e2',
          nom_evenement: 'Cocktail',
          date_evenement: '2026-06-02',
          pax: 200,
          taille_bracket: 'XS',
          lieu_nom: 'Palais',
          lieu_ville: 'Paris',
          traiteur_nom: 'Sans coefficient',
          statut_consolide: 'En cours',
          nb_collectes_zd: 1,
          nb_collectes_ag: 0,
          tonnage_zd_kg: 0,
          dechets_labo_kg: null,
          repas_donnes: 0,
          programmee_par_moi: false,
        },
        {
          id: 'e3',
          nom_evenement: 'Séminaire',
          date_evenement: '2026-06-03',
          pax: 100,
          taille_bracket: 'XS',
          lieu_nom: 'Palais',
          lieu_ville: 'Paris',
          traiteur_nom: 'Zéro déclaré',
          statut_consolide: 'En cours',
          nb_collectes_zd: 1,
          nb_collectes_ag: 0,
          tonnage_zd_kg: 150,
          dechets_labo_kg: 0,
          repas_donnes: 0,
          programmee_par_moi: false,
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
      expect(
        screen.getByTestId('dashboard-filter-reinitialiser'),
      ).toBeInTheDocument();
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
    'M3.2/P2_evenements_colonnes_rendues — Tonnage/Déchets labo/Repas + barre de filtres',
    async () => {
      render(<GestionnaireEvenementsPage />);
      expect(
        await screen.findByTestId(
          'evenements-filter-bar',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findByText('Tonnage total', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText('Déchets labo est.')).toBeInTheDocument();
      expect(screen.getByText('Repas donnés')).toBeInTheDocument();
      // Valeurs rendues (data prête côté route).
      expect(screen.getByText('300 kg')).toBeInTheDocument();
      expect(screen.getByText('40')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/P2_evenements_dechets_labo_non_communique — colonne « Déchets labo est. » : « — » si non communiqué, « 0 kg » si déclaré à zéro',
    async () => {
      // §06.05 §2 l.309 « — si coefficient non communiqué ». Cas INATTEIGNABLE
      // jusqu'à 20260921190000 : f_dechets_labo_estimes enveloppait son
      // résultat dans COALESCE(…, 0), donc la colonne affichait « 0 kg » —
      // l'affirmation d'une estimation nulle — là où la bonne réponse est
      // « inconnu ».
      // Les deux lignes sont mesurées ENSEMBLE, sur le même rendu : c'est leur
      // DIFFÉRENCE qui est l'oracle. Un assert « — » seul passerait aussi si la
      // page rendait « — » pour tout, y compris pour le zéro déclaré.
      render(<GestionnaireEvenementsPage />);
      await screen.findByText('Déchets labo est.', undefined, ATTENTE_UI);

      const cellule = (nomEvenement: string) => {
        const ligne = screen.getByText(nomEvenement).closest('tr')!;
        // 8e colonne du tableau (cf. l'ordre des <th> de la page).
        return ligne.querySelectorAll('td')[7]!.textContent?.trim();
      };

      expect(cellule('Cocktail')).toBe('—');
      expect(cellule('Cocktail')).not.toContain('0');
      expect(cellule('Séminaire')).toBe('0 kg');
      expect(cellule('Gala')).toBe('12 kg');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/P2_lieux_colonne_capacite — Capacité rendue',
    async () => {
      render(<GestionnaireLieuxPage />);
      expect(
        await screen.findByText('Capacité', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText('3500 pers.')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M3.2/P2_traiteurs_colonne_lieux — Lieux d'intervention rendus",
    async () => {
      render(<GestionnaireTraiteursPage />);
      expect(
        await screen.findByText("Lieux d'intervention", undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText('Palais des Congrès')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  // `organisations.logo_url` porte une CLÉ R2 (20260919100000) : la poser dans
  // src n'affiche rien. La vignette doit passer par le proxy scopé.
  it(
    'M3.2/P2_traiteurs_logo_par_proxy — src = proxy, jamais la clé R2',
    async () => {
      render(<GestionnaireTraiteursPage />);
      const img = (await screen.findByText('Kaspia', undefined, ATTENTE_UI))
        .closest('div')!
        .querySelector('img')!;
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toBe(
        '/api/v1/gestionnaire/traiteurs/tr1/logo',
      );
      // Sonde du bug corrigé : la clé de stockage ne doit jamais atterrir dans src.
      expect(img.getAttribute('src')).not.toContain('savr-dev/logos/');
    },
    ATTENTE_CAS_MS,
  );
});
