/**
 * M1.2 — Refonte du formulaire de programmation, lot B2 (décisions Val
 * 2026-10-22 C1–C8 et 2026-10-24 B2-Q1 à B2-Q4) : une carte par collecte.
 *
 * Chaque collecte du formulaire est une CARTE qui porte sa date, son heure, ses
 * convives, son type d'événement, ses contacts et ses informations
 * supplémentaires. Côté serveur :
 *   · validation de toutes les cartes AVANT toute écriture (422), le type
 *     d'événement vérifié dans le référentiel en une seule lecture ;
 *   · au plus 10 collectes Zéro Déchet et 10 Anti-Gaspi par programmation ;
 *   · événement et collectes en UNE transaction (fn_enregistrer_programmation),
 *     brouillon comme confirmation ; reprise d'un brouillon par PUT ;
 *   · ajout d'une collecte = une carte (fn_creer_collecte_carte) ;
 *   · GET d'un événement : les contacts de chaque collecte, lus dans
 *     `collecte_contacts` après la garde de périmètre.
 *
 * Seule la couche Supabase est simulée, par un faux qui APPLIQUE les filtres
 * qu'il reçoit (`.eq()`, `.in()`) au lieu de rejouer des réponses en file : un
 * filtre retiré de la route change donc ce qu'elle lit. Les suites best-effort
 * d'une confirmation (envoi immédiat, email récapitulatif, acceptation
 * automatique AG, notification du traiteur opérant) sont des espions : leur
 * contenu est prouvé dans leurs propres tests. La transaction elle-même (tout
 * ou rien, E1 par collecte ZD, reprise du brouillon) est prouvée en base par
 * supabase/tests/programmation_par_carte.test.sql.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { _reinitialiserFreinEcritures } from '@/lib/frein-ecritures-client.js';

// ── Faux Supabase (client service-role) ─────────────────────────────────────

type Resultat = { data: unknown; error: unknown };
type Maillon = [string, unknown[]];
interface Requete {
  table: string;
  maillons: Maillon[];
}

const MAILLONS = [
  'select',
  'insert',
  'update',
  'delete',
  'upsert',
  'eq',
  'neq',
  'in',
  'is',
  'not',
  'or',
  'order',
  'limit',
] as const;
const ECRITURES = new Set(['insert', 'update', 'delete', 'upsert']);

const TYPE_A = '11111111-1111-4111-8111-111111111111';
const TYPE_B = '22222222-2222-4222-8222-222222222222';
const TYPE_INACTIF = '33333333-3333-4333-8333-333333333333';
const TYPE_INCONNU = '44444444-4444-4444-8444-444444444444';
const TYPES_EVENEMENTS = [
  { id: TYPE_A, actif: true },
  { id: TYPE_B, actif: true },
  { id: TYPE_INACTIF, actif: false },
];

let requetes: Requete[] = [];
let appelsRpc: Array<{ nom: string; args: Record<string, unknown> }> = [];
let reponsesRpc: Record<string, Resultat> = {};
let evenements: Record<string, unknown>[] = [];
let contacts: Record<string, unknown>[] = [];
let organisations: Record<string, unknown>[] = [];
let liensLieux: Record<string, unknown>[] = [];
let erreurTypes: unknown = null;
let erreurContacts: unknown = null;

const filtresEq = (r: Requete) =>
  r.maillons.filter(([m]) => m === 'eq').map(([, a]) => a as [string, unknown]);
const filtreIn = (r: Requete) =>
  r.maillons.find(([m]) => m === 'in')?.[1] as [string, unknown[]] | undefined;

function resoudre(r: Requete): Resultat {
  switch (r.table) {
    case 'types_evenements': {
      if (erreurTypes) return { data: null, error: erreurTypes };
      const [col, ids] = filtreIn(r) ?? ['', []];
      let lignes = TYPES_EVENEMENTS.filter(
        (t) => col === 'id' && ids.includes(t.id),
      );
      for (const [c, v] of filtresEq(r))
        lignes = lignes.filter((t) => t[c as keyof typeof t] === v);
      return { data: lignes.map(({ id }) => ({ id })), error: null };
    }
    case 'evenements': {
      // `.single()` comme PostgREST : exactement une ligne, sinon PGRST116.
      const trouves = evenements.filter((l) =>
        filtresEq(r).every(([c, v]) => l[c] === v),
      );
      return trouves.length === 1
        ? { data: trouves[0], error: null }
        : {
            data: null,
            error: {
              code: 'PGRST116',
              message: 'JSON object requested, multiple (or no) rows returned',
            },
          };
    }
    case 'collecte_contacts': {
      if (erreurContacts) return { data: null, error: erreurContacts };
      const [col, ids] = filtreIn(r) ?? ['', []];
      return {
        data: contacts.filter(
          (l) => col === 'collecte_id' && ids.includes(l.collecte_id),
        ),
        error: null,
      };
    }
    case 'entites_facturation':
      return { data: { id: 'ef-1' }, error: null };
    // Gardes de périmètre (agence, gestionnaire) : lignes filtrées par `.eq`.
    case 'organisations':
    case 'organisations_lieux': {
      const lignes = (
        r.table === 'organisations' ? organisations : liensLieux
      ).filter((l) => filtresEq(r).every(([c, v]) => l[c] === v));
      return { data: lignes[0] ?? null, error: null };
    }
    default:
      return { data: null, error: null };
  }
}

function requete(table: string): Record<string, unknown> {
  const r: Requete = { table, maillons: [] };
  requetes.push(r);
  const q: Record<string, unknown> = {
    single: () => Promise.resolve(resoudre(r)),
    maybeSingle: () => Promise.resolve(resoudre(r)),
    then: (ok: (v: Resultat) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(resoudre(r)).then(ok, ko),
  };
  for (const m of MAILLONS)
    q[m] = (...a: unknown[]) => {
      r.maillons.push([m, a]);
      return q;
    };
  return q;
}

const admin = {
  from: (table: string) => requete(table),
  rpc: (nom: string, args: Record<string, unknown>) => {
    // Copie à l'instant de l'appel : ce que la route a TRANSMIS.
    appelsRpc.push({ nom, args: structuredClone(args) });
    return Promise.resolve(reponsesRpc[nom] ?? { data: null, error: null });
  },
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));

// ── Suites d'une confirmation : espions ─────────────────────────────────────
const envoyerOrdres = vi.fn();
vi.mock('@/lib/envoi-immediat.js', () => ({
  envoyerOrdresSansAttendre: (...a: unknown[]) => envoyerOrdres(...a),
  envoyerOrdresEvenementSansAttendre: () => undefined,
}));
const recap = vi.fn(() => Promise.resolve());
vi.mock('@/lib/programmation/recap-email.js', () => ({
  envoyerRecapProgrammation: (...a: unknown[]) => recap(...(a as [])),
}));
const autoAccept = vi.fn(() =>
  Promise.resolve({ auto_accepted: false, reason: 'no_config' }),
);
vi.mock('@/lib/attribution-ag/auto-accept.js', () => ({
  evaluerAutoAcceptAg: (...a: unknown[]) => autoAccept(...(a as [])),
}));
const notifier = vi.fn(() => Promise.resolve());
vi.mock('@/lib/notifications/traiteur-operationnel.js', () => ({
  notifierTraiteurOperationnel: (...a: unknown[]) => notifier(...(a as [])),
}));
// Mock PARTIEL : la validation des surcharges du lieu reste la vraie.
const notifierOverride = vi.fn(() => Promise.resolve());
vi.mock('@/lib/programmation/lieu-override.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/programmation/lieu-override.js')
  >()),
  notifierOverrideLieu: (...a: unknown[]) => notifierOverride(...(a as [])),
}));

// ── Authentification réelle (seul le client de session est simulé) ──────────
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

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId: string, userId: string) {
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

function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });
}

async function programmer(body: unknown) {
  const { POST } =
    await import('@/app/api/v1/programmation/evenements/route.js');
  return POST(req('POST', '/api/v1/programmation/evenements', body));
}
async function reprendre(id: string, body: unknown) {
  const { PUT } =
    await import('@/app/api/v1/programmation/evenements/[id]/brouillon/route.js');
  return PUT(
    req('PUT', `/api/v1/programmation/evenements/${id}/brouillon`, body),
    { params: Promise.resolve({ id }) },
  );
}
async function ajouter(id: string, body: unknown) {
  const { POST } =
    await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
  return POST(
    req('POST', `/api/v1/programmation/evenements/${id}/collectes`, body),
    { params: Promise.resolve({ id }) },
  );
}
async function lire(id: string) {
  const { GET } =
    await import('@/app/api/v1/programmation/evenements/[id]/route.js');
  return GET(req('GET', `/api/v1/programmation/evenements/${id}`), {
    params: Promise.resolve({ id }),
  });
}

// ── Jeu d'essai ─────────────────────────────────────────────────────────────

const ORG = 'org-traiteur-1';

/** Une carte valide ; `extra` remplace ou ajoute des champs. */
function carte(
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type,
    date_collecte: '2097-01-15',
    heure_collecte: '19:00',
    pax: 120,
    type_evenement_id: TYPE_A,
    contact_principal_nom: 'Alice Martin',
    contact_principal_telephone: '0611111111',
    ...extra,
  };
}

