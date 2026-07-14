/**
 * Drill-down « Top listes → liste Collectes filtrée » — filtres serveur.
 *  - API traiteur : commercial_id → filtre evenements.created_by (lieu_id déjà couvert).
 *  - API gestionnaire : lieu_id / traiteur_id → filtres evenements.* + aplatissement
 *    des noms (lieu_nom / evenement_nom) via l'embed evenements!inner + lieux.
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
  const chain: Record<string, unknown> = {
    __eq: eqCalls,
    __in: inCalls,
    __gte: gteCalls,
    __lte: lteCalls,
    from: () => chain,
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
    order: () => chain,
    limit: () => chain,
    then: (resolve: (r: Result) => unknown) => resolve(result),
  };
  return chain as typeof chain & {
    __eq: [string, unknown][];
    __in: [string, unknown][];
    __gte: [string, unknown][];
    __lte: [string, unknown][];
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
