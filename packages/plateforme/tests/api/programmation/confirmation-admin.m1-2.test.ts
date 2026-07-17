/**
 * M1.2 — Écran de confirmation post-programmation (§06.01 étape 13) : chemin
 * `admin_savr` en mode support (§06.01 l.17 « programmation de support, tous
 * périmètres »).
 *
 * Régression corrigée : le POST de création accepte l'admin (#223) et la
 * redirection vers /programmer/confirmation n'a aucune branche de rôle (#242),
 * mais le GET qui alimente 100 % de cet écran était gardé par
 * `requireProgrammateur` — or PROGRAMMATION_ROLES ne contient pas `admin_savr`
 * → 403, donc `evenement` restait null, donc le récap des collectes et l'action
 * « Ajouter une collecte » (toutes deux gatées sur `evenement`) disparaissaient.
 * Second défaut sur le même chemin : le prédicat `.eq('organisation_id',
 * auth.ctx.organisationId)` retombait sur l'org interne `org_savr` pour le staff
 * → aucune ligne, même une fois le rôle débloqué.
 *
 * La garde RÉELLE tourne ici (seule la couche Supabase est mockée) : un retour à
 * `requireProgrammateur` refait tomber ces tests en 403 — ce qu'un mock de
 * `@/lib/api-auth` n'aurait pas attrapé.
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
  for (const m of ['from', 'select', 'eq', 'in', 'is', 'update', 'insert']) {
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

// Effets de bord best-effort du POST — hors périmètre.
vi.mock('@/lib/programmation/recap-email.js', () => ({
  envoyerRecapProgrammation: () => Promise.resolve(),
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
function setupAuth(role: string, organisationId: string, userId = 'user-1') {
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

// L'événement appartient à `org-kaspia` — jamais à `org-savr` (l'org interne que
// porte le JWT du staff), ce qui rend les deux périmètres discernables.
const EVT = {
  id: 'e1',
  organisation_id: 'org-kaspia',
  nom_evenement: 'Gala Kaspia',
  pax: 120,
  contact_principal_nom: 'Marie Dupont',
  lieux: {
    nom: 'Pavillon',
    adresse_acces: '1 rue X',
    code_postal: '75001',
    ville: 'Paris',
  },
  collectes: [
    {
      id: 'col-1',
      type: 'zero_dechet',
      statut: 'programmee',
      date_collecte: '2099-08-01',
      heure_collecte: '14:30:00',
    },
  ],
};

const params = () => Promise.resolve({ id: 'e1' });

async function getEvenement() {
  const { GET } =
    await import('@/app/api/v1/programmation/evenements/[id]/route.js');
  return GET(
    new NextRequest('http://localhost/api/v1/programmation/evenements/e1'),
    { params: params() },
  );
}

async function ajouterCollecte(type: string) {
  const { POST } =
    await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
  return POST(
    new NextRequest(
      'http://localhost/api/v1/programmation/evenements/e1/collectes',
      {
        method: 'POST',
        body: JSON.stringify({
          type,
          date_collecte: '2099-01-01',
          heure_collecte: '14:30',
        }),
        headers: { 'content-type': 'application/json' },
      },
    ),
    { params: params() },
  );
}

// Prédicats de cloisonnement effectivement posés sur la requête.
const orgPredicates = () =>
  (admin.__calls.eq ?? []).filter(([col]) => col === 'organisation_id');

beforeEach(() => {
  vi.clearAllMocks();
  admin = makeChain();
});

describe('M1.2 — confirmation de programmation : détail événement (mode admin support)', () => {
  it('admin_savr obtient le récapitulatif (et non plus 403 « Rôle insuffisant »)', async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: EVT, error: null });

    const res = await getEvenement();

    expect(res.status).toBe(200);
    // Exactement ce que l'écran gate sur `evenement` : récap + action « Ajouter ».
    await expect(res.json()).resolves.toMatchObject({
      id: 'e1',
      collectes: [{ id: 'col-1' }],
    });
  });

  it("admin_savr n'est pas filtré sur l'org interne de son JWT", async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: EVT, error: null });

    const res = await getEvenement();

    // Le 200 n'est pas redondant : sans lui, un 403 (aucune requête émise, donc
    // aucun prédicat) satisferait l'assertion suivante pour la mauvaise raison.
    expect(res.status).toBe(200);
    // Filtrer sur `org-savr` ne cloisonnerait rien : ça masquerait tout.
    expect(orgPredicates()).toEqual([]);
  });

  it('un rôle client reste cloisonné sur son organisation', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    admin.push({ data: EVT, error: null });

    const res = await getEvenement();

    expect(res.status).toBe(200);
    expect(orgPredicates()).toEqual([['organisation_id', 'org-kaspia']]);
  });

  it("un rôle hors périmètre programmation n'a pas gagné l'accès au passage", async () => {
    setupAuth('client_organisateur', 'org-kaspia');

    expect((await getEvenement()).status).toBe(403);
  });
});

describe('M1.2 — confirmation de programmation : action « Ajouter une collecte » (mode admin support)', () => {
  it('admin_savr peut ajouter une collecte à un événement (action §06.01 étape 13)', async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: EVT, error: null }); // select événement
    admin.push({ data: true, error: null }); // rpc f_collecte_editable
    admin.push({ data: 'col-new', error: null }); // rpc fn_ajouter_collecte_evenement

    const res = await ajouterCollecte('zd');

    expect(res.status).toBe(201);
    expect(orgPredicates()).toEqual([]);
  });

  it("le pack AG est lu sur l'org de l'événement, jamais sur l'org du JWT staff", async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: EVT, error: null }); // select événement
    admin.push({ data: true, error: null }); // rpc f_collecte_editable
    admin.push({ data: { id: 'pack-1', credits_restants: 3 }, error: null }); // pack
    admin.push({ data: 'col-new', error: null }); // rpc fn_ajouter_collecte_evenement

    const res = await ajouterCollecte('ag');

    // Cherché sur `org-savr`, le pack serait introuvable → 422 « Aucun pack actif ».
    expect(res.status).toBe(201);
    expect(orgPredicates()).toEqual([['organisation_id', 'org-kaspia']]);
  });

  it("l'admin agit AU NOM de l'org cible (pas de notification « tiers » parasite)", async () => {
    setupAuth('admin_savr', 'org-savr');
    admin.push({ data: EVT, error: null });
    admin.push({ data: true, error: null });
    admin.push({ data: 'col-new', error: null });

    await ajouterCollecte('zd');

    // Miroir du POST de création (#223), qui passe l'org cible en acteurOrgId :
    // avec `org-savr`, le traiteur opérationnel serait notifié à tort d'un tiers.
    expect(notifier).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acteurOrgId: 'org-kaspia' }),
    );
  });

  it('un rôle client reste cloisonné sur son organisation', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    admin.push({ data: EVT, error: null });
    admin.push({ data: true, error: null });
    admin.push({ data: 'col-new', error: null });

    const res = await ajouterCollecte('zd');

    expect(res.status).toBe(201);
    expect(orgPredicates()).toEqual([['organisation_id', 'org-kaspia']]);
  });
});
