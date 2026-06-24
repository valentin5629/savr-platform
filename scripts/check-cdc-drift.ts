#!/usr/bin/env tsx
/**
 * G11 — check:cdc-drift (Lot 0 / R0c, MODE RAPPORT, T0).
 * =============================================================================
 * Ferme L3 : « drift CDC » — le CDC est patché mais le manifeste/les tests
 * restent figés sur l'ancienne version. Compare le `cdc_source_hash` FIGÉ de
 * chaque manifeste (posé au brief) au hash COURANT de `.cdc-metadata.json`
 * (régénéré par sync-specs.sh). Un fichier specs/cdc dont le hash a changé sans
 * réalignement du manifeste = manifeste PÉRIMÉ → « relancer le brief du module ».
 *
 * Scope : si on est dans une PR (git diff vs origin/main disponible), on annote
 * les drifts portant sur des fichiers réellement modifiés dans la PR ; sinon on
 * rapporte tous les écarts hash figé ≠ hash courant.
 *
 * MODE RAPPORT (T0) : exit 0 toujours (cf. variable WARN_ONLY). Le hook
 * pré-commit l'appelle aussi en avertissement. Flip bloquant (T1) = exit 2 +
 * allowlist (cf. pattern gate-pr.sh).
 * =============================================================================
 */
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const MANIFESTS_DIR = 'specs/manifests';
const META = '.cdc-metadata.json';
const NON_MANIFEST = new Set([
  '_schema.json',
  'cdc-deliverables.index.json',
  'README.md',
]);

interface Drift {
  module: string;
  file: string;
  recorded: string;
  current: string | null;
  inPr: boolean;
}

function changedCdcFilesInPr(): Set<string> | null {
  // Best-effort : nécessite l'historique (fetch-depth: 0 en CI).
  const res = spawnSync(
    'git',
    ['diff', '--name-only', 'origin/main...HEAD', '--', 'specs/cdc/'],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) return null;
  const set = new Set<string>();
  for (const l of (res.stdout ?? '').split('\n'))
    if (l.trim()) set.add(l.trim());
  return set;
}

function emit(lines: string[]): void {
  const report = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  console.log(report);
}

function main(): void {
  if (!existsSync(META)) {
    emit([
      '## G11 — Drift CDC (mode rapport)',
      '',
      `⚠️ \`${META}\` absent — lancer \`pnpm gen:cdc-metadata\`. Non bloquant.`,
    ]);
    process.exit(0);
  }
  const meta = JSON.parse(readFileSync(META, 'utf8')) as {
    files: Record<string, { sha256: string }>;
  };
  const prFiles = changedCdcFilesInPr();

  const drifts: Drift[] = [];
  for (const f of readdirSync(MANIFESTS_DIR).filter(
    (x) => x.endsWith('.json') && !NON_MANIFEST.has(x),
  )) {
    const manifest = JSON.parse(
      readFileSync(join(MANIFESTS_DIR, f), 'utf8'),
    ) as {
      module?: string;
      cdc_source_hash?: Record<string, string>;
    };
    const module = String(manifest.module ?? f);
    for (const [file, recorded] of Object.entries(
      manifest.cdc_source_hash ?? {},
    )) {
      const current = meta.files[file]?.sha256 ?? null;
      if (current !== recorded) {
        drifts.push({
          module,
          file,
          recorded,
          current,
          inPr: prFiles ? prFiles.has(file) : false,
        });
      }
    }
  }

  // Si on a le contexte PR, le burn-down de tête = les drifts touchés par la PR.
  const headline = prFiles ? drifts.filter((d) => d.inPr) : drifts;

  const lines: string[] = ['## G11 — Drift CDC ↔ manifeste (mode rapport)', ''];
  lines.push(
    'Compare le `cdc_source_hash` figé (au brief) au hash courant `.cdc-metadata.json`. ' +
      'Un écart = le CDC a bougé sans réalignement du manifeste → **relancer le brief du module** ' +
      '(`pnpm tsx scripts/seed-manifest-cdc-hash.ts <module>` après re-transcription).',
    '',
    prFiles
      ? `**Burn-down (drift sur fichiers modifiés dans la PR) : ${headline.length}** · ${drifts.length} écart(s) total.`
      : `**Burn-down (hors contexte PR) : ${drifts.length} écart(s) hash figé ≠ courant.**`,
    '',
  );

  if (drifts.length === 0) {
    lines.push('_Aucun drift — tous les cdc_source_hash sont alignés._');
  } else {
    lines.push('### ⚠️ Manifestes périmés (CDC modifié, hash non réaligné)');
    for (const d of drifts.slice(0, 80)) {
      const tag = d.inPr ? ' **(modifié dans cette PR)**' : '';
      const cur = d.current ? `${d.current.slice(0, 10)}…` : '(fichier absent)';
      lines.push(
        `- \`${d.module}\` ← \`${d.file}\` : figé ${d.recorded.slice(0, 10)}… ≠ courant ${cur}${tag}`,
      );
    }
    if (drifts.length > 80) lines.push(`- … +${drifts.length - 80} autre(s)`);
  }
  lines.push('');
  lines.push(
    '> Mode RAPPORT — informatif, non bloquant (exit 0). Flip bloquant (T1) = exit 2 + allowlist.',
  );

  emit(lines);
  console.log(
    `[cdc-drift] ${headline.length} drift(s)${prFiles ? ' (PR)' : ''} · ${drifts.length} total — MODE RAPPORT (exit 0).`,
  );
  process.exit(0);
}

main();
