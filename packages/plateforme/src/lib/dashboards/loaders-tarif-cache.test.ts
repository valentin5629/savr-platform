// Tableau de bord traiteur, test de charge du 2026-11-18 : le tarif de
// refacturation est lu en même temps que les collectes, et la méthode CO₂ est
// gardée 5 min en cache. Ce que la relecture sécurité a demandé de figer :
// une erreur du tarif fait toujours échouer le tableau de bord, une seule fois,
// sans rejet de promesse non observé ; le cache ne garde que des lectures
// réussies et expire à 5 min.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({
  logs: [] as unknown[],
  adminFrom: [] as string[],
  adminErreur: {} as Record<string, unknown>,
}));

vi.mock('@/lib/facturation-plateforme.js', () => ({
  facturationPlateformeActive: () => true,
}));
vi.mock('@savr/shared/src/logger/index.js', () => ({
  logger: {
    error: (...a: unknown[]) => {
      etat.logs.push(a);
    },
    warn: () => {},
    info: () => {},
    debug: () => {},
  },
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      etat.adminFrom.push(t);
      const res = () =>
        Promise.resolve(
          etat.adminErreur[t]
            ? { data: null, error: etat.adminErreur[t] }
            : t === 'parametres_facteurs_co2_ag'
              ? {
                  data: {
                    facteur_co2_evite_par_repas_kg: 3.1,
                    source_donnee: 'S',
                  },
                  error: null,
                }
              : t === 'parametres_facteurs_co2'
                ? {
                    data: [
                      {
                        code_flux: 'bio',
                        nom_flux: 'Bio',
                        fe_evite_kg_t: 1,
                        fe_induit_kg_t: 2,
                        energie_primaire_evitee_kwh_t: 3,
                      },
                    ],
                    error: null,
                  }
                : {
                    data: [{ cle: 'km_collecte_aller_retour', valeur: 77 }],
                    error: null,
                  },
        );
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: () => res(),
        then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
          res().then(f, r),
      };
      return q;
    },
  }),
}));

interface Conf {
  tables?: Record<string, unknown[]>;
  tablesErreur?: Record<string, unknown>;
  rpcErreur?: unknown;
  tarif?: unknown;
}
function makeSupabase(c: Conf) {
  const appels: string[] = [];
  const mk = (t: string) => {
    const list = () =>
      Promise.resolve(
        c.tablesErreur?.[t]
          ? { data: null, error: c.tablesErreur[t] }
          : { data: c.tables?.[t] ?? [], error: null },
      );
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      lte: () => q,
      in: () => q,
      gt: () => q,
      limit: () => q,
      order: () => q,
      maybeSingle: () =>
        list().then((r) => ({
          ...r,
          data: (r.data as unknown[] | null)?.[0] ?? null,
        })),
      then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => {
        appels.push(t);
        return list().then(f, r);
      },
    };
    return q;
  };
  return {
    appels,
    from: (t: string) => mk(t),
    rpc: (name: string) => {
      appels.push('rpc:' + name);
      return Promise.resolve(
        c.rpcErreur
          ? { data: null, error: c.rpcErreur }
          : { data: c.tarif ?? null, error: null },
      );
    },
  };
}

const CTX = { userId: 'u1', role: 'traiteur_manager', organisationId: 'org-1' };
const collecteZd = (id: string) => ({
  id,
  type: 'zero_dechet',
  date_collecte: '2026-06-10',
  pax: 100,
  evenement_id: 'e-' + id,
  taux_recyclage: 80,
  collecte_flux: [{ poids_reel_kg: 40 }],
});
const ERREUR = { code: 'XX000', message: 'boom' };

let rejets: unknown[] = [];
const surRejet = (e: unknown) => {
  rejets.push(e);
};
// Laisse passer les microtâches : un rejet non observé serait signalé ici.
const attendre = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  etat.logs = [];
  etat.adminFrom = [];
  etat.adminErreur = {};
  rejets = [];
  process.on('unhandledRejection', surRejet);
  // Module rechargé à chaque cas : le cache de la méthode CO₂ repart vide.
  vi.resetModules();
});
afterEach(() => {
  process.off('unhandledRejection', surRejet);
  vi.useRealTimers();
});

