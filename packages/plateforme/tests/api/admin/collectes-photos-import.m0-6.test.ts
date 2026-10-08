/**
 * M0.6 — POST /api/v1/admin/collectes/[id]/photos : où part la photo importée.
 * §06.06 §3 « Importer des photos » ; cloisonnement dev / prod du stockage
 * (décision Val 2026-10-07).
 *
 * Avant : `process.env.R2_BUCKET_NAME || 'savr-dev'` — une production sans la
 * variable aurait écrit ses photos dans le bucket de dev, sans erreur (lu dans le
 * code, jamais observé : la prod n'a aucune photo). La route ne
 * choisit plus de bucket. Seul le SDK S3 est simulé ici : `uploadObject` est le
 * VRAI, pour observer le bucket réellement envoyé et celui écrit en base.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const COLLECTE = 'col-1';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => {
  class Commande {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      send = send;
    },
    PutObjectCommand: class extends Commande {},
    GetObjectCommand: class extends Commande {},
  };
});

// Faux client service-role : la collecte existe, aucune photo n'est encore
// choisie pour le client, les INSERT sont enregistrés.
const inserts: { table: string; ligne: Record<string, unknown> }[] = [];
function table(nom: string) {
  const c = {
    select: () => c,
    eq: () => c,
    is: () => c,
    not: () => c,
    maybeSingle: () => Promise.resolve({ data: { id: COLLECTE }, error: null }),
    insert: (ligne: Record<string, unknown>) => {
      inserts.push({ table: nom, ligne });
      return c;
    },
    single: () =>
      Promise.resolve({
        data: {
          id: 'f-1',
          content_type: 'image/png',
          created_at: '2026-10-07T10:00:00Z',
          rang_client: 1,
        },
        error: null,
      }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
  };
  return c;
}
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (nom: string) => table(nom),
    schema: () => ({ from: (nom: string) => table(nom) }),
  }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      getSession: async () => ({
        data: { session: { access_token: makeJwt({ user_role: 'ops_savr' }) } },
        error: null,
      }),
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

async function importerPhoto(): Promise<Response> {
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' }),
  );
  const { POST } =
    await import('@/app/api/v1/admin/collectes/[id]/photos/route.js');
  return POST(
    new NextRequest(
      `http://localhost/api/v1/admin/collectes/${COLLECTE}/photos`,
      { method: 'POST', body: form },
    ),
    { params: Promise.resolve({ id: COLLECTE }) },
  );
}

const fichierInsere = () => inserts.find((i) => i.table === 'fichiers')?.ligne;

beforeEach(() => {
  inserts.length = 0;
  send.mockReset();
  send.mockResolvedValue({});
  vi.stubEnv('R2_ACCOUNT_ID', 'compte');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'cle');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
});
afterEach(() => vi.unstubAllEnvs());

describe('M0.6 — POST admin/collectes/[id]/photos : bucket de la photo importée', () => {
  it.each(['savr-dev', 'savr-prod'])(
    'R2_BUCKET_NAME=%s → objet envoyé ET ligne shared.fichiers dans ce bucket',
    async (bucket) => {
      vi.stubEnv('R2_BUCKET_NAME', bucket);

      const res = await importerPhoto();

      expect(res.status).toBe(201);
      expect(send).toHaveBeenCalledTimes(1);
      const envoye = (
        send.mock.calls[0]![0] as { input: Record<string, unknown> }
      ).input;
      expect(envoye['Bucket']).toBe(bucket);
      expect(envoye['Key']).toMatch(
        new RegExp(`^photos/collectes/${COLLECTE}/[0-9a-f-]{36}\\.png$`),
      );
      // Le pointeur en base désigne l'objet réellement écrit.
      expect(fichierInsere()).toMatchObject({
        storage_provider: 'r2',
        bucket,
        key: envoye['Key'],
        entity_type: 'plateforme.collectes',
        entity_id: COLLECTE,
      });
    },
  );

  it('R2_BUCKET_NAME absent → 503, rien envoyé, aucune ligne (avant : écrit dans savr-dev)', async () => {
    vi.stubEnv('R2_BUCKET_NAME', '');

    const res = await importerPhoto();

    expect(res.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });
});
