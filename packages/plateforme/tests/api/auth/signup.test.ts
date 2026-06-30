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
import { _resetSignupRateLimit } from '@/lib/signup-rate-limit.js';
import { CGU_VERSION_COURANTE } from '@/lib/cgu.js';
import { verifySiret } from '@savr/shared/src/api/siret.js';
import { enqueueSiretRevalidation } from '@savr/shared/src/siret/revalidation.js';

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

const INSERT_SINGLE_DEFAULTS: Record<string, Resp> = {
  organisations: { data: { id: 'org-1' }, error: null },
  entites_facturation: { data: { id: 'entite-1' }, error: null },
};

function makeInsertResult(table: string): Record<string, unknown> {
  // Objet renvoyé par insert() : chaînable (.select().single()) ET awaitable (then).
  // insertResult[table] (si défini) override le défaut — permet de simuler une
  // violation UNIQUE (23505) sur l'insert entites_facturation / domaine.
  const r: Record<string, unknown> = {
    select: () => r,
    single: () =>
      Promise.resolve(
        insertResult[table] ??
          INSERT_SINGLE_DEFAULTS[table] ?? { data: null, error: null },
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
  isValidSiretFormat: (s: string) => /^\d{14}$/.test(s.trim()),
}));
vi.mock('@savr/shared/src/siret/revalidation.js', () => ({
  enqueueSiretRevalidation: vi.fn().mockResolvedValue(undefined),
}));

function makeReq(body: unknown, ip?: string): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (ip) headers['x-forwarded-for'] = ip;
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
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
  siret: '12345678901234',
  acceptation_cgu: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetSignupRateLimit();
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

describe('signup / rate-limiting (§15 §2.6 — max 5/IP/heure)', () => {
  it('429 + Retry-After à la 6e tentative sur la même IP', async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const IP = '203.0.113.7';

    // Les 5 premières passent (ne sont pas bloquées par le limiteur).
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeReq(VALID_BODY, IP));
      expect(res.status).not.toBe(429);
    }

    // La 6e est refusée AVANT tout travail DB.
    const sixth = await POST(makeReq(VALID_BODY, IP));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('Retry-After')).toBeTruthy();
  });

  it('une autre IP n’est pas affectée par le quota d’une IP saturée', async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');
    for (let i = 0; i < 6; i++) await POST(makeReq(VALID_BODY, '203.0.113.7'));

    const autre = await POST(makeReq(VALID_BODY, '198.51.100.9'));
    expect(autre.status).not.toBe(429);
  });
});

describe('M0.4 — persistance acceptation CGU (BL-P0-04, preuve opposable)', () => {
  it('la création de compte persiste cgu_accepte_le (horodatage) + cgu_version', async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(201);

    // L'INSERT users porte désormais la trace d'acceptation des CGU — un code qui
    // se contente de jeter le booléen `acceptation_cgu` ferait rougir ces asserts.
    const userInsert = insertCalls.find((c) => c.table === 'users');
    expect(userInsert).toBeDefined();

    // Version du texte CGU acceptée = constante courante (preuve : quelle version).
    expect(userInsert!.payload.cgu_version).toBe(CGU_VERSION_COURANTE);

    // Horodatage = instant d'acceptation, ISO 8601 non NULL (preuve : quand).
    const accepteLe = userInsert!.payload.cgu_accepte_le;
    expect(accepteLe).toBeTruthy();
    expect(typeof accepteLe).toBe('string');
    expect(Number.isNaN(Date.parse(accepteLe as string))).toBe(false);
  });

  it('422 si acceptation_cgu absente ou false (garde CGU préservée)', async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');

    // acceptation_cgu = false → refus AVANT tout travail DB (aucun user créé).
    const resFalse = await POST(
      makeReq({ ...VALID_BODY, acceptation_cgu: false }),
    );
    expect(resFalse.status).toBe(422);

    // acceptation_cgu absente du payload → même refus.
    const { acceptation_cgu, ...sansCgu } = VALID_BODY;
    void acceptation_cgu;
    const resAbsent = await POST(makeReq(sansCgu));
    expect(resAbsent.status).toBe(422);

    // Aucune création de compte : pas d'INSERT users sur le chemin refusé.
    expect(insertCalls.some((c) => c.table === 'users')).toBe(false);
  });
});

