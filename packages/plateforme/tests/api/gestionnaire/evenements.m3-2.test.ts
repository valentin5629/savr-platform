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
    'neq',
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
// Fiche de chaque collecte (onglets de la fiche événement, Val 2026-10-26) : le
// chargeur commun de la fiche collecte, testé avec sa route.
const mockCharger = vi.fn();
vi.mock('@/lib/collectes/fiche-client.js', () => ({
  chargerFicheCollecteClient: (...a: unknown[]) => mockCharger(...a),
}));

import { GET as LISTE } from '@/app/api/v1/evenements/route.js';
import { GET as FICHE } from '@/app/api/v1/evenements/[id]/route.js';
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

// Fiche Événement ouverte à tous les rôles (Val 2026-10-29) : seul un rôle
// hors de l'application est refusé.
const AUTRES_ROLES = ['inconnu'];
function sansSession() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}

const EVT_ID = '22222222-2222-4222-8222-222222222222';
const LIEU_1 = '11111111-1111-4111-8111-111111111111';
/** Type d'événement (UUID : la route écarte les identifiants mal formés, lot C1). */
const TE1 = '7e000000-0000-4000-8000-0000000000e1';

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
      acces_details: ' Quai 3, badge à l’accueil ',
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
        collecte_flux: [],
        attributions_antgaspi: null,
      },
    ],
    ...over,
  };
}

const liste = (qs = '') =>
  LISTE(new NextRequest(`http://localhost/api/v1/evenements${qs}`));
const fiche = (id = EVT_ID) =>
  FICHE(new NextRequest(`http://localhost/api/v1/evenements/${id}`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  rls = makeChain();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: 42, error: null });
  mockCharger.mockReset();
  mockCharger.mockImplementation((id: string) =>
    Promise.resolve({ fiche: { id } }),
  );
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-gl' } },
    error: null,
  });
  session('gestionnaire_lieux');
});

