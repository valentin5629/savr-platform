/**
 * M3.2 — Pagination serveur de la liste Collectes gestionnaire (§06.05).
 *
 * Défaut d'origine (revue d'écran E2E 2026-09-22) : la route terminait sur
 * `.limit(100)` et renvoyait `{ data }` sans total. Un parc de plus de 100
 * collectes recevait donc une liste d'apparence complète qui ne l'était pas,
 * sans rien à l'écran pour le signaler. Le §06.05 l.203 veut cette liste LARGE
 * (« tous statuts, type ZD/AG non figé »), donc le plafond mordait d'autant
 * plus vite.
 *
 * Décision Val 2026-09-22 : pagination serveur réelle (`count: 'exact'` +
 * `range`), pattern §06.06 admin/lieux. Ces sondes mesurent la REQUÊTE envoyée
 * à PostgREST, parce que c'est elle qui portait la troncature.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown; count?: number | null };

function makeChain() {
  const calls: Record<string, unknown[][]> = {};
  let result: Result = { data: [], error: null, count: 0 };
  // File optionnelle : la route rejoue la requête quand PostgREST refuse la
  // fenêtre demandée, donc une sonde doit pouvoir servir deux résultats.
  const suite: Result[] = [];
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const chain: Record<string, unknown> = {
    __calls: calls,
    __set(r: Result) {
      result = r;
      return chain;
    },
    __suite(...rs: Result[]) {
      suite.push(...rs);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'gte',
    'lte',
    'order',
    'limit',
    'range',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.then = (resolve: (r: Result) => unknown) =>
    resolve(suite.length > 0 ? suite.shift()! : result);
  return chain as Record<string, unknown> & {
    __calls: Record<string, unknown[][]>;
    __set(r: Result): unknown;
    __suite(...rs: Result[]): unknown;
  };
}

let rls = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

import { GET } from '@/app/api/v1/gestionnaire/collectes/route.js';
import { COLLECTES_PAGE_SIZE as PAGE_SIZE } from '@/lib/collectes-gestionnaire.js';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

/** N lignes plates, telles que PostgREST les rendrait avec l'embed `evenements`. */
function lignes(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    evenement_id: `e${i}`,
    type: 'zero_dechet',
    statut: 'cloturee',
    statut_tms: null,
    date_collecte: '2026-11-30',
    heure_collecte: null,
    taux_recyclage: null,
    co2_evite_kg: null,
    realisee_at: null,
    evenements: {
      nom_evenement: `Événement ${i}`,
      lieu_id: 'L1',
      traiteur_operationnel_organisation_id: 'T1',
      lieux: { nom: 'Paris Expo Porte de Versailles' },
    },
  }));
}

const appel = (qs = '') =>
  GET(new NextRequest(`http://localhost/api/v1/gestionnaire/collectes${qs}`));

/** Dernier tuple d'arguments passé à `range`. */
const dernierRange = () => {
  const r = rls.__calls.range;
  return r?.[r.length - 1] as [number, number] | undefined;
};

beforeEach(() => {
  rls = makeChain();
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-gl' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: 'gestionnaire_lieux',
          organisation_id: 'org-viparis',
        }),
      },
    },
    error: null,
  });
});

