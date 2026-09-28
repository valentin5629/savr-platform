/**
 * Drill-down « Top listes → liste Collectes filtrée » — filtres serveur.
 *  - API traiteur : commercial_id → filtre evenements.created_by (lieu_id déjà couvert).
 *  - API gestionnaire : lieu_id / traiteur_id → filtres evenements.* + aplatissement
 *    des noms (lieu_nom / evenement_nom) via l'embed evenements!inner + lieux,
 *    plus Type/Taille d'événement propagés depuis les filtres globaux du
 *    dashboard (§06.05 l.209) — la taille est un bracket sur `evenements.pax`.
 * La chaîne PostgREST mockée ENREGISTRE les filtres (eq) pour les assertions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain(result: Result) {
  const eqCalls: [string, unknown][] = [];
  const inCalls: [string, unknown][] = [];
  const gteCalls: [string, unknown][] = [];
  const lteCalls: [string, unknown][] = [];
  const orCalls: [string, unknown][] = [];
  const fromCalls: unknown[] = [];
  const chain: Record<string, unknown> = {
    __eq: eqCalls,
    __in: inCalls,
    __gte: gteCalls,
    __lte: lteCalls,
    __or: orCalls,
    // `from` est enregistré pour pouvoir prouver qu'une requête n'est PAS partie
    // (cas du court-circuit « aucune taille reconnue »).
    __from: fromCalls,
    from: (table?: unknown) => {
      fromCalls.push(table);
      return chain;
    },
    select: () => chain,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return chain;
    },
    in: (col: string, val: unknown) => {
      inCalls.push([col, val]);
      return chain;
    },
    gte: (col: string, val: unknown) => {
      gteCalls.push([col, val]);
      return chain;
    },
    lte: (col: string, val: unknown) => {
      lteCalls.push([col, val]);
      return chain;
    },
    or: (expr: string, opts?: unknown) => {
      orCalls.push([expr, opts]);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    // La liste Collectes gestionnaire fenêtre par `range` depuis la pagination
    // serveur (décision Val 2026-09-22) ; `limit` reste utilisé par la route
    // traiteur testée dans ce même fichier.
    range: () => chain,
    then: (resolve: (r: Result) => unknown) => resolve(result),
  };
  return chain as typeof chain & {
    __eq: [string, unknown][];
    __in: [string, unknown][];
    __gte: [string, unknown][];
    __lte: [string, unknown][];
    __or: [string, unknown][];
    __from: unknown[];
  };
}

let rls = makeChain({ data: [], error: null });
const mockRequireUser = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'u1', role: 'traiteur_manager', organisationId: 'org-1' },
  });
});

describe('API traiteur/collectes — filtre commercial (drill-down Top 5 commerciaux)', () => {
  async function call(url: string) {
    const { GET } = await import('@/app/api/v1/traiteur/collectes/route.js');
    return GET(new NextRequest(url));
  }

  it('commercial_id → applique .eq(evenements.created_by)', async () => {
    rls = makeChain({ data: [], error: null });
    const res = await call(
      'http://localhost/api/v1/traiteur/collectes?type=zero_dechet&commercial_id=comm-9',
    );
    expect(res.status).toBe(200);
    expect(rls.__eq).toContainEqual(['evenements.created_by', 'comm-9']);
  });

  it('lieu_id → applique .eq(evenements.lieu_id)', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/traiteur/collectes?type=zero_dechet&lieu_id=lieu-1',
    );
    expect(rls.__eq).toContainEqual(['evenements.lieu_id', 'lieu-1']);
  });

  it('sans filtre commercial → aucun filtre created_by', async () => {
    rls = makeChain({ data: [], error: null });
    await call('http://localhost/api/v1/traiteur/collectes?type=zero_dechet');
    expect(rls.__eq.some(([col]) => col === 'evenements.created_by')).toBe(
      false,
    );
  });

  it('miroir exact : statut=cloturee + période (from/to) tous appliqués', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/traiteur/collectes?type=zero_dechet&lieu_id=lieu-1&statut=cloturee&from=2025-07-13&to=2026-07-13',
    );
    // statut restreint aux clôturées (= base du chiffre du Top liste).
    expect(rls.__in).toContainEqual(['statut', ['cloturee']]);
    // même fenêtre temporelle que le dashboard.
    expect(rls.__gte).toContainEqual(['date_collecte', '2025-07-13']);
    expect(rls.__lte).toContainEqual(['date_collecte', '2026-07-13']);
    expect(rls.__eq).toContainEqual(['evenements.lieu_id', 'lieu-1']);
  });

  it('perimetre=organisation → restreint aux événements possédés (organisation_id du JWT)', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/traiteur/collectes?type=zero_dechet&lieu_id=lieu-1&perimetre=organisation',
    );
    // organisation_id vient du ctx (JWT), jamais du body/URL.
    expect(rls.__eq).toContainEqual(['evenements.organisation_id', 'org-1']);
  });

  it('sans perimetre → aucun filtre organisation_id (RLS large habituelle)', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/traiteur/collectes?type=zero_dechet&lieu_id=lieu-1',
    );
    expect(rls.__eq.some(([col]) => col === 'evenements.organisation_id')).toBe(
      false,
    );
  });

  it('association_id → filtre attributions_antgaspi.association_id (drill-down Top asso AG)', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/traiteur/collectes?type=anti_gaspi&association_id=asso-7&statut=cloturee',
    );
    expect(rls.__eq).toContainEqual([
      'attributions_antgaspi.association_id',
      'asso-7',
    ]);
  });

  it('sans association → aucun filtre attributions_antgaspi (embed non ajouté)', async () => {
    rls = makeChain({ data: [], error: null });
    await call('http://localhost/api/v1/traiteur/collectes?type=zero_dechet');
    expect(
      rls.__eq.some(([col]) => col === 'attributions_antgaspi.association_id'),
    ).toBe(false);
  });
});

describe('API gestionnaire/collectes — filtres lieu / traiteur + noms', () => {
  async function call(url: string) {
    mockRequireUser.mockResolvedValue({
      ctx: {
        userId: 'g1',
        role: 'gestionnaire_lieux',
        organisationId: 'org-1',
      },
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/collectes/route.js');
    return GET(new NextRequest(url));
  }

  const oneRow = {
    id: 'c1',
    evenement_id: 'e1',
    type: 'zero_dechet',
    statut: 'cloturee',
    statut_tms: null,
    date_collecte: '2026-01-10',
    heure_collecte: null,
    taux_recyclage: 80,
    co2_evite_kg: 12,
    realisee_at: null,
    evenements: {
      nom_evenement: 'Gala',
      lieu_id: 'lieu-1',
      traiteur_operationnel_organisation_id: 't1',
      lieux: { nom: 'Le Pavillon' },
    },
  };

  it('lieu_id → filtre evenements.lieu_id + aplatit lieu_nom/evenement_nom', async () => {
    rls = makeChain({ data: [oneRow], error: null });
    const res = await call(
      'http://localhost/api/v1/gestionnaire/collectes?lieu_id=lieu-1',
    );
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(rls.__eq).toContainEqual(['evenements.lieu_id', 'lieu-1']);
    expect(body.data[0]!.lieu_nom).toBe('Le Pavillon');
    expect(body.data[0]!.evenement_nom).toBe('Gala');
    // L'objet embarqué brut n'est pas renvoyé (aplati).
    expect(body.data[0]!.evenements).toBeUndefined();
  });

  it('traiteur_id → filtre evenements.traiteur_operationnel_organisation_id', async () => {
    rls = makeChain({ data: [oneRow], error: null });
    await call('http://localhost/api/v1/gestionnaire/collectes?traiteur_id=t1');
    expect(rls.__eq).toContainEqual([
      'evenements.traiteur_operationnel_organisation_id',
      't1',
    ]);
  });

  it('embed sous forme de tableau (cache PostgREST) → noms aplatis quand même', async () => {
    rls = makeChain({
      data: [
        {
          ...oneRow,
          evenements: [
            {
              nom_evenement: 'Gala',
              lieu_id: 'lieu-1',
              traiteur_operationnel_organisation_id: 't1',
              lieux: [{ nom: 'Le Pavillon' }],
            },
          ],
        },
      ],
      error: null,
    });
    const res = await call(
      'http://localhost/api/v1/gestionnaire/collectes?lieu_id=lieu-1',
    );
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(body.data[0]!.lieu_nom).toBe('Le Pavillon');
    expect(body.data[0]!.evenement_nom).toBe('Gala');
  });
});

/**
 * §06.05 l.209 — « filtres du dashboard propagés (période + Type/Taille
 * d'événement) ». La période était déjà acceptée ; Type et Taille ne l'étaient
 * NI dans le lien, NI par la route (`grep type_evenement_id|taille_evenement` sur
 * la route = 0 résultat avant ce lot), donc un gestionnaire qui filtrait son
 * dashboard sur « Gala / XL » retombait sur la liste complète de son parc.
 *
 * La taille est un BRACKET calculé sur `evenements.pax` (XS <250, S <500, M <750,
 * L <1000, XL ≥1000, §06.05 l.115), pas une colonne : elle se traduit en prédicats
 * `.or()` sur l'embed. Ces prédicats sont mesurés ici tels qu'ils partent vers
 * PostgREST — c'est la chaîne exacte validée contre le PostgREST local (partition
 * exhaustive : XS 21 + M 7 + XL 1 = 29 = total sans filtre).
 */
