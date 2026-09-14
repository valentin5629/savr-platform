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
 * PÉRIMÈTRE : deux frontières, une par `describe`.
 *   1. Cloisonnement `organisation_id` (bloc historique) — un programmateur de
 *      l'org A ne supprime pas un événement de l'org B.
 *   2. Propriété `created_by` (bloc ajouté 2026-09-14) — au sein d'une MÊME orga,
 *      `traiteur_commercial`, `agence` et `gestionnaire_lieux` ne suppriment que
 *      LEURS brouillons ; `traiteur_manager` garde le périmètre organisation.
 *
 * L'ancienne note de ce fichier (« la matrice n'ouvre le DELETE qu'à `admin_savr`
 * et `traiteur_manager` … écarts pré-existants hors scope ») est PÉRIMÉE : Val a
 * tranché le périmètre du DELETE le 2026-09-14 (§09 table `evenements`, divergences
 * `M1.2_20260717` / `M1.2_20260717_delete-service-role`) — « chacun supprime ses
 * propres brouillons », les 3 rôles ci-dessus passant de `—` à
 * `created_by = auth.uid()`, et la mention « (soft) » retirée (hard delete assumé,
 * aucune colonne `supprime_le` en V1). Le §09 exige que cette matrice soit posée en
 * garde de rôle APPLICATIVE (403) : la route étant en service-role, pgTAP est
 * impuissant ici et ce fichier EST l'oracle.
 *
 * FIXTURES SANS COLLECTE — choix de PÉRIMÈTRE : ce fichier atteste le seul
 * cloisonnement cross-org, dont le rempart (le SELECT filtré) est indépendant de la
 * présence de collectes. Historique : le `.delete()` nu d'origine butait sur la FK
 * (`collectes.evenement_id` = REFERENCES nu SANS `ON DELETE CASCADE`, vérifié
 * migrations V1 + `specs/ddl-cible/schema_cible_v2.sql` l.1964) → 500 dès qu'une
 * collecte existait ; les fixtures sans collecte étaient alors le seul état où le
 * 204 était atteignable en vrai. **Ce défaut est corrigé par la PR « cycle de vie
 * du brouillon »** : la route passe désormais par la RPC atomique
 * `fn_supprimer_brouillon`, qui supprime collectes PUIS événement dans une même
 * transaction — le chemin AVEC collectes est prouvé, en base réelle, par le pgTAP
 * T16-T18 de `M1_2__programmation.test.sql`. On garde ici des fixtures nues parce
 * que la charge de ce fichier est le cloisonnement, pas la mécanique FK.
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

  // Depuis la PR « cycle de vie du brouillon » (2026-07-17), la route ne supprime
  // plus par `.from('evenements').delete()` mais par la RPC atomique
  // `fn_supprimer_brouillon(p_evenement_id)` — c'est précisément le correctif de la
  // divergence (c) que ce fichier signalait (le `.delete()` nu butait sur la FK
  // 23503 dès qu'une collecte existait). Le fake exécute la RPC POUR DE VRAI
  // (supprime collectes puis événement du store) au lieu de rejouer une réponse
  // pré-queuée : un stub renverrait 204 avec ou sans le rempart org en amont, donc
  // ne prouverait rien. Le rempart inter-organisation reste inchangé — il vit
  // toujours sur le SELECT `.eq('organisation_id', …)`, jamais sur la suppression.
  const rpcCalls: Array<[string, unknown]> = [];

  return {
    __eqCalls: eqCalls,
    __deleteCalls: deleteCalls,
    __rpcCalls: rpcCalls,
    __ids: (table: TableName) => tables[table].map((r) => r.id),
    from: (table: string) => {
      if (table !== 'evenements' && table !== 'collectes')
        throw new Error(`table inattendue dans le DELETE : ${table}`);
      return builder(table);
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      if (name === 'fn_supprimer_brouillon') {
        const eid = args.p_evenement_id;
        // Atomique comme la vraie RPC : collectes de l'événement PUIS l'événement.
        tables.collectes = tables.collectes.filter(
          (r) => r.evenement_id !== eid,
        );
        tables.evenements = tables.evenements.filter((r) => r.id !== eid);
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

const ORG_A = 'org-traiteur-a';
const ORG_B = 'org-traiteur-b';

const USER_A1 = 'user-a1';
const USER_A2 = 'user-a2';

const EVT_ORG_A: Row = {
  id: 'evt-org-a',
  organisation_id: ORG_A,
  created_by: USER_A1,
  nom_evenement: 'Cocktail Org A',
};
const EVT_ORG_B: Row = {
  id: 'evt-org-b',
  organisation_id: ORG_B,
  created_by: 'user-b1',
  nom_evenement: 'Gala confidentiel Org B',
};
// Brouillon d'un COLLÈGUE, même organisation que l'appelant du 2e bloc : le
// prédicat `organisation_id` le laisse passer, seule la garde de propriété le
// refuse. C'est exactement la sur-permission intra-organisationnelle corrigée.
const EVT_COLLEGUE: Row = {
  id: 'evt-collegue',
  organisation_id: ORG_A,
  created_by: USER_A2,
  nom_evenement: 'Brouillon du collègue',
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
  store = makeStore([EVT_ORG_A, EVT_ORG_B, EVT_COLLEGUE], [COL_AUTRE_EVT]);
});

describe('M1.2 / DELETE événement — cloisonnement inter-organisation', () => {
  it("M1.2 — DELETE événement d'une autre organisation → 404 et AUCUNE suppression (cloisonnement org, route service-role)", async () => {
    setupAuth('traiteur_manager', ORG_A, USER_A1);

    const res = await deleteEvenement('evt-org-b');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Événement introuvable ou accès refusé',
    });
    // Le cœur du test : aucune suppression n'a été ÉMISE. La route sort en 404 sur
    // le SELECT filtré, AVANT d'atteindre la RPC de suppression — celle-ci n'est
    // donc jamais appelée (ni l'ancien `.delete()`, conservé par sûreté).
    expect(store.__rpcCalls).toEqual([]);
    expect(store.__deleteCalls).toEqual([]);
    // Et l'org B a toujours son événement (l'état, pas seulement l'intention — une
    // RPC non émise mais des lignes disparues serait tout aussi grave).
    expect(store.__ids('evenements')).toContain('evt-org-b');
    // Le rempart lui-même : filtre org posé avec l'organisation de l'appelant.
    // (Prouve l'égalité, pas la dérivation — c'est le cas org B ci-dessous qui
    // prouve que le filtre SUIT le JWT au lieu d'être figé.)
    expect(store.__eqCalls).toContainEqual(['organisation_id', ORG_A]);
  });

  it('M1.2 — DELETE de son propre événement brouillon → 204 + suppression émise (contre-épreuve : le fake sait supprimer)', async () => {
    setupAuth('traiteur_manager', ORG_A, USER_A1);

    const res = await deleteEvenement('evt-org-a');

    expect(res.status).toBe(204);
    // La suppression passe désormais par la RPC atomique, avec l'id de l'événement.
    expect(store.__rpcCalls).toEqual([
      ['fn_supprimer_brouillon', { p_evenement_id: 'evt-org-a' }],
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
    setupAuth('traiteur_manager', ORG_B, 'user-b1');

    const res = await deleteEvenement('evt-org-b');

    expect(res.status).toBe(204);
    expect(store.__rpcCalls).toEqual([
      ['fn_supprimer_brouillon', { p_evenement_id: 'evt-org-b' }],
    ]);
    expect(store.__ids('evenements')).not.toContain('evt-org-b');
    expect(store.__eqCalls).toContainEqual(['organisation_id', ORG_B]);
  });
});

/**
 * Garde de PROPRIÉTÉ — §09 table `evenements`, colonne DELETE (tranché Val
 * 2026-09-14). Frontière INTRA-organisation : le prédicat `organisation_id` du
 * SELECT est passant dans tous les cas ci-dessous (même orga), donc le seul
 * rempart testé est `created_by === auth.ctx.userId`. Comme la route tourne en
 * service-role, aucune policy RLS ne prend le relais : ce bloc est l'oracle.
 *
 * ORACLE / ANTI-VACUITÉ : chaque rôle a SON cas passant (204 sur son propre
 * brouillon) en regard de son cas refusé (403 sur celui du collègue) — sans quoi un
 * 403 systématique (rôle mal orthographié dans la liste, garde trop large) passerait
 * au vert. Mutations vérifiées, chacune ROUGE :
 *   - retrait de `agence` de `DELETE_ROLES_PROPRIETAIRE`            → 403 devient 204
 *   - retrait de `gestionnaire_lieux` de `DELETE_ROLES_PROPRIETAIRE` → 403 devient 204
 *   - garde inversée (`===` au lieu de `!==`)                        → les 204 tombent
 */
describe('M1.2 / DELETE événement — garde de propriété intra-organisation (§09)', () => {
  // Les 3 rôles que la matrice borne à leurs propres créations.
  const ROLES_PROPRIETAIRE = [
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
  ] as const;

  it.each(ROLES_PROPRIETAIRE)(
    'M1.2 — %s supprime SON propre brouillon → 204 (contre-épreuve du 403 ci-dessous)',
    async (role) => {
      setupAuth(role, ORG_A, USER_A1);

      const res = await deleteEvenement('evt-org-a');

      expect(res.status).toBe(204);
      expect(store.__rpcCalls).toEqual([
        ['fn_supprimer_brouillon', { p_evenement_id: 'evt-org-a' }],
      ]);
      expect(store.__ids('evenements')).not.toContain('evt-org-a');
    },
  );

  it.each(ROLES_PROPRIETAIRE)(
    "M1.2 — %s ne supprime PAS le brouillon d'un collègue de sa propre organisation → 403, aucune suppression",
    async (role) => {
      setupAuth(role, ORG_A, USER_A1);

      const res = await deleteEvenement('evt-collegue');

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Suppression non autorisée' });
      // Le 403 doit tomber AVANT la RPC : un hard delete est irréversible, une
      // réponse 403 sur une ligne déjà supprimée serait le pire des deux mondes.
      expect(store.__rpcCalls).toEqual([]);
      expect(store.__ids('evenements')).toContain('evt-collegue');
      // Et le refus vient bien de la propriété, pas d'un 404 d'org : l'événement
      // du collègue est dans l'orga de l'appelant, donc visible du SELECT.
      expect(store.__eqCalls).toContainEqual(['organisation_id', ORG_A]);
    },
  );

  // Le manager n'est PAS borné à ses créations (matrice §09 : périmètre
  // organisation). Sans ce cas, élargir la garde aux 4 rôles clients — durcissement
  // apparemment « plus sûr » — passerait inaperçu alors qu'il casserait le seul
  // rôle habilité à nettoyer les brouillons de son organisation.
  it("M1.2 — traiteur_manager supprime le brouillon d'un collègue de son organisation → 204 (périmètre organisation, pas created_by)", async () => {
    setupAuth('traiteur_manager', ORG_A, USER_A1);

    const res = await deleteEvenement('evt-collegue');

    expect(res.status).toBe(204);
    expect(store.__rpcCalls).toEqual([
      ['fn_supprimer_brouillon', { p_evenement_id: 'evt-collegue' }],
    ]);
    expect(store.__ids('evenements')).not.toContain('evt-collegue');
  });

  // Staff = périmètre global (le SELECT retire même le prédicat org). Il supprime
  // donc un brouillon qu'il n'a pas créé, dans une orga qui n'est pas la sienne.
  it("M1.2 — admin_savr supprime le brouillon d'un client (mode support) → 204 (périmètre global)", async () => {
    setupAuth('admin_savr', 'org_savr', 'user-admin');

    const res = await deleteEvenement('evt-collegue');

    expect(res.status).toBe(204);
    expect(store.__rpcCalls).toEqual([
      ['fn_supprimer_brouillon', { p_evenement_id: 'evt-collegue' }],
    ]);
    expect(store.__eqCalls).not.toContainEqual(['organisation_id', 'org_savr']);
  });
});
