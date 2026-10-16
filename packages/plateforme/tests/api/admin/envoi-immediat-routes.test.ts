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
 *      bail de réservation des ordres, lu dans la migration. Limite nécessaire,
 *      pas suffisante : sur Vercel une tâche `after()` hors délai peut continuer
 *      (mesuré le 2026-10-12, invariant A3 de adapters/src/outbox-worker.ts).
 *
 *   4. le module sait traiter plusieurs collectes, ou toutes celles d'un
 *      événement, dans UNE tâche et l'une après l'autre ;
 *   5. cliquets de complétude : toute route qui appelle une fonction SQL
 *      émettrice d'ordres de collecte déclenche l'envoi immédiat, et la liste de
 *      ces fonctions est celle que disent les migrations ;
 *   6. le comportement de chaque route (envoi après une mutation réussie, rien
 *      après un refus de la base) est prouvé plus bas, dans le tableau des
 *      routes. Les gardes de ces routes restent prouvées par leurs propres
 *      fichiers de tests ;
 *   7. la tâche est bornée (décision Val 2026-10-13) : aucun passage pour une
 *      collecte sans ordre en file, dix collectes au plus, aucune commencée
 *      après quarante secondes ;
 *   8. les neuf routes des espaces clients passent par le frein de débit avant
 *      leur première écriture (lib/frein-ecritures-client, dont les compteurs
 *      sont prouvés dans son propre fichier de tests).
 *
 * `after()` est remplacée dans vitest.setup.ts par un espion qui n'exécute pas la
 * tâche : on la récupère dans ses appels et on la lance à la main.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { NextRequest, after } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BUDGET_TACHE_MS,
  MAX_COLLECTES_EXAMINEES,
  MAX_COLLECTES_PAR_TACHE,
  envoyerOrdresEvenementSansAttendre,
  envoyerOrdresSansAttendre,
} from '@/lib/envoi-immediat.js';
import {
  MAX_ECRITURES_PAR_ORGANISATION,
  MAX_MODIFICATIONS_PAR_OBJET,
  MESSAGE_FREIN,
  _reinitialiserFreinEcritures,
  freinerEcritureCliente,
} from '@/lib/frein-ecritures-client.js';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
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
    from: (...a: unknown[]) =>
      (mockSupabaseChain.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) =>
      (mockSupabaseChain.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/tarif-zd.js', () => ({
  calculer_tarif_zd: vi
    .fn()
    .mockResolvedValue({ montant_ht: 120, montant_brut_ht: 120 }),
  TarifZdError: class extends Error {},
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(
  role: string,
  userId = 'user-1',
  organisationId?: string,
  autresClaims: Record<string, unknown> = {},
) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          ...(organisationId ? { organisation_id: organisationId } : {}),
          ...autresClaims,
        }),
      },
    },
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

// ── Lectures de liste simulées ───────────────────────────────────────────────
// `await supabase.from(table).select()…` : la chaîne devient « thenable » et
// répond selon la table lue. Une table non décrite répond sans liste.
const chaine = mockSupabaseChain as typeof mockSupabaseChain & {
  then?: (resolve: (v: unknown) => void) => void;
};
type Reponse = { data: unknown; error: unknown };

function simulerListes(parTable: Record<string, Reponse>): void {
  let table = '';
  mockSupabaseChain.from.mockImplementation((nom: string) => {
    table = nom;
    return mockSupabaseChain;
  });
  chaine.then = (resolve) =>
    resolve(parTable[table] ?? { data: undefined, error: null });
}

/** File simulée : un ordre en attente pour chacune de ces collectes. */
const ordresEnFile = (...collectes: string[]): Reponse => ({
  data: collectes.map((aggregate_id) => ({ aggregate_id })),
  error: null,
});

beforeEach(() => {
  _reinitialiserFreinEcritures();
});
afterEach(() => {
  delete chaine.then;
  mockSupabaseChain.from.mockReset();
  mockSupabaseChain.from.mockReturnThis();
});

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

    simulerListes({ outbox_events: ordresEnFile('col-1') });
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
    simulerListes({ outbox_events: ordresEnFile('col-1') });
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

    simulerListes({ outbox_events: ordresEnFile('coll-ag') });
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

// ── Plusieurs collectes, et toutes celles d'un événement ─────────────────────

const PASSAGE_OK = { reaped: 0, claimed: 1, done: 1, failed: 0, dead: 0 };

describe('M1.5a / envoi immédiat — plusieurs collectes dans une seule tâche', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simulerListes({ outbox_events: ordresEnFile('col-a', 'col-b') });
  });

  it('M1.5a/envoi_immediat_plusieurs_collectes — une seule tâche, une collecte après l’autre, sans doublon', async () => {
    let finirLaPremiere: (v: typeof PASSAGE_OK) => void = () => {};
    mockPassageCible
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finirLaPremiere = resolve;
          }),
      )
      .mockResolvedValueOnce(PASSAGE_OK);

    envoyerOrdresSansAttendre(['col-a', 'col-b', 'col-a']);

    // Rien n'est parti pendant la requête, et une seule tâche est programmée.
    expect(mockPassageCible).not.toHaveBeenCalled();
    const taches = tachesProgrammees();
    expect(taches).toHaveLength(1);

    const course = taches[0]!();
    // La file est lue, puis le premier passage est lancé.
    await vi.waitFor(() => expect(mockPassageCible).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    // La seconde collecte attend la fin de la première.
    expect(mockPassageCible.mock.calls.map((c) => c[1])).toEqual(['col-a']);

    finirLaPremiere(PASSAGE_OK);
    await course;
    expect(mockPassageCible.mock.calls.map((c) => c[1])).toEqual([
      'col-a',
      'col-b',
    ]);
  });

  it('l’échec d’une collecte est journalisé et n’arrête pas les suivantes', async () => {
    mockPassageCible
      .mockRejectedValueOnce(new Error('panne du prestataire'))
      .mockResolvedValueOnce(PASSAGE_OK);
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});

    envoyerOrdresSansAttendre(['col-a', 'col-b']);
    await expect(tachesProgrammees()[0]!()).resolves.toBeUndefined();

    const lignes = journal.mock.calls.map((c) => String(c[0]));
    journal.mockRestore();
    const echec = lignes.find((l) => l.includes('outbox.envoi_immediat.echec'));
    expect(echec).toContain('col-a');
    expect(echec).toContain('panne du prestataire');
    expect(mockPassageCible.mock.calls.map((c) => c[1])).toEqual([
      'col-a',
      'col-b',
    ]);
  });

  it('aucune collecte : aucune tâche n’est programmée', () => {
    envoyerOrdresSansAttendre([]);

    expect(tachesProgrammees()).toHaveLength(0);
  });
});

