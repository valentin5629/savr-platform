/**
 * Trois lectures au-delà des plafonds de l'API de données (suite de
 * `lectures-au-dela-plafond.test.ts`).
 *
 * Une réponse est amputée à 1 000 lignes sans erreur, et un filtre `in.(…)` de
 * plus de quelques centaines d'identifiants fait échouer la lecture (mesures :
 * `src/lib/pdf/selection-par-pages.ts`). Restaient en une requête : les
 * bordereaux de l'export ZIP du registre, les ordres de création abandonnés des
 * listes Admin, et les options de l'encart « Comparer avec » du Dashboard
 * Client Admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  creerApiPlafonnee,
  PLAFOND_IDS,
  PLAFOND_LIGNES,
  type Ligne,
} from '@/test-utils/api-donnees-plafonnee';
import { TAILLE_LOT, TAILLE_PAGE } from '@/lib/pdf/selection-par-pages.js';
import { Constants } from '@savr/shared/src/database.types.js';

type Api = ReturnType<typeof creerApiPlafonnee>;
type Client = { from: (table: string) => unknown };

/** Lectures sous la session de l'appelant (export ZIP du registre). */
let rls: Api = creerApiPlafonnee();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (table: string) => (rls.client as Client).from(table),
    // `shared.fichiers` est servie par la même fausse API.
    schema: () => ({
      from: (table: string) => (rls.client as Client).from(table),
    }),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: vi.fn(async () => Buffer.from('%PDF-1.4 faux bordereau')),
}));
vi.mock('@/lib/registre/trace.js', () => ({
  traceExport: vi.fn(async () => {}),
}));

import { getObjectBytes } from '@/lib/pdf/r2-client.js';
import { traceExport } from '@/lib/registre/trace.js';
import { bordereauDisponible } from '@/lib/registre/registre.js';
import { lireCollectesEnvoiAbandonne } from '@/lib/ordre-envoi.js';
import { loadAdminBenchmarkFiltres } from '@/lib/dashboards/admin-dashboard-client.js';

const id = (prefixe: string, i: number) =>
  `${prefixe}-${String(i).padStart(5, '0')}`;
const suite = <T>(n: number, ligne: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => ligne(i));

/**
 * Met `table` en panne à partir de sa n-ième lecture : les lectures d'avant
 * sont servies. Un lot ou une page en échec ne doit pas laisser un résultat
 * bâti sur ce qui a déjà été lu.
 */
function panneALaLecture(api: Api, table: string, rang: number): void {
  const client = api.client as Client;
  api.client = {
    ...client,
    from: (t: string) => {
      if (t === table && api.lecturesDe(table).length + 1 >= rang)
        api.pannes[table] = { message: 'panne', code: 'XX000' };
      return client.from(t);
    },
  };
}

/** Listes d'identifiants passées à `in(colonne, …)` par les lectures de `table`. */
function listesIn(api: Api, table: string, colonne: string): unknown[][] {
  return api
    .lecturesDe(table)
    .flatMap((l) =>
      l.filtres
        .filter(([operateur, c]) => operateur === 'in' && c === colonne)
        .map(([, , valeurs]) => valeurs as unknown[]),
    );
}

/** Les lectures paginées de `table` : triées par id, bornées, `total` lignes en tout. */
function attendrePages(api: Api, table: string, total: number): void {
  const pages = api.lecturesDe(table).filter((l) => l.limite !== null);
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.every((p) => p.tris.at(-1) === 'id')).toBe(true);
  expect(pages.every((p) => p.limite === TAILLE_PAGE)).toBe(true);
  expect(pages.reduce((s, p) => s + p.rendues, 0)).toBe(total);
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = creerApiPlafonnee();
});

// ── Export ZIP des bordereaux du registre ────────────────────────────────────

