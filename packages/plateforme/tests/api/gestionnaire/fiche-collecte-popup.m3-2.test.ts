/**
 * M3.2 — Pop-up fiche collecte client côté gestionnaire de lieux (§06.05 : reprend
 * le pop-up §06.04, refonte Val 2026-09-29), côté API.
 *
 * Exigences de la revue sécurité du sync 2026-09-29 :
 *  · association bénéficiaire ABSENTE de la réponse (Q7) — pas seulement cachée :
 *    ni lue (aa_select jamais élargie, pas de service-role), ni sérialisée ;
 *  · radar : f_benchmark_single_collecte refuse les collectes de traiteurs tiers →
 *    « pas de radar » (200, data null), JAMAIS de contournement ;
 *  · documents lus sous la RLS du gestionnaire, jamais en service-role ;
 *  · aucune annulation (§05 : gestion exclusive au traiteur).
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

async function getFiche() {
  const { GET } =
    await import('@/app/api/v1/gestionnaire/collectes/[id]/route.js');
  const res = await GET(req('/api/v1/gestionnaire/collectes/c1'), params);
  return { res, json: (await res.json()) as { data: Record<string, unknown> } };
}

// Collecte programmée par un traiteur TIERS sur un lieu du gestionnaire.
const TIERS = {
  evenement: {
    ...ligneCollecte().evenement,
    organisation_id: 'org-traiteur-tiers',
    traiteur_operationnel_organisation_id: 'org-traiteur-tiers',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: {
      userId: 'user-g',
      role: 'gestionnaire_lieux',
      organisationId: 'org-gest',
    },
  });
  mockPresigned.mockResolvedValue('https://r2.example/rapport.pdf');
});

describe('M3.2 / fiche client gestionnaire — association (Q7)', () => {
  it('M3.2/fiche_get_association_absente — AG validée : ni lue ni servie, même si l’attribution est lisible', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ type: 'anti_gaspi', statut: 'cloturee' }),
      error: null,
    };
    // Piège : la table renverrait une association si on la demandait.
    rls.results.attributions_antgaspi = {
      data: {
        volume_repas_realise: 840,
        association: {
          nom: 'Les Restos du Cœur',
          ville: 'Paris',
          description_rapport_impact: 'x',
        },
      },
      error: null,
    };
    const { json } = await getFiche();
    expect(Object.hasOwn(json.data, 'association')).toBe(false);
    expect(JSON.stringify(json)).not.toContain('Restos');
    // La lecture ne demande que le volume de repas — jamais l'association.
    expect(rls.selects.attributions_antgaspi).toEqual(['volume_repas_realise']);
    expect(admin.calls).not.toContain('attributions_antgaspi');
    expect(admin.calls).not.toContain('associations');
  });
});

describe('M3.2 / fiche client gestionnaire — repas des collectes tierces (D13)', () => {
  it('M3.2/fiche_get_repas_non_communiques_tiers — AG d’un traiteur tiers : repas « non communiqués »', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ type: 'anti_gaspi', statut: 'cloturee', ...TIERS }),
      error: null,
    };
    // aa_select exclut le gestionnaire sur une collecte tierce (C-1).
    rls.results.attributions_antgaspi = { data: null, error: null };
    const { json } = await getFiche();
    expect(json.data.repas_donnes).toBeNull();
    expect(json.data.repas_non_communiques).toBe(true);
    expect(admin.calls).not.toContain('attributions_antgaspi');
  });

  it('M3.2/fiche_get_repas_propre_programmation — AG programmée par le gestionnaire : repas servis', async () => {
    rls.results.collectes = {
      data: ligneCollecte({
        type: 'anti_gaspi',
        statut: 'cloturee',
        evenement: {
          ...ligneCollecte().evenement,
          organisation_id: 'org-gest',
        },
      }),
      error: null,
    };
    rls.results.attributions_antgaspi = {
      data: { volume_repas_realise: 320 },
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.repas_donnes).toBe(320);
    expect(json.data.repas_non_communiques).toBe(false);
  });

  it('M3.2/fiche_get_zd_tiers_sans_mention — ZD d’un traiteur tiers : pas de mention repas', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ statut: 'cloturee', ...TIERS }),
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.repas_non_communiques).toBe(false);
  });
});

describe('M3.2 / fiche client gestionnaire — documents et actions', () => {
  it('M3.2/fiche_get_documents_sous_rls — disponibilité du rapport lue sous la RLS du gestionnaire', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ statut: 'cloturee' }),
      error: null,
    };
    rls.results.rapports_rse = {
      data: {
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-01T00:00:00Z',
        regenere_at: null,
      },
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.rapport_rse_disponible).toBe(true);
    expect(admin.calls).not.toContain('rapports_rse');
    expect(admin.calls).not.toContain('attestations_don');
  });

  it('M3.2/fiche_get_actions_gestionnaire — jamais d’annulation ; modifier : ses programmations seulement', async () => {
    rls.results.collectes = { data: ligneCollecte(TIERS), error: null };
    let { json } = await getFiche();
    expect(json.data.actions).toEqual({
      modifier: 'grise',
      annuler: 'absent',
      annulation: null,
    });

    rls.results.collectes = {
      data: ligneCollecte({
        evenement: {
          ...ligneCollecte().evenement,
          organisation_id: 'org-gest',
        },
      }),
      error: null,
    };
    ({ json } = await getFiche());
    expect(json.data.actions).toEqual({
      modifier: 'actif',
      annuler: 'absent',
      annulation: null,
    });
  });

  it('M3.2/rapport_download_gestionnaire_sous_rls — documents lus sous sa RLS, jamais en service-role', async () => {
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
      await import('@/app/api/v1/gestionnaire/collectes/[id]/rapport-rse/download/route.js');
    const res = await GET(
      req('/api/v1/gestionnaire/collectes/c1/rapport-rse/download'),
      params,
    );
    expect(res.status).toBe(200);
    expect(admin.calls).toHaveLength(0);
  });
});

describe('M3.2 / fiche client gestionnaire — radar (garde non élargie)', () => {
  it('M3.2/fiche_benchmark_tiers_masque — collecte visible refusée par la fonction : 200 data null, pas de contournement', async () => {
    rls.rpcResults.f_benchmark_single_collecte = {
      data: null,
      error: { message: 'Collecte not accessible' },
    };
    rls.results.collectes = { data: { id: 'c1' }, error: null };
    const { GET } =
      await import('@/app/api/v1/gestionnaire/collectes/[id]/benchmark/route.js');
    const res = await GET(
      req('/api/v1/gestionnaire/collectes/c1/benchmark'),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    // Ni service-role, ni repère parc calculé.
    expect(admin.calls).toHaveLength(0);
    expect(admin.rpcCalls).toHaveLength(0);
    expect(rls.rpcCalls.map((c) => c.name)).not.toContain(
      'f_benchmark_kg_pax_zd',
    );
  });

  it('M3.2/fiche_benchmark_hors_perimetre_404 — collecte invisible : 404', async () => {
    rls.rpcResults.f_benchmark_single_collecte = {
      data: null,
      error: { message: 'Collecte not accessible' },
    };
    rls.results.collectes = { data: null, error: null };
    const { GET } =
      await import('@/app/api/v1/gestionnaire/collectes/[id]/benchmark/route.js');
    const res = await GET(
      req('/api/v1/gestionnaire/collectes/c1/benchmark'),
      params,
    );
    expect(res.status).toBe(404);
  });
});

describe('M3.2 / demande urgente — espace gestionnaire', () => {
  it('M3.2/urgence_gestionnaire_ok — collecte visible, coordonnées manquantes : alerte créée', async () => {
    rls.results.collectes = {
      data: {
        id: 'c1',
        statut: 'validee',
        date_collecte: '2026-10-28',
        heure_collecte: '22:00:00',
        evenement: { lieu: { nom: 'Paris Expo' } },
      },
      error: null,
    };
    const { POST } =
      await import('@/app/api/v1/gestionnaire/collectes/[id]/coordonnees-urgence/route.js');
    const res = await POST(
      req('/api/v1/gestionnaire/collectes/c1/coordonnees-urgence', 'POST'),
      params,
    );
    expect(res.status).toBe(200);
    expect(admin.inserts[0]?.table).toBe('alertes_admin');
    expect(mockRequireUser).toHaveBeenCalledWith(expect.anything(), [
      'gestionnaire_lieux',
    ]);
  });
});
