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
 * quelle : c'est le FILTRAGE que ce test doit prouver, pas le `select`.
 */
function makeEvenementsStore(rows: Row[]) {
  const eqCalls: Array<[string, unknown]> = [];
  const builder = () => {
    const filters: Array<[string, unknown]> = [];
    const b = {
      select: () => b,
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
  return {
    __eqCalls: eqCalls,
    from: (table: string) => {
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
  });

  it('M1.2 — GET événement de sa propre organisation → 200 + détail (contre-épreuve : le fake sait renvoyer une ligne)', async () => {
    setupAuth('traiteur_manager', ORG_A, 'user-a');

    const res = await getEvenement('evt-org-a');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'evt-org-a',
      nom_evenement: 'Cocktail Org A',
    });
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