describe('API gestionnaire/collectes — Type / Taille d’événement (§06.05 l.209)', () => {
  async function call(url: string) {
    mockRequireUser.mockResolvedValue({
      ctx: {
        userId: 'g1',
        role: 'gestionnaire_lieux',
        organisationId: 'org-1',
      },
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/collectes/route.js');
    return GET(new NextRequest(url));
  }

  it('M3.2/collectes_route_filtre_type_evenement — type_evenement_ids[] → .in(evenements.type_evenement_id)', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/gestionnaire/collectes?lieu_id=lieu-1&type_evenement_ids[]=ty-gala&type_evenement_ids[]=ty-cocktail',
    );
    expect(rls.__in).toContainEqual([
      'evenements.type_evenement_id',
      ['ty-gala', 'ty-cocktail'],
    ]);
  });

  it('M3.2/collectes_route_filtre_taille_evenement — un bracket → un .or() sur l’embed evenements', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/gestionnaire/collectes?taille_evenements[]=M',
    );
    expect(rls.__or).toEqual([
      ['and(pax.gte.500,pax.lt.750)', { referencedTable: 'evenements' }],
    ]);
  });

  it('M3.2/collectes_route_taille_xs_inclut_pax_null — XS couvre pax NULL, comme la liste Événements', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/gestionnaire/collectes?taille_evenements[]=XS',
    );
    // `gestionnaire/evenements` classe un pax absent en XS (`tailleBracket(pax ?? 0)`).
    // Sans `pax.is.null` ici, le même filtre donnerait deux périmètres selon l'écran.
    expect(rls.__or[0]![0]).toBe('pax.is.null,pax.lt.250');
  });

  it('M3.2/collectes_route_taille_brackets_non_contigus — XS+XL → un seul .or(), deux termes', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/gestionnaire/collectes?taille_evenements[]=XS&taille_evenements[]=XL',
    );
    // Un seul appel : les brackets sont OU-és ENTRE EUX. Deux `.or()` séparés
    // seraient ET-és et ne rendraient jamais aucune ligne.
    expect(rls.__or).toHaveLength(1);
    expect(rls.__or[0]![0]).toBe('pax.is.null,pax.lt.250,pax.gte.1000');
  });

  it('M3.2/collectes_route_taille_inconnue_ne_desarme_pas_le_filtre — code hors XS…XL → liste vide, pas liste entière', async () => {
    rls = makeChain({ data: [], error: null });
    const res = await call(
      'http://localhost/api/v1/gestionnaire/collectes?taille_evenements[]=ZZ',
    );
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ data: [], total: 0 });
    // Le point du cas : aucune requête n'est partie. Ignorer le code inconnu
    // aurait renvoyé le parc COMPLET sous un filtre que l'écran annonce.
    expect(rls.__from).toHaveLength(0);
  });

  it('M3.2/collectes_route_taille_cle_heritee_rejetee — `toString` ne traverse pas la table de prédicats', async () => {
    rls = makeChain({ data: [], error: null });
    // Ce que cette sonde mesure EXACTEMENT : le cumul de deux gardes. Mesuré par
    // mutation — objet littéral seul (garde `typeof` gardée) : VERTE ; `Map`
    // gardée et `typeof` remplacé par `Boolean` : VERTE ; les deux défaites :
    // ROUGE (`rls.__or` reçoit 1 au lieu de 0, la valeur héritée atteint
    // réellement la chaîne du filtre). Chacune tient donc seule contre une clé
    // héritée — c'est le cumul qui est épinglé ici, pas l'une des deux.
    // L'apport PROPRE de la `Map` est ailleurs, et lui n'est couvert par aucune
    // sonde : une pollution réelle de `Object.prototype` par une dépendance
    // tierce, qui y poserait une *chaîne*, passerait la garde de type.
    const res = await call(
      'http://localhost/api/v1/gestionnaire/collectes?taille_evenements[]=toString',
    );
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body).toMatchObject({ data: [], total: 0 });
    expect(rls.__or).toHaveLength(0);
    expect(rls.__from).toHaveLength(0);
  });

  it('M3.2/collectes_route_sans_filtres_evenement — aucun .or(), aucun .in sur type_evenement_id', async () => {
    rls = makeChain({ data: [], error: null });
    await call('http://localhost/api/v1/gestionnaire/collectes?lieu_id=lieu-1');
    expect(rls.__or).toHaveLength(0);
    expect(
      rls.__in.some(([col]) => col === 'evenements.type_evenement_id'),
    ).toBe(false);
  });

  it('M3.2/collectes_route_type_et_taille_se_cumulent — les deux filtres coexistent avec lieu + période', async () => {
    rls = makeChain({ data: [], error: null });
    await call(
      'http://localhost/api/v1/gestionnaire/collectes?lieu_id=lieu-1&from=2026-01-01&to=2026-06-30&type_evenement_ids[]=ty-gala&taille_evenements[]=L',
    );
    expect(rls.__eq).toContainEqual(['evenements.lieu_id', 'lieu-1']);
    expect(rls.__gte).toContainEqual(['date_collecte', '2026-01-01']);
    expect(rls.__lte).toContainEqual(['date_collecte', '2026-06-30']);
    expect(rls.__in).toContainEqual([
      'evenements.type_evenement_id',
      ['ty-gala'],
    ]);
    expect(rls.__or[0]![0]).toBe('and(pax.gte.750,pax.lt.1000)');
  });

  it('M3.2/collectes_route_drilldown_gestionnaire_sans_statut_ni_type — l’URL du dashboard n’en porte plus', async () => {
    rls = makeChain({ data: [], error: null });
    // URL telle que `drillUrl` la construit désormais (§06.05 l.209).
    await call(
      'http://localhost/api/v1/gestionnaire/collectes?lieu_id=lieu-1&from=2026-01-01&to=2026-06-30',
    );
    // Aucun filtre de statut ni de type de collecte : liste large.
    expect(rls.__eq.some(([col]) => col === 'statut')).toBe(false);
    expect(rls.__eq.some(([col]) => col === 'type')).toBe(false);
  });
});
