/**
 * M1.2 — Cloisonnement inter-organisation du GET détail événement.
 * Revue rls-securite PR #242 (recommandation non bloquante).
 *
 * POURQUOI CE FICHIER : `GET /api/v1/programmation/evenements/[id]` tourne en
 * SERVICE-ROLE (`createAdminSupabaseClient()`) → la RLS est BYPASSÉE. Toute la
 * frontière inter-organisation repose donc sur une seule ligne du query builder :
 * `.eq('organisation_id', auth.ctx.organisationId)`. La PR #242 a élargi le rayon
 * de souffle : le `.select()` renvoie désormais `pax`, `contact_principal_nom`
 * (PII) et `lieux(nom, adresse_acces, code_postal, ville)` — une régression sur
 * cette ligne fuiterait PII et adresses vers une autre organisation, et la RLS ne
 * rattraperait rien. §09 l.177-188 (matrice `evenements` : SELECT scopé org).
 *
 * PÉRIMÈTRE : ce fichier atteste le SEUL cloisonnement `organisation_id` que la
 * route implémente. La matrice §09 ouvre aussi le SELECT via
 * `traiteur_operationnel_organisation_id` (manager/commercial), par lieu
 * (gestionnaire) et `client_organisateur_organisation_id` — que cette route
 * n'implémente PAS (comportement pré-existant, fail-closed, hors scope de ce
 * lot). Ne pas lire ces tests comme « GET conforme à la matrice §09 ».
 *
 * ORACLE : le fake Supabase ci-dessous FILTRE réellement (il applique les `.eq()`
 * comme PostgREST) au lieu de rejouer une réponse pré-queuée. Retirer la ligne
 * `.eq('organisation_id', …)` de la route fait donc passer le test cross-org de
 * 404 à 200 + PII → ROUGE (oracle vérifié en la commentant). Le mock à réponses
 * queuées de `edition-evenement.m1-2.test.ts` ne prouverait rien ici : il
 * renverrait la même chose avec ou sans le filtre.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

/**
 * Fake PostgREST minimal : applique les prédicats `.eq()` sur un store en mémoire
 * et modélise `.single()` comme PostgREST (0 ligne → data null + PGRST116). Il ne
 * modélise PAS la projection de colonnes — la ligne stockée est renvoyée telle
 * quelle : c'est le FILTRAGE que ce test doit prouver. Le `select` demandé est
 * seulement relevé, pour vérifier les colonnes dont l'écran de confirmation a
 * besoin.
 */
