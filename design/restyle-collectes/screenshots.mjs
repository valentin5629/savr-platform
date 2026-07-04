/* eslint-disable no-console */
/* global process, console */
// Captures visuelles du re-style admin/collectes (liste + fiche), rendues par le
// VRAI dev server du worktree pointé sur Supabase LOCAL (persona admin).
//   node design/restyle-collectes/screenshots.mjs
// Env : BASE (def http://127.0.0.1:3007), AG_ID, ZD_ID (si présent → capture ZD).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? 'http://127.0.0.1:3007';
const AG_ID = process.env.AG_ID ?? '';
const ZD_ID = process.env.ZD_ID ?? '';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

// ── Login persona admin ──────────────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.locator('input[type="email"]').fill('admin@savr-test.local');
await page.locator('input[type="password"]').fill('SavrTest2026!');
await page.getByRole('button', { name: /Se connecter/ }).click();
await page.waitForURL((u) => !u.pathname.endsWith('/login'), {
  timeout: 20000,
});

async function shot(name, { width = 1440 } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  console.log('shot', name);
}

if (!ZD_ID) {
  // ── Liste ──────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/collectes`, { waitUntil: 'networkidle' });
  await page
    .getByRole('heading', { name: 'Collectes' })
    .waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await shot('liste-1440-defaut.png', { width: 1440 });

  await page.getByRole('button', { name: /AG en attente attribution/ }).click();
  await page.waitForTimeout(700);
  await shot('liste-1440-chip.png', { width: 1440 });

  // Retour "Toutes" pour la capture mobile
  await page.getByRole('button', { name: 'Toutes' }).click();
  await page.waitForTimeout(500);
  await shot('liste-390-defaut.png', { width: 390 });

  // ── Fiche AG ─────────────────────────────────────────────────────────────
  if (AG_ID) {
    await page.goto(`${BASE}/admin/collectes/${AG_ID}`, {
      waitUntil: 'networkidle',
    });
    await page
      .getByRole('heading', { name: /^Collecte / })
      .waitFor({ timeout: 20000 });
    await page.waitForTimeout(1000);
    await shot('fiche-1440-ag.png', { width: 1440 });
    await shot('fiche-390-ag.png', { width: 390 });
  }
} else {
  // ── Fiche ZD (collecte temporairement basculée en zero_dechet) ─────────────
  await page.goto(`${BASE}/admin/collectes/${ZD_ID}`, {
    waitUntil: 'networkidle',
  });
  await page
    .getByRole('heading', { name: /^Collecte / })
    .waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await shot('fiche-1440-zd.png', { width: 1440 });
}

await browser.close();
