/**
 * Recadrage d'une photo de collecte par l'équipe Savr (décisions Val
 * 2026-11-20, C1 original gardé, C2 équipe Savr seulement).
 *
 * Route : /api/v1/admin/collectes/[id]/photos/[photoId]/recadrage
 *   GET    l'original (même sur une photo déjà recadrée)
 *   PUT    la version recadrée (JPEG), rangée à côté de l'original
 *   DELETE retour à l'original
 *
 * Le faux client garde les lignes de shared.fichiers en mémoire et applique
 * réellement les filtres posés par la route ; R2 est un dictionnaire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Ligne = Record<string, unknown>;

const COLLECTE = '11111111-1111-4111-8111-111111111111';
const AUTRE_COLLECTE = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const P_AUTRE = 'aaaaaaaa-0000-4000-8000-000000000002';
const P_PDF = 'aaaaaaaa-0000-4000-8000-000000000003';
const CLE_P1 = `photos/collectes/${COLLECTE}/emp1.png`;
const JPEG = Buffer.from('ffd8ffe000104a464946ffd9', 'hex');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

let fichiers: Ligne[] = [];
let audits: Ligne[] = [];
let r2: Map<string, Buffer>;

const ligne = (id: string, surcharge: Ligne = {}): Ligne => ({
  id,
  bucket: 'savr-test',
  key: CLE_P1,
  content_type: 'image/png',
  size_bytes: PNG.length,
  entity_type: 'plateforme.collectes',
  entity_id: COLLECTE,
  deleted_at: null,
  ...surcharge,
});

function requeteFichiers() {
  const filtres: ((l: Ligne) => boolean)[] = [];
  let maj: Ligne | null = null;
  const executer = () => {
    const cibles = fichiers.filter((l) => filtres.every((f) => f(l)));
    if (maj) for (const l of cibles) Object.assign(l, maj);
    return { data: cibles[0] ?? null, error: null };
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
    like: (col: string, motif: string) => {
      const prefixe = motif.replace(/%$/, '');
      filtres.push((l) => String(l[col]).startsWith(prefixe));
      return c;
    },
    update: (valeurs: Ligne) => {
      maj = valeurs;
      return c;
    },
    maybeSingle: async () => executer(),
  };
  return c;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({
      insert: (valeurs: Ligne) => {
        if (table === 'audit_log') audits.push(valeurs);
        return Promise.resolve({ error: null });
      },
    }),
    schema: () => ({ from: () => requeteFichiers() }),
  }),
}));

vi.mock('@savr/shared/src/r2/upload.js', () => ({
  uploadObject: async (key: string, octets: Buffer) => {
    r2.set(`savr-test/${key}`, octets);
    return { bucket: 'savr-test', key, storageKey: `savr-test/${key}` };
  },
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: async (cle: string) => {
    const o = r2.get(cle);
    if (!o) throw new Error(`objet absent : ${cle}`);
    return o;
  },
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify({ aal: 'aal2', ...claims })).toString('base64url')}.s`;
}
const role = { valeur: 'admin_savr' };
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

const route = () =>
  import('@/app/api/v1/admin/collectes/[id]/photos/[photoId]/recadrage/route.js');
const url = (photoId: string, collecte = COLLECTE) =>
  `http://localhost/api/v1/admin/collectes/${collecte}/photos/${photoId}/recadrage`;
const ctx = (photoId: string, collecte = COLLECTE) => ({
  params: Promise.resolve({ id: collecte, photoId }),
});

async function recadrer(photoId: string, contenu: Buffer, collecte = COLLECTE) {
  const form = new FormData();
  form.append('fichier', new Blob([new Uint8Array(contenu)]), 'p.jpg');
  return (await route()).PUT(
    new NextRequest(url(photoId, collecte), { method: 'PUT', body: form }),
    ctx(photoId, collecte),
  );
}
const lire = async (photoId: string) =>
  (await route()).GET(new NextRequest(url(photoId)), ctx(photoId));
const revenir = async (photoId: string) =>
  (await route()).DELETE(
    new NextRequest(url(photoId), { method: 'DELETE' }),
    ctx(photoId),
  );

beforeEach(() => {
  role.valeur = 'admin_savr';
  audits = [];
  r2 = new Map([[`savr-test/${CLE_P1}`, PNG]]);
  fichiers = [
    ligne(P1),
    ligne(P_AUTRE, {
      entity_id: AUTRE_COLLECTE,
      key: `photos/collectes/${AUTRE_COLLECTE}/x.jpg`,
    }),
    ligne(P_PDF, {
      content_type: 'application/pdf',
      key: `photos/collectes/${COLLECTE}/doc.pdf`,
    }),
  ];
});

describe('PUT — enregistrer la version recadrée', () => {
  it('range la photo recadrée à côté de l’original, la ligne la désigne, l’original reste', async () => {
    const res = await recadrer(P1, JPEG);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ photo: { id: P1, recadree: true } });
    const p1 = fichiers.find((l) => l['id'] === P1)!;
    expect(p1['key']).toBe(`${CLE_P1}.recadree.jpg`);
    expect(p1['content_type']).toBe('image/jpeg');
    expect(p1['size_bytes']).toBe(JPEG.length);
    expect(r2.get(`savr-test/${CLE_P1}.recadree.jpg`)).toEqual(JPEG);
    expect(r2.get(`savr-test/${CLE_P1}`)).toEqual(PNG);
    expect(audits).toEqual([
      expect.objectContaining({
        record_id: COLLECTE,
        action: 'photo_recadree',
        new_values: { fichier_id: P1 },
      }),
    ]);
  });

  it('un second recadrage remplace le premier, sans toucher à l’original', async () => {
    await recadrer(P1, JPEG);
    const autre = Buffer.concat([JPEG, Buffer.from([0x00])]);
    await recadrer(P1, autre);
    expect(fichiers.find((l) => l['id'] === P1)!['key']).toBe(
      `${CLE_P1}.recadree.jpg`,
    );
    expect(r2.get(`savr-test/${CLE_P1}.recadree.jpg`)).toEqual(autre);
    expect(r2.get(`savr-test/${CLE_P1}`)).toEqual(PNG);
  });

  it('un contenu qui n’est pas un JPEG est refusé, rien n’est écrit', async () => {
    const res = await recadrer(P1, PNG);
    expect(res.status).toBe(422);
    expect(fichiers.find((l) => l['id'] === P1)!['key']).toBe(CLE_P1);
    expect(r2.size).toBe(1);
    expect(audits).toEqual([]);
  });

  it('une photo d’une autre collecte, ou un document, n’est pas recadrable', async () => {
    expect((await recadrer(P_AUTRE, JPEG)).status).toBe(404);
    expect((await recadrer(P_PDF, JPEG)).status).toBe(404);
    expect(r2.size).toBe(1);
  });

  it('client (hors équipe Savr) → refusé, rien n’est écrit', async () => {
    role.valeur = 'traiteur_manager';
    const res = await recadrer(P1, JPEG);
    expect([401, 403]).toContain(res.status);
    expect(fichiers.find((l) => l['id'] === P1)!['key']).toBe(CLE_P1);
    expect(r2.size).toBe(1);
  });
});

describe('GET — l’original, point de départ de l’éditeur', () => {
  it('rend l’original, même quand la photo est recadrée', async () => {
    await recadrer(P1, JPEG);
    const res = await lire(P1);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it('client (hors équipe Savr) → refusé', async () => {
    role.valeur = 'gestionnaire_lieux';
    expect([401, 403]).toContain((await lire(P1)).status);
  });
});

describe('DELETE — revenir à l’original', () => {
  it('la ligne désigne de nouveau l’original, avec son type et sa taille', async () => {
    await recadrer(P1, JPEG);
    audits = [];
    const res = await revenir(P1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ photo: { id: P1, recadree: false } });
    const p1 = fichiers.find((l) => l['id'] === P1)!;
    expect(p1['key']).toBe(CLE_P1);
    expect(p1['content_type']).toBe('image/png');
    expect(p1['size_bytes']).toBe(PNG.length);
    expect(audits).toEqual([
      expect.objectContaining({ action: 'photo_recadrage_annule' }),
    ]);
  });

  it('une photo jamais recadrée reste telle quelle, sans trace', async () => {
    const res = await revenir(P1);
    expect(res.status).toBe(200);
    expect(fichiers.find((l) => l['id'] === P1)!['key']).toBe(CLE_P1);
    expect(audits).toEqual([]);
  });
});
