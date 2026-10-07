#!/usr/bin/env node
/* eslint-disable no-console */
/* global process, console */
// Producteur du design system Claude Design « Savr » : bundle React des
// primitives (window.SavrDS, React 18 fourni par la page), feuille Tailwind des
// composants et des aperçus, types de documentation. Sortie dans ./dist (ou le
// dossier passé en argument) ; Claude Code publie ensuite dist/* dans l'artefact
// (project/components/bundle.js, bundle.css, index.d.ts) avec previews/<Comp>.html
// → project/components/<Comp>/preview.html.
//   node packages/plateforme/design-system-sync/build.mjs [dossier-de-sortie]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATEFORME = resolve(HERE, '..');
const ROOT = resolve(PLATEFORME, '..', '..');
const OUT = resolve(process.argv[2] ?? join(HERE, 'dist'));
mkdirSync(OUT, { recursive: true });
const require = createRequire(import.meta.url);

// Paquets transitifs (pnpm, non déclarés par plateforme) : version la plus récente présente.
function pnpmPkg(nom) {
  const store = join(ROOT, 'node_modules/.pnpm');
  const cand = readdirSync(store)
    .filter((d) => d.startsWith(`${nom}@`))
    .sort();
  if (!cand.length)
    throw new Error(`${nom} introuvable dans node_modules/.pnpm`);
  return join(store, cand.at(-1), 'node_modules', nom);
}
const esbuild = require(pnpmPkg('esbuild'));
const postcss = require(pnpmPkg('postcss'));
const tailwind = require('@tailwindcss/postcss');

const cartes = readdirSync(join(HERE, 'previews'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, ''))
  .sort();

// ── 1. bundle.js ─────────────────────────────────────────────────────────────
const SHIMS = {
  '^react$': 'react.cjs',
  '^react-dom$': 'react-dom.cjs',
  '^react-dom/client$': 'react-dom.cjs',
  '^react/jsx-runtime$': 'jsx-runtime.mjs',
  '^react/jsx-dev-runtime$': 'jsx-runtime.mjs',
  '^next/link$': 'next-link.mjs',
  '^next/navigation$': 'next-navigation.mjs',
};
const plugin = {
  name: 'savr-ds',
  setup(b) {
    for (const [re, file] of Object.entries(SHIMS)) {
      b.onResolve({ filter: new RegExp(re) }, () => ({
        path: join(HERE, 'shims', file),
      }));
    }
    // Alias `@/` → packages/plateforme/src (tsconfig paths), résolu par esbuild.
    b.onResolve({ filter: /^@\// }, (args) =>
      b.resolve(`./${args.path.slice(2)}`, {
        resolveDir: join(PLATEFORME, 'src'),
        kind: args.kind,
        importer: args.importer,
      }),
    );
  },
};
const header = `/* @ds-bundle: ${JSON.stringify({
  format: 4,
  namespace: 'SavrDS',
  components: cartes.filter((c) => c !== 'Cover').map((name) => ({ name })),
})} */`;
await esbuild.build({
  entryPoints: [join(HERE, 'entry.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'SavrDS',
  minify: true,
  target: ['es2020'],
  platform: 'browser',
  jsx: 'automatic',
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'ES2022' } },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [plugin],
  outfile: join(OUT, 'bundle.js'),
  banner: { js: header },
  legalComments: 'none',
  logLevel: 'warning',
});
// Un bundle inliné dans un <script> ne doit contenir ni `</script` ni `<!--`.
let js = readFileSync(join(OUT, 'bundle.js'), 'utf8');
js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\u0021--');
writeFileSync(join(OUT, 'bundle.js'), js);

// ── 2. bundle.css ────────────────────────────────────────────────────────────
const globals = readFileSync(join(PLATEFORME, 'src/app/globals.css'), 'utf8');
const theme = globals.match(/@theme\s*\{([\s\S]*?)\n\}/);
if (!theme) throw new Error('Bloc @theme introuvable dans globals.css');
const css = readFileSync(join(HERE, 'build.css'), 'utf8').replace(
  '/* __THEME__ */',
  theme[1],
);
const res = await postcss([tailwind({ base: HERE })]).process(css, {
  from: join(HERE, 'build.css'),
});
if (/<\/style/i.test(res.css)) throw new Error('bundle.css contient </style');
writeFileSync(join(OUT, 'bundle.css'), res.css);

// ── 3. index.d.ts (documentation : jamais type-checké par le design system) ──
const dts = join(OUT, '.dts');
rmSync(dts, { recursive: true, force: true });
const tsconfig = join(OUT, 'tsconfig.dts.json');
writeFileSync(
  tsconfig,
  JSON.stringify(
    {
      extends: join(PLATEFORME, 'tsconfig.json'),
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: dts,
        rootDir: PLATEFORME,
        incremental: false,
        composite: false,
        skipLibCheck: true,
        jsx: 'react-jsx',
      },
      include: [join(HERE, 'entry.ts')],
    },
    null,
    2,
  ),
);
execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', tsconfig], {
  stdio: 'inherit',
});
function* fichiers(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* fichiers(p);
    else if (p.endsWith('.d.ts')) yield p;
  }
}
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
  .toString()
  .trim();
const parts = [
  `// Savr DS — types de documentation (window.SavrDS), générés depuis savr-platform@${sha}`,
  `// par packages/plateforme/design-system-sync/build.mjs. Chaque bloc = un fichier source.`,
  `import type * as React from 'react';`,
];
for (const f of [...fichiers(join(dts, 'src'))].sort()) {
  const body = readFileSync(f, 'utf8')
    .split('\n')
    .filter(
      (l) =>
        !/^import\s/.test(l) &&
        l.trim() !== 'export {};' &&
        !/^\s*\/\/# sourceMappingURL/.test(l),
    )
    .join('\n')
    .trim();
  if (!body) continue;
  parts.push(
    `\n// ── ${relative(PLATEFORME, f).replace(/\.d\.ts$/, '.tsx')} ──`,
    body,
  );
}
writeFileSync(join(OUT, 'index.d.ts'), parts.join('\n') + '\n');
rmSync(dts, { recursive: true, force: true });
rmSync(tsconfig, { force: true });

const ko = (f) => `${(statSync(join(OUT, f)).size / 1024).toFixed(0)} Ko`;
console.log(
  `bundle.js ${ko('bundle.js')} · bundle.css ${ko('bundle.css')} · index.d.ts ${ko('index.d.ts')} · ${cartes.length} aperçus → ${OUT}`,
);
