/**
 * M3.2 — « Mon pack AG » : l'historique de consommation ne liste que les
 * collectes débitées sur un pack de l'organisation de l'appelant (§06.05 l.75).
 *
 * Constat d'origine (savr-dev, 2026-10-06, Viparis) : l'organisation n'a aucun
 * pack, 144 collectes répondaient pourtant à la requête (l'écran en affichait
 * les 50 plus récentes) — celles des traiteurs tiers sur ses lieux, débitées
 * sur LEUR pack. Le gestionnaire lit ces collectes
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

// Faux client : `collectes` passe par les filtres (ou rend `erreurCollectes`),
// les autres tables ne rendent rien — les deux lectures de packs ne sont pas
// l'objet ici.
function makeClient(collectes: Ligne[], erreurCollectes: unknown = null) {
  const requetes: { select: string; eq: [string, unknown][] }[] = [];
  return {
    requetes,
    from(table: string) {
      let select = '';
      const filtres: ((l: Ligne) => boolean)[] = [];
      const embedFiltres: { embed: string; col: string; val: unknown }[] = [];
      const eqs: [string, unknown][] = [];

      const resoudre = (): Result => {
        if (table !== 'collectes') return { data: null, error: null };
        requetes.push({ select, eq: eqs });
        if (erreurCollectes) return { data: null, error: erreurCollectes };
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
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(resoudre()),
        then: (resolve: (v: Result) => unknown) => resolve(resoudre()),
      };
      return chain;
    },
  };
}

let client = makeClient([]);
const mockRequireUser = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => client,
}));

// Collecte AG telle que la base la joint à son pack (aucune RLS dans le faux
// client : le pack d'un tiers y est présent, ce que la route ne doit pas rendre).
function collecteAg(
  id: string,
  pack: { id: string; organisation_id: string } | null,
  statut = 'cloturee',
): Ligne {
  return {
    id,
    type: 'anti_gaspi',
    statut,
    date_collecte: '2026-06-01',
    packs_antgaspi: pack,
    evenements: {
      nom_evenement: `Gala ${id}`,
      date_evenement: '2026-06-01',
      lieux: { nom: 'Palais des Congrès' },
    },
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
    historique_consommation: Array<{ collecte_id: string }>;
  };
}

async function get() {
  const { GET } = await import('@/app/api/v1/gestionnaire/pack-ag/route.js');
  return GET(new NextRequest('http://localhost/api/v1/gestionnaire/pack-ag'));
}

async function appeler(): Promise<Reponse> {
  const res = await get();
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
    client = makeClient([
      collecteAg('c-tiers-1', PACK_TRAITEUR),
      collecteAg('c-tiers-2', PACK_TRAITEUR, 'realisee'),
    ]);

    const { data } = await appeler();

    expect(data.pack_actif).toBeNull();
    expect(data.historique_consommation).toEqual([]);
    // La borne est écrite dans la requête : jointure obligatoire sur le pack,
    // filtrée sur l'organisation lue dans le jeton de l'appelant.
    const requete = client.requetes[0]!;
    expect(requete.select).toMatch(/packs_antgaspi(!\w+)*!inner\(/);
    expect(requete.eq).toContainEqual([
      'packs_antgaspi.organisation_id',
      ORG_GESTIONNAIRE,
    ]);
  });

  it('M3.2/pack_ag_consommation_pack_organisation_presente — une collecte débitée sur le pack de l’organisation reste listée, seule', async () => {
    client = makeClient([
      collecteAg('c-tiers', PACK_TRAITEUR),
      collecteAg('c-propre', PACK_GESTIONNAIRE),
      // Sans débit de pack : jamais dans l'historique de consommation.
      collecteAg('c-sans-pack', null),
      // Rattachée au pack de l'organisation mais pas encore réalisée.
      collecteAg('c-propre-programmee', PACK_GESTIONNAIRE, 'programmee'),
    ]);

    const { data } = await appeler();

    expect(data.historique_consommation.map((l) => l.collecte_id)).toEqual([
      'c-propre',
    ]);
  });

  it('M3.2/pack_ag_consommation_erreur_500 — une lecture en échec ne se déguise pas en historique vide', async () => {
    // Depuis la borne, « aucune ligne » est l'état normal d'une organisation
    // sans pack : une requête refusée par PostgREST doit rester visible.
    client = makeClient([], {
      code: 'PGRST200',
      message: 'Could not find a relationship',
    });

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
  });
});
