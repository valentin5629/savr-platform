/**
 * M3.2 — Pagination serveur de la liste Collectes gestionnaire (§06.05).
 *
 * Défaut d'origine (revue d'écran E2E 2026-09-22) : la route terminait sur
 * `.limit(100)` et renvoyait `{ data }` sans total. Un parc de plus de 100
 * collectes recevait donc une liste d'apparence complète qui ne l'était pas,
 * sans rien à l'écran pour le signaler. Le §06.05 l.209 veut cette liste LARGE
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
    'in',
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
// `f_dechets_labo_estimes`, appelée par événement de la page (colonne « Déchets
// labo est. »). Par défaut : coefficient non communiqué.
const mockRpc = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

import { GET } from '@/app/api/v1/gestionnaire/collectes/route.js';
import { COLLECTES_PAGE_SIZE as PAGE_SIZE } from '@/lib/collectes-gestionnaire.js';
import { logger } from '@savr/shared/src/logger/index.js';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

// Identifiants de lieu : la route n'en retient que des UUID.
const LIEU_1 = '11111111-1111-4111-8111-111111111111';
const LIEU_2 = '33333333-3333-4333-8333-333333333333';
/** Filtres `.in()` enregistrés, sous la forme `colonne=v1|v2`. */
const filtresIn = () =>
  (rls.__calls.in ?? []).map((a) => `${a[0]}=${(a[1] as string[]).join('|')}`);

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
      // Champ facultatif, texte libre : renseigné sur la 1re ligne, absent sur
      // la 2e, fait d'espaces sur la 3e.
      nom_client_organisateur: ['Maison Lenôtre', null, '   '][i] ?? null,
      lieu_id: LIEU_1,
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
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: null, error: null });
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

  it('M3.2/collectes_route_renvoie_le_client_organisateur', async () => {
    rls.__set({ data: lignes(3), error: null, count: 3 });
    const res = await appel();
    const json = (await res.json()) as {
      data: { client_nom: string | null }[];
    };

    // La colonne est demandée à PostgREST (sans elle, la colonne « Client » de
    // l'écran resterait vide sans erreur) et aplatie sur chaque ligne. Une
    // saisie faite d'espaces vaut « non renseigné » (l'écran affiche « — »).
    expect(String(rls.__calls.select?.[0]?.[0])).toContain(
      'nom_client_organisateur',
    );
    expect(json.data.map((c) => c.client_nom)).toEqual([
      'Maison Lenôtre',
      null,
      null,
    ]);
  });

  it('M3.2/collectes_route_colonnes_liste_traiteur — traiteur, pax, adresse et résultats aplatis, embeds bruts retirés', async () => {
    const base = lignes(1)[0]!;
    rls.__set({
      data: [
        // ZD réalisée : poids = Σ des flux (un flux sans pesée compte 0).
        {
          ...base,
          id: 'zd',
          taux_recyclage: 87,
          co2_evite_kg: 96,
          collecte_flux: [
            { poids_reel_kg: 300 },
            { poids_reel_kg: 112.5 },
            { poids_reel_kg: null },
          ],
          attributions_antgaspi: null,
          evenements: {
            ...base.evenements,
            pax: 500,
            lieux: {
              nom: 'Musée des Arts Forains',
              adresse_acces: '53 Avenue des Terroirs de France',
              code_postal: '75012',
              ville: 'Paris',
            },
            // to-one PostgREST rendu en tableau : même lecture que l'objet.
            organisations: [{ nom: 'Fleurdemets' }],
          },
        },
        // AG programmée par le gestionnaire : volume de l'attribution, rendu
        // par la vue v_attributions_gestionnaire sous l'alias de l'embed.
        {
          ...base,
          id: 'ag-propre',
          type: 'anti_gaspi',
          collecte_flux: [],
          attributions_antgaspi: { volume_repas_realise: 180 },
        },
        // AG d'un traiteur tiers : même chemin — la vue rend le volume que la
        // table lui refuse (aa_select, C-1).
        {
          ...base,
          id: 'ag-tiers',
          type: 'anti_gaspi',
          collecte_flux: [],
          attributions_antgaspi: { volume_repas_realise: 152 },
        },
        // AG sans attribution : non renseigné, pas 0 (to-one rendu en tableau
        // vide : même lecture).
        {
          ...base,
          id: 'ag-rien',
          type: 'anti_gaspi',
          collecte_flux: null,
          attributions_antgaspi: [],
        },
        // Volume à 0 repas : c'est une valeur (un `||` la perdrait).
        {
          ...base,
          id: 'ag-zero',
          type: 'anti_gaspi',
          collecte_flux: [],
          attributions_antgaspi: { volume_repas_realise: 0 },
        },
        // Volume non saisi : non renseigné.
        {
          ...base,
          id: 'ag-volume-null',
          type: 'anti_gaspi',
          collecte_flux: [],
          attributions_antgaspi: { volume_repas_realise: null },
        },
      ],
      error: null,
      count: 6,
    });
    const res = await appel();
    const { data } = (await res.json()) as {
      data: Record<string, unknown>[];
    };

    // Ce que l'écran affiche est demandé à PostgREST — le traiteur par la vue
    // restreinte du rôle (nom seul), jamais par `organisations`.
    const select = String(rls.__calls.select?.[0]?.[0]);
    for (const attendu of [
      'pax',
      'lieux!lieu_id(nom, adresse_acces, code_postal, ville)',
      'organisations:v_traiteurs_gestionnaire!traiteur_operationnel_organisation_id(nom)',
      'collecte_flux(poids_reel_kg)',
      'attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise)',
    ])
      expect(select).toContain(attendu);
    // Ni la table (refusée sur un traiteur tiers), ni le repli attestation (D13).
    expect(select).not.toMatch(/attributions_antgaspi\s*\(/);
    expect(select).not.toContain('attestations_don');

    expect(data[0]).toMatchObject({
      id: 'zd',
      traiteur_nom: 'Fleurdemets',
      pax: 500,
      lieu_nom: 'Musée des Arts Forains',
      lieu_adresse: '53 Avenue des Terroirs de France 75012 Paris',
      poids_total_kg: 412.5,
      taux_recyclage: 87,
      co2_evite_kg: 96,
      nb_repas_donnes: null,
    });
    expect(data.map((c) => c.nb_repas_donnes)).toEqual([
      null,
      180,
      152,
      null,
      0,
      null,
    ]);
    // Lignes sans traiteur nommé ni pax (fixture de base) : null, pas d'erreur.
    expect(data[1]).toMatchObject({
      traiteur_nom: null,
      pax: null,
      lieu_adresse: null,
      poids_total_kg: 0,
    });
    // Les embeds bruts ne sortent pas de la route.
    for (const c of data)
      for (const brut of [
        'evenements',
        'collecte_flux',
        'attributions_antgaspi',
      ])
        expect(c).not.toHaveProperty(brut);
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
    const res = await appel(`?lieu_id=${LIEU_1}&statut=cloturee&page=1`);
    const json = (await res.json()) as { total: number };

    // Le drill-down filtre : le total doit être celui du PÉRIMÈTRE FILTRÉ, sinon
    // le compteur annoncerait des collectes que la liste ne contient pas.
    expect(json.total).toBe(3);
    const eq = (rls.__calls.eq ?? []).map((a) => `${a[0]}=${a[1]}`);
    expect(filtresIn()).toContain(`evenements.lieu_id=${LIEU_1}`);
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
    await appel(`?page=4&lieu_ids=${LIEU_1},${LIEU_2}&statut=cloturee`);

    // Le recompte du cas dégradé doit porter EXACTEMENT les mêmes filtres que la
    // requête fenêtrée. Un recompte nu compterait le parc ENTIER : le total
    // annoncerait des collectes hors du périmètre du gestionnaire — la fuite de
    // volumétrie par comptage que la RLS ferme par ailleurs.
    //
    // Chaque construction rejoue ses filtres, donc chacun doit apparaître DEUX
    // fois. Sans cette sonde, un recompte inliné sans filtres passait la CI
    // (trouvé par reviewer-rls-securite) : le code n'était juste que par
    // construction — un seul site de filtrage — et rien ne le tenait.
    const eq = (rls.__calls.eq ?? []).map((a) => `${a[0]}=${a[1]}`);
    expect(
      filtresIn().filter((f) => f === `evenements.lieu_id=${LIEU_1}|${LIEU_2}`),
    ).toHaveLength(2);
    expect(eq.filter((f) => f === 'statut=cloturee')).toHaveLength(2);

    // Et le recompte lit bien la première ligne, pas la fenêtre refusée.
    const ranges = (rls.__calls.range ?? []).map((r) => `${r[0]}..${r[1]}`);
    expect(ranges).toEqual([`${PAGE_SIZE * 3}..${PAGE_SIZE * 4 - 1}`, '0..0']);
  });
});