function makeEvenementsStore(rows: Row[]) {
  const eqCalls: Array<[string, unknown]> = [];
  const selectCalls: string[] = [];
  const builder = () => {
    const filters: Array<[string, unknown]> = [];
    const b = {
      select: (colonnes: string) => {
        selectCalls.push(colonnes);
        return b;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        eqCalls.push([col, val]);
        return b;
      },
      single: () => {
        const found = rows.filter((r) =>
          filters.every(([col, val]) => r[col] === val),
        );
        return Promise.resolve(
          found.length === 1
            ? { data: found[0], error: null }
            : {
                data: null,
                error: {
                  code: 'PGRST116',
                  message:
                    'JSON object requested, multiple (or no) rows returned',
                },
              },
        );
      },
    };
    return b;
  };
  // Journal des emails : lu par le GET pour l'état de l'email récapitulatif, une
  // fois l'événement trouvé. Aucune ligne ici ; seuls ses filtres sont tracés.
  const journalEq: Array<[string, unknown]> = [];
  const journal = () => {
    const j = {
      select: () => j,
      eq: (col: string, val: unknown) => {
        journalEq.push([col, val]);
        return j;
      },
      order: () => j,
      limit: () => j,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    return j;
  };
  // Contacts de chaque collecte (refonte du formulaire, lot B2) : lus une fois
  // l'événement trouvé, par `.in('collecte_id', …)` attendue sans terminal.
  // Aucune ligne ici ; seuls les identifiants demandés sont tracés.
  const contactsIn: Array<[string, unknown[]]> = [];
  const contacts = () => {
    const c = {
      select: () => c,
      in: (col: string, ids: unknown[]) => {
        contactsIn.push([col, ids]);
        return c;
      },
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(ok, ko),
    };
    return c;
  };
  return {
    __eqCalls: eqCalls,
    __selectCalls: selectCalls,
    __journalEq: journalEq,
    __contactsIn: contactsIn,
    from: (table: string) => {
      if (table === 'emails_envoyes') return journal();
      if (table === 'collecte_contacts') return contacts();
      if (table !== 'evenements')
        throw new Error(`table inattendue dans le GET : ${table}`);
      return builder();
    },
  };
}

const ORG_A = 'org-traiteur-a';
const ORG_B = 'org-traiteur-b';

// PII de l'org B — aucune de ces valeurs ne doit franchir la frontière org.
const PII_CONTACT_B = 'Marie Dubois';
const PII_ADRESSE_B = 'Quai 3, code portail 4512B';
const PII_NOM_EVT_B = 'Gala confidentiel Org B';

const EVT_ORG_A: Row = {
  id: 'evt-org-a',
  organisation_id: ORG_A,
  nom_evenement: 'Cocktail Org A',
  pax: 80,
  contact_principal_nom: 'Jean Martin',
  lieux: {
    nom: 'Salle A',
    adresse_acces: 'Entrée principale',
    code_postal: '75001',
    ville: 'Paris',
  },
  collectes: [],
};

const EVT_ORG_B: Row = {
  id: 'evt-org-b',
  organisation_id: ORG_B,
  nom_evenement: PII_NOM_EVT_B,
  pax: 420,
  contact_principal_nom: PII_CONTACT_B,
  lieux: {
    nom: 'Hôtel Privé B',
    adresse_acces: PII_ADRESSE_B,
    code_postal: '75008',
    ville: 'Paris',
  },
  collectes: [],
};

let store = makeEvenementsStore([]);
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => store,
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

async function getEvenement(id: string) {
  const { GET } =
    await import('@/app/api/v1/programmation/evenements/[id]/route.js');
  return GET(
    new NextRequest(`http://localhost/api/v1/programmation/evenements/${id}`),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store = makeEvenementsStore([EVT_ORG_A, EVT_ORG_B]);
});

describe('M1.2 / GET détail événement — cloisonnement inter-organisation', () => {
  it("M1.2 — GET événement d'une autre organisation → 404 sans aucune donnée (cloisonnement org, route service-role)", async () => {
    setupAuth('traiteur_manager', ORG_A, 'user-a');

    const res = await getEvenement('evt-org-b');

    expect(res.status).toBe(404);
    const brut = await res.text();
    expect(JSON.parse(brut)).toEqual({
      error: 'Événement introuvable ou accès refusé',
    });
    // Rayon de souffle #242 : ni PII, ni adresse, ni pax de l'org B ne fuient.
    for (const fuite of [PII_CONTACT_B, PII_ADRESSE_B, PII_NOM_EVT_B, '420'])
      expect(brut).not.toContain(fuite);
    // Le rempart lui-même : filtre org posé avec l'organisation de l'appelant.
    // (Prouve l'égalité, pas la dérivation — c'est la contre-épreuve org B
    // ci-dessous qui prouve que le filtre SUIT le JWT au lieu d'être figé.)
    expect(store.__eqCalls).toContainEqual(['organisation_id', ORG_A]);
    // Le journal des emails n'est jamais lu pour un événement hors périmètre :
    // même un état à trois valeurs trahirait l'existence de l'événement. Ni les
    // contacts de ses collectes (lot B2).
    expect(store.__journalEq).toEqual([]);
    expect(store.__contactsIn).toEqual([]);
  });

  it('M1.2 — GET événement de sa propre organisation → 200 + détail (contre-épreuve : le fake sait renvoyer une ligne)', async () => {
    setupAuth('traiteur_manager', ORG_A, 'user-a');

    const res = await getEvenement('evt-org-a');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'evt-org-a',
      nom_evenement: 'Cocktail Org A',
      // Aucune ligne d'envoi dans le journal → rien n'est parti.
      email_recap: 'non_envoye',
    });
    // Le journal est lu pour CET événement, et pour l'email récapitulatif seul.
    expect(store.__journalEq).toEqual([
      ['template_code', 'collecte_programmee'],
      ['entity_type', 'evenement'],
      ['entity_id', 'evt-org-a'],
    ]);
  });

  // ANTI-VACUITÉ (revue rls-securite du 2026-07-17, mutations M3/M4) : sans ce
  // cas, le 404 cross-org ci-dessus passerait encore au vert si `EVT_ORG_B`
  // disparaissait du store (404 par ligne absente, plus par filtre) ou si le
  // filtre était figé en dur sur ORG_A — deux complaisances SILENCIEUSES. Prouver
  // que `evt-org-b` EST récupérable par sa propre org ferme les deux : le 404 de
  // l'org A ne peut alors venir que du filtre, et le filtre suit bien le JWT.
  it('M1.2 — GET du même événement par SON organisation (org B) → 200 (anti-vacuité : la ligne existe, le filtre suit le JWT)', async () => {
    setupAuth('traiteur_manager', ORG_B, 'user-b');

    const res = await getEvenement('evt-org-b');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'evt-org-b',
      contact_principal_nom: PII_CONTACT_B,
    });
    expect(store.__eqCalls).toContainEqual(['organisation_id', ORG_B]);
  });
});

