/**
 * Régénération du rapport de recyclage depuis la fiche collecte client (RPT-04) —
 * routes des 3 espaces (traiteur, agence, gestionnaire), logique commune
 * `repondreRegenerationRapport` : tout utilisateur qui peut télécharger le rapport
 * peut le régénérer et en choisir la version, avec ou sans radar (§12 §1.2).
 * + « rapport RSE » d'une collecte AG = attestation standalone (BL-P2-18 (3), option a).
 *
 * Cloisonnement : cross-org → 403 (test P1 bloquant §12 §1.2). Mock keyé par table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(res()),
      single: () => Promise.resolve(res()),
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  return { from: (t: string) => chain(t), results };
}

let rls = makeClient();
let admin = makeClient();
const mockRequireUser = vi.fn();
const mockRegen = vi.fn();
const mockRadar = vi.fn();
const mockPresigned = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@/lib/pdf/regenerate.js', () => ({
  regenerateCollecteDocument: (...a: unknown[]) => mockRegen(...a),
}));
// Le radar est calculé sous l'identité du demandeur ; la lecture des filtres
// (lireFiltresRadar) reste la vraie.
vi.mock('@/lib/pdf/rapport-radar.js', async (orig) => ({
  ...(await orig<typeof import('@/lib/pdf/rapport-radar.js')>()),
  construireRadarRapport: (...a: unknown[]) => mockRadar(...a),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: (...a: unknown[]) => mockPresigned(...a),
}));

function postReq(corps?: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/x',
    corps === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: typeof corps === 'string' ? corps : JSON.stringify(corps),
        },
  );
}
function getReq(): NextRequest {
  return new NextRequest('http://localhost/x');
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'mgr-1', role: 'traiteur_manager', organisationId: 'org-1' },
  });
  mockRegen.mockResolvedValue({
    ok: true,
    jobId: 'job-9',
    type: 'rapport-recyclage-zd',
  });
  mockPresigned.mockResolvedValue('https://r2/att.pdf');
});

type Espace = 'traiteur' | 'agence' | 'gestionnaire';

async function regen(
  id = 'c1',
  type = 'rapport-recyclage-zd',
  corps?: unknown,
  espace: Espace = 'traiteur',
) {
  const { POST } =
    espace === 'traiteur'
      ? await import('@/app/api/v1/traiteur/collectes/[id]/documents/[type]/regenerate/route.js')
      : espace === 'agence'
        ? await import('@/app/api/v1/agence/collectes/[id]/documents/[type]/regenerate/route.js')
        : await import('@/app/api/v1/gestionnaire/collectes/[id]/documents/[type]/regenerate/route.js');
  return POST(postReq(corps), {
    params: Promise.resolve({ id, type }),
  });
}

/** Collecte ZD visible et rapport téléchargeable (généré, embargo levé). */
function rapportDisponible() {
  rls.results.collectes = {
    data: { id: 'c1', type: 'zero_dechet' },
    error: null,
  };
  rls.results.rapports_rse = {
    data: {
      id: 'r1',
      disponible_a: '2020-01-01T00:00:00Z',
      genere_at: '2020-01-01T06:00:00Z',
    },
    error: null,
  };
}

const RADAR = {
  benchmark_flux: [
    {
      flux_code: 'biodechet',
      flux_nom: 'Biodéchets',
      collecte_kg_pax: 0.21,
      benchmark_kg_pax: 0.24,
    },
  ],
  benchmark_legende: 'période 13/10/2024 → 13/10/2026 · lieux : tous',
  filtres_benchmark: {
    periode_debut: '2024-10-13',
    periode_fin: '2026-10-13',
    lieu_ids: null,
    type_evenement_ids: null,
    taille_evenement_codes: ['M'],
  },
};
const TYPE_ID = '11111111-1111-4111-8111-111111111111';

