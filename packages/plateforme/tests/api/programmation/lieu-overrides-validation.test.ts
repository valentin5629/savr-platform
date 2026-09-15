/**
 * Validation d'entrée de `collectes.lieu_overrides` sur les DEUX routes qui l'écrivent
 * (programmation d'événement + route support Admin).
 *
 * `lieu_overrides` est un jsonb libre : aucun schéma, aucun CHECK en base. Depuis
 * « transmettre lieu_overrides au transporteur », `adresse_acces` + `code_postal` +
 * `ville` composent l'adresse envoyée au transporteur par l'adapter logistique —
 * un override `{"adresse_acces":{"$ne":1},"ville":["a","b"],"code_postal":123}` produisait
 * l'adresse « [object Object], 123 a,b » et un camion sur une adresse impossible à
 * parser. Les clés sont bornées aux champs éditables §06.01 l.104, les valeurs à
 * leur type/longueur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

const mockRpc = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  rpc: mockRpc,
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
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

function setupAuth(
  role: string,
  organisationId = 'org-traiteur-1',
  userId = 'user-1',
): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: organisationId,
        }),
      },
    },
    error: null,
  });
}

function resetChain(): void {
  vi.clearAllMocks();
  mockSupabaseChain.from.mockReturnThis();
  mockSupabaseChain.select.mockReturnThis();
  mockSupabaseChain.insert.mockReturnThis();
  mockSupabaseChain.update.mockReturnThis();
  mockSupabaseChain.delete.mockReturnThis();
  mockSupabaseChain.in.mockReturnThis();
  mockSupabaseChain.eq.mockReturnThis();
}

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

const BODY_ZD = {
  pax: 80,
  type_evenement_id: 'type-1',
  lieu_id: 'lieu-1',
  contact_principal_nom: 'Jean Martin',
  contact_principal_telephone: '0612345678',
  nom_client_organisateur: 'Traiteur Dupont',
  controle_acces_requis: false,
  collectes: [
    { type: 'zd', date_collecte: '2030-01-15', heure_collecte: '08:00' },
  ],
  confirmer: true,
};

async function postProgrammation(
  lieu_overrides: unknown,
): Promise<NextResponse> {
  const { POST } =
    await import('@/app/api/v1/programmation/evenements/route.js');
  return POST(
    makeReq('POST', '/api/v1/programmation/evenements', {
      ...BODY_ZD,
      lieu_overrides,
    }),
  );
}

// ── Route de programmation ────────────────────────────────────────────────────
describe('lieu_overrides — validation d’entrée (POST /programmation/evenements)', () => {
  beforeEach(resetChain);

  it('refuse en 422 l’override qui composait « [object Object], 123 a,b » — sans rien écrire', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation({
      adresse_acces: { $ne: 1 },
      ville: ['a', 'b'],
      code_postal: 123,
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      champs_invalides: string[];
    };
    expect(body.champs_invalides.sort()).toEqual([
      'adresse_acces',
      'code_postal',
      'ville',
    ]);
    // Le refus intervient avant toute écriture : pas d'événement orphelin.
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('refuse une clé hors des champs éditables §06.01 (nom du lieu figé, colonnes admin-only)', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation({
      nom: 'Autre lieu',
      commentaire_lieu: 'interne',
      ville: 'Lyon',
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { champs_invalides: string[] };
    expect(body.champs_invalides.sort()).toEqual(['commentaire_lieu', 'nom']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('refuse une chaîne au-delà de la borne du champ', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation({ adresse_acces: 'a'.repeat(201) });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { champs_invalides: string[] };
    expect(body.champs_invalides).toEqual(['adresse_acces']);
  });

  it('refuse une valeur hors de l’enum de la colonne correspondante', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation({
      type_vehicule_max: 'tank',
      stationnement: 'impossible',
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { champs_invalides: string[] };
    expect(body.champs_invalides.sort()).toEqual([
      'stationnement',
      'type_vehicule_max',
    ]);
  });

  it('refuse le vide sur un champ NOT NULL en base (adresse effacée = adresse impossible)', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation({ adresse_acces: '   ' });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { champs_invalides: string[] };
    expect(body.champs_invalides).toEqual(['adresse_acces']);
  });

  it('refuse un caractère de contrôle — Postgres rejette \\u0000 en jsonb, on veut le 422 pas le 500', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation({ ville: 'Ly\u0000on' });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { champs_invalides: string[] };
    expect(body.champs_invalides).toEqual(['ville']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('refuse un lieu_overrides qui n’est pas un objet', async () => {
    setupAuth('traiteur_commercial');

    const res = await postProgrammation(['12 rue Neuve']);

    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('laisse passer un override légitime (chaînes, liste flux, « non renseigné ») normalisé', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // SIRET
      .mockResolvedValueOnce({ data: { email: 'prog@x.fr' }, error: null }); // récap
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', nom_evenement: 'Gala' },
      error: null,
    });
    mockRpc
      .mockResolvedValueOnce({ data: 'collecte-zd-1', error: null }) // fn_creer_collecte
      .mockResolvedValueOnce({ data: null, error: null }); // f_upsert_alerte_admin

    const res = await postProgrammation({
      adresse_acces: '  12 rue Neuve  ',
      flux_autorises: ['bio', 'carton'],
      type_vehicule_max: '',
    });

    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.objectContaining({
        p_lieu_overrides: {
          adresse_acces: '12 rue Neuve',
          flux_autorises: ['bio', 'carton'],
          type_vehicule_max: null,
        },
      }),
    );
  });
});

// ── Route support Admin ───────────────────────────────────────────────────────
describe('lieu_overrides — validation d’entrée (PATCH /admin/collectes/[id])', () => {
  beforeEach(resetChain);

  it('refuse en 422 les valeurs non-chaînes — fn_modifier_collecte n’est pas appelée', async () => {
    setupAuth('admin_savr');

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        lieu_overrides: { ville: ['a', 'b'], code_postal: 123 },
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { champs_invalides: string[] };
    expect(body.champs_invalides.sort()).toEqual(['code_postal', 'ville']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('refuse une clé hors des champs éditables §06.01', async () => {
    setupAuth('admin_savr');

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        lieu_overrides: { siren: '123456789' },
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('laisse passer un override légitime jusqu’à fn_modifier_collecte', async () => {
    setupAuth('admin_savr');
    mockSingle.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'programmee' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'programmee' },
      error: null,
    });

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        lieu_overrides: { ville: 'Lyon', acces_office: 'difficile' },
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_modifier_collecte',
      expect.objectContaining({
        p_updates: {
          lieu_overrides: { ville: 'Lyon', acces_office: 'difficile' },
        },
      }),
    );
  });
});
