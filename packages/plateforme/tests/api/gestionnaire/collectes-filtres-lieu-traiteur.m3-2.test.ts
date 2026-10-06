/**
 * M3.2 — Liste Collectes gestionnaire : filtres Lieu et Traiteur à choix
 * multiple (Design System §5.5 règle 7, décision Val 2026-09-30).
 *
 * La route lisait `lieu_id` et `traiteur_id` comme une valeur chacun
 * (`.eq(...)`), ce qui imposait à l'écran deux sélecteurs à valeur unique. Elle
 * lit désormais `lieu_ids` / `traiteur_ids` en CSV (convention `lib/filtre-csv`
 * des listes traiteur et agence) ; les anciens noms restent compris.
 *
 * Ces sondes mesurent la REQUÊTE envoyée à PostgREST. Le cloisonnement, lui,
 * n'est pas porté par ces filtres : la requête part avec la session de
 * l'utilisateur et la RLS `col_select` borne la lecture à son parc. Un filtre
 * `.in()` s'ajoute à cette borne, il ne la remplace pas — d'où la sonde
 * `…_lue_par_la_session_seule`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown; count?: number | null };

function makeChain(result: Result) {
  const calls: Record<string, unknown[][]> = {};
  const chain: Record<string, unknown> = { __calls: calls };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'gte',
    'lte',
    'or',
    'order',
    'range',
  ]) {
    chain[m] = (...args: unknown[]) => {
      (calls[m] ??= []).push(args);
      return chain;
    };
  }
  chain.then = (resolve: (r: Result) => unknown) => resolve(result);
  return chain as Record<string, unknown> & {
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain({ data: [], error: null, count: 0 });
const mockRequireUser = vi.fn();
const fabriqueSession = vi.fn(() => rls);

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => fabriqueSession(),
}));

import { GET } from '@/app/api/v1/gestionnaire/collectes/route.js';

const API = 'http://localhost/api/v1/gestionnaire/collectes';
const LIEU_A = '11111111-1111-4111-8111-111111111111';
const LIEU_B = '22222222-2222-4222-8222-222222222222';
const TRAITEUR_A = '33333333-3333-4333-8333-333333333333';
const TRAITEUR_B = '44444444-4444-4444-8444-444444444444';
const COL_LIEU = 'evenements.lieu_id';
const COL_TRAITEUR = 'evenements.traiteur_operationnel_organisation_id';

const appel = (qs: string) => GET(new NextRequest(`${API}${qs}`));
/** Valeurs passées à `.in()` pour une colonne (une entrée par appel). */
const listes = (colonne: string) =>
  (rls.__calls.in ?? []).filter((a) => a[0] === colonne).map((a) => a[1]);
const colonnesEq = () => (rls.__calls.eq ?? []).map((a) => a[0]);

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain({ data: [], error: null, count: 0 });
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'g1', role: 'gestionnaire_lieux', organisationId: 'org-1' },
  });
});

