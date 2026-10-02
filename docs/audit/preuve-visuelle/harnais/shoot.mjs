import pkg from 'playwright';
const { chromium } = pkg;
import { mkdirSync } from 'node:fs';
const [dist, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 1200, height: 900 },
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
await browser.close();
console.log('shot', outDir);
