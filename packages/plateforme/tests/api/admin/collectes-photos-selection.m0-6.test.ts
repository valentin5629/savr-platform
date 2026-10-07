/**
 * M0.6 — Photos de collecte visibles du client : choix par l'équipe Savr.
 * Décisions Val 2026-10-07 (divergence M0.6_20261007_photos-collecte-selection-admin) :
 *  - le client ne voit que les photos choisies dans la fiche collecte Admin ;
 *  - 2 photos au maximum par collecte ;
 *  - une photo importée à la main par l'Admin est choisie d'office s'il reste
 *    une place ;
 *  - une photo remontée par le transporteur naît non choisie.
 *
 * Routes : PATCH /api/v1/admin/collectes/[id]/photos/[photoId] (choisir / retirer)
 *          POST  /api/v1/admin/collectes/[id]/photos           (import manuel)
 *
 * Le faux client garde les lignes de shared.fichiers en mémoire, applique
 * RÉELLEMENT les filtres posés par les routes et reproduit l'index unique de la
 * base (une seule photo par rang et par collecte → erreur 23505).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Ligne = Record<string, unknown>;

const COLLECTE = '11111111-1111-4111-8111-111111111111';
const AUTRE_COLLECTE = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const P_AUTRE = 'aaaaaaaa-0000-4000-8000-000000000004';
const P_SUPPRIMEE = 'aaaaaaaa-0000-4000-8000-000000000005';
const P_PDF = 'aaaaaaaa-0000-4000-8000-000000000006';

const photo = (id: string, surcharge: Ligne = {}): Ligne => ({
  id,
  bucket: 'savr-test',
  key: `photos/${id}.jpg`,
  content_type: 'image/jpeg',
  entity_type: 'plateforme.collectes',
  entity_id: COLLECTE,
  deleted_at: null,
  rang_client: null,
  created_at: '2026-07-16T00:05:00Z',
  ...surcharge,
});

let fichiers: Ligne[] = [];
let audits: Ligne[] = [];
// Simule une sélection concurrente : joué juste avant l'écriture de la route.
let avantEcriture: (() => void) | null = null;

const rangDe = (id: string): unknown =>
  fichiers.find((l) => l['id'] === id)?.['rang_client'];

// Photos de la collecte que le client verrait : choisies et non supprimées.
const choisies = (): Ligne[] =>
  fichiers.filter(
    (l) =>
      l['entity_id'] === COLLECTE &&
      l['deleted_at'] == null &&
      l['rang_client'] != null,
  );

// Index unique de la base : au plus une photo non supprimée par (collecte, rang).
function rangDejaPris(candidat: Ligne): boolean {
  if (candidat['rang_client'] == null || candidat['deleted_at'] != null) {
    return false;
  }
  return fichiers.some(
    (l) =>
      l['id'] !== candidat['id'] &&
      l['deleted_at'] == null &&
      l['entity_type'] === candidat['entity_type'] &&
      l['entity_id'] === candidat['entity_id'] &&
      l['rang_client'] === candidat['rang_client'],
  );
}

type Resultat = { data: Ligne[] | null; error: { code: string } | null };

function requeteFichiers() {
  const filtres: ((l: Ligne) => boolean)[] = [];
  let ecriture: { op: 'update' | 'insert'; valeurs: Ligne } | null = null;

  const executer = (): Resultat => {
    if (ecriture?.op === 'insert') {
      avantEcriture?.();
      const ligne = photo(
        `bbbbbbbb-0000-4000-8000-${String(fichiers.length).padStart(12, '0')}`,
        ecriture.valeurs,
      );
      if (rangDejaPris(ligne)) return { data: null, error: { code: '23505' } };
      fichiers.push(ligne);
      return { data: [ligne], error: null };
    }
    if (ecriture?.op === 'update') {
      avantEcriture?.();
      const cibles = fichiers.filter((l) => filtres.every((f) => f(l)));
      for (const l of cibles) {
        if (rangDejaPris({ ...l, ...ecriture.valeurs })) {
          return { data: null, error: { code: '23505' } };
        }
      }
      for (const l of cibles) Object.assign(l, ecriture.valeurs);
      return { data: cibles, error: null };
    }
    return {
      data: fichiers.filter((l) => filtres.every((f) => f(l))),
      error: null,
    };
  };

  const c = {
    select: () => c,
    eq: (col: string, val: unknown) => {
      filtres.push((l) => l[col] === val);
      return c;
    },
    is: (col: string, val: unknown) => {
      filtres.push((l) => (l[col] ?? null) === val);
      return c;
    },
    // Seule forme utilisée par le code : .not(col, 'is', null).
    not: (col: string, _op: string, val: unknown) => {
      filtres.push((l) => (l[col] ?? null) !== val);
      return c;
    },
    like: (col: string, motif: string) => {
      const prefixe = motif.replace(/%$/, '');
      filtres.push((l) => String(l[col]).startsWith(prefixe));
      return c;
    },
    update: (valeurs: Ligne) => {
      ecriture = { op: 'update', valeurs };
      return c;
    },
    insert: (valeurs: Ligne) => {
      ecriture = { op: 'insert', valeurs };
      return c;
    },
    maybeSingle: async () => {
      const r = executer();
      return { data: r.data?.[0] ?? null, error: r.error };
    },
    single: async () => {
      const r = executer();
      return { data: r.data?.[0] ?? null, error: r.error };
    },
    then: (resolve: (r: Resultat) => unknown) => resolve(executer()),
  };
  return c;
}

function requetePlateforme(table: string) {
  const c = {
    select: () => c,
    eq: () => c,
    // Garde d'existence de la collecte (import manuel).
    maybeSingle: async () => ({ data: { id: COLLECTE }, error: null }),
    insert: (valeurs: Ligne) => {
      if (table === 'audit_log') audits.push(valeurs);
      return Promise.resolve({ data: null, error: null });
    },
  };
  return c;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => requetePlateforme(table),
    schema: () => ({ from: () => requeteFichiers() }),
  }),
}));

const uploadObject = vi.fn(async () => undefined);
vi.mock('@savr/shared/src/r2/upload.js', () => ({
  uploadObject: (...args: unknown[]) => uploadObject(...(args as [])),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
function setupAuth(role: string): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

async function choisir(
  photoId: string,
  corps: unknown,
  collecteId = COLLECTE,
): Promise<Response> {
  const { PATCH } =
    await import('@/app/api/v1/admin/collectes/[id]/photos/[photoId]/route.js');
  return PATCH(
    new NextRequest(
      `http://localhost/api/v1/admin/collectes/${collecteId}/photos/${photoId}`,
      { method: 'PATCH', body: JSON.stringify(corps) },
    ),
    { params: Promise.resolve({ id: collecteId, photoId }) },
  );
}

async function importer(): Promise<Response> {
  const { POST } =
    await import('@/app/api/v1/admin/collectes/[id]/photos/route.js');
  const fd = new FormData();
  fd.append('file', new File(['x'], 'photo.png', { type: 'image/png' }));
  return POST(
    new NextRequest(
      `http://localhost/api/v1/admin/collectes/${COLLECTE}/photos`,
      { method: 'POST', body: fd },
    ),
    { params: Promise.resolve({ id: COLLECTE }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fichiers = [
    photo(P1),
    photo(P2),
    photo(P3),
    // Une autre collecte a déjà sa photo choisie : elle ne doit ni compter dans
    // la limite de CETTE collecte, ni pouvoir être modifiée depuis elle.
    photo(P_AUTRE, { entity_id: AUTRE_COLLECTE, rang_client: 1 }),
    // Photo choisie puis supprimée : elle ne compte plus et ne se modifie plus.
    photo(P_SUPPRIMEE, { deleted_at: '2026-07-17T00:00:00Z', rang_client: 2 }),
    photo(P_PDF, { content_type: 'application/pdf' }),
  ];
  audits = [];
  avantEcriture = null;
  setupAuth('ops_savr');
});

describe('M0.6 — PATCH admin/collectes/[id]/photos/[photoId] : photo visible du client', () => {
  it('choisir une photo : elle prend la première place libre, la suivante la seconde', async () => {
    const r1 = await choisir(P1, { visible_client: true });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({
      photo: { id: P1, visible_client: true },
    });
    expect(rangDe(P1)).toBe(1);

    const r2 = await choisir(P2, { visible_client: true });
    expect(r2.status).toBe(200);
    expect(rangDe(P2)).toBe(2);

    // Une ligne d'audit par choix, rattachée à la collecte.
    expect(audits).toEqual([
      expect.objectContaining({
        table_name: 'collectes',
        record_id: COLLECTE,
        action: 'photo_choisie_client',
        user_id: 'user-1',
        old_values: { fichier_id: P1, visible_client: false },
        new_values: { fichier_id: P1, visible_client: true },
      }),
      expect.objectContaining({
        action: 'photo_choisie_client',
        new_values: { fichier_id: P2, visible_client: true },
      }),
    ]);
  });

  it('2 photos déjà choisies : la 3e est refusée (422), rien n’est écrit', async () => {
    fichiers[0]!['rang_client'] = 1;
    fichiers[1]!['rang_client'] = 2;

    const res = await choisir(P3, { visible_client: true });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /Deux photos sont déjà visibles du client/,
    );
    expect(rangDe(P3)).toBeNull();
    expect(audits).toEqual([]);
  });

  it('retirer une photo choisie libère sa place, qu’une autre photo peut prendre', async () => {
    fichiers[0]!['rang_client'] = 1;
    fichiers[1]!['rang_client'] = 2;

    const retrait = await choisir(P1, { visible_client: false });
    expect(retrait.status).toBe(200);
    expect(await retrait.json()).toEqual({
      photo: { id: P1, visible_client: false },
    });
    expect(rangDe(P1)).toBeNull();
    expect(audits[0]).toEqual(
      expect.objectContaining({
        action: 'photo_retiree_client',
        old_values: { fichier_id: P1, visible_client: true },
        new_values: { fichier_id: P1, visible_client: false },
      }),
    );

    const choix = await choisir(P3, { visible_client: true });
    expect(choix.status).toBe(200);
    expect(rangDe(P3)).toBe(1);
  });

  it('une photo choisie puis supprimée ne compte plus : sa place est de nouveau libre', async () => {
    fichiers[0]!['rang_client'] = 1;
    fichiers.find((l) => l['id'] === P_SUPPRIMEE)!['rang_client'] = 2;

    const res = await choisir(P2, { visible_client: true });

    expect(res.status).toBe(200);
    expect(rangDe(P2)).toBe(2);
  });

  it('deux sélections simultanées sur la dernière place : la base n’en garde qu’une, l’autre reçoit 422', async () => {
    fichiers[0]!['rang_client'] = 1;
    // Entre la lecture de la place libre (2) et l'écriture, une autre session
    // choisit P2 à cette place.
    avantEcriture = () => {
      fichiers[1]!['rang_client'] = 2;
    };

    const res = await choisir(P3, { visible_client: true });

    expect(res.status).toBe(422);
    expect(rangDe(P3)).toBeNull();
    expect(choisies()).toHaveLength(2);
    expect(audits).toEqual([]);
  });

  it('demande sans effet (photo déjà dans l’état voulu) : 200, aucune écriture, aucun audit', async () => {
    fichiers[0]!['rang_client'] = 2;

    const res = await choisir(P1, { visible_client: true });

    expect(res.status).toBe(200);
    expect(rangDe(P1)).toBe(2);
    expect(audits).toEqual([]);
  });

  it.each([
    ['photo d’une autre collecte', P_AUTRE],
    ['photo supprimée', P_SUPPRIMEE],
    ['fichier qui n’est pas une image', P_PDF],
    ['identifiant inconnu', 'aaaaaaaa-0000-4000-8000-00000000ffff'],
    ['identifiant mal formé', 'pas-un-uuid'],
  ])('%s : 404, rien n’est écrit', async (_cas, photoId) => {
    const rangs = () => fichiers.map((l) => [l['id'], l['rang_client']]);
    const avant = rangs();

    const res = await choisir(photoId, { visible_client: true });
    // La même cible, dans l'autre sens : retirer ne doit rien écrire non plus.
    const retrait = await choisir(photoId, { visible_client: false });

    expect(res.status).toBe(404);
    expect(retrait.status).toBe(404);
    expect(rangs()).toEqual(avant);
    expect(audits).toEqual([]);
  });

  it('corps sans booléen visible_client : 422', async () => {
    const res = await choisir(P1, { visible_client: 'oui' });

    expect(res.status).toBe(422);
    expect(rangDe(P1)).toBeNull();
  });

  it.each([
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
    'client_organisateur',
  ])('rôle client %s : 403, la photo reste non choisie', async (role) => {
    setupAuth(role);

    const res = await choisir(P1, { visible_client: true });

    expect(res.status).toBe(403);
    expect(rangDe(P1)).toBeNull();
    expect(audits).toEqual([]);
  });
});

describe('M0.6 — POST admin/collectes/[id]/photos : import manuel et choix d’office', () => {
  const importee = (): Ligne => fichiers[fichiers.length - 1]!;

  it('place libre : la photo importée est choisie d’office', async () => {
    const res = await importer();

    expect(res.status).toBe(201);
    const { fichier } = (await res.json()) as {
      fichier: { id: string; visible_client: boolean };
    };
    expect(fichier.visible_client).toBe(true);
    expect(importee()).toEqual(
      expect.objectContaining({
        id: fichier.id,
        entity_type: 'plateforme.collectes',
        entity_id: COLLECTE,
        rang_client: 1,
        created_by: 'user-1',
      }),
    );
    expect(audits[0]).toEqual(
      expect.objectContaining({
        action: 'photo_importee',
        new_values: expect.objectContaining({ visible_client: true }),
      }),
    );
  });

  it('2 photos déjà choisies : la photo est importée, non choisie', async () => {
    fichiers[0]!['rang_client'] = 1;
    fichiers[1]!['rang_client'] = 2;

    const res = await importer();

    expect(res.status).toBe(201);
    expect(
      ((await res.json()) as { fichier: { visible_client: boolean } }).fichier
        .visible_client,
    ).toBe(false);
    expect(importee()['rang_client']).toBeNull();
  });

  it('place prise pendant l’import : la photo est quand même enregistrée, non choisie', async () => {
    fichiers[0]!['rang_client'] = 1;
    let dejaJoue = false;
    avantEcriture = () => {
      if (dejaJoue) return;
      dejaJoue = true;
      fichiers[1]!['rang_client'] = 2;
    };

    const res = await importer();

    expect(res.status).toBe(201);
    expect(importee()['rang_client']).toBeNull();
    expect(choisies()).toHaveLength(2);
  });
});
