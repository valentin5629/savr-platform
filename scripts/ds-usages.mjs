#!/usr/bin/env node
/* eslint-disable no-console */
/* global console */
// Compte, pour chaque élément réutilisable (export de components/ui + composants
// métier partagés), ses usages JSX dans les écrans de la Plateforme (hors tests,
// hors components/ui, hors vitrine /dev). Écrit docs/design-system/USAGES.md.
//   node scripts/ds-usages.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const SRC = 'packages/plateforme/src';
const UI = join(SRC, 'components/ui');
// Composants métier réutilisés par plusieurs écrans (hors components/ui).
const METIER = {
  TopRankList: 'components/dashboards/charts/cockpit/TopRankList.tsx',
  ChartCard: 'components/dashboards/charts/cockpit/ChartCard.tsx',
  Co2HeroCard: 'components/dashboards/charts/cockpit/Co2HeroCard.tsx',
  Co2DetailModal: 'components/dashboards/charts/cockpit/Co2DetailModal.tsx',
  CollecteStatutFrise: 'components/admin/collecte-statut-frise.tsx',
  CollecteFiltresBar: 'components/collecte/collecte-filtres-bar.tsx',
  CollecteFiltreActif: 'components/collecte/collecte-filtre-actif.tsx',
  ToggleTypeCollecte: 'components/collecte/toggle-type-collecte.tsx',
  AnnulationCollecteDialog:
    'components/collecte/annulation-collecte-dialog.tsx',
  DashboardFilterBar: 'components/dashboards/DashboardFilterBar.tsx',
  BenchmarkFilterBar: 'components/dashboards/BenchmarkFilterBar.tsx',
  EvenementsFilterBar: 'components/dashboards/EvenementsFilterBar.tsx',
  EmptyDashboardState: 'components/dashboards/EmptyDashboardState.tsx',
  InviterUtilisateurModal:
    'components/organisation/inviter-utilisateur-modal.tsx',
  LogoCard: 'components/organisation/logo-card.tsx',
  AuthCard: 'components/auth/auth-card.tsx',
  SavrLogoMark: 'components/layout/savr-logo.tsx',
};

function* fichiers(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* fichiers(p);
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) yield p;
  }
}
const ecrans = [
  ...fichiers(join(SRC, 'app')),
  ...fichiers(join(SRC, 'components')),
]
  .filter((p) => !p.startsWith(UI) && !p.includes(`${SRC}/app/dev/`))
  .map((p) => [p, readFileSync(p, 'utf8')]);

// Exports PascalCase de components/ui (blocs `export { A, B }` multi-lignes compris).
const exportsUi = new Map();
// Sous-dossiers compris (components/ui/fiche/*).
for (const p of fichiers(UI)) {
  const e = p.slice(UI.length + 1);
  const src = readFileSync(p, 'utf8');
  const noms = new Set();
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm))
    for (const n of m[1].split(',')) {
      const nom = n.replace(/\s+/g, '').replace(/^type/, '');
      if (/^[A-Z][a-z][A-Za-z]+$/.test(nom)) noms.add(nom);
    }
  for (const m of src.matchAll(
    /^export\s+(?:function|const)\s+([A-Z][a-z][A-Za-z]+)/gm,
  ))
    noms.add(m[1]);
  for (const n of noms) exportsUi.set(n, `components/ui/${e}`);
}

function compte(nom) {
  const re = new RegExp(`<${nom}\\b`, 'g');
  let occ = 0;
  let nf = 0;
  for (const [, texte] of ecrans) {
    const k = (texte.match(re) ?? []).length;
    if (k) {
      occ += k;
      nf += 1;
    }
  }
  return { occ, nf };
}

const sha = execSync('git rev-parse --short HEAD').toString().trim();
// Jour civil parisien (fr-CA donne AAAA-MM-JJ).
const date = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris',
}).format(new Date());
const lignes = [];
for (const [nom, src] of [...exportsUi, ...Object.entries(METIER)]) {
  const { occ, nf } = compte(nom);
  lignes.push({
    nom,
    src,
    occ,
    nf,
    famille: src.startsWith('components/ui/') ? 'ui' : 'métier',
  });
}
lignes.sort((a, b) => b.occ - a.occ || a.nom.localeCompare(b.nom));

const md = [
  '# Usages des éléments réutilisables',
  '',
  `Généré par \`node scripts/ds-usages.mjs\` sur \`${sha}\` le ${date}. Compte les balises JSX \`<Nom\` dans \`packages/plateforme/src/{app,components}\` hors tests, hors \`components/ui\`, hors vitrine \`/dev\`. Un composant à 0 est exporté mais monté nulle part (ou utilisé seulement à l'intérieur d'une autre primitive).`,
  '',
  '| Élément | Famille | Occurrences | Fichiers | Source |',
  '| --- | --- | ---: | ---: | --- |',
  ...lignes.map(
    (l) =>
      `| \`${l.nom}\` | ${l.famille} | ${l.occ} | ${l.nf} | \`${l.src}\` |`,
  ),
  '',
];
writeFileSync('docs/design-system/USAGES.md', md.join('\n'));
console.log(
  `${lignes.length} éléments · ${lignes.filter((l) => l.occ === 0).length} à 0 usage → docs/design-system/USAGES.md`,
);
