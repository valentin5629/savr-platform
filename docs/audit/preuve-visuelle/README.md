# Preuve visuelle — harnais de capture avant / après (R-UI-6)

Rend des composants et des pages **sans serveur Next ni base** : bundle esbuild
(React, alias `@/`, stubs `next/link` / `next/navigation`), CSS Tailwind 4
compilé depuis `packages/plateforme/src/app/globals.css`, capture Chromium par
Playwright, comparaison pixel par ImageMagick. C'est le harnais des PR #473,
#474 (6a) et #475 (6b) ; il est versionné pour que la clause « capture pixel à
0 » des corps de PR soit rejouable par un tiers.

## Rejouer

```bash
H=docs/audit/preuve-visuelle/harnais

# « après » = arbre courant
ENTRY=$H/entry-6b-apres.tsx node $H/build.mjs /tmp/pv/apres
SECTIONS=kpi,evolution,donut-rank,co2,page-parametres,page-methodologie,page-cgu,kpi-bilan \
  node $H/shoot.mjs /tmp/pv/apres /tmp/pv/shots-apres

# « avant » = worktree de la base (node_modules liés)
git worktree add /tmp/pv/main origin/main
ln -s "$PWD/node_modules" /tmp/pv/main/node_modules
ln -s "$PWD/packages/plateforme/node_modules" /tmp/pv/main/packages/plateforme/node_modules
REPO=/tmp/pv/main ENTRY=$H/entry-6b-avant.tsx node $H/build.mjs /tmp/pv/avant
SECTIONS=… node $H/shoot.mjs /tmp/pv/avant /tmp/pv/shots-avant

# comparaison (0 = identique)
for f in kpi evolution …; do compare -metric AE /tmp/pv/shots-avant/$f.png /tmp/pv/shots-apres/$f.png /tmp/pv/diff-$f.png; done
```

- `build.mjs` : `REPO` (racine du dépôt à rendre, défaut = ce dépôt), `ENTRY`
  (fichier d'entrée). Le CSS est compilé avec `@source` sur le dossier du
  harnais pour que les classes des entrées existent.
- `shoot.mjs` : `SECTIONS` = ids des `<section>` à capturer (une image par id).
  Chromium : `/opt/pw-browsers/chromium` (session cloud) — adapter
  `executablePath` ailleurs.
- `measure.mjs` : imprime les boîtes (`getBoundingClientRect`) des premiers
  éléments de sections choisies, pour distinguer un vrai décalage d'un artefact
  de capture (hauteurs fractionnaires).
- Entrées : `entry.tsx` (6a), `entry-6b-avant.tsx` / `entry-6b-apres.tsx` (6b :
  les imports diffèrent — `KpiCockpitCard` / `Co2HeroCardAg` n'existent plus
  après), `entry-r-ui-3-avant.tsx` / `entry-r-ui-3-apres.tsx` (R-UI-3 :
  `ACTION_DESTRUCTIVE_CONTOUR`, `authLienClass`, `Button size="icon"`
  n'existent plus après), `entry-r-ui-4a-avant.tsx` / `entry-r-ui-4a-apres.tsx`
  (R-UI-4a : `FilterBar` compteur + reset, `ListFooter`, `DataGrid` erreur /
  vide / `columnsToggle` opt-in ; avant = pied H1 recopié, pagination maison du
  registre, état Error recopié), `entry-r-ui-4b-avant.tsx` / `entry-r-ui-4b-apres.tsx`
  (R-UI-4b : segmenté ZD/AG unique `ToggleTypeCollecte`, `FilterChips` dans
  `FilterBar`, `Tabs` DS, `FilterBar surface="page"`, `FiltreRecherche` ✕,
  raccourcis de période + `Combobox titre`, primitive `Table` ; avant = clones
  maison recopiés tels qu'ils étaient sur `main`, `CollecteTypeTabs` et
  `MultiSelectFilter` importés depuis le worktree avant suppression).
  Fixtures communes dans `common-6b.tsx`.
- `VIEWPORTS=dialog,dialog-collecte` (shoot.mjs) : l'entrée rend une modale
  plein écran sous `#<nom>` → capture du viewport entier (une `fixed inset-0`
  n'est pas capturable par section).
- Playwright est résolu depuis `packages/plateforme` (`createRequire`), le
  harnais n'a pas de `node_modules` : `REPO` sert aussi à shoot.mjs.

## Limites connues

- Composants et pages **statiques** uniquement (pas de `fetch`, pas d'auth) :
  les pages à données sont « À VÉRIFIER MANUELLEMENT » sur l'aperçu Vercel.
- Les hauteurs fractionnaires d'une section décalent les suivantes d'un pixel
  d'une capture à l'autre : placer les sections non iso **en dernier**, ou
  comparer avec `measure.mjs`.
- Polices : `--font-nunito` n'est pas chargée (repli system-ui), identique
  avant / après.

## Codemods associés (`docs/audit/codemods/`)

- `r-ui-6b-migrate.py` : phases `H` (h1-h3 → `Heading`), `P` (`PageHeader`),
  `C` (`Card padding|variant`, `CardTitle size`, conteneurs cockpit), `I7`
  (`ChartTooltip`), `K2` (`ToggleChip`), `T` (`Text`). Analyse des balises JSX
  (fermeture appariée par profondeur), `className` littéral uniquement.
  Angles morts relevés en revue : balises dont `className` est précédé d'un
  autre attribut (`key=`, `data-testid=`) pour la phase `C`, `<label>` (à
  exclure : primitive formulaire, R-UI-5).
- `r-ui-6b-formatteurs.py` : J2 (`lib/format` source unique).
- `r-ui-3-migrate.py` : phases `L` (`Button loading` + `loadingText`, retrait
  de la condition dans `disabled`), `I` (icône sans `mr-*` / `h-4 w-4` dans un
  `Button`), `F` (pied de modale `footer={<>…</>}` et rangée `flex … gap-2` à
  deux boutons → `FormActions`, secondaire d'abord). Hors gabarit (3 boutons,
  spinner maison, libellé JSX) : repris à la main, listés par le script.
