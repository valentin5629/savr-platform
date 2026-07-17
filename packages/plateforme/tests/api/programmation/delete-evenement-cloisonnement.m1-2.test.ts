/**
 * M1.2 — Cloisonnement inter-organisation du DELETE événement.
 * Revue rls-securite PR #242 (recommandation non bloquante) — pendant du
 * cloisonnement GET couvert par `get-evenement-cloisonnement.m1-2.test.ts`.
 *
 * POURQUOI CE FICHIER : `DELETE /api/v1/programmation/evenements/[id]` tourne en
 * SERVICE-ROLE (`createAdminSupabaseClient()`) → la RLS est BYPASSÉE. Toute la
 * frontière inter-organisation tient sur une seule ligne du query builder :
 * `.eq('organisation_id', auth.ctx.organisationId)` — rempart STRICTEMENT
 * identique à celui du GET, mais l'enjeu est ici plus lourd qu'une fuite de
 * lecture : une régression sur cette ligne laisserait un programmateur de l'org A
 * SUPPRIMER un événement de l'org B. Perte de données cross-org, sans filet RLS
 * (le `.delete()` final ne filtre QUE sur `id` — aucun garde org en second rideau).
 * §09 l.177-188 (matrice `evenements`).
 *
 * PÉRIMÈTRE : ce fichier atteste le SEUL cloisonnement `organisation_id` de la
 * route. Il ne dit rien de QUI a le droit de supprimer : la matrice §09 n'ouvre le
 * DELETE `evenements` qu'à `admin_savr` et `traiteur_manager` (soft) — une seule
 * policy RLS existe, `evt_manager_delete` — alors que la route l'ouvre aux 4 rôles
 * `requireProgrammateur` et supprime en dur. Écarts PRÉ-EXISTANTS, hors scope de ce
 * lot (remontés à Val, non corrigés ici). Les cas ci-dessous utilisent donc
 * `traiteur_manager`, le seul rôle client à qui la matrice accorde effectivement le
 * DELETE : le test ne se rend pas complice de ces écarts. Ne pas lire ce fichier
 * comme « DELETE conforme à la matrice §09 ».
 *
 * ⚠ FIXTURES SANS COLLECTE — ce n'est pas un raccourci, c'est le seul état où le
 * 204 de la route est ATTEIGNABLE en vrai. Le commentaire `route.ts` « DELETE
 * CASCADE via FK » est FAUX : `collectes.evenement_id` est un REFERENCES nu, SANS
 * `ON DELETE CASCADE` (vérifié migrations V1 + `specs/ddl-cible/schema_cible_v2.sql`
 * l.1964 ; les 2 seuls CASCADE du schéma portent sur `tournee_id` et
 * `organisation_id`). Supprimer un événement qui A des collectes lève donc une
 * violation FK 23503 → 500 : le chemin nominal de la route est mort en prod (écart
 * pré-existant remonté à Val). Mettre une collecte `brouillon` dans les fixtures
 * ferait assurer au fake un 204 que la DB REFUSE — une fiction (leçon R17 : les
 * mocks masquent). Sans collecte, le 404 comme le 204 décrivent des états réels, et
 * la suppression cross-org reste bel et bien atteignable en prod (un brouillon sans
 * collecte se supprime sans buter sur la FK) : l'oracle mord sur la VRAIE
 * catastrophe.
 *
 * ORACLE : le fake Supabase ci-dessous FILTRE réellement (il applique les `.eq()`
 * comme PostgREST) et SUPPRIME réellement, au lieu de rejouer des réponses
 * pré-queuées — un mock queué renverrait la même chose avec ou sans le filtre, donc
 * ne prouverait rien. Mutations vérifiées empiriquement, chacune ROUGE :
 *   - retrait de `.eq('organisation_id', …)`  → 404 devient 204 + evt org B SUPPRIMÉ
 *   - fixture EVT_ORG_B retirée du store      → 404 par ligne absente (vacuité)
 *   - filtre org figé en dur sur ORG_A        → ne suit plus le JWT
 * Route restaurée après chaque mutation (git diff vide). ⚠ les blocs GET et DELETE
 * portent la MÊME ligne : ancrer la mutation sur le bloc DELETE (un sed non ancré
 * mute le GET et laisse ces tests verts — faux négatif rencontré).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
// Les deux seules tables que le DELETE touche (lecture evenements → lecture
// collectes → suppression evenements). Union fermée : toute autre table demandée
// par la route est une surprise, et le fake lève plutôt que de la servir à vide.
type TableName = 'evenements' | 'collectes';
interface DeleteCall {
  table: TableName;
  filters: Array<[string, unknown]>;
}

/**
 * Fake PostgREST minimal, à deux tables (le DELETE lit `evenements` PUIS
 * `collectes`, puis supprime) :
 *   - applique les prédicats `.eq()` sur un store en mémoire ;
 *   - modélise `.single()` comme PostgREST (0 ligne → data null + PGRST116) ;
 *   - est « thenable » comme un query builder Supabase (`await` sans `.single()`
 *     → liste filtrée), ce dont la lecture des collectes a besoin ;
 *   - exécute vraiment `.delete()` (retrait des lignes du store) et l'enregistre.
 * Il ne modélise NI la projection de colonnes (la ligne stockée est renvoyée telle
 * quelle — c'est le FILTRAGE qu'on prouve, pas le `select`), NI les contraintes FK
 * (cf. ⚠ FIXTURES en tête : c'est pour ça qu'aucun événement supprimé ici n'a de
 * collecte — le fake accepterait un DELETE que la FK 23503 refuserait en base).
 */
