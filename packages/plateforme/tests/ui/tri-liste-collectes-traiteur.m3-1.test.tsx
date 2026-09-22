/**
 * M3.1 — Tri par défaut de la liste Collectes traiteur (§06.04 §3 « Vue cartes »).
 *
 * Le CDC énonce le tri SANS réserve : « date décroissante (les plus récentes en
 * premier) ». Le code triait en réalité les semaines de façon conditionnelle
 * (décroissant sur Historique, croissant sur Programmées) et les cartes
 * intra-semaine toujours en croissant. Arbitrage Val 2026-09-21 (option B) : le
 * CDC était juste, c'est le code qui s'aligne.
 * Cf. _Divergences/_traités/2026-09/M3.1_20260921_tri_liste_collectes.md.
 *
 * Ce cas épingle LES DEUX niveaux de tri DANS LES DEUX onglets : sans lui,
 * l'écart se reformerait sans qu'aucun mécanisme ne le signale.
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

// Attendu CDC : décroissant strict, semaines ET cartes intra-semaine.
const ATTENDU_DECROISSANT = [...JOURS].sort().reverse();

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

// La route renvoie déjà date_collecte DESC ; on sert volontairement l'ordre
// INVERSE (croissant) pour que le test prouve le tri du composant et non celui
// de l'API — sans ça, un composant qui ne trierait rien passerait au vert.
function rowsPour(statuts: string): unknown[] {
  const historique = statuts.includes('realisee');
  return JOURS.map((j) => collecte(j, historique ? 'realisee' : 'programmee'));
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
    return jsonResponse({
      data: rowsPour(new URL(url, 'http://t').searchParams.get('statut') ?? ''),
    });
  return jsonResponse({ data: null });
});

/** Dates ISO des cartes, dans l'ordre du DOM. */
function ordreDesCartes(container: HTMLElement): string[] {
  return Array.from(
    (container.textContent ?? '').matchAll(/LIEU-(\d{4}-\d{2}-\d{2})/g),
    (m) => m[1],
  ).filter((d): d is string => Boolean(d));
}

/** Première date de chaque groupe-semaine, dans l'ordre du DOM. */
function ordreDesSemaines(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('section'))
    .map((s) => /LIEU-(\d{4}-\d{2}-\d{2})/.exec(s.textContent ?? '')?.[1])
    .filter((d): d is string => Boolean(d));
}

describe('M3.1 — liste Collectes traiteur : tri par défaut (§06.04 §3)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it(
    'M3.1/tri_liste_collectes_date_decroissante_deux_onglets',
    async () => {
      const { container } = render(<TraiteurCollectesPage />);

      // ── Onglet Historique ────────────────────────────────────────────────
      fireEvent.click(screen.getByRole('tab', { name: 'Historique' }));
      await waitFor(
        () => expect(ordreDesCartes(container)).toHaveLength(JOURS.length),
        ATTENTE_UI,
      );

      // 3 semaines, ordonnées de la plus récente à la plus ancienne.
      expect(ordreDesSemaines(container)).toEqual([
        '2026-07-14',
        '2026-07-10',
        '2026-07-02',
      ]);
      // … et, À L'INTÉRIEUR de chaque semaine, cartes décroissantes aussi
      // (c'est ce niveau-là que l'ancien code laissait en croissant).
      expect(ordreDesCartes(container)).toEqual(ATTENDU_DECROISSANT);

      // ── Onglet Programmées — MÊME tri, aucune exception d'onglet ─────────
      fireEvent.click(screen.getByRole('tab', { name: 'Programmées' }));
      await waitFor(
        () => expect(ordreDesCartes(container)).toEqual(ATTENDU_DECROISSANT),
        ATTENTE_UI,
      );
      expect(ordreDesSemaines(container)).toEqual([
        '2026-07-14',
        '2026-07-10',
        '2026-07-02',
      ]);
    },
    ATTENTE_CAS_MS,
  );
});