/** Carte privée d'un champ. */
function sans(c: Record<string, unknown>, champ: string) {
  const copie = { ...c };
  delete copie[champ];
  return copie;
}

/** Carte telle que la route la transmet (forme de lib/programmation/cartes). */
function normalisee(c: Record<string, unknown>) {
  return {
    type: c.type,
    date_collecte: c.date_collecte,
    heure_collecte: c.heure_collecte,
    pax: c.pax,
    informations_supplementaires: c.informations_supplementaires ?? null,
    type_evenement_id: c.type_evenement_id,
    contact_principal_nom: c.contact_principal_nom,
    contact_principal_telephone: c.contact_principal_telephone,
    contact_secours_nom: c.contact_secours_nom ?? null,
    contact_secours_telephone: c.contact_secours_telephone ?? null,
  };
}

function corps(collectes: unknown, extra: Record<string, unknown> = {}) {
  return {
    lieu_id: 'lieu-1',
    nom_evenement: 'Gala B2',
    controle_acces_requis: false,
    collectes,
    confirmer: true,
    ...extra,
  };
}

/** Réponse de fn_enregistrer_programmation : un identifiant par carte. */
function enregistrementRend(evenementId: string, ...collecteIds: string[]) {
  reponsesRpc.fn_enregistrer_programmation = {
    data: { evenement_id: evenementId, collecte_ids: collecteIds },
    error: null,
  };
}

const rpc = (nom: string) => appelsRpc.filter((a) => a.nom === nom);
const tables = () => requetes.map((r) => r.table);

/** Aucune écriture : ni RPC, ni INSERT/UPDATE/DELETE, ni ordre envoyé. */
function aucuneEcriture() {
  expect(appelsRpc).toEqual([]);
  expect(
    requetes.flatMap((r) =>
      r.maillons.filter(([m]) => ECRITURES.has(m)).map(() => r.table),
    ),
  ).toEqual([]);
  expect(envoyerOrdres).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  _reinitialiserFreinEcritures();
  requetes = [];
  appelsRpc = [];
  reponsesRpc = {};
  evenements = [];
  contacts = [];
  organisations = [];
  liensLieux = [];
  erreurTypes = null;
  erreurContacts = null;
});