describe("M4.2 / export ZIP des bordereaux au-delà du plafond d'identifiants", () => {
  function connecter(): void {
    const jeton = `h.${Buffer.from(
      JSON.stringify({
        aal: 'aal2',
        user_role: 'traiteur_manager',
        organisation_id: 'org-a',
      }),
    ).toString('base64url')}.s`;
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: jeton } },
      error: null,
    });
  }

  /** Registre de 450 collectes ; les `emis` premières ont un bordereau émis, les `brouillons` suivantes un brouillon. */
  function registre(emis: number, brouillons = 0): Record<string, Ligne[]> {
    return {
      v_registre_dechets: suite(450, (i) => ({
        collecte_id: id('col', i),
        date_evenement: '2026-04-10',
      })),
      bordereaux_savr: suite(emis + brouillons, (i) => ({
        collecte_id: id('col', i),
        statut: i < emis ? 'emis' : 'brouillon',
        numero: `BSAV-2026-${String(i).padStart(5, '0')}`,
        pdf_fichier_id: id('fichier', i),
      })),
      fichiers: suite(emis + brouillons, (i) => ({
        id: id('fichier', i),
        bucket: 'bordereaux',
        key: `b${i}.pdf`,
        deleted_at: null,
      })),
    };
  }

  async function exporter() {
    const { GET } = await import('@/app/api/v1/registre/export-zip/route.js');
    return GET(
      new NextRequest(
        'http://localhost/api/v1/registre/export-zip?from=2026-04-01&to=2026-05-31',
        { method: 'GET' },
      ),
    );
  }

  /** Les collectes partent par lots, jamais en une liste que l'API refuse. */
  function attendreLots(): void {
    const lots = listesIn(rls, 'bordereaux_savr', 'collecte_id');
    expect(lots.length).toBeGreaterThan(1);
    expect(lots.every((l) => l.length <= TAILLE_LOT)).toBe(true);
    expect(TAILLE_LOT).toBeLessThanOrEqual(PLAFOND_IDS);
    expect(new Set(lots.flat()).size).toBe(450);
  }

  it('450 collectes sur la période, 60 bordereaux : le refus dit « Trop de bordereaux (60) », pas une erreur', async () => {
    connecter();
    rls = creerApiPlafonnee(registre(60));

    const res = await exporter();

    expect(res.status).toBe(422);
    const corps = (await res.json()) as { error: string };
    expect(corps.error).toContain('Trop de bordereaux (60)');
    attendreLots();
    expect(traceExport).not.toHaveBeenCalled();
  });

  it('450 collectes sur la période, 40 bordereaux émis et 20 brouillons : le ZIP porte les 40 émis', async () => {
    connecter();
    rls = creerApiPlafonnee(registre(40, 20));

    const res = await exporter();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(getObjectBytes).toHaveBeenCalledTimes(40);
    expect(traceExport).toHaveBeenCalledTimes(1);
    expect(
      (vi.mocked(traceExport).mock.calls[0]![1] as { nbLignes: number })
        .nbLignes,
    ).toBe(40);
    attendreLots();
  });

  it('le deuxième lot en échec : une erreur, ni ZIP partiel ni trace', async () => {
    connecter();
    rls = creerApiPlafonnee(registre(40));
    panneALaLecture(rls, 'bordereaux_savr', 2);

    const res = await exporter();

    expect(res.status).toBe(500);
    expect(getObjectBytes).not.toHaveBeenCalled();
    expect(traceExport).not.toHaveBeenCalled();
  });

  // Le ZIP porte les bordereaux « disponibles » au sens du registre
  // (`bordereauDisponible`) : émis ou corrigés. Un brouillon ou un bordereau
  // annulé n'y entre pas.
  describe('M4.2 / export ZIP des bordereaux : statuts retenus', () => {
    // Tous les statuts de l'enum, à tour de rôle.
    const STATUTS = Constants.plateforme.Enums.bordereau_statut;
    const statut = (i: number) => STATUTS[i % STATUTS.length]!;
    const numero = (i: number) => `BSAV-2026-${String(i).padStart(5, '0')}`;
    const rangs = suite(40, (i) => i);

    it('émis, corrigés, brouillons et annulés sur la période : le ZIP porte les émis et les corrigés, eux seuls', async () => {
      connecter();
      rls = creerApiPlafonnee({
        v_registre_dechets: suite(40, (i) => ({
          collecte_id: id('col', i),
          date_evenement: '2026-04-10',
        })),
        bordereaux_savr: suite(40, (i) => ({
          collecte_id: id('col', i),
          statut: statut(i),
          numero: numero(i),
          pdf_fichier_id: id('fichier', i),
        })),
        fichiers: suite(40, (i) => ({
          id: id('fichier', i),
          bucket: 'bordereaux',
          key: `b${i}.pdf`,
          deleted_at: null,
        })),
      });

      const res = await exporter();

      expect(res.status).toBe(200);
      expect([...STATUTS].sort()).toEqual([
        'annule',
        'brouillon',
        'corrige',
        'emis',
      ]);
      const attendus = rangs.filter((i) =>
        ['emis', 'corrige'].includes(statut(i)),
      );
      expect(attendus).toHaveLength(20);
      // Les noms de fichiers d'une archive se lisent en clair dans ses octets.
      const archive = Buffer.from(await res.arrayBuffer()).toString('latin1');
      expect(rangs.filter((i) => archive.includes(`${numero(i)}.pdf`))).toEqual(
        attendus,
      );
      // Même règle que la colonne « Bordereau » du registre.
      expect(attendus).toEqual(
        rangs.filter((i) => bordereauDisponible(statut(i))),
      );
      expect(getObjectBytes).toHaveBeenCalledTimes(20);
      expect(
        (vi.mocked(traceExport).mock.calls[0]![1] as { nbLignes: number })
          .nbLignes,
      ).toBe(20);
    });

    it('seulement des brouillons et des annulés sur la période : « Aucun bordereau », pas de ZIP', async () => {
      connecter();
      rls = creerApiPlafonnee({
        v_registre_dechets: suite(6, (i) => ({
          collecte_id: id('col', i),
          date_evenement: '2026-04-10',
        })),
        bordereaux_savr: suite(6, (i) => ({
          collecte_id: id('col', i),
          statut: i % 2 === 0 ? 'brouillon' : 'annule',
          numero: numero(i),
          pdf_fichier_id: id('fichier', i),
        })),
      });

      const res = await exporter();

      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe(
        'Aucun bordereau sur la période',
      );
      expect(getObjectBytes).not.toHaveBeenCalled();
      expect(traceExport).not.toHaveBeenCalled();
    });
  });
});

