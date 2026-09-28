/**
 * M3.2 — Drill-down « Top listes → liste Collectes » du dashboard GESTIONNAIRE
 * (§06.05 Blocs 6/7 ZD + AG : l.209, l.215, l.267, l.273).
 *
 * Défaut d'origine (53bec7c, 2026-07-14, « miroir exact ») : le lien de drill-down
 * du gestionnaire était construit avec la règle du §06.04 **TRAITEUR** — type de
 * l'onglet actif + `statut=cloturee` figés dans l'URL. Le §06.05 l.209 demande
 * l'INVERSE pour le gestionnaire : « Liste plate (pas d'onglet Historique), tous
 * statuts, type ZD/AG non figé ; filtres du dashboard propagés (période +
 * Type/Taille d'événement) ».
 *
 * Conséquences du défaut : en cliquant une ligne de son Top 5, le gestionnaire
 * n'atterrissait que sur les collectes CLÔTURÉES du seul type de l'onglet, et les
 * deux filtres d'événement qu'il venait d'appliquer au dashboard étaient perdus en
 * route. Aucun test ne couvrait ce chemin (`grep drillScope tests/` = 0).
 *
 * Scénario Gherkin : `drilldown_top_listes_gestionnaire` (P1-critique, paramétré
 * sur les 4 blocs). Les assertions passent par `URLSearchParams` et non par
 * `toContain` : `type=` et `type_evenement_ids[]=` partagent un préfixe, une sonde
 * par sous-chaîne confondrait « type figé » et « type d'événement propagé ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire',
}));

vi.mock('@savr/shared/src/supabase-client.js', () => {
  const payload = Buffer.from(
    JSON.stringify({
      user_role: 'gestionnaire_lieux',
      organisation_id: 'org-1',
    }),
  ).toString('base64url');
  return {
    createBrowserSupabaseClient: () => ({
      auth: {
        getSession: () =>
          Promise.resolve({
            data: { session: { access_token: `h.${payload}.s` } },
          }),
      },
    }),
  };
});

import GestionnaireDashboardPage from '@/app/(gestionnaire)/gestionnaire/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

// Filtres globaux du dashboard, tels que la barre les restaure depuis
// localStorage au montage (storageKey « gestionnaire-dashboard »). Ce sont EUX
// que le §06.05 l.209 veut voir propagés dans le lien de drill-down.
const FILTRES_DASHBOARD = {
  from: '2026-01-01',
  to: '2026-06-30',
  lieu_ids: [],
  traiteur_ids: [],
  type_evenement_ids: ['ty-gala', 'ty-cocktail'],
  taille_evenement_codes: ['M', 'XL'],
};

const LIEU = { id: 'L1', nom: 'Palais des Congrès' };
const ACTEUR = { id: 'TR1', nom: 'Kaspia' };

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/gestionnaire/dashboard'))
    return jsonResponse({
      data: {
        kpis: {
          nb_collectes: 5,
          tonnage_kg: 1200,
          taux_recyclage_pondere: 68.5,
          kg_par_pax: 1.4,
          nb_repas_donnes: 300,
          pax_total: 600,
          repas_par_pax: 0.5,
        },
        pack: null,
        kg_par_pax_par_flux: { biodechet: 0.6 },
      },
    });
  if (url.includes('/dashboards/blocs'))
    return jsonResponse({
      data: {
        prochaines: [],
        topLieux: [
          {
            lieu_id: LIEU.id,
            lieu_nom: LIEU.nom,
            nb_collectes: 3,
            tonnage_kg: 900,
            taux_recyclage: 70,
            repas_donnes: 200,
            repas_par_pax: 0.4,
          },
        ],
        topActeurs: [
          {
            id: ACTEUR.id,
            label: ACTEUR.nom,
            nb_collectes: 2,
            tonnage_kg: 400,
            taux_recyclage: 60,
            repas_donnes: 100,
            repas_par_pax: 0.3,
          },
        ],
        acteurLabel: 'Traiteur',
        topAssociations: [],
        kgParPaxParFlux: { biodechet: 0.6 },
      },
    });
  if (url.includes('/gestionnaire/filtres'))
    return jsonResponse({
      data: {
        lieux: [{ id: LIEU.id, nom: LIEU.nom }],
        traiteurs: [{ id: ACTEUR.id, nom: ACTEUR.nom }],
        types: [{ id: 'ty-gala', libelle: 'Gala' }],
      },
    });
  if (url.includes('/dashboards/benchmark/filtres'))
    return jsonResponse({ data: { lieux: [], traiteurs: [], types: [] } });
  if (url.includes('/dashboards/benchmark')) return jsonResponse({ data: [] });
  if (url.includes('/programmation/pack-ag'))
    return jsonResponse({ pack_actif: false });
  return jsonResponse({});
});

function memoryStorage(seed: Record<string, string> = {}): Storage {
  let store: Record<string, string> = { ...seed };
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
  pushMock.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal(
    'localStorage',
    memoryStorage({
      'gestionnaire-dashboard': JSON.stringify(FILTRES_DASHBOARD),
    }),
  );
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('fetch', fetchMock);
});

/** URL poussée par le routeur, décomposée en chemin + paramètres. */
function urlPoussee(): { chemin: string; p: URLSearchParams } {
  expect(pushMock).toHaveBeenCalledTimes(1);
  const brut = String(pushMock.mock.calls[0]![0]);
  const [chemin, qs = ''] = brut.split('?');
  return { chemin: chemin!, p: new URLSearchParams(qs) };
}

