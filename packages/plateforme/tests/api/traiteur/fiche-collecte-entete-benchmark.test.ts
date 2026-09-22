/**
 * M3.1 — Fiche collecte traiteur §06.04 : bloc d'entête complété + Bloc 3 ZD.
 *
 * Couvre côté API :
 *  · entête « Type d'événement + taille (bracket calculé sur pax) »
 *  · badge « Programmée par » (tiers uniquement) et son absence sinon — avec la
 *    preuve qu'AUCUNE lecture de `organisations` n'est faite quand l'événement
 *    n'est pas programmé par un tiers (pas d'élargissement de surface service-role)
 *  · route Bloc 3 : ratio de la collecte + repère parc, k-anonymat (repère masqué),
 *    collecte hors périmètre → 404, garde `traiteur_ids[]` interdite au traiteur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  const rpcResults: Record<string, Result> = {};
  const calls: string[] = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const eqCalls: Array<{ table: string; args: unknown[] }> = [];
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (...args: unknown[]) => {
        eqCalls.push({ table, args });
        return c;
      },
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
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResults[name] ?? { data: null, error: null });
    },
    results,
    rpcResults,
    calls,
    rpcCalls,
    eqCalls,
  };
  return api;
}

let rls = makeClient();
let admin = makeClient();
const mockRequireUser = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({ sendEmail: vi.fn() }));

function makeReq(qs = ''): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/traiteur/collectes/c1/benchmark${qs}`,
  );
}

/** Collecte RLS-visible, avec l'événement portant pax / type / organisations. */
function collecteAvecEvenement(evt: Record<string, unknown>) {
  return {
    data: {
      id: 'c1',
      type: 'zero_dechet',
      statut: 'cloturee',
      evenement: {
        id: 'e1',
        organisation_id: 'org-1',
        traiteur_operationnel_organisation_id: 'org-1',
        ...evt,
      },
    },
    error: null,
  };
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
});

describe('M3.1 / fiche collecte — bloc d’entête (§06.04)', () => {
  it('M3.1/fiche_entete_type_et_taille_bracket — pax 300 ⇒ bracket S', async () => {
    rls.results.collectes = collecteAvecEvenement({
      pax: 300,
      type_evenement: { libelle: 'Cocktail apéritif' },
    });

    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
    const { data } = (await res.json()) as {
      data: {
        taille_bracket: string | null;
        evenement: { type_evenement: { libelle: string } };
      };
    };
    // Bornes §04 taille_evenement_bracket : 250 ≤ 300 < 500 ⇒ S (et pas XS).
    expect(data.taille_bracket).toBe('S');
    expect(data.evenement.type_evenement.libelle).toBe('Cocktail apéritif');
  });

  it('M3.1/fiche_entete_taille_null_sans_pax — informations incomplètes ⇒ pas de bracket inventé', async () => {
    rls.results.collectes = collecteAvecEvenement({ pax: null });

    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
    const { data } = (await res.json()) as {
      data: { taille_bracket: string | null };
    };
    expect(data.taille_bracket).toBeNull();
  });

  it('M3.1/fiche_entete_programmee_par_tiers — orga programmatrice ≠ traiteur opérationnel', async () => {
    rls.results.collectes = collecteAvecEvenement({
      pax: 120,
      organisation_id: 'org-agence',
      traiteur_operationnel_organisation_id: 'org-1',
    });
    admin.results.organisations = {
      data: {
        nom: 'Agence Caromy',
        type: 'agence',
        email_principal: 'contact@caromy.fr',
      },
      error: null,
    };

    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
    const { data } = (await res.json()) as {
      data: {
        programmee_par: { nom: string; type: string; email: string } | null;
      };
    };
    expect(data.programmee_par).toEqual({
      nom: 'Agence Caromy',
      type: 'agence',
      email: 'contact@caromy.fr',
    });
    // C'est bien l'organisation PROGRAMMATRICE qui est lue, pas le traiteur
    // opérationnel : sans cet assert, lire l'autre colonne passerait aussi.
    expect(
      admin.eqCalls.find((e) => e.table === 'organisations')?.args,
    ).toEqual(['id', 'org-agence']);
  });

  it('M3.1/fiche_entete_programmee_par_absente — même organisation ⇒ null ET aucune lecture organisations', async () => {
    rls.results.collectes = collecteAvecEvenement({
      pax: 120,
      organisation_id: 'org-1',
      traiteur_operationnel_organisation_id: 'org-1',
    });
    // Piège : si la route lisait quand même la table, elle trouverait cette ligne.
    admin.results.organisations = {
      data: {
        nom: 'NE DOIT PAS FUIR',
        type: 'traiteur',
        email_principal: null,
      },
      error: null,
    };

    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
    const { data } = (await res.json()) as {
      data: { programmee_par: unknown };
    };
    expect(data.programmee_par).toBeNull();
    expect(admin.calls).not.toContain('organisations');
  });
});

