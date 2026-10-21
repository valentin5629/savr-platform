# 10 — Design System TMS

**Statut** : V1 rédigée 2026-04-28.
**Périmètre** : référentiel visuel et composants partagés du Savr TMS V1. Section documentaire (option a) — formalise et consolide ce qui est déjà défini dans §07, §11 et les modules fonctionnels. L'évolution UX approfondie (tokens avancés, dark mode, Storybook, audit accessibilité) sera pilotée via **Claude Design** en V1.1+.
**Stack de référence** : Next.js 15 App Router · Tailwind CSS v4 · shadcn/ui · `packages/ui-tms` (monorepo Turborepo).

---

## 1. Objectif et portée

§10 sert de **référentiel unique** pour Claude Code lors du développement du shell UI, des composants partagés et des conventions visuelles du TMS. Il ne re-spécifie pas les écrans détaillés (voir §06 modules + §11 Dashboards) mais fixe les règles qui s'appliquent à toutes les interfaces TMS.

**Ce qui est couvert ici** :
- Palette couleurs (tokens V1)
- Typographie
- Espacement et grille
- Inventaire composants `packages/ui-tms`
- Bibliothèques UI et charts (décisions)
- Principes UX terrain (opérationnel 6h du matin)
- Responsive et accessibilité (consolidation §11 §3.8)

**Ce qui est hors scope V1** :
- Dark mode (V2)
- Storybook / documentation interactive (V1.1+)
- Tokens CSS avancés (CSS custom properties full-system) — géré par Tailwind CSS vars V4
- Audit accessibilité externe (cf. §15)

---

## 2. Palette couleurs

### 2.1 Couleurs primaires et sémantiques

