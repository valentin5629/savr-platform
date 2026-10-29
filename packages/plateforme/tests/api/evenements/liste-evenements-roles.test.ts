/**
 * Liste Événements commune à tous les rôles (décision Val 2026-10-29) : route
 * /api/v1/evenements et ses options de filtres.
 *
 * Les sondes mesurent, rôle par rôle, le CLIENT utilisé (session de l'appelant,
 * donc sa RLS, ou service_role pour le staff seul) et les chemins de lecture
 * que la RLS impose (embed des repas, nom du traiteur). Le bilan et les filtres
 * communs sont couverts par tests/api/gestionnaire/evenements.m3-2.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown; count?: number | null };

/** Client simulé : un résultat par table, chaque appel enregistré. */
function makeClient(resultats: Record<string, Result>) {
  const calls: { table: string; m: string; args: unknown[] }[] = [];
  const rpc = vi.fn(
    async (_fn: string, _args?: unknown): Promise<Result> => ({
      data: null,
      error: null,
    }),
  );
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of [
      'select',
      'eq',
      'in',
      'not',
      'neq',
      'or',
      'gte',
      'lte',
      'order',
      'range',
    ]) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, m, args });
        return chain;
      };
    }
    chain.then = (resolve: (r: Result) => unknown) =>
      resolve(resultats[table] ?? { data: [], error: null, count: 0 });
    calls.push({ table, m: 'from', args: [] });
    return chain;
  };
  return { from, rpc, calls };
}

let session = makeClient({});
let service = makeClient({});
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (t: string) => session.from(t),
    rpc: (...a: unknown[]) =>
      (session.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (t: string) => service.from(t),
    rpc: (...a: unknown[]) =>
      (service.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));

import { GET as LISTE } from '@/app/api/v1/evenements/route.js';
import { GET as FILTRES } from '@/app/api/v1/evenements/filtres/route.js';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function connecte(role: string) {
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, organisation_id: 'org-1' }),
      },
    },
    error: null,
  });
}

const EVT = {
  id: 'e1',
  nom_evenement: 'Gala',
  date_evenement: '2026-11-02',
  pax: 300,
  nom_client_organisateur: 'Maison X',
  traiteur_operationnel_organisation_id: 'T1',
  lieux: {
    nom: 'Pavillon',
    adresse_acces: null,
    code_postal: null,
    ville: null,
  },
  collectes: [
    {
      id: 'c-ag',
      type: 'anti_gaspi',
      statut: 'cloturee',
      date_collecte: '2026-11-02',
      taux_recyclage: null,
      co2_evite_kg: null,
      collecte_flux: [],
    },
  ],
};

const liste = (qs = '') =>
  LISTE(new NextRequest(`http://localhost/api/v1/evenements${qs}`));
const selectEvenements = (c: ReturnType<typeof makeClient>) =>
  String(
    c.calls.find((x) => x.table === 'evenements' && x.m === 'select')
      ?.args[0] ?? '',
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
});

