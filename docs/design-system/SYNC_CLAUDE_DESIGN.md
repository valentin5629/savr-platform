# Synchronisation Claude Design ↔ code

Le design system Savr vit dans Claude Design (artefact « Savr », type Design System, projet `savr-platform`). Il tient ses fichiers sous `project/` : `tokens.json`, `README.md` (brand book), `rationalisation-ui.md` (inventaire de rationalisation), `components/<Carte>/README.md` (règles) et `components/<Carte>/preview.html` (aperçu live, buildé depuis le code).

## Ce qui se décide dans Claude Design, et comment ça revient dans le code

| Dans Claude Design                                                                | Correspondance code                                                                                                                                           | Retour dans le code                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Onglet Tokens (`tokens.json`) : couleurs, rayons, espacements, ombres, conteneurs | `packages/plateforme/src/app/globals.css`, bloc `@theme` (mêmes noms : `color-savr-primary-700` ↔ `--color-savr-primary-700`) et alias shadcn du bloc `:root` | mécanique : `pnpm check:ds-tokens` liste les divergences, Claude Code les reporte dans `globals.css`           |
| README d'une carte : variantes, règles d'usage, états                             | `packages/plateforme/src/components/ui/<fichier>.tsx` (variants `cva`, props)                                                                                 | Claude Code implémente la règle dans la primitive, puis les écrans qui la contournent sont migrés (inventaire) |
| Colonne État / Décision de `rationalisation-ui.md` (bilan)                        | §4 et §5 de `RATIONALISATION_UI.md` (dette résiduelle, arbitrages Q1-Q12)                                                                                     | Claude Code exécute le point correspondant                                                                     |
| Preview d'une carte                                                               | aperçu **dérivé** du code (bundle React buildé depuis `components/ui`)                                                                                        | ne se modifie pas à la main : changer le code, puis resynchroniser                                             |

Les aperçus ne sont donc pas éditables comme des maquettes : Claude Design est l'endroit où l'on décide (tokens, règles, variantes), le code reste la source des composants. Une décision prise dans Claude Design est appliquée au code par Claude Code, puis le design system est resynchronisé depuis le code pour que les aperçus suivent.

## Procédure « appliquer les décisions de Claude Design »

Dans une session Claude Code (web ou local), demander : « Applique le design system Savr de Claude Design au code ». La session :

1. lit `project/tokens.json`, `project/rationalisation-ui.md` et les README des cartes modifiées (outil Artifact, lecture) ;
2. enregistre `tokens.json` dans `docs/design-system/claude-design/tokens.json` et lance `pnpm check:ds-tokens` ;
3. reporte chaque divergence de token dans `globals.css` (après arbitrage Val si la valeur change une règle du CDC §10) ;
4. implémente les décisions `OK` / `MODIF` des tableaux dans `components/ui/*` et migre les écrans concernés ;
5. ouvre une PR et met à jour `_Divergences/` pour toute règle du CDC touchée.

`pnpm check:ds-tokens` renvoie 1 dès qu'un token diverge : utilisable comme gate CI sur le snapshot commité.

## Procédure « resynchroniser Claude Design depuis le code »

Après un lot mergé : `node packages/plateforme/design-system-sync/build.mjs` (bundle, feuille, types), `CHROMIUM_PATH=/opt/pw-browsers/chromium node packages/plateforme/design-system-sync/check.mjs` (rendu de chaque aperçu, 0 erreur attendue), `pnpm ds:usages`, puis publication dans l'artefact (outil Artifact) de `project/components/{bundle.js,bundle.css,index.d.ts}`, des aperçus, des README de cartes (blocs « Usage dans l'app » et « Bilan » mis à jour, nouvelles cartes créées, cartes des composants supprimés retirées), de `rationalisation-ui.md`, et de l'index (`lastChange`) en dernier. `tokens.json` : seuls les tokens absents du design system sont ajoutés (valeurs jamais écrasées, divergences listées par `pnpm check:ds-tokens`).

Historique : synchro complète 2026-09-28 (`main@b587d76`, Cowork) · 2026-10-01 (`main@11c940b`, inventaire, 63 cartes live) · **2026-10-07 (`main@680d339`, bilan des lots R-UI-0 à 6, 80 cartes live + 5 propositions : 20 cartes ajoutées, 3 retirées — `KpiCockpitCard`, `BlocHeader`, `BadgeTypeCollecte`)**.

## Compteurs d'usage

`pnpm ds:usages` régénère `docs/design-system/USAGES.md` (occurrences et fichiers par élément réutilisable, hors tests, hors `components/ui`, hors vitrine `/dev`). Les blocs « Usage dans l'app » des cartes Claude Design sont pris de ce comptage à la date indiquée dans chaque carte.

## Preuve visuelle

Les captures de rendu des aperçus sortent de `check.mjs` (`design-system-sync/dist/check/<Carte>.png`, non versionnées). Les captures avant/après de chaque lot sont versionnées dans `docs/design-system/captures/r-ui-*/`. La vitrine `/dev/design-system` et `GALERIE.md` (primitives et recettes ad hoc côte à côte) ont été retirées le 2026-10-07 : les recettes ad hoc qu'elles comparaient n'existent plus dans le code.

## Producteur (resynchronisation depuis le code)

`packages/plateforme/design-system-sync/` tient tout ce qui fabrique les fichiers du design system à partir du code :

- `entry.ts` : ce qui entre dans le bundle (`window.SavrDS`) — toutes les primitives `components/ui` (sous-dossier `fiche/` compris) sauf celles qui dépendent de Supabase, les composants métier partagés (`ToggleTypeCollecte`, frises, `ChartCard`, `TopRankList`, `DashboardFilterBar`, `EmptyDashboardState`, `AuthCard`, `SavrLogoMark`…), un sous-ensemble d'icônes lucide. Type-checké par le `tsc` racine : un composant supprimé du code casse le build du bundle, ce qui force la mise à jour de l'aperçu.
- `build.mjs` : `node packages/plateforme/design-system-sync/build.mjs` → `dist/bundle.js` (esbuild, IIFE minifié, React 18 fourni par la page via `shims/`), `dist/bundle.css` (Tailwind 4 sur les sources exportées et sur `previews/`, tokens Savr en `@theme reference` pour que `tokens.css` du design system reste la source des valeurs), `dist/index.d.ts` (types de documentation).
- `previews/<Carte>.html` : un aperçu par carte (ligne 1 = marqueur `@dsCard`), publié tel quel en `project/components/<Carte>/preview.html`.
- `check.mjs` : `CHROMIUM_PATH=/opt/pw-browsers/chromium node packages/plateforme/design-system-sync/check.mjs` rend chaque aperçu dans Chromium avec le bundle, un `tokens.css` dérivé du snapshot et React en global ; erreurs JS remontées, une capture par carte dans `dist/check/`.

Publication (Claude Code, outil Artifact) : `project/components/{bundle.js,bundle.css,index.d.ts}`, les aperçus, puis l'index (`lastChange`) en dernier. Les README des cartes et le brand book sont la prose de Val : la synchro y ajoute ou met à jour les blocs « Usage dans l'app » et la provenance, sans réécrire le reste. `tokens.json` n'est pas écrasé par le code : les divergences sont listées par `pnpm check:ds-tokens` et tranchées dans Claude Design.
