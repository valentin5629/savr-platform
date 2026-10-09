/**
 * M1.6 / M2.4 — Sélection des batchs PDF J+1 au-delà des plafonds de l'API de données.
 *
 * Défaut mesuré sur savr-dev le 2026-10-09 : avec 402 collectes ZD clôturées, le
 * filtre `in.(…)` sur les bordereaux existants faisait échouer la lecture
 * (« TypeError: fetch failed », en-têtes de réponse au-delà de 16 Ko) et le batch
 * s'arrêtait chaque nuit en échec de sélection. Une réponse est par ailleurs amputée
 * à 1000 lignes sans erreur. Les batchs lisent désormais les collectes par pages et
 * les documents existants par lots (src/lib/pdf/selection-par-pages.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { runBatchPdfJ1 } from '../../src/lib/pdf/batch-pdf-j1.js';
import { runBatchPdfJ1Ag } from '../../src/lib/pdf/batch-pdf-j1-ag.js';
import { runBatchSansExcedent } from '../../src/lib/pdf/batch-pdf-sans-excedent.js';
import {
  TAILLE_PAGE,
  TAILLE_LOT,
  lireParPages,
  lireParLots,
} from '../../src/lib/pdf/selection-par-pages.js';

// ── Fausse base : répond selon la requête reçue, et la consigne ──────────────

interface Requete {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  apresId: string | null;
  limite: number | null;
  tri: string | null;
  dans: string[] | null;
}

type Reponse = { data: unknown; error: { message: string } | null };

function fausseBase(repondre: (q: Requete) => Reponse) {
  const requetes: Requete[] = [];
  const from = (table: string) => {
    const q: Requete = {
      table,
      op: 'select',
      eq: {},
      apresId: null,
      limite: null,
      tri: null,
      dans: null,
    };
    requetes.push(q);
    const chaine: Record<string, unknown> = {
      select: () => chaine,
      insert: () => {
        q.op = 'insert';
        return chaine;
      },
      update: () => {
        q.op = 'update';
        return chaine;
      },
      eq: (colonne: string, valeur: unknown) => {
        q.eq[colonne] = valeur;
        return chaine;
      },
      lte: () => chaine,
      not: () => chaine,
      gt: (_colonne: string, valeur: string) => {
        q.apresId = valeur;
        return chaine;
      },
      order: (colonne: string) => {
        q.tri = colonne;
        return chaine;
      },
      limit: (n: number) => {
        q.limite = n;
        return chaine;
      },
      in: (_colonne: string, valeurs: string[]) => {
        q.dans = valeurs;
        return chaine;
      },
      then: (ok: (v: Reponse) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(repondre(q)).then(ok, ko),
    };
    return chaine;
  };
  const rpc = vi.fn(() => {
    const p = Promise.resolve({ data: null, error: null });
    return { single: () => p, then: p.then.bind(p) };
  });
  return {
    client: { from: vi.fn(from), rpc } as never,
    requetes,
    lectures: (table: string) =>
      requetes.filter((r) => r.table === table && r.op === 'select'),
    ecritures: () => requetes.filter((r) => r.op !== 'select'),
  };
}

/** `n` identifiants triés comme la base les trierait (ordre lexicographique). */
const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `col-${String(i).padStart(4, '0')}`);

/** Plafond de lignes d'une réponse de l'API de données (mesuré sur savr-dev). */
const PLAFOND_SERVEUR = 1000;

/**
 * Page de collectes telle que la base la rendrait : après `apresId`, triée,
 * limitée — et jamais plus de `PLAFOND_SERVEUR` lignes, limite demandée ou non.
 */
function pageDe<T extends { id: string }>(lignes: T[], q: Requete): T[] {
  const reste = q.apresId
    ? lignes.filter((l) => l.id > (q.apresId as string))
    : lignes;
  return reste.slice(0, Math.min(q.limite ?? PLAFOND_SERVEUR, PLAFOND_SERVEUR));
}

/** Forme attendue de chaque lecture de collectes : triée par id, bornée. */
function attendrePagesTrieesEtBornees(pages: Requete[]): void {
  expect(pages.length).toBeGreaterThan(0);
  expect(pages.map((p) => p.tri)).toEqual(pages.map(() => 'id'));
  expect(pages.map((p) => p.limite)).toEqual(pages.map(() => TAILLE_PAGE));
}

// ── lireParPages ─────────────────────────────────────────────────────────────

