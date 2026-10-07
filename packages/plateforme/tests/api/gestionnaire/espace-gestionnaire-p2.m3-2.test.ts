/**
 * M3.2 — Tests Vitest API R19b-P2 (§06.05).
 * Couvre BL-P2-12 :
 *  - endpoint /filtres (options Lieux/Traiteurs/Type du parc de l'organisation) ;
 *  - liste Événements : champs plats (lieu_nom/traiteur_nom) + colonnes
 *    tonnage_zd_kg / dechets_labo_kg / repas_donnes ; filtre Taille honoré ;
 *  - liste Traiteurs : lieux_intervention résolus en { id, nom } ;
 *  - dashboard : filtre Taille (bracket pax) honoré.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { jourParis } from '@savr/shared/src/temps/index.js';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'neq',
    'in',
    'gte',
    'lte',
    'order',
    'limit',
    'not',
  ]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = () => Promise.resolve(next());
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & { push(r: Result): unknown };
}

let rls = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(
  role = 'gestionnaire_lieux',
  organisationId = 'org-viparis',
) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-gl' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: organisationId,
        }),
      },
    },
    error: null,
  });
}
function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
});

// ── Endpoint /filtres ─────────────────────────────────────────────────────────
describe('M3.2 / P2 filtres endpoint', () => {
  it("M3.2/P2_filtres_options_parc — lieux + traiteurs + types de l'organisation", async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'l1' }], error: null }); // organisations_lieux
    rls.push({
      data: [{ id: 'l1', nom: 'Palais des Congrès' }],
      error: null,
    }); // v_lieux_clients
    rls.push({
      data: [
        {
          id: 'c1',
          evenements: {
            lieu_id: 'l1',
            traiteur_operationnel_organisation_id: 'tr1',
            organisations: { id: 'tr1', nom: 'Kaspia' },
          },
        },
      ],
      error: null,
    }); // collectes
    rls.push({ data: [{ id: 'ty1', libelle: 'Gala' }], error: null }); // types_evenements

    const { GET } = await import('@/app/api/v1/gestionnaire/filtres/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/filtres'));
    const json = (await res.json()) as {
      data: {
        lieux: { id: string; nom: string }[];
        traiteurs: { id: string; nom: string }[];
        types: { id: string; libelle: string }[];
      };
    };
    expect(json.data.lieux).toEqual([{ id: 'l1', nom: 'Palais des Congrès' }]);
    expect(json.data.traiteurs).toEqual([{ id: 'tr1', nom: 'Kaspia' }]);
    expect(json.data.types).toEqual([{ id: 'ty1', libelle: 'Gala' }]);
  });

  it('M3.2/P2_filtres_vide_si_aucun_perimetre — org sans lieu → listes vides', async () => {
    setupAuth();
    rls.push({ data: [], error: null }); // organisations_lieux vide
    const { GET } = await import('@/app/api/v1/gestionnaire/filtres/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/filtres'));
    const json = (await res.json()) as {
      data: { lieux: unknown[]; traiteurs: unknown[]; types: unknown[] };
    };
    expect(json.data.lieux).toEqual([]);
    expect(json.data.traiteurs).toEqual([]);
    expect(json.data.types).toEqual([]);
  });
});

// ── Liste Événements : colonnes + champs plats ────────────────────────────────
describe('M3.2 / P2 liste événements colonnes', () => {
  it('M3.2/P2_evenements_colonnes_et_champs_plats — tonnage/dechets/repas + lieu_nom/traiteur_nom', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'e1',
          nom_evenement: 'Gala',
          date_evenement: '2026-06-01',
          pax: 600,
          organisation_id: 'org-viparis',
          lieu_id: 'lieu-1',
          lieux: { id: 'lieu-1', nom: 'Palais', ville: 'Paris' },
          traiteur_operationnel_organisation_id: 'tr1',
          organisations: { id: 'tr1', nom: 'Kaspia' },
          type_evenement_id: 'ty1',
          types_evenements: { id: 'ty1', libelle: 'Gala' },
          collectes: [
            {
              id: 'c1',
              type: 'zero_dechet',
              statut: 'cloturee',
              date_collecte: '2026-06-01',
              collecte_flux: [{ poids_reel_kg: 300 }],
              attributions_antgaspi: [],
            },
            {
              id: 'c2',
              type: 'anti_gaspi',
              statut: 'cloturee',
              date_collecte: '2026-06-01',
              collecte_flux: [],
              attributions_antgaspi: [{ volume_repas_realise: 40 }],
            },
          ],
        },
      ],
      error: null,
    }); // evenements
    rls.push({ data: 12, error: null }); // f_dechets_labo_estimes rpc (1 event)

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/evenements'));
    const json = (await res.json()) as {
      data: Array<{
        lieu_nom: string | null;
        lieu_ville: string | null;
        traiteur_nom: string | null;
        tonnage_zd_kg: number;
        dechets_labo_kg: number | null;
        repas_donnes: number;
      }>;
    };
    const row = json.data[0]!;
    expect(row.lieu_nom).toBe('Palais');
    expect(row.lieu_ville).toBe('Paris');
    expect(row.traiteur_nom).toBe('Kaspia');
    expect(row.tonnage_zd_kg).toBe(300);
    expect(row.dechets_labo_kg).toBe(12);
    expect(row.repas_donnes).toBe(40);
  });

  it('M3.2/P2_evenements_repas_objet — embed to-one (OBJET PostgREST) : repas compté, pas de crash', async () => {
    // Régression : PostgREST renvoie collectes[].attributions_antgaspi en OBJET
    // (relation to-one, collecte_id UNIQUE). Avant le fix, `(x ?? []).reduce`
    // plantait (TypeError → 500) sur l'objet. Le mock tableau du test précédent
    // masquait ce crash.
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'e1',
          nom_evenement: 'Gala',
          date_evenement: '2026-06-01',
          pax: 600,
          organisation_id: 'org-viparis',
          lieu_id: 'lieu-1',
          lieux: { id: 'lieu-1', nom: 'Palais', ville: 'Paris' },
          traiteur_operationnel_organisation_id: 'tr1',
          organisations: { id: 'tr1', nom: 'Kaspia' },
          type_evenement_id: 'ty1',
          types_evenements: { id: 'ty1', libelle: 'Gala' },
          collectes: [
            {
              id: 'c2',
              type: 'anti_gaspi',
              statut: 'cloturee',
              date_collecte: '2026-06-01',
              collecte_flux: [],
              // ⚠ OBJET, pas tableau — forme réelle PostgREST.
              attributions_antgaspi: { volume_repas_realise: 40 },
            },
          ],
        },
      ],
      error: null,
    }); // evenements
    rls.push({ data: 0, error: null }); // f_dechets_labo_estimes rpc

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/evenements'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{ repas_donnes: number }>;
    };
    expect(json.data[0]!.repas_donnes).toBe(40);
  });

  it('M3.2/P2_evenement_detail_attributions_objet — fiche : embed to-one (OBJET) normalisé en tableau', async () => {
    // Régression : détail événement (§06.05 §2, scénario P1
    // detail_evenement_consultation_lecture_seule). PostgREST renvoie
    // collectes[].attributions_antgaspi en OBJET (to-one). La page fait
    // `.length`/`.map` dessus → sans normalisation, le sous-bloc AG (repas +
    // association) ne s'affichait jamais. La route doit renvoyer un TABLEAU.
    setupAuth();
    rls.push({
      data: {
        id: 'e1',
        nom_evenement: 'Gala',
        date_evenement: '2026-06-01',
        pax: 300,
        organisation_id: 'org-1',
        lieux: { id: 'lieu-1', nom: 'Palais' },
        organisations: { id: 'tr1', nom: 'Kaspia', logo_url: null },
        types_evenements: { id: 'ty1', libelle: 'Gala' },
        collectes: [
          {
            id: 'c-ag',
            type: 'anti_gaspi',
            statut: 'cloturee',
            date_collecte: '2026-06-01',
            collecte_flux: [],
            // ⚠ OBJET, pas tableau — forme réelle PostgREST (mesurée sur la
            // vue v_attributions_gestionnaire : association à plat).
            attributions_antgaspi: {
              collecte_id: 'c-ag',
              volume_repas_realise: 88,
              association_nom: 'Les Restos',
              association_ville: 'Paris',
              associations: { latitude: null, longitude: null },
            },
          },
        ],
      },
      error: null,
    }); // evenement (maybeSingle)
    rls.push({ data: 0, error: null }); // f_dechets_labo_estimes rpc

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/[id]/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/evenements/e1'), {
      params: Promise.resolve({ id: 'e1' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        collectes: Array<{
          attributions_antgaspi: Array<{ volume_repas_realise?: number }>;
        }>;
      };
    };
    const attrs = json.data.collectes[0]!.attributions_antgaspi;
    expect(Array.isArray(attrs)).toBe(true); // objet normalisé en tableau
    expect(attrs).toHaveLength(1);
    expect(attrs[0]!.volume_repas_realise).toBe(88);
  });

  // §06.05 §3 « Bloc collectes rattachées > Pour AG » — la distance association ↔
  // lieu de l'événement est RESTITUÉE au gestionnaire (arbitrage Val 2026-09-21,
  // option b de _Divergences/M3.2_20260918_detail-evenement-distance-association).
  // Rien n'est stocké : la route calcule à la volée avec distanceKm, la fonction
  // de l'algo d'attribution AG (fn_calculer_algo_attribution_ag).
  it('M3.2/detail_evenement_ag_distance_association — haversine association↔lieu, arrondie au km entier, coordonnées jamais exposées', async () => {
    setupAuth();
    // Sonde du SELECT : sans la vue v_attributions_gestionnaire, aa_select rend
    // le bloc vide sur un traiteur tiers ; sans `latitude, longitude` dans
    // l'embed associations, la distance serait null en prod — le mock, lui, ne
    // s'en apercevrait pas.
    const selects: string[] = [];
    (rls as unknown as Record<string, unknown>).select = (sql: string) => {
      selects.push(sql);
      return rls;
    };
    rls.push({
      data: {
        id: 'e1',
        nom_evenement: 'Gala',
        date_evenement: '2026-06-01',
        pax: 300,
        organisation_id: 'org-1',
        // Paris Expo Porte de Versailles
        lieux: {
          id: 'lieu-1',
          nom: 'Paris Expo',
          latitude: 48.8322,
          longitude: 2.2875,
        },
        organisations: { id: 'tr1', nom: 'Kaspia', logo_url: null },
        types_evenements: { id: 'ty1', libelle: 'Gala' },
        collectes: [
          {
            id: 'c-ag',
            type: 'anti_gaspi',
            statut: 'cloturee',
            date_collecte: '2026-06-01',
            collecte_flux: [],
            attributions_antgaspi: [
              {
                collecte_id: 'c-ag',
                volume_repas_realise: 88,
                association_nom: 'Les Restos',
                association_ville: 'Versailles',
                // Versailles — 12,6053 km du lieu (haversine, R = 6371 km).
                associations: { latitude: 48.8049, longitude: 2.1204 },
              },
              {
                collecte_id: 'c-ag-2',
                volume_repas_realise: 12,
                association_nom: 'Asso non géocodée',
                association_ville: 'Paris',
                associations: { latitude: null, longitude: null },
              },
            ],
          },
        ],
      },
      error: null,
    }); // evenement (maybeSingle)
    rls.push({ data: 0, error: null }); // f_dechets_labo_estimes rpc

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/[id]/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/evenements/e1'), {
      params: Promise.resolve({ id: 'e1' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        collectes: Array<{
          attributions_antgaspi: Array<{
            distance_km: number | null;
            associations: Record<string, unknown> | null;
          }>;
        }>;
      };
    };
    const attrs = json.data.collectes[0]!.attributions_antgaspi;

    // L'attribution est lue par la VUE (jamais la table, que aa_select refuse
    // sur un traiteur tiers), et les coordonnées sont DEMANDÉES à PostgREST…
    const sql = selects.join(' ');
    expect(sql).toContain('attributions_antgaspi:v_attributions_gestionnaire(');
    expect(sql).not.toMatch(/attributions_antgaspi\s*\(/);
    expect(sql).toContain('associations(latitude, longitude)');
    // …et aucune colonne `associations.distance_km` n'existe (G7, #359).
    expect(sql).not.toContain('distance_km');

    // 12,6053 km → 13 : arrondi à l'entier LE PLUS PROCHE (ni 12 tronqué, ni 12.61).
    expect(attrs[0]!.distance_km).toBe(13);
    // Coordonnées manquantes → « — » côté UI : null, jamais 0.
    expect(attrs[1]!.distance_km).toBeNull();
    // …mais ne doivent PAS ressortir : le gestionnaire ne reçoit que nom + ville.
    expect(attrs[0]!.associations).toEqual({
      nom: 'Les Restos',
      ville: 'Versailles',
    });
    expect(JSON.stringify(attrs)).not.toContain('latitude');
  });

  it('M3.2/detail_evenement_ag_distance_lieu_non_geocode — lieu sans GPS : distance null même si l’association est géocodée', async () => {
    setupAuth();
    rls.push({
      data: {
        id: 'e1',
        nom_evenement: 'Gala',
        date_evenement: '2026-06-01',
        pax: 300,
        organisation_id: 'org-1',
        lieux: {
          id: 'lieu-1',
          nom: 'Lieu sans GPS',
          latitude: null,
          longitude: null,
        },
        organisations: { id: 'tr1', nom: 'Kaspia', logo_url: null },
        types_evenements: { id: 'ty1', libelle: 'Gala' },
        collectes: [
          {
            id: 'c-ag',
            type: 'anti_gaspi',
            statut: 'cloturee',
            date_collecte: '2026-06-01',
            collecte_flux: [],
            attributions_antgaspi: {
              collecte_id: 'c-ag',
              volume_repas_realise: 88,
              association_nom: 'Les Restos',
              association_ville: 'Versailles',
              associations: { latitude: 48.8049, longitude: 2.1204 },
            },
          },
        ],
      },
      error: null,
    }); // evenement (maybeSingle)
    rls.push({ data: 0, error: null }); // f_dechets_labo_estimes rpc

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/[id]/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/evenements/e1'), {
      params: Promise.resolve({ id: 'e1' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        collectes: Array<{
          attributions_antgaspi: Array<{ distance_km: number | null }>;
        }>;
      };
    };
    expect(
      json.data.collectes[0]!.attributions_antgaspi[0]!.distance_km,
    ).toBeNull();
  });

  it('M3.2/P2_evenements_filtre_taille — bracket pax honoré', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'e-s',
          nom_evenement: 'Petit',
          date_evenement: '2026-06-01',
          pax: 300, // bracket S
          organisation_id: 'org-viparis',
          lieu_id: 'lieu-1',
          lieux: { nom: 'A', ville: 'Paris' },
          organisations: { nom: 'Kaspia' },
          types_evenements: { libelle: 'Gala' },
          collectes: [],
        },
        {
          id: 'e-m',
          nom_evenement: 'Grand',
          date_evenement: '2026-06-01',
          pax: 600, // bracket M
          organisation_id: 'org-viparis',
          lieu_id: 'lieu-1',
          lieux: { nom: 'B', ville: 'Paris' },
          organisations: { nom: 'Kaspia' },
          types_evenements: { libelle: 'Gala' },
          collectes: [],
        },
      ],
      error: null,
    }); // evenements
    rls.push({ data: null, error: null }); // dechets rpc (1 event restant après filtre M)

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(
      makeReq('/api/v1/gestionnaire/evenements?taille_evenements[]=M'),
    );
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data).toHaveLength(1);
    expect(json.data[0]?.id).toBe('e-m');
  });
});

// ── Liste Événements : « Repas donnés » ───────────────────────────────────────
// Même source que la fiche collecte du rôle : le volume de l'attribution, lu
// par la vue v_attributions_gestionnaire (§04). Les formes sont celles que
// PostgREST rend réellement sous le jeton d'un gestionnaire (mesure sur base
// vierge, 2026-10-04) : embed to-one de la vue = OBJET, ou `null` quand la vue
// ne rend rien. Le repli sur l'attestation de don (D13) est retiré.
describe('M3.2 / liste événements — repas donnés', () => {
  // `attributions_antgaspi` = l'embed de la vue v_attributions_gestionnaire sous
  // son alias : objet (to-one), ou null quand la vue ne rend rien.
  type Attribution = { volume_repas_realise: number | null } | null;

  function collecteAg(id: string, attribution: Attribution) {
    return {
      id,
      type: 'anti_gaspi',
      statut: 'cloturee',
      date_collecte: '2026-06-01',
      collecte_flux: [],
      attributions_antgaspi: attribution,
    };
  }

  // Appelle la route sur UN événement portant les collectes données ; rend la
  // ligne produite et la chaîne `select` envoyée à `evenements`.
  async function listeAvec(collectes: unknown[]) {
    setupAuth();
    const selects: string[] = [];
    rls.select = (colonnes: string) => {
      selects.push(colonnes);
      return rls;
    };
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'e1',
          nom_evenement: 'Gala',
          date_evenement: '2026-06-01',
          pax: 600,
          // Programmé par un traiteur tiers : le cas nominal du gestionnaire.
          organisation_id: 'org-kaspia',
          lieu_id: 'lieu-1',
          lieux: { id: 'lieu-1', nom: 'Palais', ville: 'Paris' },
          traiteur_operationnel_organisation_id: 'org-kaspia',
          organisations: { id: 'org-kaspia', nom: 'Kaspia' },
          type_evenement_id: 'ty1',
          types_evenements: { id: 'ty1', libelle: 'Gala' },
          collectes,
        },
      ],
      error: null,
    }); // evenements
    rls.push({ data: null, error: null }); // f_dechets_labo_estimes

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/evenements'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{ repas_donnes: number; nb_collectes_ag: number }>;
    };
    return { ligne: json.data[0]!, selectEvenements: selects[1] ?? '' };
  }

  it('M3.2/evenements_repas_attribution_lisible — collecte programmée par le gestionnaire : volume de l’attribution', async () => {
    const { ligne } = await listeAvec([
      collecteAg('c1', { volume_repas_realise: 40 }),
    ]);
    expect(ligne.repas_donnes).toBe(40);
  });

  it('M3.2/evenements_repas_tiers_par_vue — traiteur tiers : repas lus par la vue v_attributions_gestionnaire, plus dans l’attestation', async () => {
    const { ligne, selectEvenements } = await listeAvec([
      collecteAg('c1', { volume_repas_realise: 129 }),
    ]);
    expect(ligne.repas_donnes).toBe(129);
    // La route DEMANDE la vue : la table, que aa_select refuse au gestionnaire
    // sur un traiteur tiers (C-1), rendrait null et la colonne resterait à « — ».
    expect(selectEvenements).toContain(
      'attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise)',
    );
    expect(selectEvenements).not.toMatch(/attributions_antgaspi\s*\(/);
    // Le repli sur l'attestation de don (D13) est retiré avec la vue.
    expect(selectEvenements).not.toContain('attestations_don');
  });

  it('M3.2/evenements_repas_sans_attribution — la vue ne rend rien : 0, que l’écran rend « — »', async () => {
    const { ligne } = await listeAvec([collecteAg('c1', null)]);
    expect(ligne.repas_donnes).toBe(0);
    expect(ligne.nb_collectes_ag).toBe(1);
  });

  it('M3.2/evenements_repas_somme_par_evenement — somme des volumes des collectes AG de l’événement', async () => {
    const { ligne } = await listeAvec([
      collecteAg('c1', { volume_repas_realise: 40 }),
      collecteAg('c2', { volume_repas_realise: 25 }),
      // Volume à 0 : un vrai zéro.
      collecteAg('c3', { volume_repas_realise: 0 }),
      // Pas d'attribution, ou volume non saisi : rien à ajouter.
      collecteAg('c4', null),
      collecteAg('c5', { volume_repas_realise: null }),
      // Une collecte ZD ne compte jamais, même avec un volume parasite.
      {
        ...collecteAg('c6', { volume_repas_realise: 500 }),
        type: 'zero_dechet',
      },
    ]);
    expect(ligne.repas_donnes).toBe(65);
    expect(ligne.nb_collectes_ag).toBe(5);
  });
});

describe('M3.2 / P2 liste traiteurs', () => {
  it("M3.2/P2_traiteurs_lieux_intervention_noms — { id, nom } résolus depuis l'embed", async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          date_collecte: jourParis(),
          taux_recyclage: 0.9,
          evenements: {
            lieu_id: 'lieu-1',
            traiteur_operationnel_organisation_id: 'tr1',
            lieux: { id: 'lieu-1', nom: 'Palais des Congrès' },
            organisations: { id: 'tr1', nom: 'Kaspia', logo_url: null },
          },
          collecte_flux: [{ poids_reel_kg: 200 }],
          attributions_antgaspi: [],
        },
      ],
      error: null,
    }); // collectes

    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/route.js');
    const res = await GET(makeReq('/api/v1/gestionnaire/traiteurs'));
    const json = (await res.json()) as {
      data: Array<{
        nom: string;
        lieux_intervention: { id: string; nom: string }[];
      }>;
    };
    expect(json.data[0]?.nom).toBe('Kaspia');
    expect(json.data[0]?.lieux_intervention).toEqual([
      { id: 'lieu-1', nom: 'Palais des Congrès' },
    ]);
  });
});

// ── Dashboard : filtre global honoré ──────────────────────────────────────────
describe('M3.2 / P2 dashboard filtres globaux', () => {
  it('M3.2/P2_dashboard_filtre_taille — seules les collectes du bracket comptent', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'c-s',
          type: 'zero_dechet',
          taux_recyclage: 0.8,
          realisee_at: null,
          evenements: { id: 'e-s', lieu_id: 'lieu-1', pax: 300 }, // S
          collecte_flux: [
            { poids_reel_kg: 100, flux_dechets: { code: 'carton' } },
          ],
          attributions_antgaspi: [],
        },
        {
          id: 'c-m',
          type: 'zero_dechet',
          taux_recyclage: 0.8,
          realisee_at: null,
          evenements: { id: 'e-m', lieu_id: 'lieu-1', pax: 600 }, // M
          collecte_flux: [
            { poids_reel_kg: 400, flux_dechets: { code: 'carton' } },
          ],
          attributions_antgaspi: [],
        },
      ],
      error: null,
    }); // collectes
    rls.push({ data: null, error: null }); // packs_antgaspi maybeSingle

    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/gestionnaire/dashboard?type=zero_dechet&taille_evenements[]=M',
      ),
    );
    const json = (await res.json()) as {
      data: { kpis: { nb_collectes: number; tonnage_kg: number } };
    };
    expect(json.data.kpis.nb_collectes).toBe(1);
    expect(json.data.kpis.tonnage_kg).toBe(400);
  });
});

// ── Export CSV : respecte les filtres actifs (§06.05 l.338) ───────────────────
describe('M3.2 / P2 export CSV filtres', () => {
  it('M3.2/P2_export_csv_respecte_filtre_taille — seule la taille filtrée est exportée', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'e-s',
          nom_evenement: 'PetitEvt',
          date_evenement: '2026-06-01',
          pax: 300, // S
          traiteur_operationnel_organisation_id: 'tr1',
          lieux: { nom: 'A' },
          types_evenements: { libelle: 'Gala' },
          collectes: [
            {
              id: 'c-s',
              type: 'zero_dechet',
              statut: 'cloturee',
              date_collecte: '2026-06-01',
              taux_recyclage: 0.8,
              collecte_flux: [{ poids_reel_kg: 100 }],
            },
          ],
        },
        {
          id: 'e-m',
          nom_evenement: 'GrandEvt',
          date_evenement: '2026-06-02',
          pax: 600, // M
          traiteur_operationnel_organisation_id: 'tr1',
          lieux: { nom: 'B' },
          types_evenements: { libelle: 'Gala' },
          collectes: [
            {
              id: 'c-m',
              type: 'zero_dechet',
              statut: 'cloturee',
              date_collecte: '2026-06-02',
              taux_recyclage: 0.8,
              collecte_flux: [{ poids_reel_kg: 400 }],
            },
          ],
        },
      ],
      error: null,
    }); // evenements
    // resolveTraiteurNoms → v_referentiel_traiteurs (pas d'AG → resolveRepas ne requête pas)
    rls.push({
      data: [{ id: 'tr1', nom: 'Kaspia' }],
      error: null,
    });

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/export-csv/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/gestionnaire/evenements/export-csv?taille_evenements[]=M',
      ),
    );
    const csv = await res.text();
    expect(csv).toContain('GrandEvt');
    expect(csv).not.toContain('PetitEvt');
  });

  it('M3.2/P2_export_csv_types_collecte — l’export applique la partition cochée, comme la liste', async () => {
    setupAuth();
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    const evt = (nom: string, types: string[]) => ({
      id: nom,
      nom_evenement: nom,
      date_evenement: '2026-06-01',
      pax: 300,
      traiteur_operationnel_organisation_id: 'tr1',
      lieux: { nom: 'A' },
      types_evenements: { libelle: 'Gala' },
      collectes: types.map((type, i) => ({
        id: `${nom}-${i}`,
        type,
        statut: 'programmee',
        date_collecte: '2026-06-01',
        collecte_flux: [],
      })),
    });
    rls.push({
      data: [
        evt('EvtZdSeul', ['zero_dechet']),
        evt('EvtMixte', ['zero_dechet', 'anti_gaspi']),
      ],
      error: null,
    }); // evenements
    rls.push({ data: [{ id: 'tr1', nom: 'Kaspia' }], error: null });

    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/export-csv/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/gestionnaire/evenements/export-csv?types_collecte[]=zd_seul',
      ),
    );
    const csv = await res.text();
    expect(csv).toContain('EvtZdSeul');
    expect(csv).not.toContain('EvtMixte');
  });
});
