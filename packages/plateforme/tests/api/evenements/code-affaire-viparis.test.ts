/**
 * Code affaire VIPARIS de l'événement (Val 2026-11-02) :
 * PATCH /api/v1/evenements/[id]/code-affaire-viparis.
 *
 *  · écrit par l'équipe Savr, l'organisation qui a programmé l'événement
 *    (traiteur, agence, gestionnaire) et le gestionnaire du lieu (VIPARIS) ;
 *    jamais par le traiteur opérationnel tiers ni le client organisateur (§04) ;
 *  · visibilité d'un client jugée sous SA RLS (404 sinon), écriture ensuite en
 *    service-role, de la seule colonne du code ;
 *  · format 7 caractères alphanumériques, normalisé ; vide = effacé ;
 *  · trace dans audit_log, aucun ordre au prestataire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeClient } from '../helpers/fiche-client-mock';

let rls = makeClient();
let admin = makeClient();
const mockRequireAnyUser = vi.fn();
const mockFrein = vi.fn();
const mockEnvoi = vi.fn();

vi.mock('@/lib/api-auth.js', async (orig) => ({
  ...(await orig<typeof import('@/lib/api-auth.js')>()),
  requireAnyUser: (...a: unknown[]) => mockRequireAnyUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@/lib/frein-ecritures-client.js', () => ({
  freinerEcritureCliente: (...a: unknown[]) => mockFrein(...a),
}));
vi.mock('@/lib/envoi-immediat.js', () => ({
  envoyerOrdresSansAttendre: (...a: unknown[]) => mockEnvoi(...a),
  envoyerOrdresEvenementSansAttendre: (...a: unknown[]) => mockEnvoi(...a),
}));

function utilisateur(role: string, organisationId: string | null = 'org-1') {
  mockRequireAnyUser.mockResolvedValue({
    ctx: {
      userId: 'user-1',
      role,
      organisationId,
      isStaff: role === 'admin_savr' || role === 'ops_savr',
    },
  });
}

async function patch(corps: unknown, id = 'e1') {
  const { PATCH } =
    await import('@/app/api/v1/evenements/[id]/code-affaire-viparis/route.js');
  const res = await PATCH(
    new NextRequest(
      `http://localhost/api/v1/evenements/${id}/code-affaire-viparis`,
      {
        method: 'PATCH',
        body: JSON.stringify(corps),
        headers: { 'content-type': 'application/json' },
      },
    ),
    { params: Promise.resolve({ id }) },
  );
  return { res, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockFrein.mockReturnValue(null);
  rls.results.evenements = { data: { id: 'e1' }, error: null };
  admin.results.evenements = {
    data: {
      code_affaire_viparis: null,
      organisation_id: 'org-1',
      lieu_id: 'l1',
    },
    error: null,
  };
});

describe('Code affaire VIPARIS — qui écrit', () => {
  it.each([
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
  ])(
    'VIPARIS/code_affaire_client_%s — sur sa propre programmation : code écrit en service-role',
    async (role) => {
      utilisateur(role);
      const { res, json } = await patch({ code_affaire_viparis: '26SIAL1' });
      expect(res.status).toBe(200);
      expect(json.data).toEqual({ id: 'e1', code_affaire_viparis: '26SIAL1' });
      // Visibilité jugée sous l'identité de l'utilisateur.
      expect(rls.calls).toEqual(['evenements']);
      expect(rls.eqs.evenements).toEqual([['id', 'e1']]);
      // Écriture de la seule colonne du code (+ horodatage), sur CET événement.
      const maj = admin.updates.filter((u) => u.table === 'evenements');
      expect(maj).toHaveLength(1);
      expect(Object.keys(maj[0]!.row as object).sort()).toEqual([
        'code_affaire_viparis',
        'updated_at',
      ]);
      expect(admin.eqs.evenements).toContainEqual(['id', 'e1']);
      // Frein des écritures clientes, sur l'identifiant rendu par la base.
      expect(mockFrein).toHaveBeenCalledWith({
        organisationId: 'org-1',
        equipeSavr: false,
        modification: { evenement: 'e1' },
      });
    },
  );

  it.each(['traiteur_manager', 'traiteur_commercial', 'agence'])(
    'VIPARIS/code_affaire_tiers_refuse_%s — événement d’un tiers visible sous sa RLS (traiteur opérationnel) : 403, rien n’est écrit',
    async (role) => {
      utilisateur(role);
      admin.results.evenements = {
        data: {
          code_affaire_viparis: '25SIAL9',
          organisation_id: 'org-tiers',
          lieu_id: 'l1',
        },
        error: null,
      };
      const { res } = await patch({ code_affaire_viparis: '26SIAL1' });
      expect(res.status).toBe(403);
      expect(admin.updates).toEqual([]);
      expect(admin.inserts).toEqual([]);
      // Le rattachement à un lieu ne vaut que pour un gestionnaire.
      expect(admin.calls).not.toContain('organisations_lieux');
      expect(mockFrein).not.toHaveBeenCalled();
    },
  );

  it('VIPARIS/code_affaire_gestionnaire_du_lieu — événement d’un traiteur tiers sur SON lieu : code écrit', async () => {
    utilisateur('gestionnaire_lieux');
    admin.results.evenements = {
      data: {
        code_affaire_viparis: null,
        organisation_id: 'org-tiers',
        lieu_id: 'l1',
      },
      error: null,
    };
    admin.results.organisations_lieux = {
      data: { lieu_id: 'l1' },
      error: null,
    };
    const { res, json } = await patch({ code_affaire_viparis: '26SIAL1' });
    expect(res.status).toBe(200);
    expect(json.data).toEqual({ id: 'e1', code_affaire_viparis: '26SIAL1' });
    // Rattachement lu pour SON organisation et le lieu DE l'événement.
    expect(admin.eqs.organisations_lieux).toEqual([
      ['organisation_id', 'org-1'],
      ['lieu_id', 'l1'],
    ]);
    expect(admin.updates.filter((u) => u.table === 'evenements')).toHaveLength(
      1,
    );
  });

  it('VIPARIS/code_affaire_gestionnaire_hors_parc — événement d’un tiers sur un lieu qu’il ne gère pas : 403', async () => {
    utilisateur('gestionnaire_lieux');
    admin.results.evenements = {
      data: {
        code_affaire_viparis: null,
        organisation_id: 'org-tiers',
        lieu_id: 'l2',
      },
      error: null,
    };
    admin.results.organisations_lieux = { data: null, error: null };
    const { res } = await patch({ code_affaire_viparis: '26SIAL1' });
    expect(res.status).toBe(403);
    expect(admin.updates).toEqual([]);
    expect(admin.inserts).toEqual([]);
  });

  it('VIPARIS/code_affaire_gestionnaire_erreur_lecture — rattachement illisible : 500, rien n’est écrit', async () => {
    utilisateur('gestionnaire_lieux');
    admin.results.evenements = {
      data: {
        code_affaire_viparis: null,
        organisation_id: 'org-tiers',
        lieu_id: 'l1',
      },
      error: null,
    };
    admin.results.organisations_lieux = {
      data: null,
      error: { code: '42501', message: 'refus' },
    };
    const { res } = await patch({ code_affaire_viparis: '26SIAL1' });
    expect(res.status).toBe(500);
    expect(admin.updates).toEqual([]);
  });

  it('VIPARIS/code_affaire_client_organisateur_refuse — 403, aucune lecture ni écriture', async () => {
    utilisateur('client_organisateur');
    const { res } = await patch({ code_affaire_viparis: '26SIAL1' });
    expect(res.status).toBe(403);
    expect(rls.calls).toEqual([]);
    expect(admin.calls).toEqual([]);
  });

  it('VIPARIS/code_affaire_invisible_404 — événement hors de sa RLS : 404, rien n’est écrit', async () => {
    utilisateur('gestionnaire_lieux');
    rls.results.evenements = { data: null, error: null };
    const { res } = await patch({ code_affaire_viparis: '26SIAL1' });
    expect(res.status).toBe(404);
    expect(admin.updates).toEqual([]);
    expect(admin.inserts).toEqual([]);
  });

  it('VIPARIS/code_affaire_staff — équipe Savr : existence lue en service-role, jamais freinée', async () => {
    utilisateur('admin_savr', null);
    // Événement d'une autre organisation : le staff écrit partout.
    admin.results.evenements = {
      data: {
        id: 'e1',
        code_affaire_viparis: null,
        organisation_id: 'org-tiers',
        lieu_id: 'l1',
      },
      error: null,
    };
    const { res } = await patch({ code_affaire_viparis: '26SIAL1' });
    expect(res.status).toBe(200);
    expect(rls.calls).toEqual([]);
    expect(mockFrein).toHaveBeenCalledWith(
      expect.objectContaining({ equipeSavr: true }),
    );
  });
});

describe('Code affaire VIPARIS — format et effets', () => {
  it('VIPARIS/code_affaire_normalise — espaces retirés, majuscules', async () => {
    utilisateur('traiteur_manager');
    const { json } = await patch({ code_affaire_viparis: ' 26sial1 ' });
    expect(json.data).toEqual({ id: 'e1', code_affaire_viparis: '26SIAL1' });
  });

  it.each(['26SIAL', '26SIAL12', '26-SIA1', 42])(
    'VIPARIS/code_affaire_format_invalide — %s : 422, rien n’est lu ni écrit',
    async (code) => {
      utilisateur('traiteur_manager');
      const { res } = await patch({ code_affaire_viparis: code });
      expect(res.status).toBe(422);
      expect(rls.calls).toEqual([]);
      expect(admin.calls).toEqual([]);
    },
  );

  it('VIPARIS/code_affaire_champ_absent — 422', async () => {
    utilisateur('traiteur_manager');
    const { res } = await patch({});
    expect(res.status).toBe(422);
  });

  it('VIPARIS/code_affaire_efface — chaîne vide : code remis à null', async () => {
    utilisateur('gestionnaire_lieux');
    const { json } = await patch({ code_affaire_viparis: '' });
    expect(json.data).toEqual({ id: 'e1', code_affaire_viparis: null });
    const maj = admin.updates.find((u) => u.table === 'evenements');
    expect((maj!.row as Record<string, unknown>).code_affaire_viparis).toBe(
      null,
    );
  });

  it('VIPARIS/code_affaire_trace_sans_ordre — audit_log écrit, aucun envoi au prestataire', async () => {
    utilisateur('gestionnaire_lieux');
    admin.results.evenements = {
      data: {
        code_affaire_viparis: '25SIAL9',
        organisation_id: 'org-1',
        lieu_id: 'l1',
      },
      error: null,
    };
    await patch({ code_affaire_viparis: '26SIAL1' });
    const trace = admin.inserts.find((i) => i.table === 'audit_log');
    expect(trace?.row).toMatchObject({
      table_name: 'evenements',
      record_id: 'e1',
      action: 'UPDATE',
      user_id: 'user-1',
      role: 'gestionnaire_lieux',
      old_values: { code_affaire_viparis: '25SIAL9' },
      new_values: { code_affaire_viparis: '26SIAL1' },
    });
    expect(mockEnvoi).not.toHaveBeenCalled();
    expect(admin.rpcCalls).toEqual([]);
  });
});
