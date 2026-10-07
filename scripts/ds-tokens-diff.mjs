#!/usr/bin/env node
/* eslint-disable no-console */
/* global process, console */
// Compare les tokens du Design System Claude Design (project/tokens.json,
// téléchargé par Claude Code) aux tokens du code (`@theme` de globals.css).
// Sens Claude Design → code : ce que Val change dans Claude Design apparaît
// ici comme « diverge », à reporter dans globals.css (ou l'inverse, au choix).
//   node scripts/ds-tokens-diff.mjs [chemin/tokens.json]
// Sortie : 3 listes (diverge / absent du code / absent du DS). Code retour 1
// si au moins une divergence de valeur (utilisable en gate).
import { readFileSync } from 'node:fs';

const CSS = 'packages/plateforme/src/app/globals.css';
const TOKENS =
  process.argv[2] ?? 'docs/design-system/claude-design/tokens.json';

// ── Code : bloc @theme { --name: value; } ────────────────────────────────────
const css = readFileSync(CSS, 'utf8');
const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
if (!theme) {
  console.error(`Bloc @theme introuvable dans ${CSS}`);
  process.exit(2);
}
const code = new Map();
for (const m of theme[1].matchAll(/^\s*--([a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
  code.set(m[1], m[2].trim());
}
// Alias shadcn (`:root { --primary: var(--color-savr-primary-700); }`) : le DS
// les porte comme tokens alias `{color-savr-primary-700}` ; même espace de noms.
const root = css.match(/^:root\s*\{([\s\S]*?)\n\}/m);
for (const m of (root?.[1] ?? '').matchAll(
  /^\s*--([a-z0-9-]+)\s*:\s*([^;]+);/gim,
)) {
  if (!code.has(m[1])) code.set(m[1], m[2].trim());
}

// ── Claude Design : familles { tokens: [{name, value}] } ────────────────────
const ds = JSON.parse(readFileSync(TOKENS, 'utf8'));
const premierTheme = ds.color?.themes?.[0]?.id ?? 'light';
const design = new Map();
for (const [famille, bloc] of Object.entries(ds)) {
  if (famille === 'type' || famille === 'meta' || !bloc?.tokens) continue;
  for (const t of bloc.tokens) {
    const v =
      typeof t.value === 'string'
        ? t.value
        : (t.value?.[premierTheme] ?? Object.values(t.value ?? {})[0]);
    if (v != null) design.set(t.name, String(v).trim());
  }
}

// Comparaison sur les familles que le code expose en @theme (couleurs,
// rayons, espacements, ombres, conteneurs). La typo vit dans `type` côté DS.
const norm = (v) =>
  v
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/,\s*/g, ',')
    .replace(/\{([a-z0-9-]+)\}/g, 'var(--$1)');

const diverge = [];
const absentCode = [];
const absentDs = [];
for (const [name, v] of design) {
  if (!code.has(name)) absentCode.push(name);
  else if (norm(code.get(name)) !== norm(v))
    diverge.push([name, code.get(name), v]);
}
const famillesComparees = /^(color|radius|spacing|shadow|container)-savr-/;
for (const name of code.keys()) {
  if (famillesComparees.test(name) && !design.has(name)) absentDs.push(name);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(
  `Tokens code (@theme) : ${code.size} · tokens Claude Design : ${design.size}\n`,
);
console.log(`DIVERGE (${diverge.length}) — même nom, valeur différente`);
for (const [n, c, d] of diverge)
  console.log(`  ${pad(n, 30)} code=${pad(c, 22)} design=${d}`);
console.log(
  `\nABSENT DU CODE (${absentCode.length}) — défini dans Claude Design seulement`,
);
for (const n of absentCode) console.log(`  ${n} = ${design.get(n)}`);
console.log(
  `\nABSENT DU DESIGN SYSTEM (${absentDs.length}) — défini dans globals.css seulement`,
);
for (const n of absentDs) console.log(`  ${n} = ${code.get(n)}`);
process.exit(diverge.length ? 1 : 0);
