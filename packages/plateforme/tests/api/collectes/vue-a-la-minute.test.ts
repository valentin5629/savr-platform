/**
 * Vues « Collectes à venir / passées » tranchées à la minute (décision Val
 * 2026-11-03) : chaque route de liste Collectes, et le module de filtres Admin
 * partagé par sa liste et son export, pose le filtre de créneau quand la page
 * envoie `vue`, et n'en pose aucun sans elle (pastille d'action « à venir » de
 * l'Admin, appel sans vue).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  appliquerFiltresCollectesAdmin,
  lireFiltresCollectesAdmin,
} from '@/lib/collectes-admin.js';

type Appel = { methode: string; args: unknown[] };

/** Requête PostgREST simulée : enregistre chaque appel, rend une liste vide. */
function requeteEnregistree(appels: Appel[]): unknown {
  const resultat = { data: [], error: null, count: 0 };
  const proxy: unknown = new Proxy(
    {},
    {
      get(_cible, cle) {
        if (cle === 'then')
          return (resoudre: (v: typeof resultat) => unknown) =>
            resoudre(resultat);
        return (...args: unknown[]) => {
          appels.push({ methode: String(cle), args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

let appels: Appel[] = [];
const client = { from: () => requeteEnregistree(appels) };

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: async () => ({
    ctx: {
      userId: 'u-1',
      role: 'traiteur_manager',
      organisationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }),
  createSupabaseServerClient: () => client,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => client,
}));

// 2026-11-03 15:16:30 à Paris (heure d'hiver, UTC+1).
const MAINTENANT = new Date('2026-11-03T14:16:30Z');
const A_VENIR =
  'date_collecte.gt.2026-11-03,and(date_collecte.eq.2026-11-03,heure_collecte.gte.15:16)';
const PASSEES =
  'date_collecte.lt.2026-11-03,and(date_collecte.eq.2026-11-03,heure_collecte.lt.15:16)';

const filtresOr = () =>
  appels.filter((a) => a.methode === 'or').map((a) => String(a.args[0]));

const ROUTES = [
  ['traiteur', () => import('@/app/api/v1/traiteur/collectes/route.js')],
  ['agence', () => import('@/app/api/v1/agence/collectes/route.js')],
  [
    'organisateur',
    () => import('@/app/api/v1/organisateur/collectes/route.js'),
  ],
  [
    'gestionnaire',
    () => import('@/app/api/v1/gestionnaire/collectes/route.js'),
  ],
] as const;

beforeEach(() => {
  appels = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MAINTENANT);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('vues Collectes à la minute — routes des listes', () => {
  for (const [espace, charger] of ROUTES) {
    it(`vue_a_la_minute/route_${espace} — « passées » et « à venir » tranchent aujourd'hui à la minute ; sans vue, aucun filtre de créneau`, async () => {
      const { GET } = await charger();
      const url = (qs: string) =>
        new NextRequest(`http://localhost/api/v1/${espace}/collectes?${qs}`);

      await GET(url('vue=passees&to=2026-11-03'));
      expect(filtresOr()).toContain(PASSEES);

      appels = [];
      await GET(url('vue=a_venir&from=2026-11-03'));
      expect(filtresOr()).toContain(A_VENIR);

      appels = [];
      await GET(url('from=2026-11-03'));
      expect(filtresOr().some((f) => f.includes('heure_collecte'))).toBe(false);
    });
  }
});

describe('vues Collectes à la minute — filtres Admin (liste et export)', () => {
  it("vue_a_la_minute/admin — `vue` lue et appliquée sur l'horloge passée ; absente (pastille d'action) = aucun filtre de créneau", () => {
    const appliquer = (qs: string) => {
      appels = [];
      appliquerFiltresCollectesAdmin(
        requeteEnregistree(appels),
        lireFiltresCollectesAdmin(new URLSearchParams(qs)),
        MAINTENANT,
      );
      return filtresOr();
    };
    expect(appliquer('vue=passees&to=2026-11-03')).toContain(PASSEES);
    expect(appliquer('vue=a_venir&from=2026-11-03')).toContain(A_VENIR);
    // Anciens liens : `historique` vaut « passées ».
    expect(appliquer('vue=historique')).toContain(PASSEES);
    expect(
      appliquer('chip=info_incomplete').some((f) =>
        f.includes('heure_collecte'),
      ),
    ).toBe(false);
  });
});

describe('vues Collectes à la minute — export CSV des espaces clients', () => {
  it("vue_a_la_minute/export_client — l'export d'une liste cliente pose le même filtre de créneau que sa liste", async () => {
    const { buildCollectesExport } = await import('@/lib/exports/builders.js');
    const ctx = {
      supabase: client,
      role: 'traiteur_manager',
      isStaff: false,
    } as unknown as Parameters<typeof buildCollectesExport>[0];
    await buildCollectesExport(
      ctx,
      new URLSearchParams('vue=passees&to=2026-11-03'),
    ).catch(() => undefined);
    expect(filtresOr()).toContain(PASSEES);

    appels = [];
    await buildCollectesExport(
      ctx,
      new URLSearchParams('from=2026-11-03'),
    ).catch(() => undefined);
    expect(filtresOr().some((f) => f.includes('heure_collecte'))).toBe(false);
  });
});
