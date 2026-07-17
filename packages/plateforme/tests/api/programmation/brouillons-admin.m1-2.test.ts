/**
 * M1.2 — Cycle de vie du brouillon en mode support `admin_savr` (§06.01 l.17
 * « programmation de support, tous périmètres »).
 *
 * Régression corrigée : le POST de création accepte l'admin (#223) et le redirige
 * vers /brouillons quand `confirmer:false`, mais les trois routes qui font vivre
 * ce brouillon le lui cachaient — la liste appelait bien
 * `requireProgrammateurOuAdmin` mais posait `.eq('organisation_id', …)` sans
 * brancher sur `isAdmin`, et confirmer/supprimer étaient gardées par
 * `requireProgrammateur` (PROGRAMMATION_ROLES ne contient pas `admin_savr` → 403).
 * L'admin créait donc un brouillon qu'il ne pouvait plus lister, confirmer ni
 * supprimer : orphelin en base.
 *
 * Périmètre de la liste pour le staff = ses PROPRES créations (`created_by`),
 * décision Val 2026-07-17 : l'org du JWT vaut `org_savr` (org interne, jamais
 * celle d'un client) et cette liste n'est dans aucune nav — on n'y atterrit que
 * par redirection depuis « Enregistrer en brouillon ».
 *
 * La garde RÉELLE tourne ici (seule la couche Supabase est mockée) : un retour à
 * `requireProgrammateur`, ou un prédicat org reposé sur le staff, refait tomber
 * ces tests — ce qu'un mock de `@/lib/api-auth` n'aurait pas attrapé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };

  const chain: Record<string, unknown> = {
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'is',
    'update',
    'insert',
    'delete',
    'order',
    'limit',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    record('rpc', args);
    return Promise.resolve(next());
  };
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

// Gate facturation : son verdict n'est pas le sujet ici, mais l'org sur laquelle
// elle est évaluée l'est (cf. le test dédié) → on capture l'appel.
const gate = vi.fn(() =>
  Promise.resolve({ ok: true as const, entiteFacturationId: 'ef-1' }),
);
vi.mock('@/lib/onboarding-guards.js', () => ({
  requireCompletedOrganisation: (...a: unknown[]) => gate(...(a as [])),
}));

// Effets de bord best-effort — hors périmètre.
vi.mock('@/lib/programmation/recap-email.js', () => ({
  envoyerRecapProgrammation: () => Promise.resolve(),
}));
vi.mock('@/lib/programmation/lieu-override.js', () => ({
  notifierOverrideLieu: () => Promise.resolve(),
}));
const notifier = vi.fn(() => Promise.resolve());
vi.mock('@/lib/notifications/traiteur-operationnel.js', () => ({
  notifierTraiteurOperationnel: (...a: unknown[]) => notifier(...(a as [])),
}));
vi.mock('@/lib/attribution-ag/auto-accept.js', () => ({
  evaluerAutoAcceptAg: () => Promise.resolve(),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(
  role: string,
  organisationId: string,
  userId = 'user-admin',
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
          organisation_id: organisationId,
        }),
      },
    },
    error: null,
  });
}

// Le brouillon appartient à `org-kaspia` — jamais à `org-savr` (l'org interne que
// porte le JWT du staff), ce qui rend les deux périmètres discernables.
const EVT = {
  id: 'e1',
  organisation_id: 'org-kaspia',
  nom_evenement: 'Gala Kaspia',
  pax: 120,
  lieu_id: 'lieu-1',
};

const COLLECTE_ZD = {
  id: 'col-1',
  type: 'zero_dechet',
  date_collecte: '2099-08-01',
  lieu_overrides: null,
};
const COLLECTE_AG = {
  id: 'col-2',
  type: 'anti_gaspi',
  date_collecte: '2099-08-01',
  lieu_overrides: null,
};

const params = () => Promise.resolve({ id: 'e1' });

async function listerBrouillons() {
  const { GET } =
    await import('@/app/api/v1/programmation/evenements/route.js');
  return GET(
    new NextRequest(
      'http://localhost/api/v1/programmation/evenements?statut=brouillon',
    ),
  );
}

async function confirmer() {
  const { PATCH } =
    await import('@/app/api/v1/programmation/evenements/[id]/confirmer/route.js');
  return PATCH(
    new NextRequest(
      'http://localhost/api/v1/programmation/evenements/e1/confirmer',
      { method: 'PATCH' },
    ),
    { params: params() },
  );
}

async function supprimer() {
  const { DELETE } =
    await import('@/app/api/v1/programmation/evenements/[id]/route.js');
  return DELETE(
    new NextRequest('http://localhost/api/v1/programmation/evenements/e1', {
      method: 'DELETE',
    }),
    { params: params() },
  );
}

// Prédicats de cloisonnement effectivement posés sur la requête.
const predicatesOn = (col: string) =>
  (admin.__calls.eq ?? []).filter(([c]) => c === col);

beforeEach(() => {
  vi.clearAllMocks();
  admin = makeChain();
});

describe('M1.2 — liste des brouillons (mode admin support)', () => {
  it('admin_savr est cloisonné sur ses propres créations, pas sur son org interne', async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: [{ id: 'e1' }], error: null });

    const res = await listerBrouillons();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ data: [{ id: 'e1' }] });
    // Le cœur du bug : `org-savr` en prédicat ne cloisonne rien, ça masque tout
    // → l'admin ne voyait aucun de ses brouillons.
    expect(predicatesOn('organisation_id')).toEqual([]);
    expect(predicatesOn('created_by')).toEqual([['created_by', 'user-admin']]);
  });

  it('un rôle client reste cloisonné sur son organisation', async () => {
    setupAuth('traiteur_manager', 'org-kaspia', 'user-tm');
    admin.push({ data: [{ id: 'e1' }], error: null });

    const res = await listerBrouillons();

    expect(res.status).toBe(200);
    expect(predicatesOn('organisation_id')).toEqual([
      ['organisation_id', 'org-kaspia'],
    ]);
    // Le périmètre client reste l'organisation : un manager continue de voir les
    // brouillons de ses commerciaux (comportement existant, non régressé).
    expect(predicatesOn('created_by')).toEqual([]);
  });

  it("un rôle hors périmètre programmation n'a pas gagné l'accès au passage", async () => {
    setupAuth('client_organisateur', 'org-kaspia');

    expect((await listerBrouillons()).status).toBe(403);
  });
});

describe('M1.2 — confirmation d’un brouillon (mode admin support)', () => {
  it('admin_savr confirme son brouillon (et non plus 403 « Rôle insuffisant »)', async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: EVT, error: null }); // select événement
    admin.push({ data: [COLLECTE_ZD], error: null }); // collectes brouillon
    admin.push({ data: null, error: null }); // rpc fn_confirmer_programmation_brouillon

    const res = await confirmer();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      evenement_id: 'e1',
      statut: 'programmee',
    });
    expect(predicatesOn('organisation_id')).toEqual([]);
  });

  it("la gate facturation est évaluée sur l'org de l'événement, jamais sur l'org du JWT staff", async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: EVT, error: null });
    admin.push({ data: [COLLECTE_ZD], error: null });
    admin.push({ data: null, error: null });

    await confirmer();

    // Sur `org-savr`, aucune entité de facturation vérifiée → 422 « Complétez
    // votre profil » sur le brouillon d'un client parfaitement en règle.
    expect(gate).toHaveBeenCalledWith(
      expect.anything(),
      'org-kaspia',
      expect.any(String),
    );
  });

  it("le pack AG est lu sur l'org de l'événement, jamais sur l'org du JWT staff", async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: EVT, error: null }); // select événement
    admin.push({ data: [COLLECTE_AG], error: null }); // collectes brouillon
    admin.push({ data: { id: 'pack-1', credits_restants: 3 }, error: null }); // pack
    admin.push({ data: null, error: null }); // rpc confirmer

    const res = await confirmer();

    expect(res.status).toBe(200);
    // C'est cette assertion qui fait foi : le stub sert le pack quel que soit le
    // prédicat, donc le 200 ci-dessus survivrait à une régression. En prod, un
    // pack cherché sur `org-savr` serait introuvable → 422 « Aucun pack actif ».
    expect(predicatesOn('organisation_id')).toEqual([
      ['organisation_id', 'org-kaspia'],
    ]);
  });

  it("l'admin agit AU NOM de l'org cible (pas de notification « tiers » parasite)", async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: EVT, error: null });
    admin.push({ data: [COLLECTE_ZD], error: null });
    admin.push({ data: null, error: null });

    await confirmer();

    expect(notifier).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acteurOrgId: 'org-kaspia' }),
    );
  });

  it('un rôle client reste cloisonné sur son organisation', async () => {
    setupAuth('traiteur_manager', 'org-kaspia', 'user-tm');
    admin.push({ data: EVT, error: null });
    admin.push({ data: [COLLECTE_ZD], error: null });
    admin.push({ data: null, error: null });

    const res = await confirmer();

    expect(res.status).toBe(200);
    expect(predicatesOn('organisation_id')).toEqual([
      ['organisation_id', 'org-kaspia'],
    ]);
  });

  it("un rôle hors périmètre programmation n'a pas gagné l'accès au passage", async () => {
    setupAuth('client_organisateur', 'org-kaspia');

    expect((await confirmer()).status).toBe(403);
  });
});

describe('M1.2 — suppression d’un brouillon (mode admin support)', () => {
  it('admin_savr supprime son brouillon (le bouton de la liste devient opérant)', async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: { id: 'e1' }, error: null }); // select événement
    admin.push({ data: [{ id: 'col-1', statut: 'brouillon' }], error: null }); // collectes
    admin.push({ data: null, error: null }); // delete

    const res = await supprimer();

    expect(res.status).toBe(204);
    expect(predicatesOn('organisation_id')).toEqual([]);
    expect(admin.__calls.delete).toHaveLength(1);
  });

  it('la garde « brouillon uniquement » tient aussi pour l’admin', async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: { id: 'e1' }, error: null });
    admin.push({ data: [{ id: 'col-1', statut: 'programmee' }], error: null });

    const res = await supprimer();

    // Ouvrir la route au staff ne doit pas ouvrir une porte dérobée vers la
    // suppression d'une collecte confirmée (§06.01 : annulation, pas suppression).
    expect(res.status).toBe(422);
    expect(admin.__calls.delete).toBeUndefined();
  });

  it('un rôle client reste cloisonné sur son organisation', async () => {
    setupAuth('traiteur_manager', 'org-kaspia', 'user-tm');
    admin.push({ data: { id: 'e1' }, error: null });
    admin.push({ data: [{ id: 'col-1', statut: 'brouillon' }], error: null });
    admin.push({ data: null, error: null });

    const res = await supprimer();

    expect(res.status).toBe(204);
    expect(predicatesOn('organisation_id')).toEqual([
      ['organisation_id', 'org-kaspia'],
    ]);
  });

  it("un rôle hors périmètre programmation n'a pas gagné l'accès au passage", async () => {
    setupAuth('client_organisateur', 'org-kaspia');

    expect((await supprimer()).status).toBe(403);
  });
});
