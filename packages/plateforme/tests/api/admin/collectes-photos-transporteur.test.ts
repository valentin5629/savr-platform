/**
 * GET / POST /api/v1/admin/collectes/[id]/photos/transporteur — photos du
 * livreur relues chez le transporteur (décision Val 2026-11-03). La relecture
 * et l'import sont simulés (testés dans @savr/adapters) : on vérifie ici
 * l'accès, la validation de la sélection et les réponses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const COLLECTE = 'col-1';
const ID = 'a'.repeat(64);

const { lister, importer, role, collecteExiste, audits } = vi.hoisted(() => ({
  lister: vi.fn(),
  importer: vi.fn(),
  role: { valeur: 'admin_savr' as string },
  collecteExiste: { valeur: true },
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock('@savr/adapters/src/index.js', () => {
  class PhotoTransporteurInconnueError extends Error {}
  return {
    listerPhotosTransporteur: lister,
    importerPhotosTransporteur: importer,
    PhotoTransporteurInconnueError,
  };
});

function table(nom: string) {
  const c = {
    select: () => c,
    eq: () => c,
    maybeSingle: () =>
      Promise.resolve({
        data: collecteExiste.valeur ? { id: COLLECTE } : null,
        error: null,
      }),
    insert: (ligne: Record<string, unknown>) => {
      if (nom === 'audit_log') audits.push(ligne);
      return Promise.resolve({ error: null });
    },
  };
  return c;
}
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from: table }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      getSession: async () => ({
        data: {
          session: { access_token: makeJwt({ user_role: role.valeur }) },
        },
        error: null,
      }),
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

const URL_ROUTE = `http://localhost/api/v1/admin/collectes/${COLLECTE}/photos/transporteur`;
const ctx = { params: Promise.resolve({ id: COLLECTE }) };
const route = () =>
  import('@/app/api/v1/admin/collectes/[id]/photos/transporteur/route.js');

const poster = async (body: unknown) =>
  (await route()).POST(
    new NextRequest(URL_ROUTE, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    ctx,
  );

beforeEach(() => {
  lister.mockReset();
  importer.mockReset();
  role.valeur = 'admin_savr';
  collecteExiste.valeur = true;
  audits.length = 0;
});

describe('photos du livreur — GET', () => {
  it('rend les photos relues chez le transporteur', async () => {
    const photos = [
      {
        id: ID,
        url: 'https://s3.exemple.test/a.jpg',
        prise_le: null,
        course: 1,
        deja_importee: false,
      },
    ];
    lister.mockResolvedValue({
      pris_en_charge: true,
      photos,
      courses_illisibles: 0,
    });
    const res = await (await route()).GET(new NextRequest(URL_ROUTE), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ photos, courses_illisibles: 0 });
  });

  it('transporteur sans photos du livreur → 409', async () => {
    lister.mockResolvedValue({ pris_en_charge: false });
    const res = await (await route()).GET(new NextRequest(URL_ROUTE), ctx);
    expect(res.status).toBe(409);
  });

  it('client (hors équipe Savr) → refusé, aucun appel au transporteur', async () => {
    role.valeur = 'traiteur_manager';
    const res = await (await route()).GET(new NextRequest(URL_ROUTE), ctx);
    expect(res.status).toBe(403);
    expect(lister).not.toHaveBeenCalled();
  });

  it('collecte inconnue → 404', async () => {
    collecteExiste.valeur = false;
    const res = await (await route()).GET(new NextRequest(URL_ROUTE), ctx);
    expect(res.status).toBe(404);
  });
});

describe('photos du livreur — POST', () => {
  it('importe la sélection et la trace', async () => {
    importer.mockResolvedValue({
      pris_en_charge: true,
      importees: 1,
      deja_importees: 0,
      echecs: 0,
      restantes: 0,
    });
    const res = await poster({ ids: [ID] });
    expect(res.status).toBe(200);
    expect(importer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        collecteId: COLLECTE,
        ids: [ID],
        userId: 'user-1',
      }),
    );
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'photos_transporteur_importees',
        record_id: COLLECTE,
      }),
    ]);
  });

  it.each([
    ['vide', { ids: [] }],
    ['adresse au lieu d’un id', { ids: ['https://ailleurs.test/x.jpg'] }],
    ['trop de photos', { ids: Array.from({ length: 21 }, () => ID) }],
    ['sans ids', {}],
  ])('sélection invalide (%s) → 422, rien n’est importé', async (_n, body) => {
    const res = await poster(body);
    expect(res.status).toBe(422);
    expect(importer).not.toHaveBeenCalled();
  });

  it('client (hors équipe Savr) → refusé, rien n’est importé', async () => {
    role.valeur = 'traiteur_manager';
    const res = await poster({ ids: [ID] });
    expect(res.status).toBe(403);
    expect(importer).not.toHaveBeenCalled();
  });

  it('photo inconnue du transporteur → 422', async () => {
    const { PhotoTransporteurInconnueError } =
      await import('@savr/adapters/src/index.js');
    importer.mockRejectedValue(new PhotoTransporteurInconnueError('x'));
    const res = await poster({ ids: [ID] });
    expect(res.status).toBe(422);
    expect(audits).toEqual([]);
  });

  it('toutes les photos en échec → 502, sans trace', async () => {
    importer.mockResolvedValue({
      pris_en_charge: true,
      importees: 0,
      deja_importees: 0,
      echecs: 1,
      restantes: 0,
    });
    const res = await poster({ ids: [ID] });
    expect(res.status).toBe(502);
    expect(audits).toEqual([]);
  });
});