describe('M1.5a / envoi immédiat — toutes les collectes d’un événement', () => {
  // Deux lectures dans la tâche : les collectes de l'événement, puis la file.
  function lectureRend(reponse: Reponse) {
    simulerListes({
      collectes: reponse,
      outbox_events: ordresEnFile('col-1', 'col-2'),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('M1.5a/envoi_immediat_par_evenement — les collectes sont lues DANS la tâche, puis traitées une à une', async () => {
    lectureRend({ data: [{ id: 'col-1' }, { id: 'col-2' }], error: null });
    mockPassageCible.mockResolvedValue(PASSAGE_OK);

    envoyerOrdresEvenementSansAttendre('evt-1');

    // Rien n'est lu ni envoyé pendant la requête.
    expect(mockSupabaseChain.from).not.toHaveBeenCalled();
    expect(mockPassageCible).not.toHaveBeenCalled();
    const taches = tachesProgrammees();
    expect(taches).toHaveLength(1);

    await taches[0]!();

    expect(mockSupabaseChain.from).toHaveBeenCalledWith('collectes');
    expect(mockSupabaseChain.eq).toHaveBeenCalledWith('evenement_id', 'evt-1');
    expect(mockSupabaseChain.from).toHaveBeenCalledWith('outbox_events');
    expect(mockPassageCible.mock.calls.map((c) => c[1])).toEqual([
      'col-1',
      'col-2',
    ]);
  });

  it('lecture des collectes en erreur : journalisée avec l’événement, rien n’est envoyé, aucune exception', async () => {
    lectureRend({ data: null, error: { message: 'permission denied' } });
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});

    envoyerOrdresEvenementSansAttendre('evt-1');
    await expect(tachesProgrammees()[0]!()).resolves.toBeUndefined();

    const lignes = journal.mock.calls.map((c) => String(c[0]));
    journal.mockRestore();
    const echec = lignes.find((l) => l.includes('outbox.envoi_immediat.echec'));
    expect(echec).toContain('evt-1');
    // Le message de la base est journalisé à part, jamais porté par l'erreur.
    expect(echec).not.toContain('permission denied');
    const detail = lignes.find((l) =>
      l.includes('outbox.envoi_immediat.lecture_collectes_evenement'),
    );
    expect(detail).toContain('permission denied');
    expect(mockPassageCible).not.toHaveBeenCalled();
  });

  it('événement sans collecte : la tâche ne lance aucun passage', async () => {
    lectureRend({ data: [], error: null });

    envoyerOrdresEvenementSansAttendre('evt-1');
    await tachesProgrammees()[0]!();

    expect(mockPassageCible).not.toHaveBeenCalled();
  });
});

// ── Les quatorze autres routes émettrices ────────────────────────────────────
//
// Chaque route est menée jusqu'à sa mutation avec une base simulée « large » :
// toute lecture rend la même ligne, qui appartient à l'organisation et à
// l'utilisateur de la session (sous l'identifiant de l'événement quand c'est
// lui qui est lu). Deux choses sont prouvées par route :
//   - mutation réussie : l'envoi est programmé, pour la ou les bonnes collectes ;
//   - mutation refusée par la base : rien n'est programmé.

const ORG = 'org-1';
const UTILISATEUR = 'user-1';

const EVENEMENT = {
  id: 'evt-1',
  organisation_id: ORG,
  created_by: UTILISATEUR,
  lieu_id: 'lieu-1',
  pax: 100,
  nom_evenement: 'Soirée de gala',
  date_evenement: '2099-01-20',
  statut: 'programmee',
  organisation: { nom: 'Traiteur Dupont' },
  lieux: { nom: 'Pavillon', organisation_id: ORG },
};

// Une seule ligne sert de collecte ET d'événement : elle porte les champs des
// deux, et l'identifiant de la collecte.
const LIGNE = {
  ...EVENEMENT,
  id: 'col-1',
  statut: 'programmee',
  statut_tms: 'non_envoye',
  tms_reference: null,
  type: 'zero_dechet',
  date_collecte: '2099-01-20',
  heure_collecte: '22:00:00',
  nb_camions_demande: 1,
  evenement_id: 'evt-1',
  prestataire_logistique_id: null,
  lieu_overrides: null,
  evenements: EVENEMENT,
  evenement: EVENEMENT,
};

/** Fonctions de lecture que certaines routes appellent avant leur mutation. */
const AUTRES_RPC: Record<string, unknown> = {
  // « L'événement est-il encore modifiable ? »
  f_collecte_editable: true,
};

interface CasRoute {
  nom: string;
  module: string;
  methode: 'POST' | 'PATCH';
  role: string;
  url: string;
  params: Record<string, string>;
  corps?: Record<string, unknown>;
  /** Champs de la ligne lue propres à ce cas (statut de départ, type…). */
  ligne?: Record<string, unknown>;
  /** Collectes rendues par une lecture de liste (défaut : la seule ligne). */
  collectes?: Record<string, unknown>[];
  /** Fonction émettrice appelée, et ce qu'elle rend quand elle réussit. */
  emetteur: string;
  rend: unknown;
  /** Ce qu'elle rend à chaque appel successif, quand la route l'appelle plusieurs fois. */
  rendSuccessifs?: unknown[];
  /** Collectes dont le passage doit être lancé, dans l'ordre. */
  attendu: string[];
  /** Réponses d'autres fonctions de lecture propres à ce cas. */
  autresRpc?: Record<string, unknown>;
  /**
   * Routes clientes : ce qu'il faut changer au cas pour que la DERNIÈRE garde
   * de la route le refuse (celle qui précède le frein de débit).
   */
  refusGarde?: Partial<
    Pick<CasRoute, 'ligne' | 'corps' | 'collectes' | 'autresRpc'>
  >;
  /** Modification d'un objet : la clé que la route doit donner au frein. */
  modification?: { collecte: string } | { evenement: string };
  /** Claims ajoutés au jeton de la session (impersonation). */
  claims?: Record<string, unknown>;
  /**
   * Entité de facturation de l'organisation : absente (la route la crée), ou
   * illisible (lecture en erreur). Par défaut : présente.
   */
  entiteFacturation?: 'absente' | 'illisible';
}

const PROGRAMMATION = {
  pax: 80,
  type_evenement_id: 'type-1',
  lieu_id: 'lieu-1',
  contact_principal_nom: 'Jean Martin',
  contact_principal_telephone: '0612345678',
  nom_client_organisateur: 'Traiteur Dupont',
  controle_acces_requis: false,
  collectes: [
    { type: 'zd', date_collecte: '2099-01-15', heure_collecte: '08:00' },
  ],
  confirmer: true,
};

const CAS: CasRoute[] = [
  {
    nom: 'Admin — création d’une collecte',
    module: '@/app/api/v1/admin/collectes/route.js',
    methode: 'POST',
    role: 'ops_savr',
    url: '/api/v1/admin/collectes',
    params: {},
    corps: {
      evenement_id: 'evt-1',
      type: 'zero_dechet',
      date_collecte: '2099-01-20',
      heure_collecte: '22:00',
    },
    emetteur: 'fn_creer_collecte',
    rend: 'col-neuve',
    attendu: ['col-neuve'],
  },
  {
    nom: 'Admin — modification d’une collecte',
    module: '@/app/api/v1/admin/collectes/[id]/route.js',
    methode: 'PATCH',
    role: 'ops_savr',
    url: '/api/v1/admin/collectes/col-1',
    params: { id: 'col-1' },
    corps: { heure_collecte: '09:30' },
    emetteur: 'fn_modifier_collecte',
    rend: { id: 'col-1' },
    attendu: ['col-1'],
  },
  {
    nom: 'Admin — incident (collecte annulée)',
    module: '@/app/api/v1/admin/collectes/[id]/incident/route.js',
    methode: 'POST',
    role: 'ops_savr',
    url: '/api/v1/admin/collectes/col-1/incident',
    params: { id: 'col-1' },
    corps: {
      incident_imputable_a: 'prestataire',
      motif_incident: 'Prestataire non présenté',
    },
    ligne: { statut: 'validee' },
    emetteur: 'fn_modifier_collecte',
    rend: { id: 'col-1', statut: 'annulee' },
    attendu: ['col-1'],
  },
  {
    nom: 'Admin — acceptation automatique AG',
    module:
      '@/app/api/v1/admin/attributions-ag/[collecteId]/auto-accept/route.js',
    methode: 'POST',
    role: 'admin_savr',
    url: '/api/v1/admin/attributions-ag/col-1/auto-accept',
    params: { collecteId: 'col-1' },
    emetteur: 'rpc_evaluer_auto_accept_ag',
    rend: { auto_accepted: true, reason: 'config_match' },
    attendu: ['col-1'],
  },
  {
    nom: 'Admin — modification d’un événement',
    module: '@/app/api/v1/admin/evenements/[id]/route.js',
    methode: 'PATCH',
    role: 'ops_savr',
    url: '/api/v1/admin/evenements/evt-1',
    params: { id: 'evt-1' },
    corps: { pax: 120 },
    emetteur: 'fn_modifier_evenement',
    rend: { id: 'evt-1' },
    attendu: ['col-1'],
  },
  {
    nom: 'Traiteur — modification d’une collecte',
    module: '@/app/api/v1/traiteur/collectes/[id]/route.js',
    methode: 'PATCH',
    role: 'traiteur_manager',
    url: '/api/v1/traiteur/collectes/col-1',
    params: { id: 'col-1' },
    corps: { heure_collecte: '21:00' },
    emetteur: 'fn_modifier_collecte',
    rend: { id: 'col-1' },
    attendu: ['col-1'],
    refusGarde: {
      ligne: { evenement: { ...EVENEMENT, organisation_id: 'org-tiers' } },
    },
    modification: { collecte: 'col-1' },
  },
  {
    nom: 'Traiteur — annulation directe',
    module: '@/app/api/v1/traiteur/collectes/[id]/annulation/route.js',
    methode: 'POST',
    role: 'traiteur_manager',
    url: '/api/v1/traiteur/collectes/col-1/annulation',
    params: { id: 'col-1' },
    corps: { motif: 'Événement annulé par le client' },
    emetteur: 'fn_modifier_collecte',
    rend: null,
    attendu: ['col-1'],
    refusGarde: { ligne: { statut: 'realisee' } },
  },
  {
    nom: 'Traiteur — demande d’annulation (collecte validée)',
    module: '@/app/api/v1/traiteur/collectes/[id]/annulation/route.js',
    methode: 'POST',
    role: 'traiteur_manager',
    url: '/api/v1/traiteur/collectes/col-1/annulation',
    params: { id: 'col-1' },
    corps: { motif: 'Événement annulé par le client' },
    ligne: { statut: 'validee' },
    emetteur: 'fn_modifier_collecte',
    rend: null,
    attendu: ['col-1'],
    refusGarde: { ligne: { statut: 'realisee' } },
  },
  {
    nom: 'Agence — modification d’une collecte',
    module: '@/app/api/v1/agence/collectes/[id]/route.js',
    methode: 'PATCH',
    role: 'agence',
    url: '/api/v1/agence/collectes/col-1',
    params: { id: 'col-1' },
    corps: { heure_collecte: '21:00' },
    emetteur: 'fn_modifier_collecte',
    rend: { id: 'col-1' },
    attendu: ['col-1'],
    refusGarde: {
      ligne: { evenement: { ...EVENEMENT, organisation_id: 'org-tiers' } },
    },
    modification: { collecte: 'col-1' },
  },
  {
    nom: 'Agence — annulation directe',
    module: '@/app/api/v1/agence/collectes/[id]/annulation/route.js',
    methode: 'POST',
    role: 'agence',
    url: '/api/v1/agence/collectes/col-1/annulation',
    params: { id: 'col-1' },
    corps: { motif: 'Événement annulé par le client' },
    emetteur: 'fn_modifier_collecte',
    rend: null,
    attendu: ['col-1'],
    refusGarde: { ligne: { statut: 'realisee' } },
  },
  {
    nom: 'Agence — demande d’annulation (collecte validée)',
    module: '@/app/api/v1/agence/collectes/[id]/annulation/route.js',
    methode: 'POST',
    role: 'agence',
    url: '/api/v1/agence/collectes/col-1/annulation',
    params: { id: 'col-1' },
    corps: { motif: 'Événement annulé par le client' },
    ligne: { statut: 'validee' },
    emetteur: 'fn_modifier_collecte',
    rend: null,
    attendu: ['col-1'],
    refusGarde: { ligne: { statut: 'realisee' } },
  },
  {
    nom: 'Gestionnaire de lieux — modification d’une collecte',
    module: '@/app/api/v1/gestionnaire/collectes/[id]/route.js',
    methode: 'PATCH',
    role: 'gestionnaire_lieux',
    url: '/api/v1/gestionnaire/collectes/col-1',
    params: { id: 'col-1' },
    corps: { heure_collecte: '21:00' },
    emetteur: 'fn_modifier_collecte',
    rend: { id: 'col-1' },
    attendu: ['col-1'],
    refusGarde: {
      ligne: { evenement: { ...EVENEMENT, organisation_id: 'org-tiers' } },
    },
    modification: { collecte: 'col-1' },
  },
  {
    nom: 'Programmation — événement confirmé à la création',
    module: '@/app/api/v1/programmation/evenements/route.js',
    methode: 'POST',
    role: 'traiteur_manager',
    url: '/api/v1/programmation/evenements',
    params: {},
    corps: PROGRAMMATION,
    emetteur: 'fn_creer_collecte',
    rend: 'col-neuve',
    attendu: ['col-neuve'],
    // Dernière garde 4xx avant le frein pour ce rôle : date de collecte passée
    // (la garde pack AG, qui la suivait, est retirée — décision Val 2026-10-16).
    // La lecture de l'entité de facturation, après elle, ne refuse qu'en 500.
    refusGarde: {
      corps: {
        ...PROGRAMMATION,
        collectes: [
          { type: 'zd', date_collecte: '2000-01-15', heure_collecte: '08:00' },
        ],
      },
    },
  },
  {
    nom: 'Programmation — événement confirmé à la création, deux collectes',
    module: '@/app/api/v1/programmation/evenements/route.js',
    methode: 'POST',
    role: 'traiteur_manager',
    url: '/api/v1/programmation/evenements',
    params: {},
    corps: {
      ...PROGRAMMATION,
      collectes: [
        { type: 'zd', date_collecte: '2099-01-15', heure_collecte: '08:00' },
        { type: 'zd', date_collecte: '2099-01-16', heure_collecte: '08:00' },
      ],
    },
    emetteur: 'fn_creer_collecte',
    rend: 'col-a',
    rendSuccessifs: ['col-a', 'col-b'],
    attendu: ['col-a', 'col-b'],
    // Dernière garde 4xx avant le frein pour ce rôle : date de collecte passée
    // (la garde pack AG, qui la suivait, est retirée — décision Val 2026-10-16).
    // La lecture de l'entité de facturation, après elle, ne refuse qu'en 500.
    refusGarde: {
      corps: {
        ...PROGRAMMATION,
        collectes: [
          { type: 'zd', date_collecte: '2000-01-15', heure_collecte: '08:00' },
        ],
      },
    },
  },
  {
    nom: 'Programmation — modification d’un événement',
    module: '@/app/api/v1/programmation/evenements/[id]/route.js',
    methode: 'PATCH',
    role: 'traiteur_manager',
    url: '/api/v1/programmation/evenements/evt-1',
    params: { id: 'evt-1' },
    corps: { pax: 120 },
    emetteur: 'fn_modifier_evenement',
    rend: { id: 'evt-1' },
    attendu: ['col-1'],
    refusGarde: { autresRpc: { f_collecte_editable: false } },
    modification: { evenement: 'evt-1' },
  },
  {
    nom: 'Programmation — collecte ajoutée à un événement',
    module: '@/app/api/v1/programmation/evenements/[id]/collectes/route.js',
    methode: 'POST',
    role: 'traiteur_manager',
    url: '/api/v1/programmation/evenements/evt-1/collectes',
    params: { id: 'evt-1' },
    corps: { type: 'zd', date_collecte: '2099-01-20', heure_collecte: '22:00' },
    emetteur: 'fn_ajouter_collecte_evenement',
    rend: 'col-neuve',
    attendu: ['col-neuve'],
    // Dernière garde avant le frein : événement non modifiable (la garde pack
    // AG, qui la suivait, est retirée — décision Val 2026-10-16).
    refusGarde: { autresRpc: { f_collecte_editable: false } },
  },
  {
    nom: 'Programmation — brouillon confirmé',
    module: '@/app/api/v1/programmation/evenements/[id]/confirmer/route.js',
    methode: 'PATCH',
    role: 'traiteur_manager',
    url: '/api/v1/programmation/evenements/evt-1/confirmer',
    params: { id: 'evt-1' },
    ligne: { statut: 'brouillon' },
    emetteur: 'fn_confirmer_programmation_brouillon',
    rend: null,
    attendu: ['col-1'],
    // Dernière garde avant le frein : aucune collecte en brouillon (la garde
    // pack AG, qui la suivait, est retirée — décision Val 2026-10-16).
    refusGarde: { collectes: [] },
  },
  {
    nom: 'Programmation — brouillon confirmé, deux collectes',
    module: '@/app/api/v1/programmation/evenements/[id]/confirmer/route.js',
    methode: 'PATCH',
    role: 'traiteur_manager',
    url: '/api/v1/programmation/evenements/evt-1/confirmer',
    params: { id: 'evt-1' },
    ligne: { statut: 'brouillon' },
    collectes: [
      { ...LIGNE, id: 'col-1', statut: 'brouillon' },
      { ...LIGNE, id: 'col-2', statut: 'brouillon' },
    ],
    emetteur: 'fn_confirmer_programmation_brouillon',
    rend: null,
    attendu: ['col-1', 'col-2'],
    // Dernière garde avant le frein : aucune collecte en brouillon (la garde
    // pack AG, qui la suivait, est retirée — décision Val 2026-10-16).
    refusGarde: { collectes: [] },
  },
];

/**
 * Base simulée : toute lecture rend `ligne`, sous l'identifiant de l'événement
 * quand c'est la table des événements qui est lue (une route qui prendrait
 * l'identifiant de l'événement pour celui d'une collecte se verrait). La file
 * porte un ordre en attente pour chaque collecte attendue.
 * `emetteur` répond `reponse`, ou ses valeurs successives.
 */
function base(cas: CasRoute, reponse: Reponse) {
  const ligne = { ...LIGNE, ...(cas.ligne ?? {}) };
  let table = '';
  mockSupabaseChain.from.mockImplementation((nom: string) => {
    table = nom;
    return mockSupabaseChain;
  });
  const ligneLue = () =>
    table === 'evenements' ? { ...ligne, id: EVENEMENT.id } : ligne;
  mockSupabaseChain.single.mockImplementation(async () => ({
    data: ligneLue(),
    error: null,
  }));
  mockSupabaseChain.maybeSingle.mockImplementation(async () =>
    cas.entiteFacturation && table === 'entites_facturation'
      ? {
          data: null,
          error:
            cas.entiteFacturation === 'illisible'
              ? { message: 'timeout' }
              : null,
        }
      : { data: ligneLue(), error: null },
  );
  const listes: Record<string, () => unknown> = {
    collectes: () => cas.collectes ?? [ligne],
    outbox_events: () => ordresEnFile(...cas.attendu).data,
  };
  chaine.then = (resolve) =>
    resolve({ data: (listes[table] ?? (() => [ligneLue()]))(), error: null });
  const successifs = [...(cas.rendSuccessifs ?? [])];
  mockSupabaseChain.rpc.mockImplementation(async (nom: string) => {
    const autres = { ...AUTRES_RPC, ...(cas.autresRpc ?? {}) };
    if (nom !== cas.emetteur) return { data: autres[nom] ?? null, error: null };
    if (reponse.error || successifs.length === 0) return reponse;
    return { data: successifs.shift(), error: null };
  });
}

async function appeler(cas: CasRoute): Promise<Response> {
  setupAuth(cas.role, UTILISATEUR, ORG, cas.claims);
  const handlers = (await import(cas.module)) as Record<
    string,
    (req: NextRequest, ctx: unknown) => Promise<Response>
  >;
  const req = new NextRequest(`http://localhost${cas.url}`, {
    method: cas.methode,
    body: cas.corps ? JSON.stringify(cas.corps) : undefined,
    headers: cas.corps ? { 'content-type': 'application/json' } : {},
  });
  return handlers[cas.methode]!(req, { params: Promise.resolve(cas.params) });
}

function oublierBase(): void {
  mockSupabaseChain.single.mockReset();
  mockSupabaseChain.maybeSingle.mockReset();
  mockSupabaseChain.rpc.mockReset();
}

describe('M1.5a / envoi immédiat — les autres routes émettrices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPassageCible.mockResolvedValue(PASSAGE_OK);
  });
  afterEach(oublierBase);

  it.each(CAS)(
    'M1.5a/envoi_immediat_autres_emetteurs — $nom : mutation réussie, l’envoi est programmé pour la bonne collecte',
    async (cas) => {
      base(cas, { data: cas.rend, error: null });

      const res = await appeler(cas);

      expect(
        res.status,
        `réponse inattendue : ${await res.clone().text()}`,
      ).toBeLessThan(300);
      expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
        cas.emetteur,
        expect.anything(),
      );
      // Rien n'est parti pendant la requête : une tâche, pour après la réponse.
      expect(mockPassageCible).not.toHaveBeenCalled();
      const taches = tachesProgrammees();
      expect(taches).toHaveLength(1);

      await taches[0]!();
      // La file est consultée pour ces collectes et elles seules : une collecte
      // de trop, que la file simulée écarterait, se voit ici.
      expect(mockSupabaseChain.in).toHaveBeenCalledWith(
        'aggregate_id',
        cas.attendu,
      );
      expect(mockPassageCible.mock.calls.map((c) => c[1])).toEqual(cas.attendu);
    },
  );

  it.each(CAS)(
    'M1.5a/envoi_immediat_autres_emetteurs_refus — $nom : mutation refusée par la base, rien n’est programmé',
    async (cas) => {
      base(cas, {
        data: null,
        error: { code: 'P0001', message: 'refus de la base' },
      });

      const res = await appeler(cas);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
        cas.emetteur,
        expect.anything(),
      );
      expect(tachesProgrammees()).toHaveLength(0);
    },
  );

  it('acceptation automatique AG non accordée : aucune attribution validée, rien n’est programmé', async () => {
    const cas = CAS.find((c) => c.emetteur === 'rpc_evaluer_auto_accept_ag')!;
    base(cas, {
      data: { auto_accepted: false, reason: 'aucune_config' },
      error: null,
    });

    const res = await appeler(cas);

    expect(res.status).toBe(200);
    expect(tachesProgrammees()).toHaveLength(0);
  });
});

