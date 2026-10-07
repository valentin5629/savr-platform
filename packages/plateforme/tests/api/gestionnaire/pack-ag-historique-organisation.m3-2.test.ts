/**
 * M3.2 — « Mon pack AG » : l'historique de consommation ne liste que des
 * collectes rattachées à un pack de l'organisation de l'appelant — réalisées ou
 * clôturées, et annulations tardives tracées débitées (§06.05 l.75, arbitrage
 * Val 2026-10-07).
 *
 * Constat d'origine (savr-dev, 2026-10-06, Viparis) : l'organisation n'a aucun
 * pack, 144 collectes répondaient pourtant à la requête (l'écran en affichait
 * les 50 plus récentes) — celles des traiteurs tiers sur ses lieux, débitées
 * sur LEUR pack. Le gestionnaire lit ces collectes (`f_collecte_visible`) ; la
 * requête ne regardait pas à qui appartient le pack.
 *
 * Deux cas de débit (§05 « Débit d'un crédit ») : la collecte réalisée, et
 * l'annulation tardive. Pour la seconde, porter un pack ne prouve rien — le pack
 * est rattaché dès la validation de l'attribution — seule la ligne du journal
 * d'audit atteste le débit.
 *
 * Ce que ces tests tiennent : les faux clients ci-dessous APPLIQUENT les filtres
 * de la route à un jeu de lignes, sans aucune RLS — les bornes doivent donc
 * venir de la route elle-même. Ils reproduisent le comportement PostgREST mesuré
 * sur savr-dev : un filtre sur une ressource embarquée n'écarte la ligne parente
 * que si l'embed est `!inner` ; sinon il vide l'embed et garde la ligne.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Ligne = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

const ORG_GESTIONNAIRE = 'org-viparis';
const ORG_TRAITEUR = 'org-kaspia';

// Faux client : chaque table rend ses lignes passées par les filtres de la
// requête, ou l'erreur posée pour elle.
function makeClient(
  tables: Record<string, Ligne[]>,
  erreurs: Record<string, unknown> = {},
) {
  const requetes: {
    table: string;
    select: string;
    eq: [string, unknown][];
    in: [string, unknown[]][];
  }[] = [];
  return {
    requetes,
    from(table: string) {
      let select = '';
      const filtres: ((l: Ligne) => boolean)[] = [];
      const embedFiltres: { embed: string; col: string; val: unknown }[] = [];
      const eqs: [string, unknown][] = [];
      const ins: [string, unknown[]][] = [];
      let tri: { col: string; asc: boolean } | null = null;
      let plafond: number | null = null;

      const resoudre = (): Result => {
        requetes.push({ table, select, eq: eqs, in: ins });
        if (erreurs[table]) return { data: null, error: erreurs[table] };
        let lignes = (tables[table] ?? [])
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
        lignes = lignes.filter((l) => inners.every((e) => l[e] != null));
        // 3. Tri puis plafond, comme la requête les demande.
        const t = tri;
        if (t)
          lignes.sort(
            (a, b) =>
              String(a[t.col]).localeCompare(String(b[t.col])) *
              (t.asc ? 1 : -1),
          );
        return {
          data: plafond === null ? lignes : lignes.slice(0, plafond),
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
          ins.push([col, vals]);
          filtres.push((l) => vals.includes(l[col]));
          return chain;
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          tri = { col, asc: opts?.ascending !== false };
          return chain;
        },
        limit: (n: number) => {
          plafond = n;
          return chain;
        },
        maybeSingle: () => {
          const r = resoudre();
          return Promise.resolve({
            data: (r.data as Ligne[] | null)?.[0] ?? null,
            error: r.error,
          });
        },
        then: (resolve: (v: Result) => unknown) => resolve(resoudre()),
      };
      return chain;
    },
  };
}

// `client` = la session de l'appelant ; `service` = le client de service, qui
// ne doit lire que le journal d'audit.
let client = makeClient({});
let service = makeClient({});
const mockRequireUser = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => client,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => service,
}));

const PACK_GESTIONNAIRE = {
  id: 'pack-viparis',
  organisation_id: ORG_GESTIONNAIRE,
};
const PACK_TRAITEUR = { id: 'pack-kaspia', organisation_id: ORG_TRAITEUR };

// Collecte AG telle que la base la joint à son pack (aucune RLS dans le faux
// client : le pack d'un tiers y est présent, ce que la route ne doit pas rendre).
function collecteAg(
  id: string,
  pack: { id: string; organisation_id: string } | null,
  statut = 'cloturee',
  date = '2026-06-01',
): Ligne {
  return {
    id,
    type: 'anti_gaspi',
    statut,
    date_collecte: date,
    packs_antgaspi: pack,
    evenements: {
      nom_evenement: `Gala ${id}`,
      date_evenement: date,
      lieux: { nom: 'Palais des Congrès' },
    },
  };
}

// Ligne d'audit écrite par trg_pack_debit_annulation_tardive.
function debitAnnulation(packId: string, collecteId: string): Ligne {
  return {
    table_name: 'packs_antgaspi',
    action: 'pack_debite_annulation_tardive',
    record_id: packId,
    old_values: { collecte_id: collecteId },
  };
}

interface Reponse {
  data: {
    pack_actif: unknown;
    historique_consommation: Array<{
      collecte_id: string;
      date_collecte: string;
      annulee_tardivement: boolean;
      repas_donnes: number;
      associations: Array<{ nom: string | null; repas: number }>;
    }>;
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

const ids = (r: Reponse) =>
  r.data.historique_consommation.map((l) => l.collecte_id);

beforeEach(() => {
  vi.clearAllMocks();
  service = makeClient({});
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
    client = makeClient({
      collectes: [
        collecteAg('c-tiers-1', PACK_TRAITEUR),
        collecteAg('c-tiers-2', PACK_TRAITEUR, 'realisee'),
      ],
    });

    const { data } = await appeler();

    expect(data.pack_actif).toBeNull();
    expect(data.historique_consommation).toEqual([]);
    // La borne est écrite dans chaque lecture de collectes : jointure
    // obligatoire sur le pack, filtrée sur l'organisation du jeton.
    const lectures = client.requetes.filter((r) => r.table === 'collectes');
    expect(lectures.length).toBeGreaterThan(0);
    for (const requete of lectures) {
      expect(requete.select).toMatch(/packs_antgaspi(!\w+)*!inner\(/);
      expect(requete.eq).toContainEqual([
        'packs_antgaspi.organisation_id',
        ORG_GESTIONNAIRE,
      ]);
    }
  });

  it('M3.2/pack_ag_consommation_pack_organisation_presente — une collecte débitée sur le pack de l’organisation reste listée, seule', async () => {
    client = makeClient({
      collectes: [
        collecteAg('c-tiers', PACK_TRAITEUR),
        collecteAg('c-propre', PACK_GESTIONNAIRE),
        // Sans débit de pack : jamais dans l'historique de consommation.
        collecteAg('c-sans-pack', null),
        // Pack réservé à l'attribution, collecte pas encore réalisée.
        collecteAg('c-propre-programmee', PACK_GESTIONNAIRE, 'programmee'),
      ],
    });

    const reponse = await appeler();

    expect(ids(reponse)).toEqual(['c-propre']);
    expect(reponse.data.historique_consommation[0]!.annulee_tardivement).toBe(
      false,
    );
    // Aucune annulation à examiner : le client de service n'est pas sollicité.
    expect(service.requetes).toEqual([]);
  });

  it('M3.2/pack_ag_consommation_erreur_500 — une lecture en échec ne se déguise pas en historique vide', async () => {
    // Depuis la borne, « aucune ligne » est l'état normal d'une organisation
    // sans pack : une requête refusée par PostgREST doit rester visible.
    client = makeClient(
      {},
      {
        collectes: {
          code: 'PGRST200',
          message: 'Could not find a relationship',
        },
      },
    );

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
  });
});

describe('M3.2 / Mon pack AG — annulations tardives débitées', () => {
  it('M3.2/pack_ag_consommation_annulation_tardive_listee — une annulation tracée débitée figure dans la liste, signalée, à sa place dans l’ordre des dates', async () => {
    client = makeClient({
      collectes: [
        collecteAg('c-juin', PACK_GESTIONNAIRE, 'cloturee', '2026-06-01'),
        {
          ...collecteAg(
            'c-annulee',
            PACK_GESTIONNAIRE,
            'annulee',
            '2026-06-10',
          ),
          // L'attribution est posée avec le pack et survit à l'annulation.
          attributions_antgaspi: {
            volume_repas_realise: null,
            association_nom: 'Les Restos',
          },
        },
        {
          ...collecteAg(
            'c-juillet',
            PACK_GESTIONNAIRE,
            'realisee',
            '2026-07-01',
          ),
          attributions_antgaspi: {
            volume_repas_realise: 30,
            association_nom: 'Les Restos',
          },
        },
      ],
    });
    service = makeClient({
      audit_log: [debitAnnulation('pack-viparis', 'c-annulee')],
    });

    const reponse = await appeler();

    expect(reponse.data.historique_consommation).toMatchObject([
      {
        collecte_id: 'c-juillet',
        annulee_tardivement: false,
        repas_donnes: 30,
        associations: [{ nom: 'Les Restos', repas: 30 }],
      },
      // Rien n'a été donné : ni repas ni association, malgré l'attribution.
      {
        collecte_id: 'c-annulee',
        annulee_tardivement: true,
        repas_donnes: 0,
        associations: [],
      },
      { collecte_id: 'c-juin', annulee_tardivement: false },
    ]);
    // Le client de service ne lit que le journal d'audit, et seulement les
    // débits sur annulation tardive du pack de la collecte examinée.
    expect(service.requetes.map((r) => r.table)).toEqual(['audit_log']);
    expect(service.requetes[0]!.eq).toEqual([
      ['table_name', 'packs_antgaspi'],
      ['action', 'pack_debite_annulation_tardive'],
    ]);
    expect(service.requetes[0]!.in).toEqual([['record_id', ['pack-viparis']]]);
    expect(service.requetes[0]!.select).toBe('old_values');
  });

  it('M3.2/pack_ag_consommation_annulation_sans_debit_exclue — une annulation qui porte un pack sans trace de débit n’est pas listée', async () => {
    client = makeClient({
      collectes: [
        collecteAg('c-propre', PACK_GESTIONNAIRE),
        // Annulée à temps : le pack réservé reste rattaché, aucun crédit débité.
        collecteAg('c-annulee-a-temps', PACK_GESTIONNAIRE, 'annulee'),
        // Annulation tardive d'un traiteur tiers, débitée sur SON pack.
        collecteAg('c-annulee-tiers', PACK_TRAITEUR, 'annulee'),
      ],
    });
    service = makeClient({
      audit_log: [
        debitAnnulation('pack-kaspia', 'c-annulee-tiers'),
        // Autre action d'audit sur le pack de l'organisation : ne vaut pas débit.
        {
          ...debitAnnulation('pack-viparis', 'c-annulee-a-temps'),
          action: 'pack_recredite_annulation_collecte',
        },
      ],
    });

    expect(ids(await appeler())).toEqual(['c-propre']);
  });

  it('M3.2/pack_ag_consommation_erreur_audit_500 — un journal d’audit illisible rend une erreur, pas une liste amputée', async () => {
    client = makeClient({
      collectes: [collecteAg('c-annulee', PACK_GESTIONNAIRE, 'annulee')],
    });
    service = makeClient(
      {},
      { audit_log: { code: '42501', message: 'denied' } },
    );

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
  });
});

describe('M3.2 / Mon pack AG — plafond de 50 lignes', () => {
  it('M3.2/pack_ag_consommation_plafond_50 — la liste fusionnée garde les 50 collectes les plus récentes, annulation tardive comprise', async () => {
    const jour = (n: number) => `2026-03-${String(n).padStart(2, '0')}`;
    client = makeClient({
      collectes: [
        // 55 clôturées réparties du 1er au 28 mars (jours repris).
        ...Array.from({ length: 55 }, (_, i) =>
          collecteAg(
            `c-${i}`,
            PACK_GESTIONNAIRE,
            'cloturee',
            jour((i % 28) + 1),
          ),
        ),
        collecteAg('c-annulee', PACK_GESTIONNAIRE, 'annulee', '2026-04-15'),
      ],
    });
    service = makeClient({
      audit_log: [debitAnnulation('pack-viparis', 'c-annulee')],
    });

    const reponse = await appeler();

    expect(reponse.data.historique_consommation).toHaveLength(50);
    expect(ids(reponse)[0]).toBe('c-annulee');
    const dates = reponse.data.historique_consommation.map(
      (l) => l.date_collecte,
    );
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe('M3.2 / Mon pack AG — annulations lues sans plafond', () => {
  it('M3.2/pack_ag_consommation_annulee_ancienne_non_coupee — une annulation débitée plus ancienne que 50 annulations à temps reste listée', async () => {
    client = makeClient({
      collectes: [
        // 55 annulations à temps, récentes : pack réservé, aucun débit.
        ...Array.from({ length: 55 }, (_, i) =>
          collecteAg(
            `c-a-temps-${i}`,
            PACK_GESTIONNAIRE,
            'annulee',
            `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
          ),
        ),
        // L'annulation tardive, débitée, est la plus ancienne.
        collecteAg('c-tardive', PACK_GESTIONNAIRE, 'annulee', '2026-01-10'),
      ],
    });
    service = makeClient({
      audit_log: [debitAnnulation('pack-viparis', 'c-tardive')],
    });

    expect(ids(await appeler())).toEqual(['c-tardive']);
  });
});

describe('M3.2 / Mon pack AG — pas d’historique des packs', () => {
  it('M3.2/pack_ag_sans_historique_packs — la route ne rend que le pack actif, une seule lecture de packs', async () => {
    client = makeClient({
      packs_antgaspi: [
        { id: 'pack-viparis', statut: 'actif', type_pack: 'pack_10' },
        { id: 'pack-ancien', statut: 'epuise', type_pack: 'pack_10' },
      ],
    });

    const { data } = await appeler();

    expect(data.pack_actif).toMatchObject({ id: 'pack-viparis' });
    expect(data).not.toHaveProperty('historique_packs');
    expect(
      client.requetes.filter((r) => r.table === 'packs_antgaspi'),
    ).toHaveLength(1);
  });
});
