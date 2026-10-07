import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
// Playwright est résolu depuis packages/plateforme (le harnais vit sous docs/,
// sans node_modules) ; REPO = dépôt dont on prend l'installation.
const REPO = process.env.REPO || '/home/user/savr-platform';
const { chromium } = createRequire(`${REPO}/packages/plateforme/package.json`)(
  '@playwright/test',
);
const [dist, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  // WIDTH=375 : capture mobile (sous la limite `sm` 640 px du DS §8).
  viewport: { width: Number(process.env.WIDTH || 1200), height: 900 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE', m.text());
});
await page.goto(`file://${dist}/index.html`);
await page.waitForTimeout(800);
for (const id of process.env.SECTIONS
  ? process.env.SECTIONS.split(',')
  : [
      'kpi',
      'evolution',
      'donut-rank',
      'co2',
      'divers',
      'encarts',
      'page-parametres',
      'page-cgu',
    ]) {
  await page
    .locator(`#${id}`)
    .screenshot({ path: `${outDir}/${id}.png`, animations: 'disabled' });
}
// VIEWPORTS="dialog,dialog-collecte" : l'entrée rend une modale plein écran
// sous `#<nom>` → capture du viewport entier (une `fixed inset-0` n'est pas
// capturable par section).
for (const name of process.env.VIEWPORTS
  ? process.env.VIEWPORTS.split(',')
  : []) {
  await page.goto(`file://${dist}/index.html#${name}`);
  await page.reload();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: `${outDir}/${name}.png`,
    animations: 'disabled',
  });
}
await browser.close();
console.log('shot', outDir);