// ── Tâche bornée (décision Val 2026-10-13) ───────────────────────────────────

describe('M1.5a / envoi immédiat — tâche bornée', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPassageCible.mockResolvedValue(PASSAGE_OK);
  });

  const collectesTraitees = () => mockPassageCible.mock.calls.map((c) => c[1]);

  async function journalDe(action: () => Promise<void>): Promise<string[]> {
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await action();
      return journal.mock.calls.map((c) => String(c[0]));
    } finally {
      journal.mockRestore();
    }
  }

  it('M1.5a/frein_tache_sans_ordre — aucune collecte n’a d’ordre en file : aucun passage n’est lancé, la file est lue une fois', async () => {
    simulerListes({ outbox_events: ordresEnFile() });

    envoyerOrdresSansAttendre(['col-a', 'col-b']);
    await tachesProgrammees()[0]!();

    expect(mockPassageCible).not.toHaveBeenCalled();
    expect(mockSupabaseChain.from.mock.calls).toEqual([['outbox_events']]);
    expect(mockSupabaseChain.eq).toHaveBeenCalledWith(
      'aggregate_type',
      'collecte',
    );
    expect(mockSupabaseChain.in).toHaveBeenCalledWith('aggregate_id', [
      'col-a',
      'col-b',
    ]);
    // Ordres en attente seulement : ni terminés, ni déjà pris par un passage.
    expect(mockSupabaseChain.in).toHaveBeenCalledWith('statut', [
      'pending',
      'failed',
    ]);
  });

  it('M1.5a/frein_tache_ordre_partiel — seules les collectes qui ont un ordre en file sont traitées, dans l’ordre reçu', async () => {
    simulerListes({ outbox_events: ordresEnFile('col-c', 'col-a', 'col-c') });

    envoyerOrdresSansAttendre(['col-a', 'col-b', 'col-c']);
    await tachesProgrammees()[0]!();

    expect(collectesTraitees()).toEqual(['col-a', 'col-c']);
  });

  it('M1.5a/frein_tache_identifiant_autre_ecriture — une collecte désignée par une autre écriture de son identifiant garde son passage', async () => {
    const A = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const C = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    // La base rend toujours la forme standard.
    simulerListes({ outbox_events: ordresEnFile(A, C) });
    const recues = [
      A.toUpperCase(),
      '{b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}',
      'c0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11',
      `{${A.replaceAll('-', '')}}`,
    ];

    envoyerOrdresSansAttendre(recues);
    await tachesProgrammees()[0]!();

    // Celles qui ont un ordre, telles que reçues ; pas la deuxième, sans ordre.
    expect(collectesTraitees()).toEqual([recues[0], recues[2], recues[3]]);
  });

  it('M1.5a/frein_tache_reponse_tronquee — une réponse au plafond de lignes de l’API vaut une file illisible', async () => {
    // Mille lignes pour la seule col-a : la réponse a pu perdre celles de col-b.
    simulerListes({
      outbox_events: ordresEnFile(...Array<string>(1_000).fill('col-a')),
    });

    envoyerOrdresSansAttendre(['col-a', 'col-b']);
    const lignes = await journalDe(tachesProgrammees()[0]!);

    expect(collectesTraitees()).toEqual(['col-a', 'col-b']);
    expect(
      lignes.find((l) => l.includes('outbox.envoi_immediat.file_illisible')),
    ).toContain('plafond de lignes');
  });

  it('juste sous le plafond de lignes, la réponse est lue normalement', async () => {
    simulerListes({
      outbox_events: ordresEnFile(...Array<string>(999).fill('col-a')),
    });

    envoyerOrdresSansAttendre(['col-a', 'col-b']);
    await tachesProgrammees()[0]!();

    expect(collectesTraitees()).toEqual(['col-a']);
  });

  it.each([
    [
      'lecture en erreur',
      { data: null, error: { message: 'permission denied' } },
      'permission denied',
    ],
    [
      'réponse sans liste',
      { data: undefined, error: null },
      'réponse sans liste',
    ],
  ])(
    'M1.5a/frein_tache_file_illisible — %s : jamais lue comme « aucun ordre », les collectes sont traitées',
    async (_cas, reponse, motif) => {
      simulerListes({ outbox_events: reponse });

      envoyerOrdresSansAttendre(['col-a', 'col-b']);
      const lignes = await journalDe(tachesProgrammees()[0]!);

      expect(collectesTraitees()).toEqual(['col-a', 'col-b']);
      const alerte = lignes.find((l) =>
        l.includes('outbox.envoi_immediat.file_illisible'),
      );
      expect(alerte).toContain(motif);
    },
  );

  it('M1.5a/frein_tache_plafond — dix collectes traitées au plus, cinquante consultées ; le reste est laissé au passage planifié et journalisé', async () => {
    // Valeurs décidées par Val le 2026-10-13.
    expect([
      MAX_COLLECTES_EXAMINEES,
      MAX_COLLECTES_PAR_TACHE,
      BUDGET_TACHE_MS,
    ]).toEqual([50, 10, 40_000]);

    const toutes = Array.from({ length: 60 }, (_, i) => `col-${i}`);
    simulerListes({ outbox_events: ordresEnFile(...toutes) });

    envoyerOrdresSansAttendre(toutes);
    const lignes = await journalDe(tachesProgrammees()[0]!);

    expect(mockSupabaseChain.in).toHaveBeenCalledWith(
      'aggregate_id',
      toutes.slice(0, 50),
    );
    expect(collectesTraitees()).toEqual(toutes.slice(0, 10));
    const laisse = lignes.find((l) =>
      l.includes('outbox.envoi_immediat.laisse_au_passage_planifie'),
    );
    // 10 jamais consultées + 40 consultées mais au-delà du plafond.
    expect(JSON.parse(laisse!).payload).toEqual({
      motif: 'plafond',
      collectes: 50,
    });
  });

  it('sous les plafonds, rien n’est journalisé comme laissé au passage planifié', async () => {
    simulerListes({ outbox_events: ordresEnFile('col-a') });

    envoyerOrdresSansAttendre(['col-a', 'col-b']);
    const lignes = await journalDe(tachesProgrammees()[0]!);

    expect(
      lignes.filter((l) => l.includes('laisse_au_passage_planifie')),
    ).toHaveLength(0);
  });

  describe('budget de temps', () => {
    let horloge = 0;
    beforeEach(() => {
      horloge = 1_700_000_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => horloge);
      simulerListes({ outbox_events: ordresEnFile('col-a', 'col-b', 'col-c') });
    });
    afterEach(() => {
      vi.mocked(Date.now).mockRestore();
    });

    it('M1.5a/frein_tache_budget — passé quarante secondes depuis le départ de la tâche, aucune collecte n’est commencée', async () => {
      mockPassageCible.mockImplementationOnce(async () => {
        horloge += BUDGET_TACHE_MS + 1;
        return PASSAGE_OK;
      });

      envoyerOrdresSansAttendre(['col-a', 'col-b', 'col-c']);
      const lignes = await journalDe(tachesProgrammees()[0]!);

      expect(collectesTraitees()).toEqual(['col-a']);
      const laisse = lignes.find((l) =>
        l.includes('outbox.envoi_immediat.laisse_au_passage_planifie'),
      );
      expect(JSON.parse(laisse!).payload).toEqual({
        motif: 'budget',
        collectes: 2,
      });
    });

    it('à quarante secondes pile, la collecte suivante est encore commencée', async () => {
      mockPassageCible.mockImplementationOnce(async () => {
        horloge += BUDGET_TACHE_MS;
        return PASSAGE_OK;
      });

      envoyerOrdresSansAttendre(['col-a', 'col-b']);
      await tachesProgrammees()[0]!();

      expect(collectesTraitees()).toEqual(['col-a', 'col-b']);
    });

    it('le budget se compte depuis le départ de la tâche, lecture de la file comprise', async () => {
      // La lecture de la file a consommé tout le budget : rien n'est commencé.
      const lecture = chaine.then!;
      chaine.then = (resolve) => {
        horloge += BUDGET_TACHE_MS + 1;
        lecture(resolve);
      };

      envoyerOrdresSansAttendre(['col-a', 'col-b']);
      await tachesProgrammees()[0]!();

      expect(collectesTraitees()).toEqual([]);
    });

    it('par événement, le budget couvre aussi la lecture de ses collectes', async () => {
      let lectures = 0;
      simulerListes({
        collectes: { data: [{ id: 'col-a' }, { id: 'col-b' }], error: null },
        outbox_events: ordresEnFile('col-a', 'col-b'),
      });
      const lecture = chaine.then!;
      chaine.then = (resolve) => {
        // Seule la première lecture (les collectes de l'événement) est lente.
        if (lectures++ === 0) horloge += BUDGET_TACHE_MS + 1;
        lecture(resolve);
      };

      envoyerOrdresEvenementSansAttendre('evt-1');
      await tachesProgrammees()[0]!();

      expect(lectures).toBe(2);
      expect(collectesTraitees()).toEqual([]);
    });
  });
});

