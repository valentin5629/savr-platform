/**
 * Tests unitaires M0.7 — seed minimal + demo (sans base de données).
 * Couvre : déterminisme UUID v5, helpers fictifs, garde-fou prod, matrice CSV,
 * construction SQL de l'upsert.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { seedUuid } from './uuid.js';
import {
  fakePhone,
  seedEmail,
  DEV_PROJECT_REF,
  horairesAssociationSeed,
} from './constants.js';
import { assertDev, upsert, jsonb, type Row } from './db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

const UUID_V5_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('seedUuid', () => {
  it('M0.7-1 — seedUuid est déterministe (même slug → même UUID v5)', () => {
    expect(seedUuid('org_tr_kaspia')).toBe(seedUuid('org_tr_kaspia'));
    // valeur figée : régression si l'algo ou le namespace change
    expect(seedUuid('org_tr_kaspia')).toMatch(UUID_V5_RE);
  });

  it('M0.7-2 — seedUuid respecte le format UUID v5 (version 5, variant RFC 4122)', () => {
    for (const slug of ['a', 'col_zd_palier_haut', 'user_admin']) {
      expect(seedUuid(slug)).toMatch(UUID_V5_RE);
    }
  });

  it('M0.7-3 — seedUuid produit des UUID distincts pour des slugs distincts', () => {
    expect(seedUuid('org_tr_kaspia')).not.toBe(seedUuid('org_tr_fleurdemets'));
  });
});

describe('helpers fictifs', () => {
  it('M0.7-4 — fakePhone génère un numéro dans le range fictif +33 6 99 99', () => {
    expect(fakePhone(1)).toMatch(/^\+33 6 99 99 \d{2} \d{2}$/);
    expect(fakePhone(42)).toMatch(/^\+33 6 99 99 /);
  });

  it('M0.7-5 — seedEmail génère une adresse @savr-test.local', () => {
    expect(seedEmail('manager_kaspia')).toBe('manager.kaspia@savr-test.local');
    expect(seedEmail('contact.alpha')).toMatch(/@savr-test\.local$/);
  });
});

describe('assertDev — garde-fou prod', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const devEnv = {
    SUPABASE_PROJECT_REF: DEV_PROJECT_REF,
    DIRECT_URL: `postgres://x@db.${DEV_PROJECT_REF}.supabase.co:5432/postgres`,
  };

  it('M0.7-6 — assertDev rejette un SUPABASE_PROJECT_REF différent du projet dev', () => {
    expect(() =>
      assertDev({ SUPABASE_PROJECT_REF: 'prod-ref-xyz', DIRECT_URL: 'x' }),
    ).toThrow(/projet dev/);
  });

  it('M0.7-7 — assertDev rejette NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertDev(devEnv)).toThrow(/production/);
  });

  it('M0.7-8 — assertDev accepte le projet dev', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => assertDev(devEnv)).not.toThrow();
  });
});

describe('matrice CSV demo', () => {
  const csv = readFileSync(
    resolve(REPO_ROOT, 'fixtures/data/matrix_collectes.csv'),
    'utf8',
  );
  const rows = csv
    .trim()
    .split('\n')
    .slice(1)
    .filter((l) => l.trim().length > 0);

  it('M0.7-9 — matrix_collectes.csv contient exactement 478 collectes', () => {
    expect(rows.length).toBe(478);
  });

  it('M0.7-10 — la somme des collectes par traiteur dans la matrice = 478', () => {
    const byTraiteur = new Map<string, number>();
    for (const l of rows) {
      const t = l.split(',')[1]!;
      byTraiteur.set(t, (byTraiteur.get(t) ?? 0) + 1);
    }
    const total = [...byTraiteur.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(478);
    expect(byTraiteur.size).toBeGreaterThanOrEqual(7);
  });
});

describe('upsert — construction SQL', () => {
  // client factice : capture la requête sans base de données.
  function fakeClient() {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      query: (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return Promise.resolve({ rows: [] });
      },
    };
  }

  it('M0.7-11 — upsert construit un INSERT ... ON CONFLICT paramétré', async () => {
    const c = fakeClient();
    const rows: Row[] = [
      { id: 'a', nom: 'X' },
      { id: 'b', nom: 'Y' },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsert(c as any, 'plateforme.t', rows, ['id']);
    expect(c.calls).toHaveLength(1);
    const { sql, params } = c.calls[0]!;
    expect(sql).toContain('INSERT INTO plateforme.t (id, nom)');
    expect(sql).toContain('ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom');
    expect(sql).toContain('($1, $2)');
    expect(sql).toContain('($3, $4)');
    expect(params).toEqual(['a', 'X', 'b', 'Y']);
  });

  it('M0.7-12 — upsert sérialise les colonnes jsonb avec un cast ::jsonb', async () => {
    const c = fakeClient();
    const rows: Row[] = [{ id: 'a', payload: jsonb({ k: 1 }) }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsert(c as any, 'plateforme.t', rows, ['id']);
    const { sql, params } = c.calls[0]!;
    expect(sql).toContain('::jsonb');
    expect(params).toContain(JSON.stringify({ k: 1 }));
  });
});

// ─── Rattachement transporteur → prestataire (seed_minimal) ──────────────────
//
// Les adapters cloisonnent les tournées par
// `tournees.prestataire_logistique_id` → `transporteurs.type_tms`. Si le seed
// ne rattache aucun transporteur à son prestataire, le référentiel ne relie
// AUCUN prestataire à un type de TMS : l'ensemble est vide, toutes les tournées
// sont écartées, et E2/E3 deviennent universellement muettes sur une base
// seedée — sans alerte, puisque les tournées du seed sont terminales (donc
// écartées en silence). Panne invisible, d'où ce garde.
//
// Contrôle sur la SOURCE et non à l'exécution : `seedMinimal` exige une vraie
// base (lookupMap, upsert). Ce qui est vérifié est l'appel, pas le SQL produit.
describe('seed_minimal — un transporteur, un prestataire', () => {
  const source = readFileSync(
    resolve(REPO_ROOT, 'packages/shared/src/seed/minimal.ts'),
    'utf8',
  );

  /** Arguments littéraux de chaque appel `transp(...)` (parenthèses équilibrées). */
  function appelsTransp(): string[][] {
    const appels: string[][] = [];
    let i = source.indexOf('transp(');
    while (i !== -1) {
      // La déclaration `function transp(` n'est pas un appel.
      if (!/function\s+$/.test(source.slice(Math.max(0, i - 12), i))) {
        let profondeur = 0;
        let j = i + 'transp'.length;
        for (; j < source.length; j++) {
          if (source[j] === '(') profondeur++;
          else if (source[j] === ')') {
            profondeur--;
            if (profondeur === 0) break;
          }
        }
        const args = source.slice(i, j);
        appels.push([...args.matchAll(/'([^']*)'/g)].map((m) => m[1]!));
      }
      i = source.indexOf('transp(', i + 1);
    }
    return appels;
  }

  const prestatairesSeedes = [
    ...source.matchAll(/prest\(\s*'prest_([a-z_]+)'/g),
  ].map((m) => m[1]!);

  it('M0.7-30 — le helper transp() pose prestataire_logistique_id', () => {
    // Sans cette ligne, le seed produit des transporteurs orphelins et le
    // cloisonnement par provider n'a plus aucun prestataire à reconnaître.
    expect(source).toContain(
      "prestataire_logistique_id: U('prest_' + prestSlug)",
    );
  });

  it('M0.7-31 — chaque transporteur seedé nomme un prestataire réellement seedé', () => {
    const appels = appelsTransp();
    expect(appels.length).toBeGreaterThan(0);
    for (const args of appels) {
      const prestSlug = args[args.length - 1];
      expect(prestatairesSeedes).toContain(prestSlug);
    }
  });

  it('M0.7-32 — deux transporteurs ne partagent jamais un prestataire', () => {
    // Invariant imposé en base par `uniq_transporteur_par_prestataire` : un
    // prestataire rattaché à deux `type_tms` entrerait dans les deux ensembles
    // et rouvrirait la fuite entre providers. Le seed doit pouvoir s'appliquer.
    const slugs = appelsTransp().map((args) => args[args.length - 1]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('horairesAssociationSeed — format éditeur Admin', () => {
  it('M0.7-13 — 7 jours lundi→dimanche au format { jour, ouvert, creneaux HH:mm }', () => {
    for (const profil of ['24h', 'jour_semaine', 'soir_nuit'] as const) {
      const h = horairesAssociationSeed(profil);
      expect(h.map((j) => j.jour)).toEqual([
        'lundi',
        'mardi',
        'mercredi',
        'jeudi',
        'vendredi',
        'samedi',
        'dimanche',
      ]);
      for (const j of h)
        for (const c of j.creneaux) {
          expect(c.debut).toMatch(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
          expect(c.fin).toMatch(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
        }
    }
  });

  it('M0.7-14 — profils : 24h/24 tous les jours, jours ouvrés fermés le week-end, soir/nuit passe minuit', () => {
    expect(
      horairesAssociationSeed('24h').every(
        (j) =>
          j.ouvert &&
          j.creneaux[0]!.debut === '00:00' &&
          j.creneaux[0]!.fin === '00:00',
      ),
    ).toBe(true);
    const ouvre = horairesAssociationSeed('jour_semaine');
    expect(ouvre.filter((j) => j.ouvert).map((j) => j.jour)).toEqual([
      'lundi',
      'mardi',
      'mercredi',
      'jeudi',
      'vendredi',
    ]);
    expect(
      horairesAssociationSeed('soir_nuit').every(
        (j) => j.ouvert && j.creneaux[0]!.fin <= j.creneaux[0]!.debut,
      ),
    ).toBe(true);
  });
});
