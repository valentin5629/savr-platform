/**
 * M3.2 — Tests UI R19b (§06.05 Espace gestionnaire de lieux).
 * Couvre les livrables BL-P1-GEST-01..04 :
 *  - GEST-01 : bouton « Programmer un événement » (point d'entrée dashboard) ;
 *  - GEST-02 : formulaire partagé « cas Gestionnaire » (sélecteur traiteur +
 *              blocage AG sans pack actif) ;
 *  - GEST-03 : KPI dashboard affichés (clé data.kpis, plus d'EmptyState systématique) ;
 *  - GEST-04 : jauge benchmark consommant la moyenne pondérée (benchmark_kg_pax).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

// KpiCard + form utilisent useRouter — pas de contexte router en jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// Le formulaire partagé lit le rôle via la session Supabase (JWT). On le force à
// gestionnaire_lieux pour monter le « cas Gestionnaire ».
vi.mock('@savr/shared/src/supabase-client.js', () => {
  const payload = Buffer.from(
    JSON.stringify({
      user_role: 'gestionnaire_lieux',
      organisation_id: 'org-1',
    }),
  ).toString('base64url');
  const token = `h.${payload}.s`;
  return {
    createBrowserSupabaseClient: () => ({
      auth: {
        getSession: () =>
          Promise.resolve({ data: { session: { access_token: token } } }),
      },
    }),
  };
});

import GestionnaireDashboardPage from '@/app/(gestionnaire)/gestionnaire/page.js';
import NouveauProgrammationPage from '@/app/(programmation)/programmer/nouveau/page.js';
import { BenchmarkGauge } from '@/components/dashboards/BenchmarkGauge.js';
import { BenchmarkFilterBar } from '@/components/dashboards/BenchmarkFilterBar.js';

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

// Routeur de fetch commun : couvre dashboard, benchmark et endpoints du formulaire.
const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/gestionnaire/dashboard'))
    return jsonResponse({
      data: {
        kpis: KPIS_ZD,
        pack: null,
        kg_par_pax_par_flux: { biodechet: 0.6 },
      },
    });
  // ⚠ /benchmark/filtres AVANT /dashboards/benchmark (préfixe commun).
  if (url.includes('/dashboards/benchmark/filtres'))
    return jsonResponse({
      data: {
        lieux: [{ id: 'l1', nom: 'Palais des Congrès' }],
        traiteurs: [{ id: 'tr1', nom: 'Kaspia' }],
        types: [{ id: 'ty1', libelle: 'Gala' }],
      },
    });
  if (url.includes('/dashboards/benchmark'))
    return jsonResponse({
      data: [
        {
          flux_id: 'f-bio',
          flux_code: 'biodechet',
          type_evenement_id: 't-cocktail',
          taille_evenement: 'M',
          kg_par_pax_moyen: 1.6,
          nb_collectes_segment: 8,
          nb_organisations_distinctes: 3,
        },
      ],
    });
  if (url.includes('/programmation/types-evenements'))
    return jsonResponse([{ id: 't1', libelle: 'Gala', code: 'GALA' }]);
  if (url.includes('/programmation/organisations/traiteurs'))
    return jsonResponse([
      {
        id: 'tr1',
        raison_sociale: 'Kaspia',
        nom_commercial: 'Kaspia',
        ville: 'Paris',
      },
    ]);
  if (url.includes('/programmation/pack-ag'))
    return jsonResponse({ pack_actif: false, credits_restants: 0 });
  if (url.includes('/programmation/lieux')) return jsonResponse({ data: [] });
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
  vi.stubGlobal('localStorage', makeLocalStorage());
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('M3.2 / R19b espace gestionnaire (UI)', () => {
  it("M3.2/GEST01_bouton_programmer_present — point d'entrée programmation sur le dashboard", async () => {
    render(<GestionnaireDashboardPage />);

    // Le parcours métier principal du gestionnaire : bouton « Programmer un événement »
    // pointant vers le formulaire partagé.
    const lien = await screen.findByRole('link', {
      name: /Programmer un événement/i,
    });
    expect(lien).toHaveAttribute('href', '/programmer/nouveau');
  });

  it("M3.2/GEST03_kpi_affiches_cle_kpis — dashboard lit data.kpis (plus d'EmptyState systématique)", async () => {
    render(<GestionnaireDashboardPage />);

    // Avant le fix (lecture de data.kpi singulier), kpi=null → EmptyState.
    // Après (data.kpis), les 4 cartes ZD s'affichent.
    expect(await screen.findByText('Nombre de collectes')).toBeInTheDocument();
    expect(screen.getByText('Taux de recyclage')).toBeInTheDocument();
    // La valeur agrégée (nb_collectes = 5) est rendue, pas l'état vide.
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('M3.2/GEST04_benchmark_gauge_moyenne_ponderee — jauge consomme benchmark_kg_pax', async () => {
    render(<BenchmarkGauge bracket="M" fluxCode="biodechet" myKgPax={2.0} />);

    // Le libellé et la valeur proviennent de la moyenne pondérée parc (ex-median_kg_pax).
    expect(
      await screen.findByText(/Moyenne pondérée parc/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1,6/)).toBeInTheDocument();
    // Ratio utilisateur (2.0 / 1.6 = 125 %) affiché vs la moyenne parc.
    expect(screen.getByText(/125% de la moyenne parc/i)).toBeInTheDocument();
  });

  it("M3.2/GEST04_encart_filtres_present — l'utilisateur peut choisir les paramètres du benchmark", async () => {
    render(<GestionnaireDashboardPage />);

    // L'encart des filtres du repère parc (§06.05 Bloc 3) est monté (imbriqué
    // dans la carte des jauges depuis R24b) avec ses 5 critères.
    expect(
      await screen.findByTestId('benchmark-filter-bar'),
    ).toBeInTheDocument();
    expect(screen.getByText('Filtres du repère parc')).toBeInTheDocument();
    expect(screen.getByTestId('benchmark-reinitialiser')).toBeInTheDocument();
    expect(screen.getByTestId('benchmark-filter-type')).toBeInTheDocument();
    expect(screen.getByTestId('benchmark-filter-taille')).toBeInTheDocument();
    expect(screen.getByTestId('benchmark-filter-lieux')).toBeInTheDocument();
    expect(screen.getByTestId('benchmark-preset-24m')).toBeInTheDocument();
    // Le filtre traiteurs n'apparaît qu'après chargement des listes parc (liste non
    // vide côté gestionnaire) → attente asynchrone.
    expect(
      await screen.findByTestId('benchmark-filter-traiteurs'),
    ).toBeInTheDocument();
  });

  it('M3.2/GEST04_encart_choix_taille — sélectionner une taille émet le filtre', async () => {
    const onChange = vi.fn();
    render(<BenchmarkFilterBar onChange={onChange} />);
    // Émission initiale (défaut 12 mois, tout « Tous »).
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    // L'utilisateur ouvre le filtre Taille et coche « M ».
    fireEvent.click(
      screen.getByTestId('benchmark-filter-taille').querySelector('button')!,
    );
    fireEvent.click(screen.getByTestId('benchmark-filter-taille-opt-M'));

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ taille_evenement_codes: ['M'] }),
      ),
    );
  });

  it('M3.2/GEST02_form_cas_gestionnaire — sélecteur traiteur + blocage AG sans pack', async () => {
    render(<NouveauProgrammationPage />);

    // Cas Gestionnaire : le sélecteur « Traiteur opérant » est monté (needsTraiteurSelector).
    expect(await screen.findByText(/Traiteur opérant/i)).toBeInTheDocument();

    // Cocher Anti-Gaspi sans pack actif → soumission AG bloquée (alerte).
    fireEvent.click(screen.getByRole('checkbox', { name: /Anti-Gaspi/i }));
    await waitFor(() =>
      expect(screen.getByText(/Aucun pack AG actif/i)).toBeInTheDocument(),
    );
  });
});