describe('M0.4 — SIRET au signup + vérif synchrone (BL-P1-ONB-01)', () => {
  it('SIRET valide → 201, entité créée avec le SIRET réel + siret_verification=verifie', async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(201);
    const entiteInsert = insertCalls.find(
      (c) => c.table === 'entites_facturation',
    );
    expect(entiteInsert).toBeDefined();
    // Plus de siret:'' (chemin mort) — la vraie valeur est persistée.
    expect(entiteInsert!.payload.siret).toBe('12345678901234');
    expect(entiteInsert!.payload.siret_verification).toBe('verifie');
    expect(vi.mocked(verifySiret)).toHaveBeenCalledWith('12345678901234');
  });

  it('SIRET au mauvais format → 422 AVANT tout appel INSEE et toute création', async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq({ ...VALID_BODY, siret: '123' }));

    expect(res.status).toBe(422);
    expect(vi.mocked(verifySiret)).not.toHaveBeenCalled();
    expect(insertCalls.some((c) => c.table === 'organisations')).toBe(false);
  });

  it('SIRET absent sur un chemin de création → 422', async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const { siret, ...sansSiret } = VALID_BODY;
    void siret;
    const res = await POST(makeReq(sansSiret));

    expect(res.status).toBe(422);
    expect(insertCalls.some((c) => c.table === 'organisations')).toBe(false);
  });

  it("INSEE répond 'echec' (SIRET inexistant/inactif) → 422 bloquant, aucune orga créée", async () => {
    vi.mocked(verifySiret).mockResolvedValueOnce('echec');
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(422);
    expect(insertCalls.some((c) => c.table === 'organisations')).toBe(false);
  });

  it("INSEE injoignable ('down') → 201 NON bloquant, entité en_attente + revalidation planifiée", async () => {
    vi.mocked(verifySiret).mockResolvedValueOnce('down');
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq(VALID_BODY));

    // Jamais de hard-block sur une API tierce down (§15 §2.6 l.73).
    expect(res.status).toBe(201);
    const entiteInsert = insertCalls.find(
      (c) => c.table === 'entites_facturation',
    );
    expect(entiteInsert!.payload.siret_verification).toBe('en_attente');
    // Revalidation asynchrone enqueue (3 paliers).
    expect(vi.mocked(enqueueSiretRevalidation)).toHaveBeenCalledWith(
      expect.anything(),
      'entite-1',
    );
  });

  it('mot de passe trop faible → 422 (CDC §09 : 10c + maj + chiffre + spécial)', async () => {
    const { POST } = await import('@/app/api/auth/signup/route.js');
    // 'abc' : trop court, pas de maj/chiffre/spécial.
    const res = await POST(makeReq({ ...VALID_BODY, mot_de_passe: 'abc' }));

    expect(res.status).toBe(422);
    expect(vi.mocked(verifySiret)).not.toHaveBeenCalled();
    expect(insertCalls.some((c) => c.table === 'organisations')).toBe(false);
  });
});

describe('M0.4 — détection doublons SIRET / domaine (BL-P1-ONB-03)', () => {
  it('SIRET déjà rattaché (pré-check) → 409, pas d’appel INSEE', async () => {
    maybeSingleQueue['entites_facturation'] = [
      { data: { id: 'entite-existante' }, error: null },
    ];
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(409);
    expect(vi.mocked(verifySiret)).not.toHaveBeenCalled();
    expect(insertCalls.some((c) => c.table === 'organisations')).toBe(false);
  });

  it('SIRET en collision à l’insert (race UNIQUE 23505) → 409 + rollback', async () => {
    insertResult['entites_facturation'] = {
      data: null,
      error: { code: '23505' },
    };
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(409);
    expect(deleteCalls.some((c) => c.table === 'organisations')).toBe(true);
  });

  it('domaine déjà rattaché à l’insert (race UNIQUE 23505) → 409 + rollback', async () => {
    insertResult['organisations_domaines_email'] = {
      data: null,
      error: { code: '23505' },
    };
    const { POST } = await import('@/app/api/auth/signup/route.js');
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(409);
    expect(deleteCalls.some((c) => c.table === 'organisations')).toBe(true);
  });
});
