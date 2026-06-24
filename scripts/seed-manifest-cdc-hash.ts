#!/usr/bin/env tsx
/**
 * seed-manifest-cdc-hash.ts — bootstrap du `cdc_source_hash` des manifestes (R0c).
 * =============================================================================
 * Pose, dans chaque specs/manifests/M*.json, le champ `cdc_source_hash` = la
 * carte { "<fichier specs/cdc/...md>": "<sha256 au moment du brief>" } pour les
 * fichiers CDC référencés par ses deliverables[].ref_cdc. C'est le chaînon que
 * G10 (complétude) et G11 (drift) exploitent.
 *
 * ⚠ OUTIL DE BOOTSTRAP / RE-BRIEF — PAS un régénérateur automatique. Le
 * cdc_source_hash doit rester FIGÉ à la valeur du dernier brief : si on le
 * ré-alignait à chaque sync, G11 ne détecterait jamais le drift. À ré-exécuter
 * UNIQUEMENT pour un module re-brief é (cf. argument), jamais en masse en CI.
 *
 * Usage :
 *   pnpm tsx scripts/seed-manifest-cdc-hash.ts            # tous (bootstrap initial)
 *   pnpm tsx scripts/seed-manifest-cdc-hash.ts M1.7 M2.4  # modules ciblés (re-brief)
 * =============================================================================
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MANIFESTS_DIR = 'specs/manifests';
const META = '.cdc-metadata.json';
const NON_MANIFEST = new Set(['_schema.json', 'cdc-deliverables.index.json']);

interface Deliverable {
  ref_cdc?: string;
}
interface Manifest {
  module?: string;
  deliverables?: Deliverable[];
  cdc_source_hash?: Record<string, string>;
  [k: string]: unknown;
}

function stripLine(ref: string): string {
  return ref.replace(/:[0-9]+(-[0-9]+)?$/, '');
}

function main(): void {
  if (!existsSync(META)) {
    console.error(
      `❌  ${META} absent — lancer 'pnpm gen:cdc-metadata' d'abord.`,
    );
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(META, 'utf8')) as {
    files: Record<string, { sha256: string }>;
  };

  const filter = process.argv.slice(2); // modules ciblés, ou vide = tous
  const files = readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith('.json') && !NON_MANIFEST.has(f))
    .sort();

  let updated = 0;
  let missingRefs = 0;
  for (const f of files) {
    const full = join(MANIFESTS_DIR, f);
    const manifest = JSON.parse(readFileSync(full, 'utf8')) as Manifest;
    if (filter.length > 0 && !filter.includes(String(manifest.module ?? '')))
      continue;

    const refs = new Set<string>();
    for (const d of manifest.deliverables ?? []) {
      if (d.ref_cdc) refs.add(stripLine(d.ref_cdc));
    }

    const hash: Record<string, string> = {};
    for (const ref of [...refs].sort()) {
      const entry = meta.files[ref];
      if (entry) hash[ref] = entry.sha256;
      else {
        missingRefs++;
        console.warn(
          `  ⚠️  ${manifest.module}: ref_cdc introuvable dans ${META} → ${ref}`,
        );
      }
    }

    manifest.cdc_source_hash = hash;
    writeFileSync(full, `${JSON.stringify(manifest, null, 2)}\n`);
    updated++;
    console.log(
      `  ✓  ${manifest.module} — ${Object.keys(hash).length} fichier(s) CDC ancré(s).`,
    );
  }

  console.log(
    `\n✅  ${updated} manifeste(s) mis à jour · ${missingRefs} ref_cdc introuvable(s).`,
  );
}

main();
