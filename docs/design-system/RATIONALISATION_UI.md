# Rationalisation UI — bilan des lots R-UI-0 à R-UI-6

**Inventaire** : 2026-10-01 (`main@11c940b`, ≈ 50 points, 11 familles A-K, 8 bugs, 12 arbitrages). **Bilan** : 2026-10-07 (`main@680d339`), les 8 lots sont mergés (R-UI-6c inclus) et les arbitrages Q1 à Q9 tranchés. L'inventaire d'origine, ligne à ligne, est conservé dans l'historique git de ce fichier (commit `07bda5b0`) ; ce document donne le résultat mesuré, la correspondance lot → PR → lignes, la dette résiduelle et les arbitrages ouverts.

**Pointeurs** : comptage d'usage par élément [USAGES.md](./USAGES.md) (`pnpm ds:usages`) · aller-retour avec Claude Design [SYNC_CLAUDE_DESIGN.md](./SYNC_CLAUDE_DESIGN.md) · design system Claude Design « Savr » (85 cartes, section « Rationalisation UI » = version courte de ce bilan) · captures de preuve visuelle par lot `docs/design-system/captures/r-ui-*/`.

---

## 1. Résultat en chiffres

Les trois compteurs sont des gates en mode cliquet (`pnpm check:ratchet`, baseline `docs/audit/gate-baseline.json`) : ils ne peuvent plus remonter sans faire échouer la CI.

| Indicateur                                                                                                      | 2026-10-01 | 2026-10-07 | Mesure                     |
| --------------------------------------------------------------------------------------------------------------- | ---------: | ---------: | -------------------------- |
| Classes Tailwind hors tokens (palette brute, rayons, ombres, hex, durées, tailles arbitraires)                  |        180 |          1 | `pnpm check:ds-classes`    |
| Primitives HTML brutes hors `ui/` (`<button>`, `<label>`, checkbox, `<table>`, `confirm()`, overlay, `toFixed`) |        107 |         28 | `pnpm check:ds-primitives` |
| Primitives `components/ui` exportées jamais importées                                                           |         15 |         14 | `pnpm check:orphan-ui`     |
| Hex en dur dans le code                                                                                         |        107 |          0 | `check:ds-classes` (hex)   |
| `confirm()` natifs · `<table>` brutes · checkbox natives                                                        |  6 · 4 · 7 |  0 · 0 · 0 | `check:ds-primitives`      |
| Primitives `components/ui`                                                                                      |         55 |         79 | `ls components/ui`         |
| Tests unitaires (Vitest)                                                                                        |      3 296 |      3 770 | `pnpm test:unit`           |

Dette résiduelle mesurée (les 28 + 1) :

- **24 `<button>` bruts / 16 fichiers** : `admin/collectes/page.tsx`, `admin/parametres/templates/page.tsx`, `organisateur/page.tsx`, `programmer/[evenement_id]/ajouter-collecte/page.tsx`, `components/admin/attribution-ag-form.tsx` (4), `collecte-detail-panel.tsx`, `logo-upload.tsx`, `transporteur-modal.tsx` (2) et 8 autres.
- **3 `<label>` bruts** : `collecte-detail-panel.tsx`, `logo-upload.tsx`, `organisation/logo-card.tsx` (inventaire B11, upload de fichier non centralisé).
- **1 overlay maison** `fixed inset-0` : `components/layout/app-shell.tsx` (menu mobile).
- **1 classe hors token** : `app/(programmation)/programmer/confirmation/page.tsx`.
- **14 orphelins `ui/`** : `Accordion` (4 parts), `CardClickable`, `CardDescription`, `CardFooter`, `CommandGroup`, `CommandSeparator`, `DropdownGroup`, `PopoverAnchor`, `Sheet`, `StatCardGrid`, `TourneeCard` (détail §4.2).

---

## 2. Lots livrés

