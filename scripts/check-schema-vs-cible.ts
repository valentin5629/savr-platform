#!/usr/bin/env tsx
/**
 * G6 — check:schema-vs-ddl-cible (garde-fou 1 TMS-Ready, MODE RAPPORT, T0).
 * =============================================================================
 * Garde-fou 1 (CLAUDE.md §3bis-1 / Frontière TMS-Ready) : le data model V1 doit
 * rester ⊂ data model cible V2, sauf divergences explicitement TRACÉES. Sinon,
 * une structure V1 renommée/migrée en silence = refonte massive au cutover V2.
 *
 * G6 compare le schéma V1 RÉSULTANT des migrations (base réelle, après
 * `supabase db reset`) au DDL cible gelé (`specs/ddl-cible/schema_cible_v2.sql`,
 * chargé dans une base scratch). Diff via `pg_catalog` (décision Val
 * 2026-06-24 : zéro dépendance npm, sémantique Postgres réelle — pas de parser
 * SQL maison ni de libpg_query ; pg_catalog plutôt qu'information_schema pour
 * exclure vues et enfants de partition). Pour chaque colonne V1 (schémas
 * `plateforme` + `shared`) :
 *   - nom ⊆ cible ?        (table + colonne présentes dans la cible)
 *   - type identique ?     (udt_name ; numeric → précision/échelle en 2e bucket)
 *   - champ renommable ?   (colonne V1 absente de la cible = candidat rename)
 * Hors allowlist `specs/ddl-cible/v1-divergences-allowlist.txt` = SIGNALÉ.
 *
 * Distinct de G7 : G7 compare au schéma RÉEL V1 (anti-500 runtime) ; G6 compare
 * au CIBLE V2 (anti-renommage futur). Les deux sont nécessaires.
 *
 * Connexion : psql via DATABASE_URL (V1) + CIBLE_DATABASE_URL (cible scratch).
 * Le job CI crée la base scratch + charge le DDL cible + pose les 2 URLs.
 *
 * MODE RAPPORT : informe, ne bloque jamais (exit 0). Résumé $GITHUB_STEP_SUMMARY
 * + compteur de burn-down. Flip bloquant (T1) une fois l'allowlist stabilisée.
 * =============================================================================
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';

const ALLOWLIST_PATH = 'specs/ddl-cible/v1-divergences-allowlist.txt';
const SCHEMAS = ['plateforme', 'shared'];
const MAX_LIST = 100;

interface Col {
  schema: string;
  table: string;
  column: string;
  udt: string; // typname (enum/base) — check « type identique ? » principal
  fmt: string; // format_type (avec précision/longueur) — bucket 2 fin
  nullable: string;
}

// ---------------------------------------------------------------------------
// Extraction des colonnes via psql / pg_catalog.
// pg_catalog (et non information_schema) pour :
//   - exclure les VUES (le DDL cible exclut explicitement les vues dérivées) ;
//   - exclure les ENFANTS de partition (audit_log_2026…) — bruit ; l'intérêt
//     est la table parente partitionnée (incluse). relkind IN ('r','p') +
//     NOT relispartition couvre les deux.
// ---------------------------------------------------------------------------
function columnsOf(databaseUrl: string, label: string): Col[] | null {
  const sql = `
    SELECT n.nspname, c.relname, a.attname,
           t.typname,
           format_type(a.atttypid, a.atttypmod),
           CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END
    FROM pg_attribute a
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t      ON t.oid = a.atttypid
    WHERE n.nspname IN (${SCHEMAS.map((s) => `'${s}'`).join(',')})
      AND c.relkind IN ('r','p')
      AND NOT c.relispartition
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY 1,2,a.attnum;`;
  const res = spawnSync(
    'psql',
    [
      databaseUrl,
      '-X',
      '-A',
      '-t',
      '-F',
      '\t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    console.error(`[schema-vs-cible] psql a échoué pour ${label} :`);
    console.error((res.stderr ?? '') + (res.stdout ?? ''));
    return null;
  }
  const cols: Col[] = [];
  for (const line of (res.stdout ?? '').split('\n')) {
    if (!line.trim()) continue;
    const p = line.split('\t');
    if (p.length < 6) continue;
    cols.push({
      schema: p[0]!.trim(),
      table: p[1]!.trim(),
      column: p[2]!.trim(),
      udt: p[3]!.trim(),
      fmt: p[4]!.trim(),
      nullable: p[5]!.trim(),
    });
  }
  return cols;
}

function loadAllowlist(): { tables: Set<string>; columns: Set<string> } {
  const tables = new Set<string>();
  const columns = new Set<string>();
  if (!existsSync(ALLOWLIST_PATH)) return { tables, columns };
  for (const raw of readFileSync(ALLOWLIST_PATH, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const dots = line.split('.').length;
    if (dots === 2)
      tables.add(line); // schema.table
    else if (dots === 3) columns.add(line); // schema.table.column
  }
  return { tables, columns };
}

// ---------------------------------------------------------------------------
function main(): void {
  const v1Url = process.env.DATABASE_URL;
  const cibleUrl = process.env.CIBLE_DATABASE_URL;

  const lines: string[] = [
    '## G6 — Schéma V1 vs DDL cible V2 (mode rapport)',
    '',
  ];

  if (!v1Url || !cibleUrl) {
    lines.push(
      '⚠️ `DATABASE_URL` (V1) et/ou `CIBLE_DATABASE_URL` (cible scratch) absent(s) — ' +
        'diff non exécuté. Le job CI charge la cible dans une base scratch et pose les 2 URLs.',
    );
    emit(lines);
    console.log('[schema-vs-cible] URLs manquantes — non bloquant (exit 0).');
    process.exit(0);
  }

  const v1 = columnsOf(v1Url, 'V1 (réel)');
  const cible = columnsOf(cibleUrl, 'cible V2');
  if (!v1 || !cible) {
    lines.push(
      '⚠️ Extraction `pg_catalog` impossible (cf. logs) — diff ignoré.',
    );
    emit(lines);
    process.exit(0);
  }

  const { tables: allowTables, columns: allowColumns } = loadAllowlist();
  const key = (c: Col) => `${c.schema}.${c.table}.${c.column}`;
  const tkey = (c: Col) => `${c.schema}.${c.table}`;

  const cibleByKey = new Map(cible.map((c) => [key(c), c]));
  const cibleTables = new Set(cible.map(tkey));
  const v1Tables = [...new Set(v1.map(tkey))].sort();

  // 1. Tables V1 absentes de la cible (non allowlistées).
  const tablesV1Only = v1Tables.filter(
    (t) => !cibleTables.has(t) && !allowTables.has(t),
  );

  // 2 & 3. Colonnes : absente de la cible (renommable) OU type divergent.
  const colMissing: string[] = []; // colonne V1 absente cible (rename candidat)
  const typeMismatch: string[] = []; // colonne présente, udt différent
  const precisionMismatch: string[] = []; // 2e bucket (numeric précision/échelle)

  for (const c of v1) {
    const t = tkey(c);
    // Table déjà signalée entière ou allowlistée → ne pas re-signaler colonne par colonne.
    if (allowTables.has(t)) continue;
    if (!cibleTables.has(t)) continue; // table V1-only déjà comptée au bucket 1
    if (allowColumns.has(key(c))) continue;

    const tgt = cibleByKey.get(key(c));
    if (!tgt) {
      colMissing.push(
        `${key(c)} (${c.udt}) — absente de la cible → renommable/migrable ?`,
      );
      continue;
    }
    if (tgt.udt !== c.udt) {
      typeMismatch.push(`${key(c)} : V1 ${c.udt} ≠ cible ${tgt.udt}`);
      continue;
    }
    // Même type de base mais format divergent (précision numeric, longueur
    // varchar…) → 2e bucket basse confiance.
    if (c.fmt !== tgt.fmt) {
      precisionMismatch.push(`${key(c)} : V1 ${c.fmt} ≠ cible ${tgt.fmt}`);
    }
  }

  const totalHaute =
    tablesV1Only.length + colMissing.length + typeMismatch.length;

  lines.push(
    'Diff du schéma V1 (migrations réelles) ↔ DDL cible V2 gelé, via ' +
      '`pg_catalog` (tables de base + parents partitionnés, hors vues/enfants de ' +
      `partition) sur deux bases Postgres. Hors allowlist \`${ALLOWLIST_PATH}\` = signalé.`,
    '',
    `**Divergences haute confiance : ${totalHaute}** ` +
      `(tables V1-only : ${tablesV1Only.length} · colonnes renommables : ${colMissing.length} · ` +
      `types divergents : ${typeMismatch.length}) · ` +
      `précision numeric : ${precisionMismatch.length} (2e bucket) · ` +
      `allowlist : ${allowTables.size} table(s) + ${allowColumns.size} colonne(s).`,
    '',
  );

  section(
    lines,
    '### ⛔ Tables V1 absentes de la cible (hors allowlist)',
    tablesV1Only,
  );
  section(
    lines,
    '### ⛔ Colonnes V1 absentes de la cible — candidates rename/migration',
    colMissing,
  );
  section(lines, '### ⛔ Types divergents (udt_name) V1 ≠ cible', typeMismatch);
  section(
    lines,
    '### ℹ️ Précision numeric divergente (2e bucket, basse confiance)',
    precisionMismatch,
  );

  lines.push(
    '',
    '> Mode RAPPORT — informatif, non bloquant. Flip bloquant (T1) une fois ' +
      "l'allowlist stabilisée (colonnes V1-only + Bloc 7 A6).",
  );

  emit(lines);
  console.log(
    `[schema-vs-cible] Burn-down (haute confiance) : ${totalHaute} ` +
      `(tables ${tablesV1Only.length} · colonnes ${colMissing.length} · types ${typeMismatch.length}).`,
  );
  console.log('[schema-vs-cible] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

function section(lines: string[], title: string, items: string[]): void {
  lines.push(title);
  if (items.length === 0) lines.push('_Aucune._');
  else {
    for (const i of items.slice(0, MAX_LIST)) lines.push(`- ${i}`);
    if (items.length > MAX_LIST)
      lines.push(
        `- … +${items.length - MAX_LIST} (liste tronquée à ${MAX_LIST})`,
      );
  }
  lines.push('');
}

function emit(lines: string[]): void {
  const report = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  console.log(report);
}

main();