| Token | Valeur HEX | Usage |
|-------|-----------|-------|
| `savr-green` | `#2D7A4B` | Primaire Savr — CTA principaux, liens actifs sidebar, badges succès, statut `acceptee`/`terminee` |
| `savr-green-light` | `#E8F5EE` | Fond cartes succès, hover état actif, badge bg |
| `savr-warning` | `#F59E0B` | Warning — alertes M11 `warning`, badges jaunes, jauges > 85% seuil |
| `savr-warning-light` | `#FEF3C7` | Fond bandeau warning, bg chip warning |
| `savr-critical` | `#DC2626` | Critical — alertes M11 `critical`, jauges saturation, états d'erreur formulaire |
| `savr-critical-light` | `#FEE2E2` | Fond bandeau critical, bg chip critical |
| `savr-info` | `#3B82F6` | Info neutre — badges informationnels, liens secondaires (remplacement ex-`info` M11 Bloc 3 : usage UI uniquement, pas d'alerte) |
| `savr-info-light` | `#EFF6FF` | Fond bg info |

**Note M11** : les alertes TMS n'ont plus que 2 criticités (`warning` / `critical`). La couleur `savr-info` est réservée aux badges UI purement informationnels (ex : statut `en_cours`, tags) — elle ne correspond plus à une criticité d'alerte.

### 2.2 Neutres

| Token | Valeur HEX | Usage |
|-------|-----------|-------|
| `neutral-950` | `#0A0A0A` | Texte principal |
| `neutral-700` | `#404040` | Texte secondaire, libellés |
| `neutral-400` | `#A3A3A3` | Placeholder, texte désactivé |
| `neutral-200` | `#E5E5E5` | Bordures, séparateurs |
| `neutral-100` | `#F5F5F5` | Fond cartes secondaires, hover lignes tableau |
| `neutral-50` | `#FAFAFA` | Fond page (background root) |
| `white` | `#FFFFFF` | Fond cartes principales, modals |

### 2.3 Statuts dispatch (couleurs de statut `collectes_tms.statut_dispatch`)

Utilisées dans les badges de statut sur les tables M02, M03, M04, M05 :

| Statut | Couleur texte | Couleur bg |
|--------|--------------|-----------|
| `a_attribuer` | `neutral-700` | `neutral-100` |
| `attribuee` | `savr-info` | `savr-info-light` |
| `acceptee` | `savr-green` | `savr-green-light` |
| `en_cours` | `savr-info` | `savr-info-light` |
| `terminee` | `savr-green` | `savr-green-light` |
| `annulee_par_traiteur` | `neutral-400` | `neutral-100` |
| `refusee` | `savr-critical` | `savr-critical-light` |
| `rejetee_tms` | `savr-critical` | `savr-critical-light` |

### 2.4 Palette Tailwind

Les tokens ci-dessus sont déclarés comme couleurs custom dans `tailwind.config.ts` (ex: `text-savr-green`, `bg-savr-warning-light`). Pas de tokens CSS custom properties séparés V1 — Tailwind CSS vars V4 gère la résolution.

---

## 3. Typographie

**Police** : **Inter** (Google Fonts, subset latin). Chargée via `next/font/google` (auto-optimisé, pas de layout shift).

| Rôle | Classe Tailwind | Taille | Poids | Usage |
|------|----------------|--------|-------|-------|
| Page title | `text-2xl font-semibold` | 24px | 600 | Titre de page (H1 unique par page) |
| Section title | `text-lg font-semibold` | 18px | 600 | Titre de section, widget header (H2) |
| Card label | `text-sm font-medium` | 14px | 500 | Labels KPI, en-têtes colonnes tableau |
| Body | `text-sm font-normal` | 14px | 400 | Texte courant, descriptions |
| Caption | `text-xs font-normal` | 12px | 400 | Méta-données, timestamps, notes |
| KPI value | `text-3xl font-bold` | 30px | 700 | Valeur principale KPI (`<KPICard />`) |
| Badge | `text-xs font-medium` | 12px | 500 | Badges statut, chips |
| Button | `text-sm font-medium` | 14px | 500 | Libellé bouton (shadcn/ui default) |

**Contrainte terrain** : la taille minimale de texte interactif est **14px** (lisibilité 4G, conditions lumière extérieure). Aucun texte fonctionnel sous 12px.

---

## 4. Espacement et grille

Tailwind spacing scale standard (base 4px). Conventions TMS :

| Élément | Valeur | Classe |
|---------|--------|--------|
| Padding carte (KPICard, widget) | 24px | `p-6` |
| Gap grille dashboards | 16px | `gap-4` |
| Padding page (container) | 32px horizontal | `px-8` |
| Padding sidebar interne | 16px | `px-4` |
| Hauteur header | 56px | `h-14` |
| Largeur sidebar déployée | 240px | `w-60` |
| Largeur sidebar repliée | 64px | `w-16` |
| Hauteur bandeau impersonation | 32px | `h-8` |
| Rayon bordure carte | 8px | `rounded-lg` |
| Rayon bordure bouton | 6px | `rounded-md` |

**Grille dashboards** : CSS Grid via Tailwind `grid-cols-*`. Pattern courant = 4 colonnes desktop (≥ 1280px), 2 colonnes laptop (1024-1279px), 1 colonne tablette (768-1023px). Chaque dashboard définit sa propre grille dans son composant page — pas de grille globale rigide.

---

## 5. Composants `packages/ui-tms`

Package partagé dans le monorepo Turborepo (`packages/ui-tms`). Importé par les apps `apps/tms-web` (dashboard) et `apps/tms-mobile` (PWA chauffeur). Construit sur **shadcn/ui** (base) + customisations Savr.

### 5.1 Inventaire V1

| Composant | Props clés | Usage principal |
|-----------|-----------|-----------------|
| `<KPICard />` | `label`, `value`, `unit?`, `delta?`, `sparkline?`, `loading?` | D1 Z2, D3, D4, D5, D7, D8 — valeur KPI + variation % + sparkline optionnelle |
| `<TuileJauge />` | `label`, `value`, `max`, `seuil_warning?`, `seuil_critical?`, `loading?` | D6 entrepôt, D1 Z4 — jauge circulaire % avec couleur dynamique selon seuils |
| `<DataTable />` | `columns`, `data`, `pagination?`, `filters?`, `onRowClick?`, `loading?` | D2, D3, D4, D8, D9, D10, D14 — table paginée 50 lignes, tri colonne, filtres header |
| `<AlerteBandeau />` | `criticite`, `message`, `onAck?`, `onSnooze?`, `onResolve?` | D1 Z1, D2, D13 — bandeau alerte avec actions inline |
| `<StatutBadge />` | `statut` (enum `statut_dispatch`), `size?` | Partout — badge coloré selon palette §2.3 |
| `<DashboardExportButton />` | `slug`, `formats` (`csv` / `pdf` / les deux) | Tous dashboards avec export — bouton standardisé, nommage `tms_{slug}_{date}.{ext}`, audit `EXPORT_DASHBOARD` |
| `<HeaderBellNotifications />` | `userId`, `role` | Header global — cloche alertes M11, badge nombre, dropdown 10 dernières |
| `<ChartBar />` | `data`, `xKey`, `yKey`, `color?`, `loading?` | D3, D7, D11 — wrapper Recharts BarChart palette Savr |
| `<ChartLine />` | `data`, `xKey`, `yKeys[]`, `colors?`, `loading?` | D3, D4, D7 — wrapper Recharts LineChart multi-séries |
| `<ChartPie />` | `data`, `nameKey`, `valueKey`, `colors?` | D3, D7 — wrapper Recharts PieChart/RadialBar |
| `<LoadingSkeleton />` | `type` (`kpi` / `table` / `chart` / `card`) | Tous — squelette chargement typé avant fetch résolu |
| `<PageHeader />` | `title`, `breadcrumb[]`, `actions?` | Toutes pages — titre H1 + breadcrumb + slot actions droite |
| `<EmptyState />` | `icon?`, `title`, `description`, `action?` | Tables vides, dashboards sans données |
| `<ConfirmDialog />` | `title`, `description`, `onConfirm`, `destructive?` | Actions irréversibles (suppression, désactivation) — wraps shadcn/ui `AlertDialog` |

### 5.2 Règles d'implémentation

- Tous les composants exposent une prop `loading?: boolean` → affiche `<LoadingSkeleton type={...} />` automatiquement. Pas de spinner inline dans chaque composant.
- Tous les composants gèrent un état `error?: string` → affiche un `<EmptyState />` d'erreur.
- Props `data` : toujours typées via les types partagés `packages/shared/types`. Pas de `any`.
- Les wrappers Recharts (`ChartBar`, `ChartLine`, `ChartPie`) appliquent automatiquement la palette `savr-*` définie en `tailwind.config.ts` via les couleurs CSS résolues. Pas de couleurs hardcodées dans les composants.

---

## 6. Bibliothèques UI — décisions

### 6.1 Composants de base

**shadcn/ui** (Radix UI primitives + Tailwind) — choix définitif V1 (cf. §07 T.7.2). Composants utilisés : `Button`, `Input`, `Select`, `Dialog`, `AlertDialog`, `Sheet`, `Tabs`, `Badge`, `Skeleton`, `Toaster`, `DropdownMenu`, `Command` (recherche), `Calendar` (date pickers M07/M08).

### 6.2 Charts

**Recharts** — choix définitif V1. Raisons : déjà dans stack React standard, bundle raisonnable (~120 Ko gzip), suffisant pour les charts TMS (bar, line, pie, radial). Les composants `<Chart* />` de `packages/ui-tms` en sont des wrappers — migration vers une autre lib ne nécessite de modifier que ces wrappers.

**Tremor** (option évaluée §11 QO5) → **rejeté V1**. Plus adapté aux dashboards analytics consumer ; shadcn/ui + Recharts couvre 100% des besoins TMS V1 sans dépendance supplémentaire.

**V1.1+** : si les dashboards financiers (D3/D4) demandent des charts plus sophistiqués (waterfall, heatmap, scatter), évaluer Visx ou Nivo. Décision à date selon besoins réels terrain.

### 6.3 Tables

`<DataTable />` interne (basé sur **TanStack Table v8**) — pas de lib table externe. Raisons : flexibilité tri/filtres/pagination, typed, intégration naturelle avec shadcn/ui.

### 6.4 Formulaires

**React Hook Form** + **Zod** (schémas de validation). Standard shadcn/ui. Tous les formulaires TMS (M06 prestataires, M07 ajustements, M08 factures, M13 paramètres) utilisent ce pattern.

### 6.5 Icônes

**Lucide React** — cohérent avec shadcn/ui, tree-shakable. Pas d'autre librairie d'icônes V1.

---

## 7. Principes UX terrain

Le TMS est utilisé en conditions opérationnelles : Ops Savr à 6h du matin, chauffeurs en 4G à l'extérieur d'un camion, managers prestataires depuis un bureau.

### 7.1 Lisibilité avant esthétique

- Contraste texte/fond ≥ 4.5:1 sur toutes les surfaces (WCAG 2.1 AA — cf. §11 §3.8). Les couleurs `savr-*` de la palette §2 respectent ce ratio.
- Taille texte fonctionnel minimum 14px (cf. §3 Typographie).
- Densité information élevée sur les tables et dashboards Ops — pas de whitespace excessif. 50 lignes par page `<DataTable />` (pas de pagination à 10 lignes).
- États vides explicites (`<EmptyState />`) : toujours un message clair + action possible. Jamais de table vide sans contexte.

### 7.2 Actions critiques protégées

Toute action irréversible (suppression, déverrouillage tournée, désactivation user, bascule mode migration) passe par `<ConfirmDialog destructive />`. Libellé du bouton de confirmation = action exacte, pas "OK" (ex : "Déverrouiller la tournée", "Désactiver cet utilisateur").

### 7.3 Feedback immédiat

- Toutes les actions serveur (mutations) affichent un état `loading` sur le bouton déclenché (spinner + désactivation) pendant la requête.
- Résultat : `<Toaster />` shadcn/ui (succès vert, erreur rouge, warning orange). Durée : 4s succès, 8s erreur (assez long pour être lu en conditions terrain).
- Les mutations critiques (pesée, clôture tournée, rapprochement facture) logguent un `audit_log` côté serveur indépendamment du toast client.

### 7.4 Offline et connectivité (PWA chauffeur uniquement)

Applicable uniquement à `apps/tms-mobile` (M05). Le shell desktop `apps/tms-web` ne gère pas l'offline — connexion requise. Si déconnecté, banner `<AlerteBandeau criticite="warning" message="Connexion perdue — données en attente de synchronisation" />` dans le layout desktop.

### 7.5 Performance perçue

- `<LoadingSkeleton />` systématique avant résolution des fetches. Jamais de page blanche.
- Les dashboards à polling (§11 §3.5) ne re-rendent que les composants impactés (React Query `staleTime` configuré par dashboard).
- Shell (header + sidebar + layout) rendu côté serveur (Next.js Server Components). Aucun layout shift au chargement.

---

## 8. Responsive et accessibilité (consolidation §11 §3.8)

### 8.1 Breakpoints

| Breakpoint | Largeur | Comportement |
|-----------|---------|--------------|
| Desktop | ≥ 1280px | Sidebar 240px déployée, grille 3-4 colonnes, toutes zones visibles |
| Laptop | 1024–1279px | Sidebar 64px repliée par défaut, grille 2 colonnes, zones empilées si nécessaire |
| Tablette | 768–1023px | Sidebar masquée (drawer bouton hamburger), 1 colonne, KPIs grille 2×N |
| Mobile desktop | < 768px | Non supporté pour `apps/tms-web`. Message d'erreur "Utiliser un écran ≥ 768px" |

**PWA chauffeur** (`apps/tms-mobile`) : mobile-first, conçue pour 375–428px (iPhone SE → iPhone 15 Pro Max). Cf. §12 pour les specs détaillées.

### 8.2 Accessibilité (WCAG 2.1 AA visé, non certifié V1)

- Contraste ≥ 4.5:1 texte/fond (cf. §2 palette).
- Navigation clavier complète : focus visible sur tous éléments interactifs (ring Tailwind `focus-visible:ring-2`).
- Labels ARIA sur composants custom (`<TuileJauge />`, `<ChartBar />`, `<KPICard />`).
- Rôles ARIA corrects : tables (`role="table"`), dialogs (`role="dialog"`), alertes (`role="alert"` pour `<AlerteBandeau criticite="critical" />`).
- Pas d'audit externe V1 (cf. §15). Audit interne par Val lors des recettes.

---

## 9. Évolution — Claude Design (V1.1+)

**Décision D1** : §10 V1 est documentaire. L'évolution UX du TMS sera pilotée via **Claude Design** à partir de V1.1, une fois les premiers retours terrain collectés (Ops Savr + Strike/Marathon). Périmètre Claude Design V1.1 :
- Tokens CSS complets (dark mode, theming)
- Storybook composants `packages/ui-tms`
- Audit accessibilité WCAG
- Optimisations mobile PWA (M05)
- Éventuellement : remplacement Recharts si besoins charts avancés

§10 ne sera pas re-rédigé pour V1.1 — il sera enrichi via des addendums datés, comme les autres sections du CDC.

---

## 10. Décisions prises

| ID | Décision | Alternative écartée | Justification |
|----|---------|--------------------|----|
| D1 | §10 documentaire V1, évolution via Claude Design | Design System complet Storybook V1 | 15 utilisateurs max V1, retours terrain nécessaires avant investissement UX profond |
| D2 | Inter comme police unique | Geist (Vercel), DM Sans | Lisibilité prouvée, shadcn/ui default, lisence open |
| D3 | Recharts comme lib charts | Tremor (rejeté), Visx (V2) | Suffisant V1, bundle raisonnable, wrappers isolent la migration future |
| D4 | TanStack Table v8 pour `<DataTable />` | AG Grid (overkill), react-table v6 (legacy) | Typed, flexible, bundle maîtrisé |
| D5 | Lucide React icônes | Heroicons, Phosphor | Cohérence shadcn/ui, tree-shakable |
| D6 | Couleur `savr-info` (`#3B82F6`) réservée UI uniquement | 3ème criticité alerte | Aligné décision M11 Bloc 3 : enum `alerte_criticite` 2 valeurs uniquement |

---

## 11. Références

- [[11 - Dashboards TMS]] — patterns refresh, routes, composants partagés, responsive (§3.7/§3.8)
- [[07 - Architecture technique TMS]] — stack technique (Next.js 15, shadcn/ui, Tailwind, monorepo)
- [[12 - App mobile chauffeur]] — PWA chauffeur, offline-first, responsive mobile
- [[15 - Sécurité et conformité TMS]] — accessibilité, audit external
- [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]] — canaux alertes, criticités, catalogue codes