describe('M3.2 / liste Événements gestionnaire — route', () => {
  // Depuis le 2026-10-29 (décision Val), la liste est commune à tous les rôles
  // (route /api/v1/evenements) : le périmètre de chacun est couvert par
  // tests/api/evenements/liste-evenements-roles.test.ts. Reste refusé ce qui
  // n'est pas un rôle de l'application.
  it('M3.2/evenements_route_refuse_hors_role — rôle inconnu 403, session absente 401, sans aucune lecture', async () => {
    rls = makeChain();
    session('inconnu');
    expect((await liste()).status).toBe(403);
    expect(rls.__calls.from).toBeUndefined();
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
    // Brouillons écartés (cf. evenements_route_brouillons_ecartes), total exact
    // demandé, tri date décroissante + id.
    expect(rls.__calls.not).toEqual([['date_evenement', 'is', null]]);
    expect(rls.__calls.or).toEqual([
      ['hors_brouillon.not.is.null,collectes.is.null'],
    ]);
    expect(rls.__calls.select?.[0]?.[1]).toEqual({ count: 'exact' });
    expect(rls.__calls.order).toEqual([
      ['date_evenement', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(rls.__calls.range?.[0]).toEqual([0, PAGE_SIZE - 1]);
  });

  it('M3.2/evenements_route_brouillons_ecartes — un brouillon a une date : écarté parce que ses collectes sont toutes des brouillons, pas par sa date', async () => {
    rls.__set({ data: [], error: null, count: 0 });
    await liste();
    // Embed dédié, filtré sur les collectes hors brouillon ; l'événement passe
    // s'il en garde une, ou s'il n'a aucune collecte. Le premier embed
    // `collectes(...)` reste entier : le bilan est celui de l'événement.
    const select = String(rls.__calls.select?.[0]?.[0]);
    expect(select).toContain('hors_brouillon:collectes(id)');
    expect(rls.__calls.neq).toEqual([['hors_brouillon.statut', 'brouillon']]);
    expect(rls.__calls.or?.[0]).toEqual([
      'hors_brouillon.not.is.null,collectes.is.null',
    ]);
  });

  it('M3.2/evenements_route_filtres_traduits_en_sql', async () => {
    rls.__set({ data: [], error: null, count: 0 });
    await liste(
      `?from=2026-01-01&to=2026-06-30&lieu_ids=${LIEU_1}` +
        '&traiteur_ids=33333333-3333-4333-8333-333333333333' +
        `&type_evenement_ids[]=${TE1}&taille_evenements[]=XS&taille_evenements[]=XL` +
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
      // Type : celui des COLLECTES de l'événement, par un embed `!inner` dédié
      // (C3 du 2026-10-22, lot C1) — jamais la copie de l'événement.
      ['filtre_type_evt.type_evenement_id', [TE1]],
    ]);
    expect(String(rls.__calls.select?.[0]?.[0])).toContain(
      'filtre_type_evt:collectes!inner(id)',
    );
    // Taille : prédicats sur `pax` de l'événement (C4), pax NULL compté XS. Le
    // premier `or` est celui qui écarte les brouillons : les deux paramètres
    // `or` se cumulent (ET), mesuré contre PostgREST v14 le 2026-10-24.
    expect(rls.__calls.or).toEqual([
      ['hors_brouillon.not.is.null,collectes.is.null'],
      ['pax.is.null,pax.lt.250,pax.gte.1000'],
    ]);
    expect(rls.__calls.range?.[0]).toEqual([2 * PAGE_SIZE, 3 * PAGE_SIZE - 1]);
    expect(rls.__calls.order?.[0]).toEqual([
      'date_evenement',
      { ascending: true },
    ]);
    // Sans type de collecte, pas d'embed du filtre ZD/AG.
    expect(String(rls.__calls.select?.[0]?.[0])).not.toContain(
      'filtre_type:collectes',
    );
  });

  it('M3.2/evenements_route_zd_et_type_deux_conditions_separees — « ZD » + un type : une collecte ZD ET une collecte de ce type, pas forcément la même (Q1 Val 2026-10-24)', async () => {
    rls.__set({ data: [], error: null, count: 0 });
    await liste(`?type=zero_dechet&type_evenement_ids[]=${TE1}`);
    const select = String(rls.__calls.select?.[0]?.[0]);
    // Deux embeds `!inner` distincts : chacun retient l'événement sur sa propre
    // collecte. Un seul embed filtré deux fois exigerait la même collecte.
    expect(select).toContain('filtre_type:collectes!inner(id)');
    expect(select).toContain('filtre_type_evt:collectes!inner(id)');
    expect(rls.__calls.eq).toEqual([['filtre_type.type', 'zero_dechet']]);
    expect(rls.__calls.in).toEqual([
      ['filtre_type_evt.type_evenement_id', [TE1]],
    ]);
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
    expect(warn).toHaveBeenCalledWith('evenements.liste.dechets_labo_echec', {
      evenement_id: EVT_ID,
      code: '42501',
    });
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
  it('M3.2/evenement_fiche_refuse_un_autre_role — rôle hors application 403, session absente 401, sans aucune lecture', async () => {
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

  it('M3.2/evenement_fiche_brouillon_404 — même filtre que la liste : un événement aux collectes toutes brouillons n’est pas rendu', async () => {
    rls.__set({ data: null, error: null });
    const res = await fiche();
    expect(res.status).toBe(404);
    expect(String(rls.__calls.select?.[0]?.[0])).toContain(
      'hors_brouillon:collectes(id)',
    );
    expect(rls.__calls.neq).toEqual([['hors_brouillon.statut', 'brouillon']]);
    expect(rls.__calls.or).toEqual([
      ['hors_brouillon.not.is.null,collectes.is.null'],
    ]);
  });

  it('M3.2/evenement_fiche_types_de_ses_collectes — « Type d’événement » : types de ses collectes, ordre de la collecte n°1, sans doublon ni collecte annulée (lot C1, Q2)', async () => {
    const brut = evenementBrut();
    const avecType = (c: Record<string, unknown>, libelle: string) => ({
      ...c,
      created_at: '2026-09-01T00:00:00Z',
      type_evenement: { libelle },
    });
    const [c2, c1, c3] = brut.collectes as Record<string, unknown>[];
    rls.__set({
      data: {
        ...brut,
        collectes: [
          avecType(c2!, 'Repas assis'),
          avecType(c1!, 'Cocktail apéritif'),
          avecType(c3!, 'Cocktail apéritif'),
          avecType(
            {
              ...c3!,
              id: 'c4',
              type: 'zero_dechet',
              statut: 'annulee',
              date_collecte: '2026-09-01',
            },
            'Autre',
          ),
        ],
      },
      error: null,
    });
    const res = await fiche();
    const { data } = (await res.json()) as {
      data: { type_evenement: string | null };
    };
    // c1 (ZD, 10/09) est la collecte n°1, puis c2 (ZD, 11/09) ; l'AG c3 répète
    // un type déjà nommé ; c4, annulée, n'en apporte aucun.
    expect(data.type_evenement).toBe('Cocktail apéritif, Repas assis');
    const select = String(rls.__calls.select?.[0]?.[0]);
    expect(select).toContain(
      'type_evenement:types_evenements!type_evenement_id(libelle)',
    );
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
        fiches: { id: string }[];
        lieu_acces_details: string | null;
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
      co2_evite_zd_kg: 100,
      flux_kg: { biodechet: 600, carton: 300, verre: 100 },
      repas_donnes: null,
      premiere_collecte: '2026-09-10',
      derniere_collecte: '2026-09-12',
      statut_consolide: 'En cours',
    });
    // Une fiche par collecte, dans l'ordre chronologique, chargée par le
    // chargeur de la fiche collecte sous la session et l'espace du rôle : mêmes
    // règles de visibilité (contacts, référence interne).
    expect(data.fiches.map((f) => f.id)).toEqual(['c1', 'c2', 'c3']);
    for (const appel of mockCharger.mock.calls) {
      expect(appel[1]).toMatchObject({ organisationId: 'org-gl' });
      expect(appel[2]).toBe('gestionnaire');
    }
    expect(data.lieu_acces_details).toBe('Quai 3, badge à l’accueil');
    expect(String(rls.__calls.select?.[0]?.[0])).toContain(
      'lieux!lieu_id(nom, adresse_acces, code_postal, ville, acces_details)',
    );
    // Repas et association lus par la vue du rôle, jamais la table.
    const select = String(rls.__calls.select?.[0]?.[0]);
    expect(select).toContain(
      'attributions_antgaspi:v_attributions_gestionnaire(',
    );
    expect(select).toContain('association_id');
    expect(select).toContain('v_traiteurs_gestionnaire!');
  });

  it('M3.2/evenement_fiche_echec_d_une_fiche_500 — une collecte illisible fait échouer la fiche, jamais une fiche à trous', async () => {
    rls.__set({ data: evenementBrut(), error: null });
    mockCharger.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'c2' ? { erreur: { code: 'XX000' } } : { fiche: { id } },
      ),
    );
    expect((await fiche()).status).toBe(500);
  });

  it('M3.2/evenement_fiche_collecte_introuvable_500 — une collecte disparue entre les deux lectures : 500, jamais N−1 cartes sur un bilan de N', async () => {
    rls.__set({ data: evenementBrut(), error: null });
    mockCharger.mockImplementation((id: string) =>
      Promise.resolve(id === 'c3' ? { introuvable: true } : { fiche: { id } }),
    );
    expect((await fiche()).status).toBe(500);
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
      data: { fiches: { id: string }[] };
    };
    expect(data.fiches.map((c) => c.id)).toEqual(['z-matin', 'a-soir']);
  });

  it('M3.2/evenement_fiche_traiteur_agence_chemins_du_role — fiche collecte de leur espace, attributions par la table, nom du traiteur par le référentiel, ni logo ni déchets labo (Val 2026-10-29)', async () => {
    for (const [role, espace] of [
      ['traiteur_manager', 'traiteur'],
      ['traiteur_commercial', 'traiteur'],
      ['agence', 'agence'],
    ] as const) {
      rls = makeChain();
      rls.__suite(
        {
          data: {
            ...evenementBrut(),
            organisations: undefined,
            traiteur_operationnel_organisation_id: 'T1',
          },
          error: null,
        },
        { data: { id: 'T1', nom: 'Kaspia' }, error: null },
      );
      mockRpc.mockClear();
      mockCharger.mockClear();
      session(role);
      const res = await fiche();
      expect(res.status, role).toBe(200);
      const { data } = (await res.json()) as {
        data: { traiteur: unknown; dechets_labo_kg: number | null };
      };
      expect(data.traiteur, role).toEqual({
        id: 'T1',
        nom: 'Kaspia',
        a_logo: false,
      });
      expect(data.dechets_labo_kg, role).toBeNull();
      expect(mockRpc, role).not.toHaveBeenCalledWith(
        'f_dechets_labo_estimes',
        expect.anything(),
      );
      for (const appel of mockCharger.mock.calls)
        expect(appel[2], role).toBe(espace);
      const select = String(rls.__calls.select?.[0]?.[0]);
      expect(select, role).not.toContain('_gestionnaire');
      expect(select, role).toContain(
        'attributions_antgaspi(volume_repas_realise',
      );
      expect(
        rls.__calls.from?.map((a) => a[0]),
        role,
      ).toContain('v_referentiel_traiteurs');
    }
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

// « Ajouter une collecte » depuis la fiche événement (§06.01, décision Val
// 2026-10-21) : la route dit si l'action est permise, l'écran ne la devine pas.
// Lot 3 du pax porté par la collecte, décision Val Q4 du 2026-10-25 : la liste et
// la fiche Événements gardent le pax CALCULÉ de l'événement (par jour le plus grand
// des totaux ZD et AG, puis somme des jours) et sa taille — pas la somme des pax
// de ses collectes.
describe('Lot 3 / Événements gestionnaire — pax et taille de l’événement (Q4)', () => {
  it('Lot3/evenement_fiche_pax_et_taille_de_l_evenement — 800 convives calculés, taille L, même si ses collectes en portent 300 et 200', async () => {
    const brut = evenementBrut();
    brut.collectes = brut.collectes.map((c, i) => ({
      ...c,
      pax: i === 0 ? 300 : 200,
    }));
    rls.__set({ data: brut, error: null });
    const res = await fiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { pax: number; taille_bracket: string };
    };
    expect(data.pax).toBe(800);
    expect(data.taille_bracket).toBe('L');
  });
});

describe('M1.2 — ajouter une collecte depuis la fiche événement du gestionnaire (route)', () => {
  it('M1.2/ajout_collecte_fiche_evenement_programme_par_soi — événement programmé par son organisation : ajout permis, même collectes terminées', async () => {
    rls.__set({
      data: evenementBrut({ organisation_id: 'org-gl' }),
      error: null,
    });
    const res = await fiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { ajouter_collecte: boolean };
    };
    // Deux collectes clôturées sur trois : l'ajout reste ouvert.
    expect(data.ajouter_collecte).toBe(true);
    // La colonne de l'événement, pas la clé du traiteur opérationnel
    // (`…!traiteur_operationnel_organisation_id(`), qui la contient.
    expect(String(rls.__calls.select?.[0]?.[0])).toMatch(
      /(?:^|,)\s*organisation_id\s*,/,
    );
  });

  it('M1.2/ajout_collecte_fiche_evenement_traiteur_tiers — événement d’un traiteur tiers sur ses lieux : pas d’ajout, ni l’organisation exposée', async () => {
    rls.__set({
      data: evenementBrut({ organisation_id: 'org-traiteur-tiers' }),
      error: null,
    });
    const res = await fiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { ajouter_collecte: boolean };
    };
    // La route d'ajout répondrait 404 sur cet événement.
    expect(data.ajouter_collecte).toBe(false);
    expect(JSON.stringify(data)).not.toContain('org-traiteur-tiers');
  });
});
