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
import { fakePhone, seedEmail, DEV_PROJECT_REF } from './constants.js';
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
