/**
 * M3.2 — « Mon pack AG » : l'historique de consommation ne liste que les
 * collectes débitées sur un pack de l'organisation de l'appelant (§06.05 l.75).
 *
 * Constat d'origine (savr-dev, 2026-10-06, Viparis) : l'organisation n'a aucun
 * pack, la route rendait pourtant 144 collectes — celles des traiteurs tiers
 * sur ses lieux, débitées sur LEUR pack. Le gestionnaire lit ces collectes
 * (`f_collecte_visible`) ; la requête ne regardait pas à qui appartient le pack.
 *
 * Ce que ces tests tiennent : le faux client ci-dessous APPLIQUE les filtres de
 * la route à un jeu de collectes, sans aucune RLS — la borne doit donc venir de
 * la requête elle-même. Il reproduit le comportement PostgREST mesuré sur
 * savr-dev : un filtre sur une ressource embarquée n'écarte la ligne parente
 * que si l'embed est `!inner` ; sinon il vide l'embed et garde la ligne.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Ligne = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

const ORG_GESTIONNAIRE = 'org-viparis';
const ORG_TRAITEUR = 'org-kaspia';

// Faux client : `collectes` passe par les filtres, les autres tables rendent
// `autres[table]` tel quel (les deux lectures de packs ne sont pas l'objet ici).
function makeClient(collectes: Ligne[], autres: Record<string, Result> = {}) {
  const requetes: { select: string; eq: [string, unknown][] }[] = [];
  return {
    requetes,
    from(table: string) {
      let select = '';
      const filtres: ((l: Ligne) => boolean)[] = [];
      const embedFiltres: { embed: string; col: string; val: unknown }[] = [];
      const eqs: [string, unknown][] = [];

      const resoudre = (): Result => {
        if (table !== 'collectes')
          return autres[table] ?? { data: null, error: null };
        requetes.push({ select, eq: eqs });
        const lignes = collectes
          .filter((l) => filtres.every((f) => f(l)))
          .map((l) => ({ ...l }));
        // 1. Un filtre sur une ressource embarquée vide l'embed qui ne
        //    correspond pas — il ne touche pas à la ligne parente.
        for (const l of lignes)
          for (const { embed, col, val } of embedFiltres) {
            const e = l[embed] as Ligne | null | undefined;
            if (!e || e[col] !== val) l[embed] = null;
          }
        // 2. `!inner` : la ligne parente tombe si son embed est vide.
        const inners = [...select.matchAll(/(\w+)(?:!\w+)*!inner\(/g)].map(
          (m) => m[1]!,
        );
        return {
          data: lignes.filter((l) => inners.every((e) => l[e] != null)),
          error: null,
        };
      };

      const chain: Record<string, unknown> = {
        select: (s: unknown) => {
          select = String(s);
          return chain;
        },
        eq: (col: string, val: unknown) => {
          eqs.push([col, val]);
          const [embed, sousCol] = col.split('.');
          if (sousCol) embedFiltres.push({ embed: embed!, col: sousCol, val });
          else filtres.push((l) => l[col] === val);
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          filtres.push((l) => vals.includes(l[col]));
          return chain;
        },
        not: (col: string, op: string, val: unknown) => {
          if (op === 'is' && val === null) filtres.push((l) => l[col] != null);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(resoudre()),
        then: (resolve: (v: Result) => unknown) => resolve(resoudre()),
      };
      return chain;
    },
  };
}

let rls = makeClient([]);
const mockRequireUser = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));

// Collecte AG telle que la base la joint à son pack (aucune RLS dans le faux
// client : le pack d'un tiers y est présent, ce que la route ne doit pas rendre).
function collecteAg(
  id: string,
  pack: { id: string; organisation_id: string } | null,
  repas: number,
  extra: Ligne = {},
): Ligne {
  return {
    id,
    type: 'anti_gaspi',
    statut: 'cloturee',
    date_collecte: '2026-06-01',
    pack_antgaspi_id: pack?.id ?? null,
    packs_antgaspi: pack,
    evenements: {
      nom_evenement: `Gala ${id}`,
      date_evenement: '2026-06-01',
      lieux: { nom: 'Palais des Congrès' },
    },
    attributions_antgaspi: {
      volume_repas_realise: repas,
      association_nom: 'Les Restos',
    },
    ...extra,
  };
}

const PACK_GESTIONNAIRE = {
  id: 'pack-viparis',
  organisation_id: ORG_GESTIONNAIRE,
};
const PACK_TRAITEUR = { id: 'pack-kaspia', organisation_id: ORG_TRAITEUR };

interface Reponse {
  data: {
    pack_actif: unknown;
    historique_consommation: Array<{
      collecte_id: string;
      evenement: string | null;
      lieu: string | null;
      repas_donnes: number;
      associations: Array<{ nom: string | null; repas: number }>;
    }>;
  };
}

async function appeler(): Promise<Reponse> {
  const { GET } = await import('@/app/api/v1/gestionnaire/pack-ag/route.js');
  const res = await GET(
    new NextRequest('http://localhost/api/v1/gestionnaire/pack-ag'),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Reponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({
    ctx: {
      userId: 'user-g',
      role: 'gestionnaire_lieux',
      organisationId: ORG_GESTIONNAIRE,
    },
  });
});

describe('M3.2 / Mon pack AG — historique borné aux packs de l’organisation', () => {
  it('M3.2/pack_ag_consommation_pack_tiers_exclu — une collecte débitée sur le pack d’un traiteur tiers n’est pas listée', async () => {
    // Cas mesuré : l'organisation n'a aucun pack, ses lieux accueillent des
    // collectes de traiteurs débitées sur le pack du traiteur.
    rls = makeClient([
      collecteAg('c-tiers-1', PACK_TRAITEUR, 80),
      collecteAg('c-tiers-2', PACK_TRAITEUR, 40, { statut: 'realisee' }),
    ]);

    const { data } = await appeler();

    expect(data.pack_actif).toBeNull();
    expect(data.historique_consommation).toEqual([]);
    // La borne est écrite dans la requête : jointure obligatoire sur le pack,
    // filtrée sur l'organisation lue dans le jeton de l'appelant.
    const requete = rls.requetes[0]!;
    expect(requete.select).toContain(
      'packs_antgaspi!pack_antgaspi_id!inner(id)',
    );
    expect(requete.eq).toContainEqual([
      'packs_antgaspi.organisation_id',
      ORG_GESTIONNAIRE,
    ]);
  });

  it('M3.2/pack_ag_consommation_pack_organisation_presente — une collecte débitée sur le pack de l’organisation reste listée, seule', async () => {
    rls = makeClient([
      collecteAg('c-tiers', PACK_TRAITEUR, 80),
      collecteAg('c-propre', PACK_GESTIONNAIRE, 55),
      // Sans débit de pack : jamais dans l'historique de consommation.
      collecteAg('c-sans-pack', null, 12),
      // Débitée sur le pack de l'organisation mais pas encore réalisée.
      collecteAg('c-propre-programmee', PACK_GESTIONNAIRE, 0, {
        statut: 'programmee',
      }),
    ]);

    const { data } = await appeler();

    expect(data.historique_consommation.map((l) => l.collecte_id)).toEqual([
      'c-propre',
    ]);
    expect(data.historique_consommation[0]).toMatchObject({
      evenement: 'Gala c-propre',
      lieu: 'Palais des Congrès',
      repas_donnes: 55,
      associations: [{ nom: 'Les Restos', repas: 55 }],
    });
  });
});
