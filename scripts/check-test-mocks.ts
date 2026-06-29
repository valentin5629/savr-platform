#!/usr/bin/env tsx
/**
 * G5 — check:test-mocks (MODE RAPPORT, T0). Durci en R9 (cluster C7).
 * =============================================================================
 * Ferme la cause racine « L4 — test complaisant » sur le code le PLUS concurrent
 * du repo : le worker outbox. Un test qui mocke le worker (ou sa logique de
 * retry/DLQ/claim) dans SES PROPRES tests ne prouve rien — il valide le mock, pas
 * le code. BL-P1-OUTBOX-03 exige que `runOutboxWorker` soit exercé pour de vrai
 * (seules frontières mockables : le client Supabase et l'appel HTTP de l'adapter).
 *
 * Règle : un fichier de test qui IMPORTE `runOutboxWorker` (donc le teste) ne doit
 * pas, dans le même fichier :
 *   - `vi.mock(... outbox-worker ...)`  → mocke tout le module sous test
 *   - mocker/spier `runOutboxWorker`, `handleError`, `getNextRetryAt`
 *     (`vi.spyOn(..., 'runOutboxWorker')`, `vi.mocked(runOutboxWorker)`, etc.)
 *
 * Mocker le client Supabase, `sendAlert` (sink), ou `AdapterMts1.prototype.*`
 * (la frontière HTTP) reste AUTORISÉ : ce sont les vraies frontières externes.
 *
 * MODE RAPPORT : informe, n'échoue jamais (exit 0). Compteur RATCHET_COUNT lu par
 * check-ratchet pour le cliquet anti-régression.
 * =============================================================================
 */
import { readFileSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['packages', 'apps'];
const WORKER_FNS = ['runOutboxWorker', 'handleError', 'getNextRetryAt'];

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (e === 'node_modules' || e === 'dist' || e === '.next') continue;
      out = out.concat(walk(p));
    } else if (/\.test\.tsx?$/.test(e)) {
      out.push(p);
    }
  }
  return out;
}

interface Violation {
  file: string;
  reason: string;
}

function check(file: string): Violation[] {
  const src = readFileSync(file, 'utf8');
  // « Ses propres tests » = co-localisés avec le worker → import RELATIF de
  // ./outbox-worker (les tests adapters). Un test de ROUTE qui importe le worker
  // via le chemin package (@savr/adapters/…/outbox-worker) pour le mocker comme
  // dépendance (ex. cron-auth : teste l'auth de la route, pas le worker) est
  // LÉGITIME → exempté.
  const importsWorkerRelative =
    /from\s+['"]\.{1,2}\/(?:[^'"]*\/)?outbox-worker(?:\.js)?['"]/.test(src);
  if (!importsWorkerRelative) return [];

  const v: Violation[] = [];

  // 1. mock du module worker entier
  if (/vi\.mock\(\s*['"][^'"]*outbox-worker[^'"]*['"]/.test(src)) {
    v.push({
      file,
      reason:
        "vi.mock('…outbox-worker…') — le module sous test ne doit pas être mocké (G5).",
    });
  }

  // 2. spy / mock des fonctions internes du worker
  for (const fn of WORKER_FNS) {
    const spyRe = new RegExp(`spyOn\\([^)]*['"]${fn}['"]`);
    const mockedRe = new RegExp(`vi\\.mocked\\(\\s*${fn}\\b`);
    const implRe = new RegExp(
      `\\b${fn}\\b\\s*=\\s*vi\\.fn|${fn}\\.mock(Resolved|Returned|Implementation)`,
    );
    if (spyRe.test(src) || mockedRe.test(src) || implRe.test(src)) {
      v.push({
        file,
        reason: `mock/spy de '${fn}' — le vrai chemin du worker doit être exercé (G5).`,
      });
    }
  }
  return v;
}

function main(): void {
  const files = ROOTS.flatMap((r) => walk(r));
  const violations = files.flatMap(check);

  const lines: string[] = [];
  lines.push('## G5 — check:test-mocks (mode rapport)');
  lines.push('');
  lines.push(
    'Interdit de mocker le VRAI chemin du worker outbox dans ses propres tests ' +
      '(`runOutboxWorker` / `handleError` / `getNextRetryAt`). Mocker le client ' +
      'Supabase, `sendAlert` (sink) ou la frontière HTTP de l’adapter reste autorisé.',
  );
  lines.push('');
  lines.push(`**${violations.length} violation(s) G5.**`);
  for (const x of violations) lines.push(`- \`${x.file}\` — ${x.reason}`);

  const report = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }
  console.log(report);
  console.log(`RATCHET_COUNT=${violations.length}`);
  console.log('[test-mocks] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

main();