// ── Création : une carte par collecte ───────────────────────────────────────

describe('M1.2 / programmation par cartes — création', () => {
  it('M1.2/programmation_cartes_par_collecte — chaque carte part normalisée à fn_enregistrer_programmation, type d’événement et contacts compris', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    enregistrementRend('evt-neuf', 'col-zd', 'col-ag');

    const res = await programmer({
      lieu_id: 'lieu-1',
      nom_evenement: 'Gala B2',
      reference_affaire: 'AFF-12',
      controle_acces_requis: true,
      // Ancien contrat (type et contacts au niveau de l'événement) : ignoré.
      type_evenement_id: TYPE_B,
      contact_principal_nom: 'Ancien contact',
      contact_principal_telephone: '0699999999',
      collectes: [
        carte('zd', {
          contact_principal_nom: '  Alice Martin  ',
          contact_principal_telephone: ' 06 11 11 11 11 ',
          contact_secours_nom: '',
          contact_secours_telephone: null,
          informations_supplementaires: '  Quai 2\nSonner B  ',
        }),
        carte('ag', {
          date_collecte: '2097-01-16',
          heure_collecte: '23:30',
          pax: 80,
          type_evenement_id: TYPE_B,
          contact_principal_nom: 'Bruno Petit',
          contact_principal_telephone: '0622222222',
          contact_secours_nom: 'Sam Roux',
          contact_secours_telephone: '0733333333',
          // Champs hostiles : aucun n'atteint la RPC.
          statut: 'validee',
          nb_camions_demande: 4,
          evenement_id: 'evt-autre',
          organisation_id: 'org-autre',
        }),
      ],
      confirmer: true,
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      evenement_id: 'evt-neuf',
      collecte_ids: ['col-zd', 'col-ag'],
    });
    // Toutes les cartes dans UN appel, dans l'ordre du formulaire, normalisées
    // (trim, vide → null), sans clé de plus (toStrictEqual).
    expect(appelsRpc.map((a) => a.nom)).toEqual([
      'fn_enregistrer_programmation',
    ]);
    // Création : aucun identifiant d'événement (paramètre facultatif de la
    // fonction, réservé à la reprise d'un brouillon).
    expect(rpc('fn_enregistrer_programmation')[0]!.args).toStrictEqual({
      p_evenement: {
        organisation_id: ORG,
        traiteur_operationnel_organisation_id: ORG,
        entite_facturation_id: 'ef-1',
        lieu_id: 'lieu-1',
        created_by: 'user-1',
        nom_evenement: 'Gala B2',
        nom_client_organisateur: null,
        logo_client_organisateur_url: null,
        reference_affaire: 'AFF-12',
        controle_acces_requis: true,
        lieu_overrides: null,
      },
      p_collectes: [
        {
          type: 'zd',
          date_collecte: '2097-01-15',
          heure_collecte: '19:00',
          pax: 120,
          informations_supplementaires: 'Quai 2\nSonner B',
          type_evenement_id: TYPE_A,
          contact_principal_nom: 'Alice Martin',
          contact_principal_telephone: '06 11 11 11 11',
          contact_secours_nom: null,
          contact_secours_telephone: null,
        },
        {
          type: 'ag',
          date_collecte: '2097-01-16',
          heure_collecte: '23:30',
          pax: 80,
          informations_supplementaires: null,
          type_evenement_id: TYPE_B,
          contact_principal_nom: 'Bruno Petit',
          contact_principal_telephone: '0622222222',
          contact_secours_nom: 'Sam Roux',
          contact_secours_telephone: '0733333333',
        },
      ],
      p_confirmer: true,
    });
    // Une seule lecture du référentiel pour toutes les cartes, types actifs.
    const lectures = requetes.filter((r) => r.table === 'types_evenements');
    expect(lectures).toHaveLength(1);
    expect(lectures[0]!.maillons).toEqual([
      ['select', ['id']],
      ['in', ['id', [TYPE_A, TYPE_B]]],
      ['eq', ['actif', true]],
    ]);
    // Chaque identifiant rendu suit sa carte : seule l'AG passe à
    // l'acceptation automatique.
    expect(autoAccept).toHaveBeenCalledTimes(1);
    expect(autoAccept).toHaveBeenCalledWith('col-ag');
    expect(envoyerOrdres).toHaveBeenCalledWith(['col-zd', 'col-ag']);
  });
});

// ── Validation des cartes : 422 avant toute écriture ────────────────────────