// ── Ordres de création abandonnés (listes Admin, fiche événement) ─────────────

describe('M0.6 / envois abandonnés au-delà des plafonds', () => {
  type Admin = Parameters<typeof lireCollectesEnvoiAbandonne>[0];

  const ordre = (
    seq: number,
    collecte: number,
    statut: string,
    event_type = 'collecte.creee',
  ): Ligne => ({
    id: id('ordre', seq),
    seq,
    aggregate_type: 'collecte',
    aggregate_id: id('col', collecte),
    event_type,
    statut,
  });

  it('sans liste : 1 300 créations abandonnées, seules celles ni renvoyées ni sorties de l’exception sont rendues', async () => {
    const api = creerApiPlafonnee({
      outbox_events: [
        // Une création abandonnée par collecte.
        ...suite(1300, (i) => ordre(i + 1, i, 'dead')),
        // Les 100 premières ont été renvoyées depuis leur fiche.
        ...suite(100, (i) => ordre(2000 + i, i, 'pending')),
        // Une modification abandonnée ne compte pas.
        ...suite(200, (i) =>
          ordre(3000 + i, 5000 + i, 'dead', 'collecte.modifiee'),
        ),
      ],
      collectes: suite(1300, (i) => ({
        id: id('col', i),
        statut: 'programmee',
        statut_tms: 'non_envoye',
        // 50 collectes ont reçu une référence depuis (acceptées à la main).
        tms_reference: i >= 100 && i < 150 ? 'REF' : null,
      })),
    });

    const { data, error } = await lireCollectesEnvoiAbandonne(
      api.client as Admin,
    );

    expect(error).toBeNull();
    expect(data.size).toBe(1150);
    expect(data.has(id('col', 0))).toBe(false); // renvoyée
    expect(data.has(id('col', 120))).toBe(false); // référence reçue
    expect(data.has(id('col', 150))).toBe(true);
    expect(data.has(id('col', 1299))).toBe(true);
    // Créations abandonnées lues par pages ; le reste par lots d'identifiants.
    attendrePages(api, 'outbox_events', 1300);
    const lots = [
      ...listesIn(api, 'outbox_events', 'aggregate_id'),
      ...listesIn(api, 'collectes', 'id'),
    ];
    expect(lots.every((l) => l.length <= TAILLE_LOT)).toBe(true);
    expect(new Set(listesIn(api, 'collectes', 'id').flat()).size).toBe(1200);
  });

  it('avec une liste de 450 collectes : celles dont la dernière création est abandonnée, sans relire les collectes', async () => {
    const api = creerApiPlafonnee({
      outbox_events: [
        ...suite(60, (i) => ordre(i + 1, i, 'dead')),
        ...suite(10, (i) => ordre(2000 + i, i, 'pending')),
        // Hors de la liste demandée.
        ordre(9000, 9000, 'dead'),
      ],
    });
    const liste = suite(450, (i) => id('col', i));

    const { data, error } = await lireCollectesEnvoiAbandonne(
      api.client as Admin,
      liste,
    );

    expect(error).toBeNull();
    expect([...data].sort()).toEqual(suite(50, (i) => id('col', 10 + i)));
    const lots = listesIn(api, 'outbox_events', 'aggregate_id');
    expect(lots.every((l) => l.length <= TAILLE_LOT)).toBe(true);
    expect(api.lecturesDe('collectes')).toHaveLength(0);
  });

  // 250 créations abandonnées : deux pages, puis trois lots de créations, puis
  // trois lots de collectes. Chaque étape en échec rend l'erreur, sans collecte.
  for (const [etape, table, rang] of [
    ['la deuxième page des créations abandonnées', 'outbox_events', 2],
    ['le premier lot des créations', 'outbox_events', 3],
    ['le premier lot des collectes', 'collectes', 1],
  ] as const) {
    it(`${etape} en échec : aucune collecte rendue, l’erreur est remontée`, async () => {
      const api = creerApiPlafonnee({
        outbox_events: suite(250, (i) => ordre(i + 1, i, 'dead')),
        collectes: suite(250, (i) => ({
          id: id('col', i),
          statut: 'programmee',
          statut_tms: 'non_envoye',
          tms_reference: null,
        })),
      });
      panneALaLecture(api, table, rang);

      const { data, error } = await lireCollectesEnvoiAbandonne(
        api.client as Admin,
      );

      expect(error).toMatchObject({ message: 'panne' });
      expect(data.size).toBe(0);
      // La panne est bien tombée à l'étape visée, pas avant.
      expect(api.lecturesDe(table).length).toBe(rang);
    });
  }
});

