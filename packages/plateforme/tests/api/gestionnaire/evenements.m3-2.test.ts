/**
 * M3.2 — routes Événements du gestionnaire de lieux (§06.05 §2), remises par
 * Val le 2026-10-18 : liste paginée des événements de ses lieux et fiche
 * événement au bilan consolidé sur ses collectes.
 *
 * Les sondes mesurent la REQUÊTE envoyée à PostgREST (filtres, fenêtre) et la
 * forme de la réponse ; le calcul du bilan est testé par
 * `src/lib/evenements-gestionnaire.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown; count?: number | null };

function makeChain() {
  const calls: Record<string, unknown[][]> = {};
  const suite: Result[] = [];
  let result: Result = { data: [], error: null, count: 0 };
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
    'not',
    'or',
    'gte',
    'lte',
    'order',
    'range',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  const suivant = () => (suite.length > 0 ? suite.shift()! : result);
  chain.maybeSingle = () => Promise.resolve(suivant());
  chain.then = (resolve: (r: Result) => unknown) => resolve(suivant());
  return chain as Record<string, unknown> & {
    __calls: Record<string, unknown[][]>;
    __set(r: Result): unknown;
    __suite(...rs: Result[]): unknown;
  };
}

let rls = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
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

import { GET as LISTE } from '@/app/api/v1/gestionnaire/evenements/route.js';
import { GET as FICHE } from '@/app/api/v1/gestionnaire/evenements/[id]/route.js';
import { EVENEMENTS_PAGE_SIZE as PAGE_SIZE } from '@/lib/evenements-gestionnaire.js';
import { logger } from '@savr/shared/src/logger/index.js';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function session(role: string) {
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, organisation_id: 'org-gl' }),
      },
    },
    error: null,
  });
}

// Tous les rôles autres que le gestionnaire de lieux, staff compris.
const AUTRES_ROLES = [
  'admin_savr',
  'ops_savr',
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'client_organisateur',
];
function sansSession() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}

const EVT_ID = '22222222-2222-4222-8222-222222222222';
const LIEU_1 = '11111111-1111-4111-8111-111111111111';

const flux = (code: string, kg: number) => ({
  poids_reel_kg: kg,
  flux_dechets: { code },
});

/** Un événement à deux collectes ZD clôturées et une AG à venir. */
function evenementBrut(over: Record<string, unknown> = {}) {
  return {
    id: EVT_ID,
    nom_evenement: 'Salon Équip’Hôtel',
    date_evenement: '2026-09-10',
    pax: 800,
    nom_client_organisateur: '  ',
    lieux: {
      nom: 'Paris Expo',
      adresse_acces: '1 place de la Porte de Versailles',
      code_postal: '75015',
      ville: 'Paris',
    },
    organisations: { id: 'T1', nom: 'Kaspia', logo_url: 'logos/kaspia.png' },
    types_evenements: { libelle: 'Cocktail repas complet' },
    collectes: [
      {
        id: 'c2',
        type: 'zero_dechet',
        statut: 'cloturee',
        date_collecte: '2026-09-11',
        heure_collecte: '08:00:00',
        taux_recyclage: 20,
        co2_evite_kg: 10,
        co2_net_kg: 5,
        collecte_flux: [flux('verre', 100)],
        attributions_antgaspi: null,
      },
      {
        id: 'c1',
        type: 'zero_dechet',
        statut: 'cloturee',
        date_collecte: '2026-09-10',
        heure_collecte: '23:00:00',
        taux_recyclage: 80,
        co2_evite_kg: 90,
        co2_net_kg: 60,
        collecte_flux: [flux('biodechet', 600), flux('carton', 300)],
        attributions_antgaspi: null,
      },
      {
        id: 'c3',
        type: 'anti_gaspi',
        statut: 'validee',
        date_collecte: '2026-09-12',
        heure_collecte: null,
        taux_recyclage: null,
        co2_evite_kg: null,
        co2_net_kg: null,
        collecte_flux: [],
        attributions_antgaspi: null,
      },
    ],
    ...over,
  };
}

const liste = (qs = '') =>
  LISTE(
    new NextRequest(`http://localhost/api/v1/gestionnaire/evenements${qs}`),
  );
const fiche = (id = EVT_ID) =>
  FICHE(
    new NextRequest(`http://localhost/api/v1/gestionnaire/evenements/${id}`),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  rls = makeChain();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: 42, error: null });
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-gl' } },
    error: null,
  });
  session('gestionnaire_lieux');
});