// ── Frein de débit des routes clientes (décision Val 2026-10-13) ─────────────
//
// Les compteurs eux-mêmes sont prouvés dans src/lib/frein-ecritures-client.test.ts.
// Ici : chaque route cliente passe par le frein, au bon endroit, avec la bonne clé.

const CAS_CLIENTS = CAS.filter((c) => !c.module.includes('/admin/'));
const CAS_MODIFICATION = CAS_CLIENTS.filter((c) => c.modification);

/** Écritures déjà comptées, comme si elles venaient d'être acceptées. */
function dejaEcrit(
  nombre: number,
  ecriture: Parameters<typeof freinerEcritureCliente>[0],
): void {
  for (let i = 0; i < nombre; i++) {
    expect(freinerEcritureCliente(ecriture)).toBeNull();
  }
}

describe('M1.5a / frein de débit — routes des espaces clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPassageCible.mockResolvedValue(PASSAGE_OK);
  });
  afterEach(oublierBase);

  const rienEcrit = (cas: CasRoute) => {
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalledWith(
      cas.emetteur,
      expect.anything(),
    );
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
    expect(mockSupabaseChain.delete).not.toHaveBeenCalled();
    expect(tachesProgrammees()).toHaveLength(0);
  };

  it.each(CAS_CLIENTS)(
    'M1.5a/frein_ecritures_routes_clientes — $nom : organisation au plafond, 429 sans rien écrire ni rien programmer',
    async (cas) => {
      base(cas, { data: cas.rend, error: null });
      dejaEcrit(MAX_ECRITURES_PAR_ORGANISATION, { organisationId: ORG });

      const res = await appeler(cas);

      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: MESSAGE_FREIN });
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
      rienEcrit(cas);
    },
  );

  it.each(CAS_CLIENTS)(
    'M1.5a/frein_ecritures_apres_les_gardes — $nom : une requête refusée par la dernière garde ne consomme rien',
    async (cas) => {
      expect(cas.refusGarde, 'cas client sans refusGarde').toBeDefined();
      dejaEcrit(MAX_ECRITURES_PAR_ORGANISATION - 1, { organisationId: ORG });

      // Refusée par la garde : ni 429, ni écriture.
      const refuse = { ...cas, ...cas.refusGarde };
      base(refuse, { data: cas.rend, error: null });
      const refus = await appeler(refuse);
      expect([403, 422]).toContain(refus.status);
      rienEcrit(cas);

      // La centième écriture de la fenêtre passe donc encore…
      base(cas, { data: cas.rend, error: null });
      expect((await appeler(cas)).status).toBeLessThan(300);
      // … et c'est bien elle qui a été comptée : la suivante est freinée.
      expect((await appeler(cas)).status).toBe(429);
    },
  );

  it.each(CAS_MODIFICATION)(
    'M1.5a/frein_ecritures_modification_par_objet — $nom : dix modifications du même objet, la onzième est freinée',
    async (cas) => {
      base(cas, { data: cas.rend, error: null });
      // Comptées pour une autre organisation : seul le compteur de l'objet joue.
      dejaEcrit(MAX_MODIFICATIONS_PAR_OBJET - 1, {
        organisationId: 'org-autre',
        modification: cas.modification,
      });

      expect((await appeler(cas)).status).toBeLessThan(300);
      vi.clearAllMocks();
      const res = await appeler(cas);

      expect(res.status).toBe(429);
      rienEcrit(cas);
    },
  );

  it.each(CAS_CLIENTS.filter((c) => !c.modification))(
    'M1.5a/frein_ecritures_hors_modification — $nom : création ou annulation, jamais freinée par le compteur de l’objet',
    async (cas) => {
      base(cas, { data: cas.rend, error: null });
      for (const modification of [
        { collecte: 'col-1' },
        { evenement: 'evt-1' },
      ]) {
        dejaEcrit(MAX_MODIFICATIONS_PAR_OBJET, {
          organisationId: 'org-autre',
          modification,
        });
      }

      expect((await appeler(cas)).status).toBeLessThan(300);
    },
  );

  // L'identifiant de l'URL écrit autrement (la base accepte plusieurs écritures
  // d'un même uuid) : la base simulée rend toujours le sien.
  const autreEcriture = (cas: CasRoute): CasRoute => ({
    ...cas,
    url: cas.url.replace(cas.params.id!, cas.params.id!.toUpperCase()),
    params: { id: cas.params.id!.toUpperCase() },
  });

  it.each(CAS_MODIFICATION)(
    'M1.5a/frein_ecritures_identifiant_de_la_base — $nom : identifiant écrit autrement dans l’URL, le compteur reste celui de l’objet',
    async (cas) => {
      const autrement = autreEcriture(cas);
      expect(autrement.params.id).not.toBe(cas.params.id);
      base(autrement, { data: cas.rend, error: null });
      dejaEcrit(MAX_MODIFICATIONS_PAR_OBJET, {
        organisationId: 'org-autre',
        modification: cas.modification,
      });

      const res = await appeler(autrement);

      expect(res.status).toBe(429);
      rienEcrit(cas);
    },
  );

  it.each(CAS_CLIENTS.filter((c) => /\/collectes\/col-1/.test(c.url)))(
    'M1.5a/frein_ecritures_envoi_identifiant_de_la_base — $nom : identifiant écrit autrement dans l’URL, l’envoi vise celui que rend la base',
    async (cas) => {
      const autrement = autreEcriture(cas);
      base(autrement, { data: cas.rend, error: null });

      expect((await appeler(autrement)).status).toBeLessThan(300);
      await tachesProgrammees()[0]!();

      expect(mockPassageCible.mock.calls.map((c) => c[1])).toEqual(cas.attendu);
    },
  );

  it('modification d’un événement désigné autrement dans l’URL : ses collectes sont lues sous l’identifiant que rend la base', async () => {
    const autrement = autreEcriture(
      CAS_MODIFICATION.find((c) => 'evenement' in c.modification!)!,
    );
    base(autrement, { data: autrement.rend, error: null });

    expect((await appeler(autrement)).status).toBeLessThan(300);
    const tache = tachesProgrammees()[0]!;
    // Seules les lectures de la tâche comptent ici, pas celles de la route.
    mockSupabaseChain.eq.mockClear();
    await tache();

    expect(mockSupabaseChain.eq).toHaveBeenCalledWith('evenement_id', 'evt-1');
    expect(mockSupabaseChain.eq).not.toHaveBeenCalledWith(
      'evenement_id',
      'EVT-1',
    );
  });

  const PROGRAMMER = CAS_CLIENTS.find(
    (c) => c.module === '@/app/api/v1/programmation/evenements/route.js',
  )!;

  it('M1.5a/frein_ecritures_organisation_du_jeton — un client ne choisit pas l’organisation comptée : celle de sa session, jamais celle du corps de la requête', async () => {
    const cas: CasRoute = {
      ...PROGRAMMER,
      corps: { ...PROGRAMMATION, organisation_id: 'org-autre' },
    };
    base(cas, { data: cas.rend, error: null });
    dejaEcrit(MAX_ECRITURES_PAR_ORGANISATION, { organisationId: ORG });

    expect((await appeler(cas)).status).toBe(429);
    rienEcrit(cas);
    // Et rien n'a été compté pour l'organisation nommée dans le corps.
    dejaEcrit(MAX_ECRITURES_PAR_ORGANISATION, { organisationId: 'org-autre' });
  });

  it('M1.5a/frein_ecritures_avant_entite_facturation — organisation sans entité de facturation, au plafond : 429 avant que la route ne la crée', async () => {
    const cas: CasRoute = { ...PROGRAMMER, entiteFacturation: 'absente' };
    base(cas, { data: cas.rend, error: null });
    dejaEcrit(MAX_ECRITURES_PAR_ORGANISATION, { organisationId: ORG });

    expect((await appeler(cas)).status).toBe(429);
    // L'entité a été cherchée (lecture), pas créée.
    expect(mockSupabaseChain.from).toHaveBeenCalledWith('entites_facturation');
    rienEcrit(cas);
  });

  it('organisation sans entité de facturation, sous le plafond : la route la crée et programme', async () => {
    const cas: CasRoute = { ...PROGRAMMER, entiteFacturation: 'absente' };
    base(cas, { data: cas.rend, error: null });

    expect((await appeler(cas)).status).toBeLessThan(300);
    expect(mockSupabaseChain.from).toHaveBeenCalledWith('entites_facturation');
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ entite_par_defaut: true }),
    );
  });

  it('lecture de l’entité de facturation en erreur : 500, aucune entité créée, rien de compté', async () => {
    const cas: CasRoute = { ...PROGRAMMER, entiteFacturation: 'illisible' };
    base(cas, { data: cas.rend, error: null });
    dejaEcrit(MAX_ECRITURES_PAR_ORGANISATION - 1, { organisationId: ORG });
    const journal = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = await appeler(cas);
    journal.mockRestore();

    expect(res.status).toBe(500);
    rienEcrit(cas);
    // La panne est survenue avant le frein : la centième écriture reste due.
    expect(freinerEcritureCliente({ organisationId: ORG })).toBeNull();
  });

  it('M1.5a/frein_ecritures_brouillon — l’enregistrement d’un brouillon compte comme une écriture de l’organisation', async () => {
    const brouillon: CasRoute = {
      ...CAS_CLIENTS.find(
        (c) => c.module === '@/app/api/v1/programmation/evenements/route.js',
      )!,
      corps: { ...PROGRAMMATION, confirmer: false },
    };
    base(brouillon, { data: null, error: null });
    dejaEcrit(MAX_ECRITURES_PAR_ORGANISATION - 1, { organisationId: ORG });

    // La centième écriture de la fenêtre : le brouillon est enregistré…
    expect((await appeler(brouillon)).status).toBeLessThan(300);
    expect(mockSupabaseChain.insert).toHaveBeenCalled();
    // … et compté : le suivant est freiné, sans rien écrire.
    vi.clearAllMocks();
    expect((await appeler(brouillon)).status).toBe(429);
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  });

  it.each(CAS_MODIFICATION)(
    'M1.5a/frein_ecritures_impersonation — $nom : une session Admin ouverte sous l’identité d’un client est freinée comme ce client',
    async (cas) => {
      const sousIdentite = { ...cas, claims: { impersonator_id: 'admin-1' } };
      base(sousIdentite, { data: cas.rend, error: null });
      dejaEcrit(MAX_ECRITURES_PAR_ORGANISATION, { organisationId: ORG });

      const res = await appeler(sousIdentite);

      expect(res.status).toBe(429);
      rienEcrit(cas);
    },
  );

  // Programmation de support : les trois routes ouvertes à l'équipe Savr.
  const CAS_EQUIPE_SAVR: CasRoute[] = CAS_CLIENTS.filter((c) =>
    [
      '@/app/api/v1/programmation/evenements/route.js',
      '@/app/api/v1/programmation/evenements/[id]/collectes/route.js',
      '@/app/api/v1/programmation/evenements/[id]/confirmer/route.js',
    ].includes(c.module),
  ).flatMap((c) =>
    ['admin_savr', 'ops_savr'].map((role) => ({
      ...c,
      role,
      corps: c.corps ? { ...c.corps, organisation_id: ORG } : undefined,
    })),
  );

  it.each(CAS_EQUIPE_SAVR)(
    'M1.5a/frein_ecritures_equipe_savr — $nom, $role : sous son propre rôle, l’équipe Savr n’est ni freinée ni comptée',
    async (cas) => {
      base(cas, { data: cas.rend, error: null });
      dejaEcrit(MAX_ECRITURES_PAR_ORGANISATION - 1, { organisationId: ORG });

      // Deux écritures de l'équipe Savr pour cette organisation : acceptées.
      expect((await appeler(cas)).status).toBeLessThan(300);
      expect((await appeler(cas)).status).toBeLessThan(300);

      // Elles n'ont rien consommé : il reste exactement une écriture au client.
      expect(freinerEcritureCliente({ organisationId: ORG })).toBeNull();
      expect(freinerEcritureCliente({ organisationId: ORG })?.status).toBe(429);
    },
  );
});