describe('M1.6 / sélection par pages — lireParPages', () => {
  it('lit toutes les pages en repartant du dernier id lu', async () => {
    const lignes = ids(TAILLE_PAGE * 2 + 3).map((id) => ({ id }));
    const appels: Array<string | null> = [];

    const { data, error } = await lireParPages<{ id: string }>((apresId) => {
      appels.push(apresId);
      const reste = apresId ? lignes.filter((l) => l.id > apresId) : lignes;
      return Promise.resolve({
        data: reste.slice(0, TAILLE_PAGE),
        error: null,
      });
    });

    expect(error).toBeNull();
    expect(data.map((l) => l.id)).toEqual(lignes.map((l) => l.id));
    expect(appels).toEqual([
      null,
      lignes[TAILLE_PAGE - 1]!.id,
      lignes[TAILLE_PAGE * 2 - 1]!.id,
    ]);
  });

  it("une dernière page exactement pleine est suivie d'une lecture vide", async () => {
    const lignes = ids(TAILLE_PAGE).map((id) => ({ id }));
    let appels = 0;

    const { data } = await lireParPages<{ id: string }>((apresId) => {
      appels++;
      return Promise.resolve({ data: apresId ? [] : lignes, error: null });
    });

    expect(data).toHaveLength(TAILLE_PAGE);
    expect(appels).toBe(2);
  });

  it("rend l'erreur d'une page sans rendre de lignes partielles", async () => {
    const lignes = ids(TAILLE_PAGE).map((id) => ({ id }));

    const { data, error } = await lireParPages<{ id: string }>((apresId) =>
      Promise.resolve(
        apresId
          ? { data: null, error: { message: 'page 2 KO', code: 'XX000' } }
          : { data: lignes, error: null },
      ),
    );

    expect(error).toEqual({ message: 'page 2 KO', code: 'XX000' });
    expect(data).toEqual([]);
  });

  it('une page non triée par id est une erreur (tri oublié dans la requête)', async () => {
    const { data, error } = await lireParPages<{ id: string }>(() =>
      Promise.resolve({
        data: [{ id: 'col-0002' }, { id: 'col-0001' }],
        error: null,
      }),
    );

    expect(error?.message).toMatch(/non triée/);
    expect(data).toEqual([]);
  });

  it('un id rendu deux fois dans une page est une erreur', async () => {
    const { data, error } = await lireParPages<{ id: string }>(() =>
      Promise.resolve({
        data: [{ id: 'col-0001' }, { id: 'col-0001' }],
        error: null,
      }),
    );

    expect(error?.message).toMatch(/non triée/);
    expect(data).toEqual([]);
  });

  it('une borne ignorée par le serveur est une erreur, pas une lecture sans fin', async () => {
    const lignes = ids(TAILLE_PAGE).map((id) => ({ id }));
    let appels = 0;

    // Le serveur rend toujours la même première page, pleine, quelle que soit la borne.
    const { data, error } = await lireParPages<{ id: string }>(() => {
      appels++;
      return Promise.resolve({ data: lignes, error: null });
    });

    expect(error?.message).toMatch(/non triée/);
    expect(data).toEqual([]);
    expect(appels).toBe(2);
  });

  it('la taille de page reste sous le plafond de lignes du serveur (supabase/config.toml)', () => {
    const config = readFileSync(
      resolve(__dirname, '../../../../supabase/config.toml'),
      'utf8',
    );
    const maxRows = Number(/^max_rows\s*=\s*(\d+)/m.exec(config)?.[1]);

    expect(maxRows).toBe(PLAFOND_SERVEUR);
    expect(TAILLE_PAGE).toBeLessThan(maxRows);
  });
});

// ── lireParLots ──────────────────────────────────────────────────────────

