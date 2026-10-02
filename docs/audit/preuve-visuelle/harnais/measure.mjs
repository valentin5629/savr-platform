import pkg from 'playwright';
const { chromium } = pkg;
const dist = process.argv[2];
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(`file://${dist}/index.html`);
await page.waitForTimeout(600);
const out = await page.evaluate(() => {
  const r = [];
  for (const id of ['evolution', 'page-parametres', 'co2']) {
    const sec = document.getElementById(id);
    const els = [
      sec.children[0],
      sec.children[1],
      ...Array.from(sec.children[1].querySelectorAll('*')).slice(0, 6),
    ];
    for (const el of els) {
      const b = el.getBoundingClientRect();
      r.push(
        `${id} <${el.tagName.toLowerCase()} class="${(el.className || '').toString().slice(0, 50)}"> top=${(b.top - sec.getBoundingClientRect().top).toFixed(2)} h=${b.height.toFixed(2)}`,
      );
    }
  }
  return r.join('\n');
});
console.log(out);
await browser.close();
