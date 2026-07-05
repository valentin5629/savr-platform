/**
 * M3.1 — BL-P1-TRAIT-01 « Mon organisation » traiteur éditable.
 * Couvre : édition infos légales (manager + audit), CRUD entités de facturation
 * (verify SIRET / doublon), CRUD domaines email, actions équipe (rôle / suspend /
 * transfert), et le cloisonnement de rôle (commercial = lecture seule).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    __queue: queue,
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
    'neq',
    'order',
    'ilike',
    'update',
    'insert',
    'delete',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain();
let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockVerifySiret = vi.fn();
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockSendEmail = vi.fn().mockResolvedValue(undefined);
const mockCreateUser = vi.fn();
const mockGenerateLink = vi.fn();
const mockDeleteUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (...a: unknown[]) =>
      (admin.from as (...x: unknown[]) => unknown)(...a),
    auth: {
      admin: {
        createUser: mockCreateUser,
        generateLink: mockGenerateLink,
        deleteUser: mockDeleteUser,
      },
    },
  }),
}));
vi.mock('@savr/shared/src/api/siret.js', () => ({
  verifySiret: (...a: unknown[]) => mockVerifySiret(...a),
  isValidSiretFormat: () => true,
}));
vi.mock('@savr/shared/src/siret/revalidation.js', () => ({
  enqueueSiretRevalidation: (...a: unknown[]) => mockEnqueue(...a),
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));
const mockUploadObject = vi.fn();
vi.mock('@savr/shared/src/r2/upload.js', () => ({
  uploadObject: (...a: unknown[]) => mockUploadObject(...a),
  getObject: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId = 'org-1', userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
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
function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
  mockEnqueue.mockResolvedValue(undefined);
});

// ── Informations légales ────────────────────────────────────────────────────
describe('M3.1 / mon-organisation infos légales', () => {
  it('M3.1/trait_monorga_profil_patch_audit — manager édite et audite', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: { raison_sociale: 'Ancien', siret: '111', adresse: 'A' },
      error: null,
    });
    rls.push({
      data: { id: 'org-1', raison_sociale: 'Nouveau', siret: '111' },
      error: null,
    });
    admin.push({ data: null, error: null }); // insert audit_log
    const { PATCH } =
      await import('@/app/api/v1/traiteur/mon-organisation/profil/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/mon-organisation/profil', {
        raison_sociale: 'Nouveau',
      }),
    );
    expect(res.status).toBe(200);
    const insertArgs = admin.__calls.insert?.[0]?.[0] as {
      action: string;
      table_name: string;
    };
    expect(insertArgs.action).toBe('organisation_infos_legales_update');
    expect(insertArgs.table_name).toBe('organisations');
  });

  it('M3.1/trait_monorga_profil_commercial_readonly — commercial refusé (403)', async () => {
    setupAuth('traiteur_commercial');
    const { PATCH } =
      await import('@/app/api/v1/traiteur/mon-organisation/profil/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/mon-organisation/profil', {
        raison_sociale: 'Hack',
      }),
    );
    expect(res.status).toBe(403);
  });
});

// ── Entités de facturation ──────────────────────────────────────────────────
describe('M3.1 / mon-organisation entités facturation', () => {
  const bodyEntite = {
    raison_sociale: 'Kaspia Events',
    siret: '11111111100017',
    adresse_facturation: '3 rue',
    code_postal: '75003',
    ville: 'Paris',
  };

  it('M3.1/trait_monorga_entites_create — manager crée, SIRET vérifié', async () => {
    setupAuth('traiteur_manager');
    admin.push({ data: null, error: null }); // doublon check → aucun
    mockVerifySiret.mockResolvedValue('verifie');
    rls.push({
      data: { id: 'e1', siret_verification: 'verifie' },
      error: null,
    }); // insert
    const { POST } =
      await import('@/app/api/v1/traiteur/mon-organisation/entites-facturation/route.js');
    const res = await POST(
      makeReq(
        'POST',
        '/api/v1/traiteur/mon-organisation/entites-facturation',
        bodyEntite,
      ),
    );
    expect(res.status).toBe(201);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('M3.1/trait_monorga_entites_siret_echec — INSEE echec → 422', async () => {
    setupAuth('traiteur_manager');
    admin.push({ data: null, error: null }); // doublon check
    mockVerifySiret.mockResolvedValue('echec');
    const { POST } =
      await import('@/app/api/v1/traiteur/mon-organisation/entites-facturation/route.js');
    const res = await POST(
      makeReq(
        'POST',
        '/api/v1/traiteur/mon-organisation/entites-facturation',
        bodyEntite,
      ),
    );
    expect(res.status).toBe(422);
  });

  it('M3.1/trait_monorga_entites_doublon — SIRET déjà rattaché → 409', async () => {
    setupAuth('traiteur_manager');
    admin.push({ data: { id: 'autre' }, error: null }); // doublon trouvé
    const { POST } =
      await import('@/app/api/v1/traiteur/mon-organisation/entites-facturation/route.js');
    const res = await POST(
      makeReq(
        'POST',
        '/api/v1/traiteur/mon-organisation/entites-facturation',
        bodyEntite,
      ),
    );
    expect(res.status).toBe(409);
    expect(mockVerifySiret).not.toHaveBeenCalled();
  });

  it('M3.1/trait_monorga_entites_commercial_denied — commercial refusé (403)', async () => {
    setupAuth('traiteur_commercial');
    const { POST } =
      await import('@/app/api/v1/traiteur/mon-organisation/entites-facturation/route.js');
    const res = await POST(
      makeReq(
        'POST',
        '/api/v1/traiteur/mon-organisation/entites-facturation',
        bodyEntite,
      ),
    );
    expect(res.status).toBe(403);
  });

  it('M3.1/trait_monorga_entites_patch — manager édite un champ (sans SIRET)', async () => {
    setupAuth('traiteur_manager');
    rls.push({ data: { id: 'e1', raison_sociale: 'Kaspia v2' }, error: null }); // update
    const { PATCH } =
      await import('@/app/api/v1/traiteur/mon-organisation/entites-facturation/[id]/route.js');
    const res = await PATCH(
      makeReq(
        'PATCH',
        '/api/v1/traiteur/mon-organisation/entites-facturation/e1',
        { raison_sociale: 'Kaspia v2', email_facturation: 'compta@kaspia.fr' },
      ),
      { params: Promise.resolve({ id: 'e1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockVerifySiret).not.toHaveBeenCalled();
  });

  it('M3.1/trait_monorga_entites_patch_siret_reverif — changement de SIRET relance INSEE', async () => {
    setupAuth('traiteur_manager');
    admin.push({ data: null, error: null }); // doublon cross-entité
    mockVerifySiret.mockResolvedValue('verifie');
    rls.push({
      data: { id: 'e1', siret_verification: 'verifie' },
      error: null,
    }); // update
    const { PATCH } =
      await import('@/app/api/v1/traiteur/mon-organisation/entites-facturation/[id]/route.js');
    const res = await PATCH(
      makeReq(
        'PATCH',
        '/api/v1/traiteur/mon-organisation/entites-facturation/e1',
        { siret: '11111111100033' },
      ),
      { params: Promise.resolve({ id: 'e1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockVerifySiret).toHaveBeenCalledOnce();
  });

  it('M3.1/trait_monorga_entites_delete — soft-delete d’une entité non par-défaut', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: { id: 'e1', entite_par_defaut: false, actif: true },
      error: null,
    }); // read cible
    rls.push({ data: { id: 'e1', actif: false }, error: null }); // update actif=false
    const { DELETE } =
      await import('@/app/api/v1/traiteur/mon-organisation/entites-facturation/[id]/route.js');
    const res = await DELETE(
      makeReq(
        'DELETE',
        '/api/v1/traiteur/mon-organisation/entites-facturation/e1',
      ),
      { params: Promise.resolve({ id: 'e1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('M3.1/trait_monorga_entites_delete_defaut_bloque — entité par défaut non supprimable (409)', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: { id: 'e1', entite_par_defaut: true, actif: true },
      error: null,
    }); // read cible
    const { DELETE } =
      await import('@/app/api/v1/traiteur/mon-organisation/entites-facturation/[id]/route.js');
    const res = await DELETE(
      makeReq(
        'DELETE',
        '/api/v1/traiteur/mon-organisation/entites-facturation/e1',
      ),
      { params: Promise.resolve({ id: 'e1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('M3.1/trait_monorga_entites_patch_commercial_denied — commercial refusé (403)', async () => {
    setupAuth('traiteur_commercial');
    const { PATCH } =
      await import('@/app/api/v1/traiteur/mon-organisation/entites-facturation/[id]/route.js');
    const res = await PATCH(
      makeReq(
        'PATCH',
        '/api/v1/traiteur/mon-organisation/entites-facturation/e1',
        { raison_sociale: 'Hack' },
      ),
      { params: Promise.resolve({ id: 'e1' }) },
    );
    expect(res.status).toBe(403);
  });
});

// ── Domaines email ──────────────────────────────────────────────────────────
describe('M3.1 / mon-organisation domaines email', () => {
  it('M3.1/trait_monorga_domaines_create — manager ajoute un domaine', async () => {
    setupAuth('traiteur_manager');
    rls.push({ data: { id: 'd1', domaine: 'kaspia.fr' }, error: null });
    const { POST } =
      await import('@/app/api/v1/traiteur/mon-organisation/domaines-email/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/mon-organisation/domaines-email', {
        domaine: 'kaspia.fr',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M3.1/trait_monorga_domaines_dup — domaine global déjà pris → 409', async () => {
    setupAuth('traiteur_manager');
    rls.push({ data: null, error: { code: '23505' } });
    const { POST } =
      await import('@/app/api/v1/traiteur/mon-organisation/domaines-email/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/mon-organisation/domaines-email', {
        domaine: 'gmail.com',
      }),
    );
    expect(res.status).toBe(409);
  });

  it('M3.1/trait_monorga_domaines_commercial_denied — commercial refusé (403)', async () => {
    setupAuth('traiteur_commercial');
    const { POST } =
      await import('@/app/api/v1/traiteur/mon-organisation/domaines-email/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/mon-organisation/domaines-email', {
        domaine: 'kaspia.fr',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('M3.1/trait_monorga_domaines_delete — manager supprime un domaine', async () => {
    setupAuth('traiteur_manager');
    rls.push({ data: { id: 'd1' }, error: null }); // delete...select...maybeSingle
    const { DELETE } =
      await import('@/app/api/v1/traiteur/mon-organisation/domaines-email/[id]/route.js');
    const res = await DELETE(
      makeReq('DELETE', '/api/v1/traiteur/mon-organisation/domaines-email/d1'),
      { params: Promise.resolve({ id: 'd1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('M3.1/trait_monorga_domaines_delete_hors_org — domaine hors org → 404', async () => {
    setupAuth('traiteur_manager');
    rls.push({ data: null, error: null }); // rien supprimé (RLS filtre)
    const { DELETE } =
      await import('@/app/api/v1/traiteur/mon-organisation/domaines-email/[id]/route.js');
    const res = await DELETE(
      makeReq('DELETE', '/api/v1/traiteur/mon-organisation/domaines-email/dX'),
      { params: Promise.resolve({ id: 'dX' }) },
    );
    expect(res.status).toBe(404);
  });
});

// ── Équipe : rôle / suspend / transfert ─────────────────────────────────────
describe('M3.1 / mon-organisation équipe', () => {
  it('M3.1/trait_monorga_equipe_role — manager change le rôle', async () => {
    setupAuth('traiteur_manager');
    rls.push({ data: { id: 'u2', role: 'traiteur_manager' }, error: null });
    const { PATCH } =
      await import('@/app/api/v1/traiteur/equipe/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/equipe/u2', {
        role: 'traiteur_manager',
      }),
      { params: Promise.resolve({ id: 'u2' }) },
    );
    expect(res.status).toBe(200);
  });

  it('M3.1/trait_monorga_equipe_role_escalade — rôle non traiteur refusé (422)', async () => {
    setupAuth('traiteur_manager');
    const { PATCH } =
      await import('@/app/api/v1/traiteur/equipe/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/equipe/u2', { role: 'admin_savr' }),
      { params: Promise.resolve({ id: 'u2' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M3.1/trait_monorga_equipe_suspend_self — auto-suspension interdite (403)', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    const { PATCH } =
      await import('@/app/api/v1/traiteur/equipe/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/equipe/user-1', { actif: false }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M3.1/trait_monorga_equipe_suspend — manager suspend un collègue', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    rls.push({ data: { id: 'u2', actif: false }, error: null });
    const { PATCH } =
      await import('@/app/api/v1/traiteur/equipe/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/equipe/u2', { actif: false }),
      { params: Promise.resolve({ id: 'u2' }) },
    );
    expect(res.status).toBe(200);
  });

  it('M3.1/trait_monorga_transfert — réassigne les collectes source→cible', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    admin.push({
      data: [
        { id: 'src', role: 'traiteur_commercial', organisation_id: 'org-1' },
        { id: 'dst', role: 'traiteur_commercial', organisation_id: 'org-1' },
      ],
      error: null,
    }); // membres
    admin.push({ data: [{ id: 'e1' }, { id: 'e2' }], error: null }); // update evenements
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/transfert/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/transfert', {
        source_user_id: 'src',
        cible_user_id: 'dst',
      }),
    );
    const json = (await res.json()) as { data: { transferes: number } };
    expect(res.status).toBe(200);
    expect(json.data.transferes).toBe(2);
  });

  it('M3.1/trait_monorga_transfert_hors_org — cible hors org → 404', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    // Seul la source est membre : la cible n'apparaît pas → 404.
    admin.push({
      data: [
        { id: 'src', role: 'traiteur_commercial', organisation_id: 'org-1' },
      ],
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/transfert/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/transfert', {
        source_user_id: 'src',
        cible_user_id: 'dst-autre-org',
      }),
    );
    expect(res.status).toBe(404);
  });

  it('M3.1/trait_monorga_equipe_liste_commercial_denied — liste équipe masquée au commercial (403)', async () => {
    setupAuth('traiteur_commercial');
    const { GET } = await import('@/app/api/v1/traiteur/equipe/route.js');
    const res = await GET(makeReq('GET', '/api/v1/traiteur/equipe'));
    expect(res.status).toBe(403);
  });
});

// ── Logo ────────────────────────────────────────────────────────────────────
describe('M3.1 / mon-organisation logo', () => {
  function makeUploadReq(role: string): NextRequest {
    setupAuth(role);
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }),
    );
    return new NextRequest(
      'http://localhost/api/v1/traiteur/mon-organisation/logo',
      { method: 'POST', body: form },
    );
  }

  it('M3.1/trait_monorga_logo_upload — manager upload logo (201)', async () => {
    mockUploadObject.mockResolvedValue('savr-dev/logos/abc.png');
    const { POST } =
      await import('@/app/api/v1/traiteur/mon-organisation/logo/route.js');
    const res = await POST(makeUploadReq('traiteur_manager'));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { logo_url: string };
    expect(json.logo_url).toBe('savr-dev/logos/abc.png');
  });

  it('M3.1/trait_monorga_logo_commercial_denied — commercial refusé (403)', async () => {
    const { POST } =
      await import('@/app/api/v1/traiteur/mon-organisation/logo/route.js');
    const res = await POST(makeUploadReq('traiteur_commercial'));
    expect(res.status).toBe(403);
    expect(mockUploadObject).not.toHaveBeenCalled();
  });
});
