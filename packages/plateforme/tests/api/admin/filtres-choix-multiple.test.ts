/**
 * Filtres à choix multiple des listes Admin — PR 2 (décision Val 2026-09-30,
 * divergence M0.8_20260930_filtres-choix-multiple-tous) : chaque liste cochée
 * arrive en paramètre CSV au pluriel, validé (liste blanche d'enum / UUID)
 * AVANT `.in()`, prioritaire sur le paramètre à valeur unique conservé.
 *
 * Par route : (e) CSV → `.in()`, (f) valeurs hors liste blanche / non-UUID
 * écartées, (g) le mono reste accepté (`.eq()`, comportement inchangé).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown; count?: number };

// Chaîne Supabase qui enregistre chaque appel (`__calls.in`, `__calls.eq`…) et
// se résout, une fois attendue, sur la file de résultats (vide par défaut).
function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const next = (): Result => queue.shift() ?? { data: [], error: null };
  const chain: Record<string, unknown> = { __calls: calls };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'neq',
    'not',
    'gte',
    'lte',
    'order',
    'range',
    'ilike',
    'rpc',
  ]) {
    chain[m] = (...args: unknown[]) => {
      (calls[m] ??= []).push(args);
      return chain;
    };
  }
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    __calls: Record<string, unknown[][]>;
  };
}

let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupStaff() {
  const payload = Buffer.from(
    JSON.stringify({ user_role: 'admin_savr', organisation_id: null }),
  ).toString('base64url');
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-admin-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: `h.${payload}.s` } },
    error: null,
  });
}

const req = (url: string) => new NextRequest(`http://localhost${url}`);

/** Appels `.in()` / `.eq()` portant sur `colonne`. */
const surColonne = (m: 'in' | 'eq', colonne: string) =>
  (admin.__calls[m] ?? []).filter((c) => c[0] === colonne);

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  admin = makeChain();
  setupStaff();
});

describe('M1.1a — GET /admin/organisations : filtre Type à choix multiple', () => {
  const get = async (qs: string) => {
    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(req(`/api/v1/admin/organisations?${qs}`));
    expect(res.status).toBe(200);
  };

  it('M1.1a/orgas_liste_types_csv — types=traiteur,agence → in(type, [traiteur, agence])', async () => {
    await get('types=traiteur,agence');
    expect(surColonne('in', 'type')).toEqual([
      ['type', ['traiteur', 'agence']],
    ]);
    expect(surColonne('eq', 'type')).toEqual([]);
  });

  it('M1.1a/orgas_liste_types_hors_enum_ecartes — une valeur hors enum organisation_type est écartée, seule → aucun filtre', async () => {
    await get('types=traiteur,inconnu');
    expect(surColonne('in', 'type')).toEqual([['type', ['traiteur']]]);

    admin = makeChain();
    await get('types=inconnu');
    expect(surColonne('in', 'type')).toEqual([]);
    expect(surColonne('eq', 'type')).toEqual([]);
  });

  it('M1.1a/orgas_liste_type_mono_conserve — ?type=traiteur (autres écrans) reste un eq(type)', async () => {
    await get('type=traiteur&actif=true');
    expect(surColonne('eq', 'type')).toEqual([['type', 'traiteur']]);
    expect(surColonne('in', 'type')).toEqual([]);
    expect(surColonne('eq', 'actif')).toEqual([['actif', true]]);
  });
});