describe('M1.6 / sélection par pages — lireParLots', () => {
  it('découpe les identifiants et réunit les réponses', async () => {
    const tous = ids(TAILLE_LOT * 2 + 50);
    const tailles: number[] = [];

    const { data, error } = await lireParLots<{ collecte_id: string }>(
      tous,
      (tranche) => {
        tailles.push(tranche.length);
        return Promise.resolve({
          data: tranche.map((collecte_id) => ({ collecte_id })),
          error: null,
        });
      },
    );

    expect(error).toBeNull();
    expect(tailles).toEqual([TAILLE_LOT, TAILLE_LOT, 50]);
    expect(data.map((d) => d.collecte_id)).toEqual(tous);
  });

  it("rend l'erreur d'une tranche sans rendre de lignes partielles", async () => {
    let appels = 0;

    const { data, error } = await lireParLots<{ collecte_id: string }>(
      ids(TAILLE_LOT + 1),
      (tranche) =>
        Promise.resolve(
          ++appels === 2
            ? { data: null, error: { message: 'tranche 2 KO' } }
            : {
                data: tranche.map((collecte_id) => ({ collecte_id })),
                error: null,
              },
        ),
    );

    expect(error).toEqual({ message: 'tranche 2 KO' });
    expect(data).toEqual([]);
  });

  it('une tranche au plafond de lignes de la réponse est une erreur', async () => {
    const { data, error } = await lireParLots<{ collecte_id: string }>(
      ids(1),
      () =>
        Promise.resolve({
          data: Array.from({ length: 1000 }, () => ({ collecte_id: 'x' })),
          error: null,
        }),
    );

    expect(error?.message).toMatch(/plafond/);
    expect(data).toEqual([]);
  });

  it('aucun identifiant : aucune lecture', async () => {
    const lire = vi.fn();
    const { data, error } = await lireParLots<unknown>([], lire);
    expect(lire).not.toHaveBeenCalled();
    expect({ data, error }).toEqual({ data: [], error: null });
  });
});

// ── Les trois batchs, au-delà des plafonds ───────────────────────────────────

describe('M1.6 / batch ZD — 402 collectes clôturées (volume qui cassait savr-dev)', () => {
  const collectes = ids(402).map((id) => ({ id, evenement_id: `ev-${id}` }));

  it('lit les collectes par pages et les bordereaux par tranches, sans rien réémettre', async () => {
    const base = fausseBase((q) => {
      if (q.table === 'collectes')
        return { data: pageDe(collectes, q), error: null };
      if (q.table === 'bordereaux_savr')
        return {
          data: (q.dans ?? []).map((collecte_id) => ({
            collecte_id,
            statut: 'emis',
          })),
          error: null,
        };
      return { data: [], error: null };
    });

    const result = await runBatchPdfJ1(base.client);

    expect(result.fatal).toBeUndefined();
    expect(result.already_done).toBe(402);
    expect(result.enqueued).toBe(0);
    expect(base.ecritures()).toEqual([]);

    // Pages : 200 + 200 + 2, triées par id, bornées, chacune après la précédente.
    const pages = base.lectures('collectes');
    expect(pages.map((p) => p.apresId)).toEqual([
      null,
      collectes[TAILLE_PAGE - 1]!.id,
      collectes[TAILLE_PAGE * 2 - 1]!.id,
    ]);
    attendrePagesTrieesEtBornees(pages);

    // Tranches : jamais plus de TAILLE_LOT identifiants par filtre.
    const tranches = base.lectures('bordereaux_savr').map((t) => t.dans ?? []);
    expect(tranches.map((t) => t.length)).toEqual([100, 100, 100, 100, 2]);
    expect(tranches.flat()).toEqual(collectes.map((c) => c.id));
  });

  it('1 050 collectes, serveur plafonné à 1000 lignes et refusant un filtre de plus de 390 identifiants : toutes vues, aucune réémise', async () => {
    const beaucoup = ids(1050).map((id) => ({ id, evenement_id: `ev-${id}` }));
    const base = fausseBase((q) => {
      if (q.table === 'collectes')
        return { data: pageDe(beaucoup, q), error: null };
      if (q.table === 'bordereaux_savr')
        return (q.dans ?? []).length > 390
          ? { data: null, error: { message: 'TypeError: fetch failed' } }
          : {
              data: (q.dans ?? []).map((collecte_id) => ({
                collecte_id,
                statut: 'emis',
              })),
              error: null,
            };
      return { data: [], error: null };
    });

    const result = await runBatchPdfJ1(base.client);

    expect(result.fatal).toBeUndefined();
    expect(result.already_done).toBe(1050);
    expect(result.enqueued).toBe(0);
    expect(base.ecritures()).toEqual([]);
    attendrePagesTrieesEtBornees(base.lectures('collectes'));
    expect(base.lectures('collectes')).toHaveLength(6);
  });

  it('un échec sur la 2e tranche de bordereaux reste fail-closed (fatal, rien traité)', async () => {
    let tranche = 0;
    const base = fausseBase((q) => {
      if (q.table === 'collectes')
        return { data: pageDe(collectes, q), error: null };
      if (q.table === 'bordereaux_savr')
        return ++tranche === 2
          ? { data: null, error: { message: 'TypeError: fetch failed' } }
          : { data: [], error: null };
      return { data: [], error: null };
    });

    const result = await runBatchPdfJ1(base.client);

    expect(result.fatal).toMatchObject({
      etape: 'selection',
      message: 'Sélection bordereaux existants : TypeError: fetch failed',
    });
    expect(result.enqueued).toBe(0);
    expect(base.ecritures()).toEqual([]);
  });
});

