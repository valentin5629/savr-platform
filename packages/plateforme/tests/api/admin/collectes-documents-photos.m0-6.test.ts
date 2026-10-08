/**
 * M0.6 — GET /api/v1/admin/collectes/[id]/documents : galerie photos.
 * §06.06 §3 : « photos (TMS + imports manuels) » dans la fiche collecte Admin.
 * §04 shared.fichiers : `entity_type` = table propriétaire ; §09 C1 : une photo de
 * collecte se range sous `plateforme.collectes`.
 *
 * Une photo remontée par le transporteur (polling MTS-1) et une photo importée à
 * la main par l'Admin doivent sortir dans la même galerie. Le faux client applique
 * RÉELLEMENT les filtres de la route sur un jeu de lignes : retirer ou changer un
 * filtre côté route fait échouer le test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Ligne = Record<string, unknown>;

const COLLECTE = 'col-1';

// Ligne telle que l'adapter du transporteur l'écrit (processPhotos) : clé
// photos/collectes/<collecte>/<empreinte>.jpg (opaque depuis le 2026-10-07, sans
// identifiant du transporteur), pas de created_by, et NON choisie pour le client
// (rang_client vide : c'est l'équipe Savr qui choisit).
const PHOTO_TRANSPORTEUR: Ligne = {
  id: 'f-transporteur',
  bucket: 'savr-test',
  key: `photos/collectes/${COLLECTE}/af17919c2fb43ce5b5ced39e1857b565dccb535a0233b93654d398096682c2ad.jpg`,
  content_type: 'image/jpeg',
  entity_type: 'plateforme.collectes',
  entity_id: COLLECTE,
  deleted_at: null,
  rang_client: null,
  created_at: '2026-07-16T00:05:00Z',
};

// Ligne telle que l'import manuel Admin l'écrit (POST …/photos) : choisie
// d'office pour le client s'il restait une place.
const PHOTO_IMPORT_ADMIN: Ligne = {
  id: 'f-import-admin',
  bucket: 'savr-dev',
  key: `photos/collectes/${COLLECTE}/0f8b.png`,
  content_type: 'image/png',
  entity_type: 'plateforme.collectes',
  entity_id: COLLECTE,
  deleted_at: null,
  rang_client: 1,
  created_at: '2026-07-16T09:00:00Z',
};

const HORS_GALERIE: Ligne[] = [
  // Ancienne valeur écrite par l'adapter : inconnue de la galerie ET de
  // shared.f_fichier_visible → la photo n'apparaissait nulle part.
  {
    ...PHOTO_TRANSPORTEUR,
    id: 'f-ancienne-valeur',
    entity_type: 'collecte_photo',
  },
  { ...PHOTO_TRANSPORTEUR, id: 'f-autre-collecte', entity_id: 'col-2' },
  {
    ...PHOTO_TRANSPORTEUR,
    id: 'f-supprimee',
    deleted_at: '2026-07-17T00:00:00Z',
  },
  {
    ...PHOTO_TRANSPORTEUR,
    id: 'f-pas-une-image',
    content_type: 'application/pdf',
  },
];

let fichiers: Ligne[] = [];

// Faux PostgREST minimal sur shared.fichiers : eq / is / like / order appliqués.
function requeteFichiers() {
  let lignes = [...fichiers];
  const c = {
    select: () => c,
    eq: (col: string, val: unknown) => {
      lignes = lignes.filter((l) => l[col] === val);
      return c;
    },
    is: (col: string, val: unknown) => {
      lignes = lignes.filter((l) => (l[col] ?? null) === val);
      return c;
    },
    like: (col: string, motif: string) => {
      const prefixe = motif.replace(/%$/, '');
      lignes = lignes.filter((l) => String(l[col]).startsWith(prefixe));
      return c;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      lignes.sort((a, b) =>
        opts.ascending
          ? String(a[col]).localeCompare(String(b[col]))
          : String(b[col]).localeCompare(String(a[col])),
      );
      return Promise.resolve({ data: lignes, error: null });
    },
  };
  return c;
}

// Rapport / bordereau / attestation : hors sujet ici → aucun document.
function requeteVide() {
  const c = {
    select: () => c,
    eq: () => c,
    order: () => c,
    limit: () => c,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return c;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: () => requeteVide(),
    schema: (schema: string) => ({
      from: (table: string) =>
        schema === 'shared' && table === 'fichiers'
          ? requeteFichiers()
          : requeteVide(),
    }),
  }),
}));

const getPresignedUrl = vi.fn(
  async (storageKey: string) => `https://r2.test/${storageKey}`,
);
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: (storageKey: string) => getPresignedUrl(storageKey),
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

async function getDocuments(): Promise<Response> {
  const { GET } =
    await import('@/app/api/v1/admin/collectes/[id]/documents/route.js');
  return GET(
    new NextRequest(
      `http://localhost/api/v1/admin/collectes/${COLLECTE}/documents`,
    ),
    { params: Promise.resolve({ id: COLLECTE }) },
  );
}

describe('M0.6 — GET admin/collectes/[id]/documents : galerie photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fichiers = [PHOTO_TRANSPORTEUR, PHOTO_IMPORT_ADMIN, ...HORS_GALERIE];
    setupAuth('ops_savr');
  });

  it('photo remontée par le transporteur listée avec les imports manuels', async () => {
    const res = await getDocuments();

    expect(res.status).toBe(200);
    const { photos } = (await res.json()) as {
      photos: { id: string; visible_client: boolean; url: string | null }[];
    };
    // Plus récente d'abord ; aucune des lignes HORS_GALERIE.
    expect(photos.map((p) => p.id)).toEqual([
      'f-import-admin',
      'f-transporteur',
    ]);
    expect(photos[1]).toEqual({
      id: 'f-transporteur',
      content_type: 'image/jpeg',
      created_at: '2026-07-16T00:05:00Z',
      visible_client: false,
      url: `https://r2.test/savr-test/${PHOTO_TRANSPORTEUR['key']}`,
    });
    // L'équipe Savr voit toutes les photos ; la réponse dit lesquelles sont
    // choisies pour le client (shared.fichiers.rang_client renseigné).
    expect(photos.map((p) => [p.id, p.visible_client])).toEqual([
      ['f-import-admin', true],
      ['f-transporteur', false],
    ]);
  });

  it("photo rangée sous une autre valeur d'entity_type : absente de la galerie", async () => {
    fichiers = HORS_GALERIE;

    const res = await getDocuments();

    expect(res.status).toBe(200);
    expect(((await res.json()) as { photos: unknown[] }).photos).toEqual([]);
    expect(getPresignedUrl).not.toHaveBeenCalled();
  });

  it('rôle client : 403, aucune photo servie', async () => {
    setupAuth('traiteur_manager');

    const res = await getDocuments();

    expect(res.status).toBe(403);
    expect(getPresignedUrl).not.toHaveBeenCalled();
  });
});
