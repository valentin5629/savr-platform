# Synchronisation Claude Design ↔ code

Le design system Savr vit dans Claude Design (artefact « Savr », type Design System, projet `savr-platform`). Il tient ses fichiers sous `project/` : `tokens.json`, `README.md` (brand book), `rationalisation-ui.md` (inventaire de rationalisation), `components/<Carte>/README.md` (règles) et `components/<Carte>/preview.html` (aperçu live, buildé depuis le code).

## Ce qui se décide dans Claude Design, et comment ça revient dans le code

| Dans Claude Design                                                                | Correspondance code                                                                                                                                           | Retour dans le code                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Onglet Tokens (`tokens.json`) : couleurs, rayons, espacements, ombres, conteneurs | `packages/plateforme/src/app/globals.css`, bloc `@theme` (mêmes noms : `color-savr-primary-700` ↔ `--color-savr-primary-700`) et alias shadcn du bloc `:root` | mécanique : `pnpm check:ds-tokens` liste les divergences, Claude Code les reporte dans `globals.css`           |
| README d'une carte : variantes, règles d'usage, états                             | `packages/plateforme/src/components/ui/<fichier>.tsx` (variants `cva`, props)                                                                                 | Claude Code implémente la règle dans la primitive, puis les écrans qui la contournent sont migrés (inventaire) |
| Colonne Décision de `rationalisation-ui.md`                                       | lots R-UI-0 à R-UI-6 de `RATIONALISATION_UI.md`                                                                                                               | Claude Code exécute le lot correspondant                                                                       |
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

Après un lot de rationalisation mergé : rebuild du bundle des aperçus (esbuild + Tailwind 4 sur une copie de `components/ui`, React 18) et republication des fichiers `project/components/**`, `tokens.json`, `README.md` dans l'artefact. La dernière synchro complète date du 2026-09-28 (`main@b587d76`, Cowork). Depuis, le code a ajouté `filtre-en-ligne` (BarreFiltres, FiltreCoches, FiltreRecherche), `time-picker`, `data-grid`, `collecte-statut-frise`, et refondu `FilterBar` : ces cartes manquent ou sont périmées dans le design system (tableau B de `rationalisation-ui.md`).

## Compteurs d'usage

`pnpm ds:usages` régénère `docs/design-system/USAGES.md` (occurrences et fichiers par élément réutilisable, hors tests, hors `components/ui`, hors vitrine `/dev`). Les blocs « Usage dans l'app » des cartes Claude Design sont pris de ce comptage à la date indiquée dans chaque carte.

## Galerie et vitrine

`docs/design-system/GALERIE.md` (captures) et `/dev/design-system` (page de dev, 404 en production) montrent côte à côte les primitives et les recettes ad hoc trouvées dans l'app.
