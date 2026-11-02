/**
 * Onglet « Mon pack Anti-Gaspi » (Val 2026-11-02) — GET /api/v1/mon-pack-ag,
 * commune aux 5 rôles clients.
 *
 * La route lit par le CLIENT DE SERVICE (le commercial n'a pas de policy sur
 * packs_antgaspi, et lit pourtant le solde de son organisation, §06.04 Bloc 4
 * AG) : aucune RLS ne la borne. Ces tests tiennent que chaque lecture porte
 * ELLE-MÊME la borne de l'organisation du jeton. Le faux client ci-dessous
 * applique les filtres de la route à un jeu de lignes qui mêle plusieurs
 * organisations, sans aucune RLS.
 *
 * Historique de consommation (repris de l'ancienne route gestionnaire, §06.05
 * l.75, arbitrage Val 2026-10-07) : collectes réalisées ou clôturées rattachées
 * à un pack de l'organisation, plus les annulations tardives tracées débitées
 * (le journal d'audit seul atteste le débit). Constat d'origine (savr-dev,
 * 2026-10-06, Viparis) : 144 collectes de traiteurs tiers sur ses lieux,
 * débitées sur LEUR pack, remontaient dans l'historique du gestionnaire.
 *
 * Le faux client reproduit le comportement PostgREST mesuré sur savr-dev : un
 * filtre sur une ressource embarquée n'écarte la ligne parente que si l'embed
 * est `!inner` ; sinon il vide l'embed et garde la ligne.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Ligne = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

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

let service = makeClient({});
const mockRequireUser = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => service,
}));

const ORG = 'org-viparis';
const ORG_TIERS = 'org-kaspia';

function pack(
  id: string,
  organisation_id: string,
  statut: 'actif' | 'epuise' | 'annule',
  created_at: string,
  credits: { initiaux?: number; restants?: number } = {},
): Ligne {
  const initiaux = credits.initiaux ?? 10;
  const restants = credits.restants ?? (statut === 'epuise' ? 0 : initiaux);
  return {
    id,
    organisation_id,
    statut,
    type_pack: 'pack_10',
    credits_initiaux: initiaux,
    credits_consommes: initiaux - restants,
    credits_restants: restants,
    date_achat: created_at.slice(0, 10),
    date_expiration: null,
    created_at,
    // Colonnes financières : jamais rendues.
    prix_ht: 450,
    montant_total_ht: 450,
  };
}

const PACK_ORG = pack('pack-viparis', ORG, 'actif', '2026-05-01');
const PACK_TIERS = pack('pack-kaspia', ORG_TIERS, 'actif', '2026-05-02');
const lienPack = (p: Ligne) => ({
  id: p.id as string,
  organisation_id: p.organisation_id as string,
});

// Collecte AG telle que la base la joint à son pack.
function collecteAg(
  id: string,
  p: Ligne | null,
  statut = 'cloturee',
  date = '2026-06-01',
): Ligne {
  return {
    id,
    type: 'anti_gaspi',
    statut,
    date_collecte: date,
    packs_antgaspi: p ? lienPack(p) : null,
    evenements: {
      nom_evenement: `Gala ${id}`,
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
    pack_courant: Record<string, unknown> | null;
    packs: Array<Record<string, unknown>>;
    collectes: Array<{
      collecte_id: string;
      pack_id: string;
      date_collecte: string;
      annulee_tardivement: boolean;
      repas_donnes: number;
      associations: Array<{ nom: string | null; repas: number }>;
    }>;
  };
}

async function get() {
  const { GET } = await import('@/app/api/v1/mon-pack-ag/route.js');
  return GET(new NextRequest('http://localhost/api/v1/mon-pack-ag'));
}

async function appeler(): Promise<Reponse> {
  const res = await get();
  expect(res.status).toBe(200);
  return (await res.json()) as Reponse;
}

const ids = (r: Reponse) => r.data.collectes.map((l) => l.collecte_id);

function session(role: string, organisationId = ORG) {
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'user-1', role, organisationId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  service = makeClient({});
  session('gestionnaire_lieux');
});

describe('Mon pack Anti-Gaspi — accès', () => {
  it('M3.2/mon_pack_ag_roles — ouverte aux 5 rôles clients, jamais au staff', async () => {
    await appeler();
    expect(mockRequireUser.mock.calls[0]![1]).toEqual([
      'traiteur_manager',
      'traiteur_commercial',
      'agence',
      'gestionnaire_lieux',
      'client_organisateur',
    ]);
  });

  it('M3.2/mon_pack_ag_refus_relaye — un refus de requireUser part tel quel, sans aucune lecture', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireUser.mockResolvedValue({
      error: NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 }),
    });
    const res = await get();
    expect(res.status).toBe(403);
    expect(service.requetes).toEqual([]);
  });
});

describe('Mon pack Anti-Gaspi — packs bornés à l’organisation du jeton', () => {
  it('M3.2/mon_pack_ag_packs_org_seule — les packs d’une autre organisation ne sortent jamais', async () => {
    session('traiteur_commercial');
    service = makeClient({
      packs_antgaspi: [
        PACK_TIERS,
        pack('pack-ancien', ORG, 'epuise', '2025-01-01'),
        PACK_ORG,
      ],
    });

    const { data } = await appeler();

    expect(data.packs.map((p) => p.id)).toEqual([
      'pack-viparis',
      'pack-ancien',
    ]);
    expect(data.pack_courant).toMatchObject({ id: 'pack-viparis' });
    const lecture = service.requetes.find((r) => r.table === 'packs_antgaspi')!;
    expect(lecture.eq).toEqual([['organisation_id', ORG]]);
  });

  it('M3.2/pack_ag_actif_retourne_restants — colonnes réelles mappées, aucun champ financier', async () => {
    service = makeClient({
      packs_antgaspi: [
        pack('p1', ORG, 'actif', '2026-01-15T10:00:00Z', {
          initiaux: 20,
          restants: 12,
        }),
      ],
    });

    const { data } = await appeler();

    expect(data.packs[0]).toEqual({
      id: 'p1',
      type_pack: 'pack_10',
      statut: 'actif',
      credits_initiaux: 20,
      credits_consommes: 8,
      credits_restants: 12,
      date_achat: '2026-01-15',
      date_expiration: null,
    });
    const select = service.requetes.find(
      (r) => r.table === 'packs_antgaspi',
    )!.select;
    expect(select).not.toMatch(/prix|montant|devise/);
  });

  it('M3.2/mon_pack_ag_courant_epuise — sans pack actif, le dernier pack épuisé reste en tête (§11)', async () => {
    service = makeClient({
      packs_antgaspi: [
        pack('p-vieux', ORG, 'annule', '2025-01-01'),
        pack('p-epuise', ORG, 'epuise', '2026-03-01'),
      ],
    });

    const { data } = await appeler();

    expect(data.pack_courant).toMatchObject({
      id: 'p-epuise',
      credits_restants: 0,
    });
  });

  it('M3.2/mon_pack_ag_historique_packs — tous les packs de l’organisation (actif, épuisés, annulés), du plus récent au plus ancien ; un dernier pack annulé n’est pas un solde : rien en tête', async () => {
    service = makeClient({
      packs_antgaspi: [
        pack('p-epuise', ORG, 'epuise', '2026-01-01'),
        pack('p-annule', ORG, 'annule', '2026-03-01'),
      ],
    });

    const { data } = await appeler();

    expect(data.pack_courant).toBeNull();
    expect(data.packs.map((p) => p.statut)).toEqual(['annule', 'epuise']);
  });

  it('M3.2/pack_ag_aucun_actif_null — aucune lecture de collectes ni du journal quand l’organisation n’a pas de pack', async () => {
    session('client_organisateur', 'org-organisateur');
    service = makeClient({
      packs_antgaspi: [PACK_ORG, PACK_TIERS],
      collectes: [collecteAg('c-1', PACK_ORG)],
    });

    const { data } = await appeler();

    expect(data).toEqual({ pack_courant: null, packs: [], collectes: [] });
    expect(service.requetes.map((r) => r.table)).toEqual(['packs_antgaspi']);
  });

  it('M3.2/mon_pack_ag_erreur_packs_500 — une lecture des packs en échec ne se déguise pas en « aucun pack »', async () => {
    service = makeClient({}, { packs_antgaspi: { code: '42501' } });
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
  });
});

describe('Mon pack Anti-Gaspi — collectes bornées aux packs de l’organisation', () => {
  it('M3.2/pack_ag_consommation_pack_tiers_exclu — une collecte débitée sur le pack d’un tiers n’est pas listée', async () => {
    service = makeClient({
      packs_antgaspi: [PACK_ORG, PACK_TIERS],
      collectes: [
        collecteAg('c-tiers-1', PACK_TIERS),
        collecteAg('c-tiers-2', PACK_TIERS, 'realisee'),
        collecteAg('c-propre', PACK_ORG),
        // Sans débit de pack : jamais listée.
        collecteAg('c-sans-pack', null),
        // Pack réservé à l'attribution, collecte pas encore réalisée.
        collecteAg('c-propre-programmee', PACK_ORG, 'programmee'),
      ],
    });

    const reponse = await appeler();

    expect(ids(reponse)).toEqual(['c-propre']);
    expect(reponse.data.collectes[0]).toMatchObject({
      pack_id: 'pack-viparis',
      annulee_tardivement: false,
    });
    // La borne est écrite dans chaque lecture de collectes : jointure
    // obligatoire sur le pack, filtrée sur l'organisation du jeton.
    const lectures = service.requetes.filter((r) => r.table === 'collectes');
    expect(lectures).toHaveLength(2);
    for (const requete of lectures) {
      expect(requete.select).toMatch(/packs_antgaspi(!\w+)*!inner\(/);
      expect(requete.eq).toContainEqual([
        'packs_antgaspi.organisation_id',
        ORG,
      ]);
    }
    // Aucune annulation à examiner : le journal n'est pas lu.
    expect(service.requetes.some((r) => r.table === 'audit_log')).toBe(false);
  });

  it('M3.2/pack_ag_consommation_repas_objet — attribution en OBJET (to-one) : repas et association comptés', async () => {
    service = makeClient({
      packs_antgaspi: [PACK_ORG],
      collectes: [
        {
          ...collecteAg('c-ag', PACK_ORG),
          attributions_antgaspi: {
            volume_repas_realise: 55,
            associations: { nom: 'Les Restos' },
          },
        },
      ],
    });

    const { data } = await appeler();

    expect(data.collectes[0]).toMatchObject({
      repas_donnes: 55,
      associations: [{ nom: 'Les Restos', repas: 55 }],
    });
  });

  it('M3.2/pack_ag_consommation_erreur_500 — une lecture en échec ne se déguise pas en liste vide', async () => {
    service = makeClient(
      { packs_antgaspi: [PACK_ORG] },
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

describe('Mon pack Anti-Gaspi — annulations tardives débitées', () => {
  it('M3.2/pack_ag_consommation_annulation_tardive_listee — une annulation tracée débitée figure, signalée, à sa place dans l’ordre des dates', async () => {
    service = makeClient({
      packs_antgaspi: [PACK_ORG],
      collectes: [
        collecteAg('c-juin', PACK_ORG, 'cloturee', '2026-06-01'),
        {
          ...collecteAg('c-annulee', PACK_ORG, 'annulee', '2026-06-10'),
          // L'attribution est posée avec le pack et survit à l'annulation.
          attributions_antgaspi: {
            volume_repas_realise: null,
            associations: { nom: 'Les Restos' },
          },
        },
        {
          ...collecteAg('c-juillet', PACK_ORG, 'realisee', '2026-07-01'),
          attributions_antgaspi: {
            volume_repas_realise: 30,
            associations: { nom: 'Les Restos' },
          },
        },
      ],
      audit_log: [debitAnnulation('pack-viparis', 'c-annulee')],
    });

    const reponse = await appeler();

    expect(reponse.data.collectes).toMatchObject([
      {
        collecte_id: 'c-juillet',
        annulee_tardivement: false,
        repas_donnes: 30,
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
    // Le journal n'est lu que pour le pack et la collecte examinés.
    const audits = service.requetes.filter((r) => r.table === 'audit_log');
    expect(audits).toHaveLength(2);
    expect(audits[0]!.eq).toEqual([
      ['table_name', 'packs_antgaspi'],
      ['action', 'pack_debite_annulation_tardive'],
    ]);
    expect(audits[0]!.in).toEqual([['record_id', ['pack-viparis']]]);
    expect(audits[0]!.select).toBe('old_values');
    expect(audits[1]!.eq).toEqual([
      ['table_name', 'collectes'],
      ['action', 'pack_rattache_collecte'],
    ]);
    expect(audits[1]!.in).toEqual([['record_id', ['c-annulee']]]);
    expect(audits[1]!.select).toBe('record_id');
  });

  it('M3.2/pack_ag_consommation_annulee_rattachee_listee — une annulée tardive rattachée après coup par l’Admin figure dans la liste', async () => {
    service = makeClient({
      packs_antgaspi: [PACK_ORG],
      collectes: [
        collecteAg('c-rattachee', PACK_ORG, 'annulee', '2026-06-10'),
        // Annulée à temps : pack réservé, ni débit ni rattachement.
        collecteAg('c-a-temps', PACK_ORG, 'annulee', '2026-06-11'),
      ],
      audit_log: [
        {
          table_name: 'collectes',
          action: 'pack_rattache_collecte',
          record_id: 'c-rattachee',
          old_values: { pack_antgaspi_id: null },
        },
      ],
    });

    expect(ids(await appeler())).toEqual(['c-rattachee']);
  });

  it('M3.2/pack_ag_consommation_annulation_sans_debit_exclue — une annulation qui porte un pack sans trace de débit n’est pas listée', async () => {
    service = makeClient({
      packs_antgaspi: [PACK_ORG, PACK_TIERS],
      collectes: [
        collecteAg('c-propre', PACK_ORG),
        collecteAg('c-annulee-a-temps', PACK_ORG, 'annulee'),
        // Annulation tardive d'un tiers, débitée sur SON pack.
        collecteAg('c-annulee-tiers', PACK_TIERS, 'annulee'),
      ],
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
    service = makeClient(
      {
        packs_antgaspi: [PACK_ORG],
        collectes: [collecteAg('c-annulee', PACK_ORG, 'annulee')],
      },
      { audit_log: { code: '42501', message: 'denied' } },
    );
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
  });
});

describe('Mon pack Anti-Gaspi — plafond de 50 lignes', () => {
  it('M3.2/pack_ag_consommation_plafond_50 — la liste fusionnée garde les 50 collectes les plus récentes, annulation tardive comprise', async () => {
    const jour = (n: number) => `2026-03-${String(n).padStart(2, '0')}`;
    service = makeClient({
      packs_antgaspi: [PACK_ORG],
      collectes: [
        ...Array.from({ length: 55 }, (_, i) =>
          collecteAg(`c-${i}`, PACK_ORG, 'cloturee', jour((i % 28) + 1)),
        ),
        collecteAg('c-annulee', PACK_ORG, 'annulee', '2026-04-15'),
      ],
      audit_log: [debitAnnulation('pack-viparis', 'c-annulee')],
    });

    const reponse = await appeler();

    expect(reponse.data.collectes).toHaveLength(50);
    expect(ids(reponse)[0]).toBe('c-annulee');
    const dates = reponse.data.collectes.map((l) => l.date_collecte);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('M3.2/pack_ag_consommation_annulee_ancienne_non_coupee — une annulation débitée plus ancienne que 50 annulations à temps reste listée', async () => {
    service = makeClient({
      packs_antgaspi: [PACK_ORG],
      collectes: [
        ...Array.from({ length: 55 }, (_, i) =>
          collecteAg(
            `c-a-temps-${i}`,
            PACK_ORG,
            'annulee',
            `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
          ),
        ),
        collecteAg('c-tardive', PACK_ORG, 'annulee', '2026-01-10'),
      ],
      audit_log: [debitAnnulation('pack-viparis', 'c-tardive')],
    });

    expect(ids(await appeler())).toEqual(['c-tardive']);
  });
});