function makeStore(evenements: Row[], collectes: Row[]) {
  const tables: Record<TableName, Row[]> = {
    evenements: [...evenements],
    collectes: [...collectes],
  };
  const eqCalls: Array<[string, unknown]> = [];
  const deleteCalls: DeleteCall[] = [];

  const builder = (table: TableName) => {
    const filters: Array<[string, unknown]> = [];
    let mode: 'select' | 'delete' = 'select';
    const matching = () =>
      tables[table].filter((r) =>
        filters.every(([col, val]) => r[col] === val),
      );

    const b = {
      select: () => b,
      delete: () => {
        mode = 'delete';
        return b;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        eqCalls.push([col, val]);
        return b;
      },
      single: () => {
        const found = matching();
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
      // `await builder` sans `.single()` → exécution de la requête.
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject?: (reason?: unknown) => unknown,
      ) => {
        if (mode === 'delete') {
          deleteCalls.push({ table, filters: [...filters] });
          const victims = new Set(matching());
          tables[table] = tables[table].filter((r) => !victims.has(r));
          return Promise.resolve({ data: null, error: null }).then(
            resolve,
            reject,
          );
        }
        return Promise.resolve({ data: matching(), error: null }).then(
          resolve,
          reject,
        );
      },
    };
    return b;
  };

  return {
    __eqCalls: eqCalls,
    __deleteCalls: deleteCalls,
    __ids: (table: TableName) => tables[table].map((r) => r.id),
    from: (table: string) => {
      if (table !== 'evenements' && table !== 'collectes')
        throw new Error(`table inattendue dans le DELETE : ${table}`);
      return builder(table);
    },
  };
}

const ORG_A = 'org-traiteur-a';
const ORG_B = 'org-traiteur-b';

const EVT_ORG_A: Row = {
  id: 'evt-org-a',
  organisation_id: ORG_A,
  nom_evenement: 'Cocktail Org A',
};
const EVT_ORG_B: Row = {
  id: 'evt-org-b',
  organisation_id: ORG_B,
  nom_evenement: 'Gala confidentiel Org B',
};