// ── Options de l'encart « Comparer avec » du Dashboard Client Admin ───────────

describe('M3.6 / filtres du benchmark Admin au-delà du plafond', () => {
  type Admin = Parameters<typeof loadAdminBenchmarkFiltres>[0];

  // Les noms vont à rebours des identifiants : un tri par identifiant ne peut
  // pas passer pour un tri par nom.
  const nomme = (prefixe: string, i: number, total: number) =>
    `${prefixe} ${String(total - i).padStart(5, '0')}`;

  function parc(): Record<string, Ligne[]> {
    return {
      lieux: [
        ...suite(1250, (i) => ({
          id: id('lieu', i),
          nom: nomme('Lieu', i, 1250),
          actif: true,
        })),
        ...suite(30, (i) => ({
          id: id('lieu-ferme', i),
          nom: `Fermé ${i}`,
          actif: false,
        })),
      ],
      organisations: [
        ...suite(1100, (i) => ({
          id: id('org', i),
          nom: nomme('Traiteur', i, 1100),
          type: 'traiteur',
          actif: true,
          est_shadow: false,
        })),
        {
          id: 'org-agence',
          nom: 'Agence',
          type: 'agence',
          actif: true,
          est_shadow: false,
        },
        {
          id: 'org-fantome',
          nom: 'Fantôme',
          type: 'traiteur',
          actif: true,
          est_shadow: true,
        },
        {
          id: 'org-inactive',
          nom: 'Inactive',
          type: 'traiteur',
          actif: false,
          est_shadow: false,
        },
      ],
      types_evenements: [
        { id: 'type-2', libelle: 'Séminaire', actif: true, ordre_affichage: 2 },
        { id: 'type-1', libelle: 'Cocktail', actif: true, ordre_affichage: 1 },
        { id: 'type-3', libelle: 'Ancien', actif: false, ordre_affichage: 3 },
      ],
    };
  }

  it('1 250 lieux et 1 100 traiteurs actifs : tous proposés, triés par nom', async () => {
    const api = creerApiPlafonnee(parc());

    const options = await loadAdminBenchmarkFiltres(api.client as Admin);

    expect(options.lieux).toHaveLength(1250);
    expect(options.traiteurs).toHaveLength(1100);
    expect(options.lieux.length).toBeGreaterThan(PLAFOND_LIGNES);
    const noms = (liste: { nom: string }[]) => liste.map((o) => o.nom);
    expect(noms(options.lieux)).toEqual([...noms(options.lieux)].sort());
    expect(noms(options.traiteurs)).toEqual(
      [...noms(options.traiteurs)].sort(),
    );
    expect(options.lieux[0]).toMatchObject({
      id: id('lieu', 1249),
      nom: 'Lieu 00001',
    });
    expect(options.traiteurs[0]).toMatchObject({
      id: id('org', 1099),
      nom: 'Traiteur 00001',
    });
    expect(options.types).toHaveLength(2);
    expect(options.types).toMatchObject([
      { id: 'type-1', libelle: 'Cocktail' },
      { id: 'type-2', libelle: 'Séminaire' },
    ]);
    attendrePages(api, 'lieux', 1250);
    attendrePages(api, 'organisations', 1100);
  });

  for (const [quoi, table] of [
    ['lieux', 'lieux'],
    ['traiteurs', 'organisations'],
  ] as const) {
    it(`la deuxième page des ${quoi} en échec : le chargement échoue, sans liste partielle`, async () => {
      const api = creerApiPlafonnee(parc());
      panneALaLecture(api, table, 2);

      await expect(
        loadAdminBenchmarkFiltres(api.client as Admin),
      ).rejects.toThrow('Erreur serveur');
    });
  }
});
