#!/usr/bin/env tsx
/**
 * check-ds-classes — Gate UI « styles hors Design System » (R-UI-0, §5 de
 * docs/design-system/RATIONALISATION_UI.md (PR #462)). MODE RAPPORT, enforcement via le
 * méta-cliquet `check:ratchet` (compteur qui ne peut que descendre).
 * =============================================================================
 * Règle : dans le code applicatif (`app/`, `components/` hors `components/ui/`),
 * une couleur, un rayon ou une ombre passe par un token Savr (`bg-savr-*`,
 * `rounded-savr-*`, `shadow-savr-*`). Toute valeur « brute » échappe à l'onglet
 * Tokens du design system et ne suit pas quand on change un token.
 *
 * Compte, hors tests et hors vitrine `/dev` :
 *   1. classes de palette Tailwind brute : `text-red-600`, `bg-neutral-100`… ;
 *   2. blanc / noir bruts : `bg-white`, `text-white`, `bg-black/40`… (le token
 *      est `*-savr-white` ; un voile noir passe par un token dédié) ;
 *   3. rayons bruts : `rounded`, `rounded-lg`, `rounded-t-xl`… (sauf
 *      `rounded-savr-*` et `rounded-full`) ;
 *   4. ombres brutes : `shadow`, `shadow-sm`, `shadow-xl`… (sauf `shadow-savr-*`) ;
 *   5. couleurs hexadécimales en dur : `#1f2937`, `#fff`, `#223870cc`
 *      (3, 4, 6 ou 8 chiffres) et fonctions `rgb()` / `rgba()` / `hsl()`.
 *
 * Cas assumés (R-UI-6a) : une valeur unique sans token de même rendu reste en
 * place, précédée d'un commentaire `ds-classes: valeur unique, à arbitrer`.
 *
 * Les commentaires sont retirés avant l'analyse (un mot « shadow » dans une
 * explication n'est pas une classe).
 *
 * Sortie : rapport (catégories + fichiers les plus touchés), `RATCHET_COUNT=<n>`,
 * exit 0 toujours. Baseline : docs/audit/gate-baseline.json (clé `ds-classes`).
 *
 * Usage : pnpm check:ds-classes
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
  // Routes API : aucune classe CSS ; le mot « shadow » y est un nom métier.
  'packages/plateforme/src/app/api',
];

const PALETTE =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone';
const UTILS =
  'bg|text|border(?:-[trblxyse]+)?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|placeholder|decoration|accent|caret|shadow';

// Une classe est délimitée par un guillemet, un backtick, une espace, un `:`
// (variante `hover:`) ou `${`/`}` dans un template literal.
const AVANT = '(?<=["\'`\\s:}]|^)';
const APRES = '(?=["\'`\\s$]|$)';

const CATEGORIES: { key: string; libelle: string; re: RegExp }[] = [
  {
    key: 'palette',
    libelle: 'classe de palette Tailwind brute (ex. text-red-600)',
    re: new RegExp(
      `${AVANT}(?:${UTILS})-(?:${PALETTE})-\\d{2,3}(?:/\\d{1,3})?${APRES}`,
      'g',
    ),
  },
  {
    key: 'blanc-noir',
    libelle:
      'blanc / noir brut (ex. bg-white, bg-black/40) au lieu de *-savr-white',
    re: new RegExp(
      `${AVANT}(?:${UTILS})-(?:white|black)(?:/\\d{1,3})?${APRES}`,
      'g',
    ),
  },
  {
    key: 'rayon',
    libelle: 'rayon brut (ex. rounded-lg) au lieu de rounded-savr-*',
    re: new RegExp(
      `${AVANT}rounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl|4xl))?${APRES}`,
      'g',
    ),
  },
  {
    key: 'ombre',
    libelle: 'ombre brute (ex. shadow-md) au lieu de shadow-savr-*',
    re: new RegExp(
      `${AVANT}shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner|none))?${APRES}`,
      'g',
    ),
  },
  {
    key: 'hex',
    libelle: 'couleur hexadécimale en dur (ex. #1f2937, #fff, #223870cc)',
    // 8, 6, 4 ou 3 chiffres ; les formes courtes exigent un délimiteur de
    // valeur CSS/JS autour (un « #285 » de référence de PR vit en commentaire,
    // déjà retiré, ou dans du texte sans guillemet).
    re: /(?<=["'`(\s:])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?=["'`)\s;,]|$)/g,
  },
  {
    key: 'rgb',
    libelle: 'couleur fonctionnelle en dur (rgb(), rgba(), hsl())',
    re: /\b(?:rgba?|hsla?)\(/g,
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

/** Retire les commentaires ligne et bloc (une classe n'y vit jamais). */
function sansCommentaires(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

function main(): void {
  const files: string[] = [];
  for (const r of ROOTS) walk(r, files);

  const parCategorie = new Map<string, number>();
  const parFichier = new Map<string, number>();
  const exemples = new Map<string, string[]>();
  let total = 0;

  for (const f of files) {
    const src = sansCommentaires(readFileSync(f, 'utf8'));
    for (const cat of CATEGORIES) {
      const matches = [...src.matchAll(cat.re)];
      if (matches.length === 0) continue;
      total += matches.length;
      parCategorie.set(
        cat.key,
        (parCategorie.get(cat.key) ?? 0) + matches.length,
      );
      parFichier.set(f, (parFichier.get(f) ?? 0) + matches.length);
      const ex = exemples.get(cat.key) ?? [];
      if (ex.length < 5) ex.push(`${relative('.', f)} : ${matches[0]![0]}`);
      exemples.set(cat.key, ex);
    }
  }

  const lines: string[] = [
    '## Gate UI — styles hors tokens Design System (report-only, cliqueté)',
    '',
    `Fichiers scannés (app + components hors ui/, hors tests) : ${files.length}`,
    '',
  ];
  for (const cat of CATEGORIES) {
    const n = parCategorie.get(cat.key) ?? 0;
    lines.push(`- \`${cat.key}\` — ${cat.libelle} : **${n}**`);
    for (const e of exemples.get(cat.key) ?? []) lines.push(`    - ${e}`);
  }
  const top = [...parFichier.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (top.length) {
    lines.push('', 'Fichiers les plus touchés :');
    for (const [f, n] of top) lines.push(`- ${relative('.', f)} : ${n}`);
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