const CAS_INVALIDES: Array<{
  nom: string;
  collectes: unknown;
  attendu: Record<string, unknown>;
}> = [
  {
    nom: 'aucune carte',
    collectes: [],
    attendu: { error: 'Au moins une collecte est requise.' },
  },
  {
    nom: 'cartes absentes',
    collectes: undefined,
    attendu: { error: 'Au moins une collecte est requise.' },
  },
  {
    nom: 'type d’événement absent',
    collectes: [carte('zd'), sans(carte('ag'), 'type_evenement_id')],
    attendu: { champ: 'type_evenement_id', collecte: 1 },
  },
  {
    nom: 'type d’événement mal formé',
    collectes: [carte('zd', { type_evenement_id: 'type-1' })],
    attendu: { champ: 'type_evenement_id', collecte: 0 },
  },
  {
    nom: 'type d’événement inconnu du référentiel',
    collectes: [carte('zd'), carte('ag', { type_evenement_id: TYPE_INCONNU })],
    attendu: { error: "Type d'événement inconnu.", collecte: 1 },
  },
  {
    // Le faux n'écarte le type inactif que si la route filtre sur `actif`.
    nom: 'type d’événement inactif',
    collectes: [carte('zd', { type_evenement_id: TYPE_INACTIF })],
    attendu: { error: "Type d'événement inconnu.", collecte: 0 },
  },
  {
    nom: 'contact principal absent',
    collectes: [sans(carte('zd'), 'contact_principal_nom')],
    attendu: { champ: 'contact_principal_nom', collecte: 0 },
  },
  {
    nom: 'téléphone du contact principal absent',
    collectes: [sans(carte('zd'), 'contact_principal_telephone')],
    attendu: { champ: 'contact_principal_telephone', collecte: 0 },
  },
  {
    nom: 'contact principal vide',
    collectes: [carte('zd', { contact_principal_nom: '   ' })],
    attendu: { champs_invalides: ['contact_principal_nom'] },
  },
  {
    nom: 'téléphone du contact principal effacé',
    collectes: [carte('zd', { contact_principal_telephone: null })],
    attendu: { champs_invalides: ['contact_principal_telephone'] },
  },
  {
    nom: 'date de collecte mal formée',
    collectes: [carte('zd', { date_collecte: 'abc' })],
    attendu: { champ: 'date_collecte', collecte: 0 },
  },
  {
    nom: 'date de collecte qui n’existe pas',
    collectes: [carte('zd', { date_collecte: '2097-02-30' })],
    attendu: { champ: 'date_collecte', collecte: 0 },
  },
  {
    nom: 'date de collecte passée',
    collectes: [carte('zd', { date_collecte: '2020-01-01' })],
    attendu: { error: 'Date de collecte dans le passé : 2020-01-01' },
  },
  {
    nom: 'type de collecte hors Zéro Déchet / Anti-Gaspi',
    collectes: [carte('zero_dechet')],
    attendu: {
      error: 'Chaque collecte est Zéro Déchet ou Anti-Gaspi.',
      collecte: 0,
    },
  },
];

describe('M1.2 / programmation par cartes — validation', () => {
  for (const cas of CAS_INVALIDES) {
    it(`M1.2/programmation_cartes_validation — ${cas.nom} : 422, rien n’est écrit`, async () => {
      setupAuth('traiteur_manager', ORG, 'user-1');
      enregistrementRend('evt-neuf', 'col-1', 'col-2');

      const res = await programmer(corps(cas.collectes));

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject(cas.attendu);
      aucuneEcriture();
      // Refus avant toute autre lecture (périmètre, entité de facturation).
      expect(tables().filter((t) => t !== 'types_evenements')).toEqual([]);
    });
  }

  it('M1.2/programmation_cartes_validation — lecture du référentiel en échec : 500, rien n’est écrit', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    erreurTypes = { code: '57014', message: 'canceling statement' };

    const res = await programmer(corps([carte('zd')]));

    expect(res.status).toBe(500);
    // Jamais « type inconnu » sur une panne de lecture, ni le message de la base.
    expect(await res.text()).not.toMatch(/inconnu|canceling/);
    aucuneEcriture();
  });

  it('M1.2/programmation_cartes_validation — contre-épreuve : la même carte, complète, est acceptée', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    enregistrementRend('evt-neuf', 'col-1');

    const res = await programmer(corps([carte('zd')]));

    expect(res.status).toBe(201);
    expect(rpc('fn_enregistrer_programmation')).toHaveLength(1);
  });
});

// ── Plafond : 10 Zéro Déchet et 10 Anti-Gaspi ───────────────────────────────

describe('M1.2 / programmation par cartes — plafond par type', () => {
  const serie = (type: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      carte(type, {
        date_collecte: `2097-02-${String(i + 1).padStart(2, '0')}`,
      }),
    );

  it('M1.2/programmation_plafond_par_type — 11 collectes Zéro Déchet : 422, rien n’est écrit', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');

    const res = await programmer(corps(serie('zd', 11)));

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(
      'Au plus 10 collectes Zéro Déchet et 10 Anti-Gaspi par programmation.',
    );
    aucuneEcriture();
  });

  it('M1.2/programmation_plafond_par_type — 11 collectes Anti-Gaspi (et 1 ZD) : 422, rien n’est écrit', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');

    const res = await programmer(
      corps([...serie('zd', 1), ...serie('ag', 11)]),
    );

    expect(res.status).toBe(422);
    aucuneEcriture();
  });

  it('M1.2/programmation_plafond_par_type — 10 Zéro Déchet + 10 Anti-Gaspi : accepté, les 20 cartes en un appel', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    const ids = Array.from({ length: 20 }, (_, i) => `col-${i + 1}`);
    enregistrementRend('evt-neuf', ...ids);

    const res = await programmer(
      corps([...serie('zd', 10), ...serie('ag', 10)]),
    );

    expect(res.status).toBe(201);
    const [appel] = rpc('fn_enregistrer_programmation');
    expect(appel!.args.p_collectes).toHaveLength(20);
  });

  it('M1.2/programmation_plafond_par_type — reprise d’un brouillon (PUT) : 11 Anti-Gaspi, 422, rien n’est écrit', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    evenements = [BROUILLON];

    const res = await reprendre('evt-b', corps(serie('ag', 11)));

    expect(res.status).toBe(422);
    aucuneEcriture();
  });
});

// ── Atomicité : une seule écriture, par la RPC ──────────────────────────────