| Lot      | PR                                                                          | Contenu                                                                                                                                                                                                                                                                                                                                | Lignes                | Divergences |
| -------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------- |
| R-UI-0   | [#473](https://github.com/valentin5629/savr-platform/pull/473) (2026-10-02) | 8 bugs §1, `lib/format.ts` (`fmtInt`, `fmtDec`, `fmtEuro` avec €, `fmtPct`, `fmtKg`), `lib/libelles/{facture,pack,organisation,role,tournee}.ts`, `AlertBar success`, modale « Inviter un membre » sur `Modal`, code mort J3, 3 gates UI + ESLint `toFixed` en JSX + test `design-tokens-existent`                                     | §1 B1-B8, J2, J3      | D1-D4       |
| R-UI-6a  | [#474](https://github.com/valentin5629/savr-platform/pull/474)              | hex → tokens : `palette.ts` et `flux.ts` dérivés de `globals.css`, `DOT`/`OPS_DOT` supprimés ; rayons, ombres, durées (`duration-savr-fast/base/slow`) tokenisés ; 4 couleurs ajoutées (`error-soft`, `success-soft`, `warning-deep`, `success-on-dark`) ; tokens spacing retirés (A10) ; `check:ds-classes` 180 → 9                   | A1-A7, A10, K1, K3    | D5-D10      |
| R-UI-6b  | [#475](https://github.com/valentin5629/savr-platform/pull/475)              | `Heading`, `Text` (Q10 a), `PageHeader` (I1), `Card padding` + `variant="elevated"`, `StatCard` = fusion `KpiCockpitCard`, `ChartTooltip`, `ToggleChip`, `Sparkline`, `LogoCard`, `Co2HeroCard` paramétré, Recharts retiré, `fmtMontant`/`fmtPax`/`fmtKgAuto`, codemods `docs/audit/codemods/` ; `ds-primitives` 107 → 102             | A8, A9, I1-I9, K2, J2 | D11-D18     |
| R-UI-3   | [#477](https://github.com/valentin5629/savr-platform/pull/477)              | `Button loading` + `loadingText`, variants `ghost-destructive` / `outline-destructive` / `outline-warning`, `size="icon"` retiré, `TextLink`, `FormActions`, `ConfirmDialog` + `useConfirm`, `AnnulationCollecteDialog` ; `ds-primitives` 102 → 81                                                                                     | B1-B6, G1             | D19-D25     |
| R-UI-4a  | [#478](https://github.com/valentin5629/savr-platform/pull/478)              | `lib/pagination.ts` (`DEFAULT_PAGE_SIZE`, `parseLimit`), hooks `useFiltresUrl` et `useListePaginee`, `ListFooter`, états `loading/empty/error` de `DataGrid`, `columnsToggle`, 1 convention de tri API `tri`/`ordre`                                                                                                                   | D6, E1-E6             | D26-D30     |
| R-UI-4b  | [#481](https://github.com/valentin5629/savr-platform/pull/481)              | `ToggleTypeCollecte` (D1), `FilterBar` complet obligatoire (count + reset, tabs, toggle), `MultiSelectFilter` et `CollecteTypeTabs` supprimés, `FiltreRecherche` partout, parité des barres de filtres 3 rôles ; `ds-primitives` 81 → 63                                                                                               | D1-D5, D7, D9-D11     | D31-D38     |
| R-UI-1   | [#488](https://github.com/valentin5629/savr-platform/pull/488)              | `ToastProvider` monté dans `app/layout.tsx`, `LoadingState`, `ErrorState`, 7 `loading.tsx` + 7 `error.tsx` de route, 28 bandeaux inline → `AlertBar`, 48 états vides → `EmptyState` ; `ds-classes` 9 → 1 ; `orphan-ui` 15 → 14                                                                                                         | H1-H5, A1             | D39-D43     |
| R-UI-2   | [#492](https://github.com/valentin5629/savr-platform/pull/492)              | `TypeCollecteBadge` unique (3 formes, couleurs dans `lib/libelles/type-collecte.ts`), `FactureStatutBadge`, `ActifBadge` (Q2 « Inactif »), `lib/libelles/{type-collecte,actif,flux,evenement,validation}.ts`, `lib/roles.ts`, `lib/routes.ts` + garde ESLint sur les routes en dur, Q12 « En attente Pennylane »                       | C1-C15, J4            | D44-D48     |
| R-UI-5   | [#493](https://github.com/valentin5629/savr-platform/pull/493)              | `FormGrid`, `RadioGroup`, `SectionHeader` (ex-`BlocHeader`), `InfoItem` promu en `ui/`, shell `components/ui/fiche/` (`FicheModal`, `FicheCorps`, `FichePied`, `FicheEnTete`, `OngletAvecErreurs`), `Co2DetailModal` unique, `InviterUtilisateurModal` unique (G5), `packages/shared/src/validation/` (Q8 b) ; `ds-primitives` 63 → 28 | F1-F11, G3-G5         | D49-D54     |
| R-UI-6c  | [#495](https://github.com/valentin5629/savr-platform/pull/495) (2026-10-06) | arbitrages Q3/Q4/Q5/Q6/Q9 appliqués : 10 listes en `PageHero`, 20 écrans en `PageHeader`, `SEUIL_TONNES_KG` unique, `uniteCo2()` / `UNITE_KG_CO2E` dans l'UI, tailles 11/13 px interdites (gate), `rounded-full` → `rounded-savr-full`                                                                                                 | I1, J2, A6            | D55-D58     |
| Q1/Q4/Q7 | cette PR (2026-10-07)                                                       | Q1 : `TypeCollecteBadge` ZD vert / AG navy pour les 3 formes, histogramme des revenus Admin AG navy ; Q4 : rayons du design system Claude Design alignés sur le code (4/8/12/14) ; Q7 : règle « Modal → Sheet sur mobile » retirée (rien à coder)                                                                                      | C2                    | D59-D61     |

Ordre d'exécution réel : 0 → 6a → 6b → 3 → 4a → 4b → 1 → 2 → 5 → 6c → arbitrages (R-UI-1 et R-UI-2 avancés avant R-UI-5 à la demande de Val). Les divergences D1-D61 (libellés métier tranchés par défaut, règles §10 appliquées différemment) sont décrites dans le corps de chaque PR ; à reporter dans `_Divergences/` du Vault (type `ambigu`) via Cowork.

---

## 3. Déplacement des usages

Occurrences JSX dans les écrans (hors tests, hors `ui/`), `pnpm ds:usages`. Une baisse sur une primitive générique est normale : son usage a été absorbé par une primitive plus précise.

| Élément                     |           2026-10-01 | 2026-10-07 | Absorbe                                                            |
| --------------------------- | -------------------: | ---------: | ------------------------------------------------------------------ |
| `Text`                      |                    — |        206 | 290 recettes `text-sm/xs text-savr-neutral-*` (A8, A9)             |
| `Button`                    |                  205 |        129 | → `TextLink` 31, `FormActions` 24, `IconButton` 21 (ex 8)          |
| `InfoItem`                  |                   39 |         90 | `Champ`, `Field`, 14 `<dt>` inline (F5)                            |
| `EmptyState`                |                   26 |         64 | 48 « Aucun… » inline (H4)                                          |
| `AlertBar`                  |                   33 |         63 | 28 bandeaux inline (H2)                                            |
| `Heading`                   |                    — |         57 | 55 h2/h3 faits main (I2)                                           |
| `StatCard`                  |                    1 |         56 | `KpiCockpitCard` 55 + 4 tuiles inline (I6)                         |
| `FormGrid`                  |                    — |         40 | 9 recettes de grille 2 colonnes (F3)                               |
| `SectionHeader`             |      35 (BlocHeader) |         40 | `Bloc` copié ×2, `BlocHeader` ×2 (F4)                              |
| `LoadingState`              |                    — |         39 | 27 « Chargement… » texte, `Skeleton` 38 → 14 (H3)                  |
| `PageHeader` / `PageHero`   |               — / 10 |    24 / 19 | 45 h1 faits main (I1)                                              |
| `Label`                     |                   10 |         27 | 34 `<label>` bruts → 3 restants (F1)                               |
| `Modal`                     |                   33 |         21 | → `ConfirmDialog` 5 + `AnnulationCollecteDialog` 2, `FicheModal` 5 |
| `Badge`                     |                  100 |         82 | → `TypeCollecteBadge` 7, `FactureStatutBadge` 2, `ActifBadge` 10   |
| `FilterBar`                 |                   10 |         14 | 6 façons de construire une barre → 1 (D5)                          |
| `ListFooter` / `Pagination` |                — / 8 |     11 / 0 | 3 habillages de pagination, 50 en dur ×16 (E2)                     |
| `ToggleTypeCollecte`        | 6 (CollecteTypeTabs) |          8 | 4 implémentations du segment ZD/AG (D1)                            |
| `ErrorState`                |                    — |         14 | 0 `error.tsx` de route avant (H5)                                  |
| `ToastProvider`             |                    0 |          1 | ≈ 20 messages inline succès/erreur (H1, B8)                        |
| `Checkbox`                  |                    9 |         15 | 7 checkbox/radio natifs (F2) ; `RadioGroup` 1                      |

---

## 4. Ce qui reste

### 4.1 Lignes de l'inventaire non traitées

| Ligne | Élément                                                             | État 2026-10-07                                                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B7    | CTA d'en-tête « + Nouveau X » : 3 variantes, 4 libellés             | Traité 2026-10-07 : libellé unique « Programmer une collecte » (Q11) sur les dashboards traiteur, agence, gestionnaire, la liste des collectes client et les brouillons ; « Programmer un autre événement » reste sur la page de confirmation (action distincte d'« Ajouter une collecte à cet événement ») |
| B11   | Upload de fichier (3 habillages, 3 implémentations de logo)         | Non traité — `logo-upload.tsx` garde 1 `<button>` et 1 `<label>` ; pas de `ui/file-button.tsx`                                                                                                                                                                                                              |
| D8    | Presets de période dupliqués dans l'export ; défaut dashboard Admin | Défaut Admin confirmé par Val le 2026-10-07 (12 mois calés au 1er du mois) ; presets dupliqués de l'export : lot de clôture                                                                                                                                                                                 |
| G2    | `Sheet` 0 usage, règle §8 « Modal → Sheet sur mobile »              | Soldé 2026-10-07 : règle retirée (Q7), `Sheet` supprimé                                                                                                                                                                                                                                                     |
| H4    | `EmptyDashboardState` parallèle à `EmptyState`                      | Partiel — les 48 inline sont migrés, le composant dashboards reste (6 usages)                                                                                                                                                                                                                               |
| H6    | `OpsReadOnlyBanner` absent de `algo-ag`, `auto-accept`              | Non traité (présent sur `co2`) — vérifier le gating attendu                                                                                                                                                                                                                                                 |
| J1    | 4 modules de dates concurrents, `toLocaleDateString` directs        | Partiel — 24 fichiers appellent encore `toLocaleDateString` / `toLocaleString`                                                                                                                                                                                                                              |
| J2    | Seuil kg → t, graphie CO₂                                           | Traité dans l'UI par R-UI-6c : `SEUIL_TONNES_KG = 10 000`, `uniteCo2()` « kg CO₂e » insécable. Reste les PDF (`attestation-don`, `synthese-dashboard` écrivent « kgCO₂e ») : gabarits versionnés, à traiter dans un lot PDF avec montée de version coordonnée app / renderer                                |
| J5    | Debounce : 3 valeurs, 0 hook                                        | Non traité — pas de `lib/hooks/use-debounce.ts` (les combobox dupliqués B9/B10 ont été supprimés)                                                                                                                                                                                                           |
| J6    | « 12 derniers mois » recalculé dans les routes API                  | Non traité — 4 `setMonth(` dans `app/api`                                                                                                                                                                                                                                                                   |

### 4.2 Primitives sans usage (orphelins)

`Accordion`, `Breadcrumb` et `Sheet` supprimés le 2026-10-07 (décision Val, D63 ; `@radix-ui/react-accordion` retiré), orphelins 14 → 9. Restent : `TourneeCard` (TMS natif = V2), `CardClickable`, `CardDescription`, `CardFooter`, `StatCardGrid`, et les sous-parties Radix `CommandGroup`, `CommandSeparator`, `DropdownGroup`, `PopoverAnchor` utilisées en interne.

### 4.3 Cartes Claude Design sans équivalent dans le code

`Chart`, `Progress`, `Toaster`, `Select` et `DateTimePicker` retirées du design system Claude Design le 2026-10-07 (décision Val) : aucune carte sans équivalent dans le code.

---

## 5. Arbitrages

| #   | Question                                                       | État                                                                                                                                                                               |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Couleur unique du type de collecte                             | **Tranché 2026-10-07** : ZD vert, AG navy, pour toutes les formes du badge et l'histogramme des revenus — D59 (CDC §10 l.140 disait AG orange / ZD navy)                           |
| Q2  | Libellé de l'état inactif                                      | **Confirmé 2026-10-07** : « Inactif » (« Active / Inactive » pour les associations) — D44                                                                                          |
| Q3  | En-tête des écrans non-liste                                   | **Tranché (b) 2026-10-06, appliqué par R-UI-6c** : `PageHero` sur les 18 listes, `PageHeader` ailleurs, 9 exceptions figées — D57                                                  |
| Q4  | Rayons (cards cockpit, échelle DS 6/8/10/14 vs code 4/8/12/14) | **Tranché** : (a) cartes cockpit en `lg` + ombre (2026-10-06, D55) ; échelle du code retenue, tokens Claude Design alignés (2026-10-07, D60)                                       |
| Q5  | Seuil kg → tonnes                                              | **Tranché 2026-10-06, appliqué par R-UI-6c** : 10 000 kg (`SEUIL_TONNES_KG`, CDC §11)                                                                                              |
| Q6  | Graphie CO₂                                                    | **Tranché 2026-10-06** : « kg CO₂e » / « t CO₂e » insécables, appliqué à l'UI par R-UI-6c ; PDF restants (§4.1 J2)                                                                 |
| Q7  | Modal → Sheet sur mobile                                       | **Tranché (b) 2026-10-07** : règle retirée, `Modal` reste centrée sur mobile — D61 (CDC §10 §5.9 et §8 à patcher)                                                                  |
| Q8  | Validation formulaires                                         | **Tranché (b)** : `packages/shared/src/validation/`, pas de zod / react-hook-form                                                                                                  |
| Q9  | Tailles 11 / 13 px                                             | **Tranché (b) 2026-10-06, appliqué par R-UI-6c** : 11/13 px interdites (gate `taille-texte`) ; 10 px (`Text size="3xs"`, sur-titres de `StatCard`) conservé (Val 2026-10-07) — D58 |
| Q10 | Texte courant                                                  | **Tranché (a)** : `components/ui/text.tsx`                                                                                                                                         |
| Q11 | Libellé du CTA vers `/programmer/nouveau`                      | **Tranché 2026-10-07** : « Programmer une collecte » — D62 (CDC §11 et §06.05 / §06.11 écrivent « Programmer un événement »)                                                       |
| Q12 | Libellé statut facture                                         | **Tranché par majorité** : « En attente Pennylane »                                                                                                                                |

Tranché le 2026-10-07 en plus des Q : graphie « Zéro Déchet » partout dans l'app, les exports et la synthèse PDF (D38 → D64, CDC « Zéro-Déchet » à patcher ; CGU et gabarit PDF « Ventilation par flux (Zéro-Déchet) » hors lot), tailles 10 px conservées, défaut de période du dashboard Admin conservé. Reste ouvert : double `<h1>` de `top-bar`, sélecteur ZD/AG par défaut sur les listes. Divergences D59 à D64 à tracer en `_Divergences/` (type `ambigu`, validées par Val).

---

## 6. Garde-fous en place

| Gate                            | Mécanisme                                                                                                                                    |  Baseline | Comment la baisser                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check:ds-classes`              | `scripts/check-ds-classes.ts` sur `app/` + `components/` hors `ui/` et `app/api`                                                             |         1 | corriger `programmer/confirmation/page.tsx`, puis `pnpm check:ratchet --update`                                                                              |
| `check:ds-primitives`           | `scripts/check-ds-primitives.ts` (`<button`, `<select`, `<label`, checkbox, `<table`, `confirm(`, `fixed inset-0`, `.toFixed(` hors SVG/API) |        28 | migrer les 24 `<button>` et 3 `<label>` (B11), l'overlay `app-shell`                                                                                         |
| `check:orphan-ui`               | `scripts/check-orphan-components.ts --ui`                                                                                                    |        14 | brancher ou supprimer Accordion, Breadcrumb, Sheet, TourneeCard, parts Card                                                                                  |
| ESLint `SELECTEURS_DS`          | `eslint.config.js` : `toFixed(` en JSX, routes en dur hors `lib/routes.ts`                                                                   |         — | bloquant                                                                                                                                                     |
| Vitest `design-tokens-existent` | toute classe `savr-*` sans token dans `globals.css` échoue                                                                                   |         — | bloquant                                                                                                                                                     |
| `check:ds-tokens`               | `scripts/ds-tokens-diff.mjs` : `docs/design-system/claude-design/tokens.json` ↔ `@theme`                                                     | 0 diverge | garder à 0 : toute valeur changée dans Claude Design s'applique au code (ou l'inverse) ; les tokens DS-only `spacing-*`, `size-control-*` sont documentaires |
| Tests par primitive             | `components/ui/*.r-ui-*.test.tsx` (R-UI-1 à 6c), `components.m0-8.test.tsx`, `formulaires-ds.test.tsx`                                       |         — | 1 test par nouvelle primitive                                                                                                                                |

---

## 7. Ce qui est centralisé (ne pas toucher)

- Tokens `@theme` complets (couleurs 50-950 + 4 sémantiques étendues, data-viz, rayons, ombres, durées, conteneurs) ; `palette.ts` et `flux.ts` dérivés, 0 hex dans le code.
- 79 primitives `components/ui/` (dont `fiche/`), toutes dans le bundle Claude Design sauf `impersonation-banner-mount` et `impersonation-launcher` (Supabase).
- Libellés métier : `lib/libelles/{facture,pack,organisation,role,tournee,type-collecte,actif,flux,evenement,validation}.ts`, `lib/roles.ts`, `lib/routes.ts`, `lib/statut-collecte-labels.ts`, `lib/statut-tms-labels.ts`, `lib/lieux-labels.ts`, `lib/periodes-raccourcis.ts`.
- Formatage : `lib/format.ts` (`fmtInt`, `fmtDec`, `fmtEuro`, `fmtPct`, `fmtKg`, `fmtKgAuto`, `fmtMontant`, `fmtPax`, `fmtMasse`), `packages/shared/src/validation/`.
- Listes : `lib/pagination.ts`, `useFiltresUrl`, `useListePaginee`, `FilterBar` + `ListFooter` + `DataGrid` états.
- Focus ring unique en `@layer base` + test M0.8-4d ; aucun `<select>` natif, aucun `rgb()`, aucune police hors Nunito.
