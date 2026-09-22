/**
 * R25a — Filtres de la liste Collectes traiteur (§06.04 §3 « Filtres disponibles »,
 * BL-P2-14 volet filtres).
 *
 * Deux routes couvertes :
 *  - GET /api/v1/traiteur/collectes  → les 3 filtres ajoutés (client organisateur,
 *    info incomplète, programmée par) sont bien traduits en prédicats serveur, et
 *    l'absence de paramètre ne pose AUCUN prédicat (pas de filtrage fantôme).
 *  - GET /api/v1/traiteur/collectes/filtres → options dérivées du périmètre RLS de
 *    l'appelant ; les noms d'organisations tierces sont résolus en service_role
 *    STRICTEMENT bornés aux ids vus dans ce périmètre (aucun élargissement RLS).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

/** Client mocké qui ENREGISTRE les prédicats posés, par table. */
function makeClient() {
  const results: Record<string, Result> = {};
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: [], error: null };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) {
      c[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return c;
      };
    }
    c.then = (resolve: (v: Result) => unknown) => resolve(res());
    return c;
  }
  return { from: (t: string) => chain(t), results, calls };
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

/** Prédicats posés sur une table, sous forme `method:champ=valeur`. */
function predicats(
  client: ReturnType<typeof makeClient>,
  table: string,
): string[] {
  return client.calls
    .filter(
      (c) => c.table === table && (c.method === 'eq' || c.method === 'in'),
    )
    .map(
      (c) => `${c.method}:${String(c.args[0])}=${JSON.stringify(c.args[1])}`,
    );
}

async function callListe(qs: string) {
  const { GET } = await import('@/app/api/v1/traiteur/collectes/route.js');
  return GET(
    new NextRequest(`http://localhost/api/v1/traiteur/collectes?${qs}`),
  );
}
async function callFiltres() {
  const { GET } =
    await import('@/app/api/v1/traiteur/collectes/filtres/route.js');
  return GET(
    new NextRequest('http://localhost/api/v1/traiteur/collectes/filtres'),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'u1', role: 'traiteur_manager', organisationId: 'org-1' },
  });
});

describe('R25a / liste collectes traiteur — filtres serveur', () => {
  it('R25a/filtre_client_organisateur_sur_le_nom', async () => {
    await callListe('type=zero_dechet&client=Groupe%20Danone');
    // Keyé sur le NOM : client_organisateur_organisation_id est réservé Admin et
    // reste NULL sur les événements programmés par un traiteur.
    expect(predicats(rls, 'collectes')).toContain(
      'eq:evenements.nom_client_organisateur="Groupe Danone"',
    );
  });

  it('R25a/filtre_info_incomplete_oui_inverse_le_booleen', async () => {
    await callListe('type=zero_dechet&info_incomplete=oui');
    expect(predicats(rls, 'collectes')).toContain(
      'eq:informations_completes=false',
    );
  });

  it('R25a/filtre_info_incomplete_non_inverse_le_booleen', async () => {
    await callListe('type=zero_dechet&info_incomplete=non');
    expect(predicats(rls, 'collectes')).toContain(
      'eq:informations_completes=true',
    );
  });

  it('R25a/filtre_info_incomplete_valeur_inconnue_ignoree', async () => {
    await callListe('type=zero_dechet&info_incomplete=peut-etre');
    expect(
      predicats(rls, 'collectes').some((p) =>
        p.startsWith('eq:informations_completes'),
      ),
    ).toBe(false);
  });

  it('R25a/filtre_programmee_par_multi', async () => {
    await callListe('type=zero_dechet&programmee_par=org-1,org-9');
    expect(predicats(rls, 'collectes')).toContain(
      'in:evenements.organisation_id=["org-1","org-9"]',
    );
  });

  it('R25a/filtre_programmee_par_vide_ne_pose_pas_de_predicat', async () => {
    await callListe('type=zero_dechet&programmee_par=,,');
    expect(
      predicats(rls, 'collectes').some((p) =>
        p.startsWith('in:evenements.organisation_id'),
      ),
    ).toBe(false);
  });

  it('R25a/aucun_filtre_aucun_predicat_fantome', async () => {
    await callListe('type=zero_dechet&statut=cloturee');
    const p = predicats(rls, 'collectes');
    expect(p.some((x) => x.startsWith('eq:evenements.nom_client'))).toBe(false);
    expect(p.some((x) => x.startsWith('eq:informations_completes'))).toBe(
      false,
    );
    expect(p.some((x) => x.startsWith('in:evenements.organisation_id'))).toBe(
      false,
    );
  });
});

