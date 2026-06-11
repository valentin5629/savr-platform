#!/usr/bin/env node
/**
 * scripts/check-coverage.ts
 * Vérifie que tous les scénarios listés dans specs/manifests/<MODULE>.json
 * ont un test vitest correspondant (par titre exact).
 *
 * Usage : pnpm check:coverage M0.3
 *         pnpm check:coverage          (vérifie tous les manifests)
 *
 * Format manifest (specs/manifests/M0.3.json) :
 * { "module": "M0.3", "scenarios": ["SMOKE-1 ...", "SMOKE-2 ..."] }
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const MANIFESTS_DIR = 'specs/manifests';
const arg = process.argv[2];

function loadManifests(): string[] {
  if (!existsSync(MANIFESTS_DIR)) {
    console.error(`❌  ${MANIFESTS_DIR} introuvable`);
    process.exit(1);
  }
  if (arg) {
    const f = join(MANIFESTS_DIR, `${arg}.json`);
    if (!existsSync(f)) {
      console.error(`❌  Manifest absent : ${f}`);
      process.exit(1);
    }
    return [f];
  }
  return readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(MANIFESTS_DIR, f));
}

function getVitestTitles(): Set<string> {
  try {
    const out = execSync('vitest run --reporter=json 2>/dev/null || true', {
      encoding: 'utf8',
    });
    const json = JSON.parse(out.slice(out.indexOf('{')));
    const titles = new Set<string>();
    for (const suite of json.testResults ?? []) {
      for (const t of suite.assertionResults ?? []) {
        titles.add(t.fullName ?? t.title);
      }
    }
    return titles;
  } catch {
    return new Set();
  }
}

const files = loadManifests();
const vitestTitles = getVitestTitles();

let missing = 0;
for (const f of files) {
  const manifest = JSON.parse(readFileSync(f, 'utf8')) as {
    module: string;
    scenarios: string[];
  };
  console.log(`\n📋  ${manifest.module} (${f})`);
  for (const scenario of manifest.scenarios) {
    const found = [...vitestTitles].some((t) => t.includes(scenario));
    if (found) {
      console.log(`  ✅  ${scenario}`);
    } else {
      console.log(`  ❌  MANQUANT : ${scenario}`);
      missing++;
    }
  }
}

if (missing > 0) {
  console.error(
    `\n⛔  ${missing} scénario(s) sans test — ajoutez-les dans vitest.`,
  );
  process.exit(1);
} else {
  console.log('\n✅  Couverture complète.');
}