// Colonne « Déchets labo est. » de la liste (décision Val 2026-10-07, §05
// R_dechets_labo_estimes). L'estimation est celle de l'ÉVÉNEMENT (couverts ×
// coefficient annuel du traiteur) : la route la demande à la fonction
// `f_dechets_labo_estimes`, qui ne rend que des kg.
describe('M3.2 / liste Collectes gestionnaire — déchets labo estimés', () => {
  /** Estimation rendue par événement ; absent de la table = non communiqué. */
  function estimations(parEvenement: Record<string, number | null>) {
    mockRpc.mockImplementation(
      (_fn: string, args: { p_evenement_id: string }) =>
        Promise.resolve({
          data: parEvenement[args.p_evenement_id] ?? null,
          error: null,
        }),
    );
  }
  const appelsRpc = () =>
    mockRpc.mock.calls.map(
      (a) => `${a[0]}(${(a[1] as { p_evenement_id: string }).p_evenement_id})`,
    );

  it('M3.2/collectes_route_dechets_labo_par_evenement — une estimation par événement, partagée par ses collectes', async () => {
    const base = lignes(3);
    const zd = base[0]!;
    const autre = base[1]!;
    const zero = base[2]!;
    rls.__set({
      data: [
        zd,
        // Collecte AG du MÊME événement que la ZD ci-dessus.
        { ...zd, id: 'ag-e0', type: 'anti_gaspi' },
        autre,
        zero,
      ],
      error: null,
      count: 4,
    });
    // e0 : estimation ; e1 : coefficient non communiqué ; e2 : déclaré à zéro.
    estimations({ e0: 95.76, e2: 0 });
    const res = await appel();
    const corps = await res.text();
    const { data } = JSON.parse(corps) as {
      data: { id: string; dechets_labo_kg: number | null }[];
    };

    // Confidentialité (§05 R_dechets_labo_estimes) : la route ne lit QUE
    // `collectes` — jamais la table des coefficients, que la RLS lui refuse de
    // toute façon — et rien dans la réponse ne porte un coefficient.
    expect((rls.__calls.from ?? []).map((a) => a[0])).toEqual(['collectes']);
    expect(corps).not.toMatch(/coefficient/i);

    // Un appel par événement DISTINCT de la page : l'événement aux deux
    // collectes n'est calculé qu'une fois, et seuls les événements que la
    // requête vient de rendre sont demandés.
    expect(appelsRpc()).toEqual([
      'f_dechets_labo_estimes(e0)',
      'f_dechets_labo_estimes(e1)',
      'f_dechets_labo_estimes(e2)',
    ]);
    // Les deux collectes de e0 portent la même valeur ; « non communiqué »
    // reste null (l'écran affiche « — ») et ne se confond pas avec le zéro
    // déclaré, qui est une valeur.
    expect(data.map((c) => [c.id, c.dechets_labo_kg])).toEqual([
      ['c0', 95.76],
      ['ag-e0', 95.76],
      ['c1', null],
      ['c2', 0],
    ]);
  });

  it('M3.2/collectes_route_dechets_labo_echec_ne_fait_pas_tomber_la_liste', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    rls.__set({ data: lignes(2), error: null, count: 2 });
    mockRpc.mockImplementation(
      (_fn: string, args: { p_evenement_id: string }) =>
        Promise.resolve(
          args.p_evenement_id === 'e0'
            ? { data: null, error: { code: '57014', message: 'timeout' } }
            : { data: 12.5, error: null },
        ),
    );
    const res = await appel();
    const json = (await res.json()) as {
      data: { dechets_labo_kg: number | null }[];
      total: number;
    };

    // L'estimation est un complément : son échec ne prive pas le gestionnaire
    // de sa liste, et n'efface pas l'estimation des autres événements.
    expect(res.status).toBe(200);
    expect(json.total).toBe(2);
    expect(json.data.map((c) => c.dechets_labo_kg)).toEqual([null, 12.5]);
    // Mais l'échec est tracé : à l'écran il se lit « — », comme un coefficient
    // non communiqué, et sans cette ligne rien ne distinguerait la panne.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'gestionnaire.collectes.dechets_labo_echec',
      { evenement_id: 'e0', code: '57014' },
    );
    warn.mockRestore();
  });

  it('M3.2/collectes_route_dechets_labo_aucun_appel_sans_ligne', async () => {
    // Page vide, puis page au-delà de la dernière (PostgREST 416) : aucune
    // ligne à compléter, donc aucun appel à la fonction.
    rls.__set({ data: [], error: null, count: 0 });
    await appel();
    rls = makeChain();
    rls.__suite(
      { data: null, error: { code: 'PGRST103' }, count: null },
      { data: lignes(1), error: null, count: 120 },
    );
    await appel('?page=4');

    expect(mockRpc).not.toHaveBeenCalled();
  });
});