// ── Cliquets : durée, complétude ─────────────────────────────────────────────

const RACINE_SRC = path.resolve(__dirname, '../../../src');
const RACINE_API = path.join(RACINE_SRC, 'app/api');
const MIGRATIONS = path.resolve(
  __dirname,
  '../../../../../supabase/migrations',
);
const DUREE_MAX_S = 60;

/** Appel de l'un des deux déclencheurs de `lib/envoi-immediat.ts`. */
const DECLENCHEUR = /envoyerOrdres(Evenement)?SansAttendre\(/;

/**
 * Fonctions SQL qui écrivent un ordre de COLLECTE dans la file, ou qui en
 * appellent une. Une route qui en appelle une doit déclencher l'envoi immédiat.
 * Liste tenue en phase avec les migrations par le cliquet `emetteurs_sql`.
 */
const EMETTEURS_SQL = [
  'fn_ajouter_collecte_evenement', // appelle fn_creer_collecte
  'fn_confirmer_programmation_brouillon',
  'fn_creer_collecte',
  'fn_dispatcher_collecte',
  'fn_modifier_collecte',
  'fn_modifier_evenement',
  'rpc_evaluer_auto_accept_ag', // appelle rpc_valider_attribution_ag
  'rpc_valider_attribution_ag',
];

/** Fonctions qui écrivent dans la file sans relever de l'envoi immédiat. */
const HORS_ENVOI_IMMEDIAT = [
  // Trigger retiré de `collectes` (20260629100000) : la fonction subsiste, morte.
  '_fn_trg_outbox_collecte_annulee',
  // Ordre « lieu » (E5), émis par trigger : il reste au passage planifié.
  '_fn_trg_outbox_lieu_critique',
];

/**
 * Enveloppes TypeScript d'une fonction émettrice : les routes passent par elles.
 * Fichier → fonction exportée que les routes appellent.
 */
const ENVELOPPES: Record<string, string> = {
  'lib/attribution-ag/auto-accept.ts': 'evaluerAutoAcceptAg',
  'lib/attribution-ag/validation.ts': 'validerAttributionAg',
};

const APPEL_RPC_EMETTEUR = new RegExp(
  `rpc\\(\\s*['"](${EMETTEURS_SQL.join('|')})['"]`,
);
const APPEL_ENVELOPPE = new RegExp(
  `\\b(${Object.values(ENVELOPPES).join('|')})\\(`,
);

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

/**
 * Fonctions du schéma `plateforme` dont une définition, dans les migrations,
 * écrit dans `outbox_events` ou appelle une fonction de `EMETTEURS_SQL`.
 */
function emetteursDesMigrations(): string[] {
  const noms = new Set<string>();
  // Insensible à la casse ; la table peut être écrite sans son schéma. Le
  // cliquet protège la forme qu'ont les migrations : une déclaration sans
  // schéma, ou un appel d'émetteur sans préfixe, lui échapperaient.
  const appelEmetteur = new RegExp(
    `plateforme\\.(${EMETTEURS_SQL.join('|')})\\(`,
    'i',
  );
  const ecritureFile = /INSERT\s+INTO\s+(plateforme\.)?outbox_events\b/i;
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql'))) {
    let courante: string | null = null;
    for (const ligne of readFileSync(path.join(MIGRATIONS, f), 'utf8').split(
      '\n',
    )) {
      const decl =
        /^\s*CREATE (?:OR REPLACE )?FUNCTION ([a-z_]+)\.([a-z_0-9]+)/i.exec(
          ligne,
        );
      if (decl) {
        courante =
          decl[1]!.toLowerCase() === 'plateforme'
            ? decl[2]!.toLowerCase()
            : null;
        continue;
      }
      // Fin du corps (`$$;`, `$function$ LANGUAGE …`) : hors de toute fonction.
      if (/^\$[a-z_]*\$/.test(ligne)) {
        courante = null;
        continue;
      }
      if (!courante || /^\s*--/.test(ligne)) continue;
      if (ecritureFile.test(ligne)) {
        noms.add(courante);
      }
      const appel = appelEmetteur.exec(ligne);
      if (appel && appel[1]!.toLowerCase() !== courante) noms.add(courante);
    }
  }
  return [...noms].sort();
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

describe('M1.5a / envoi immédiat — cliquets de durée et de complétude', () => {
  const toutes = routes(RACINE_API).map((chemin) => ({
    chemin: path.relative(RACINE_API, chemin),
    source: readFileSync(chemin, 'utf8'),
  }));
  const declencheuses = toutes.filter((r) => DECLENCHEUR.test(r.source));

  it('M1.5a/envoi_immediat_routes_declencheuses — les seize routes qui écrivent un ordre de collecte déclenchent l’envoi immédiat', () => {
    expect(declencheuses.map((r) => r.chemin).sort()).toEqual([
      'v1/admin/attributions-ag/[collecteId]/auto-accept/route.ts',
      'v1/admin/attributions-ag/[collecteId]/valider/route.ts',
      'v1/admin/collectes/[id]/dispatch/route.ts',
      'v1/admin/collectes/[id]/incident/route.ts',
      'v1/admin/collectes/[id]/route.ts',
      'v1/admin/collectes/route.ts',
      'v1/admin/evenements/[id]/route.ts',
      'v1/agence/collectes/[id]/annulation/route.ts',
      'v1/agence/collectes/[id]/route.ts',
      'v1/gestionnaire/collectes/[id]/route.ts',
      'v1/programmation/evenements/[id]/collectes/route.ts',
      'v1/programmation/evenements/[id]/confirmer/route.ts',
      'v1/programmation/evenements/[id]/route.ts',
      'v1/programmation/evenements/route.ts',
      'v1/traiteur/collectes/[id]/annulation/route.ts',
      'v1/traiteur/collectes/[id]/route.ts',
    ]);
  });

  it('M1.5a/envoi_immediat_emetteurs_complets — toute route qui appelle une fonction émettrice, en direct ou par une enveloppe, déclenche l’envoi immédiat', () => {
    const emettrices = toutes.filter(
      (r) =>
        APPEL_RPC_EMETTEUR.test(r.source) || APPEL_ENVELOPPE.test(r.source),
    );

    expect(emettrices.length).toBeGreaterThan(0);
    expect(
      emettrices
        .filter((r) => !DECLENCHEUR.test(r.source))
        .map((r) => r.chemin),
    ).toEqual([]);
    // Et l'inverse : aucune route ne déclenche l'envoi sans rien émettre.
    expect(
      declencheuses.filter((r) => !emettrices.includes(r)).map((r) => r.chemin),
    ).toEqual([]);
  });

  it('M1.5a/envoi_immediat_enveloppes — hors des routes, seules les enveloppes connues appellent une fonction émettrice', () => {
    const horsRoutes = sources(RACINE_SRC)
      .filter((chemin) => !/(^|\/)route\.(ts|tsx|js|jsx)$/.test(chemin))
      .filter((chemin) => APPEL_RPC_EMETTEUR.test(readFileSync(chemin, 'utf8')))
      .map((chemin) => path.relative(RACINE_SRC, chemin))
      .sort();

    expect(horsRoutes).toEqual(Object.keys(ENVELOPPES).sort());
    for (const [fichier, fonction] of Object.entries(ENVELOPPES)) {
      expect(readFileSync(path.join(RACINE_SRC, fichier), 'utf8')).toContain(
        `export async function ${fonction}(`,
      );
    }
  });

  it('M1.5a/envoi_immediat_emetteurs_sql — la liste des fonctions émettrices est celle des migrations', () => {
    expect(emetteursDesMigrations()).toEqual(
      [...EMETTEURS_SQL, ...HORS_ENVOI_IMMEDIAT].sort(),
    );
  });

  it('M1.5a/frein_ecritures_routes_completes — toute route déclencheuse hors de l’espace Admin passe par le frein de débit, et chacune a sa preuve dans le tableau des routes', () => {
    const FREIN = /freinerEcritureCliente\(/;
    const admin = (r: { chemin: string }) => r.chemin.startsWith('v1/admin/');
    const clientes = declencheuses.filter((r) => !admin(r));

    expect(clientes).toHaveLength(9);
    expect(
      clientes.filter((r) => !FREIN.test(r.source)).map((r) => r.chemin),
    ).toEqual([]);
    // L'espace Admin n'est pas freiné.
    expect(
      declencheuses
        .filter((r) => admin(r) && FREIN.test(r.source))
        .map((r) => r.chemin),
    ).toEqual([]);
    // Le 429 de chaque route cliente est prouvé par son cas du tableau.
    const prouvees = new Set(
      CAS_CLIENTS.map((c) =>
        c.module.replace('@/app/api/', '').replace(/\.js$/, '.ts'),
      ),
    );
    expect(
      clientes.map((r) => r.chemin).filter((c) => !prouvees.has(c)),
    ).toEqual([]);
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

  it('M1.5a/envoi_immediat_appel_depuis_une_route — hors de leur propre lib, les déclencheurs ne sont appelés que depuis un fichier de route', () => {
    const appelants = sources(RACINE_SRC)
      .filter((chemin) => DECLENCHEUR.test(readFileSync(chemin, 'utf8')))
      .map((chemin) => path.relative(RACINE_SRC, chemin))
      .filter((chemin) => chemin !== 'lib/envoi-immediat.ts');

    expect(appelants.length).toBeGreaterThan(0);
    expect(
      appelants.filter((c) => !/(^|\/)route\.(ts|tsx|js|jsx)$/.test(c)),
    ).toEqual([]);
  });
});
