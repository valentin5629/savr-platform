/**
 * M1.1b — Tests API /admin/collectes (liste, fiche, dispatch, création)
 * Scénarios P1 critiques : dispatch 409/403/422, outbox G4 via RPC atomique.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockInsertChain = { select: vi.fn().mockReturnThis(), single: vi.fn() };
const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn(() => mockInsertChain),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
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

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

// ── Dispatch ───────────────────────────────────────────────────────────────

describe('M1.1b / Dispatch / Statuts terminaux', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const statut of [
    'realisee',
    'cloturee',
    'annulee',
    'realisee_sans_collecte',
  ]) {
    it(`M1.1b/dispatch — 409 si statut=${statut}`, async () => {
      setupAuth('admin_savr');
      mockSupabaseChain.single.mockResolvedValueOnce({
        data: {
          id: 'col-1',
          statut,
          statut_tms: 'envoye',
          tms_reference: 'ref-1',
          type: 'zd',
          date_collecte: '2026-07-01',
          dirty_tms: false,
          prestataire_logistique_id: null,
        },
        error: null,
      });
      const { POST } =
        await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {}),
        {
          params: Promise.resolve({ id: 'col-1' }),
        },
      );
      expect(res.status).toBe(409);
    });
  }
});

describe('M1.1b / Dispatch / Permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/dispatch — 403 si ops tente override prestataire', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        type: 'zd',
        date_collecte: '2026-07-01',
        dirty_tms: false,
        prestataire_logistique_id: 'prest-old',
      },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {
        prestataire_logistique_id: 'prest-new',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1b/dispatch — 422 si override sans motif suffisant', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        type: 'zd',
        date_collecte: '2026-07-01',
        dirty_tms: false,
        prestataire_logistique_id: 'prest-old',
      },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {
        prestataire_logistique_id: 'prest-new',
        motif_override_prestataire: 'ok', // < 5 chars
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M1.1b/dispatch — 422 si override sans motif du tout', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        type: 'zd',
        date_collecte: '2026-07-01',
        dirty_tms: false,
        prestataire_logistique_id: 'prest-old',
      },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {
        prestataire_logistique_id: 'prest-new',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(422);
  });
});

// ZD (décision Val 2026-10-07, C1) — l'Admin choisit le prestataire sur la fiche.
// Avant, rien ne posait de prestataire sur une ZD : « Envoyer » émettait un
// ordre que le worker classait « rien à envoyer ».
describe('M0.6 / Dispatch ZD / choix du prestataire par l’Admin', () => {
  beforeEach(() => vi.clearAllMocks());

  const collecteZd = (
    prestataire: string | null,
    over: Record<string, unknown> = {},
  ) => ({
    data: {
      id: 'col-1',
      statut: 'programmee',
      statut_tms: 'non_envoye',
      tms_reference: null,
      type: 'zero_dechet',
      date_collecte: '2026-07-01',
      dirty_tms: false,
      prestataire_logistique_id: prestataire,
      ...over,
    },
    error: null,
  });
  // Transporteur résolu depuis le prestataire choisi (validation serveur).
  const transporteur = (t: { type_tms: string; actif: boolean } | null) =>
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: t,
      error: null,
    });
  const dispatch = async (body: Record<string, unknown>) => {
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    return POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', body),
      {
        params: Promise.resolve({ id: 'col-1' }),
      },
    );
  };

  // Besoin véhicule saisi au choix du prestataire (décision Val 2026-10-27).
  it('besoin véhicule : nombre puis type écrits AVANT l’event de dispatch', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd(null));
    transporteur({ type_tms: 'mts1', actif: true });
    mockSupabaseChain.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: 'collecte.creee', error: null });

    const res = await dispatch({
      prestataire_logistique_id: 'prest-strike',
      nb_camions_demande: 3,
      type_vehicule_souhaite: 'fourgon',
    });

    expect(res.status).toBe(200);
    const appels = mockSupabaseChain.rpc.mock.calls.map((c) => c[0]);
    expect(appels).toEqual(['fn_modifier_collecte', 'fn_dispatcher_collecte']);
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith('fn_modifier_collecte', {
      p_id: 'col-1',
      p_updates: { nb_camions_demande: 3 },
      p_champs_modifies: ['nb_camions_demande'],
    });
    expect(mockSupabaseChain.update).toHaveBeenCalledWith({
      type_vehicule_souhaite: 'fourgon',
    });
    expect(mockSupabaseChain.in).toHaveBeenCalledWith('statut', [
      'programmee',
      'rejetee_par_prestataire',
    ]);
  });

  it('besoin véhicule hors bornes : 422 sans rien écrire', async () => {
    setupAuth('admin_savr');
    const res = await dispatch({
      prestataire_logistique_id: 'prest-strike',
      nb_camions_demande: 21,
    });
    expect(res.status).toBe(422);
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
  });

  it('besoin véhicule sur une collecte déjà validée : 409 sans rien écrire', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(
      collecteZd('prest-strike', { statut: 'validee' }),
    );
    const res = await dispatch({ type_vehicule_souhaite: 'fourgon' });
    expect(res.status).toBe(409);
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
  });

  it('M0.6/dispatch_zd_sans_prestataire_refuse — ni prestataire choisi ni prestataire posé : 422, aucun ordre émis', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd(null));

    const res = await dispatch({});

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /Choisissez d'abord le prestataire logistique/,
    );
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it('M0.6/dispatch_zd_choix_prestataire — premier choix : sans motif, ouvert à ops, prestataire transmis à la RPC', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd(null));
    transporteur({ type_tms: 'mts1', actif: true });
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    });

    const res = await dispatch({ prestataire_logistique_id: 'prest-strike' });

    expect(res.status).toBe(200);
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
      'fn_dispatcher_collecte',
      {
        p_id: 'col-1',
        p_prestataire_logistique_id: 'prest-strike',
        p_motif_override: null,
      },
    );
  });

  it('M0.6/dispatch_zd_changement_motif — changer un prestataire déjà posé : motif exigé, message propre à la ZD', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd('prest-strike'));
    transporteur({ type_tms: 'mts1', actif: true });

    const res = await dispatch({ prestataire_logistique_id: 'prest-marathon' });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /pour changer le prestataire déjà attribué/,
    );
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it('M0.6/dispatch_zd_a_toutes_refuse — A Toutes! choisie pour une ZD : 422, aucun ordre émis (son envoi exige une association AG)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd(null));
    transporteur({ type_tms: 'a_toutes', actif: true });

    const res = await dispatch({ prestataire_logistique_id: 'prest-atoutes' });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /A Toutes! ne prend pas en charge les collectes Zéro Déchet/,
    );
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['inconnu du référentiel', null],
    ['désactivé', { type_tms: 'mts1', actif: false }],
  ])('prestataire %s : 422, aucun ordre émis', async (_cas, t) => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd(null));
    transporteur(t);

    const res = await dispatch({ prestataire_logistique_id: 'prest-x' });

    expect(res.status).toBe(422);
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it('M0.6/dispatch_zd_commande_en_cours — changer de prestataire sur une ZD déjà commandée : 409, la commande n’est pas déplacée', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(
      collecteZd('prest-strike', {
        statut_tms: 'attribuee_en_attente_acceptation',
        tms_reference: 'TOUR-77',
      }),
    );

    const res = await dispatch({
      prestataire_logistique_id: 'prest-marathon',
      motif_override_prestataire: 'Strike indisponible',
    });

    expect(res.status).toBe(409);
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it('réattribution après rejet du prestataire : changement admis malgré la référence de l’ancienne commande', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(
      collecteZd('prest-strike', {
        statut: 'rejetee_par_prestataire',
        statut_tms: 'rejetee_par_prestataire',
        tms_reference: 'TOUR-77',
      }),
    );
    transporteur({ type_tms: 'mts1', actif: true });
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    });

    const res = await dispatch({
      prestataire_logistique_id: 'prest-marathon',
      motif_override_prestataire: 'Strike a refusé la collecte',
    });

    expect(res.status).toBe(200);
  });

  it('collecte en demande d’annulation : choix d’un prestataire refusé (409)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(
      collecteZd(null, { statut: 'annulation_demandee' }),
    );

    const res = await dispatch({ prestataire_logistique_id: 'prest-strike' });

    expect(res.status).toBe(409);
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it('même prestataire renvoyé dans le corps : ni changement ni motif, ouvert à ops', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd('prest-strike'));
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    });

    const res = await dispatch({ prestataire_logistique_id: 'prest-strike' });

    expect(res.status).toBe(200);
    // Aucune résolution de transporteur : rien n'est choisi de nouveau.
    expect(mockSupabaseChain.maybeSingle).not.toHaveBeenCalled();
  });

  it('renvoi chez le prestataire déjà posé (corps vide) : réémission sans motif', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce(collecteZd('prest-strike'));
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    });

    const res = await dispatch({});

    expect(res.status).toBe(200);
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
      'fn_dispatcher_collecte',
      expect.objectContaining({ p_prestataire_logistique_id: null }),
    );
  });
});

// BL-P1-BOA-06 (Val 2026-07-02) — Bloc 0 AG : le motif override est obligatoire
// UNIQUEMENT si le prestataire choisi ≠ top-1 de l'algo (calculé serveur), pas ≠
// prestataire actuel. Valider le top-1 = 0 motif.
describe('M0.6 / Dispatch AG / motif override vs top-1 algo', () => {
  beforeEach(() => vi.clearAllMocks());

  const collecteAg = {
    id: 'col-ag',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    tms_reference: null,
    type: 'anti_gaspi',
    date_collecte: '2026-07-01',
    dirty_tms: false,
    prestataire_logistique_id: null,
  };
  // top-1 algo = transporteur t-top1 (→ prestataire presta-top1)
  const algoReco = {
    transporteur: { id: 't-top1', nom: 'Strike', type_tms: 'mts1' },
    associations: [],
    assoc_count: 0,
    branche: 'idf',
    is_idf: true,
    no_asso: false,
    no_prestataire: false,
    delai_minutes: 60,
    nb_pax: 80,
  };

  // AG : l'association est choisie AVANT le prestataire (décision Val 2026-10-01)
  // — son adresse est le point B transmis par l'adapter. Sans attribution, 422.
  it('M0.6/dispatch AG — 422 si aucune association attribuée (adresse de livraison inconnue)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: collecteAg,
      error: null,
    }); // collecte
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    }); // attributions_antgaspi : aucune
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-ag/dispatch', {
        prestataire_logistique_id: 'presta-top1',
      }),
      { params: Promise.resolve({ id: 'col-ag' }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/association/i);
    // Rien ne part : ni algo, ni fn_dispatcher_collecte.
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalled();
  });

  it('M0.6/dispatch AG — 422 si prestataire ≠ top-1 algo sans motif', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { association_id: 'asso-1' },
      error: null,
    }); // attributions_antgaspi : association attribuée
    mockSupabaseChain.single
      .mockResolvedValueOnce({ data: collecteAg, error: null }) // collecte
      .mockResolvedValueOnce({
        data: { prestataire_logistique_id: 'presta-top1' },
        error: null,
      }); // transporteur top-1
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: algoReco,
      error: null,
    }); // algo
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-ag/dispatch', {
        prestataire_logistique_id: 'presta-AUTRE',
      }),
      { params: Promise.resolve({ id: 'col-ag' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M0.6/dispatch AG — accepte le top-1 algo SANS motif (200)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { association_id: 'asso-1' },
      error: null,
    }); // attributions_antgaspi : association attribuée
    mockSupabaseChain.single
      .mockResolvedValueOnce({ data: collecteAg, error: null }) // collecte
      .mockResolvedValueOnce({
        data: { prestataire_logistique_id: 'presta-top1' },
        error: null,
      }); // transporteur top-1
    mockSupabaseChain.rpc
      .mockResolvedValueOnce({ data: algoReco, error: null }) // algo
      .mockResolvedValueOnce({ data: 'collecte.creee', error: null }); // dispatcher
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-ag/dispatch', {
        prestataire_logistique_id: 'presta-top1',
      }),
      { params: Promise.resolve({ id: 'col-ag' }) },
    );
    expect(res.status).toBe(200);
  });
});

// Décision Val 2026-11-03 : AG envoyée à A Toutes! alors que la branche retenue
// (Marathon) ne désigne aucun de ses services → l'Admin choisit le service,
// rangé comme branche retenue avant l'ordre d'envoi (cas du 2026-11-02).
describe('M0.6 / Dispatch AG / service du transporteur forcé', () => {
  beforeEach(() => vi.clearAllMocks());

  const collecteAg = {
    id: 'col-ag',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    tms_reference: null,
    type: 'anti_gaspi',
    date_collecte: '2026-07-01',
    dirty_tms: false,
    prestataire_logistique_id: 'presta-marathon',
  };

  function monter() {
    setupAuth('admin_savr');
    mockSupabaseChain.single
      .mockResolvedValueOnce({ data: collecteAg, error: null }) // collecte
      .mockResolvedValueOnce({
        data: { prestataire_logistique_id: 'presta-marathon' },
        error: null,
      }); // transporteur top-1
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'attr-1', branche_attribution: 'ag_marathon_volume' },
      error: null,
    }); // attribution validée, branche Marathon
    mockSupabaseChain.limit.mockResolvedValueOnce({
      data: [{ type_tms: 'a_toutes' }],
      error: null,
    } as never); // transporteur visé = A Toutes!
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: {
        transporteur: { id: 't-marathon', nom: 'Marathon', type_tms: 'mts1' },
        associations: [],
        assoc_count: 0,
        branche: 'ag_marathon_volume',
        is_idf: true,
        no_asso: false,
        no_prestataire: false,
        delai_minutes: 600,
        nb_pax: 2000,
      },
      error: null,
    }); // algo
  }

  it('M0.6/dispatch_service_a_toutes — sans service choisi : 422, rien n’est écrit ni envoyé', async () => {
    monter();
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-ag/dispatch', {
        prestataire_logistique_id: 'presta-atoutes',
        motif_override_prestataire: 'Marathon indisponible',
      }),
      { params: Promise.resolve({ id: 'col-ag' }) },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /Choisissez le service du transporteur/,
    );
    expect(mockSupabaseChain.eq).toHaveBeenCalledWith(
      'prestataire_logistique_id',
      'presta-atoutes',
    );
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
    expect(mockSupabaseChain.rpc).not.toHaveBeenCalledWith(
      'fn_dispatcher_collecte',
      expect.anything(),
    );
  });

  it('M0.6/dispatch_service_a_toutes — service choisi : rangé comme branche, audité, puis l’ordre part', async () => {
    monter();
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    }); // dispatcher
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-ag/dispatch', {
        prestataire_logistique_id: 'presta-atoutes',
        motif_override_prestataire: 'Marathon indisponible',
        branche_attribution: 'ag_marathon_volume_backup_camion',
      }),
      { params: Promise.resolve({ id: 'col-ag' }) },
    );
    expect(res.status).toBe(200);
    expect(mockSupabaseChain.update).toHaveBeenCalledWith({
      branche_attribution: 'ag_marathon_volume_backup_camion',
    });
    expect(mockSupabaseChain.eq).toHaveBeenCalledWith('id', 'attr-1');
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SERVICE_TRANSPORTEUR',
        old_values: { branche_attribution: 'ag_marathon_volume' },
        new_values: { branche_attribution: 'ag_marathon_volume_backup_camion' },
      }),
    );
    const noms = mockSupabaseChain.rpc.mock.calls.map((c) => c[0]);
    expect(noms).toContain('fn_dispatcher_collecte');
    // Rangé AVANT l'ordre d'envoi : l'adapter lit la branche à la consommation.
    expect(mockSupabaseChain.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockSupabaseChain.rpc.mock.invocationCallOrder[
        noms.indexOf('fn_dispatcher_collecte')
      ]!,
    );
  });

  it('un service qui n’est pas celui du transporteur visé est refusé (422)', async () => {
    monter();
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-ag/dispatch', {
        prestataire_logistique_id: 'presta-atoutes',
        motif_override_prestataire: 'Marathon indisponible',
        branche_attribution: 'ag_marathon_nuit',
      }),
      { params: Promise.resolve({ id: 'col-ag' }) },
    );
    expect(res.status).toBe(422);
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
  });
});

describe('M1.1b / Dispatch / Outbox G4', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/dispatch — émet E1 collecte.creee sur premier envoi (via RPC atomique)', async () => {
    setupAuth('admin_savr');
    // Validation : collecte non terminale, tms_reference null = premier envoi
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        type: 'zd',
        date_collecte: '2026-07-01',
        dirty_tms: false,
        prestataire_logistique_id: null,
      },
      error: null,
    });
    // RPC fn_dispatcher_collecte → retourne event_type
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {
        prestataire_logistique_id: 'prest-choisi',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event_type: string };
    expect(body.event_type).toBe('collecte.creee');
    // G4 : RPC atomique appelé (pas deux appels séparés)
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
      'fn_dispatcher_collecte',
      expect.objectContaining({ p_id: 'col-1' }),
    );
  });

  it('M1.1b/dispatch — émet E2 collecte.modifiee si tms_reference présente (via RPC atomique)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-2',
        statut: 'validee',
        statut_tms: 'envoye',
        tms_reference: 'REF-123',
        type: 'ag',
        date_collecte: '2026-07-02',
        dirty_tms: true,
        prestataire_logistique_id: null,
      },
      error: null,
    });
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.modifiee',
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-2/dispatch', {}),
      { params: Promise.resolve({ id: 'col-2' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event_type: string };
    expect(body.event_type).toBe('collecte.modifiee');
  });

  it('M1.1b/dispatch — 404 si collecte inconnue', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/bad-id/dispatch', {}),
      { params: Promise.resolve({ id: 'bad-id' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('M1.1b / Collectes / Liste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/collectes/liste — 200 avec chip non_transmises (filtre tms_reference IS NULL)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [],
      count: 0,
      error: null,
    });
    const { GET } = await import('@/app/api/v1/admin/collectes/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/collectes?chip=non_transmises'),
    );
    expect(res.status).toBe(200);
    // Le filtre .is('tms_reference', null) doit être appelé
    expect(mockSupabaseChain.is).toHaveBeenCalledWith('tms_reference', null);
  });
});

describe('M1.1b / Collectes / Création', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/collectes/create — 422 si champs obligatoires manquants', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes', { evenement_id: 'evt-1' }),
    );
    expect(res.status).toBe(422);
  });

  it('M1.1b/collectes/create — outbox E1 atomique via fn_creer_collecte', async () => {
    setupAuth('admin_savr');

    // RPC fn_creer_collecte → retourne collecte_id
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'col-new',
      error: null,
    });
    // SELECT collecte après création (retourne la fiche complète)
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-new',
        type: 'zd',
        date_collecte: '2026-07-01',
        statut: 'programmee',
      },
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes', {
        evenement_id: 'evt-1',
        type: 'zd',
        date_collecte: '2026-07-01',
        heure_collecte: '09:00',
      }),
    );
    expect(res.status).toBe(201);
    // G4 : fn_creer_collecte appelée (INSERT + outbox E1 atomiques)
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.objectContaining({
        p_evenement_id: 'evt-1',
        p_type: 'zd',
        p_date_collecte: '2026-07-01',
      }),
    );
    // BL-P0-01 : plus de pré-création de lignes collecte_flux (colonnes fantômes
    // code_flux/poids_kg supprimées) — les pesées sont dérivées de pesees_tournees
    // ou saisies via PATCH /flux. Pré-créer 5 lignes NULL casserait le gate batch.
    expect(mockSupabaseChain.from).not.toHaveBeenCalledWith('collecte_flux');
  });
});
