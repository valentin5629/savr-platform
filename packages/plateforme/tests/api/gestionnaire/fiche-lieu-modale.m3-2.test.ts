/**
 * M3.2 — Fiche lieu du gestionnaire en pop-up (§06.05 §3, arbitrage Val
 * 2026-10-06) : routes serveur.
 *  - GET  /api/v1/gestionnaire/lieux/[id] : informations, traiteurs opérant
 *    (calculés depuis les collectes du lieu, tous statuts), activité 12 mois,
 *    état « demande de modification en cours » ;
 *  - POST /api/v1/gestionnaire/lieux/[id]/demande-modification : alerte in-app
 *    Admin, jamais d'écriture du référentiel lieux, aucune donnée personnelle
 *    recopiée.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { entiteHref, severiteParCode } from '@/lib/alertes-admin';
import {
  CODE_ALERTE_LIEU_MODIFICATION,
  LONGUEUR_MAX_DEMANDE,
} from '@/lib/lieux/demande-modification';

type Result = { data: unknown; error: unknown };
type Appel = { methode: string; args: unknown[] };

// Client Supabase simulé : chaque requête consomme la réponse suivante de la
// file ; tous les appels sont enregistrés dans l'ordre (table lue, filtres,
// écritures) pour vérifier ce que la route demande réellement.
function makeChain() {
  const queue: Result[] = [];
  const appels: Appel[] = [];
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    appels,
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
    'gte',
    'order',
    'limit',
    'range',
    'update',
    'delete',
  ]) {
    chain[m] = (...args: unknown[]) => {
      appels.push({ methode: m, args });
      return chain;
    };
  }
  // insert : écriture terminale (audit_log) — attendue directement.
  chain.insert = (...args: unknown[]) => {
    appels.push({ methode: 'insert', args });
    return Promise.resolve(next());
  };
  chain.maybeSingle = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    appels.push({ methode: 'rpc', args });
    return Promise.resolve(next());
  };
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    appels: Appel[];
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
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

const LIEU = '11111111-1111-4111-8111-111111111111';
const KASPIA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nom: 'Kaspia' };
const BUTARD = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nom: 'Butard' };
const ARPEGE = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', nom: 'Arpège' };

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role = 'gestionnaire_lieux') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-gl' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: 'org-viparis',
        }),
      },
    },
    error: null,
  });
}

const tables = (c: { appels: Appel[] }) =>
  c.appels.filter((a) => a.methode === 'from').map((a) => a.args[0]);
const appelsDe = (c: { appels: Appel[] }, methode: string) =>
  c.appels.filter((a) => a.methode === methode);

function joursAvant(n: number): string {
  return jourParis(new Date(Date.now() - n * 24 * 3600 * 1000));
}

function collecte(
  id: string,
  traiteur: { id: string; nom: string } | null,
  o: { statut?: string; date?: string; kg?: number; type?: string } = {},
) {
  return {
    id,
    type: o.type ?? 'zero_dechet',
    statut: o.statut ?? 'cloturee',
    date_collecte: o.date ?? joursAvant(30),
    taux_recyclage: 0.9,
    evenements: {
      lieu_id: LIEU,
      traiteur_operationnel_organisation_id: traiteur?.id ?? 'illisible',
      organisations: traiteur,
    },
    collecte_flux: o.kg != null ? [{ poids_reel_kg: o.kg }] : [],
  };
}

const LIEU_ROW = {
  id: LIEU,
  nom: 'CNIT Forest',
  adresse_acces: '2 place de la Défense',
  code_postal: '92800',
  ville: 'Puteaux',
  region: 'idf',
  type_vehicule_max: 'poids_lourd',
  capacite_maximum: 3500,
  acces_office: 'difficile',
  stationnement: 'facile',
  photos_urls: ['https://r2/p1.jpg'],
  flux_autorises: ['biodechet'],
};

// Réponses des deux premières lectures de la fiche : le lieu (v_lieux_clients)
// puis son rattachement au parc de l'organisation (organisations_lieux).
function lieuDuParc(duParc = true) {
  rls.push({ data: LIEU_ROW, error: null });
  rls.push({ data: duParc ? { lieu_id: LIEU } : null, error: null });
}

async function getFiche(id = LIEU) {
  const { GET } = await import('@/app/api/v1/gestionnaire/lieux/[id]/route.js');
  return GET(
    new NextRequest(`http://localhost/api/v1/gestionnaire/lieux/${id}`),
    { params: Promise.resolve({ id }) },
  );
}

async function postDemande(body: unknown, id = LIEU) {
  const { POST } =
    await import('@/app/api/v1/gestionnaire/lieux/[id]/demande-modification/route.js');
  return POST(
    new NextRequest(
      `http://localhost/api/v1/gestionnaire/lieux/${id}/demande-modification`,
      {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      },
    ),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
  setupAuth();
});

interface Fiche {
  capacite_maximum: number;
  photos_urls: string[];
  collectes: { id: string; collecte_flux: { poids_reel_kg: number }[] }[];
  traiteurs: {
    id: string;
    nom: string;
    nb_collectes: number;
    tonnage_kg: number;
  }[];
  demande_modification_possible: boolean;
  demande_modification_en_cours: boolean;
}

describe('M3.2 / fiche lieu — lecture', () => {
  it('M3.2/P2_lieu_detail_capacite_photos_collectes — champs rendus retournés', async () => {
    lieuDuParc(); // v_lieux_clients
    rls.push({
      data: [collecte('c1', KASPIA, { kg: 250 })],
      error: null,
    }); // collectes du lieu
    const res = await getFiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Fiche };
    expect(data.capacite_maximum).toBe(3500);
    expect(data.photos_urls).toEqual(['https://r2/p1.jpg']);
    expect(data.collectes).toHaveLength(1);
    expect(data.collectes[0]?.collecte_flux[0]?.poids_reel_kg).toBe(250);
    // La fiche lit la vue masquée, jamais la table lieux.
    expect([...new Set(tables(rls))]).toEqual([
      'v_lieux_clients',
      'organisations_lieux',
      'collectes',
    ]);
  });

  it('M3.2/fiche_lieu_traiteurs_tous_statuts_tries — liste complète, tous statuts, sans limite de date', async () => {
    lieuDuParc();
    rls.push({
      data: [
        collecte('c1', KASPIA, { kg: 300 }),
        collecte('c2', KASPIA, { statut: 'annulee' }),
        // Hors fenêtre de 12 mois : compte pour la liste des traiteurs.
        collecte('c3', KASPIA, { date: joursAvant(900), kg: 200 }),
        collecte('c4', BUTARD, { statut: 'programmee' }),
        // Réalisée, pas encore clôturée : comptée, mais ses pesées ne sont pas
        // sommées (le tonnage suit la règle de la liste Lieux : clôturées).
        collecte('c7', BUTARD, { statut: 'realisee', kg: 999 }),
        collecte('c5', ARPEGE, { statut: 'validee' }),
        // Traiteur illisible pour la session : ligne ignorée, pas d'erreur.
        collecte('c6', null),
      ],
      error: null,
    });
    const { data } = (await (await getFiche()).json()) as { data: Fiche };
    expect(data.traiteurs).toEqual([
      { id: KASPIA.id, nom: 'Kaspia', nb_collectes: 3, tonnage_kg: 500 },
      { id: BUTARD.id, nom: 'Butard', nb_collectes: 2, tonnage_kg: 0 },
      { id: ARPEGE.id, nom: 'Arpège', nb_collectes: 1, tonnage_kg: 0 },
    ]);
    // La lecture ne filtre ni le statut ni la date : seul le lieu est filtré.
    const filtres = new Set(appelsDe(rls, 'eq').map((a) => a.args[0]));
    expect([...filtres]).toEqual([
      'id',
      'organisation_id',
      'lieu_id',
      'evenements.lieu_id',
    ]);
    expect(appelsDe(rls, 'gte')).toHaveLength(0);
  });

  it('M3.2/fiche_lieu_traiteurs_plafond_inferieur — un plafond de réponse plus bas que la tranche ne tronque rien', async () => {
    // Projet dont `max_rows` vaut 100 : chaque réponse est plafonnée, la
    // lecture avance du nombre de lignes REÇUES jusqu'à une tranche vide.
    lieuDuParc();
    for (const [prefixe, n] of [
      ['a', 100],
      ['b', 100],
      ['c', 40],
    ] as const) {
      rls.push({
        data: Array.from({ length: n }, (_, i) =>
          collecte(`${prefixe}-${i}`, KASPIA, { statut: 'programmee' }),
        ),
        error: null,
      });
    }
    const { data } = (await (await getFiche()).json()) as { data: Fiche };
    expect(data.traiteurs[0]?.nb_collectes).toBe(240);
    expect(appelsDe(rls, 'range').map((a) => a.args[0])).toEqual([
      0, 100, 200, 240,
    ]);
  });

  it('M3.2/fiche_lieu_activite_12_mois_cloturees_seules — onglet Activité : clôturées des 12 derniers mois', async () => {
    lieuDuParc();
    rls.push({
      data: [
        collecte('recente', KASPIA, { date: joursAvant(10), kg: 100 }),
        collecte('programmee', KASPIA, {
          statut: 'programmee',
          date: joursAvant(5),
        }),
        collecte('ancienne', KASPIA, { date: joursAvant(500), kg: 80 }),
        collecte('sans_date', KASPIA, { date: undefined }),
      ].map((c) => (c.id === 'sans_date' ? { ...c, date_collecte: null } : c)),
      error: null,
    });
    const { data } = (await (await getFiche()).json()) as { data: Fiche };
    expect(data.collectes.map((c) => c.id)).toEqual(['recente']);
    // Les quatre comptent en revanche pour la liste des traiteurs.
    expect(data.traiteurs[0]?.nb_collectes).toBe(4);
  });

  it('M3.2/fiche_lieu_demande_en_cours_exposee — une alerte ouverte neutralise le bouton, son contenu ne sort pas', async () => {
    lieuDuParc();
    rls.push({ data: [], error: null });
    admin.push({ data: { id: 'alerte-1' }, error: null });
    const res = await getFiche();
    const json = (await res.json()) as { data: Fiche };
    expect(json.data.demande_modification_possible).toBe(true);
    expect(json.data.demande_modification_en_cours).toBe(true);
    expect(JSON.stringify(json)).not.toContain('alerte-1');
    expect(tables(admin)).toEqual(['alertes_admin']);
    expect(appelsDe(admin, 'eq').map((a) => a.args)).toEqual([
      ['code', CODE_ALERTE_LIEU_MODIFICATION],
      ['entity_type', 'lieux'],
      ['entity_id', LIEU],
      ['statut', 'ouverte'],
    ]);

    // Aucune alerte ouverte → le bouton reste actif.
    rls = makeChain();
    admin = makeChain();
    lieuDuParc();
    rls.push({ data: [], error: null });
    const libre = (await (await getFiche()).json()) as { data: Fiche };
    expect(libre.data.demande_modification_en_cours).toBe(false);
  });

  it('M3.2/fiche_lieu_demande_lecture_en_echec_500 — l’état de la demande illisible n’est pas rendu comme « aucune demande »', async () => {
    lieuDuParc();
    rls.push({ data: [], error: null });
    admin.push({ data: null, error: { message: 'boom', code: 'XX000' } });
    const res = await getFiche();
    expect(res.status).toBe(500);
  });

  it('M3.2/fiche_lieu_hors_parc_consultation_seule — lieu lisible mais hors du parc : fiche servie, demande non proposée, file Admin jamais interrogée', async () => {
    // Cas réel : l'organisation a programmé un événement sur un lieu détaché
    // de son parc depuis (lieux_clients_select le lui laisse lire).
    lieuDuParc(false);
    rls.push({ data: [collecte('c1', KASPIA, { kg: 120 })], error: null });
    const res = await getFiche();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Fiche };
    expect(data.traiteurs).toHaveLength(1);
    expect(data.demande_modification_possible).toBe(false);
    // Une demande ouverte par le vrai gestionnaire du lieu ne se lit pas d'ici.
    expect(data.demande_modification_en_cours).toBe(false);
    expect(admin.appels).toHaveLength(0);
    // Le parc est lu pour SON organisation.
    expect(appelsDe(rls, 'eq').map((a) => a.args)).toContainEqual([
      'organisation_id',
      'org-viparis',
    ]);
  });

  it('M3.2/fiche_lieu_hors_perimetre_sans_lecture_service_role — un lieu que la session ne lit pas : 404, file Admin jamais interrogée', async () => {
    rls.push({ data: null, error: null });
    const res = await getFiche();
    expect(res.status).toBe(404);
    expect(admin.appels).toHaveLength(0);
  });

  it('M3.2/fiche_lieu_identifiant_mal_forme_404 — un identifiant mal formé n’atteint pas la base', async () => {
    const res = await getFiche('abc');
    expect(res.status).toBe(404);
    expect(rls.appels).toHaveLength(0);
    expect(admin.appels).toHaveLength(0);
  });

  it('M3.2/fiche_lieu_erreur_collectes_500 — une lecture en échec ne se lit pas comme un lieu sans traiteur', async () => {
    lieuDuParc();
    rls.push({ data: null, error: { message: 'boom', code: 'XX000' } });
    const res = await getFiche();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
  });

  it('M3.2/fiche_lieu_role_non_gestionnaire_403 — réservée au gestionnaire de lieux', async () => {
    setupAuth('traiteur_manager');
    const res = await getFiche();
    expect(res.status).toBe(403);
    expect(rls.appels).toHaveLength(0);
  });
});

describe('M3.2 / fiche lieu — demande de modification', () => {
  const MESSAGE = 'La capacité est de 4 000 personnes, pas 3 500.';
  const BOOM = { message: 'boom', code: 'XX000' };
  const DU_PARC = { data: { lieu_id: LIEU }, error: null };
  const LIEU_LU = { data: { id: LIEU, nom: 'CNIT Forest' }, error: null };
  const RIEN = { data: null, error: null };

  // Ordre des lecteurs : parc (session) → lieu (session) → demande ouverte ?
  // (service-role) → organisation (session) → insert alerte → insert audit.
  function preparerDemande() {
    rls.push(DU_PARC);
    rls.push(LIEU_LU);
    admin.push(RIEN); // aucune alerte ouverte
    rls.push({ data: { nom: 'Viparis' }, error: null }); // organisation
  }

  it('M3.2/demande_modification_lieu_cree_alerte_admin — alerte in-app rattachée au lieu, auteur tracé', async () => {
    preparerDemande();
    const res = await postDemande({ texte: `  ${MESSAGE}  ` });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { demandee: true } });

    const [alerte, audit] = appelsDe(admin, 'insert');
    expect(alerte?.args[0]).toEqual({
      code: 'lieu_modification_demandee',
      titre: 'Modification d’un lieu demandée par son gestionnaire',
      // Le texte du client est délimité par des guillemets, après le préfixe
      // écrit par la route.
      message: `Lieu « CNIT Forest » — demande de Viparis : « ${MESSAGE} »`,
      entity_type: 'lieux',
      entity_id: LIEU,
    });
    // Trace d'auteur : historique de la fiche lieu Admin (qui, quand).
    expect(audit?.args[0]).toEqual({
      table_name: 'lieux',
      record_id: LIEU,
      action: 'lieu_modification_demandee',
      user_id: 'user-gl',
      role: 'gestionnaire_lieux',
      impersonator_id: null,
    });
    // Ni nom ni email du demandeur dans l'alerte : la table users n'est pas lue.
    expect(tables(rls)).not.toContain('users');
    // Insertion directe : f_upsert_alerte_admin ignorerait en silence une
    // seconde demande simultanée.
    expect(appelsDe(admin, 'rpc')).toHaveLength(0);
  });

  it('M3.2/demande_modification_lieu_n_ecrit_pas_le_referentiel — la table lieux n’est ni lue en direct ni écrite', async () => {
    preparerDemande();
    await postDemande({ texte: MESSAGE });
    expect(tables(rls)).toEqual([
      'organisations_lieux',
      'v_lieux_clients',
      'organisations',
    ]);
    // Lecture « demande ouverte ? », puis les deux seules écritures.
    expect(tables(admin)).toEqual([
      'alertes_admin',
      'alertes_admin',
      'audit_log',
    ]);
    for (const client of [rls, admin]) {
      expect(appelsDe(client, 'update')).toHaveLength(0);
      expect(appelsDe(client, 'delete')).toHaveLength(0);
    }
    expect(appelsDe(rls, 'insert')).toHaveLength(0);
    expect(appelsDe(admin, 'insert')).toHaveLength(2);
  });

  it('M3.2/demande_modification_lieu_hors_perimetre_404 — lieu hors du parc de l’organisation (inconnu, ou seulement lisible) : même 404, rien n’est écrit', async () => {
    rls.push(RIEN); // organisations_lieux : pas de rattachement
    const res = await postDemande({ texte: MESSAGE });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Lieu non trouvé' });
    // Arrêt avant même la lecture du lieu : aucun signal sur son existence.
    expect(tables(rls)).toEqual(['organisations_lieux']);
    expect(admin.appels).toHaveLength(0);
    // Le rattachement est cherché pour l'organisation de la session.
    expect(appelsDe(rls, 'eq').map((a) => a.args)).toEqual([
      ['organisation_id', 'org-viparis'],
      ['lieu_id', LIEU],
    ]);
  });

  it('M3.2/demande_modification_lieu_deja_ouverte_409 — une demande ouverte par lieu', async () => {
    rls.push(DU_PARC);
    rls.push(LIEU_LU);
    admin.push({ data: { id: 'alerte-1' }, error: null });
    const res = await postDemande({ texte: MESSAGE });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Une demande est déjà en cours de traitement pour ce lieu.',
    });
    expect(appelsDe(admin, 'insert')).toHaveLength(0);
  });

  it('M3.2/demande_modification_lieu_envoi_simultane_409 — l’index unique refuse le second insert (23505) : 409, pas de trace d’audit', async () => {
    preparerDemande();
    // La lecture n'a rien vu (envoi concurrent) ; la base refuse l'insert.
    admin.push({
      data: null,
      error: { message: 'duplicate key', code: '23505' },
    });
    const res = await postDemande({ texte: MESSAGE });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Une demande est déjà en cours de traitement pour ce lieu.',
    });
    // Un seul insert tenté (l'alerte) : pas d'audit pour une demande refusée.
    expect(appelsDe(admin, 'insert')).toHaveLength(1);
  });

  it.each([
    ['absent', {}],
    ['non textuel', { texte: 42 }],
    ['trop court', { texte: 'ok' }],
    ['blancs seuls', { texte: '             ' }],
    ['trop long', { texte: 'x'.repeat(LONGUEUR_MAX_DEMANDE + 1) }],
    ['caractère de contrôle', { texte: `Capacité fausse\u0000 à corriger` }],
    ['demi-surrogate orphelin', { texte: `Capacité fausse \ud800 ici` }],
    ['caractères sans rendu seuls', { texte: '\u200B'.repeat(12) }],
  ])(
    'M3.2/demande_modification_lieu_message_invalide_422 — %s',
    async (_cas, body) => {
      const res = await postDemande(body);
      expect(res.status).toBe(422);
      // Refus avant toute lecture ou écriture.
      expect(rls.appels).toHaveLength(0);
      expect(admin.appels).toHaveLength(0);
    },
  );

  it('M3.2/demande_modification_lieu_caracteres_invisibles_retires — largeur nulle et marques de direction ne sortent pas dans l’alerte', async () => {
    preparerDemande();
    const res = await postDemande({
      texte: `\u202ELa capacité\u200B est de 4 000\u2066 personnes.\uFEFF`,
    });
    expect(res.status).toBe(201);
    const alerte = appelsDe(admin, 'insert')[0]?.args[0] as { message: string };
    expect(alerte.message).toBe(
      'Lieu « CNIT Forest » — demande de Viparis : « La capacité est de 4 000 personnes. »',
    );
  });

  it('M3.2/demande_modification_lieu_message_borne_acceptee — 1 000 caractères et sauts de ligne passent', async () => {
    preparerDemande();
    const long = `Ligne 1\nLigne 2\t${'x'.repeat(LONGUEUR_MAX_DEMANDE - 16)}`;
    expect(long).toHaveLength(LONGUEUR_MAX_DEMANDE);
    const res = await postDemande({ texte: long });
    expect(res.status).toBe(201);
  });

  it('M3.2/demande_modification_lieu_corps_illisible_400 — corps JSON malformé', async () => {
    const res = await postDemande('{pas du json');
    expect(res.status).toBe(400);
    expect(rls.appels).toHaveLength(0);
  });

  it('M3.2/demande_modification_lieu_role_non_gestionnaire_403 — un traiteur ne peut pas déposer de demande', async () => {
    setupAuth('traiteur_manager');
    const res = await postDemande({ texte: MESSAGE });
    expect(res.status).toBe(403);
    expect(rls.appels).toHaveLength(0);
    expect(admin.appels).toHaveLength(0);
  });

  it('M3.2/demande_modification_lieu_identifiant_mal_forme_404 — identifiant mal formé', async () => {
    const res = await postDemande({ texte: MESSAGE }, 'abc');
    expect(res.status).toBe(404);
    expect(rls.appels).toHaveLength(0);
  });

  it('M3.2/demande_modification_lieu_alerte_en_echec_500 — l’échec de l’alerte n’est pas annoncé comme un succès', async () => {
    preparerDemande();
    admin.push({ data: null, error: BOOM }); // alerte
    const res = await postDemande({ texte: MESSAGE });
    expect(res.status).toBe(500);
    // Pas de trace d'audit pour une demande qui n'existe pas.
    expect(appelsDe(admin, 'insert')).toHaveLength(1);
  });

  it('M3.2/demande_modification_lieu_lectures_en_echec_500 — parc, lieu, demande ouverte ou organisation illisibles : rien n’est écrit', async () => {
    const cas: Array<() => void> = [
      () => rls.push({ data: null, error: BOOM }), // parc
      () => {
        rls.push(DU_PARC);
        rls.push({ data: null, error: BOOM }); // lieu
      },
      () => {
        rls.push(DU_PARC);
        rls.push(LIEU_LU);
        admin.push({ data: null, error: BOOM }); // demande ouverte ?
      },
      () => {
        rls.push(DU_PARC);
        rls.push(LIEU_LU);
        admin.push(RIEN);
        rls.push({ data: null, error: BOOM }); // organisation
      },
    ];
    for (const preparer of cas) {
      rls = makeChain();
      admin = makeChain();
      preparer();
      expect((await postDemande({ texte: MESSAGE })).status).toBe(500);
      expect(appelsDe(admin, 'insert')).toHaveLength(0);
    }
  });

  it('M3.2/demande_modification_lieu_du_parc_illisible_404 — lieu rattaché mais non servi par la vue : 404, rien n’est écrit', async () => {
    rls.push(DU_PARC);
    rls.push(RIEN); // v_lieux_clients ne rend pas le lieu
    const res = await postDemande({ texte: MESSAGE });
    expect(res.status).toBe(404);
    expect(admin.appels).toHaveLength(0);
  });

  it('M3.2/demande_modification_lieu_audit_en_echec_demande_conservee — l’alerte posée, un audit en échec ne fait pas échouer la demande', async () => {
    preparerDemande();
    admin.push(RIEN); // alerte OK
    admin.push({ data: null, error: BOOM }); // audit
    const res = await postDemande({ texte: MESSAGE });
    expect(res.status).toBe(201);
  });
});

describe('M3.2 / fiche lieu — alerte côté Admin', () => {
  it('M3.2/alerte_lieu_modification_severite_et_lien — « À traiter », lien vers la fiche lieu Admin', () => {
    expect(severiteParCode(CODE_ALERTE_LIEU_MODIFICATION)).toBe('attention');
    expect(entiteHref('lieux', LIEU)).toBe(`/admin/lieux?edit=${LIEU}`);
  });
});
