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
      'gt',
      'limit',
      'order',
      'range',
    ]) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, m, args });
        return chain;
      };
    }
    chain.maybeSingle = () =>
      Promise.resolve(resultats[table] ?? { data: null, error: null });
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
// Fiche collecte client : jamais chargée pour l'Admin ni l'organisateur.
const mockCharger = vi.fn();
vi.mock('@/lib/collectes/fiche-client.js', () => ({
  chargerFicheCollecteClient: (...a: unknown[]) => mockCharger(...a),
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
import { GET as FICHE } from '@/app/api/v1/evenements/[id]/route.js';

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
        data: [
          {
            ...structuredClone(EVT),
            collectes: [
              ...structuredClone(EVT.collectes),
              { ...EVT.collectes[0]!, id: 'c-ag-avenir', statut: 'validee' },
            ],
          },
        ],
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
    // Une collecte AG pas encore clôturée ne porte aucun résultat : pas d'appel.
    expect(session.rpc).not.toHaveBeenCalledWith('f_volume_repas_realise', {
      p_collecte_id: 'c-ag-avenir',
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

  it('M3.2/evenements_liste_dechets_labo_gestionnaire_seul — f_dechets_labo_estimes jamais appelée hors gestionnaire, valeur absente de la réponse', async () => {
    const evtZd = {
      ...structuredClone(EVT),
      collectes: [{ ...EVT.collectes[0]!, id: 'c-zd', type: 'zero_dechet' }],
    };
    for (const role of [
      'admin_savr',
      'traiteur_manager',
      'traiteur_commercial',
      'agence',
      'client_organisateur',
    ]) {
      const res = { data: [structuredClone(evtZd)], error: null, count: 1 };
      session = makeClient({ evenements: res });
      service = makeClient({ evenements: res });
      for (const c of [session, service])
        c.rpc.mockImplementation(async () => ({ data: 30, error: null }));
      connecte(role);
      const json = (await (await liste()).json()) as {
        data: { dechets_labo_kg: number | null }[];
      };
      expect(json.data[0]!.dechets_labo_kg, role).toBeNull();
      for (const c of [session, service])
        expect(c.rpc, role).not.toHaveBeenCalledWith(
          'f_dechets_labo_estimes',
          expect.anything(),
        );
    }
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

  it('M3.2/evenements_filtres_staff_referentiels — service_role, traiteurs et organisations clientes, rien sous la session', async () => {
    session = makeClient({});
    service = makeClient({
      lieux: { data: [{ id: 'L1', nom: 'Pavillon' }], error: null },
      organisations: {
        data: [
          { id: 'A1', nom: null, raison_sociale: 'Agence Y', type: 'agence' },
          {
            id: 'T1',
            nom: 'Potel',
            raison_sociale: 'Potel SAS',
            type: 'traiteur',
          },
        ],
        error: null,
      },
      types_evenements: { data: [], error: null },
    });
    connecte('admin_savr');
    const json = (await (await filtres()).json()) as {
      data: Record<string, unknown>;
    };
    expect(json.data).toEqual({
      lieux: [{ id: 'L1', nom: 'Pavillon' }],
      traiteurs: [{ id: 'T1', nom: 'Potel' }],
      clients: [
        { id: 'A1', nom: 'Agence Y' },
        { id: 'T1', nom: 'Potel' },
      ],
      types: [],
    });
    expect(session.calls).toEqual([]);
  });

  it('M3.2/evenements_filtres_types_en_echec_500', async () => {
    session = makeClient({
      evenements: { data: [], error: null },
      types_evenements: { data: null, error: { code: '42501' } },
    });
    connecte('agence');
    expect((await filtres()).status).toBe(500);
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

describe('Fiche Événement — Admin et client organisateur', () => {
  const EVT_ID = '55555555-5555-4555-8555-555555555555';
  const evtFiche = () => ({
    id: EVT_ID,
    organisation_id: 'org-1',
    nom_evenement: 'Gala',
    date_evenement: '2026-10-02',
    pax: 300,
    nom_client_organisateur: 'Maison X',
    traiteur_operationnel_organisation_id: 'T1',
    lieux: {
      nom: 'Pavillon',
      adresse_acces: '1 rue A',
      code_postal: '75001',
      ville: 'Paris',
      acces_details: null,
    },
    types_evenements: { libelle: 'Gala' },
    collectes: [
      {
        id: 'c-ag',
        type: 'anti_gaspi',
        statut: 'cloturee',
        date_collecte: '2026-10-02',
        heure_collecte: '23:00:00',
        created_at: null,
        pax: 300,
        taux_recyclage: null,
        co2_evite_kg: null,
        controle_acces_requis: false,
        type_evenement: { libelle: 'Gala' },
        collecte_flux: [],
      },
    ],
  });
  const fiche = () =>
    FICHE(new NextRequest(`http://localhost/api/v1/evenements/${EVT_ID}`), {
      params: Promise.resolve({ id: EVT_ID }),
    });
  type Fiche = {
    data: {
      traiteur: { nom: string | null; a_logo: boolean } | null;
      ajouter_collecte: boolean;
      dechets_labo_kg: number | null;
      bilan: { repas_donnes: number | null };
      fiches: {
        id: string;
        contacts_visibles: boolean;
        tournees: unknown[];
        contact_principal_telephone: string | null;
      }[];
    };
  };

  it('M3.2/evenement_fiche_admin_cartes_legeres — service_role, cartes de collecte sans contacts ni chauffeurs, sans fiche collecte client, nom de toute organisation', async () => {
    session = makeClient({});
    service = makeClient({
      evenements: {
        data: {
          ...evtFiche(),
          collectes: evtFiche().collectes.map((c) => ({
            ...c,
            attributions_antgaspi: [
              {
                volume_repas_realise: 80,
                association_id: 'A1',
                associations: { id: 'A1', nom: 'Asso', ville: 'Paris' },
              },
            ],
          })),
        },
        error: null,
      },
      organisations: {
        data: { id: 'T1', nom: null, raison_sociale: 'Potel SAS' },
        error: null,
      },
    });
    mockCharger.mockClear();
    connecte('admin_savr');
    const res = await fiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as Fiche;
    expect(session.calls).toEqual([]);
    expect(mockCharger).not.toHaveBeenCalled();
    expect(data.traiteur).toEqual({
      id: 'T1',
      nom: 'Potel SAS',
      a_logo: false,
    });
    expect(data.ajouter_collecte).toBe(false);
    expect(data.dechets_labo_kg).toBeNull();
    expect(service.rpc).not.toHaveBeenCalled();
    expect(data.bilan.repas_donnes).toBe(80);
    expect(data.fiches).toHaveLength(1);
    expect(data.fiches[0]).toMatchObject({
      id: 'c-ag',
      contacts_visibles: false,
      tournees: [],
      contact_principal_telephone: null,
    }); // Statut en vue Admin, calculé par la route (clôturée = clôturée).
    expect(
      (data as unknown as { statuts_admin: Record<string, string> })
        .statuts_admin,
    ).toEqual({ 'c-ag': 'cloturee' });
  });

  it('M3.2/evenement_fiche_organisateur_repas_en_echec_500 — un repas illisible fait échouer la fiche, jamais un bilan faux', async () => {
    service = makeClient({});
    session = makeClient({ evenements: { data: evtFiche(), error: null } });
    session.rpc.mockImplementation(async () => ({
      data: null,
      error: { code: '42501' },
    }));
    connecte('client_organisateur');
    expect((await fiche()).status).toBe(500);
  });

  it('M3.2/evenement_fiche_organisateur_sans_detail — session, aucun embed d’attributions, repas par f_volume_repas_realise, cartes légères', async () => {
    service = makeClient({});
    session = makeClient({
      evenements: { data: evtFiche(), error: null },
      v_referentiel_traiteurs: {
        data: { id: 'T1', nom: 'Potel' },
        error: null,
      },
    });
    session.rpc.mockImplementation(async (fn: string) =>
      fn === 'f_volume_repas_realise'
        ? { data: 120, error: null }
        : { data: null, error: null },
    );
    mockCharger.mockClear();
    connecte('client_organisateur');
    const res = await fiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as Fiche;
    expect(service.calls).toEqual([]);
    expect(mockCharger).not.toHaveBeenCalled();
    expect(selectEvenements(session)).not.toContain('attributions_antgaspi');
    expect(session.rpc).toHaveBeenCalledWith('f_volume_repas_realise', {
      p_collecte_id: 'c-ag',
    });
    expect(data.bilan.repas_donnes).toBe(120);
    expect(data.traiteur?.nom).toBe('Potel');
    expect(data.ajouter_collecte).toBe(false);
    expect(data.fiches[0]).toMatchObject({
      contacts_visibles: false,
      tournees: [],
    });
  });
});