describe('M1.2 / programmation par cartes — une transaction', () => {
  it('M1.2/programmation_atomique — confirmation : une seule RPC d’écriture, plus d’INSERT `evenements` ni de fn_creer_collecte', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    enregistrementRend('evt-neuf', 'col-1', 'col-2');

    const res = await programmer(
      corps([carte('zd'), carte('zd', { heure_collecte: '23:00' })], {
        // Avant : la route posait aussi la cascade vers le lieu (UPDATE
        // `lieux`) ; elle est désormais dans la même transaction.
        controle_acces_requis: true,
      }),
    );

    expect(res.status).toBe(201);
    expect(appelsRpc.map((a) => a.nom)).toEqual([
      'fn_enregistrer_programmation',
    ]);
    // Seules lectures de la route : le référentiel et l'entité de facturation.
    expect(tables()).toEqual(['types_evenements', 'entites_facturation']);
    // Aucun INSERT `evenements`, aucun UPDATE `lieux` : rien d'écrit hors RPC.
    expect(
      requetes.some((r) => r.maillons.some(([m]) => ECRITURES.has(m))),
    ).toBe(false);
  });

  it('M1.2/programmation_atomique — brouillon : la même RPC, sans confirmation, sans envoi ni email', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    enregistrementRend('evt-neuf', 'col-1');

    const res = await programmer(corps([carte('zd')], { confirmer: false }));

    expect(res.status).toBe(201);
    expect(appelsRpc.map((a) => a.nom)).toEqual([
      'fn_enregistrer_programmation',
    ]);
    expect(rpc('fn_enregistrer_programmation')[0]!.args.p_confirmer).toBe(
      false,
    );
    expect(envoyerOrdres).not.toHaveBeenCalled();
    expect(recap).not.toHaveBeenCalled();
  });

  it('M1.2/programmation_atomique — échec de la RPC : 500, aucune suite ni rattrapage depuis la route', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    reponsesRpc.fn_enregistrer_programmation = {
      data: null,
      error: { code: 'P0001', message: 'PLAFOND_COLLECTES: …' },
    };

    const res = await programmer(corps([carte('zd'), carte('ag')]));

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('PLAFOND_COLLECTES');
    // Plus de DELETE de rattrapage (l'événement n'existe pas : la transaction
    // l'a annulé avec ses collectes), ni ordre, ni email.
    expect(appelsRpc.map((a) => a.nom)).toEqual([
      'fn_enregistrer_programmation',
    ]);
    expect(
      requetes.some((r) => r.maillons.some(([m]) => ECRITURES.has(m))),
    ).toBe(false);
    expect(envoyerOrdres).not.toHaveBeenCalled();
    expect(recap).not.toHaveBeenCalled();
    expect(autoAccept).not.toHaveBeenCalled();
  });
});

// ── Reprise d'un brouillon : PUT /programmation/evenements/[id]/brouillon ───

const BROUILLON = {
  id: 'evt-b',
  organisation_id: ORG,
  created_by: 'user-createur',
  collectes: [{ statut: 'brouillon' }, { statut: 'brouillon' }],
};
const CONFIRME = {
  id: 'evt-c',
  organisation_id: ORG,
  created_by: 'user-createur',
  collectes: [{ statut: 'brouillon' }, { statut: 'programmee' }],
};