describe('M3.2 / liste Collectes gestionnaire — pagination serveur', () => {
  it('M3.2/collectes_route_pagine_et_renvoie_le_total_exact', async () => {
    // 120 collectes au parc, une page demandée.
    rls.__set({ data: lignes(PAGE_SIZE), error: null, count: 120 });
    const res = await appel();
    const json = (await res.json()) as {
      data: unknown[];
      total: number;
      page: number;
    };

    // Le total renvoyé est celui de la BASE, pas celui de la page : c'est la
    // seule valeur qui rend la troncature visible.
    expect(json.total).toBe(120);
    expect(json.data.length).toBe(PAGE_SIZE);
    expect(json.page).toBe(1);

    // `count: 'exact'` demandé à PostgREST (sans lui, `count` est null et le
    // total retomberait silencieusement sur la taille de la page).
    const select = rls.__calls.select?.[0];
    expect(select?.[1]).toEqual({ count: 'exact' });
  });

  it('M3.2/collectes_route_fenetre_la_page_demandee', async () => {
    rls.__set({ data: lignes(PAGE_SIZE), error: null, count: 120 });
    await appel('?page=2');

    // Page 2 = lignes 50..99. Une fenêtre fausse afficherait deux fois la même
    // page ou sauterait des collectes.
    expect(dernierRange()).toEqual([PAGE_SIZE, PAGE_SIZE * 2 - 1]);
  });

  it('M3.2/collectes_route_ne_tronque_plus_a_100', async () => {
    rls.__set({ data: lignes(PAGE_SIZE), error: null, count: 120 });
    await appel();

    // Le défaut d'origine, épinglé : `.limit(100)` coupait la liste sans le
    // dire. La fenêtre est désormais portée par `range` seul.
    expect(rls.__calls.limit).toBeUndefined();
    expect(dernierRange()).toEqual([0, PAGE_SIZE - 1]);
  });

  it('M3.2/collectes_route_ordre_departage_stable_entre_pages', async () => {
    rls.__set({ data: lignes(PAGE_SIZE), error: null, count: 120 });
    await appel();

    // `date_collecte` n'est pas unique : sans départage, deux pages successives
    // peuvent réordonner les ex æquo et faire disparaître une ligne.
    const colonnes = (rls.__calls.order ?? []).map((a) => a[0]);
    expect(colonnes).toContain('date_collecte');
    expect(colonnes).toContain('id');
  });

  it('M3.2/collectes_route_page_hors_bornes_retombe_sur_1', async () => {
    for (const mauvaise of ['0', '-5', 'abc', '']) {
      rls = makeChain();
      rls.__set({ data: [], error: null, count: 0 });
      await appel(`?page=${mauvaise}`);
      // Un offset négatif ferait répondre PostgREST en 416 : l'écran afficherait
      // une panne là où l'utilisateur a juste une URL abîmée.
      expect(dernierRange()).toEqual([0, PAGE_SIZE - 1]);
    }
  });

  it('M3.2/collectes_route_pagination_compatible_avec_le_drilldown', async () => {
    rls.__set({ data: lignes(3), error: null, count: 3 });
    const res = await appel('?lieu_id=L1&statut=cloturee&page=1');
    const json = (await res.json()) as { total: number };

    // Le drill-down filtre : le total doit être celui du PÉRIMÈTRE FILTRÉ, sinon
    // le compteur annoncerait des collectes que la liste ne contient pas.
    expect(json.total).toBe(3);
    const eq = (rls.__calls.eq ?? []).map((a) => `${a[0]}=${a[1]}`);
    expect(eq).toContain('evenements.lieu_id=L1');
    expect(eq).toContain('statut=cloturee');
  });
  it('M3.2/collectes_route_page_au_dela_de_la_derniere_nest_pas_une_panne', async () => {
    // PostgREST refuse en 416 `PGRST103` une fenêtre qui dépasse le nombre de
    // lignes. Cas réel : un lien partagé `?page=4`, un favori, ou une liste qui
    // a rétréci entre deux chargements.
    rls.__suite(
      { data: null, error: { code: 'PGRST103' }, count: null },
      { data: lignes(1), error: null, count: 120 },
    );
    const res = await appel('?page=4');
    const json = (await res.json()) as {
      data: unknown[];
      total: number;
      page: number;
    };

    // 200 et page vide, JAMAIS 500 : l'écran afficherait « Le chargement des
    // collectes a échoué » sur un parc parfaitement sain.
    expect(res.status).toBe(200);
    expect(json.data).toEqual([]);
    // Le total reste exact pour que l'écran sache combien de pages existent et
    // puisse ramener l'utilisateur sur une page valide.
    expect(json.total).toBe(120);
    expect(json.page).toBe(4);
  });

  it('M3.2/collectes_route_echec_reel_reste_une_erreur', async () => {
    // Garde-fou du rattrapage ci-dessus : une VRAIE panne ne doit pas être
    // blanchie en page vide.
    //
    // La 2e réponse de la file RÉUSSIT volontairement : si le code rattrapait
    // toute erreur au lieu du seul `PGRST103`, il rejouerait la requête, ce
    // rejeu passerait, et la panne sortirait en 200. C'est cette confusion que
    // la sonde doit voir. Une file qui rejouerait la MÊME erreur rendrait 500
    // dans les deux cas — le test serait vert par construction.
    rls.__suite(
      { data: null, error: { code: '42P01' }, count: null },
      { data: lignes(1), error: null, count: 120 },
    );
    const res = await appel('?page=2');
    expect(res.status).toBe(500);
  });
  it('M3.2/collectes_route_recompte_hors_bornes_porte_les_memes_filtres', async () => {
    rls.__suite(
      { data: null, error: { code: 'PGRST103' }, count: null },
      { data: lignes(1), error: null, count: 3 },
    );
    await appel('?page=4&lieu_id=L1&statut=cloturee');

    // Le recompte du cas dégradé doit porter EXACTEMENT les mêmes filtres que la
    // requête fenêtrée. Un recompte nu compterait le parc ENTIER : le total
    // annoncerait des collectes hors du périmètre du gestionnaire — la fuite de
    // volumétrie par comptage que la RLS ferme par ailleurs.
    //
    // Chaque construction rejoue ses `.eq`, donc chaque filtre doit apparaître
    // DEUX fois. Sans cette sonde, un recompte inliné sans filtres passait la CI
    // (trouvé par reviewer-rls-securite) : le code n'était juste que par
    // construction — un seul site de filtrage — et rien ne le tenait.
    const eq = (rls.__calls.eq ?? []).map((a) => `${a[0]}=${a[1]}`);
    expect(eq.filter((f) => f === 'evenements.lieu_id=L1')).toHaveLength(2);
    expect(eq.filter((f) => f === 'statut=cloturee')).toHaveLength(2);

    // Et le recompte lit bien la première ligne, pas la fenêtre refusée.
    const ranges = (rls.__calls.range ?? []).map((r) => `${r[0]}..${r[1]}`);
    expect(ranges).toEqual([`${PAGE_SIZE * 3}..${PAGE_SIZE * 4 - 1}`, '0..0']);
  });
});
