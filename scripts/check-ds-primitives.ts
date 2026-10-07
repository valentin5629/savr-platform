#!/usr/bin/env tsx
/**
 * check-ds-primitives — Gate UI « primitive HTML brute au lieu du composant
 * Design System » (R-UI-0, §5 de docs/design-system/RATIONALISATION_UI.md (PR #462)).
 * MODE RAPPORT, enforcement via le méta-cliquet `check:ratchet`.
 * =============================================================================
 * Dans le code applicatif (`app/`, `components/` hors `components/ui/`), un
 * bouton, une liste déroulante, une case à cocher, un tableau, une confirmation
 * ou une modale passent par la primitive `components/ui` correspondante
 * (Button/IconButton, Combobox, Checkbox, DataTable/DataGrid, ConfirmDialog,
 * Modal). Un nombre affiché passe par `lib/format` (jamais `toFixed()` : point
 * décimal anglais).
 *
 * Compte, hors tests et hors vitrine `/dev` :
 *   `<button`, `<select`, `<label`, `<input … type="checkbox"`, `<table`,
 *   `confirm(` / `window.confirm(`, `fixed inset-0` (overlay maison),
 *   `.toFixed(` (hors graphes Cockpit : coordonnées SVG, pas du texte affiché).
 *
 * Sortie : rapport par motif, `RATCHET_COUNT=<n>`, exit 0 toujours. Baseline :
 * docs/audit/gate-baseline.json (clé `ds-primitives`).
 *
 * Usage : pnpm check:ds-primitives
 * =============================================================================
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = [
  'packages/plateforme/src/app',
  'packages/plateforme/src/components',
];
const EXCLUDE_DIRS = [
  'packages/plateforme/src/components/ui',
  'packages/plateforme/src/app/dev',
];

const MOTIFS: {
  key: string;
  libelle: string;
  re: RegExp;
  /** Dossiers exemptés pour ce seul motif. */
  sauf?: string[];
}[] = [
  {
    key: 'button',
    libelle: '`<button` brut (→ Button / IconButton)',
    re: /<button\b/g,
  },
  { key: 'select', libelle: '`<select` brut (→ Combobox)', re: /<select\b/g },
  {
    key: 'label',
    libelle: '`<label` brut (→ FormField / Label)',
    re: /<label\b/g,
  },
  {
    key: 'checkbox',
    libelle: '`<input type="checkbox">` brut (→ Checkbox)',
    re: /<input\b[^>]*type=["']checkbox["']/g,
  },
  {
    key: 'table',
    libelle: '`<table` brut (→ DataTable / DataGrid)',
    re: /<table\b/g,
  },
  {
    key: 'confirm',
    libelle: '`confirm()` natif (→ ConfirmDialog)',
    re: /(?:window\.|(?<![\w.]))confirm\(/g,
  },
  {
    key: 'overlay',
    libelle: '`fixed inset-0` : modale/overlay maison (→ Modal / Sheet)',
    re: /fixed inset-0/g,
  },
  {
    key: 'toFixed',
    libelle: '`.toFixed(` : nombre affiché en notation anglaise (→ lib/format)',
    re: /\.toFixed\(/g,
    // Graphes Cockpit = coordonnées SVG ; routes API = arrondi numérique, pas
    // du texte affiché.
    sauf: [
      'packages/plateforme/src/components/dashboards/charts/cockpit',
      'packages/plateforme/src/app/api',
    ],
  },
];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (EXCLUDE_DIRS.some((d) => full === d || full.startsWith(`${d}/`)))
      continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !isTestFile(full)) {
      out.push(full);
    }
  }
}

function isTestFile(path: string): boolean {
  return (
    /\.(test|spec)\.(ts|tsx)$/.test(path) ||
    path.includes('/__tests__/') ||
    path.includes('/test-utils/')
  );
}

function sansCommentaires(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

function main(): void {
  const files: string[] = [];
  for (const r of ROOTS) walk(r, files);

  let total = 0;
  const lines: string[] = [
    '## Gate UI — primitives HTML brutes hors Design System (report-only, cliqueté)',
    '',
    `Fichiers scannés (app + components hors ui/, hors tests) : ${files.length}`,
    '',
  ];
  for (const m of MOTIFS) {
    const touches: string[] = [];
    let n = 0;
    for (const f of files) {
      if (m.sauf?.some((d) => f === d || f.startsWith(`${d}/`))) continue;
      const k = [...sansCommentaires(readFileSync(f, 'utf8')).matchAll(m.re)]
        .length;
      if (k > 0) {
        n += k;
        touches.push(`${relative('.', f)} (${k})`);
      }
    }
    total += n;
    lines.push(`- \`${m.key}\` — ${m.libelle} : **${n}**`);
    for (const t of touches.slice(0, 8)) lines.push(`    - ${t}`);
    if (touches.length > 8)
      lines.push(`    - … ${touches.length - 8} autre(s)`);
  }
  lines.push('', `**Total : ${total} occurrence(s).**`);
  const report = lines.join('\n');
  console.log(report);
  console.log(`\nRATCHET_COUNT=${total}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, {
      flag: 'a',
    });
  process.exit(0);
}

main();