describe('R25a / options des filtres — périmètre et service_role borné', () => {
  const perimetre = {
    data: [
      {
        evenements: {
          organisation_id: 'org-1',
          nom_client_organisateur: ' Danone ',
          lieux: { id: 'lieu-a', nom: 'Pavillon Gabriel' },
        },
      },
      {
        // Événement possédé par une AGENCE, opéré par le traiteur → « Programmée par ».
        evenements: {
          organisation_id: 'org-agence',
          nom_client_organisateur: 'Publicis',
          lieux: [{ id: 'lieu-b', nom: 'Carrousel du Louvre' }],
        },
      },
      {
        // Doublons + client vide : ne doivent pas produire d'options en double.
        evenements: {
          organisation_id: 'org-1',
          nom_client_organisateur: '   ',
          lieux: { id: 'lieu-a', nom: 'Pavillon Gabriel' },
        },
      },
    ],
    error: null,
  };

  it('R25a/options_lieux_clients_dedupliques_et_tries', async () => {
    rls.results.collectes = perimetre;
    admin.results.organisations = {
      data: [{ id: 'org-agence', nom: 'WPM', type: 'agence' }],
      error: null,
    };
    const res = await callFiltres();
    const json = (await res.json()) as {
      data: {
        lieux: { id: string; nom: string }[];
        clients: string[];
        programmateurs: { id: string; nom: string; type: string | null }[];
      };
    };
    expect(json.data.lieux).toEqual([
      { id: 'lieu-b', nom: 'Carrousel du Louvre' },
      { id: 'lieu-a', nom: 'Pavillon Gabriel' },
    ]);
    // Nom trimé, vide ignoré, pas de doublon.
    expect(json.data.clients).toEqual(['Danone', 'Publicis']);
  });

  it('R25a/options_programmateurs_mon_organisation_puis_tiers_nommes', async () => {
    rls.results.collectes = perimetre;
    admin.results.organisations = {
      data: [{ id: 'org-agence', nom: 'WPM', type: 'agence' }],
      error: null,
    };
    const res = await callFiltres();
    const json = (await res.json()) as {
      data: {
        programmateurs: { id: string; nom: string; type: string | null }[];
      };
    };
    expect(json.data.programmateurs).toEqual([
      { id: 'org-1', nom: 'Mon organisation', type: null },
      { id: 'org-agence', nom: 'WPM', type: 'agence' },
    ]);
  });

  it('R25a/options_service_role_borne_aux_ids_du_perimetre', async () => {
    rls.results.collectes = perimetre;
    admin.results.organisations = {
      data: [{ id: 'org-agence', nom: 'WPM', type: 'agence' }],
      error: null,
    };
    await callFiltres();
    // Le service_role ne lit QUE les organisations tierces sorties du périmètre
    // RLS — jamais la table entière, et jamais l'organisation de l'appelant.
    const inOrgs = admin.calls.filter(
      (c) => c.table === 'organisations' && c.method === 'in',
    );
    expect(inOrgs).toHaveLength(1);
    expect(inOrgs[0]!.args).toEqual(['id', ['org-agence']]);
  });

  it('R25a/options_sans_tiers_aucun_appel_service_role', async () => {
    rls.results.collectes = {
      data: [
        {
          evenements: {
            organisation_id: 'org-1',
            nom_client_organisateur: 'Danone',
            lieux: { id: 'lieu-a', nom: 'Pavillon Gabriel' },
          },
        },
      ],
      error: null,
    };
    await callFiltres();
    expect(admin.calls).toHaveLength(0);
  });
});