describe('M3.1 / fiche collecte — Bloc 3 ZD jauges (§06.04)', () => {
  it('M3.1/fiche_bloc3_ratio_et_repere — ratio collecte + moyenne parc par flux', async () => {
    rls.rpcResults.f_benchmark_single_collecte = {
      data: [{ flux_code: 'biodechet', ratio_user: 0.42 }],
      error: null,
    };
    // Deux segments type × taille pour le même flux : le repère servi doit être
    // leur moyenne pondérée par l'effectif, pas la première ligne venue.
    rls.rpcResults.f_benchmark_kg_pax_zd = {
      data: [
        {
          flux_code: 'biodechet',
          kg_par_pax_moyen: 0.3,
          nb_collectes_segment: 5,
        },
        {
          flux_code: 'biodechet',
          kg_par_pax_moyen: 0.4,
          nb_collectes_segment: 15,
        },
      ],
      error: null,
    };

    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/benchmark/route.js');
    const res = await GET(
      makeReq(
        '?type_evenement_ids=t1&taille_evenement_codes=S&periode_debut=2025-09-22&periode_fin=2026-09-22',
      ),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(200);
    // Les filtres de l'URL atteignent réellement la RPC parc — sinon le repère
    // serait calculé sur tout le parc, sans que rien ne le signale.
    expect(
      rls.rpcCalls.find((c) => c.name === 'f_benchmark_kg_pax_zd')?.args,
    ).toMatchObject({
      p_type_evenement_ids: ['t1'],
      p_taille_evenement_codes: ['S'],
      p_periode_debut: '2025-09-22',
      p_periode_fin: '2026-09-22',
    });
    const { data } = (await res.json()) as {
      data: {
        flux: Record<string, { ratio_user: number; benchmark_kg_pax: number }>;
      };
    };
    const bio = data.flux.biodechet!;
    expect(bio.ratio_user).toBe(0.42);
    // (0,3×5 + 0,4×15) / 20 = 0,375
    expect(bio.benchmark_kg_pax).toBeCloseTo(0.375, 6);
  });

  it('M3.1/fiche_bloc3_k_anonymat — segment < 5 collectes ⇒ repère parc masqué, ratio conservé', async () => {
    // k-anonymat appliqué DANS f_benchmark_kg_pax_zd (HAVING ≥ 5) : un segment
    // trop petit ne rend aucune ligne — le flux est donc absent de l'agrégat.
    rls.rpcResults.f_benchmark_single_collecte = {
      data: [{ flux_code: 'verre', ratio_user: 0.1 }],
      error: null,
    };
    rls.rpcResults.f_benchmark_kg_pax_zd = { data: [], error: null };

    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/benchmark/route.js');
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
    const { data } = (await res.json()) as {
      data: {
        flux: Record<
          string,
          { ratio_user: number; benchmark_kg_pax: number | null }
        >;
      };
    };
    const verre = data.flux.verre!;
    expect(verre.ratio_user).toBe(0.1);
    // Le ratio du demandeur n'est PAS anonymisable : seul le repère parc tombe.
    expect(verre.benchmark_kg_pax).toBeNull();
  });

  it('M3.1/fiche_bloc3_collecte_hors_perimetre_404 — garde SQL « Collecte not accessible »', async () => {
    rls.rpcResults.f_benchmark_single_collecte = {
      data: null,
      error: { message: 'Collecte not accessible' },
    };

    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/benchmark/route.js');
    const res = await GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(404);
  });

  it('M3.1/fiche_bloc3_traiteur_ids_rejete — filtre concurrentiel interdit au traiteur (§04)', async () => {
    rls.rpcResults.f_benchmark_single_collecte = {
      data: [{ flux_code: 'carton', ratio_user: 0.2 }],
      error: null,
    };

    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/benchmark/route.js');
    // traiteur_ids SEUL, sans aucun autre filtre : la garde doit s'armer quand
    // même (un chemin conditionnel l'aurait laissée dormir ici).
    const res = await GET(makeReq('?traiteur_ids=org-2'), {
      params: Promise.resolve({ id: 'c1' }),
    });
    expect(res.status).toBe(403);
    // La garde tombe AVANT toute interrogation du parc.
    expect(rls.rpcCalls.map((c) => c.name)).not.toContain(
      'f_benchmark_kg_pax_zd',
    );
  });
});
