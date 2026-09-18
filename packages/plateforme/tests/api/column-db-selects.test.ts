/**
 * G7 column-db — colonnes sélectionnées par les call-sites corrigés.
 *
 * Chacun de ces SELECT lisait une colonne/relation inexistante (42703 /
 * PGRST200 en runtime, confirmé contre information_schema) :
 *   - bordereaux_savr `fichiers:pdf_fichier_id(url)` (shared.fichiers n'a pas de
 *     `url` ; relation cross-schema non exposée) → pdf_fichier_id puis lecture
 *     explicite shared.fichiers(id, bucket, key) ;
 *   - rapports_rse `fichiers:pdf_url(url)` (pdf_url = text, sans FK) ;
 *   - types_evenements(nom) → libelle ; organisations.type_organisation → type ;
 *     lieux.nom_usuel → nom ;
 *   - associations.distance_km, bordereaux_savr.numero_bordereau/pdf_url,
 *     rapports_rse.statut (gestionnaire, détail événement).
 * (Fiche traiteur gestionnaire : corrigée et testée par #358.)
 * Le test fige la liste EXACTE des colonnes : une réintroduction échoue ici
 * avant d'échouer en prod. (Registre bordereau + ZIP : registre.m4-2.test.ts.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data?: unknown; error?: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (m: string, args: unknown[]) => {
    (calls[m] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'is',
    'gte',
    'order',
    'schema',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = () => Promise.resolve(next());
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let db = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

const proxy = () => ({
  auth: { getUser: mockGetUser, getSession: mockGetSession },
  from: (...a: unknown[]) => (db.from as (...x: unknown[]) => unknown)(...a),
  schema: (...a: unknown[]) =>
    (db.schema as (...x: unknown[]) => unknown)(...a),
  rpc: (...a: unknown[]) => (db.rpc as (...x: unknown[]) => unknown)(...a),
});
vi.mock('@supabase/ssr', () => ({ createServerClient: () => proxy() }));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => proxy(),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: vi.fn(async () => 'https://r2.example/signed-url'),
}));

function setupAuth(role: string, organisationId: string | null = 'org-a') {
  const claims = organisationId
    ? { user_role: role, organisation_id: organisationId }
    : { user_role: role };
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`,
      },
    },
    error: null,
  });
}
const req = (url: string) =>
  new NextRequest(`http://localhost${url}`, { method: 'GET' });
const selects = () => (db.__calls.select ?? []).map((c) => String(c[0]));
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  vi.clearAllMocks();
  db = makeChain();
});

describe('G7 / bordereau PDF : pdf_fichier_id → shared.fichiers(bucket, key)', () => {
  it('admin/bordereaux/:id/download', async () => {
    setupAuth('admin_savr', null);
    db.push({ data: { id: 'b1', statut: 'emis', pdf_fichier_id: 'f1' } });
    db.push({ data: [{ id: 'f1', bucket: 'bordereaux', key: 'b1/v1.pdf' }] });
    const { GET } =
      await import('@/app/api/v1/admin/bordereaux/[id]/download/route.js');
    const res = await GET(req('/api/v1/admin/bordereaux/b1/download'), {
      params: Promise.resolve({ id: 'b1' }),
    });
    expect(res.status).toBe(200);
    expect(selects()).toEqual([
      'id, statut, pdf_fichier_id',
      'id, bucket, key',
    ]);
    expect(db.__calls.schema).toEqual([['shared']]);
    expect(db.__calls.in).toContainEqual(['id', ['f1']]);
    expect(db.__calls.is).toContainEqual(['deleted_at', null]);
    const { getPresignedUrl } = await import('@/lib/pdf/r2-client.js');
    expect(getPresignedUrl).toHaveBeenCalledWith('bordereaux/b1/v1.pdf', 900);
  });

  it('organisateur/documents/bordereau/:id/download', async () => {
    setupAuth('client_organisateur');
    db.push({
      data: {
        id: 'b1',
        genere_at: '2026-06-02T06:00:00Z',
        pdf_fichier_id: 'f1',
      },
    });
    db.push({ data: [{ id: 'f1', bucket: 'bordereaux', key: 'b1/v1.pdf' }] });
    const { GET } =
      await import('@/app/api/v1/organisateur/documents/[type]/[id]/download/route.js');
    const res = await GET(
      req('/api/v1/organisateur/documents/bordereau/b1/download'),
      { params: Promise.resolve({ type: 'bordereau', id: 'b1' }) },
    );
    expect(res.status).toBe(200);
    expect(selects()).toEqual([
      'id, genere_at, pdf_fichier_id',
      'id, bucket, key',
    ]);
    expect(db.__calls.schema).toEqual([['shared']]);
    const { getPresignedUrl } = await import('@/lib/pdf/r2-client.js');
    expect(getPresignedUrl).toHaveBeenCalledWith('bordereaux/b1/v1.pdf', 900);
  });
});

describe('G7 / admin', () => {
  it('rapports-rse/:id/download : pdf_url lu direct (clé R2), sans embed fichiers', async () => {
    setupAuth('admin_savr', null);
    db.push({
      data: {
        id: 'r1',
        disponible_a: '2026-01-01T00:00:00Z',
        genere_at: '2026-01-01T06:00:00Z',
        pdf_url: 'rapports/r1.pdf',
      },
    });
    const { GET } =
      await import('@/app/api/v1/admin/rapports-rse/[id]/download/route.js');
    const res = await GET(req('/api/v1/admin/rapports-rse/r1/download'), {
      params: Promise.resolve({ id: 'r1' }),
    });
    expect(res.status).toBe(200);
    expect(selects()).toEqual(['id, disponible_a, genere_at, pdf_url']);
  });

  it('evenements/:id : types_evenements(libelle)', async () => {
    setupAuth('admin_savr', null);
    db.push({ data: { id: 'e1' } });
    const { GET } = await import('@/app/api/v1/admin/evenements/[id]/route.js');
    await GET(req('/api/v1/admin/evenements/e1'), {
      params: Promise.resolve({ id: 'e1' }),
    });
    const s = norm(selects()[0]!);
    expect(s).toContain('types_evenements!type_evenement_id(libelle)');
    expect(s).not.toContain('(nom)');
  });

  it('factures/:id : organisations(type) + lieux(nom)', async () => {
    setupAuth('admin_savr', null);
    db.push({ data: { id: 'fa1' } });
    const { GET } = await import('@/app/api/v1/admin/factures/[id]/route.js');
    await GET(req('/api/v1/admin/factures/fa1'), {
      params: Promise.resolve({ id: 'fa1' }),
    });
    const s = norm(selects()[0]!);
    expect(s).toContain(
      'organisations!organisation_id(raison_sociale, siret, type)',
    );
    expect(s).toContain('lieux!lieu_id(nom)');
    expect(s).not.toContain('type_organisation');
    expect(s).not.toContain('nom_usuel');
  });
});

describe('G7 / gestionnaire', () => {
  it('evenements/:id : colonnes réelles + bordereau to-one normalisé en tableau', async () => {
    setupAuth('gestionnaire_lieux');
    db.push({
      data: {
        id: 'e1',
        pax: 300,
        collectes: [
          {
            id: 'c1',
            type: 'zero_dechet',
            statut: 'cloturee',
            attributions_antgaspi: null,
            // collecte_id UNIQUE → OBJET PostgREST.
            bordereaux_savr: {
              id: 'b1',
              numero: 'BSAV-2026-00001',
              statut: 'emis',
            },
            rapports_rse: [],
            attestations_don: [],
          },
        ],
      },
    });
    db.push({ data: null }); // f_dechets_labo_estimes
    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/[id]/route.js');
    const res = await GET(req('/api/v1/gestionnaire/evenements/e1'), {
      params: Promise.resolve({ id: 'e1' }),
    });
    expect(res.status).toBe(200);
    const s = norm(selects()[0]!);
    expect(s).toContain('associations!association_id(nom, ville)');
    expect(s).toContain('bordereaux_savr(id, numero, statut)');
    expect(s).toContain('rapports_rse(id, pdf_url)');
    for (const fantome of [
      'distance_km',
      'numero_bordereau',
      'rapports_rse(id, statut',
    ])
      expect(s).not.toContain(fantome);
    const json = (await res.json()) as {
      data: { collectes: { bordereaux_savr: { numero: string }[] }[] };
    };
    expect(json.data.collectes[0]!.bordereaux_savr).toEqual([
      { id: 'b1', numero: 'BSAV-2026-00001', statut: 'emis' },
    ]);
  });
});
