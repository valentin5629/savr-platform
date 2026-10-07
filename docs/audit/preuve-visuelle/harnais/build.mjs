import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.REPO || '/home/user/savr-platform';
const PLAT = `${REPO}/packages/plateforme`;
const req = createRequire(`${PLAT}/package.json`);
const esbuild = createRequire(
  `${REPO}/node_modules/.pnpm/esbuild@0.28.0/node_modules/esbuild/package.json`,
)('esbuild');
const postcss = createRequire(
  `${REPO}/node_modules/.pnpm/postcss@8.5.15/node_modules/postcss/package.json`,
)('postcss');
const tailwind = req('@tailwindcss/postcss');
const out = process.argv[2] || resolve(here, 'dist');
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: [process.env.ENTRY || resolve(here, 'entry.tsx')],
  bundle: true,
  outfile: `${out}/bundle.js`,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [`${PLAT}/node_modules`, `${REPO}/node_modules`],
  alias: {
    '@': `${PLAT}/src`,
    'next/link': resolve(here, 'stubs/next-link.tsx'),
    'next/navigation': resolve(here, 'stubs/next-navigation.ts'),
  },
  loader: { '.svg': 'dataurl', '.png': 'dataurl' },
  logLevel: 'warning',
});
const css =
  `@source "${here}";\n` + readFileSync(`${PLAT}/src/app/globals.css`, 'utf8');
const res = await postcss([tailwind({ base: PLAT })]).process(css, {
  from: `${PLAT}/src/app/globals.css`,
  to: `${out}/style.css`,
});
writeFileSync(`${out}/style.css`, res.css);
writeFileSync(
  `${out}/index.html`,
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><style>body{margin:0}</style></head><body><div id="root"></div><script src="bundle.js"></script></body></html>`,
);
console.log('built', out);