describe('M1.2 / programmation par cartes — reprise d’un brouillon', () => {
  beforeEach(() => {
    evenements = [BROUILLON, CONFIRME];
  });

  it('M1.2/brouillon_reprise_put — le créateur enregistre son brouillon : fn_enregistrer_programmation sur CET événement, sans confirmation', async () => {
    setupAuth('traiteur_commercial', ORG, 'user-createur');
    enregistrementRend('evt-b', 'col-1');
    const zd = carte('zd', { informations_supplementaires: '  Quai 3 ' });

    const res = await reprendre('evt-b', corps([zd], { confirmer: false }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      evenement_id: 'evt-b',
      collecte_ids: ['col-1'],
    });
    // Organisation, entité de facturation et créateur restent ceux du
    // brouillon : la route ne les transmet pas.
    expect(rpc('fn_enregistrer_programmation')[0]!.args).toStrictEqual({
      p_evenement_id: 'evt-b',
      p_evenement: {
        traiteur_operationnel_organisation_id: ORG,
        lieu_id: 'lieu-1',
        nom_evenement: 'Gala B2',
        nom_client_organisateur: null,
        logo_client_organisateur_url: null,
        reference_affaire: null,
        controle_acces_requis: false,
        lieu_overrides: null,
      },
      p_collectes: [
        normalisee({ ...zd, informations_supplementaires: 'Quai 3' }),
      ],
      p_confirmer: false,
    });
    // Brouillon lu dans l'organisation de l'appelant.
    const lecture = requetes.find((r) => r.table === 'evenements')!;
    expect(filtresEq(lecture)).toEqual([
      ['id', 'evt-b'],
      ['organisation_id', ORG],
    ]);
    expect(envoyerOrdres).not.toHaveBeenCalled();
    expect(recap).not.toHaveBeenCalled();
  });

  it('M1.2/brouillon_reprise_put — le traiteur manager reprend le brouillon d’un collègue de son organisation', async () => {
    setupAuth('traiteur_manager', ORG, 'user-manager');
    enregistrementRend('evt-b', 'col-1');

    const res = await reprendre(
      'evt-b',
      corps([carte('zd')], { confirmer: false }),
    );

    expect(res.status).toBe(200);
    expect(rpc('fn_enregistrer_programmation')).toHaveLength(1);
  });

  for (const role of [
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
  ] as const) {
    it(`M1.2/brouillon_reprise_put — ${role} non créateur : 403, rien n’est lu au-delà du brouillon ni écrit`, async () => {
      setupAuth(role, ORG, 'user-collegue');

      const res = await reprendre('evt-b', corps([carte('zd')]));

      expect(res.status).toBe(403);
      aucuneEcriture();
      expect(recap).not.toHaveBeenCalled();
      // Refus sur la seule lecture du brouillon : ni référentiel, ni périmètre.
      expect(tables()).toEqual(['evenements']);
    });
  }

  it('M1.2/brouillon_reprise_put — brouillon d’une autre organisation : 404, rien n’est écrit', async () => {
    setupAuth('traiteur_manager', 'org-autre', 'user-createur');

    const res = await reprendre('evt-b', corps([carte('zd')]));

    expect(res.status).toBe(404);
    aucuneEcriture();
  });

  it('M1.2/brouillon_reprise_put — événement déjà (en partie) confirmé : 422, rien n’est écrit', async () => {
    setupAuth('traiteur_commercial', ORG, 'user-createur');

    const res = await reprendre('evt-c', corps([carte('zd')]));

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Cet événement n'est pas un brouillon.",
    );
    aucuneEcriture();
  });

  it('M1.2/brouillon_reprise_put — confirmé entre-temps (la RPC refuse en 22023) : 422, aucune suite', async () => {
    setupAuth('traiteur_commercial', ORG, 'user-createur');
    reponsesRpc.fn_enregistrer_programmation = {
      data: null,
      error: { code: '22023', message: 'Des collectes sont déjà confirmées' },
    };

    const res = await reprendre('evt-b', corps([carte('zd')]));

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Cet événement n'est plus un brouillon.",
    );
    expect(envoyerOrdres).not.toHaveBeenCalled();
    expect(recap).not.toHaveBeenCalled();
  });

  it('M1.2/brouillon_reprise_put — confirmation : RPC confirmée, envoi immédiat, email récapitulatif et suites', async () => {
    setupAuth('traiteur_commercial', ORG, 'user-createur');
    enregistrementRend('evt-b', 'col-1', 'col-2');

    const res = await reprendre(
      'evt-b',
      corps([carte('zd'), carte('ag', { heure_collecte: '23:00' })]),
    );

    expect(res.status).toBe(200);
    expect(rpc('fn_enregistrer_programmation')[0]!.args).toMatchObject({
      p_evenement_id: 'evt-b',
      p_confirmer: true,
    });
    expect(envoyerOrdres).toHaveBeenCalledWith(['col-1', 'col-2']);
    expect(recap).toHaveBeenCalledTimes(1);
    expect(recap).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        programmeurUserId: 'user-createur',
        evenementId: 'evt-b',
        nomEvenement: 'Gala B2',
        organisationId: ORG,
        lieuId: 'lieu-1',
        collecteIds: ['col-1', 'col-2'],
      }),
    );
    expect(autoAccept).toHaveBeenCalledTimes(1);
    expect(autoAccept).toHaveBeenCalledWith('col-2');
    expect(notifier).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ collecteId: 'col-1', acteurOrgId: ORG }),
    );
  });

  it('M1.2/brouillon_reprise_put — confirmation sans nom d’événement : 422, rien n’est écrit', async () => {
    setupAuth('traiteur_commercial', ORG, 'user-createur');

    const res = await reprendre(
      'evt-b',
      corps([carte('zd')], { nom_evenement: '   ' }),
    );

    expect(res.status).toBe(422);
    aucuneEcriture();
  });

  it('M1.2/brouillon_reprise_put — équipe Savr : l’organisation est lue sur le brouillon, jamais sur son JWT', async () => {
    setupAuth('admin_savr', 'org-savr', 'user-admin');
    enregistrementRend('evt-b', 'col-1');

    const res = await reprendre('evt-b', corps([carte('zd')]));

    expect(res.status).toBe(200);
    const lecture = requetes.find((r) => r.table === 'evenements')!;
    expect(filtresEq(lecture)).toEqual([['id', 'evt-b']]);
    expect(recap).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ organisationId: ORG }),
    );
  });
});

// ── Reprise d'un brouillon : traiteur opérant ───────────────────────────────

const TRAITEUR_REEL = {
  id: 'trt-reel',
  type: 'traiteur',
  est_shadow: false,
  actif: true,
  cree_par_organisation_id: null,
};
const TRAITEUR_AUTRE = { ...TRAITEUR_REEL, id: 'trt-autre' };

