/**
 * M1.5a — envoi immédiat au clic (décision Val 2026-10-12).
 *
 * Trois choses sont prouvées ici :
 *   1. les deux clics d'envoi de l'Admin (« Envoyer », « Valider » une attribution
 *      AG) programment l'envoi des ordres de LEUR collecte, après la réponse, et
 *      seulement quand la mutation a réussi ;
 *   2. la tâche programmée lance le passage ciblé du worker, et n'échappe jamais
 *      une exception (la requête a déjà répondu) ;
 *   3. cliquet de durée : toute route qui déclenche l'envoi immédiat, comme la
 *      route du passage planifié, déclare `maxDuration` ≤ 60 s — la moitié du
 *      bail de réservation des ordres, lu dans la migration. Sur Vercel, c'est
 *      ce qui garde un passage vivant hors de portée du reaper.
 *
 * `after()` est remplacée dans vitest.setup.ts par un espion qui n'exécute pas la
 * tâche : on la récupère dans ses appels et on la lance à la main.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { NextRequest, after } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

const mockPassageCible = vi.fn();
vi.mock('@savr/adapters/src/outbox-worker.js', () => ({
  runOutboxWorkerPourCollecte: (...args: unknown[]) =>
    mockPassageCible(...args),
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

function setupAuth(role: string, userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function makeReq(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** Les tâches programmées par `after()` depuis le dernier `clearAllMocks`. */
function tachesProgrammees(): Array<() => Promise<void>> {
  return vi
    .mocked(after)
    .mock.calls.map((appel) => appel[0] as () => Promise<void>);
}

const collecteZd = (over: Record<string, unknown> = {}) => ({
  data: {
    id: 'col-1',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    tms_reference: null,
    type: 'zero_dechet',
    date_collecte: '2027-01-20',
    dirty_tms: false,
    prestataire_logistique_id: 'prest-strike',
    ...over,
  },
  error: null,
});

async function envoyer(body: Record<string, unknown> = {}) {
  const { POST } =
    await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
  return POST(makeReq('/api/v1/admin/collectes/col-1/dispatch', body), {
    params: Promise.resolve({ id: 'col-1' }),
  });
}

async function validerAttribution() {
  const { POST } =
    await import('@/app/api/v1/admin/attributions-ag/[collecteId]/valider/route.js');
  return POST(
    makeReq('/api/v1/admin/attributions-ag/coll-ag/valider', {
      association_id: 'asso-1',
      transporteur_id: 'transp-1',
      branche_attribution: 'ag_marathon_nuit',
      mode_validation: 'manuel_top1',
    }),
    { params: Promise.resolve({ collecteId: 'coll-ag' }) },
  );
}

describe('M1.5a / envoi immédiat — clic « Envoyer » de la fiche collecte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('ops_savr');
  });

  it("M1.5a/envoi_immediat_clic_envoyer — ordre mis en file : l'envoi de CETTE collecte est programmé après la réponse, une seule fois", async () => {
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd());
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    });
    mockPassageCible.mockResolvedValue({
      reaped: 0,
      claimed: 1,
      done: 1,
      failed: 0,
      dead: 0,
    });

    const res = await envoyer();

    expect(res.status).toBe(200);
    // Rien n'est parti pendant la requête : le clic n'attend pas le prestataire.
    expect(mockPassageCible).not.toHaveBeenCalled();
    const taches = tachesProgrammees();
    expect(taches).toHaveLength(1);

    await taches[0]!();
    expect(mockPassageCible).toHaveBeenCalledTimes(1);
    expect(mockPassageCible).toHaveBeenCalledWith(mockSupabaseChain, 'col-1');
  });

  it("M1.5a/envoi_immediat_refus_sans_envoi — mise en file refusée par la base : rien n'est programmé", async () => {
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd());
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'refus' },
    });

    const res = await envoyer();

    expect(res.status).toBe(500);
    expect(tachesProgrammees()).toHaveLength(0);
  });

  it("collecte terminée (409) ou sans prestataire (422) : rien n'est programmé", async () => {
    mockSupabaseChain.single.mockResolvedValueOnce(
      collecteZd({ statut: 'cloturee' }),
    );
    expect((await envoyer()).status).toBe(409);

    mockSupabaseChain.single.mockResolvedValueOnce(
      collecteZd({ prestataire_logistique_id: null }),
    );
    expect((await envoyer()).status).toBe(422);

    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
    expect(tachesProgrammees()).toHaveLength(0);
  });

  it("M1.5a/envoi_immediat_echec_silencieux — le passage ciblé échoue : la tâche n'échappe aucune exception, l'ordre reste en file pour le passage planifié", async () => {
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd());
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    });
    mockPassageCible.mockRejectedValue(
      new Error('fn_claim_outbox_collecte : function does not exist'),
    );
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect((await envoyer()).status).toBe(200);
    await expect(tachesProgrammees()[0]!()).resolves.toBeUndefined();

    const lignes = journal.mock.calls.map((c) => String(c[0]));
    journal.mockRestore();
    const echec = lignes.find((l) => l.includes('outbox.envoi_immediat.echec'));
    expect(echec).toBeDefined();
    expect(echec).toContain('col-1');
    expect(echec).toContain('function does not exist');
  });
});

