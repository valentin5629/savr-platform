#!/usr/bin/env tsx
/**
 * check-ratchet — méta-cliquet anti-régression (Lot 0 / R0d). BLOQUANT.
 * =============================================================================
 * Problème fermé : les gates G1/G2/G7/G10/G11 sont en MODE RAPPORT
 * (continue-on-error) → ils OBSERVENT les ~118 écarts sans rien EMPÊCHER, et
 * rien ne force le passage T0→T1. Un lot de remédiation peut donc réintroduire
 * une divergence sans qu aucun job ne rougisse.
 *
 * Mécanique du cliquet : chaque gate léger émet `RATCHET_COUNT=<n>` (son compteur
 * de violations). Ce script relance les gates, lit leur compteur, et le compare à
 * la baseline versionnée `docs/audit/gate-baseline.json`. Règle = **les compteurs
 * ne peuvent que DESCENDRE** :
 *   - compteur > baseline  → RÉGRESSION → exit 1 (le build rougit).
 *   - compteur < baseline  → amélioration → rappel de baisser la baseline (--update).
 *   - compteur = baseline  → OK.
 *
 * Ainsi les détecteurs « rapport » deviennent réellement protecteurs SANS être
 * flippés un par un : le backlog existant est toléré (baseline), toute NOUVELLE
 * divergence bloque, et chaque lot qui corrige fait baisser la baseline (T0→T1
 * automatique par cliquet).
 *
 * Usage :
 *   pnpm check:ratchet            # vérifie (CI bloquant) — exit 1 si régression
 *   pnpm check:ratchet --update   # re-seed la baseline aux compteurs courants
 *                                 # (à faire dans le lot qui a fait baisser un gate)
 * =============================================================================
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASELINE = 'docs/audit/gate-baseline.json';

// Gates LÉGERS (exécutables sans base de données vivante : snapshot db.types
// committé pour column-db). Les gates DB (G6/G9/integration) ratchetteront à part.
const GATES: { key: string; cmd: string[] }[] = [
  { key: 'manifest-grain', cmd: ['check:manifest-grain'] },
  { key: 'spec-deliverables', cmd: ['check:spec-deliverables'] },
  { key: 'manifest-completeness', cmd: ['check:manifest-completeness'] },
  { key: 'cdc-drift', cmd: ['check:cdc-drift'] },
  { key: 'column-db', cmd: ['check:column-db'] },
  { key: 'test-mocks', cmd: ['check:test-mocks'] }, // G5 (durci R9, cluster C7)
  { key: 'orphan-components', cmd: ['check:orphan-components'] }, // G3 (câblé R20b)
];

function runGate(cmd: string[]): number | null {
  const res = spawnSync('pnpm', ['-s', ...cmd], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const matches = [...out.matchAll(/RATCHET_COUNT=(\d+)/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1]![1]); // dernière occurrence
}

function main(): void {
  const update = process.argv.includes('--update');
  const baseline: Record<string, number> = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8'))
    : {};

  const current: Record<string, number> = {};
  const regressions: string[] = [];
  const improvements: string[] = [];
  const errors: string[] = [];

  for (const g of GATES) {
    const n = runGate(g.cmd);
    if (n === null) {
      errors.push(`${g.key} : RATCHET_COUNT introuvable (gate en échec ?)`);
      continue;
    }
    current[g.key] = n;
    const base = baseline[g.key];
    if (base === undefined) {
      improvements.push(`${g.key} : ${n} (absent de la baseline — à figer)`);
    } else if (n > base) {
      regressions.push(
        `${g.key} : ${n} > baseline ${base} (RÉGRESSION : +${n - base})`,
      );
    } else if (n < base) {
      improvements.push(
        `${g.key} : ${n} < baseline ${base} (amélioration : -${base - n})`,
      );
    }
  }

  if (update) {
    // Ne JAMAIS figer une baseline partielle : si un gate n'a pas émis son
    // compteur, on refuse l'écriture (sinon le gate manquant repasse "absent"
    // à la prochaine exécution = trou silencieux).
    if (errors.length > 0) {
      console.error('⛔  --update refusé — gate(s) illisible(s) :');
      for (const e of errors) console.error(`   - ${e}`);
      process.exit(1);
    }
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`✅  Baseline re-figée : ${BASELINE}`);
    console.log(JSON.stringify(current, null, 2));
    process.exit(0);
  }

  const summary: string[] = ['## Méta-cliquet (gate-ratchet) — BLOQUANT', ''];
  summary.push(
    'Compteurs de violations vs baseline (ne peuvent que descendre) :',
  );
  for (const g of GATES) {
    const n = current[g.key];
    const b = baseline[g.key];
    summary.push(`- \`${g.key}\` : ${n ?? '?'} (baseline ${b ?? '—'})`);
  }
  if (regressions.length) {
    summary.push('', '### ⛔ Régressions');
    for (const r of regressions) summary.push(`- ${r}`);
  }
  if (improvements.length) {
    summary.push(
      '',
      '### ✅ Améliorations (baisser la baseline : `pnpm check:ratchet --update`)',
    );
    for (const i of improvements) summary.push(`- ${i}`);
  }
  if (errors.length) {
    summary.push('', '### ⚠️ Gates illisibles');
    for (const e of errors) summary.push(`- ${e}`);
  }
  const report = summary.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, {
      flag: 'a',
    });
  console.log(report);

  if (errors.length > 0) {
    console.error(
      '\n⛔  Au moins un gate n a pas émis RATCHET_COUNT — cliquet non vérifiable.',
    );
    process.exit(1);
  }
  if (regressions.length > 0) {
    console.error(
      `\n⛔  ${regressions.length} régression(s) — un compteur de gate a AUGMENTÉ. ` +
        'Corrige la divergence introduite, ou (si volontaire et tracé) ajuste la baseline avec justification.',
    );
    process.exit(1);
  }
  console.log('\n✅  Cliquet OK — aucun compteur au-dessus de sa baseline.');
  process.exit(0);
}

main();