describe('M1.1b — GET /admin/transporteurs : filtre Type à choix multiple', () => {
  const get = async (qs: string) => {
    const { GET } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await GET(req(`/api/v1/admin/transporteurs?${qs}`));
    expect(res.status).toBe(200);
  };

  it('M1.1b/transporteurs_liste_types_tms_csv — types_tms=autre,par_mail → in(type_tms)', async () => {
    await get('types_tms=autre,par_mail');
    expect(surColonne('in', 'type_tms')).toEqual([
      ['type_tms', ['autre', 'par_mail']],
    ]);
    expect(surColonne('eq', 'type_tms')).toEqual([]);
  });

  it('M1.1b/transporteurs_liste_types_tms_hors_enum_ecartes — valeur hors enum type_tms écartée', async () => {
    await get('types_tms=a_toutes,bidon');
    expect(surColonne('in', 'type_tms')).toEqual([['type_tms', ['a_toutes']]]);

    admin = makeChain();
    await get('types_tms=bidon');
    expect(surColonne('in', 'type_tms')).toEqual([]);
  });

  it('M1.1b/transporteurs_liste_type_tms_mono_conserve — ?type_tms= reste un eq', async () => {
    await get('type_tms=autre');
    expect(surColonne('eq', 'type_tms')).toEqual([['type_tms', 'autre']]);
    expect(surColonne('in', 'type_tms')).toEqual([]);
  });
});

describe('M1.7 — GET /admin/factures : Organisation et Type à choix multiple', () => {
  const get = async (qs: string) => {
    const { GET } = await import('@/app/api/v1/admin/factures/route.js');
    const res = await GET(req(`/api/v1/admin/factures?${qs}`));
    expect(res.status).toBe(200);
  };

  it('M1.7/factures_liste_organisation_ids_types_csv — CSV → in(organisation_id) + in(type)', async () => {
    await get(`organisation_ids=${UUID_A},${UUID_B}&types=zero_dechet,avoir`);
    expect(surColonne('in', 'organisation_id')).toEqual([
      ['organisation_id', [UUID_A, UUID_B]],
    ]);
    expect(surColonne('in', 'type')).toEqual([
      ['type', ['zero_dechet', 'avoir']],
    ]);
    expect(surColonne('eq', 'organisation_id')).toEqual([]);
    expect(surColonne('eq', 'type')).toEqual([]);
  });

  it('M1.7/factures_liste_valeurs_invalides_ecartees — non-UUID et type hors enum facture_type écartés', async () => {
    await get(
      `organisation_ids=${UUID_A},pas-un-uuid,1)or(1=1&types=avoir,anti_gaspi`,
    );
    expect(surColonne('in', 'organisation_id')).toEqual([
      ['organisation_id', [UUID_A]],
    ]);
    // `anti_gaspi` est un type de COLLECTE, pas de facture.
    expect(surColonne('in', 'type')).toEqual([['type', ['avoir']]]);
  });

  it('M1.7/factures_liste_mono_conserves — organisation_id / type à valeur unique restent des eq', async () => {
    await get(`organisation_id=${UUID_A}&type=avoir`);
    expect(surColonne('eq', 'organisation_id')).toEqual([
      ['organisation_id', UUID_A],
    ]);
    expect(surColonne('eq', 'type')).toEqual([['type', 'avoir']]);
    expect(admin.__calls.in ?? []).toEqual([]);
  });
});

describe('M1.7 — export CSV factures : respecte Organisation et Type cochés (§12)', () => {
  const exporter = async (qs: string, isStaff = true) => {
    const { buildFacturesExport } = await import('@/lib/exports/builders.js');
    await buildFacturesExport(
      { supabase: admin, isStaff } as unknown as Parameters<
        typeof buildFacturesExport
      >[0],
      new URLSearchParams(qs),
    );
  };

  it('M1.7/export_factures_organisation_ids_types — même filtre que la liste', async () => {
    await exporter(
      `organisation_ids=${UUID_A},nope&types=collecte_antigaspi,inconnu`,
    );
    expect(surColonne('in', 'organisation_id')).toEqual([
      ['organisation_id', [UUID_A]],
    ]);
    expect(surColonne('in', 'type')).toEqual([
      ['type', ['collecte_antigaspi']],
    ]);
  });

  it('M1.7/export_factures_type_mono_conserve — ?type= (exports clients) reste un eq', async () => {
    await exporter('type=avoir', false);
    expect(surColonne('eq', 'type')).toEqual([['type', 'avoir']]);
    expect(admin.__calls.in ?? []).toEqual([]);
    // Brouillons toujours exclus côté client.
    expect(admin.__calls.neq).toContainEqual(['statut', 'brouillon']);
  });
});
