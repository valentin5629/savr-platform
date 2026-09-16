/**
 * Acceptation manuelle d'une mission Everest (failover Ops, Everest indisponible).
 *
 * §06.06 §3 Bloc 0 (arbitrage Val 2026-09-16) : la référence de mission
 * communiquée par A Toutes! est OBLIGATOIRE et s'écrit comme au dispatch normal.
 * Toutes les écritures passent par `fn_accepter_mission_everest_manuelle`
 * (transactionnelle) — la sémantique DB (tournée Everest visée, référence posée,
 * gate d'émission ouvert, atomicité, unicité) est prouvée par pgTAP dans
 * `supabase/tests/everest_acceptation_manuelle_reference.test.sql`. Ce fichier
 * prouve ce que seule la ROUTE fait : la validation de la saisie, les arguments
 * transmis à la RPC, et la traduction de ses refus en statuts HTTP sans fuite du
 * message Postgres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const COLLECTE = '11111111-2222-4333-8444-555555555555';

let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcResult: {
  data: unknown;
  error: { code?: string; message?: string } | null;
} = { data: { rejeu: false }, error: null };
let fromCalls: string[] = [];

vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: vi.fn(async () => ({
    ctx: { userId: 'ops-1', role: 'ops_savr', organisationId: null },
  })),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
    // Toute écriture directe contournerait l'atomicité de la RPC.
    from: (table: string) => {
      fromCalls.push(table);
      throw new Error(`écriture directe interdite : ${table}`);
    },
  }),
}));

function postReq(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/admin/everest/missions/manual-accept',
    {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

const SAISIE = {
  collecte_id: COLLECTE,
  reference_mission: 'EVR-TEL-001',
  contact_joint: 'Mathieu (A Toutes!)',
  heure_appel: '20:05',
  commentaire: 'Everest en 503 depuis 19h',
};

async function post(body: unknown) {
  const { POST } =
    await import('@/app/api/v1/admin/everest/missions/manual-accept/route.js');
  const res = await POST(postReq(body));
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls = [];
  fromCalls = [];
  rpcResult = { data: { rejeu: false }, error: null };
});

describe('M2.5 — acceptation manuelle : la référence de mission est obligatoire', () => {
  it('SANS référence → 422, et rien n’est écrit', async () => {
    const sansRef: Record<string, unknown> = { ...SAISIE };
    delete sansRef['reference_mission'];
    const r = await post(sansRef);

    expect(r.status).toBe(422);
    expect(r.body['champs_invalides']).toEqual(['reference_mission']);
    expect(rpcCalls).toHaveLength(0);
  });

  it.each([
    ['vide', ''],
    ['blancs seuls', '   '],
    ['espace interne (dictée au téléphone)', 'EVR 001'],
    ['saut de ligne', 'EVR-001\nx'],
    ['nombre au lieu d’une chaîne', 12345],
    ['65 caractères', 'A'.repeat(65)],
  ])('référence %s → 422', async (_cas, valeur) => {
    const r = await post({ ...SAISIE, reference_mission: valeur });

    expect(r.status).toBe(422);
    expect(r.body['champs_invalides']).toEqual(['reference_mission']);
    expect(rpcCalls).toHaveLength(0);
  });

  it('référence pile à 64 caractères → acceptée', async () => {
    const r = await post({ ...SAISIE, reference_mission: 'A'.repeat(64) });

    expect(r.status).toBe(200);
    expect(rpcCalls[0]!.args['p_reference']).toBe('A'.repeat(64));
  });

  it('contact joint absent → 422 (chk_everest_created_manually l’exige)', async () => {
    const r = await post({ ...SAISIE, contact_joint: '  ' });

    expect(r.status).toBe(422);
    expect(r.body['champs_invalides']).toEqual(['contact_joint']);
    expect(rpcCalls).toHaveLength(0);
  });

  it('collecte_id non UUID, heure mal formée → 422 listant chaque champ', async () => {
    const r = await post({
      ...SAISIE,
      collecte_id: 'pas-un-uuid',
      heure_appel: '25:00',
    });

    expect(r.status).toBe(422);
    expect(r.body['champs_invalides']).toEqual(['collecte_id', 'heure_appel']);
  });

  it('corps non JSON → 400', async () => {
    const r = await post('{pas du json');
    expect(r.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('M2.5 — acceptation manuelle : une seule RPC transactionnelle', () => {
  it('saisie valide → la RPC reçoit la référence NORMALISÉE, le contact et l’auteur', async () => {
    const r = await post({
      ...SAISIE,
      reference_mission: '  EVR-TEL-001  ',
      commentaire: '   ',
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      reference_mission: 'EVR-TEL-001',
      rejeu: false,
    });
    expect(rpcCalls).toEqual([
      {
        fn: 'fn_accepter_mission_everest_manuelle',
        args: {
          p_collecte_id: COLLECTE,
          p_reference: 'EVR-TEL-001',
          p_contact: 'Mathieu (A Toutes!)',
          p_commentaire: undefined,
          p_heure_appel: '20:05',
          p_user_id: 'ops-1',
          p_role: 'ops_savr',
        },
      },
    ]);
    // Aucune écriture hors RPC : l'ancienne route en faisait quatre, non atomiques.
    expect(fromCalls).toEqual([]);
  });

  it('rejeu (même référence) → 200 rejeu=true', async () => {
    rpcResult = { data: { rejeu: true }, error: null };
    const r = await post(SAISIE);

    expect(r.status).toBe(200);
    expect(r.body['rejeu']).toBe(true);
  });
});

describe('M2.5 — acceptation manuelle : refus de la RPC traduits sans fuite', () => {
  // La RPC lève ses refus métier en P0003 avec un libellé FR écrit par nous
  // (dont la référence déjà portée par une autre tournée —
  // `uniq_tournee_par_external_ref`, prouvé par pgTAP A7).
  it.each([
    'Une mission a déjà été créée chez Everest pour cette collecte : aucune acceptation manuelle nécessaire.',
    'Cette référence de mission est déjà enregistrée sur une autre collecte. Vérifiez la saisie.',
  ])('P0003 « %s » → 409, libellé transmis tel quel', async (libelle) => {
    rpcResult = { data: null, error: { code: 'P0003', message: libelle } };
    const r = await post(SAISIE);

    expect(r.status).toBe(409);
    expect(r.body['error']).toBe(libelle);
  });

  it('erreur Postgres système (23505 brut) → jamais le message ni le nom de contrainte', async () => {
    rpcResult = {
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "uniq_tournee_par_external_ref"',
      },
    };
    const r = await post(SAISIE);

    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('uniq_');
  });

  it('P0002 (collecte ou tournée A Toutes! introuvable) → 404 neutre', async () => {
    rpcResult = {
      data: null,
      error: { code: 'P0002', message: 'tournee_everest_introuvable' },
    };
    const r = await post(SAISIE);

    expect(r.status).toBe(404);
    expect(r.body['error']).toBe('Collecte ou tournée A Toutes! introuvable.');
  });

  it('erreur inattendue → 500 générique', async () => {
    rpcResult = {
      data: null,
      error: { code: '08006', message: 'connexion interrompue' },
    };
    const r = await post(SAISIE);

    expect(r.status).toBe(500);
    expect(r.body['error']).toBe('Erreur serveur');
  });
});