/** Monte le dashboard, bascule sur l'onglet voulu, clique la ligne visée. */
async function cliqueTopListe(onglet: 'ZD' | 'AG', libelleCible: string) {
  render(<GestionnaireDashboardPage />);
  // Attendre que les Top listes soient servies (elles dépendent des filtres).
  await screen.findAllByLabelText(
    `Voir les collectes — ${LIEU.nom}`,
    undefined,
    ATTENTE_UI,
  );
  if (onglet === 'AG') {
    fireEvent.click(screen.getByRole('tab', { name: 'Anti-gaspi' }));
    await screen.findAllByLabelText(
      `Voir les collectes — ${LIEU.nom}`,
      undefined,
      ATTENTE_UI,
    );
  }
  fireEvent.click(
    screen.getByLabelText(`Voir les collectes — ${libelleCible}`),
  );
}

// Les 4 cas du tableau Gherkin : onglet × bloc.
const CAS = [
  {
    onglet: 'ZD' as const,
    bloc: 'Bloc 6 Top 5 lieux ZD',
    cible: LIEU.nom,
    cle: 'lieu',
    id: LIEU.id,
  },
  {
    onglet: 'ZD' as const,
    bloc: 'Bloc 7 Top 5 traiteurs ZD',
    cible: ACTEUR.nom,
    cle: 'traiteur',
    id: ACTEUR.id,
  },
  {
    onglet: 'AG' as const,
    bloc: 'Bloc 6 Top 5 lieux AG',
    cible: LIEU.nom,
    cle: 'lieu',
    id: LIEU.id,
  },
  {
    onglet: 'AG' as const,
    bloc: 'Bloc 7 Top 5 traiteurs AG',
    cible: ACTEUR.nom,
    cle: 'traiteur',
    id: ACTEUR.id,
  },
];

describe('M3.2 / drill-down Top listes gestionnaire (§06.05 l.209)', () => {
  for (const cas of CAS) {
    it(
      `M3.2/drilldown_gestionnaire_tous_statuts_type_non_fige — ${cas.bloc} : ni statut ni type figés`,
      async () => {
        await cliqueTopListe(cas.onglet, cas.cible);
        const { chemin, p } = urlPoussee();

        // Liste PLATE du gestionnaire, filtrée sur la cible cliquée.
        expect(chemin).toBe('/gestionnaire/collectes');
        expect(p.get(cas.cle)).toBe(cas.id);

        // Le cœur du §06.05 l.209 : « tous statuts, type ZD/AG non figé ».
        // Ces deux-là sont exactement ce que le code posait à tort.
        expect(p.get('statut')).toBeNull();
        expect(p.get('type')).toBeNull();
      },
      ATTENTE_CAS_MS,
    );
  }

  it(
    'M3.2/drilldown_gestionnaire_propage_periode_type_et_taille — les filtres du dashboard suivent le clic',
    async () => {
      await cliqueTopListe('ZD', LIEU.nom);
      const { p } = urlPoussee();

      // « filtres du dashboard propagés (période + Type/Taille d'événement) ».
      expect(p.get('from')).toBe(FILTRES_DASHBOARD.from);
      expect(p.get('to')).toBe(FILTRES_DASHBOARD.to);
      expect(p.getAll('type_evenement_ids[]')).toEqual(
        FILTRES_DASHBOARD.type_evenement_ids,
      );
      expect(p.getAll('taille_evenements[]')).toEqual(
        FILTRES_DASHBOARD.taille_evenement_codes,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/drilldown_gestionnaire_libelle_memorise_en_sessionstorage — le chip a de quoi se nommer',
    async () => {
      await cliqueTopListe('ZD', ACTEUR.nom);
      // Le libellé transite par sessionStorage, jamais par l'URL (un nom
      // d'organisation n'a pas à voyager en query string).
      const brut = sessionStorage.getItem('savr:collectes-filtre-label');
      expect(brut).not.toBeNull();
      expect(JSON.parse(brut!)).toMatchObject({
        kind: 'traiteur',
        id: ACTEUR.id,
        label: ACTEUR.nom,
      });
      expect(urlPoussee().p.get('traiteur')).toBe(ACTEUR.id);
    },
    ATTENTE_CAS_MS,
  );
});
