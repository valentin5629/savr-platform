#!/usr/bin/env tsx
/**
 * check-orphan-components — Gate G3 (Lot 0, câblé R20b). MODE RAPPORT.
 * =============================================================================
 * Règle : tout COMPOSANT exporté depuis un barrel `components/dashboards`
 * (index.ts) doit être importé par ≥1 fichier source NON-test (page ou autre
 * composant). Un composant exporté que PLUS AUCUN fichier n'importe = code mort
 * de dashboard (ex : un bloc §11 exporté puis jamais monté sur une page).
 *
 * Motivation R20b : la parité 3 rôles multiplie les blocs §11 partagés. Sans
 * ce gate, on peut exporter un `ProchainesCollectesBloc` du barrel, l'oublier
 * sur une page, et les tests unitaires du composant restent verts alors que la
 * page ne l'affiche pas. Le gate transforme « oubli de montage » en compteur.
 *
 * Extension R-UI-0 (docs/design-system/RATIONALISATION_UI.md §5) : même règle
 * pour les PRIMITIVES `components/ui/*.tsx` (export de valeur PascalCase). Une
 * primitive exportée qu'aucun écran ni composant n'importe (Toast, Sheet,
 * StatCard…) est une recette du Design System que l'app ne suit pas — soit à
 * brancher (lot R-UI-n), soit à retirer. La vitrine `/dev` ne compte pas comme
 * usage.
 *
 * Définition d'orphelin (conservatrice, sans faux positif) :
 *   composant = export de VALEUR en PascalCase (contient une minuscule →
 *   exclut les constantes ALL_CAPS type FLUX_ZD, et les hooks useXxx en
 *   camelCase). Un composant est « utilisé » s'il est importé (par nom) dans
 *   AU MOINS un fichier .ts/.tsx non-test AUTRE que sa propre définition et que
 *   le barrel — page OU composant frère (import relatif `./X.js` inclus). Sinon
 *   = orphelin (exporté mais monté nulle part).
 *
 * Sortie : émet `RATCHET_COUNT=<nb orphelins>` (lu par check-ratchet), écrit un
 * rapport, et sort TOUJOURS 0 (report-only ; l'enforcement passe par le cliquet
 * `docs/audit/gate-baseline.json`).
 *
 * Usage : pnpm check:orphan-components
 * =============================================================================
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BARREL = 'packages/plateforme/src/components/dashboards/index.ts';
const UI_DIR = 'packages/plateforme/src/components/ui';
const SRC_ROOT = 'packages/plateforme/src';
/** Pages de dev (vitrine Design System) : un import depuis là n'est pas un usage. */
const DEV_DIR = 'packages/plateforme/src/app/dev';

/** Un export de valeur PascalCase avec au moins une minuscule = composant. */
function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);
}

/** Parse les composants exportés (valeur) du barrel, hors `export type`. */
function parseBarrelComponents(src: string): string[] {
  const names = new Set<string>();
  // Retire les blocs `export type { ... }` (multi-lignes) pour ne garder que
  // les exports de valeur.
  const valueOnly = src.replace(/export\s+type\s*\{[^}]*\}\s*from[^;]*;/g, '');
  const blockRe = /export\s*\{([^}]*)\}\s*from[^;]*;/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(valueOnly)) !== null) {
    for (const raw of m[1]!.split(',')) {
      // gère `A as B` → on garde l'alias exporté (B)
      const exported = raw.includes(' as ') ? raw.split(' as ')[1]! : raw;
      const name = exported.trim();
      if (name && isComponentName(name)) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * Composants exportés (valeur) d'une primitive `components/ui/x.tsx` :
 * `export { A, B }` (liste locale, sans `from`), `export function A`,
 * `export const A`. Les `export type` sont ignorés.
 */
function parseUiComponents(src: string): string[] {
  const names = new Set<string>();
  const valueOnly = src.replace(/export\s+type\s*\{[^}]*\}\s*;/g, '');
  const listRe = /export\s*\{([^}]*)\}\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = listRe.exec(valueOnly)) !== null) {
    for (const raw of m[1]!.split(',')) {
      const exported = raw.includes(' as ') ? raw.split(' as ')[1]! : raw;
      const name = exported.replace(/^type\s+/, '').trim();
      if (name && isComponentName(name)) names.add(name);
    }
  }
  const declRe =
    /export\s+(?:default\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9]*)/g;
  while ((m = declRe.exec(valueOnly)) !== null) {
    if (isComponentName(m[1]!)) names.add(m[1]!);
  }
  return [...names].sort();
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
}

function isTestFile(path: string): boolean {
  return (
    /\.test\.(ts|tsx)$/.test(path) ||
    path.includes('/tests/') ||
    path.includes('/__tests__/') ||
    path.includes('/tests-report/')
  );
}

/** Base de nom d'un composant tel que défini dans le dossier dashboards. */
function normalizeBasename(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.(ts|tsx)$/, '');
}