describe('M1.6 / régénération rapport traiteur (RPT-04)', () => {
  it('manager + collecte visible → 202 + délégué au pipeline commun', async () => {
    rapportDisponible();
    const res = await regen();
    expect(res.status).toBe(202);
    expect(mockRegen).toHaveBeenCalledTimes(1);
    // Sans corps : aucune version demandée, le dernier rendu est reproduit.
    expect(mockRegen.mock.calls[0]![4]).toBeUndefined();
    expect(mockRadar).not.toHaveBeenCalled();
  });

  it('cross-org (collecte existe mais hors périmètre RLS) → 403, aucune régénération', async () => {
    rls.results.collectes = { data: null, error: null }; // invisible
    admin.results.collectes = { data: { id: 'c1' }, error: null }; // existe
    const res = await regen();
    expect(res.status).toBe(403);
    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('collecte inexistante → 404', async () => {
    rls.results.collectes = { data: null, error: null };
    admin.results.collectes = { data: null, error: null };
    const res = await regen();
    expect(res.status).toBe(404);
    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('rôles : chaque espace n’ouvre la route qu’à ses rôles, refus de requireUser relayé tel quel', async () => {
    rapportDisponible();
    for (const [espace, roles] of [
      ['traiteur', ['traiteur_manager', 'traiteur_commercial']],
      ['agence', ['agence']],
      ['gestionnaire', ['gestionnaire_lieux']],
    ] as const) {
      mockRequireUser.mockClear();
      const res = await regen('c1', 'rapport-recyclage-zd', undefined, espace);
      expect(res.status).toBe(202);
      expect(mockRequireUser.mock.calls[0]![1]).toEqual(roles);
    }
    // Rôle hors liste : la réponse de la garde sort telle quelle, rien n'est lu.
    mockRegen.mockClear();
    mockRequireUser.mockResolvedValue({
      error: new Response(null, { status: 403 }),
    });
    const res = await regen('c1', 'rapport-recyclage-zd', undefined, 'agence');
    expect(res.status).toBe(403);
    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('regeneration_bordereau_et_attestation_interdites_traiteur : type bordereau/attestation → 403, rapport RSE → 202', async () => {
    rapportDisponible();
    // Bordereau ZD réservé Admin (§12 §1.1) — refusé avant tout appel pipeline.
    const bord = await regen('c1', 'bordereau-zd');
    expect(bord.status).toBe(403);
    // Attestation AG réservée Admin (§12 §1.3).
    const att = await regen('c1', 'attestation-don');
    expect(att.status).toBe(403);
    expect(mockRegen).not.toHaveBeenCalled();
    // Le rapport RSE §1.2 lui reste accessible.
    const rse = await regen('c1', 'rapport-recyclage-zd');
    expect(rse.status).toBe(202);
    expect(mockRegen).toHaveBeenCalledTimes(1);
  });

  it('collecte AG appelée avec le type du rapport ZD → 403 (pas de gabarit ZD sur un rapport AG)', async () => {
    rapportDisponible();
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi' },
      error: null,
    };
    const res = await regen();
    expect(res.status).toBe(403);
    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('droit = celui du téléchargement : rapport illisible sous la RLS du demandeur → 404, embargo → 425, pas encore généré → 409', async () => {
    rapportDisponible();
    rls.results.rapports_rse = { data: null, error: null }; // rr_select ne le sert pas
    expect((await regen()).status).toBe(404);

    rls.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: '2999-01-01T00:00:00Z',
        genere_at: '2020-01-01T06:00:00Z',
      },
      error: null,
    };
    const embargo = await regen();
    expect(embargo.status).toBe(425);
    expect(await embargo.json()).toMatchObject({
      disponible_a: '2999-01-01T00:00:00Z',
    });

    rls.results.rapports_rse = {
      data: { id: 'r1', disponible_a: '2020-01-01T00:00:00Z', genere_at: null },
      error: null,
    };
    expect((await regen()).status).toBe(409);
    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('lecture en échec (collecte ou rapport) → 500 générique, sans régénération ni détail Postgres', async () => {
    rapportDisponible();
    rls.results.rapports_rse = {
      data: null,
      error: { message: 'relation "rapports_rse" does not exist' },
    };
    const res = await regen();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });

    // Même règle quand c'est la collecte qui ne se lit pas : ni 403 ni 404
    // (une panne ne doit pas se lire « hors périmètre »).
    rapportDisponible();
    rls.results.collectes = {
      data: null,
      error: { message: 'permission denied for table collectes' },
    };
    const res2 = await regen();
    expect(res2.status).toBe(500);
    expect(await res2.json()).toEqual({ error: 'Erreur serveur' });
    expect(mockRegen).not.toHaveBeenCalled();
  });
});

describe('M1.6 / régénération du rapport — choix de la version (avec ou sans radar)', () => {
  beforeEach(() => {
    rapportDisponible();
    mockRadar.mockResolvedValue({ etat: 'ok', radar: RADAR });
  });

  it('radar décoché → version sans radar, le parc n’est pas lu', async () => {
    const res = await regen('c1', 'rapport-recyclage-zd', {
      options: { benchmark: false },
      benchmark_filters: { type_evenement_ids: [TYPE_ID] },
    });
    expect(res.status).toBe(202);
    expect(mockRadar).not.toHaveBeenCalled();
    expect(mockRegen.mock.calls[0]![4]).toEqual({ avecRadar: false });
  });

  it('radar coché → radar calculé sous l’identité du demandeur avec les filtres de la fiche, pour les 3 espaces', async () => {
    for (const [espace, role] of [
      ['traiteur', 'traiteur_commercial'],
      ['agence', 'agence'],
      ['gestionnaire', 'gestionnaire_lieux'],
    ] as const) {
      mockRadar.mockClear();
      mockRegen.mockClear();
      const ctx = { userId: 'u-1', role, organisationId: 'org-1' };
      mockRequireUser.mockResolvedValue({ ctx });
      const res = await regen(
        'c1',
        'rapport-recyclage-zd',
        {
          options: { benchmark: true },
          benchmark_filters: {
            type_evenement_ids: [TYPE_ID],
            taille_evenement_codes: ['M', 'L'],
            lieu_ids: [],
          },
        },
        espace,
      );
      expect(res.status).toBe(202);
      // Client RLS (jamais le client service-role), contexte du demandeur, filtres lus.
      const [client, ctxRecu, id, filtres] = mockRadar.mock.calls[0]!;
      expect(client).toBe(rls);
      expect(client).not.toBe(admin);
      expect(ctxRecu).toEqual(ctx);
      expect(id).toBe('c1');
      expect(filtres).toEqual({
        lieu_ids: [],
        type_evenement_ids: [TYPE_ID],
        taille_evenement_codes: ['M', 'L'],
      });
      // L'écriture, elle, passe par le client service-role, avec le radar calculé.
      expect(mockRegen.mock.calls[0]![0]).toBe(admin);
      expect(mockRegen.mock.calls[0]![3]).toEqual({ userId: 'u-1', role });
      expect(mockRegen.mock.calls[0]![4]).toEqual({
        avecRadar: true,
        radar: RADAR,
      });
    }
  });

  it('radar coché sans filtres → « Tous » (tableaux vides), comme l’écran', async () => {
    await regen('c1', 'rapport-recyclage-zd', { options: { benchmark: true } });
    expect(mockRadar.mock.calls[0]![3]).toEqual({
      lieu_ids: [],
      type_evenement_ids: [],
      taille_evenement_codes: [],
    });
  });

  it('corps mal formé → 400 ou 422, rien n’est régénéré', async () => {
    const cas: Array<[unknown, number]> = [
      ['{pas du json', 400],
      [[1, 2], 400],
      [{ options: { benchmark: 'oui' } }, 422],
      [{ options: null }, 422],
      [{ options: {} }, 422],
      // Valeur hors format : elle partirait telle quelle dans la fonction SQL.
      [
        {
          options: { benchmark: true },
          benchmark_filters: { type_evenement_ids: ['1 OR 1=1'] },
        },
        422,
      ],
      [
        {
          options: { benchmark: true },
          benchmark_filters: { taille_evenement_codes: ['XXL'] },
        },
        422,
      ],
      [
        {
          options: { benchmark: true },
          benchmark_filters: { lieu_ids: 'tous' },
        },
        422,
      ],
    ];
    for (const [corps, statut] of cas) {
      const res = await regen('c1', 'rapport-recyclage-zd', corps);
      expect([JSON.stringify(corps), res.status]).toEqual([
        JSON.stringify(corps),
        statut,
      ]);
    }
    expect(mockRadar).not.toHaveBeenCalled();
    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('corps sans « options » → reproduction du dernier rendu, filtres ignorés', async () => {
    const res = await regen('c1', 'rapport-recyclage-zd', {
      benchmark_filters: { type_evenement_ids: [TYPE_ID] },
    });
    expect(res.status).toBe(202);
    expect(mockRadar).not.toHaveBeenCalled();
    expect(mockRegen.mock.calls[0]![4]).toBeUndefined();
  });

  it('radar refusé par les gardes de l’écran → même refus, rien n’est régénéré', async () => {
    // Collecte d'un traiteur tiers vue par un gestionnaire : pas de radar pour elle.
    mockRadar.mockResolvedValueOnce({ etat: 'sans_radar' });
    const sansRadar = await regen('c1', 'rapport-recyclage-zd', {
      options: { benchmark: true },
    });
    expect(sansRadar.status).toBe(422);

    // Lieu hors périmètre nommé dans le filtre : libellé fixe, relayé tel quel.
    mockRadar.mockResolvedValueOnce({
      etat: 'filtre_interdit',
      motif: 'perimetre',
    });
    const interdit = await regen('c1', 'rapport-recyclage-zd', {
      options: { benchmark: true },
    });
    expect(interdit.status).toBe(403);
    expect(await interdit.json()).toEqual({
      error:
        'Filtre lieu_ids ou traiteur_ids hors du périmètre du gestionnaire (§06.05)',
    });

    mockRadar.mockResolvedValueOnce({ etat: 'introuvable' });
    expect(
      (
        await regen('c1', 'rapport-recyclage-zd', {
          options: { benchmark: true },
        })
      ).status,
    ).toBe(404);

    // Lecture du parc en échec : 500 générique, aucun détail Postgres.
    mockRadar.mockResolvedValueOnce({
      etat: 'erreur',
      erreur: { message: 'function f_benchmark_kg_pax_zd does not exist' },
    });
    const erreur = await regen('c1', 'rapport-recyclage-zd', {
      options: { benchmark: true },
    });
    expect(erreur.status).toBe(500);
    expect(await erreur.json()).toEqual({ error: 'Erreur serveur' });

    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('radar coché mais aucun flux rapporté aux convives → 422 dit en clair, pas de rapport rendu sans le radar demandé', async () => {
    mockRadar.mockResolvedValueOnce({
      etat: 'ok',
      radar: {
        ...RADAR,
        benchmark_flux: RADAR.benchmark_flux.map((g) => ({
          ...g,
          collecte_kg_pax: null,
        })),
      },
    });
    const res = await regen('c1', 'rapport-recyclage-zd', {
      options: { benchmark: true },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'La comparaison au parc n’est pas disponible pour cette collecte.',
    });
    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('échec du pipeline → statut selon le code (409 sans rendu antérieur, 500 sinon)', async () => {
    mockRegen.mockResolvedValueOnce({
      ok: false,
      code: 'NO_PRIOR_JOB',
      message: 'Aucun rendu antérieur à régénérer pour ce document',
    });
    expect((await regen()).status).toBe(409);
    mockRegen.mockResolvedValueOnce({
      ok: false,
      code: 'DB_ERROR',
      message: 'Erreur serveur',
    });
    expect((await regen()).status).toBe(500);
  });
});

describe('M2.4 / rapport RSE AG = attestation standalone (option a Val)', () => {
  async function download(id = 'c1') {
    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/rapport-rse/download/route.js');
    return GET(getReq(), { params: Promise.resolve({ id }) });
  }

  it('collecte AG → sert l’attestation (URL pré-signée depuis attestations_don)', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi' },
      error: null,
    };
    rls.results.attestations_don = {
      data: {
        id: 'a1',
        numero: 'ATT-DON-2026-00007',
        eligible_at: '2020-01-01T00:00:00Z',
        pdf_url: 'att-key.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(200);
    expect(mockPresigned).toHaveBeenCalledWith(
      'att-key.pdf',
      900,
      'rapport-de-don-ATT-DON-2026-00007.pdf',
    );
  });

  it('attestation AG sous embargo H+24 → 425', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi' },
      error: null,
    };
    rls.results.attestations_don = {
      data: {
        id: 'a1',
        eligible_at: '2999-01-01T00:00:00Z',
        pdf_url: 'att-key.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(425);
    expect(mockPresigned).not.toHaveBeenCalled();
  });
});