describe('M1.2 / programmation par cartes — reprise d’un brouillon : traiteur opérant', () => {
  const brouillonDe = (organisation_id: string, created_by: string) => ({
    id: 'evt-t',
    organisation_id,
    created_by,
    traiteur_operationnel_organisation_id: 'trt-reel',
    collectes: [{ statut: 'brouillon' }],
  });
  const traiteurEcrit = () =>
    (
      rpc('fn_enregistrer_programmation')[0]!.args.p_evenement as Record<
        string,
        unknown
      >
    ).traiteur_operationnel_organisation_id;

  beforeEach(() => {
    organisations = [TRAITEUR_REEL, TRAITEUR_AUTRE];
    liensLieux = [
      { id: 'lien-1', organisation_id: 'org-gest', lieu_id: 'lieu-1' },
    ];
  });

  it('M1.2/brouillon_reprise_traiteur — agence : le traiteur opérant du formulaire remplace celui du brouillon', async () => {
    evenements = [brouillonDe('org-agence', 'user-agence')];
    setupAuth('agence', 'org-agence', 'user-agence');
    enregistrementRend('evt-t', 'col-1');

    const res = await reprendre(
      'evt-t',
      corps([carte('zd')], {
        confirmer: false,
        traiteur_operationnel_organisation_id: 'trt-autre',
      }),
    );

    expect(res.status).toBe(200);
    expect(traiteurEcrit()).toBe('trt-autre');
  });

  it('M1.2/brouillon_reprise_traiteur — agence sans traiteur dans le corps : celui du brouillon est gardé, jamais l’agence', async () => {
    evenements = [brouillonDe('org-agence', 'user-agence')];
    setupAuth('agence', 'org-agence', 'user-agence');
    enregistrementRend('evt-t', 'col-1');

    const res = await reprendre(
      'evt-t',
      corps([carte('zd')], { confirmer: false }),
    );

    expect(res.status).toBe(200);
    expect(traiteurEcrit()).toBe('trt-reel');
  });

  it('M1.2/brouillon_reprise_traiteur — gestionnaire : traiteur du référentiel accepté ; absent du corps, celui du brouillon est gardé', async () => {
    evenements = [brouillonDe('org-gest', 'user-gest')];
    setupAuth('gestionnaire_lieux', 'org-gest', 'user-gest');
    enregistrementRend('evt-t', 'col-1');

    const avec = await reprendre(
      'evt-t',
      corps([carte('zd')], {
        confirmer: false,
        traiteur_operationnel_organisation_id: 'trt-autre',
      }),
    );
    expect(avec.status).toBe(200);
    expect(traiteurEcrit()).toBe('trt-autre');

    appelsRpc = [];
    const sans = await reprendre(
      'evt-t',
      corps([carte('zd')], { confirmer: false }),
    );
    expect(sans.status).toBe(200);
    expect(traiteurEcrit()).toBe('trt-reel');
  });

  it('M1.2/brouillon_reprise_traiteur — gestionnaire : traiteur shadow refusé (403), rien n’est écrit', async () => {
    evenements = [brouillonDe('org-gest', 'user-gest')];
    organisations = [TRAITEUR_REEL, { ...TRAITEUR_AUTRE, est_shadow: true }];
    setupAuth('gestionnaire_lieux', 'org-gest', 'user-gest');
    enregistrementRend('evt-t', 'col-1');

    const res = await reprendre(
      'evt-t',
      corps([carte('zd')], {
        confirmer: false,
        traiteur_operationnel_organisation_id: 'trt-autre',
      }),
    );

    expect(res.status).toBe(403);
    aucuneEcriture();
  });

  it('M1.2/brouillon_reprise_traiteur — équipe Savr qui reprend le brouillon d’une agence : le traiteur opérant ne change pas (I8)', async () => {
    evenements = [brouillonDe('org-agence', 'user-agence')];
    setupAuth('admin_savr', 'org-savr', 'user-admin');
    enregistrementRend('evt-t', 'col-1');

    const res = await reprendre(
      'evt-t',
      corps([carte('zd')], { confirmer: false }),
    );

    expect(res.status).toBe(200);
    expect(traiteurEcrit()).toBe('trt-reel');
  });
});

// ── Ajout d'une collecte : une carte ────────────────────────────────────────

const EVT_AJOUT = {
  id: 'evt-a',
  organisation_id: ORG,
  lieu_id: 'lieu-1',
  nom_evenement: 'Gala',
  collectes: [{ statut: 'programmee', controle_acces_requis: true }],
};

describe('M1.2 / programmation par cartes — ajout d’une collecte', () => {
  beforeEach(() => {
    evenements = [EVT_AJOUT];
  });

  it('M1.2/ajout_collecte_carte — carte complète : fn_creer_collecte_carte, contrôle d’accès de l’événement', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    reponsesRpc.fn_creer_collecte_carte = { data: 'col-ajoutee', error: null };
    const ag = carte('ag', {
      type_evenement_id: TYPE_B,
      contact_secours_nom: '  Sam Roux ',
      contact_secours_telephone: '0733333333',
    });

    const res = await ajouter('evt-a', ag);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ collecte_id: 'col-ajoutee' });
    expect(appelsRpc).toEqual([
      {
        nom: 'fn_creer_collecte_carte',
        args: {
          p_evenement_id: 'evt-a',
          p_carte: normalisee({ ...ag, contact_secours_nom: 'Sam Roux' }),
          p_controle_acces: true,
          p_lieu_overrides: null,
          p_confirmer: true,
        },
      },
    ]);
    expect(envoyerOrdres).toHaveBeenCalledWith('col-ajoutee');
    expect(autoAccept).toHaveBeenCalledWith('col-ajoutee');
    expect(recap).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        evenementId: 'evt-a',
        collecteIds: ['col-ajoutee'],
      }),
    );
  });

  for (const [nom, corpsAjout] of [
    ['sans type d’événement', sans(carte('zd'), 'type_evenement_id')],
    [
      'type d’événement inconnu',
      carte('zd', { type_evenement_id: TYPE_INCONNU }),
    ],
    ['sans contact principal', sans(carte('zd'), 'contact_principal_nom')],
    [
      'sans téléphone du contact principal',
      sans(carte('zd'), 'contact_principal_telephone'),
    ],
    ['contact principal vide', carte('zd', { contact_principal_nom: '  ' })],
  ] as const) {
    it(`M1.2/ajout_collecte_carte — carte ${nom} : 422, rien n’est créé`, async () => {
      setupAuth('traiteur_manager', ORG, 'user-1');
      reponsesRpc.fn_creer_collecte_carte = {
        data: 'col-ajoutee',
        error: null,
      };

      const res = await ajouter('evt-a', corpsAjout);

      expect(res.status).toBe(422);
      aucuneEcriture();
      // La carte est refusée avant même la lecture de l'événement.
      expect(tables()).not.toContain('evenements');
    });
  }
});

// ── GET d'un événement : les contacts de chaque collecte ────────────────────

