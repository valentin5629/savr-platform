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
// Fichiers du dossier qui NE SONT PAS des manifestes de module (ajoutés en R0b :
// JSON Schema + index des livrables CDC) — sans scenarios[], à ignorer ici.
const NON_MANIFEST = new Set(['_schema.json', 'cdc-deliverables.index.json']);

function loadManifests(): string[] {
  if (!existsSync(MANIFESTS_DIR)) {
    console.error(`❌  ${MANIFESTS_DIR} introuvable`);
    process.exit(1);
  }
  if (arg) {
    const f = join(MANIFESTS_DIR, `${arg}.json`);
    if (!existsSync(f)) {
      console.error(`❌  Manifest absent : ${f}`);
      console.error(
        `    Le module ${arg} n'a pas de manifeste. CRÉE le manifeste au grain LIVRABLE ` +
          `(deliverables[], cf. specs/manifests/_schema.json) AVANT de coder — ` +
          `ne PAS lancer le lot sans manifeste (R0d, finding #6).`,
      );
      process.exit(1);
    }
    return [f];
  }
  return readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith('.json') && !NON_MANIFEST.has(f))
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

// Mode STRICT (R0d) : actif uniquement quand un module précis est demandé
// (l'usage /goal d'un lot). Vérifie alors AUSSI les deliverables[] — c'est ce qui
// ferme la cause racine : /goal ne regardait que scenarios[], jamais deliverables[].
// Le mode tous-manifestes (sans arg) garde le comportement scénario-seul (sanity).
const strict = Boolean(arg);

const files = loadManifests();
const vitestTitles = getVitestTitles();

type Scenario = string | { id?: string; title?: string; description?: string };
interface Deliverable {
  id?: string;
  statut?: string;
  test?: string | null;
  libelle?: string;
}

function scenarioTitle(s: Scenario): string {
  if (typeof s === 'string') return s;
  return s.title ?? s.description ?? s.id ?? '';
}

let missing = 0;
let deliverableIssues = 0;
for (const f of files) {
  const manifest = JSON.parse(readFileSync(f, 'utf8')) as {
    module: string;
    scenarios?: Scenario[];
    deliverables?: Deliverable[];
  };
  const scenarios = manifest.scenarios ?? [];
  const deliverables = manifest.deliverables ?? [];
  console.log(`\n📋  ${manifest.module} (${f})`);

  // Scénarios → titres vitest (comportement historique conservé).
  for (const sc of scenarios) {
    const title = scenarioTitle(sc);
    if (!title) continue;
    const found = [...vitestTitles].some((t) => t.includes(title));
    if (found) console.log(`  ✅  ${title}`);
    else {
      console.log(`  ❌  MANQUANT : ${title}`);
      missing++;
    }
  }

  if (!strict) continue;

  // ── Mode lot (arg) : vérifie les deliverables[] ──
  // Vacuité : un module demandé explicitement sans AUCUNE couverture = échec
  // (sinon /goal vert à vide — findings #6/#7).
  if (scenarios.length === 0 && deliverables.length === 0) {
    console.log(
      `  ⛔  ${manifest.module} n'a NI scenarios[] NI deliverables[] — couverture vide interdite pour un module demandé.`,
    );
    deliverableIssues++;
    continue;
  }

  // Tout deliverable 'implemented' DOIT nommer sa preuve (test non-null). On
  // tolère les preuves pgTAP/SQL (présence du champ suffit, pas de matching
  // fragile sur les titres vitest) : ce qui est interdit, c'est un livrable
  // déclaré réalisé sans aucune preuve nommée — le 3e temps escamoté.
  for (const d of deliverables) {
    if (d.statut === 'implemented') {
      const t = (d.test ?? '').toString().trim();
      if (t === '') {
        console.log(
          `  ⛔  deliverable « ${d.id ?? d.libelle ?? '?'} » statut=implemented SANS test — nomme sa preuve (3e temps).`,
        );
        deliverableIssues++;
      } else {
        console.log(`  ✅  livrable ${d.id} → ${t}`);
      }
    }
  }
}

if (missing > 0 || deliverableIssues > 0) {
  console.error(
    `\n⛔  ${missing} scénario(s) sans test + ${deliverableIssues} problème(s) de livrable — /goal NON satisfait.`,
  );
  process.exit(1);
} else {
  console.log('\n✅  Couverture complète (scénarios + livrables).');
}
