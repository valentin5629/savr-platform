/**
 * GET /api/v1/programmation/organisations/traiteurs — ce que la route REND.
 *
 * Fuite fermée (revue sécurité #363, 2026-09-22) : la route tourne en service_role,
 * donc la RLS ne la borne pas — elle renvoyait `raison_sociale` et `siret` de TOUS
 * les traiteurs du référentiel au gestionnaire et à l'agence. §06.05 : d'un traiteur
 * tiers, un rôle client ne voit rien au-delà du nom. La liste déroulante §06.01
 * n'affichait que `nom || raison_sociale` : ce repli est désormais calculé côté
 * serveur, comme le fait la vue v_referentiel_traiteurs (20260922080000).
 *
 * Ici l'oracle porte sur la CHARGE UTILE (le fichier formulaire-prog.r12b couvre la
 * requête : liste du select et motifs de recherche). La chaîne Supabase est
 * « awaitable » pour que la route reçoive de vraies lignes et qu'on voie sa sortie.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

// Lignes telles que PostgREST les rendrait : un traiteur avec nom commercial, un
// autre dont le nom est vide (organisations.nom est NOT NULL → le « sans nom
// commercial » réel, c'est du vide, pas NULL).
const LIGNES = [
  {
    id: 'tr-1',
    nom: 'Kaspia',
    raison_sociale: 'Kaspia SAS',
    siret: '11111111111111',
  },
  {
    id: 'tr-2',
    nom: '  ',
    raison_sociale: 'Maison Bertrand SARL',
    siret: '22222222222222',
  },
];

const chaine = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
    resolve({ data: LIGNES, error: null }),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => chaine,
}));

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
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, organisation_id: 'org-1' }),
      },
    },
    error: null,
  });
}

async function appeler(): Promise<{ status: number; body: unknown }> {
  const { GET } =
    await import('@/app/api/v1/programmation/organisations/traiteurs/route.js');
  const res = await GET(
    new NextRequest(
      'http://localhost/api/v1/programmation/organisations/traiteurs',
    ),
  );
  return { status: res.status, body: await res.json() };
}

describe('GET traiteurs référentiel — libellé unique côté rôles clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chaine.from.mockReturnThis();
    chaine.select.mockReturnThis();
    chaine.eq.mockReturnThis();
    chaine.or.mockReturnThis();
    chaine.order.mockReturnThis();
    chaine.limit.mockReturnThis();
  });

  for (const role of ['gestionnaire_lieux', 'agence'] as const) {
    it(`${role} : ni raison sociale ni SIRET dans la réponse, un seul libellé`, async () => {
      setupAuth(role);
      const { status, body } = await appeler();
      expect(status).toBe(200);
      const options = body as { id: string; nom: string }[];
      expect(options).toEqual([
        { id: 'tr-1', nom: 'Kaspia' },
        // Nom commercial vide → repli sur la raison sociale, sinon l'option serait
        // vide à l'écran.
        { id: 'tr-2', nom: 'Maison Bertrand SARL' },
      ]);
      // Aucune clé résiduelle, quel que soit l'ordre des champs.
      for (const o of options)
        expect(Object.keys(o).sort()).toEqual(['id', 'nom']);
      expect(JSON.stringify(body)).not.toContain('11111111111111');
      expect(JSON.stringify(body)).not.toContain('Kaspia SAS');
    });
  }

  it('admin_savr : la fiche complète reste servie (programmation de support)', async () => {
    setupAuth('admin_savr');
    const { status, body } = await appeler();
    expect(status).toBe(200);
    expect(body).toEqual(LIGNES);
  });
});
