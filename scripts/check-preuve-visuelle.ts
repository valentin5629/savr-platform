#!/usr/bin/env tsx
/**
 * preuve-visuelle — catalogue des livrables non-testables-auto (Lot 0 / R0c, L5).
 * =============================================================================
 * Ferme (partiellement, discipline humaine) L5 : « jugement humain — livrables
 * UI non vérifiables par script ». Aucun script ne « voit » un badge, un PDF, un
 * e-mail rendu ou un token de Design System. Ce reporter PROJETTE le catalogue
 * des livrables `statut='à-vérifier'` des manifestes (= ceux qui exigent une
 * preuve screenshot/Loom en PR, cf. DEFINITION_OF_DONE.md § UI) et vérifie le
 * backstop go-live (présence de docs/audit/AUDIT_SCOPE.json).
 *
 * Couplé au reviewer `reviewer-conformite-spec` (scindé GO-FUNC / GO-VISUAL) :
 * le reviewer statue ces items « À VÉRIFIER MANUELLEMENT » tant que la preuve
 * n'est pas jointe. Ce script ne fait que rendre le catalogue NON-CONTOURNABLE
 * (liste visible, comptée).
 *
 * MODE RAPPORT : exit 0 toujours, résumé $GITHUB_STEP_SUMMARY + compteur.
 * =============================================================================
 */
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const MANIFESTS_DIR = 'specs/manifests';
const NON_MANIFEST = new Set([
  '_schema.json',
  'cdc-deliverables.index.json',
  'README.md',
]);
const AUDIT_SCOPE = 'docs/audit/AUDIT_SCOPE.json';
const AUDIT_WORKFLOW = '.claude/workflows/cdc-conformity-audit.mjs';

interface Item {
  module: string;
  id: string;
  libelle: string;
  ref_cdc: string;
}

function emit(lines: string[]): void {
  const report = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  console.log(report);
}

function main(): void {
  const items: Item[] = [];
  for (const f of readdirSync(MANIFESTS_DIR).filter(
    (x) => x.endsWith('.json') && !NON_MANIFEST.has(x),
  )) {
    const manifest = JSON.parse(
      readFileSync(join(MANIFESTS_DIR, f), 'utf8'),
    ) as {
      module?: string;
      deliverables?: {
        id?: string;
        libelle?: string;
        ref_cdc?: string;
        statut?: string;
      }[];
    };
    const module = String(manifest.module ?? f);
    for (const d of manifest.deliverables ?? []) {
      if (d.statut === 'à-vérifier') {
        items.push({
          module,
          id: String(d.id ?? '?'),
          libelle: String(d.libelle ?? ''),
          ref_cdc: String(d.ref_cdc ?? ''),
        });
      }
    }
  }
  items.sort(
    (a, b) => a.module.localeCompare(b.module) || a.id.localeCompare(b.id),
  );

  const scopeOk = existsSync(AUDIT_SCOPE);
  const wfOk = existsSync(AUDIT_WORKFLOW);

  const lines: string[] = [
    '## Preuve-visuelle — catalogue des livrables présentationnels (mode rapport)',
    '',
  ];
  lines.push(
    'Livrables `statut=« à-vérifier »` des manifestes = non testables-auto → ' +
      '**preuve screenshot/Loom < 10 s exigée en PR** (DEFINITION_OF_DONE.md § UI, discipline GO-VISUAL). ' +
      'Le reviewer conformité-spec les statue « À VÉRIFIER MANUELLEMENT » jusqu’à preuve jointe.',
    '',
    `**${items.length} livrable(s) présentationnel(s) à prouver visuellement.**`,
    '',
  );

  lines.push('### Catalogue (preuve visuelle requise)');
  if (items.length === 0) lines.push('_Aucun livrable à-vérifier déclaré._');
  else
    for (const i of items)
      lines.push(
        `- \`${i.module}\` · ${i.id} — ${i.libelle}${i.ref_cdc ? ` (${i.ref_cdc})` : ''}`,
      );
  lines.push('');

  lines.push('### Backstop go-live (audit code-vs-CDC indépendant)');
  lines.push(
    `- ${scopeOk ? '✅' : '⛔'} \`${AUDIT_SCOPE}\` ${scopeOk ? 'présent' : 'ABSENT'} (périmètre de l’audit de sortie)`,
  );
  lines.push(
    `- ${wfOk ? '✅' : '⛔'} \`${AUDIT_WORKFLOW}\` ${wfOk ? 'présent' : 'ABSENT'} — à re-lancer en gate de go-live (0 nouveau gap critique).`,
  );
  lines.push('');
  lines.push(
    '> Mode RAPPORT — informatif. La preuve visuelle reste une discipline PR (humaine), non automatisable.',
  );

  emit(lines);
  console.log(
    `[preuve-visuelle] ${items.length} livrable(s) à prouver · backstop AUDIT_SCOPE ${scopeOk ? 'OK' : 'ABSENT'}.`,
  );
  console.log('[preuve-visuelle] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

main();
