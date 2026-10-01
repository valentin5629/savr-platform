/* eslint-disable no-console */
/* global process, console */
// Captures de la vitrine Design System (/dev/design-system), rendue par le VRAI
// dev server (`pnpm --filter @savr/plateforme dev`, port 3001). Aucune donnée :
// la page est purement présentationnelle (404 en production).
//   node docs/design-system/captures.mjs
// Env : BASE (def http://127.0.0.1:3001) ; CHROMIUM_PATH (exécutable Chromium
// déjà installé, sinon celui de Playwright). Sortie : docs/design-system/captures/.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'captures');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? 'http://127.0.0.1:3001';
const URL_PAGE = `${BASE}/dev/design-system`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
await page.goto(URL_PAGE, { waitUntil: 'networkidle' });
// La vitrine montre volontairement plusieurs recettes de <h1> : on cible le sien.
await page
  .getByRole('heading', { level: 1, name: /Vitrine Design System/ })
  .waitFor({ timeout: 30000 });
await page.waitForTimeout(800);

async function shot(name, options = {}) {
  await page.screenshot({ path: join(OUT, name), ...options });
  console.log('capture', name);
}

// Vue d'ensemble.
await shot('00-vitrine-complete.png', { fullPage: true });

// Une capture par famille (ordre de l'inventaire).
const SECTIONS = [
  'tokens',
  'boutons',
  'badges',
  'filtres',
  'tableaux',
  'formulaires',
  'modales',
  'feedback',
  'en-tetes',
];
for (const [i, id] of SECTIONS.entries()) {
  const el = page.locator(`[data-capture="${id}"]`);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const name = `${String(i + 1).padStart(2, '0')}-${id}.png`;
  await el.screenshot({ path: join(OUT, name) });
  console.log('capture', name);
}

// Composants ouverts : modale, confirmation, sheet, toast (viewport).
await page.getByTestId('ouvrir-modale').click();
await page.waitForTimeout(400);
await shot('10-modale.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.getByTestId('ouvrir-confirm').click();
await page.waitForTimeout(400);
await shot('11-confirmation.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.getByTestId('ouvrir-sheet').click();
await page.waitForTimeout(500);
await shot('12-sheet.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.getByTestId('toast-succes').scrollIntoViewIfNeeded();
await page.getByTestId('toast-succes').click();
await page.waitForTimeout(500);
await shot('13-toast.png');

// Mobile : la vitrine entière à 390 px (cibles tactiles, repli des barres).
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await shot('20-vitrine-390.png', { fullPage: true });

await browser.close();
