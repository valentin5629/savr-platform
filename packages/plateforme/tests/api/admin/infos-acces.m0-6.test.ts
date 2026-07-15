/**
 * M0.6 — PATCH /api/v1/admin/collectes/[id]/infos-acces (saisie manuelle Admin
 * des infos accès chauffeur). Vérifie : garde staff, 404 collecte, 422 body vide /
 * tournee_id hors périmètre, écriture + déclenchement de l'email de complétude.
 * Mock keyé par table + mock du helper d'envoi (décision Val 2026-07-15).
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
      insert: () => c,
      update: () => c,
      maybeSingle: () => Promise.resolve(res()),
      single: () => Promise.resolve(res()),
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  return { from: (t: string) => chain(t), results };
}

let admin = makeClient();
const mockRequireStaff = vi.fn();
const mockEvaluer = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: (...a: unknown[]) => mockRequireStaff(...a),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@/lib/infos-acces/notify.js', () => ({
  evaluerInfosAccesEtEnvoyer: (...a: unknown[]) => mockEvaluer(...a),
}));

import { PATCH } from '@/app/api/v1/admin/collectes/[id]/infos-acces/route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/admin/collectes/coll-1/infos-acces',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
const ctx = { params: Promise.resolve({ id: 'coll-1' }) };

beforeEach(() => {
  admin = makeClient();
  mockRequireStaff.mockReset();
  mockEvaluer.mockReset();
  mockRequireStaff.mockResolvedValue({
    ctx: { userId: 'u-1', role: 'admin_savr' },
  });
  mockEvaluer.mockResolvedValue({ envoye: false });
});

describe('M0.6 / PATCH infos-acces — garde staff + validation', () => {
  it('non-staff → renvoie l’erreur d’auth', async () => {
    const errResp = new Response('nope', { status: 403 });
    mockRequireStaff.mockResolvedValue({ error: errResp });
    const res = await PATCH(makeReq({ tournees: [] }), ctx);
    expect(res.status).toBe(403);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });

  it('body sans tournees → 422', async () => {
    const res = await PATCH(makeReq({}), ctx);
    expect(res.status).toBe(422);
  });

  it('collecte introuvable → 404', async () => {
    admin.results['collectes'] = { data: null, error: { code: 'PGRST116' } };
    const res = await PATCH(
      makeReq({ tournees: [{ tournee_id: 'T1', chauffeur_nom: 'X' }] }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('tournee_id hors périmètre de la collecte → 422', async () => {
    admin.results['collectes'] = {
      data: { id: 'coll-1', controle_acces_requis: true },
      error: null,
    };
    admin.results['collecte_tournees'] = {
      data: [{ tournee_id: 'T1', tournees: {} }],
      error: null,
    };
    const res = await PATCH(
      makeReq({ tournees: [{ tournee_id: 'T-INCONNU', chauffeur_nom: 'X' }] }),
      ctx,
    );
    expect(res.status).toBe(422);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });
});

describe('M0.6 / PATCH infos-acces — écriture + email de complétude', () => {
  it('saisie valide → 200, ré-évalue la complétude et remonte email_envoye', async () => {
    admin.results['collectes'] = {
      data: { id: 'coll-1', controle_acces_requis: true },
      error: null,
    };
    admin.results['collecte_tournees'] = {
      data: [{ tournee_id: 'T1', tournees: { id: 'T1' } }],
      error: null,
    };
    admin.results['tournees'] = { data: null, error: null };
    mockEvaluer.mockResolvedValue({ envoye: true });

    const res = await PATCH(
      makeReq({
        tournees: [
          {
            tournee_id: 'T1',
            chauffeur_nom: 'Jean',
            chauffeur_telephone: '0611',
          },
        ],
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email_envoye: boolean };
    expect(body.email_envoye).toBe(true);
    expect(mockEvaluer).toHaveBeenCalledWith(expect.anything(), 'coll-1');
  });

  it('aucun champ modifiable fourni → 422 (avant tout envoi)', async () => {
    admin.results['collectes'] = {
      data: { id: 'coll-1', controle_acces_requis: true },
      error: null,
    };
    admin.results['collecte_tournees'] = {
      data: [{ tournee_id: 'T1', tournees: { id: 'T1' } }],
      error: null,
    };
    const res = await PATCH(makeReq({ tournees: [{ tournee_id: 'T1' }] }), ctx);
    expect(res.status).toBe(422);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });
});