describe('M1.2 / formulaire_simplifie — GET détail événement : colonnes du récapitulatif', () => {
  // Décision Val 2026-10-16 : l'écran « Votre collecte est programmée » affiche le
  // client et le téléphone des contacts. Sans ces colonnes dans le `select`, il
  // afficherait « — » et « Non renseigné » pour des valeurs qui existent.
  it('le select demande client, téléphones et contact de secours', async () => {
    setupAuth('traiteur_manager', ORG_A, 'user-a');

    await getEvenement('evt-org-a');

    expect(store.__selectCalls).toHaveLength(1);
    const colonnes = store.__selectCalls[0]!.split(/[\s,()]+/);
    for (const colonne of [
      'nom_client_organisateur',
      'pax',
      'contact_principal_nom',
      'contact_principal_telephone',
      'contact_secours_nom',
      'contact_secours_telephone',
      'date_collecte',
      'heure_collecte',
    ])
      expect(colonnes).toContain(colonne);
  });
});

describe('M1.2 / ajout_collecte_niveau_evenement — GET détail événement : niveau événement figé', () => {
  // §06.01 « Ajouter une collecte à un événement existant » : la page affiche le
  // niveau événement figé et pré-rempli (client, date de l'événement, type
  // d'événement, lieu, contacts, contrôle d'accès).
  it('le select demande la date et le type de l’événement, et le contrôle d’accès de ses collectes', async () => {
    setupAuth('traiteur_manager', ORG_A, 'user-a');

    await getEvenement('evt-org-a');

    const select = store.__selectCalls[0]!;
    expect(select).toContain('date_evenement');
    expect(select).toContain(
      'type_evenement:types_evenements!type_evenement_id(libelle)',
    );
    expect(select).toMatch(/collectes\([^)]*controle_acces_requis[^)]*\)/);
  });

  it('rend le libellé du type d’événement et le contrôle d’accès de l’événement (requis dès qu’une collecte l’exige)', async () => {
    store = makeEvenementsStore([
      {
        ...EVT_ORG_A,
        date_evenement: '2030-01-15',
        type_evenement: { libelle: 'Repas assis' },
        collectes: [
          { id: 'c1', statut: 'programmee', controle_acces_requis: false },
          { id: 'c2', statut: 'validee', controle_acces_requis: true },
        ],
      },
    ]);
    setupAuth('traiteur_manager', ORG_A, 'user-a');

    const res = await getEvenement('evt-org-a');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      date_evenement: '2030-01-15',
      type_evenement: 'Repas assis',
      controle_acces_requis: true,
    });
    // Contacts de CES collectes, demandés une fois l'événement trouvé.
    expect(store.__contactsIn).toEqual([['collecte_id', ['c1', 'c2']]]);
  });

  it('aucune collecte n’exige de contrôle d’accès → non requis ; type absent → null', async () => {
    store = makeEvenementsStore([
      {
        ...EVT_ORG_A,
        type_evenement: null,
        collectes: [
          { id: 'c1', statut: 'programmee', controle_acces_requis: false },
        ],
      },
    ]);
    setupAuth('traiteur_manager', ORG_A, 'user-a');

    const json = (await (await getEvenement('evt-org-a')).json()) as Record<
      string,
      unknown
    >;

    expect(json.controle_acces_requis).toBe(false);
    expect(json.type_evenement).toBeNull();
  });
});
