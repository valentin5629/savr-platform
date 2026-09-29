/**
 * M3.3 — Pop-up fiche collecte client côté agence (§06.11 : fiche identique au
 * §06.04 + traiteur opérationnel, refonte Val 2026-09-29), côté API : socle
 * commun, radar, téléchargement du rapport (manquant jusqu'ici côté agence) et
 * demande urgente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeClient, ligneCollecte } from '../helpers/fiche-client-mock';

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

function req(path: string, method = 'GET') {
  return new NextRequest(`http://localhost${path}`, { method });
}
const params = { params: Promise.resolve({ id: 'c1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'user-a', role: 'agence', organisationId: 'org-agence' },
  });
  mockPresigned.mockResolvedValue('https://r2.example/rapport.pdf');
});

describe('M3.3 / fiche client agence', () => {
  it('M3.3/fiche_get_socle_commun — camions, association AG, actions, traiteur opérationnel, sans notes', async () => {
    rls.results.collectes = {
      data: ligneCollecte({
        type: 'anti_gaspi',
        evenement: {
          ...ligneCollecte().evenement,
          organisation_id: 'org-agence',
          traiteur_operationnel_organisation_id: 'org-kaspia',
        },
      }),
      error: null,
    };
    rls.results.attributions_antgaspi = {
      data: {
        volume_repas_realise: null,
        association: {
          nom: 'Les Restos du Cœur',
          ville: 'Paris',
          description_rapport_impact: 'Aide alimentaire.',
        },
      },
      error: null,
    };
    rls.results.v_referentiel_traiteurs = {
      data: { id: 'org-kaspia', nom: 'Kaspia' },
      error: null,
    };
    admin.results.collecte_tournees = {
      data: [
        {
          rang: 1,
          tournee: {
            plaque_immatriculation: null,
            chauffeur_nom: 'Léa',
            chauffeur_telephone: '0612345678',
            type_vehicule: 'velo_cargo',
          },
        },
      ],
      error: null,
    };
    const { GET } = await import('@/app/api/v1/agence/collectes/[id]/route.js');
    const res = await GET(req('/api/v1/agence/collectes/c1'), params);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect((data.traiteur_operationnel as { nom: string }).nom).toBe('Kaspia');
    expect((data.association as { nom: string }).nom).toBe(
      'Les Restos du Cœur',
    );
    expect(data.tournees).toHaveLength(1);
    expect(data.actions).toEqual({
      modifier: 'actif',
      annuler: 'actif',
      annulation: 'demande',
    });
    expect(JSON.stringify(data)).not.toContain('notes_internes');
  });

  it('M3.3/fiche_benchmark_agence — radar de la fiche servi à l’agence (programmatrice)', async () => {
    rls.rpcResults.f_benchmark_single_collecte = {
      data: [{ flux_code: 'biodechet', ratio_user: 0.4 }],
      error: null,
    };
    rls.rpcResults.f_benchmark_kg_pax_zd = {
      data: [
        {
          flux_code: 'biodechet',
          kg_par_pax_moyen: 0.3,
          nb_collectes_segment: 8,
        },
      ],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/agence/collectes/[id]/benchmark/route.js');
    const res = await GET(
      req('/api/v1/agence/collectes/c1/benchmark?type_evenement_ids=t1'),
      params,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { flux: Record<string, { ratio_user: number }> };
    };
    expect(data.flux.biodechet?.ratio_user).toBe(0.4);
  });

  it('M3.3/fiche_benchmark_agence_traiteur_ids_rejete — filtre concurrentiel interdit à l’agence', async () => {
    rls.rpcResults.f_benchmark_single_collecte = {
      data: [{ flux_code: 'carton', ratio_user: 0.2 }],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/agence/collectes/[id]/benchmark/route.js');
    const res = await GET(
      req('/api/v1/agence/collectes/c1/benchmark?traiteur_ids=org-2'),
      params,
    );
    expect(res.status).toBe(403);
  });

  it('M3.3/rapport_download_agence — l’agence télécharge le rapport de sa collecte (embargo respecté)', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'zero_dechet', statut: 'cloturee' },
      error: null,
    };
    rls.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-01T00:00:00Z',
        pdf_url: 'rapports/r1.pdf',
      },
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/agence/collectes/[id]/rapport-rse/download/route.js');
    let res = await GET(
      req('/api/v1/agence/collectes/c1/rapport-rse/download'),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      url: 'https://r2.example/rapport.pdf',
    });
    // Documents lus sous la RLS de l'agence, jamais en service-role.
    expect(admin.calls).toHaveLength(0);

    rls.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: '2999-01-01T00:00:00Z',
        genere_at: '2999-01-01T00:00:00Z',
        pdf_url: 'rapports/r1.pdf',
      },
      error: null,
    };
    res = await GET(
      req('/api/v1/agence/collectes/c1/rapport-rse/download'),
      params,
    );
    expect(res.status).toBe(425);
  });

  it('M3.3/rapport_download_agence_cloisonnement — collecte invisible : 404, aucune lecture service-role', async () => {
    rls.results.collectes = { data: null, error: null };
    const { GET } =
      await import('@/app/api/v1/agence/collectes/[id]/rapport-rse/download/route.js');
    const res = await GET(
      req('/api/v1/agence/collectes/c1/rapport-rse/download'),
      params,
    );
    expect(res.status).toBe(404);
    expect(admin.calls).toHaveLength(0);
  });

  it('M3.3/urgence_agence_ok — alerte créée pour une collecte visible', async () => {
    rls.results.collectes = {
      data: {
        id: 'c1',
        statut: 'programmee',
        date_collecte: '2026-10-28',
        heure_collecte: null,
        evenement: { lieu: { nom: 'Paris Expo' } },
      },
      error: null,
    };
    const { POST } =
      await import('@/app/api/v1/agence/collectes/[id]/coordonnees-urgence/route.js');
    const res = await POST(
      req('/api/v1/agence/collectes/c1/coordonnees-urgence', 'POST'),
      params,
    );
    expect(res.status).toBe(200);
    expect(admin.inserts[0]?.table).toBe('alertes_admin');
    expect(mockRequireUser).toHaveBeenCalledWith(expect.anything(), ['agence']);
  });
});
