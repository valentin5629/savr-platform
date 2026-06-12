/**
 * Connexion Postgres directe pour les scripts de seed (dev only).
 *
 * On utilise `pg` sur DIRECT_URL (port 5432) plutôt que PostgREST/supabase-js :
 *   - TRUNCATE ... CASCADE et session_replication_role = replica (bloc historique demo)
 *   - insertion en masse + upsert déterministe sur UUID v5
 *   - pas besoin d'exposer les schémas plateforme/shared via PostgREST.
 *
 * Garde-fou prod : double vérification (NODE_ENV + project ref dev hard-codé).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { DEV_PROJECT_REF } from './constants.js';

// pg renvoie les numeric/bigint en string par défaut ; on garde ce comportement
// (les montants sont comparés en string dans seed:check, pas d'arithmétique JS).

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/shared/src/seed → racine repo = ../../../..
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

export function loadEnv(): Record<string, string> {
  const path = resolve(REPO_ROOT, '.env.local');
  const raw = readFileSync(path, 'utf8');
  const env: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return env;
}

/**
 * Garde-fou prod bloquant. Lève si on n'est pas certain d'être sur le projet dev.
 */
export function assertDev(env: Record<string, string>): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed interdit : NODE_ENV=production.');
  }
  const ref = env.SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF;
  if (ref !== DEV_PROJECT_REF) {
    throw new Error(
      `Seed interdit : SUPABASE_PROJECT_REF="${ref}" ≠ projet dev attendu (${DEV_PROJECT_REF}).`,
    );
  }
  const direct = env.DIRECT_URL || '';
  if (!direct.includes(DEV_PROJECT_REF)) {
    throw new Error(
      'Seed interdit : DIRECT_URL ne pointe pas sur le projet dev.',
    );
  }
}

export async function connect(env: Record<string, string>): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: env.DIRECT_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

// Colonnes jsonb : on sérialise les objets/arrays JS en JSON (sinon `pg` les
// passe en littéral tableau Postgres, faux pour du jsonb).
const JSONB_MARK = Symbol('jsonb');
export function jsonb(value: unknown): { [JSONB_MARK]: true; value: unknown } {
  return { [JSONB_MARK]: true, value };
}
function isJsonb(v: unknown): v is { [JSONB_MARK]: true; value: unknown } {
  return typeof v === 'object' && v !== null && JSONB_MARK in v;
}

export type Row = Record<string, unknown>;

/**
 * Upsert idempotent multi-lignes. Toutes les lignes doivent porter les mêmes
 * colonnes. `conflict` = colonnes de la contrainte ON CONFLICT.
 */
export async function upsert(
  client: pg.Client,
  table: string,
  rows: Row[],
  conflict: string[],
): Promise<void> {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!);
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = cols.map((c) => {
      const v = row[c];
      if (isJsonb(v)) {
        params.push(JSON.stringify(v.value));
        return `$${params.length}::jsonb`;
      }
      params.push(v);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  const updates = cols
    .filter((c) => !conflict.includes(c))
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');
  const onConflict =
    updates.length > 0
      ? `ON CONFLICT (${conflict.join(', ')}) DO UPDATE SET ${updates}`
      : `ON CONFLICT (${conflict.join(', ')}) DO NOTHING`;
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ${onConflict}`;
  await client.query(sql, params);
}

/** Lit un référentiel et renvoie une map clé naturelle → id. */
export async function lookupMap(
  client: pg.Client,
  sql: string,
  keyCol: string,
  idCol = 'id',
): Promise<Map<string, string>> {
  const res = await client.query(sql);
  const map = new Map<string, string>();
  for (const r of res.rows) map.set(String(r[keyCol]), String(r[idCol]));
  return map;
}