const EVT_GET = {
  id: 'evt-g',
  organisation_id: ORG,
  nom_evenement: 'Gala',
  type_evenement: { libelle: 'Mariage' },
  traiteur_operationnel: { id: ORG, nom: '  ', raison_sociale: 'Traiteur SAS' },
  collectes: [
    {
      id: 'c1',
      type: 'zero_dechet',
      statut: 'programmee',
      controle_acces_requis: false,
      type_evenement: { libelle: 'Mariage' },
    },
    {
      id: 'c2',
      type: 'anti_gaspi',
      statut: 'programmee',
      controle_acces_requis: false,
      // Relation to-one rendue en tableau : tolérée.
      type_evenement: [{ libelle: 'Cocktail' }],
    },
    {
      id: 'c3',
      type: 'zero_dechet',
      statut: 'programmee',
      controle_acces_requis: false,
      type_evenement: null,
    },
  ],
};
const CONTACTS_C1 = {
  contact_principal_nom: 'Alice Martin',
  contact_principal_telephone: '0611111111',
  contact_secours_nom: null,
  contact_secours_telephone: null,
};
const CONTACTS_C2 = {
  contact_principal_nom: 'Bruno Petit',
  contact_principal_telephone: '0622222222',
  contact_secours_nom: 'Sam Roux',
  contact_secours_telephone: '0733333333',
};

describe('M1.2 / programmation par cartes — GET détail événement', () => {
  beforeEach(() => {
    evenements = [EVT_GET, { ...EVT_GET, id: 'evt-sans', collectes: [] }];
    contacts = [
      { collecte_id: 'c1', ...CONTACTS_C1 },
      { collecte_id: 'c2', ...CONTACTS_C2 },
      // Une collecte d'un autre événement : jamais demandée, jamais rendue.
      {
        collecte_id: 'c-autre',
        contact_principal_nom: 'Personne Ailleurs',
        contact_principal_telephone: '0699999999',
        contact_secours_nom: null,
        contact_secours_telephone: null,
      },
    ];
  });

  it('M1.2/get_evenement_contacts_par_collecte — contacts lus dans collecte_contacts après la garde, collés à chaque collecte', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');

    const res = await lire('evt-g');

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      collectes: Array<Record<string, unknown>>;
      type_evenement: unknown;
      traiteur_operationnel: unknown;
    };
    expect(
      json.collectes.map(({ id, type_evenement, contacts: c }) => ({
        id,
        type_evenement,
        contacts: c,
      })),
    ).toEqual([
      { id: 'c1', type_evenement: 'Mariage', contacts: CONTACTS_C1 },
      { id: 'c2', type_evenement: 'Cocktail', contacts: CONTACTS_C2 },
      // Aucune ligne : `null`, jamais les contacts d'une autre collecte.
      { id: 'c3', type_evenement: null, contacts: null },
    ]);
    expect(JSON.stringify(json)).not.toContain('Personne Ailleurs');
    expect(json.type_evenement).toBe('Mariage');
    expect(json.traiteur_operationnel).toEqual({
      id: ORG,
      nom: 'Traiteur SAS',
    });
    // Ordre : l'événement (garde de périmètre) d'abord, les contacts ensuite,
    // pour les seules collectes de cet événement, colonnes de contact seules.
    expect(tables()[0]).toBe('evenements');
    expect(tables().indexOf('collecte_contacts')).toBeGreaterThan(0);
    const lecture = requetes.find((r) => r.table === 'collecte_contacts')!;
    expect(lecture.maillons).toEqual([
      [
        'select',
        [
          'collecte_id, contact_principal_nom, contact_principal_telephone, contact_secours_nom, contact_secours_telephone',
        ],
      ],
      ['in', ['collecte_id', ['c1', 'c2', 'c3']]],
    ]);
  });

  it('M1.2/get_evenement_collectes_ordre_creation — collectes rendues dans l’ordre de création, pas dans celui des identifiants', async () => {
    // Identifiants dans l'ordre inverse des créations : seul `created_at`
    // donne l'ordre d'enregistrement des cartes (reprise d'un brouillon).
    evenements = [
      {
        ...EVT_GET,
        collectes: [
          {
            ...EVT_GET.collectes[0],
            id: 'aaa',
            created_at: '2097-01-01T10:00:00.003Z',
          },
          {
            ...EVT_GET.collectes[1],
            id: 'bbb',
            created_at: '2097-01-01T10:00:00.001Z',
          },
          {
            ...EVT_GET.collectes[2],
            id: 'ccc',
            created_at: '2097-01-01T10:00:00.002Z',
          },
        ],
      },
    ];
    setupAuth('traiteur_manager', ORG, 'user-1');

    const res = await lire('evt-g');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { collectes: Array<{ id: string }> };
    expect(json.collectes.map((c) => c.id)).toEqual(['bbb', 'ccc', 'aaa']);
  });

  it('M1.2/get_evenement_contacts_par_collecte — lecture des contacts en échec : 500, jamais « aucun contact »', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');
    erreurContacts = { code: '42501', message: 'permission denied for table' };

    const res = await lire('evt-g');

    expect(res.status).toBe(500);
    const brut = await res.text();
    expect(brut).not.toContain('permission denied');
    expect(brut).not.toContain('Alice Martin');
  });

  it('M1.2/get_evenement_contacts_par_collecte — événement hors périmètre : 404, contacts jamais lus', async () => {
    setupAuth('traiteur_manager', 'org-autre', 'user-autre');

    const res = await lire('evt-g');

    expect(res.status).toBe(404);
    const brut = await res.text();
    expect(brut).not.toContain('Alice Martin');
    expect(tables()).toEqual(['evenements']);
    expect(filtresEq(requetes[0]!)).toEqual([
      ['id', 'evt-g'],
      ['organisation_id', 'org-autre'],
    ]);
  });

  it('M1.2/get_evenement_contacts_par_collecte — événement sans collecte : aucune lecture des contacts', async () => {
    setupAuth('traiteur_manager', ORG, 'user-1');

    const res = await lire('evt-sans');

    expect(res.status).toBe(200);
    expect(tables()).not.toContain('collecte_contacts');
  });
});
