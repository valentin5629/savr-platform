#!/usr/bin/env tsx
/**
 * G10 — check:manifest-completeness (Lot 0 / R0c, MODE RAPPORT, T0).
 * =============================================================================
 * Ferme L2 : « index incomplet ». G1 (check:spec-deliverables) peut être vert
 * même si l'index `cdc-deliverables.index.json` rate un livrable — parce qu'il
 * diffe l'index ↔ manifestes, pas le CDC ↔ manifestes. G10 fait la complétude
 * INVERSE : chaque module attendu du CDC (roadmap V1) doit avoir un manifeste,
 * et chaque manifeste doit porter un `cdc_source_hash` non vide (chaînon G11).
 *
 * Signale :
 *   1. les modules attendus SANS manifeste (livrable d'un module non transcrit
 *      = invisible à tous les gates aval) ;
 *   2. les manifestes sans `cdc_source_hash` (ou vide) = chaînon G11 absent ;
 *   3. (info) les modules référencés par l'index mais sans manifeste primaire.
 *
 * MODE RAPPORT : exit 0 toujours, résumé $GITHUB_STEP_SUMMARY + compteur.
 * =============================================================================
 */
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const MANIFESTS_DIR = 'specs/manifests';
const INDEX = join(MANIFESTS_DIR, 'cdc-deliverables.index.json');
const NON_MANIFEST = new Set([
  '_schema.json',
  'cdc-deliverables.index.json',
  'README.md',
]);

// Univers canonique des modules V1 — source de vérité : `09 - Roadmap exécution/`
// (transcrit ici car la roadmap n'est pas dans specs/). À MAINTENIR en phase avec
// la roadmap : tout module qui devient livrable V1 doit y figurer.
const EXPECTED_MODULES: string[] = [
  'M0.0',
  'M0.1',
  'M0.2',
  'M0.3',
  'M0.4',
  'M0.5',
  'M0.6',
  'M0.7',
  'M0.8',
  'M0.9',
  'M0.10',
  'M0.11',
  'M1.1a',
  'M1.1b',
  'M1.2',
  'M1.3',
  'M1.4',
  'M1.5a',
  'M1.5b',
  'M1.6',
  'M1.7',
  'M1.8',
  'M2.1',
  'M2.2',
  'M2.3',
  'M2.4',
  'M2.5',
  'M3.1',
  'M3.2',
  'M3.3',
  'M3.4',
  'M3.5',
  'M3.6',
  'M4.1',
  'M4.2',
  'M4.3',
];

function emit(lines: string[]): void {
  const report = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  console.log(report);
}

function main(): void {
  const present = new Set(
    readdirSync(MANIFESTS_DIR)
      .filter((f) => f.endsWith('.json') && !NON_MANIFEST.has(f))
      .map((f) => f.replace(/\.json$/, '')),
  );

  // 1. Modules attendus sans manifeste.
  const missingManifest = EXPECTED_MODULES.filter((m) => !present.has(m));

  // 2. Manifestes sans cdc_source_hash (ou vide).
  const noHash: string[] = [];
  for (const m of [...present].sort()) {
    const manifest = JSON.parse(
      readFileSync(join(MANIFESTS_DIR, `${m}.json`), 'utf8'),
    ) as {
      cdc_source_hash?: Record<string, string>;
    };
    const h = manifest.cdc_source_hash;
    if (!h || typeof h !== 'object' || Object.keys(h).length === 0)
      noHash.push(m);
  }

  // 3. Modules de l'index sans manifeste primaire (info).
  const indexModules = new Set<string>();
  if (existsSync(INDEX)) {
    const idx = JSON.parse(readFileSync(INDEX, 'utf8')) as {
      deliverables?: { module?: string; modules?: string[] }[];
    };
    for (const d of idx.deliverables ?? []) {
      if (d.module) indexModules.add(d.module);
      for (const mm of d.modules ?? []) indexModules.add(mm);
    }
  }
  const indexWithoutManifest = [...indexModules]
    .filter((m) => !present.has(m))
    .sort();

  const lines: string[] = [
    '## G10 — Complétude des manifestes (mode rapport)',
    '',
  ];
  lines.push(
    'Complétude INVERSE (CDC ⇒ manifeste), complément de G1 (index ⇒ manifeste). ' +
      'Un module attendu sans manifeste = ses livrables sont invisibles à tous les gates aval.',
    '',
    `**Burn-down : ${missingManifest.length} module(s) attendu(s) sans manifeste · ` +
      `${noHash.length} manifeste(s) sans cdc_source_hash** ` +
      `(univers attendu : ${EXPECTED_MODULES.length} · présents : ${present.size}).`,
    '',
  );

  lines.push('### ⛔ Modules attendus (roadmap V1) SANS manifeste');
  lines.push(
    missingManifest.length === 0
      ? '_Aucun._'
      : missingManifest.map((m) => `- \`${m}\``).join('\n'),
  );
  lines.push('');

  lines.push('### ⛔ Manifestes sans `cdc_source_hash` (chaînon G11 absent)');
  lines.push(
    noHash.length === 0
      ? '_Aucun._'
      : noHash.map((m) => `- \`${m}\``).join('\n'),
  );
  lines.push('');

  lines.push('### ℹ️ Modules cités par l’index sans manifeste primaire (info)');
  lines.push(
    indexWithoutManifest.length === 0
      ? '_Aucun._'
      : indexWithoutManifest.map((m) => `- \`${m}\``).join('\n'),
  );
  lines.push('');
  lines.push(
    '> Mode RAPPORT — informatif, non bloquant. Flip bloquant (T1) quand chaque ' +
      'module roadmap a un manifeste avec cdc_source_hash.',
  );

  emit(lines);
  console.log(
    `[manifest-completeness] Burn-down : ${missingManifest.length} module(s) sans manifeste · ` +
      `${noHash.length} sans cdc_source_hash.`,
  );
  console.log(`RATCHET_COUNT=${missingManifest.length + noHash.length}`); // C1
  console.log('[manifest-completeness] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

main();
