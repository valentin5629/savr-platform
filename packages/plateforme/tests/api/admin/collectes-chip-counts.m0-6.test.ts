/**
 * M0.6 — API GET /admin/collectes/chip-counts : tuiles « AG / ZD à dispatcher ».
 * Scénario P1-critique `kpi_a_dispatcher_predicat_unique`
 * (specs/cdc/…/tests/06.06-back-office-admin-scenarios.md).
 * ref_cdc : 01 - Cahier des charges App/11 - Dashboards.md §1.1, définition
 * canonique de « à dispatcher » (Val 2026-09-14) : statut_tms = 'non_envoye' ET
 * tms_reference IS NULL ET statut IN ('programmee','validee').
 *
 * Oracle : le client Supabase factice n'avale aucun filtre. Il ÉVALUE chaque
 * `.eq/.is/.in/.not/.gte/.lte` de la route sur un jeu de lignes et rend le
 * compte réel. Un prédicat faux (ex. `statut = 'programmee'` seul, ou
 * `tms_reference` oublié) donne un autre nombre et l'assertion rougit. Une
 * colonne absente du jeu lève une erreur au lieu de valoir `undefined`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { applyChipPredicate, type ChipQuery } from '@/lib/collectes-chips';
import {
  aDispatcherZd,
  type CollecteRow,
} from '@/components/admin/collectes-table';

type Ligne = Record<string, unknown> & { id: string };

function ligne(id: string, over: Record<string, unknown>): Ligne {
  return {
    id,
    type: 'zero_dechet',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    tms_reference: null,
    dirty_tms: false,
    date_collecte: '2026-10-20',
    controle_acces_requis: false,
    infos_acces_email_envoye_at: null,
    informations_completes: true,
    // Relation embarquée (anti-jointure du chip « AG en attente attribution »).
    attributions_antgaspi: null,
    ...over,
  };
}

// Les deux collectes du scénario, puis les leurres qui distinguent la
// définition canonique de ses voisines.
const LIGNES: Ligne[] = [
  ligne('zd-programmee', {}),
  ligne('zd-validee', { statut: 'validee' }),
  // Déjà transmise : référence posée, statut_tms avancé.
  ligne('zd-transmise', {
    statut: 'validee',
    statut_tms: 'acceptee',
    tms_reference: 'CO-1',
  }),
  // Référence de commande présente alors que statut_tms est resté non_envoye.
  ligne('zd-avec-reference', { tms_reference: 'CO-2' }),
  // Programmées sans référence mais plus « non envoyées » : comptées par
  // l'ancien prédicat (`programmee` + référence nulle), pas par le canonique.
  // Deux leurres, pour que l'ancien prédicat ne retombe pas sur le bon total.
  ligne('zd-attente-prestataire', {
    statut_tms: 'attribuee_en_attente_acceptation',
  }),
  ligne('zd-a-attribuer', { statut_tms: 'a_attribuer' }),
  // Non transmises mais plus ouvertes.
  ligne('zd-brouillon', { statut: 'brouillon' }),
  ligne('zd-en-cours', { statut: 'en_cours' }),
  ligne('zd-annulation-demandee', { statut: 'annulation_demandee' }),
  ligne('zd-annulee', { statut: 'annulee' }),
  ligne('ag-validee', { type: 'anti_gaspi', statut: 'validee' }),
  // Mêmes leurres côté AG, une clause à la fois.
  ligne('ag-avec-reference', { type: 'anti_gaspi', tms_reference: 'M-8' }),
  ligne('ag-attente-prestataire', {
    type: 'anti_gaspi',
    statut_tms: 'attribuee_en_attente_acceptation',
  }),
  ligne('ag-en-cours', { type: 'anti_gaspi', statut: 'en_cours' }),
  ligne('ag-transmise', {
    type: 'anti_gaspi',
    statut_tms: 'acceptee',
    tms_reference: 'M-9',
  }),
];

function valeur(l: Ligne, colonne: string): unknown {
  if (!(colonne in l)) {
    throw new Error(`colonne absente du jeu de test : ${colonne}`);
  }
  return l[colonne];
}

// `.not(col, 'in', '("a","b")')` : liste au format PostgREST.
function listePostgrest(brut: unknown): string[] {
  return String(brut)
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((v) => v.replace(/^"|"$/g, ''));
}

interface RequeteFactice extends ChipQuery {
  select(): RequeteFactice;
  retenues(): Ligne[];
  then(
    ok: (v: { count: number; error: null }) => unknown,
    ko?: (e: unknown) => unknown,
  ): Promise<unknown>;
}

function requeteFactice(): RequeteFactice {
  const filtres: ((l: Ligne) => boolean)[] = [];
  const ajoute = (f: (l: Ligne) => boolean) => {
    filtres.push(f);
    return requete;
  };
  const retenues = () => LIGNES.filter((l) => filtres.every((f) => f(l)));
  const requete: RequeteFactice = {
    select: () => requete,
    eq: (c, v) => ajoute((l) => valeur(l, c) === v),
    is: (c, v) => ajoute((l) => valeur(l, c) === v),
    in: (c, vs) => ajoute((l) => vs.includes(valeur(l, c))),
    not: (c, op, v) => {
      if (op === 'is') return ajoute((l) => valeur(l, c) !== v);
      if (op === 'in') {
        const exclus = listePostgrest(v);
        return ajoute((l) => !exclus.includes(String(valeur(l, c))));
      }
      throw new Error(`opérateur non géré par le client factice : ${op}`);
    },
    gte: (c, v) => ajoute((l) => String(valeur(l, c)) >= String(v)),
    lte: (c, v) => ajoute((l) => String(valeur(l, c)) <= String(v)),
    retenues,
    then: (ok, ko) =>
      Promise.resolve({ count: retenues().length, error: null }).then(ok, ko),
  };
  return requete;
}

const tablesLues: string[] = [];

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      tablesLues.push(table);
      return requeteFactice();
    },
  }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

async function appelle(): Promise<Response> {
  const { GET } =
    await import('@/app/api/v1/admin/collectes/chip-counts/route.js');
  return GET(
    new NextRequest('http://localhost/api/v1/admin/collectes/chip-counts'),
  );
}

async function compteurs(): Promise<Record<string, number>> {
  const res = await appelle();
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, number>;
}

// Lignes que le chip retient réellement (même client factice que la route).
function idsDuChip(chip: string): string[] {
  const q = requeteFactice();
  applyChipPredicate(q, chip, new Date());
  return q.retenues().map((l) => l.id);
}

describe('M0.6 — API GET collectes/chip-counts : tuiles « à dispatcher » (kpi_a_dispatcher_predicat_unique)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tablesLues.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T10:00:00.000Z'));
    setupAuth('admin_savr');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('M0.6 — kpi_a_dispatcher_predicat_unique : la tuile « ZD à dispatcher » compte la programmée ET la validée non transmises', async () => {
    const c = await compteurs();
    // Les DEUX collectes du scénario, et elles seules : ni la transmise, ni
    // celle qui porte une référence, ni celle déjà chez le prestataire, ni les
    // statuts fermés (en cours, annulée).
    expect(c.zd_a_dispatcher).toBe(2);
    expect(idsDuChip('non_transmises_zd')).toEqual([
      'zd-programmee',
      'zd-validee',
    ]);
  });

  it('M0.6 — kpi_a_dispatcher_predicat_unique : tuile et chip « Non transmises » rendent le même nombre, par type', async () => {
    const c = await compteurs();
    expect(c.zd_a_dispatcher).toBe(c.non_transmises_zd);
    expect(c.ag_a_dispatcher).toBe(c.non_transmises_ag);
    // Scission par type : l'AG validée non transmise est comptée côté AG seul.
    expect(c.ag_a_dispatcher).toBe(1);
    expect(idsDuChip('non_transmises_ag')).toEqual(['ag-validee']);
  });

  it('M0.6 — kpi_a_dispatcher_predicat_unique : la tuile ZD n’est jamais inférieure au nombre de lignes offrant « Dispatcher »', async () => {
    const c = await compteurs();
    // `aDispatcherZd` = prédicat réel de l'action « Dispatcher » de la liste.
    const offrantDispatcher = LIGNES.filter((l) =>
      aDispatcherZd(l as unknown as CollecteRow),
    ).map((l) => l.id);
    expect(offrantDispatcher).toEqual(['zd-programmee', 'zd-validee']);
    expect(c.zd_a_dispatcher).toBeGreaterThanOrEqual(offrantDispatcher.length);
    // Prédicat unique : l'action et le chip désignent les mêmes collectes.
    expect(offrantDispatcher).toEqual(idsDuChip('non_transmises_zd'));
  });

  it('M0.6 — chip-counts : 403 pour un rôle client, aucune lecture en base', async () => {
    setupAuth('traiteur_manager');
    const res = await appelle();
    expect(res.status).toBe(403);
    expect(tablesLues).toHaveLength(0);
  });
});
