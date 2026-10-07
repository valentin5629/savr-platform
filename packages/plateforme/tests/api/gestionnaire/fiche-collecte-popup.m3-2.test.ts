/**
 * M3.2 — Pop-up fiche collecte client côté gestionnaire de lieux (§06.05 : reprend
 * le pop-up §06.04, refonte Val 2026-09-29), côté API.
 *
 * Exigences de la revue sécurité du sync 2026-09-29 :
 *  · attribution AG (repas, association) lue par la vue
 *    v_attributions_gestionnaire (§04) — jamais par la table (aa_select jamais
 *    élargie), jamais en service-role ;
 *  · radar : f_benchmark_single_collecte refuse les collectes de traiteurs tiers →
 *    « pas de radar » (200, data null), JAMAIS de contournement ;
 *  · documents lus sous la RLS du gestionnaire, jamais en service-role ;
 *  · aucune annulation (§05 : gestion exclusive au traiteur).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  makeClient,
  ligneCollecte,
  reserveEvenement,
} from '../helpers/fiche-client-mock';
import { ERREUR_FILTRE_HORS_PERIMETRE } from '@/lib/dashboards/loaders.js';

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

describe('M3.2 / fiche client gestionnaire — association (vue v_attributions_gestionnaire)', () => {
  it('M3.2/fiche_get_association_par_vue — AG d’un traiteur tiers : association servie, lue par la vue et jamais par la table', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ type: 'anti_gaspi', statut: 'cloturee', ...TIERS }),
      error: null,
    };
    // La vue porte nom et ville à plat ; la description vient d'`associations`.
    rls.results.v_attributions_gestionnaire = {
      data: {
        volume_repas_realise: 840,
        association_nom: 'Les Restos du Cœur',
        association_ville: 'Paris',
        association: { description_rapport_impact: 'Aide alimentaire.' },
      },
      error: null,
    };
    // Piège : aa_select refuse la table au gestionnaire (C-1) — la lire rendrait
    // un bloc vide en production.
    rls.results.attributions_antgaspi = { data: null, error: null };
    const { json } = await getFiche();
    expect(json.data.association).toEqual({
      nom: 'Les Restos du Cœur',
      ville: 'Paris',
      description: 'Aide alimentaire.',
    });
    expect(rls.calls).toContain('v_attributions_gestionnaire');
    expect(rls.calls).not.toContain('attributions_antgaspi');
    expect(rls.eqs.v_attributions_gestionnaire).toEqual([
      ['collecte_id', 'c1'],
    ]);
    // Aucune lecture élargie : ni la table ni la vue en service-role.
    expect(admin.calls).not.toContain('attributions_antgaspi');
    expect(admin.calls).not.toContain('v_attributions_gestionnaire');
    expect(admin.calls).not.toContain('associations');
  });
});

// §06.05 : le gestionnaire ne voit pas les données personnelles / commerciales
// des traiteurs au-delà du nom et du logo (arbitrages Val C2/C3 2026-10-01).
describe('M3.2 / fiche client gestionnaire — contacts et référence d’affaire', () => {
  it('M3.2/fiche_get_contacts_tiers_masques — collecte d’un traiteur tiers : contacts et référence ni lus ni servis', async () => {
    rls.results.collectes = { data: ligneCollecte(TIERS), error: null };
    // Piège : la base renverrait tout si on la lisait.
    admin.results.evenements = { data: reserveEvenement(), error: null };
    const { res, json } = await getFiche();
    expect(res.status).toBe(200);
    expect(json.data.evenement).toMatchObject({
      contacts_visibles: false,
      contact_principal_nom: null,
      contact_principal_telephone: null,
      contact_secours_nom: null,
      contact_secours_telephone: null,
      reference_affaire: null,
    });
    const texte = JSON.stringify(json);
    expect(texte).not.toContain('0611223344');
    expect(texte).not.toContain('0655443322');
    expect(texte).not.toContain('AFF-2026-042');
    // Pas seulement caché : aucune lecture, ni sous RLS ni en service-role.
    expect(admin.calls).not.toContain('evenements');
    expect(rls.calls).not.toContain('evenements');
    expect(rls.selects.collectes?.[0]).not.toContain('contact_');
    expect(rls.selects.collectes?.[0]).not.toContain('reference_affaire');
  });

  it('M3.2/fiche_get_contacts_propre_programmation — collecte programmée par le gestionnaire : contacts + référence servis', async () => {
    rls.results.collectes = {
      data: ligneCollecte({
        evenement: {
          ...ligneCollecte().evenement,
          organisation_id: 'org-gest',
        },
      }),
      error: null,
    };
    admin.results.evenements = { data: reserveEvenement(), error: null };
    const { json } = await getFiche();
    expect(json.data.evenement).toMatchObject({
      contacts_visibles: true,
      contact_principal_nom: 'Paul',
      contact_principal_telephone: '0611223344',
      reference_affaire: 'AFF-2026-042',
    });
    expect(admin.eqs.evenements).toEqual([['id', 'e1']]);
  });
});

describe('M3.2 / fiche client gestionnaire — repas des collectes tierces (vue)', () => {
  it('M3.2/fiche_get_repas_tiers_par_vue — AG d’un traiteur tiers : volume de l’attribution lu par la vue, pas dans l’attestation', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ type: 'anti_gaspi', statut: 'cloturee', ...TIERS }),
      error: null,
    };
    rls.results.v_attributions_gestionnaire = {
      data: {
        volume_repas_realise: 150,
        association_nom: 'Asso',
        association_ville: null,
        association: null,
      },
      error: null,
    };
    // Piège : une attestation au chiffre différent ne doit plus servir de source.
    rls.results.attestations_don = {
      data: {
        eligible_at: '2020-01-01T00:00:00Z',
        pdf_url: 'att.pdf',
        nb_repas: 999,
      },
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.repas_donnes).toBe(150);
    expect(rls.selects.attestations_don?.[0]).not.toContain('nb_repas');
    expect(rls.selects.v_attributions_gestionnaire?.[0]).toContain(
      'volume_repas_realise',
    );
    expect(admin.calls).not.toContain('attestations_don');
    expect(admin.calls).not.toContain('attributions_antgaspi');
  });

  it('M3.2/fiche_get_repas_tiers_sans_attribution — la vue ne rend rien : « — », pas d’association', async () => {
    rls.results.collectes = {
      data: ligneCollecte({ type: 'anti_gaspi', statut: 'cloturee', ...TIERS }),
      error: null,
    };
    rls.results.v_attributions_gestionnaire = { data: null, error: null };
    // Piège : l'attestation existe, mais elle n'est plus un repli.
    rls.results.attestations_don = {
      data: {
        eligible_at: '2020-01-01T00:00:00Z',
        pdf_url: 'att.pdf',
        nb_repas: 150,
      },
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.repas_donnes).toBeNull();
    expect(json.data.association).toBeNull();
  });

  it('M3.2/fiche_get_repas_propre_programmation — AG programmée par le gestionnaire : même chemin, la vue', async () => {
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
    rls.results.v_attributions_gestionnaire = {
      data: {
        volume_repas_realise: 320,
        association_nom: 'Asso',
        association_ville: 'Lyon',
        association: null,
      },
      error: null,
    };
    const { json } = await getFiche();
    expect(json.data.repas_donnes).toBe(320);
    expect(rls.calls).not.toContain('attributions_antgaspi');
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

  it('M3.2/fiche_benchmark_filtre_hors_perimetre_403 — lieu non rattaché nommé dans le filtre du repère : 403 au libellé fixe', async () => {
    rls.rpcResults.f_benchmark_single_collecte = {
      data: [{ flux_code: 'biodechet', ratio_user: 0.4 }],
      error: null,
    };
    // Garde de périmètre de f_benchmark_kg_pax_zd (20261006220000).
    rls.rpcResults.f_benchmark_kg_pax_zd = {
      data: null,
      error: {
        code: '42501',
        message: 'Filtre lieu_ids hors des lieux rattaches au gestionnaire',
      },
    };
    const { GET } =
      await import('@/app/api/v1/gestionnaire/collectes/[id]/benchmark/route.js');
    const res = await GET(
      req('/api/v1/gestionnaire/collectes/c1/benchmark?lieu_ids=lieu-tiers'),
      params,
    );
    expect(res.status).toBe(403);
    // Libellé de l'application : ni le message Postgres, ni celui de la garde
    // « traiteur_ids » des rôles traiteur.
    expect(await res.json()).toEqual({ error: ERREUR_FILTRE_HORS_PERIMETRE });
    expect(admin.rpcCalls).toHaveLength(0);
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
