/**
 * Réponse des trois routes clientes de modification d'une collecte (traiteur,
 * agence, gestionnaire de lieux).
 *
 * `fn_modifier_collecte` rend la ligne ENTIÈRE de `plateforme.collectes`, dont
 * trois colonnes réservées à l'équipe Savr : `notes_internes`,
 * `motif_override_prestataire` et `aucun_repas_photo_url` (hors GRANT SELECT
 * authenticated depuis la migration 20261117230000). Ces routes écrivent en
 * service_role : le privilège colonne ne les protège pas, seule la réduction de
 * la réponse le fait (`reponseCollecteModifiee`).
 *
 * Chaque cas fait rendre la ligne entière à la RPC simulée, valeurs repères
 * comprises, puis vérifie que ni les clés ni les valeurs n'atteignent le client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  CHAMPS_COLLECTE_EDITABLES,
  reponseCollecteModifiee,
} from '@/lib/collectes/champs-editables.js';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    push(r: Result) {
      queue.push(r);
      return chain;
    },
    __calls: calls,
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'neq',
    'order',
    'limit',
    'update',
    'insert',
  ]) {
    chain[m] = (...args: unknown[]) => {
      (calls[m] ??= []).push(args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  // File d'envoi lue par l'email à l'équipe : aucun envoi abandonné, hors file.
  const sansAbandon = {
    select: () => sansAbandon,
    eq: () => sansAbandon,
    in: () => sansAbandon,
    then: (resolve: (r: Result) => unknown) =>
      resolve({ data: [], error: null }),
  };
  const fromParDefaut = chain.from as (...args: unknown[]) => unknown;
  chain.from = (...args: unknown[]) =>
    args[0] === 'outbox_events' ? sansAbandon : fromParDefaut(...args);
  chain.rpc = (...args: unknown[]) => {
    (calls.rpc ??= []).push(args);
    return Promise.resolve(next());
  };
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain();
let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (...a: unknown[]) =>
      (admin.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (admin.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/envoi-immediat.js', () => ({
  envoyerOrdresSansAttendre: vi.fn(),
  envoyerOrdresEvenementSansAttendre: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, organisation_id: 'org-1' }),
      },
    },
    error: null,
  });
}

const COLONNES_FERMEES = [
  'notes_internes',
  'motif_override_prestataire',
  'aucun_repas_photo_url',
] as const;

// Ligne entière telle que la rend `fn_modifier_collecte` (`to_jsonb(v_row)`).
const LIGNE_ENTIERE = {
  id: 'c1',
  evenement_id: 'evt-1',
  type: 'anti_gaspi',
  statut: 'programmee',
  statut_tms: 'non_envoye',
  date_collecte: '2097-12-31',
  heure_collecte: '10:00:00',
  pax: 120,
  controle_acces_requis: false,
  informations_supplementaires: 'Quai B',
  prestataire_logistique_id: 'presta-1',
  dirty_tms: true,
  notes_internes: 'REPERE-NOTE-EQUIPE-SAVR',
  motif_override_prestataire: 'REPERE-MOTIF-PRESTATAIRE',
  aucun_repas_photo_url: 'https://exemple.test/REPERE-PHOTO.jpg',
};

// Import explicite (et non construit) pour que le bundler de test le résolve.
const ROUTES = [
  {
    espace: 'traiteur',
    role: 'traiteur_manager',
    charger: () => import('@/app/api/v1/traiteur/collectes/[id]/route.js'),
  },
  {
    espace: 'agence',
    role: 'agence',
    charger: () => import('@/app/api/v1/agence/collectes/[id]/route.js'),
  },
  {
    espace: 'gestionnaire',
    role: 'gestionnaire_lieux',
    charger: () => import('@/app/api/v1/gestionnaire/collectes/[id]/route.js'),
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
});

describe('M1.5b / PATCH client d’une collecte — colonnes réservées à l’équipe Savr', () => {
  for (const { espace, role, charger } of ROUTES) {
    it(`collectes/patch_${espace}_reponse_sans_colonnes_internes — ni les clés ni les valeurs`, async () => {
      setupAuth(role);
      rls.push({
        data: {
          id: 'c1',
          statut: 'programmee',
          statut_tms: 'non_envoye',
          date_collecte: '2097-12-31',
          heure_collecte: '10:00:00',
          evenement: { created_by: 'user-1', organisation_id: 'org-1' },
        },
        error: null,
      });
      admin.push({ data: LIGNE_ENTIERE, error: null }); // état « avant »
      admin.push({ data: null, error: null }); // contacts de la collecte
      admin.push({ data: LIGNE_ENTIERE, error: null }); // rpc fn_modifier_collecte

      const { PATCH } = await charger();
      const res = await PATCH(
        new NextRequest(`http://localhost/api/v1/${espace}/collectes/c1`, {
          method: 'PATCH',
          body: JSON.stringify({ informations_supplementaires: 'Quai B' }),
          headers: { 'content-type': 'application/json' },
        }),
        { params: Promise.resolve({ id: 'c1' }) },
      );

      expect(res.status).toBe(200);
      // Non-vacuité : la RPC a bien été appelée et a rendu les valeurs repères.
      expect(
        (admin.__calls.rpc ?? []).some(([fn]) => fn === 'fn_modifier_collecte'),
      ).toBe(true);

      const texte = await res.text();
      expect(texte).not.toContain('REPERE-');
      const json = JSON.parse(texte) as {
        data: Record<string, unknown>;
        flags: Record<string, unknown>;
      };
      for (const colonne of COLONNES_FERMEES)
        expect(json.data).not.toHaveProperty(colonne);
      // La réponse reste utile : identifiant et champ modifié.
      expect(json.data.id).toBe('c1');
      expect(json.data.informations_supplementaires).toBe('Quai B');
      expect(json.flags).toBeDefined();
      // Liste fermée : rien d'autre que l'id et les champs éditables.
      for (const cle of Object.keys(json.data))
        expect(['id', ...CHAMPS_COLLECTE_EDITABLES]).toContain(cle);
    });
  }

  it('collectes/reponse_collecte_modifiee_liste_fermee — id + champs éditables seulement', () => {
    expect(reponseCollecteModifiee(LIGNE_ENTIERE)).toEqual({
      id: 'c1',
      date_collecte: '2097-12-31',
      heure_collecte: '10:00:00',
      pax: 120,
      controle_acces_requis: false,
      informations_supplementaires: 'Quai B',
    });
    expect(reponseCollecteModifiee(null)).toEqual({});
  });

  it('collectes/champs_editables_sans_colonne_interne — aucune colonne fermée n’est éditable par un client', () => {
    for (const colonne of COLONNES_FERMEES)
      expect(CHAMPS_COLLECTE_EDITABLES).not.toContain(colonne);
  });
});
