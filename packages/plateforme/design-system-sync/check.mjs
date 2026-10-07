#!/usr/bin/env node
/* eslint-disable no-console */
/* global process, console */
// Contrôle de rendu des aperçus du design system : chaque previews/<Comp>.html est
// ouvert dans Chromium avec dist/bundle.js + dist/bundle.css, un tokens.css dérivé
// du snapshot docs/design-system/claude-design/tokens.json et React en global
// (React du repo en remplacement du React 18 de la page). Erreurs JS et console
// remontées ; une capture par carte dans dist/check/.
//   CHROMIUM_PATH=/opt/pw-browsers/chromium node packages/plateforme/design-system-sync/check.mjs
import { createRequire } from 'node:module';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const OUT = join(HERE, 'dist');
const CHECK = join(OUT, 'check');
mkdirSync(join(CHECK, 'pages'), { recursive: true });
const require = createRequire(import.meta.url);
const esbuild = require(
  join(
    ROOT,
    'node_modules/.pnpm',
    readdirSync(join(ROOT, 'node_modules/.pnpm'))
      .filter((d) => d.startsWith('esbuild@'))
      .sort()
      .at(-1),
    'node_modules/esbuild',
  ),
);
const { chromium } = require(join(ROOT, 'node_modules/@playwright/test'));

// React global (le repo est en React 19 ; la page du design system fournit React 18).
esbuild.buildSync({
  stdin: {
    contents:
      'import * as React from "react"; import * as RD from "react-dom"; import * as RDC from "react-dom/client"; window.React = React; window.ReactDOM = Object.assign({}, RD, RDC);',
    resolveDir: resolve(HERE, '..'),
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: join(CHECK, 'react-globals.js'),
});

// tokens.css dérivé de tokens.json (même logique que la page : couleurs par thème,
// autres familles en :root, familles de police, un style de type = une classe).
const tokens = JSON.parse(
  readFileSync(
    join(ROOT, 'docs/design-system/claude-design/tokens.json'),
    'utf8',
  ),
);
const theme = tokens.color.themes[0].id;
const val = (t) =>
  typeof t.value === 'string'
    ? t.value
    : (t.value[theme] ?? Object.values(t.value)[0]);
const alias = (s) => String(s).replace(/\{([a-z0-9-]+)\}/g, 'var(--$1)');
let css = `:root, [data-theme="${theme}"] {\n${tokens.color.tokens.map((t) => `  --${t.name}: ${alias(val(t))};`).join('\n')}\n}\n:root {\n`;
for (const [fam, bloc] of Object.entries(tokens)) {
  if (
    ['color', 'type', 'meta', 'name', 'version'].includes(fam) ||
    !bloc?.tokens
  )
    continue;
  css +=
    bloc.tokens.map((t) => `  --${t.name}: ${alias(val(t))};`).join('\n') +
    '\n';
}
for (const [k, v] of Object.entries(tokens.type.families))
  css += `  --font-${k}: ${v};\n`;
css += '}\n';
for (const g of tokens.type.groups)
  for (const s of g.styles)
    css += `.${s.name} { font-family: var(--font-${s.family ?? g.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : ''} }\n`;
writeFileSync(join(CHECK, 'tokens.css'), css);
copyFileSync(join(OUT, 'bundle.js'), join(CHECK, 'bundle.js'));
copyFileSync(join(OUT, 'bundle.css'), join(CHECK, 'bundle.css'));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const erreurs = [];
page.on('pageerror', (e) =>
  erreurs.push(`pageerror: ${e.message.split('\n')[0]}`),
);
page.on('console', (m) => {
  if (m.type() === 'error') erreurs.push(`console: ${m.text().split('\n')[0]}`);
});
const cartes = readdirSync(join(HERE, 'previews'))
  .filter((f) => f.endsWith('.html'))
  .sort();
const bilan = [];
for (const f of cartes) {
  const nom = f.replace(/\.html$/, '');
  const src = readFileSync(join(HERE, 'previews', f), 'utf8');
  const marker = src.split('\n')[0];
  const hauteur = Number(/height=(\d+)/.exec(marker)?.[1] ?? 120);
  const corps = src.split('\n').slice(1).join('\n');
  const html = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">
<link rel="stylesheet" href="../tokens.css"><link rel="stylesheet" href="../bundle.css">
<script src="../react-globals.js"></script><script src="../bundle.js"></script>
<style>html,body{margin:0}</style></head><body>${corps}</body></html>`;
  const chemin = join(CHECK, 'pages', f);
  writeFileSync(chemin, html);
  erreurs.length = 0;
  await page.setViewportSize({
    width: 960,
    height: Math.max(200, hauteur + 60),
  });
  await page.goto(pathToFileURL(chemin).href, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const texte = (await page.textContent('body'))?.trim() ?? '';
  const vide = texte.length < 2 && !(await page.$('svg, input, button'));
  await page.screenshot({ path: join(CHECK, `${nom}.png`), fullPage: true });
  bilan.push({ nom, erreurs: [...new Set(erreurs)], vide });
}
await browser.close();
const ko = bilan.filter((b) => b.erreurs.length || b.vide);
for (const b of ko)
  console.log(
    `KO ${b.nom}${b.vide ? ' (vide)' : ''}\n   ${b.erreurs.join('\n   ')}`,
  );
console.log(
  `${bilan.length} aperçus rendus · ${ko.length} en erreur ou vides · captures dans ${CHECK}`,
);
process.exit(ko.length ? 1 : 0);
