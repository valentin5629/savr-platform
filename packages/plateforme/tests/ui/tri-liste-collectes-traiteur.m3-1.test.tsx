/**
 * M3.1 — Tri par défaut de la liste Collectes traiteur (§06.04 §3).
 *
 * Décision Val 2026-10-19 : les onglets par état « Programmées / Historique »
 * deviennent les vues « Collectes à venir / passées », rangées par DATE, et
 * chacune s'ouvre de la plus proche à la plus lointaine : date croissante à
 * venir, décroissante dans le passé (remplace le tri décroissant unique de
 * l'arbitrage du 2026-09-21).
 *
 * Ce cas épingle, DANS LES DEUX vues, le tri du composant et la borne de date
 * envoyée à la route (aujourd'hui compte dans « à venir »).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/traiteur/collectes',
}));

// La page lit le rôle + l'id utilisateur dans le JWT (canWrite). Un commercial
// suffit : le tri ne dépend d'aucun droit d'écriture.
vi.mock('@savr/shared/src/supabase-client.js', () => {
  const payload = Buffer.from(
    JSON.stringify({
      user_role: 'traiteur_commercial',
      organisation_id: 'org-1',
      sub: 'u1',
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

import TraiteurCollectesPage from '@/app/(traiteur)/traiteur/collectes/page.js';

// 3 semaines, dont DEUX qui portent plusieurs collectes : le tri intra-semaine
// n'est observable que si une semaine contient au moins 2 cartes.
//   semaine du 29/06 : 30/06, 02/07
//   semaine du 06/07 : 07/07, 09/07, 10/07
//   semaine du 13/07 : 14/07
const JOURS = [
  '2026-06-30',
  '2026-07-02',
  '2026-07-07',
  '2026-07-09',
  '2026-07-10',
  '2026-07-14',
];

// Data Table plate depuis 2026-09-28 : l'ordre des lignes suffit.
const ATTENDU_CROISSANT = [...JOURS].sort();
const ATTENDU_DECROISSANT = [...ATTENDU_CROISSANT].reverse();

// Le lieu porte la date ISO : c'est le marqueur qui rend l'ORDRE du DOM lisible
// (le libellé de date de la carte est localisé, donc impropre à l'assertion).
function collecte(jour: string, statut: string) {
  return {
    id: `c-${jour}`,
    type: 'zero_dechet',
    statut,
    date_collecte: jour,
    heure_collecte: '23:30:00',
    programmee_par_tiers: false,
    poids_total_kg: null,
    taux_recyclage: null,
    co2_evite_kg: null,
    nb_repas_donnes: null,
    evenements: {
      created_by: 'autre-user',
      pax: 120,
      nom_client_organisateur: null,
      lieux: {
        nom: `LIEU-${jour}`,
        adresse_acces: '1 rue du Test',
        code_postal: '75001',
        ville: 'Paris',
      },
    },
  };
}

// La route sert ici un ordre mélangé, ni croissant ni décroissant : le test
// prouve le tri du composant et non celui de l'API — sans ça, un composant qui
// ne trierait rien passerait au vert dans l'une des deux vues.
const ORDRE_ROUTE = [3, 0, 5, 1, 4, 2].map((i) => JOURS[i] as string);
function rowsPour(): unknown[] {
  return ORDRE_ROUTE.map((j) => collecte(j, 'validee'));
}

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  // ⚠ /collectes/filtres AVANT /collectes (préfixe commun).
  if (url.includes('/traiteur/collectes/filtres'))
    return jsonResponse({
      data: { lieux: [], clients: [], programmateurs: [] },
    });
  if (url.includes('/traiteur/collectes'))
    return jsonResponse({ data: rowsPour() });
  return jsonResponse({ data: null });
});

/** Dates ISO des lignes du tableau, dans l'ordre du DOM. Bornées au <table> :
 *  DataGrid rend aussi chaque ligne en carte mobile (doublon). */
function ordreDesCartes(container: HTMLElement): string[] {
  return Array.from(
    (container.querySelector('table')?.textContent ?? '').matchAll(
      /LIEU-(\d{4}-\d{2}-\d{2})/g,
    ),
    (m) => m[1],
  ).filter((d): d is string => Boolean(d));
}

/** Paramètres du dernier appel de la liste (hors options des filtres). */
function dernierAppelListe(): URLSearchParams {
  const urls = fetchMock.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.includes('/traiteur/collectes?'));
  return new URL(urls.at(-1) ?? '', 'http://t').searchParams;
}

describe('M3.1 — liste Collectes traiteur : tri par défaut (§06.04 §3)', () => {
  beforeEach(() => {
    // Seule l'horloge est figée (les minuteries restent réelles pour waitFor) :
    // le 8 juillet 2026 à 10 h à Paris.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-08T08:00:00Z'));
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it(
    'M3.1/tri_liste_collectes_par_vue_plus_proche_d_abord',
    async () => {
      const { container } = render(<TraiteurCollectesPage />);

      // ── Vue « Collectes à venir » (par défaut) : date croissante ─────────
      expect(
        screen.getByRole('tab', { name: 'Collectes à venir' }),
      ).toHaveAttribute('aria-selected', 'true');
      await waitFor(
        () => expect(ordreDesCartes(container)).toHaveLength(JOURS.length),
        ATTENTE_UI,
      );
      expect(ordreDesCartes(container)).toEqual(ATTENDU_CROISSANT);
      // Aujourd'hui compte dans « à venir » ; aucune borne haute.
      expect(dernierAppelListe().get('from')).toBe('2026-07-08');
      expect(dernierAppelListe().get('to')).toBeNull();

      // ── Vue « Collectes passées » : date décroissante ────────────────────
      // Onglets Radix : activation au mousedown (pas au click).
      fireEvent.mouseDown(
        screen.getByRole('tab', { name: 'Collectes passées' }),
      );
      await waitFor(
        () => expect(dernierAppelListe().get('to')).toBe('2026-07-07'),
        ATTENTE_UI,
      );
      expect(dernierAppelListe().get('from')).toBeNull();
      await waitFor(
        () => expect(ordreDesCartes(container)).toEqual(ATTENDU_DECROISSANT),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});