describe('M3.1 / tableau de bord traiteur — tarif de refacturation lu avec les collectes', () => {
  it('tarif en erreur : rejet 500 neutre, un seul log, aucun rejet non observé, factures non lues', async () => {
    const { loadKpiTraiteur } = await import('@/lib/dashboards/loaders.js');
    const sb = makeSupabase({
      tables: { collectes: [collecteZd('c1')] },
      rpcErreur: ERREUR,
    });
    await expect(
      loadKpiTraiteur(sb as never, CTX as never, {
        from: null,
        to: null,
        type: 'zero_dechet',
        compare: 'n1',
      }),
    ).rejects.toMatchObject({ status: 500, message: 'Erreur serveur' });
    await attendre();
    expect(etat.logs).toHaveLength(1);
    expect(rejets).toHaveLength(0);
    expect(sb.appels).not.toContain('factures_collectes');
  });

  it('tarif en erreur et filtre illisible (aucune collecte lue) : rejet, un seul log, aucun rejet non observé', async () => {
    const { loadKpiTraiteur } = await import('@/lib/dashboards/loaders.js');
    const sb = makeSupabase({ rpcErreur: ERREUR });
    await expect(
      loadKpiTraiteur(sb as never, CTX as never, {
        from: null,
        to: null,
        type: 'zero_dechet',
        filtres: {
          lieuIds: ['pas-un-uuid'],
          typeEvtIds: [],
          traiteurIds: [],
          clientNoms: [],
          tailleEvts: [],
        } as never,
      }),
    ).rejects.toMatchObject({ status: 500 });
    await attendre();
    expect(etat.logs).toHaveLength(1);
    expect(rejets).toHaveLength(0);
  });

  it('tarif en erreur via loadTraiteurDashboard : un seul log du KPI, aucun rejet non observé', async () => {
    const { loadTraiteurDashboard } =
      await import('@/lib/dashboards/loaders.js');
    const sb = makeSupabase({ rpcErreur: ERREUR });
    await expect(
      loadTraiteurDashboard(sb as never, CTX as never, {
        from: null,
        to: null,
        type: 'zero_dechet',
      }),
    ).rejects.toMatchObject({ status: 500 });
    await attendre();
    expect(rejets).toHaveLength(0);
    expect(
      etat.logs.filter(
        (l) =>
          (l as [string, { route: string }])[1]?.route ===
          'dashboards.kpi_traiteur',
      ),
    ).toHaveLength(1);
  });

  it('tarif lu : marge = tarif × pax − factures, une seule lecture du tarif', async () => {
    const { loadKpiTraiteur } = await import('@/lib/dashboards/loaders.js');
    const sb = makeSupabase({
      tables: {
        collectes: [collecteZd('c1')],
        factures_collectes: [{ collecte_id: 'c1', montant_ht: 300 }],
      },
      tarif: 12,
    });
    const res = await loadKpiTraiteur(sb as never, CTX as never, {
      from: null,
      to: null,
      type: 'zero_dechet',
    });
    expect((res.data[0] as { marge_zd_ht: number }).marge_zd_ht).toBe(900);
    expect(res.tarif_refacture_pax_zd).toBe(12);
    expect(
      sb.appels.filter((a) => a === 'rpc:f_tarif_refacture_pax_zd'),
    ).toHaveLength(1);
  });
});

describe('M3.1 / méthode CO₂ du tableau de bord en cache 5 min', () => {
  it('lecture réussie : 3 lectures, aucune avant 5 min, relue après 5 min', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    const { lireMethodeCo2 } = await import('@/lib/dashboards/loaders.js');
    const a = await lireMethodeCo2();
    expect(etat.adminFrom).toHaveLength(3);
    expect(a.forfait.km).toBe(77);
    expect(a.ag.facteur_par_repas).toBe(3.1);
    vi.setSystemTime(new Date('2026-11-18T10:04:59Z'));
    const b = await lireMethodeCo2();
    expect(etat.adminFrom).toHaveLength(3);
    expect(b).toEqual(a);
    vi.setSystemTime(new Date('2026-11-18T10:05:01Z'));
    await lireMethodeCo2();
    expect(etat.adminFrom).toHaveLength(6);
  });

  for (const t of [
    'parametres_co2_divers',
    'parametres_facteurs_co2',
    'parametres_facteurs_co2_ag',
  ]) {
    it(`erreur sur ${t} : rien en cache, relue à l'appel suivant`, async () => {
      const { lireMethodeCo2 } = await import('@/lib/dashboards/loaders.js');
      etat.adminErreur[t] = ERREUR;
      await lireMethodeCo2();
      expect(etat.adminFrom).toHaveLength(3);
      etat.adminErreur = {};
      const b = await lireMethodeCo2();
      expect(etat.adminFrom).toHaveLength(6);
      expect(b.forfait.km).toBe(77);
      expect(b.ag.facteur_par_repas).toBe(3.1);
      expect(b.flux).toHaveLength(1);
    });
  }
});
