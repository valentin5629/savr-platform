#!/usr/bin/env tsx
/**
 * G1 — check:spec-deliverables (MODE RAPPORT, T0).
 * =============================================================================
 * Ferme la cause racine de l'audit conformité CDC→code : les gates mesuraient
 * code-vs-manifeste, jamais code-vs-CDC. Ce gate diffe les livrables ATOMIQUES
 * énumérés du CDC (specs/manifests/cdc-deliverables.index.json — seedé depuis le
 * backlog d'audit, le 1er diff CDC↔manifeste fait à la main) contre l'UNION des
 * deliverables[] de tous les manifestes (grain livrable, G2).
 *
 * Un livrable de l'index ABSENT de tous les manifestes (et non descopé) = livrable
 * CDC non transcrit → SIGNALÉ. C'est exactement ce qui était invisible.
 *
 * Couverture = PRÉSENCE de l'id dans un deliverables[] (peu importe le statut :
 * un livrable transcrit avec statut 'partial' est VISIBLE, donc couvert au sens
 * G1 ; la justesse d'implémentation relève de G9/oracle + des reviewers). La
 * descope (statut descoped dans l'index, ou deliverable descoped dans un
 * manifeste) sort un id du compteur de violations.
 *
 * MODE RAPPORT : informe, ne bloque jamais (exit 0). Résumé $GITHUB_STEP_SUMMARY
 * + compteur de burn-down. Flip bloquant (T1) : PAR MODULE, dès que son manifeste
 * est re-grainé et à jour (durcissement par cliquet, cf. Lot 0).
 * =============================================================================
 */
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const MANIFESTS_DIR = 'specs/manifests';
const INDEX_PATH = join(MANIFESTS_DIR, 'cdc-deliverables.index.json');
const NON_MANIFEST = new Set(['_schema.json', 'cdc-deliverables.index.json']);

interface IndexEntry {
  id: string;
  severite?: string;
  lot?: string;
  module: string;
  modules?: string[];
  libelle: string;
  ref_cdc: string;
  descoped?: boolean;
  ref_divergence?: string;
}

interface Deliverable {
  id: string;
  statut?: string;
}

function loadManifestDeliverableIds(): {
  ids: Set<string>;
  descopedIds: Set<string>;
} {
  const ids = new Set<string>();
  const descopedIds = new Set<string>();
  const files = readdirSync(MANIFESTS_DIR).filter(
    (f) => f.endsWith('.json') && !NON_MANIFEST.has(f),
  );
  for (const f of files) {
    let m: { deliverables?: Deliverable[] };
    try {
      m = JSON.parse(readFileSync(join(MANIFESTS_DIR, f), 'utf8'));
    } catch {
      continue; // JSON cassé : signalé par check-manifest-grain, pas ici
    }
    for (const d of m.deliverables ?? []) {
      if (!d || typeof d.id !== 'string') continue;
      ids.add(d.id);
      if (d.statut === 'descoped') descopedIds.add(d.id);
    }
  }
  return { ids, descopedIds };
}

function main(): void {
  if (!existsSync(INDEX_PATH)) {
    console.error(`❌  Index introuvable : ${INDEX_PATH}`);
    process.exit(0);
  }
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as {
    deliverables: IndexEntry[];
  };
  const { ids: covered, descopedIds } = loadManifestDeliverableIds();

  // Un livrable CDC est NON COUVERT s'il n'est ni transcrit dans un manifeste
  // (présence d'id) ni descopé (dans l'index OU dans un manifeste).
  const uncovered: IndexEntry[] = [];
  let descopedCount = 0;
  let coveredCount = 0;
  for (const e of index.deliverables) {
    if (e.descoped || descopedIds.has(e.id)) {
      descopedCount++;
      continue;
    }
    if (covered.has(e.id)) {
      coveredCount++;
      continue;
    }
    uncovered.push(e);
  }

  // Regroupement par module pour la lecture (l'affectation 'module' est
  // informative ; la couverture est calculée sur l'union, robuste à l'affectation).
  const byModule = new Map<string, IndexEntry[]>();
  for (const e of uncovered) {
    const k = e.module || '?';
    if (!byModule.has(k)) byModule.set(k, []);
    byModule.get(k)!.push(e);
  }
  const modulesSorted = [...byModule.keys()].sort();

  const lines: string[] = [];
  lines.push('## G1 — check:spec-deliverables (mode rapport)');
  lines.push('');
  lines.push(
    'Diff livrables CDC (index seedé depuis l’audit) ↔ union des `deliverables[]` ' +
      'des manifestes. Un livrable de l’index absent de tous les manifestes (et non ' +
      'descopé) = livrable CDC **non transcrit** → invisible aux gates jusqu’ici.',
  );
  lines.push('');
  lines.push(
    `**Burn-down G1 : ${uncovered.length} livrable(s) CDC non transcrit(s)** ` +
      `· ${coveredCount} transcrit(s) dans un manifeste · ${descopedCount} descopé(s) V1.1/V2 ` +
      `· ${index.deliverables.length} livrable(s) indexés au total.`,
  );
  lines.push('');

  for (const mod of modulesSorted) {
    const entries = byModule.get(mod)!;
    lines.push(`### ${mod} — ${entries.length} non transcrit(s)`);
    for (const e of entries) {
      const lot = e.lot ? ` _(lot ${e.lot})_` : '';
      lines.push(
        `- \`${e.id}\`${lot} — ${e.libelle}  ·  réf CDC : \`${e.ref_cdc}\``,
      );
    }
    lines.push('');
  }

  lines.push(
    '> Mode RAPPORT — informatif, non bloquant. Flip bloquant (T1) PAR MODULE dès ' +
      'que son manifeste est re-grainé et à jour (durcissement par cliquet).',
  );

  const report = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }
  console.log(report);
  console.log('');
  console.log(
    `[spec-deliverables] Burn-down : ${uncovered.length} non transcrit(s) · ` +
      `${coveredCount} transcrit(s) · ${descopedCount} descopé(s) / ${index.deliverables.length} indexés.`,
  );
  console.log('[spec-deliverables] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

main();