describe('M3.2 / liste Événements gestionnaire — route', () => {
  it('M3.2/evenements_route_refuse_un_autre_role — tout autre rôle 403, session absente 401, sans aucune lecture', async () => {
    for (const role of AUTRES_ROLES) {
      rls = makeChain();
      session(role);
      const res = await liste();
      expect(res.status, role).toBe(403);
      expect(rls.__calls.from, role).toBeUndefined();
    }
    rls = makeChain();
    sansSession();
    expect((await liste()).status).toBe(401);
    expect(rls.__calls.from).toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M3.2/evenements_route_une_ligne_par_evenement_bilan_cumule', async () => {
    rls.__set({ data: [evenementBrut()], error: null, count: 1 });
    const res = await liste();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Record<string, unknown>[];
      total: number;
    };
    expect(json.total).toBe(1);
    expect(json.data).toEqual([
      {
        id: EVT_ID,
        nom_evenement: 'Salon Équip’Hôtel',
        date_evenement: '2026-09-10',
        pax: 800,
        // Client fait d'espaces = non renseigné.
        client_nom: null,
        lieu_nom: 'Paris Expo',
        lieu_adresse: '1 place de la Porte de Versailles 75015 Paris',
        traiteur_nom: 'Kaspia',
        nb_collectes_zd: 2,
        nb_collectes_ag: 1,
        nb_realisees: 2,
        nb_sans_excedent: 0,
        tonnage_zd_kg: 1000,
        // (80 × 900 + 20 × 100) / 1000 : pondéré par le tonnage.
        taux_recyclage: 74,
        repas_donnes: null,
        co2_evite_kg: 100,
        dechets_labo_kg: 42,
        statut_consolide: 'En cours',
      },
    ]);
    // Repas d'une collecte AG lus par la vue du rôle (une collecte d'un
    // traiteur tiers n'est pas lisible dans la table), traiteur par la vue
    // restreinte.
    const select = String(rls.__calls.select?.[0]?.[0]);
    expect(select).toContain(
      'attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise)',
    );
    expect(select).toContain('v_traiteurs_gestionnaire!');
    // Brouillons écartés, total exact demandé, tri date décroissante + id.
    expect(rls.__calls.not).toEqual([['date_evenement', 'is', null]]);
    expect(rls.__calls.select?.[0]?.[1]).toEqual({ count: 'exact' });
    expect(rls.__calls.order).toEqual([
      ['date_evenement', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(rls.__calls.range?.[0]).toEqual([0, PAGE_SIZE - 1]);
  });

  it('M3.2/evenements_route_filtres_traduits_en_sql', async () => {
    rls.__set({ data: [], error: null, count: 0 });
    await liste(
      `?from=2026-01-01&to=2026-06-30&lieu_ids=${LIEU_1}` +
        '&traiteur_ids=33333333-3333-4333-8333-333333333333' +
        '&type_evenement_ids[]=te1&taille_evenements[]=XS&taille_evenements[]=XL' +
        '&page=3&tri=date&ordre=asc',
    );
    expect(rls.__calls.gte).toEqual([['date_evenement', '2026-01-01']]);
    expect(rls.__calls.lte).toEqual([['date_evenement', '2026-06-30']]);
    expect(rls.__calls.in).toEqual([
      ['lieu_id', [LIEU_1]],
      [
        'traiteur_operationnel_organisation_id',
        ['33333333-3333-4333-8333-333333333333'],
      ],
      ['type_evenement_id', ['te1']],
    ]);
    // Taille : prédicats sur `pax` de l'événement, pax NULL compté XS.
    expect(rls.__calls.or).toEqual([['pax.is.null,pax.lt.250,pax.gte.1000']]);
    expect(rls.__calls.range?.[0]).toEqual([2 * PAGE_SIZE, 3 * PAGE_SIZE - 1]);
    expect(rls.__calls.order?.[0]).toEqual([
      'date_evenement',
      { ascending: true },
    ]);
    // Sans type de collecte, pas de second embed.
    expect(String(rls.__calls.select?.[0]?.[0])).not.toContain('filtre_type');
  });

  it('M3.2/evenements_route_type_collecte_par_second_embed', async () => {
    rls.__set({ data: [evenementBrut()], error: null, count: 1 });
    const res = await liste('?type=anti_gaspi');
    const select = String(rls.__calls.select?.[0]?.[0]);
    // Le premier embed garde toutes les collectes (le bilan reste celui de
    // l'événement entier) ; le second, `!inner`, ne sert qu'au filtre.
    expect(select).toContain('filtre_type:collectes!inner(id)');
    expect(rls.__calls.eq).toEqual([['filtre_type.type', 'anti_gaspi']]);
    const json = (await res.json()) as {
      data: { nb_collectes_zd: number }[];
    };
    expect(json.data[0]?.nb_collectes_zd).toBe(2);
  });

  it('M3.2/evenements_route_filtre_illisible_liste_vide', async () => {
    for (const qs of [
      '?type=inconnu',
      '?taille_evenements[]=XXL',
      '?lieu_ids=pas-un-uuid',
    ]) {
      rls = makeChain();
      const res = await liste(qs);
      expect(await res.json()).toEqual({ data: [], total: 0, page: 1 });
      expect(rls.__calls.from).toBeUndefined();
    }
  });

  it('M3.2/evenements_route_dechets_labo_zd_seulement', async () => {
    rls.__set({
      data: [
        evenementBrut(),
        evenementBrut({
          id: 'evt-ag',
          collectes: [evenementBrut().collectes[2]],
        }),
      ],
      error: null,
      count: 2,
    });
    const res = await liste();
    const json = (await res.json()) as {
      data: { id: string; dechets_labo_kg: number | null }[];
    };
    // L'événement aux seules collectes AG n'a pas d'estimation, et la fonction
    // n'est pas appelée pour lui.
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('f_dechets_labo_estimes', {
      p_evenement_id: EVT_ID,
    });
    expect(json.data.map((e) => e.dechets_labo_kg)).toEqual([42, null]);
  });

  it('M3.2/evenements_route_dechets_labo_echec_ne_fait_pas_tomber_la_liste', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    const warn = vi.spyOn(logger, 'warn');
    rls.__set({ data: [evenementBrut()], error: null, count: 1 });
    const res = await liste();
    expect(res.status).toBe(200);
    // L'échec est journalisé : sans trace, une panne se lirait « non
    // communiqué ».
    expect(warn).toHaveBeenCalledWith(
      'gestionnaire.evenements.dechets_labo_echec',
      { evenement_id: EVT_ID, code: '42501' },
    );
    warn.mockRestore();
    const json = (await res.json()) as {
      data: { dechets_labo_kg: number | null }[];
    };
    expect(json.data[0]?.dechets_labo_kg).toBeNull();
  });

  it('M3.2/evenements_route_page_au_dela_de_la_derniere', async () => {
    rls.__suite(
      { data: null, error: { code: 'PGRST103' }, count: null },
      { data: [evenementBrut()], error: null, count: 7 },
    );
    const res = await liste('?page=9');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], total: 7, page: 9 });
  });

  it('M3.2/evenements_route_erreur_base_500', async () => {
    rls.__set({ data: null, error: { code: '42P01', message: 'x' } });
    const res = await liste();
    expect(res.status).toBe(500);
  });
});