describe('M1.5a / envoi immédiat — appelant refusé par la garde de rôle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('M1.5a/envoi_immediat_refus_de_role — non connecté (401) ou rôle client (403) : aucune mutation, aucune tâche programmée, sur les deux routes', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    expect((await envoyer()).status).toBe(401);
    expect((await validerAttribution()).status).toBe(401);

    setupAuth('traiteur_manager');
    expect((await envoyer()).status).toBe(403);
    expect((await validerAttribution()).status).toBe(403);

    // « Valider » une attribution est réservé à l'admin : l'ops est refusé aussi.
    setupAuth('ops_savr');
    expect((await validerAttribution()).status).toBe(403);

    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
    expect(tachesProgrammees()).toHaveLength(0);
  });
});

describe('M1.5a / envoi immédiat — tâche impossible à programmer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('admin_savr');
  });
  // Un refus non consommé (test interrompu) ne doit pas atteindre le cas suivant.
  afterEach(() => {
    vi.mocked(after).mockReset();
  });

  it('M1.5a/envoi_immediat_non_programme — after() lève : les deux routes répondent quand même leur succès, et le disent au journal', async () => {
    const refus = () => {
      throw new Error('`after` was called outside a request scope');
    };
    vi.mocked(after)
      .mockImplementationOnce(refus)
      .mockImplementationOnce(refus);
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd());
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    });
    const envoi = await envoyer();

    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        attribution_id: 'attr-1',
        outbox_id: 'out-1',
        pack_id: null,
      },
      error: null,
    });
    const validation = await validerAttribution();

    const lignes = journal.mock.calls.map((c) => String(c[0]));
    journal.mockRestore();

    expect(envoi.status).toBe(200);
    expect(validation.status).toBe(201);
    expect(
      lignes.filter((l) => l.includes('outbox.envoi_immediat.non_programme')),
    ).toHaveLength(2);
    expect(mockPassageCible).not.toHaveBeenCalled();
  });
});

describe('M1.5a / envoi immédiat — clic « Valider » une attribution AG', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('admin_savr');
  });

  it("M1.5a/envoi_immediat_validation_ag — attribution validée (201) : l'envoi de la collecte est programmé", async () => {
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        attribution_id: 'attr-1',
        outbox_id: 'out-1',
        pack_id: null,
      },
      error: null,
    });
    mockPassageCible.mockResolvedValue({
      reaped: 0,
      claimed: 1,
      done: 1,
      failed: 0,
      dead: 0,
    });

    const res = await validerAttribution();

    expect(res.status).toBe(201);
    expect(mockPassageCible).not.toHaveBeenCalled();
    const taches = tachesProgrammees();
    expect(taches).toHaveLength(1);

    await taches[0]!();
    expect(mockPassageCible).toHaveBeenCalledWith(mockSupabaseChain, 'coll-ag');
  });

  it("validation refusée par la base (attribution déjà existante, 409) : rien n'est programmé", async () => {
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0044', message: 'duplicate' },
    });

    const res = await validerAttribution();

    expect(res.status).toBe(409);
    expect(tachesProgrammees()).toHaveLength(0);
  });
});

// ── Cliquet de durée ─────────────────────────────────────────────────────────

const RACINE_SRC = path.resolve(__dirname, '../../../src');
const RACINE_API = path.join(RACINE_SRC, 'app/api');
const MIGRATIONS = path.resolve(
  __dirname,
  '../../../../../supabase/migrations',
);
const DUREE_MAX_S = 60;