describe('M2.4 / batch AG — attestation déjà émise au-delà de la 1re tranche', () => {
  const collectes = ids(250).map((id) => ({
    id,
    evenement_id: `ev-${id}`,
    evenements: { organisation_id: 'org-1' },
    attributions_antgaspi: {
      id: `attr-${id}`,
      volume_repas_realise: 100,
      poids_repas_kg: 45,
      association_id: 'asso-1',
      associations: null,
    },
  }));

  it("aucune des 250 collectes déjà attestées n'est réattestée (idempotence R8)", async () => {
    const base = fausseBase((q) => {
      if (q.table === 'collectes')
        return { data: pageDe(collectes, q), error: null };
      if (q.table === 'attestations_don' && q.op === 'select')
        return {
          data: (q.dans ?? []).map((collecte_id) => ({
            collecte_id,
            statut: 'emise',
          })),
          error: null,
        };
      return { data: [], error: null };
    });

    const result = await runBatchPdfJ1Ag(base.client);

    expect(result.fatal).toBeUndefined();
    expect(result.already_done).toBe(250);
    expect(result.enqueued).toBe(0);
    expect(base.ecritures()).toEqual([]);
    expect(base.lectures('collectes')).toHaveLength(2);
    attendrePagesTrieesEtBornees(base.lectures('collectes'));
    expect(
      base.lectures('attestations_don').map((t) => (t.dans ?? []).length),
    ).toEqual([100, 100, 50]);
  });

  it('150 organisations à traiter : entités de facturation lues par lots, aucune attestation sans entité', async () => {
    const aTraiter = ids(150).map((id) => ({
      id,
      evenement_id: `ev-${id}`,
      evenements: {
        nom_evenement: 'Gala',
        date_evenement: '2026-06-13',
        organisation_id: `org-${id}`,
      },
      attributions_antgaspi: {
        id: `attr-${id}`,
        volume_repas_realise: 100,
        poids_repas_kg: 45,
        association_id: 'asso-1',
        associations: null,
      },
    }));
    const base = fausseBase((q) => {
      if (q.table === 'collectes')
        return { data: pageDe(aTraiter, q), error: null };
      // Aucune attestation existante, aucune entité de facturation connue.
      return { data: [], error: null };
    });

    const result = await runBatchPdfJ1Ag(base.client);

    expect(result.fatal).toBeUndefined();
    expect(
      base.lectures('entites_facturation').map((t) => (t.dans ?? []).length),
    ).toEqual([100, 50]);
    // Sans entité au SIRET vérifié, l'attestation est différée, jamais émise.
    expect(result.skipped_siret_donateur).toBe(150);
    expect(result.enqueued).toBe(0);
    expect(base.ecritures()).toEqual([]);
  });
});

describe('M2.4 / batch sans excédent — rapport existant au-delà de la 1re tranche', () => {
  const collectes = ids(150).map((id) => ({
    id,
    evenement_id: `ev-${id}`,
    evenements: null,
  }));

  it("aucune des 150 collectes déjà documentées n'est redocumentée", async () => {
    const base = fausseBase((q) => {
      if (q.table === 'collectes')
        return { data: pageDe(collectes, q), error: null };
      if (q.table === 'rapports_rse' && q.op === 'select')
        return {
          data: (q.dans ?? []).map((collecte_id) => ({ collecte_id })),
          error: null,
        };
      return { data: [], error: null };
    });

    const result = await runBatchSansExcedent(base.client);

    expect(result.fatal).toBeUndefined();
    expect(result.already_done).toBe(150);
    expect(result.enqueued).toBe(0);
    expect(base.ecritures()).toEqual([]);
    attendrePagesTrieesEtBornees(base.lectures('collectes'));
    expect(
      base.lectures('rapports_rse').map((t) => (t.dans ?? []).length),
    ).toEqual([100, 50]);
  });
});
