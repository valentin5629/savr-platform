/**
 * Acceptation manuelle d'une mission Everest (failover Ops, Everest down).
 *
 * La route rattachait la ligne `everest_missions` à N'IMPORTE quelle tournée de
 * la collecte (`.limit(1)` sans filtre ni tri). Sur une collecte re-dispatchée,
 * c'est une tournée MTS-1 résiduelle qui pouvait être choisie — alors que
 * l'adapter Everest cherche ensuite SA mission par `findMission(tournee.id)`
 * sur une tournée filtrée par provider. Il ne l'aurait pas trouvée et aurait
 * re-créé une mission : l'acceptation téléphonique protégeait la mauvaise
 * tournée. Depuis 2026-09-15, `findMission` est L'oracle d'idempotence du
 * dispatch — ce rattachement doit donc viser la bonne tournée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PRESTA_EVEREST = 'presta-atoutes-uuid';
const PRESTA_MTS1 = 'presta-strike-uuid';

/** Tournées liées à la collecte — une MTS-1 au rang 1, une Everest au rang 2. */
const TOURNEES = [
  {
    tournee_id: 'T-mts1',
    rang: 1,
    tournees: { prestataire_logistique_id: PRESTA_MTS1 },
  },
  {
    tournee_id: 'T-everest',
    rang: 2,
    tournees: { prestataire_logistique_id: PRESTA_EVEREST },
  },
];

const REFERENTIEL = [
  { prestataire_logistique_id: PRESTA_MTS1, type_tms: 'mts1' },
  { prestataire_logistique_id: PRESTA_EVEREST, type_tms: 'a_toutes' },
];

let insertedMissions: Array<Record<string, unknown>> = [];
/** Chaînes passées à `.select()`, par table — le `!inner` est porteur (cf. test). */
let selects: Array<{ table: string; cols: string }> = [];

/**
 * Builder appliquant RÉELLEMENT les `.eq()` / `.in()` reçus : servir une liste
 * déjà filtrée ne prouverait pas que la route filtre, et retirer le filtre du
 * code laisserait la CI verte.
 */
function makeClient() {
  const builder = (table: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    const egalites: Array<[string, unknown]> = [];
    const inclusions: Array<[string, unknown[]]> = [];
    let tri: { col: string; asc: boolean } | null = null;

    const lignes = () => {
      if (table === 'transporteurs') {
        return REFERENTIEL.filter((r) =>
          egalites.every(
            ([col, val]) => (r as Record<string, unknown>)[col] === val,
          ),
        );
      }
      if (table === 'collecte_tournees') {
        let rows = TOURNEES.filter((r) =>
          inclusions.every(([col, vals]) => {
            // `tournees.prestataire_logistique_id` → colonne de l'embed.
            const cle = col.split('.').pop()!;
            return vals.includes(
              (r.tournees as Record<string, unknown>)[cle] as string,
            );
          }),
        );
        if (tri) {
          rows = [...rows].sort((a, b) =>
            tri!.asc ? a.rang - b.rang : b.rang - a.rang,
          );
        }
        return rows;
      }
      return [];
    };

    Object.assign(self, {
      select: (cols?: string) => {
        if (typeof cols === 'string') selects.push({ table, cols });
        return self;
      },
      eq: (col: string, val: unknown) => {
        egalites.push([col, val]);
        return self;
      },
      in: (col: string, vals: unknown[]) => {
        inclusions.push([col, vals]);
        return self;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        tri = { col, asc: opts?.ascending !== false };
        return self;
      },
      limit: () => self,
      maybeSingle: () =>
        Promise.resolve({ data: lignes()[0] ?? null, error: null }),
      insert: (payload: Record<string, unknown>) => {
        if (table === 'everest_missions') insertedMissions.push(payload);
        return Promise.resolve({ data: null, error: null });
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: lignes(), error: null }),
    });
    return self;
  };
  return { from: (table: string) => builder(table) };
}

vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: vi.fn(async () => ({
    ctx: { userId: 'ops-1', role: 'ops_savr', organisationId: null },
  })),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => makeClient(),
}));

function postReq(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/admin/everest/missions/manual-accept',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedMissions = [];
  selects = [];
});

describe('M2.5 — acceptation manuelle : la mission vise la tournée EVEREST', () => {
  it('collecte mixte : la ligne everest_missions est rattachée à la tournée Everest, jamais à la MTS-1 du rang 1', async () => {
    const { POST } =
      await import('@/app/api/v1/admin/everest/missions/manual-accept/route.js');

    const res = await POST(
      postReq({ collecte_id: 'col-mixte', contact_joint: 'Mathieu' }),
    );

    expect(res.status).toBe(200);
    expect(insertedMissions).toHaveLength(1);
    // Le rang 1 est MTS-1 : un `.limit(1)` non filtré l'aurait choisie.
    expect(insertedMissions[0]!['tournee_id']).toBe('T-everest');
    expect(insertedMissions[0]!['statut_everest']).toBe('created_manually');
  });

  it('l’embed des tournées est en `!inner` — sans quoi le filtre provider serait inopérant', async () => {
    // Vérifié contre le VRAI PostgREST de dev : `…&tournees.prestataire_logistique_id=in.(…)`
    // avec un embed SANS `!inner` ne supprime pas la ligne parente, il met
    // seulement l'embed à `null`. La route ne lisant que `tournee_id`, elle
    // retomberait SILENCIEUSEMENT sur le comportement non filtré. Le mock ne
    // peut pas rejouer cette subtilité : on épingle donc la chaîne du select.
    const { POST } =
      await import('@/app/api/v1/admin/everest/missions/manual-accept/route.js');

    await POST(postReq({ collecte_id: 'col-mixte' }));

    const selectTournees = selects.find((s) => s.table === 'collecte_tournees');
    expect(selectTournees).toBeDefined();
    expect(selectTournees!.cols).toContain('tournees!inner');
  });
});
