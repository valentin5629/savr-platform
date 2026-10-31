/**
 * Barre de filtres globale (revue E2E du 2026-10-30) : chaque bloc du dashboard
 * traiteur / agence applique Lieux et Client organisateur — évolution et donut
 * (loadEvolution), Top listes (loadBlocs), route consolidée traiteur
 * (loadTraiteurDashboard : cartes + évolution + blocs).
 */
import { describe, it, expect } from 'vitest';
import {
  loadEvolution,
  loadBlocs,
  loadTraiteurDashboard,
  type DbClient,
  type LoaderCtx,
} from './loaders.js';
import { FILTRES_GLOBAUX_VIDES } from './kpi-collectes.js';

type Appel = [string, string, unknown];

/** Faux client : chaque table rend une liste vide, chaque filtre est noté. */
function fauxClient() {
  const appels: Appel[] = [];
  let table = '';
  const q: Record<string, unknown> = {};
  for (const m of [
    'select',
    'eq',
    'in',
    'gte',
    'lte',
    'gt',
    'not',
    'or',
    'order',
    'limit',
  ])
    q[m] = (col: unknown, val: unknown) => {
      appels.push([`${table}.${m}`, String(col), val]);
      return q;
    };
  q.maybeSingle = () => Promise.resolve({ data: null, error: null });
  q.then = (ok: (r: unknown) => unknown) => ok({ data: [], error: null });
  const client = {
    from: (t: string) => {
      table = t;
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as DbClient;
  return { client, appels };
}

const LIEU = '22222222-2222-4222-8222-222222222222';
const TRAITEUR: LoaderCtx = {
  userId: 'u1',
  role: 'traiteur_manager',
  organisationId: 'org-1',
};
const AGENCE: LoaderCtx = { ...TRAITEUR, role: 'agence' };

const compte = (appels: Appel[], col: string, val: unknown) =>
  appels.filter(
    ([m, c, v]) =>
      m === 'collectes.in' &&
      c === col &&
      JSON.stringify(v) === JSON.stringify(val),
  ).length;

describe('filtres de la barre appliqués à chaque bloc', () => {
  it.each([
    ['traiteur', TRAITEUR],
    ['agence', AGENCE],
  ])(
    'loadEvolution (%s) : périmètre de son organisation, Lieux et Client organisateur',
    async (_nom, ctx) => {
      const { client, appels } = fauxClient();
      await loadEvolution(client, ctx, {
        type: 'zero_dechet',
        from: '2026-01-01',
        to: '2026-12-31',
        lieuIds: [LIEU],
        clientNoms: ['Dior'],
      });
      expect(appels).toContainEqual([
        'collectes.eq',
        'evenements.organisation_id',
        'org-1',
      ]);
      expect(compte(appels, 'evenements.lieu_id', [LIEU])).toBe(1);
      expect(
        compte(appels, 'evenements.nom_client_organisateur', ['Dior']),
      ).toBe(1);
    },
  );

  it.each([
    ['traiteur', TRAITEUR],
    ['agence', AGENCE],
  ])(
    'loadBlocs (%s) : Top listes filtrées par Lieux et Client organisateur',
    async (_nom, ctx) => {
      const { client, appels } = fauxClient();
      await loadBlocs(client, ctx, {
        type: 'anti_gaspi',
        from: '2026-01-01',
        to: '2026-12-31',
        lieuIds: [LIEU],
        clientNoms: ['Dior'],
      });
      expect(compte(appels, 'evenements.lieu_id', [LIEU])).toBe(1);
      expect(
        compte(appels, 'evenements.nom_client_organisateur', ['Dior']),
      ).toBe(1);
    },
  );

  it('loadTraiteurDashboard : cartes, évolution et Top listes reçoivent tous les filtres', async () => {
    const { client, appels } = fauxClient();
    await loadTraiteurDashboard(client, TRAITEUR, {
      from: '2026-01-01',
      to: '2026-12-31',
      type: 'zero_dechet',
      filtres: {
        ...FILTRES_GLOBAUX_VIDES,
        lieuIds: [LIEU],
        clientNoms: ['Dior'],
      },
    });
    // Une lecture de collectes par bloc : cartes, évolution, Top listes.
    expect(compte(appels, 'evenements.lieu_id', [LIEU])).toBe(3);
    expect(compte(appels, 'evenements.nom_client_organisateur', ['Dior'])).toBe(
      3,
    );
  });
});