describe('M3.2 / liste Collectes gestionnaire — Lieu et Traiteur à choix multiple (route)', () => {
  it('M3.2/collectes_route_plusieurs_lieux — lieu_ids en CSV → un seul .in() sur evenements.lieu_id', async () => {
    const res = await appel(`?lieu_ids=${LIEU_A},${LIEU_B}`);
    expect(res.status).toBe(200);
    expect(listes(COL_LIEU)).toEqual([[LIEU_A, LIEU_B]]);
    // Plus aucun `.eq()` sur la colonne : il n'en garderait qu'un.
    expect(colonnesEq()).not.toContain(COL_LIEU);
  });

  it('M3.2/collectes_route_plusieurs_traiteurs — traiteur_ids en CSV → un seul .in() sur le traiteur opérationnel', async () => {
    await appel(`?traiteur_ids=${TRAITEUR_A},${TRAITEUR_B}`);
    expect(listes(COL_TRAITEUR)).toEqual([[TRAITEUR_A, TRAITEUR_B]]);
    expect(colonnesEq()).not.toContain(COL_TRAITEUR);
    // Aucun filtre de lieu n'a été inventé au passage.
    expect(listes(COL_LIEU)).toEqual([]);
  });

  it('M3.2/collectes_route_lieux_et_traiteurs_se_cumulent — les deux listes coexistent avec la période', async () => {
    await appel(
      `?lieu_ids=${LIEU_A},${LIEU_B}&traiteur_ids=${TRAITEUR_A}&from=2026-01-01&to=2026-06-30`,
    );
    expect(listes(COL_LIEU)).toEqual([[LIEU_A, LIEU_B]]);
    expect(listes(COL_TRAITEUR)).toEqual([[TRAITEUR_A]]);
    expect(rls.__calls.gte).toContainEqual(['date_collecte', '2026-01-01']);
    expect(rls.__calls.lte).toContainEqual(['date_collecte', '2026-06-30']);
  });

  it('M3.2/collectes_route_ancien_lien_valeur_unique — lieu_id / traiteur_id restent lus, comme une liste d’un élément', async () => {
    // Liens d'avant ce lot (favoris, anciens onglets) : même filtre qu'avant.
    await appel(`?lieu_id=${LIEU_A}&traiteur_id=${TRAITEUR_A}`);
    expect(listes(COL_LIEU)).toEqual([[LIEU_A]]);
    expect(listes(COL_TRAITEUR)).toEqual([[TRAITEUR_A]]);
  });

  it('M3.2/collectes_route_pluriel_prioritaire_sur_ancien — lieu_ids l’emporte sur lieu_id', async () => {
    await appel(`?lieu_ids=${LIEU_A}&lieu_id=${LIEU_B}`);
    expect(listes(COL_LIEU)).toEqual([[LIEU_A]]);
  });

  it('M3.2/collectes_route_identifiant_mal_forme_ecarte — seuls les UUID atteignent PostgREST', async () => {
    // Un identifiant mal formé ne désigne aucune ligne : l'écarter ne change pas
    // le résultat, et lui évite d'atteindre la chaîne du filtre (PostgREST
    // répondrait 400, que l'écran afficherait comme une panne).
    await appel(
      `?lieu_ids=${LIEU_A},pas-un-uuid,&traiteur_ids=x),statut.eq.cloturee,${TRAITEUR_A}`,
    );
    expect(listes(COL_LIEU)).toEqual([[LIEU_A]]);
    expect(listes(COL_TRAITEUR)).toEqual([[TRAITEUR_A]]);
  });

  it.each([
    ['lieu_ids', 'pas-un-uuid'],
    ['lieu_id', 'L1'],
    ['traiteur_ids', 'x,y'],
    ['traiteur_id', 'T1'],
  ])(
    'M3.2/collectes_route_aucun_identifiant_valide_liste_vide — %s=%s ne rend pas le parc entier',
    async (param, valeur) => {
      const res = await appel(`?${param}=${valeur}`);
      const corps = (await res.json()) as { data: unknown[]; total: number };
      expect(res.status).toBe(200);
      expect(corps).toMatchObject({ data: [], total: 0 });
      // Aucune requête n'est partie. Écarter le filtre en silence aurait rendu
      // toutes les collectes du parc sous un filtre que l'écran annonce.
      expect(rls.__calls.from).toBeUndefined();
    },
  );

  it('M3.2/collectes_route_un_filtre_valide_ne_sauve_pas_l_autre — lieu lisible + traiteur illisible → liste vide', async () => {
    const res = await appel(`?lieu_ids=${LIEU_A}&traiteur_ids=zzz`);
    const corps = (await res.json()) as { data: unknown[]; total: number };
    expect(corps).toMatchObject({ data: [], total: 0 });
    expect(rls.__calls.from).toBeUndefined();
  });

  it('M3.2/collectes_route_sans_filtre_lieu_ni_traiteur — paramètre absent ou vide = aucun filtre', async () => {
    await appel('?lieu_ids=&traiteur_ids=');
    expect(rls.__calls.from).toEqual([['collectes']]);
    expect(listes(COL_LIEU)).toEqual([]);
    expect(listes(COL_TRAITEUR)).toEqual([]);
  });

  it('M3.2/collectes_route_lue_par_la_session_seule — le filtre s’ajoute à la RLS, il ne la remplace pas', async () => {
    // Un lieu qui n'est pas celui du gestionnaire est un UUID comme un autre :
    // la route ne le reconnaît pas, c'est la RLS qui ne rend aucune ligne pour
    // lui. Ce qui doit tenir ici : UNE requête, sur `collectes`, par le client
    // de session (jamais un client de service qui lirait hors RLS), et le
    // filtre posé sur cette même requête.
    await appel(`?lieu_ids=${LIEU_A},${LIEU_B}`);
    expect(fabriqueSession).toHaveBeenCalledTimes(1);
    expect(rls.__calls.from).toEqual([['collectes']]);
    expect(listes(COL_LIEU)).toHaveLength(1);
  });

  it('M3.2/collectes_route_recompte_porte_les_listes — page au-delà de la dernière : mêmes lieux, mêmes traiteurs', async () => {
    // Le recompte du cas dégradé (PGRST103) rejoue la requête : un recompte
    // sans ces listes annoncerait le total du parc entier.
    const suite: Result[] = [
      { data: null, error: { code: 'PGRST103' }, count: null },
      { data: [], error: null, count: 7 },
    ];
    rls.then = (resolve: (r: Result) => unknown) => resolve(suite.shift()!);
    const res = await appel(
      `?page=9&lieu_ids=${LIEU_A},${LIEU_B}&traiteur_ids=${TRAITEUR_A}`,
    );
    const corps = (await res.json()) as { total: number };
    expect(corps.total).toBe(7);
    expect(listes(COL_LIEU)).toEqual([
      [LIEU_A, LIEU_B],
      [LIEU_A, LIEU_B],
    ]);
    expect(listes(COL_TRAITEUR)).toEqual([[TRAITEUR_A], [TRAITEUR_A]]);
  });
});