function main(): void {
  const barrelSrc = readFileSync(BARREL, 'utf8');
  const components = parseBarrelComponents(barrelSrc);

  // Primitives Design System : nom → fichier(s) de définition.
  const uiDefinitions = new Map<string, Set<string>>();
  for (const entry of readdirSync(UI_DIR)) {
    const full = join(UI_DIR, entry);
    if (!/\.tsx$/.test(entry) || isTestFile(full)) continue;
    for (const name of parseUiComponents(readFileSync(full, 'utf8'))) {
      if (!uiDefinitions.has(name)) uiDefinitions.set(name, new Set());
      uiDefinitions.get(name)!.add(full);
    }
  }

  const allFiles: string[] = [];
  walk(SRC_ROOT, allFiles);
  // Consommateurs = tout fichier source non-test, SAUF le barrel lui-même
  // (il ré-exporte via `export {}`, pas `import`, donc n'apparaît pas ; on
  // l'exclut par sûreté) et SAUF les pages de dev (vitrine). Les composants
  // frères du dossier dashboards SONT inclus : un composant importé seulement
  // par un frère (ex : MultiSelectFilter ← BenchmarkFilterBar via
  // `./MultiSelectFilter.js`) reste « utilisé ».
  const consumerFiles = allFiles.filter(
    (f) =>
      !isTestFile(f) &&
      f !== BARREL &&
      !(f === DEV_DIR || f.startsWith(`${DEV_DIR}/`)),
  );

  // name -> set des fichiers (basename normalisé) qui l'importent par nom,
  // quel que soit le chemin du module (relatif `./X.js`, alias
  // `@/components/dashboards`, ou `@/components/dashboards/X.js`).
  const importers = new Map<string, Set<string>>();
  for (const f of consumerFiles) {
    const src = readFileSync(f, 'utf8');
    const importRe =
      /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]*['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src)) !== null) {
      for (const raw of m[1]!.split(',')) {
        const local = raw.includes(' as ') ? raw.split(' as ')[0]! : raw;
        const name = local.trim();
        if (!name) continue;
        if (!importers.has(name)) importers.set(name, new Set());
        importers.get(name)!.add(f);
      }
    }
  }

  // Orphelin = aucun importeur HORS de son propre fichier de définition.
  const orphans = components.filter((c) => {
    const files = importers.get(c);
    if (!files || files.size === 0) return true;
    for (const f of files) {
      if (normalizeBasename(f) !== c) return false; // importé par un autre fichier → utilisé
    }
    return true; // seul son propre fichier le « référence » → orphelin
  });

  // Primitive orpheline = aucun importeur hors de ses fichiers de définition,
  // ET aucun usage interne (un sous-composant comme TooltipContent, exporté
  // pour la composition mais monté par Tooltip dans le même fichier, est
  // utilisé). Usage interne = le nom apparaît dans le CODE du fichier (hors
  // commentaires, chaînes, déclaration, liste d'export et `X.displayName`).
  const utiliseEnInterne = (name: string, defs: Set<string>): boolean => {
    const re = new RegExp(`\\b${name}\\b`);
    for (const f of defs) {
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/`(?:\\.|[^`\\])*`/g, "''")
        .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''")
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/export\s*\{[^}]*\}\s*;/g, '')
        .split('\n')
        .filter(
          (l) =>
            !/\.displayName\s*=/.test(l) &&
            !new RegExp(`\\b(?:const|let|function|class)\\s+${name}\\b`).test(
              l,
            ),
        )
        .join('\n');
      if (re.test(code)) return true;
    }
    return false;
  };
  const uiOrphans = [...uiDefinitions.entries()]
    .filter(([name, defs]) => {
      const files = importers.get(name);
      if (files) for (const f of files) if (!defs.has(f)) return false;
      return !utiliseEnInterne(name, defs);
    })
    .map(
      ([name, defs]) =>
        `${name} (${[...defs].map(normalizeBasename).join(', ')})`,
    )
    .sort();

  const total = orphans.length + uiOrphans.length;
  const lines: string[] = [
    '## Gate G3 — Composants dashboards + primitives DS orphelins (report-only)',
    '',
    `Barrel : \`${BARREL}\``,
    `Composants exportés (valeur) : ${components.length}`,
    `Primitives \`components/ui\` exportées (valeur) : ${uiDefinitions.size}`,
    `Consommateurs scannés (non-test, hors barrel, hors app/dev) : ${consumerFiles.length}`,
    '',
  ];
  if (orphans.length === 0) {
    lines.push(
      '✅  Aucun composant dashboards orphelin — tous importés par ≥1 fichier non-test.',
    );
  } else {
    lines.push(
      `⚠️  ${orphans.length} composant(s) dashboards orphelin(s) (exportés, importés par aucun fichier non-test) :`,
    );
    for (const o of orphans) lines.push(`- \`${o}\``);
  }
  lines.push('');
  if (uiOrphans.length === 0) {
    lines.push('✅  Aucune primitive Design System orpheline.');
  } else {
    lines.push(
      `⚠️  ${uiOrphans.length} primitive(s) Design System orpheline(s) (exportées de components/ui, importées nulle part dans l'app) :`,
    );
    for (const o of uiOrphans) lines.push(`- \`${o}\``);
  }
  const report = lines.join('\n');
  console.log(report);
  console.log(`\nRATCHET_COUNT=${total}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, {
      flag: 'a',
    });
  }
  // Report-only : jamais bloquant en direct (le cliquet enforce).
  process.exit(0);
}

main();
