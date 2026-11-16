/**
 * Trois lectures au-delà des plafonds de l'API de données (suite de
 * `lectures-au-dela-plafond.test.ts`).
 *
 * Une réponse est amputée à 1 000 lignes sans erreur, et un filtre `in.(…)` de
 * plus de quelques centaines d'identifiants fait échouer la lecture (mesures :
 * `src/lib/pdf/selection-par-pages.ts`). Restaient en une requête : les ordres
 * de création abandonnés des listes Admin, et les options de l'encart
 * « Comparer avec » du Dashboard Client Admin (l'export ZIP des bordereaux du
 * registre est retiré, Val 2026-11-13).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  creerApiPlafonnee,
  PLAFOND_LIGNES,
  type Ligne,
} from '@/test-utils/api-donnees-plafonnee';
import { TAILLE_LOT, TAILLE_PAGE } from '@/lib/pdf/selection-par-pages.js';

type Api = ReturnType<typeof creerApiPlafonnee>;
type Client = { from: (table: string) => unknown };

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