describe('Liste Événements — tous les rôles', () => {
  it('M3.2/evenements_liste_ouverte_aux_six_roles — chacun obtient sa liste', async () => {
    for (const role of [
      'admin_savr',
      'ops_savr',
      'traiteur_manager',
      'traiteur_commercial',
      'agence',
      'gestionnaire_lieux',
      'client_organisateur',
    ]) {
      session = makeClient({ evenements: { data: [], error: null, count: 0 } });
      service = makeClient({ evenements: { data: [], error: null, count: 0 } });
      connecte(role);
      expect((await liste()).status, role).toBe(200);
    }
  });

  it('M3.2/evenements_liste_client_selon_role — service_role pour le staff SEUL, la session (RLS) pour tout rôle client', async () => {
    for (const role of ['admin_savr', 'ops_savr']) {
      session = makeClient({});
      service = makeClient({});
      connecte(role);
      await liste();
      expect(
        service.calls.some((c) => c.table === 'evenements'),
        role,
      ).toBe(true);
      expect(
        session.calls.some((c) => c.table === 'evenements'),
        role,
      ).toBe(false);
    }
    for (const role of [
      'traiteur_manager',
      'traiteur_commercial',
      'agence',
      'gestionnaire_lieux',
      'client_organisateur',
    ]) {
      session = makeClient({});
      service = makeClient({});
      connecte(role);
      await liste();
      expect(service.calls, role).toEqual([]);
      expect(
        session.calls.some((c) => c.table === 'evenements'),
        role,
      ).toBe(true);
    }
  });

  it('M3.2/evenements_liste_chemins_rls_par_role — vues du gestionnaire à lui seul, aucun embed de repas pour le client organisateur', async () => {
    const lire = async (role: string) => {
      session = makeClient({});
      service = makeClient({});
      connecte(role);
      await liste();
      return selectEvenements(
        role === 'admin_savr' ? service : session,
      ).replace(/\s+/g, ' ');
    };
    const gest = await lire('gestionnaire_lieux');
    expect(gest).toContain('v_attributions_gestionnaire');
    expect(gest).toContain('v_traiteurs_gestionnaire');
    for (const role of ['traiteur_manager', 'agence', 'admin_savr']) {
      const s = await lire(role);
      expect(s, role).not.toContain('_gestionnaire');
      expect(s, role).toContain('attributions_antgaspi(volume_repas_realise)');
    }
    const orga = await lire('client_organisateur');
    expect(orga).not.toContain('attributions_antgaspi');
    expect(orga).not.toContain('organisations');
  });

  it('M3.2/evenements_liste_repas_organisateur_par_helper — f_volume_repas_realise sur les collectes AG clôturées', async () => {
    session = makeClient({
      evenements: {
        data: [structuredClone(EVT)],
        error: null,
        count: 1,
      },
      v_referentiel_traiteurs: {
        data: [{ id: 'T1', nom: 'Potel' }],
        error: null,
      },
    });
    session.rpc.mockImplementation(async (fn: string) =>
      fn === 'f_volume_repas_realise'
        ? { data: 120, error: null }
        : { data: null, error: null },
    );
    connecte('client_organisateur');
    const json = (await (await liste()).json()) as {
      data: { repas_donnes: number | null; traiteur_nom: string | null }[];
    };
    expect(session.rpc).toHaveBeenCalledWith('f_volume_repas_realise', {
      p_collecte_id: 'c-ag',
    });
    expect(json.data[0]).toMatchObject({
      repas_donnes: 120,
      traiteur_nom: 'Potel',
    });
  });

  it('M3.2/evenements_liste_nom_traiteur_par_referentiel — traiteur et agence lisent le nom par v_referentiel_traiteurs, borné aux ids de la page', async () => {
    for (const role of ['traiteur_manager', 'agence']) {
      session = makeClient({
        evenements: { data: [structuredClone(EVT)], error: null, count: 1 },
        v_referentiel_traiteurs: {
          data: [{ id: 'T1', nom: 'Potel' }],
          error: null,
        },
      });
      connecte(role);
      const json = (await (await liste()).json()) as {
        data: { traiteur_nom: string | null }[];
      };
      expect(json.data[0]!.traiteur_nom, role).toBe('Potel');
      const borne = session.calls.find(
        (c) => c.table === 'v_referentiel_traiteurs' && c.m === 'in',
      );
      expect(borne?.args, role).toEqual(['id', ['T1']]);
    }
  });

  it('M3.2/evenements_liste_filtre_client_staff_seul — client_ids appliqué au staff, ignoré ailleurs', async () => {
    const ID = '33333333-3333-4333-8333-333333333333';
    session = makeClient({});
    service = makeClient({});
    connecte('admin_savr');
    await liste(`?client_ids=${ID}`);
    expect(
      service.calls.find((c) => c.m === 'in' && c.args[0] === 'organisation_id')
        ?.args,
    ).toEqual(['organisation_id', [ID]]);

    session = makeClient({});
    connecte('agence');
    await liste(`?client_ids=${ID}`);
    expect(
      session.calls.some(
        (c) => c.m === 'in' && c.args[0] === 'organisation_id',
      ),
    ).toBe(false);
  });

  it('M3.2/evenements_liste_refuse_hors_role — rôle inconnu 403, sans lecture', async () => {
    session = makeClient({});
    service = makeClient({});
    connecte('inconnu');
    expect((await liste()).status).toBe(403);
    expect(session.calls).toEqual([]);
    expect(service.calls).toEqual([]);
  });
});

describe('Options de filtres Événements', () => {
  const filtres = () =>
    FILTRES(new NextRequest('http://localhost/api/v1/evenements/filtres'));

  it('M3.2/evenements_filtres_derives_du_perimetre — agence : lieux et traiteurs de ses événements, aucun client', async () => {
    session = makeClient({
      evenements: {
        data: [
          {
            traiteur_operationnel_organisation_id: 'T1',
            lieux: { id: 'L1', nom: 'Pavillon' },
          },
        ],
        error: null,
      },
      v_referentiel_traiteurs: {
        data: [{ id: 'T1', nom: 'Potel' }],
        error: null,
      },
      types_evenements: { data: [{ id: 'TE', libelle: 'Gala' }], error: null },
    });
    connecte('agence');
    const json = (await (await filtres()).json()) as {
      data: Record<string, unknown>;
    };
    expect(json.data).toEqual({
      lieux: [{ id: 'L1', nom: 'Pavillon' }],
      traiteurs: [{ id: 'T1', nom: 'Potel' }],
      clients: [],
      types: [{ id: 'TE', libelle: 'Gala' }],
    });
  });

  it('M3.2/evenements_filtres_traiteur_sans_liste_de_traiteurs', async () => {
    session = makeClient({
      evenements: {
        data: [
          {
            traiteur_operationnel_organisation_id: 'T1',
            lieux: { id: 'L1', nom: 'Pavillon' },
          },
        ],
        error: null,
      },
    });
    connecte('traiteur_commercial');
    const json = (await (await filtres()).json()) as {
      data: { traiteurs: unknown[] };
    };
    expect(json.data.traiteurs).toEqual([]);
    expect(
      session.calls.some((c) => c.table === 'v_referentiel_traiteurs'),
    ).toBe(false);
  });

  it('M3.2/evenements_filtres_echec_500 — une lecture en échec ne se lit jamais « aucun lieu »', async () => {
    session = makeClient({
      evenements: { data: null, error: { code: '42501' } },
    });
    connecte('agence');
    expect((await filtres()).status).toBe(500);
  });
});