// Aucune collecte rattachée aux deux événements (cf. ⚠ FIXTURES en tête) : les
// deux sont des brouillons « nus », le seul état où le 204 de la route est
// atteignable en base réelle. Le garde-fou statut est donc PASSANT (liste vide),
// et retirer le filtre org mène bien à une suppression cross-org effective — pas à
// un 422, ni au 500 FK qu'une collecte rattachée provoquerait en prod.
// La collecte ci-dessous appartient à un TROISIÈME événement, jamais supprimé : la
// table `collectes` n'est pas vide pour autant, et le fake prouve qu'il sait
// filtrer par `evenement_id` (sinon il la servirait à tort aux 2 cas de 204, et
// le garde-fou statut les ferait échouer en 422 → le test le verrait).
const COL_AUTRE_EVT: Row = {
  id: 'col-autre',
  evenement_id: 'evt-org-a-autre',
  statut: 'validee',
};

let store = makeStore([], []);
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

async function deleteEvenement(id: string) {
  const { DELETE } =
    await import('@/app/api/v1/programmation/evenements/[id]/route.js');
  return DELETE(
    new NextRequest(`http://localhost/api/v1/programmation/evenements/${id}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store = makeStore([EVT_ORG_A, EVT_ORG_B], [COL_AUTRE_EVT]);
});

describe('M1.2 / DELETE événement — cloisonnement inter-organisation', () => {
  it("M1.2 — DELETE événement d'une autre organisation → 404 et AUCUNE suppression (cloisonnement org, route service-role)", async () => {
    setupAuth('traiteur_manager', ORG_A, 'user-a');

    const res = await deleteEvenement('evt-org-b');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Événement introuvable ou accès refusé',
    });
    // Le cœur du test : aucune suppression n'a été ÉMISE, sur aucune table.
    expect(store.__deleteCalls).toEqual([]);
    // Et l'org B a toujours son événement (l'état, pas seulement l'intention — un
    // `.delete()` non émis mais des lignes disparues serait tout aussi grave).
    expect(store.__ids('evenements')).toContain('evt-org-b');
    // Le rempart lui-même : filtre org posé avec l'organisation de l'appelant.
    // (Prouve l'égalité, pas la dérivation — c'est le cas org B ci-dessous qui
    // prouve que le filtre SUIT le JWT au lieu d'être figé.)
    expect(store.__eqCalls).toContainEqual(['organisation_id', ORG_A]);
  });

  it('M1.2 — DELETE de son propre événement brouillon → 204 + suppression émise (contre-épreuve : le fake sait supprimer)', async () => {
    setupAuth('traiteur_manager', ORG_A, 'user-a');

    const res = await deleteEvenement('evt-org-a');

    expect(res.status).toBe(204);
    expect(store.__deleteCalls).toEqual([
      { table: 'evenements', filters: [['id', 'evt-org-a']] },
    ]);
    expect(store.__ids('evenements')).not.toContain('evt-org-a');
  });

  // ANTI-VACUITÉ (revue rls-securite du 2026-07-17, mutations M3/M4) : sans ce
  // cas, le 404 cross-org ci-dessus passerait encore au vert si `EVT_ORG_B`
  // disparaissait du store (404 par ligne absente, plus par filtre) ou si le
  // filtre était figé en dur sur ORG_A — deux complaisances SILENCIEUSES. Prouver
  // que `evt-org-b` EST supprimable par sa propre org ferme les deux : le 404 de
  // l'org A ne peut alors venir que du filtre, et le filtre suit bien le JWT.
  it('M1.2 — DELETE du même événement par SON organisation (org B) → 204 (anti-vacuité : la ligne existe, le filtre suit le JWT)', async () => {
    setupAuth('traiteur_manager', ORG_B, 'user-b');

    const res = await deleteEvenement('evt-org-b');

    expect(res.status).toBe(204);
    expect(store.__deleteCalls).toEqual([
      { table: 'evenements', filters: [['id', 'evt-org-b']] },
    ]);
    expect(store.__ids('evenements')).not.toContain('evt-org-b');
    expect(store.__eqCalls).toContainEqual(['organisation_id', ORG_B]);
  });
});