/** Bail par défaut (en secondes) déclaré par la dernière définition d'une réservation. */
function bailParDefaut(fonction: string): number {
  const fichiers = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  const signature = new RegExp(
    `CREATE OR REPLACE FUNCTION plateforme\\.${fonction}\\(([^)]*)\\)`,
  );
  for (const f of fichiers) {
    const m = signature.exec(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    if (!m) continue;
    const bail =
      /p_lease_duration interval DEFAULT interval '(\d+) minutes'/.exec(m[1]!);
    if (!bail)
      throw new Error(`${fonction} : bail par défaut illisible (${f})`);
    return Number(bail[1]) * 60;
  }
  throw new Error(`${fonction} : aucune définition trouvée`);
}

function sources(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = path.join(dossier, e.name);
    if (e.isDirectory()) return sources(chemin);
    return /\.(ts|tsx|js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)
      ? [chemin]
      : [];
  });
}

function routes(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = path.join(dossier, e.name);
    if (e.isDirectory()) return routes(chemin);
    return /^route\.(ts|tsx|js|jsx)$/.test(e.name) ? [chemin] : [];
  });
}

function dureeMax(source: string): number | null {
  const m = /^export const maxDuration = (\d+);$/m.exec(source);
  return m ? Number(m[1]) : null;
}

describe('M1.5a / envoi immédiat — cliquet de durée des appelants', () => {
  const toutes = routes(RACINE_API).map((chemin) => ({
    chemin: path.relative(RACINE_API, chemin),
    source: readFileSync(chemin, 'utf8'),
  }));
  const declencheuses = toutes.filter((r) =>
    r.source.includes('envoyerOrdresSansAttendre('),
  );

  it('M1.5a/envoi_immediat_routes_declencheuses — les deux clics d’envoi de l’Admin déclenchent l’envoi immédiat', () => {
    expect(declencheuses.map((r) => r.chemin).sort()).toEqual([
      'v1/admin/attributions-ag/[collecteId]/valider/route.ts',
      'v1/admin/collectes/[id]/dispatch/route.ts',
    ]);
  });

  it('M1.5a/envoi_immediat_duree_bornee — chaque route déclencheuse déclare une durée de vie ≤ 60 s', () => {
    expect(declencheuses.length).toBeGreaterThan(0);
    for (const r of declencheuses) {
      const duree = dureeMax(r.source);
      expect(duree, `${r.chemin} : maxDuration absent`).not.toBeNull();
      expect(
        duree,
        `${r.chemin} : maxDuration > ${DUREE_MAX_S}`,
      ).toBeLessThanOrEqual(DUREE_MAX_S);
    }
  });

  it('la route du passage planifié respecte la même borne', () => {
    const planifie = toutes.find(
      (r) => r.chemin === 'cron/outbox-worker/route.ts',
    );
    expect(planifie).toBeDefined();
    const duree = dureeMax(planifie!.source);
    expect(duree).not.toBeNull();
    expect(duree).toBeLessThanOrEqual(DUREE_MAX_S);
  });

  it('M1.5a/envoi_immediat_duree_sous_le_bail — la borne de 60 s vaut au plus la moitié du bail par défaut des deux réservations logistiques', () => {
    expect(bailParDefaut('fn_claim_outbox_collecte')).toBe(120);
    expect(bailParDefaut('fn_claim_outbox_batch')).toBe(120);
    expect(DUREE_MAX_S * 2).toBeLessThanOrEqual(
      bailParDefaut('fn_claim_outbox_collecte'),
    );
  });

  it('M1.5a/envoi_immediat_appel_depuis_une_route — hors de sa propre lib, le déclencheur n’est appelé que depuis un fichier de route', () => {
    const appelants = sources(RACINE_SRC)
      .filter((chemin) =>
        readFileSync(chemin, 'utf8').includes('envoyerOrdresSansAttendre('),
      )
      .map((chemin) => path.relative(RACINE_SRC, chemin))
      .filter((chemin) => chemin !== 'lib/envoi-immediat.ts');

    expect(appelants.length).toBeGreaterThan(0);
    expect(
      appelants.filter((c) => !/(^|\/)route\.(ts|tsx|js|jsx)$/.test(c)),
    ).toEqual([]);
  });
});
