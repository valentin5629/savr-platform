/**
 * Tests API /api/auth/signup — inscription self-service.
 *
 * Couvre le chemin « création nouvelle organisation » qui n'avait AUCUNE couverture
 * (d'où le bug : payload organisations sans `nom` NOT NULL → toute inscription créant
 * une orga échouait). Vérifie :
 *   - le payload d'insert organisations contient `nom` (= raison_sociale) et `telephone`
 *   - en cas d'échec de l'insert users : rollback (deleteUser + suppression orga créée)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Resp = { data?: unknown; error?: unknown };

// ── État du mock Supabase ────────────────────────────────────────────────────
let lastTable = '';
let insertCalls: Array<{ table: string; payload: Record<string, unknown> }> =
  [];
let deleteCalls: Array<{ table: string }> = [];
const maybeSingleQueue: Record<string, Resp[]> = {};
const insertResult: Record<string, Resp> = {};

function shift(q: Record<string, Resp[]>, table: string): Resp | undefined {
  return q[table]?.shift();
}

function makeInsertResult(table: string): Record<string, unknown> {
  // Objet renvoyé par insert() : chaînable (.select().single()) ET awaitable (then).
  const r: Record<string, unknown> = {
    select: () => r,
    single: () =>
      Promise.resolve(
        table === 'organisations'
          ? { data: { id: 'org-1' }, error: null }
          : { data: null, error: null },
      ),
    then: (resolve: (v: Resp) => void) =>
      resolve(insertResult[table] ?? { data: null, error: null }),
  };
  return r;
}

const chain: Record<string, unknown> = {
  select: () => chain,
  eq: () => chain,
  insert: vi.fn((payload: Record<string, unknown>) => {
    insertCalls.push({ table: lastTable, payload });
    return makeInsertResult(lastTable);
  }),
  delete: vi.fn(() => {
    deleteCalls.push({ table: lastTable });
    return chain;
  }),
  maybeSingle: () =>
    Promise.resolve(
      shift(maybeSingleQueue, lastTable) ?? { data: null, error: null },
    ),
  single: () => Promise.resolve({ data: { id: 'org-1' }, error: null }),
  then: (resolve: (v: Resp) => void) => resolve({ data: null, error: null }),
};

const mockCreateUser = vi.fn();
const mockDeleteUser = vi.fn();
const mockGenerateLink = vi.fn();

const mockSupabase = {
  from: vi.fn((table: string) => {
    lastTable = table;
    return chain;
  }),
  auth: {
    admin: {
      createUser: mockCreateUser,
      deleteUser: mockDeleteUser,
      generateLink: mockGenerateLink,
    },
  },
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabase,
}));
vi.mock('@savr/shared/src/email-denylist.js', () => ({
  isDisposableEmail: () => false,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@savr/shared/src/api/siret.js', () => ({
  verifySiret: vi.fn().mockResolvedValue('verifie'),
}));
vi.mock('@savr/shared/src/api/tva.js', () => ({
  verifyTva: vi.fn().mockResolvedValue('valide'),
}));

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const VALID_BODY = {
  email: 'jean@traiteur-test.fr',
  mot_de_passe: 'SavrTest2026!',
  prenom: 'Jean',
  nom: 'Dupont',
  telephone: '0102030405',
  type_profil: 'traiteur',
  raison_sociale: 'Traiteur Test SAS',
  acceptation_cgu: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  lastTable = '';
  insertCalls = [];
  deleteCalls = [];
  for (const k of Object.keys(maybeSingleQueue)) delete maybeSingleQueue[k];
  for (const k of Object.keys(insertResult)) delete insertResult[k];
  mockCreateUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGenerateLink.mockResolvedValue({
    data: { properties: { hashed_token: 'tok' } },
    error: null,
  });
  mockDeleteUser.mockResolvedValue({ data: {}, error: null });
});

describe('signup / nouvelle organisation (BUG 1)', () => {
  it("le payload d'insert organisations contient nom (= raison_sociale) et telephone", async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(201);

    // L'insert organisations est le seul payload portant `type`.
    const orgInsert = insertCalls.find((c) => c.table === 'organisations');
    expect(orgInsert).toBeDefined();
    expect(orgInsert!.payload.nom).toBe('Traiteur Test SAS');
    expect(orgInsert!.payload.raison_sociale).toBe('Traiteur Test SAS');
    expect(orgInsert!.payload.type).toBe('traiteur');
    expect(orgInsert!.payload.telephone).toBe('0102030405');
  });

  it("rollback (deleteUser + suppression orga) si l'insert users échoue", async () => {
    // Domaine public → orga isolée créée dans cette requête (orgCreee=true).
    maybeSingleQueue['domaines_email_publics'] = [
      { data: { domaine: 'traiteur-test.fr' }, error: null },
    ];
    // L'insert users échoue.
    insertResult['users'] = { data: null, error: { message: 'duplicate key' } };

    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(422);
    // Compte Auth supprimé.
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
    // Organisation nouvellement créée supprimée (best-effort).
    expect(deleteCalls.some((c) => c.table === 'organisations')).toBe(true);
  });

  it('422 si telephone manquant (contrat inchangé)', async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const { telephone, ...sansTel } = VALID_BODY;
    void telephone;
    const res = await POST(makeReq(sansTel));
    expect(res.status).toBe(422);
  });
});
