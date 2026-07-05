/**
 * M3.1 — BL-P1-TRAIT-03 : fiche collecte traiteur (enrichissements API).
 * Couvre : GET /collectes/:id augmenté (tournées plaque/chauffeur, disponibilité
 * rapport RSE, factures) + route de téléchargement du rapport RSE (embargo H+24,
 * cloisonnement). Le contrôle d'accès UI, la modale d'annulation et la modale de
 * confirmation d'édition relèvent de la preuve visuelle (GO-VISUAL).
 *
 * Mock keyé par TABLE (robuste à l'ordre — le GET fait 3 lectures en Promise.all).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  const calls: string[] = [];
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      is: () => c,
      in: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(res()),
      single: () => Promise.resolve(res()),
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  const api = {
    schema: () => api,
    from: (table: string) => {
      calls.push(table);
      return chain(table);
    },
    results,
    calls,
  };
  return api;
}

let rls = makeClient();
let admin = makeClient();
const mockRequireUser = vi.fn();
const mockPresigned = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: (...a: unknown[]) => mockPresigned(...a),
}));

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/v1/traiteur/collectes/c1');
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: {
      userId: 'user-1',
      role: 'traiteur_manager',
      organisationId: 'org-1',
    },
  });
  mockPresigned.mockResolvedValue('https://r2.example/presigned.pdf');
});

describe('M3.1 / fiche collecte GET augmenté (BL-P1-TRAIT-03)', () => {
  it('M3.1/fiche_get_augmente — tournées + rapport dispo + factures', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'zero_dechet', statut: 'validee', evenement: {} },
      error: null,
    };
    admin.results.collecte_tournees = {
      data: [
        {
          tournee: {
            plaque_immatriculation: 'AB-123-CD',
            chauffeur_nom: 'Léa',
            type_vehicule: 'camionnette',
            plaque_saisie_at: '2026-07-01T08:00:00Z',
            prestataire_logistique_id: 'p1',
          },
        },
      ],
      error: null,
    };
    admin.results.prestataires = {
      data: [{ id: 'p1', nom: 'Strike' }],
      error: null,
    };
    admin.results.rapports_rse = {
      data: {
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-02T00:00:00Z',
      },
      error: null,
    };
    admin.results.factures_collectes = {
      data: [
        {
          facture: {
            id: 'f1',
            numero_facture: 'FZD-2026-1',
            statut: 'emise',
            pdf_url_savr: 'key.pdf',
            pdf_url_pennylane: null,
          },
        },
      ],
      error: null,
    };

    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        tournees: Array<{
          plaque_immatriculation: string;
          type_vehicule: string;
          prestataire_nom: string | null;
        }>;
        rapport_rse_disponible: boolean;
        factures: Array<{ numero_facture: string }>;
      };
    };
    expect(data.tournees[0]?.plaque_immatriculation).toBe('AB-123-CD');
    expect(data.tournees[0]?.type_vehicule).toBe('camionnette');
    expect(data.tournees[0]?.prestataire_nom).toBe('Strike');
    expect(data.rapport_rse_disponible).toBe(true);
    expect(data.factures[0]?.numero_facture).toBe('FZD-2026-1');
  });

  it('M3.1/fiche_get_rapport_sous_embargo — disponible_a futur → non téléchargeable', async () => {
    rls.results.collectes = { data: { id: 'c1', evenement: {} }, error: null };
    admin.results.rapports_rse = {
      data: {
        disponible_a: '2999-01-01T00:00:00Z',
        genere_at: '2999-01-01T00:00:00Z',
      },
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
    const { data } = (await res.json()) as {
      data: { rapport_rse_disponible: boolean };
    };
    expect(data.rapport_rse_disponible).toBe(false);
  });
});

describe('M3.1 / téléchargement rapport RSE traiteur (BL-P1-TRAIT-03)', () => {
  async function download() {
    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/rapport-rse/download/route.js');
    return GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
  }

  it('M3.1/rapport_download_ok — URL pré-signée (embargo levé)', async () => {
    rls.results.collectes = { data: { id: 'c1' }, error: null };
    admin.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'rapports/r1.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain('presigned');
    expect(mockPresigned).toHaveBeenCalledWith('rapports/r1.pdf', 900);
  });

  it('M3.1/rapport_download_embargo — 425 si disponible_a futur', async () => {
    rls.results.collectes = { data: { id: 'c1' }, error: null };
    admin.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: '2999-01-01T00:00:00Z',
        genere_at: '2999-01-01T00:00:00Z',
        pdf_url: 'rapports/r1.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(425);
  });

  it('M3.1/rapport_download_cloisonnement — collecte invisible → 404', async () => {
    rls.results.collectes = { data: null, error: null };
    const res = await download();
    expect(res.status).toBe(404);
    expect(mockPresigned).not.toHaveBeenCalled();
  });

  it('M3.1/rapport_download_absent — pas de rapport → 404', async () => {
    rls.results.collectes = { data: { id: 'c1' }, error: null };
    admin.results.rapports_rse = { data: null, error: null };
    const res = await download();
    expect(res.status).toBe(404);
  });
});