describe('M3.2 / fiche Événement gestionnaire — route', () => {
  it('M3.2/evenement_fiche_refuse_un_autre_role — tout autre rôle 403, session absente 401, sans aucune lecture', async () => {
    for (const role of AUTRES_ROLES) {
      rls = makeChain();
      session(role);
      const res = await fiche();
      expect(res.status, role).toBe(403);
      expect(rls.__calls.from, role).toBeUndefined();
    }
    rls = makeChain();
    sansSession();
    expect((await fiche()).status).toBe(401);
    expect(rls.__calls.from).toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M3.2/evenement_fiche_404_hors_perimetre_ou_identifiant_invalide', async () => {
    const invalide = await fiche('pas-un-uuid');
    expect(invalide.status).toBe(404);
    expect(rls.__calls.from).toBeUndefined();

    // Hors périmètre RLS (ou brouillon) : PostgREST ne rend rien.
    rls.__set({ data: null, error: null });
    const absent = await fiche();
    expect(absent.status).toBe(404);
    expect(rls.__calls.not).toEqual([['date_evenement', 'is', null]]);
  });

  it('M3.2/evenement_fiche_bilan_consolide_et_collectes_triees', async () => {
    rls.__set({ data: evenementBrut(), error: null });
    const res = await fiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        traiteur: unknown;
        client_nom: string | null;
        type_evenement: string | null;
        dechets_labo_kg: number | null;
        bilan: Record<string, unknown>;
        collectes: Record<string, unknown>[];
      };
    };
    // Le logo est une clé R2 : il ne sort pas, seul son existence est dite.
    expect(data.traiteur).toEqual({ id: 'T1', nom: 'Kaspia', a_logo: true });
    expect(JSON.stringify(data)).not.toContain('logos/kaspia.png');
    expect(data.type_evenement).toBe('Cocktail repas complet');
    expect(data.client_nom).toBeNull();
    expect(data.dechets_labo_kg).toBe(42);
    expect(data.bilan).toMatchObject({
      nb_collectes_zd: 2,
      nb_collectes_ag: 1,
      nb_realisees_zd: 2,
      nb_realisees_ag: 0,
      tonnage_zd_kg: 1000,
      taux_recyclage: 74,
      co2_net_zd_kg: 65,
      flux_kg: { biodechet: 600, carton: 300, verre: 100 },
      repas_donnes: null,
      premiere_collecte: '2026-09-10',
      derniere_collecte: '2026-09-12',
      statut_consolide: 'En cours',
    });
    // Collectes dans l'ordre chronologique, résultats seulement une fois
    // réalisées (comme la colonne « Résultats » de la liste Collectes).
    expect(data.collectes).toEqual([
      {
        id: 'c1',
        type: 'zero_dechet',
        statut: 'cloturee',
        date_collecte: '2026-09-10',
        heure_collecte: '23:00:00',
        poids_total_kg: 900,
        taux_recyclage: 80,
        co2_evite_kg: 90,
        nb_repas_donnes: null,
      },
      {
        id: 'c2',
        type: 'zero_dechet',
        statut: 'cloturee',
        date_collecte: '2026-09-11',
        heure_collecte: '08:00:00',
        poids_total_kg: 100,
        taux_recyclage: 20,
        co2_evite_kg: 10,
        nb_repas_donnes: null,
      },
      {
        id: 'c3',
        type: 'anti_gaspi',
        statut: 'validee',
        date_collecte: '2026-09-12',
        heure_collecte: null,
        poids_total_kg: null,
        taux_recyclage: null,
        co2_evite_kg: null,
        nb_repas_donnes: null,
      },
    ]);
    // Repas et association lus par la vue du rôle, jamais la table.
    const select = String(rls.__calls.select?.[0]?.[0]);
    expect(select).toContain(
      'attributions_antgaspi:v_attributions_gestionnaire(',
    );
    expect(select).toContain('association_id');
    expect(select).toContain('v_traiteurs_gestionnaire!');
  });

  it('M3.2/evenement_fiche_resultats_vides_avant_realisation — valeurs déjà reçues mais non affichables : null', async () => {
    const [c2, , c3] = evenementBrut().collectes;
    rls.__set({
      data: evenementBrut({
        collectes: [
          // Pesées et valeurs déjà présentes sur une collecte `realisee` (embargo
          // non levé) et sur une AG validée : rien ne sort avant la clôture.
          { ...c2, statut: 'realisee' },
          {
            ...c3,
            co2_evite_kg: 25,
            attributions_antgaspi: {
              volume_repas_realise: 10,
              association_id: 'a1',
              association_nom: 'Linkee',
              association_ville: null,
            },
          },
        ],
      }),
      error: null,
    });
    const { data } = (await (await fiche()).json()) as {
      data: { collectes: Record<string, unknown>[] };
    };
    for (const c of data.collectes) {
      expect(c).toMatchObject({
        poids_total_kg: null,
        taux_recyclage: null,
        co2_evite_kg: null,
        nb_repas_donnes: null,
      });
    }
  });

  it('M3.2/evenement_fiche_collectes_meme_jour_par_heure — à date égale, l’heure départage', async () => {
    // Identifiants dans l'ordre inverse de l'heure : sans le départage par heure,
    // le départage par identifiant mettrait le soir en premier.
    const [c2, c1] = evenementBrut().collectes;
    rls.__set({
      data: evenementBrut({
        collectes: [
          { ...c1, id: 'a-soir', heure_collecte: '23:00:00' },
          {
            ...c2,
            id: 'z-matin',
            date_collecte: '2026-09-10',
            heure_collecte: '07:00:00',
          },
        ],
      }),
      error: null,
    });
    const { data } = (await (await fiche()).json()) as {
      data: { collectes: { id: string }[] };
    };
    expect(data.collectes.map((c) => c.id)).toEqual(['z-matin', 'a-soir']);
  });

  it('M3.2/evenement_fiche_sans_zd_pas_d_estimation_labo', async () => {
    rls.__set({
      data: evenementBrut({ collectes: [evenementBrut().collectes[2]] }),
      error: null,
    });
    const res = await fiche();
    const { data } = (await res.json()) as {
      data: { dechets_labo_kg: number | null };
    };
    expect(mockRpc).not.toHaveBeenCalled();
    expect(data.dechets_labo_kg).toBeNull();
  });
});
