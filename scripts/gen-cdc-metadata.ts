#!/usr/bin/env tsx
/**
 * gen-cdc-metadata.ts — produit `.cdc-metadata.json` (Lot 0 / R0c).
 * =============================================================================
 * Chaînon CDC↔manifeste manquant (cf. brief R0c, décision Val 2026-06-24 = option
 * repo-local). Hash sha256 de chaque fichier Markdown sous `specs/cdc/` → `.cdc-metadata.json`.
 * Fichier DÉRIVÉ et RÉGÉNÉRABLE (appelé par sync-specs.sh après chaque sync du
 * Vault). Sert de référence à :
 *   - G10 (check-manifest-completeness) : chaque module CDC a-t-il un manifeste ?
 *   - G11 (check-cdc-drift) : un specs/cdc/** modifié ⇒ cdc_source_hash périmé ?
 *
 * `.cdc-metadata.json` est généré depuis `specs/cdc/` (et NON `_DEV-FACING/` du
 * Vault) : c'est ce miroir qui est disponible en CI. specs/cdc est lui-même
 * synchronisé depuis _DEV-FACING par sync-specs.sh → équivalent, repo-local.
 * =============================================================================
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const CDC_DIR = 'specs/cdc';
const OUT = '.cdc-metadata.json';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function main(): void {
  if (!existsSync(CDC_DIR)) {
    console.error(`❌  ${CDC_DIR} introuvable — lancer sync-specs.sh d'abord.`);
    process.exit(1);
  }
  const files = walk(CDC_DIR).sort();
  const meta: Record<string, { sha256: string; bytes: number }> = {};
  for (const f of files) {
    const buf = readFileSync(f);
    meta[f] = {
      sha256: createHash('sha256').update(buf).digest('hex'),
      bytes: statSync(f).size,
    };
  }

  const payload = {
    _note:
      'DÉRIVÉ/régénérable (scripts/gen-cdc-metadata.ts, appelé par sync-specs.sh). ' +
      'Hash sha256 par fichier specs/cdc/**/*.md. Référence de G10 (complétude) et G11 (drift). Ne pas éditer à la main.',
    generated_from: CDC_DIR,
    nb_fichiers: files.length,
    files: meta,
  };

  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`✅  ${OUT} généré — ${files.length} fichier(s) CDC hashé(s).`);
}

main();
