/**
 * M3.2 — « Demander l'ajout d'un lieu », liste Lieux du gestionnaire (§06.05 §3
 * « Ajout / retrait lieu », arbitrages Val 2026-10-07) : routes serveur.
 *  - POST /api/v1/gestionnaire/lieux/demande-ajout : alerte in-app Admin
 *    rattachée à l'organisation du demandeur, une seule ouverte à la fois,
 *    jamais d'email, jamais d'écriture de `lieux` ni de `organisations_lieux`,
 *    aucune donnée personnelle recopiée ;
 *  - GET (même adresse) : état « une demande est ouverte », sans son contenu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { logger } from '@savr/shared/src/logger/index.js';
import { entiteHref, severiteParCode } from '@/lib/alertes-admin';
import {
  BORNES_DEMANDE_AJOUT,
  CODE_ALERTE_LIEU_AJOUT,
} from '@/lib/lieux/demande-ajout';

type Result = { data: unknown; error: unknown };
type Appel = { methode: string; args: unknown[] };

// Client Supabase simulé : chaque requête consomme la réponse suivante de la
// file ; tous les appels sont enregistrés dans l'ordre (table, filtres,
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
  for (const m of ['from', 'select', 'eq', 'limit', 'update', 'delete']) {
    chain[m] = (...args: unknown[]) => {
      appels.push({ methode: m, args });
      return chain;
    };
  }
  for (const m of ['insert', 'rpc']) {
    chain[m] = (...args: unknown[]) => {
      appels.push({ methode: m, args });
      return Promise.resolve(next());
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    appels: Appel[];
  };
}

let rls = makeChain();
let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const sendEmail = vi.fn();

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
// La route n'envoie aucun email : un envoi ajouté plus tard ferait échouer le
// cas « ni lieu ni rattachement ».
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const URL_ROUTE = 'http://localhost/api/v1/gestionnaire/lieux/demande-ajout';
const AUTRES_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'client_organisateur',
  'admin_savr',
];

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(claims: Record<string, unknown> = {}) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-gl' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: 'gestionnaire_lieux',
          organisation_id: ORG,
          ...claims,
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
// Filtres posés sur la lecture « demande ouverte », sans dépendre de leur ordre.
const filtres = (c: { appels: Appel[] }) =>
  Object.fromEntries(appelsDe(c, 'eq').map((a) => a.args as [string, unknown]));

async function postDemande(body: unknown) {
  const { POST } =
    await import('@/app/api/v1/gestionnaire/lieux/demande-ajout/route.js');
  return POST(
    new NextRequest(URL_ROUTE, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}
async function getEtat() {
  const { GET } =
    await import('@/app/api/v1/gestionnaire/lieux/demande-ajout/route.js');
  return GET(new NextRequest(URL_ROUTE));
}

const DEMANDE = {
  nom: 'Pavillon Dauphine',
  adresse: 'Place du Maréchal de Lattre de Tassigny, 75116 Paris',
};
const BOOM = { message: 'boom', code: 'XX000' };
const RIEN = { data: null, error: null };
const OUVERTE = { data: { id: 'alerte-ouverte' }, error: null };
const VIPARIS = { data: { nom: 'Viparis' }, error: null };
const DEJA =
  'Une demande d’ajout est déjà en cours de traitement par l’équipe Savr.';

// Ordre des lecteurs : demande ouverte ? (service-role) → organisation
// (session) → insert alerte → insert audit.
function preparerDemande() {
  admin.push(RIEN);
  rls.push(VIPARIS);
}

const message = () => {
  const [alerte] = appelsDe(admin, 'insert');
  return (alerte?.args[0] as { message: string }).message;
};
const erreur = async (res: Response) =>
  ((await res.json()) as { error: string }).error;

const car = (code: number) => String.fromCharCode(code);

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
  setupAuth();
});

describe('M3.2 / liste Lieux — demande d’ajout d’un lieu', () => {
  it('M3.2/demande_ajout_lieu_cree_alerte_admin — alerte in-app rattachée à l’organisation, auteur tracé', async () => {
    preparerDemande();
    const res = await postDemande({
      nom: `  ${DEMANDE.nom}  `,
      adresse: ` ${DEMANDE.adresse} `,
      precision: ' Premier événement prévu en mars. ',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { demandee: true } });

    const [alerte, audit] = appelsDe(admin, 'insert');
    expect(alerte?.args[0]).toEqual({
      code: 'lieu_ajout_demande',
      titre: 'Ajout d’un lieu demandé par un gestionnaire',
      // Les textes du client sont délimités par des guillemets, dans la phrase
      // écrite par la route.
      message:
        `Viparis demande l’ajout du lieu « ${DEMANDE.nom} », ` +
        `adresse « ${DEMANDE.adresse} » ; ` +
        'précision : « Premier événement prévu en mars. »',
      entity_type: 'organisations',
      entity_id: ORG,
    });
    // Trace d'auteur : qui, quand — sans les textes saisis.
    expect(audit?.args[0]).toEqual({
      table_name: 'organisations',
      record_id: ORG,
      action: 'lieu_ajout_demande',
      user_id: 'user-gl',
      role: 'gestionnaire_lieux',
      impersonator_id: null,
    });
    // Ni nom ni email du demandeur dans l'alerte : la table users n'est pas lue.
    expect(tables(rls)).not.toContain('users');
  });

  it('M3.2/demande_ajout_lieu_n_ecrit_ni_lieu_ni_rattachement — ni `lieux` ni `organisations_lieux`, aucun email', async () => {
    preparerDemande();
    await postDemande(DEMANDE);
    const lues = [...tables(rls), ...tables(admin)];
    expect(lues).not.toContain('lieux');
    expect(lues).not.toContain('organisations_lieux');
    expect(new Set(lues)).toEqual(
      new Set(['organisations', 'alertes_admin', 'audit_log']),
    );
    for (const client of [rls, admin]) {
      expect(appelsDe(client, 'update')).toHaveLength(0);
      expect(appelsDe(client, 'delete')).toHaveLength(0);
    }
    // Deux écritures seulement, sous service-role : l'alerte puis sa trace.
    expect(appelsDe(rls, 'insert')).toHaveLength(0);
    expect(appelsDe(admin, 'insert')).toHaveLength(2);
    // Insertion directe : f_upsert_alerte_admin ignorerait en silence une
    // seconde demande simultanée.
    expect(appelsDe(admin, 'rpc')).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('M3.2/demande_ajout_lieu_organisation_de_la_session — une organisation passée dans le corps est ignorée', async () => {
    preparerDemande();
    const AUTRE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const res = await postDemande({
      ...DEMANDE,
      organisation_id: AUTRE,
      entity_id: AUTRE,
    });
    expect(res.status).toBe(201);
    const [alerte, audit] = appelsDe(admin, 'insert');
    expect((alerte?.args[0] as { entity_id: string }).entity_id).toBe(ORG);
    expect((audit?.args[0] as { record_id: string }).record_id).toBe(ORG);
    // La demande ouverte et le nom lus sont ceux de l'organisation de la session.
    expect(filtres(admin).entity_id).toBe(ORG);
    expect(filtres(rls)).toEqual({ id: ORG });
  });

  it('M3.2/demande_ajout_lieu_precision_facultative — absente, vide ou blanche : pas de mention dans l’alerte', async () => {
    for (const precision of [undefined, null, '', '   ']) {
      rls = makeChain();
      admin = makeChain();
      preparerDemande();
      const res = await postDemande({ ...DEMANDE, precision });
      expect(res.status).toBe(201);
      expect(message()).toBe(
        `Viparis demande l’ajout du lieu « ${DEMANDE.nom} », adresse « ${DEMANDE.adresse} »`,
      );
    }
  });

  it('M3.2/demande_ajout_lieu_champs_invalides_422 — nom ou adresse absent, trop court, trop long, mal typé ou porteur de caractères de contrôle : rien n’est lu ni écrit', async () => {
    const { nom, adresse, precision } = BORNES_DEMANDE_AJOUT;
    const cas: Array<[unknown, RegExp]> = [
      [{ adresse: DEMANDE.adresse }, /nom du lieu est obligatoire/],
      [{ ...DEMANDE, nom: 42 }, /nom du lieu est obligatoire/],
      [{ ...DEMANDE, nom: 'A' }, /nom du lieu est obligatoire \(2 caractères/],
      [{ ...DEMANDE, nom: '   ' }, /nom du lieu est obligatoire/],
      [
        { ...DEMANDE, nom: 'N'.repeat(nom.max + 1) },
        /nom du lieu ne doit pas dépasser 150/,
      ],
      [{ ...DEMANDE, nom: `Pavillon${car(0)}` }, /nom du lieu contient/],
      [{ ...DEMANDE, nom: `Pavillon${car(7)}` }, /nom du lieu contient/],
      // Demi-surrogate orphelin : refusé ici, il ferait échouer l'écriture.
      [{ ...DEMANDE, nom: `Pavillon${car(0xd800)}` }, /nom du lieu contient/],
      [{ nom: DEMANDE.nom }, /adresse est obligatoire/],
      [{ ...DEMANDE, adresse: ['rue'] }, /adresse est obligatoire/],
      [
        { ...DEMANDE, adresse: 'rue' },
        /adresse est obligatoire \(5 caractères/,
      ],
      [
        { ...DEMANDE, adresse: 'A'.repeat(adresse.max + 1) },
        /adresse ne doit pas dépasser 300/,
      ],
      [{ ...DEMANDE, adresse: `1 rue${car(0x1b)}` }, /adresse contient/],
      [{ ...DEMANDE, precision: 12 }, /précision doit être un texte/],
      [
        { ...DEMANDE, precision: 'P'.repeat(precision.max + 1) },
        /précision ne doit pas dépasser 1000/,
      ],
      [{ ...DEMANDE, precision: `Bip${car(7)}` }, /précision contient/],
      // Corps qui n'est pas un objet : traité comme une demande sans champ.
      [[DEMANDE], /nom du lieu est obligatoire/],
      [null, /nom du lieu est obligatoire/],
      ['Pavillon Dauphine', /nom du lieu est obligatoire/],
    ];
    for (const [corps, motif] of cas) {
      const res = await postDemande(JSON.stringify(corps));
      expect(res.status).toBe(422);
      expect(await erreur(res)).toMatch(motif);
    }
    expect(admin.appels).toHaveLength(0);
    expect(rls.appels).toHaveLength(0);
  });

  it('M3.2/demande_ajout_lieu_bornes_acceptees — les longueurs limites passent : 2 et 150 pour le nom, 5 et 300 pour l’adresse, 1 000 pour la précision', async () => {
    const { nom, adresse, precision } = BORNES_DEMANDE_AJOUT;
    for (const corps of [
      { nom: 'N'.repeat(nom.min), adresse: 'A'.repeat(adresse.min) },
      {
        nom: 'N'.repeat(nom.max),
        adresse: 'A'.repeat(adresse.max),
        precision: 'P'.repeat(precision.max),
      },
    ]) {
      rls = makeChain();
      admin = makeChain();
      preparerDemande();
      expect((await postDemande(corps)).status).toBe(201);
      expect(message()).toContain(`lieu « ${corps.nom} »`);
      expect(message()).toContain(`adresse « ${corps.adresse} »`);
    }
  });

  it('M3.2/demande_ajout_lieu_blancs_replies — tabulation ou saut de ligne collés dans le nom ou l’adresse deviennent une espace, la précision garde ses lignes', async () => {
    preparerDemande();
    const lignes = 'Hall 1\nHall 2';
    const res = await postDemande({
      nom: 'Pavillon\n\tDauphine',
      // U+2028 : séparateur de ligne, courant dans un texte collé.
      adresse: `1 place du Maréchal${car(0x2028)}75116   Paris`,
      precision: lignes,
    });
    expect(res.status).toBe(201);
    const texte = message();
    expect(texte).toContain('lieu « Pavillon Dauphine »');
    expect(texte).toContain('adresse « 1 place du Maréchal 75116 Paris »');
    expect(texte).toContain(`précision : « ${lignes} »`);
  });

  it('M3.2/demande_ajout_lieu_caracteres_invisibles_retires — largeur nulle et marques de direction ne sortent pas dans l’alerte', async () => {
    preparerDemande();
    const ZWSP = car(0x200b);
    const RLO = car(0x202e);
    const res = await postDemande({
      nom: `${ZWSP}Pavillon${RLO} Dauphine${ZWSP}`,
      adresse: `${RLO}${DEMANDE.adresse}`,
    });
    expect(res.status).toBe(201);
    expect(message()).toContain(`lieu « ${DEMANDE.nom} »`);
    expect(message()).toContain(`adresse « ${DEMANDE.adresse} »`);

    // Un nom fait des seuls caractères invisibles n'est pas un nom.
    const vide = await postDemande({ ...DEMANDE, nom: ZWSP.repeat(10) });
    expect(vide.status).toBe(422);
  });

  it('M3.2/demande_ajout_lieu_deja_ouverte_409 — une demande ouverte par organisation : la seconde est refusée, rien n’est écrit', async () => {
    admin.push(OUVERTE);
    const res = await postDemande(DEMANDE);
    expect(res.status).toBe(409);
    expect(await erreur(res)).toBe(DEJA);
    expect(appelsDe(admin, 'insert')).toHaveLength(0);
    // Seule la demande d'ajout OUVERTE de cette organisation est cherchée.
    expect(filtres(admin)).toEqual({
      code: 'lieu_ajout_demande',
      entity_type: 'organisations',
      entity_id: ORG,
      statut: 'ouverte',
    });
    // Le nom de l'organisation n'est pas lu pour une demande refusée.
    expect(rls.appels.filter((a) => a.methode === 'from')).toHaveLength(0);
  });

  it('M3.2/demande_ajout_lieu_envoi_simultane_409 — l’index unique refuse le second insert (23505) : 409, pas de trace d’audit', async () => {
    preparerDemande();
    admin.push({ data: null, error: { code: '23505', message: 'duplicate' } });
    const res = await postDemande(DEMANDE);
    expect(res.status).toBe(409);
    expect(await erreur(res)).toBe(DEJA);
    // L'alerte tentée, refusée par la base : aucune trace pour une demande
    // qui n'existe pas.
    expect(appelsDe(admin, 'insert')).toHaveLength(1);
  });

  it('M3.2/demande_ajout_lieu_organisation_sans_nom — nom de l’organisation illisible : la demande part quand même, sans nom inventé', async () => {
    admin.push(RIEN);
    rls.push(RIEN);
    const res = await postDemande(DEMANDE);
    expect(res.status).toBe(201);
    expect(message()).toMatch(
      /^Un gestionnaire de lieux demande l’ajout du lieu « Pavillon Dauphine »/,
    );
  });

  it('M3.2/demande_ajout_lieu_corps_illisible_400 — corps JSON malformé', async () => {
    const res = await postDemande('{nom:');
    expect(res.status).toBe(400);
    expect(admin.appels).toHaveLength(0);
  });

  it('M3.2/demande_ajout_lieu_role_non_gestionnaire_403 — demande et état réservés au gestionnaire de lieux', async () => {
    for (const role of AUTRES_ROLES) {
      setupAuth({ user_role: role });
      expect((await postDemande(DEMANDE)).status).toBe(403);
      expect((await getEtat()).status).toBe(403);
    }
    expect(admin.appels).toHaveLength(0);
  });

  it('M3.2/demande_ajout_lieu_non_authentifie_401 — sans session, rien n’est lu', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await postDemande(DEMANDE)).status).toBe(401);
    expect((await getEtat()).status).toBe(401);
    expect(admin.appels).toHaveLength(0);
  });

  it('M3.2/demande_ajout_lieu_lectures_en_echec_500 — demande ouverte ou organisation illisibles : rien n’est écrit', async () => {
    const cas: Array<() => void> = [
      () => admin.push({ data: null, error: BOOM }), // demande ouverte ?
      () => {
        admin.push(RIEN);
        rls.push({ data: null, error: BOOM }); // organisation
      },
    ];
    for (const preparer of cas) {
      rls = makeChain();
      admin = makeChain();
      preparer();
      expect((await postDemande(DEMANDE)).status).toBe(500);
      expect(appelsDe(admin, 'insert')).toHaveLength(0);
    }
  });

  it('M3.2/demande_ajout_lieu_alerte_en_echec_500 — l’échec de l’alerte n’est pas annoncé comme un succès', async () => {
    preparerDemande();
    admin.push({ data: null, error: BOOM }); // alerte
    const res = await postDemande(DEMANDE);
    expect(res.status).toBe(500);
    // Pas de trace d'audit pour une demande qui n'existe pas.
    expect(appelsDe(admin, 'insert')).toHaveLength(1);
  });

  it('M3.2/demande_ajout_lieu_audit_en_echec_demande_conservee — l’alerte posée, un audit en échec est journalisé avec son auteur sans faire échouer la demande', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    preparerDemande();
    admin.push(RIEN); // alerte OK
    admin.push({ data: null, error: BOOM }); // audit
    const res = await postDemande(DEMANDE);
    expect(res.status).toBe(201);
    // Seule trace de l'auteur quand l'audit a échoué.
    expect(warn).toHaveBeenCalledWith(
      'gestionnaire.lieux.demande_ajout.audit_echec',
      { organisation_id: ORG, user_id: 'user-gl', code: 'XX000' },
    );
    warn.mockRestore();
  });

  it('M3.2/demande_ajout_lieu_impersonation_tracee — session impersonée : l’admin réel est inscrit dans la trace', async () => {
    setupAuth({ impersonator_id: 'admin-reel' });
    preparerDemande();
    await postDemande(DEMANDE);
    const [, audit] = appelsDe(admin, 'insert');
    expect(audit?.args[0]).toMatchObject({
      user_id: 'user-gl',
      impersonator_id: 'admin-reel',
    });
  });
});

describe('M3.2 / liste Lieux — état de la demande d’ajout', () => {
  it('M3.2/demande_ajout_lieu_etat_expose — une alerte ouverte neutralise le bouton, son contenu ne sort pas', async () => {
    admin.push(OUVERTE);
    const ouverte = await getEtat();
    expect(ouverte.status).toBe(200);
    // Ni identifiant ni message de l'alerte : l'état seul.
    expect(await ouverte.json()).toEqual({ data: { en_cours: true } });
    expect(appelsDe(admin, 'select').map((a) => a.args)).toEqual([['id']]);
    expect(filtres(admin)).toEqual({
      code: 'lieu_ajout_demande',
      entity_type: 'organisations',
      entity_id: ORG,
      statut: 'ouverte',
    });

    admin = makeChain();
    admin.push(RIEN);
    expect(await (await getEtat()).json()).toEqual({
      data: { en_cours: false },
    });
    // Lecture seule : rien n'est écrit, la session n'interroge aucune table.
    expect(appelsDe(admin, 'insert')).toHaveLength(0);
    expect(rls.appels.filter((a) => a.methode === 'from')).toHaveLength(0);
  });

  it('M3.2/demande_ajout_lieu_etat_illisible_500 — une lecture en échec n’est pas rendue comme « aucune demande »', async () => {
    admin.push({ data: null, error: BOOM });
    const res = await getEtat();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
  });
});

describe('M3.2 / liste Lieux — alerte d’ajout côté Admin', () => {
  it('M3.2/alerte_lieu_ajout_severite_et_lien — « À traiter », lien vers la fiche de l’organisation qui demande', () => {
    expect(severiteParCode(CODE_ALERTE_LIEU_AJOUT)).toBe('attention');
    expect(entiteHref('organisations', ORG)).toBe(`/admin/clients/${ORG}`);
  });
});
