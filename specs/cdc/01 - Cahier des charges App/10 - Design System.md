# 10 - Design System

**Inspiration visuelle de référence** : [UAE Design System (designsystem.gov.ae)](https://designsystem.gov.ae/) — système institutionnel, accessible, dense mais aéré. On en reprend la **rigueur** (échelles tonales complètes, focus states forts, sobriété des ombres, pleins blocs de couleur primaire), pas l'identité (couleurs Savr conservées).

---

## Principe directeur

Design System = le langage visuel commun que Claude Code applique sur **tout** l'app. L'objectif n'est pas un rendu "spectaculaire" mais une interface **professionnelle, lisible, cohérente et reconnaissable comme Savr** : chaque écran ressemble à chaque autre sans effort.

> **Objectif anti-générique (NON négociable).** Le risque par défaut d'un build Claude Code = une interface "shadcn brut" qui ressemble à tous les SaaS : neutres gris froids génériques, accent violet, ombres lourdes, radius par défaut, police Inter. La §1bis liste les **leviers de différenciation obligatoires** qui ancrent l'identité Savr. Claude Code ne livre pas un écran sans les avoir appliqués.

Tout passe par des **tokens** (variables CSS + thème Tailwind). Changer une couleur ou une taille = modifier 1 variable, toute l'app suit.

---

## 1. Fondation — Bibliothèque de composants

### Choix retenu : shadcn/ui + Tailwind CSS

**shadcn/ui** : bibliothèque de composants open source construite sur Radix UI (accessibilité) et stylée avec Tailwind.

Pourquoi :

- Accessible clavier + lecteur d'écran (ARIA) sans effort.
- Chaque composant copié dans le projet (pas de dépendance externe versionnée).
- Claude Code maîtrise shadcn/ui — gain de temps.
- Customisable à 100 % via les tokens → **c'est là qu'on injecte l'identité Savr** (shadcn n'est qu'un squelette, le style est à nous).

**Tailwind CSS** : framework utilitaire. Cohérence garantie, pas de CSS parasite. Cible **Tailwind 4.x** (alignement UAE DS v3, tokens exposés via `@theme`).

---

## 1bis. Leviers de différenciation Savr (OBLIGATOIRES)

Ces 8 leviers transforment un build shadcn générique en interface Savr. Chacun est imposé par un token ou une règle, pas laissé au hasard.

| #   | Levier                                 | Règle concrète                                                                                                                                                                                                     |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Neutres tintés navy**                | Pas de gris pur. Les neutres sont **désaturés vers le navy** (cf. §2 échelle `neutral-*`). Donne une cohésion froide-institutionnelle, jamais le `slate`/`zinc` par défaut.                                        |
| 2   | **Bloc primaire plein**                | Sidebar, hero d'écran et bandeaux clés sont des **aplats `primary-700`** texte blanc — signature visuelle institutionnelle (façon AEGOV), pas une nav blanche fade.                                                |
| 3   | **Accent orange parcimonieux**         | L'orange `accent-500` est réservé aux **CTA secondaires, highlights, états "à faire"**. Jamais en aplat de fond large. Sa rareté = sa force.                                                                       |
| 4   | **Focus ring signature**               | Tout élément focusable a un `focus-visible` à **anneau primaire offset** (`outline: 2px solid primary-500; outline-offset: 2px`). Accessibilité = look institutionnel. Jamais le focus bleu navigateur par défaut. |
| 5   | **Ombres sobres + bordures portantes** | Les cards reposent sur **bordure `neutral-200` + fond blanc**, ombre quasi nulle au repos. La hiérarchie vient de la bordure et de l'espace, pas d'ombres lourdes (anti-effet "carte qui flotte" générique).       |
| 6   | **Radius mesuré**                      | Radius `md = 8px` partout (boutons, inputs, cards), `full` uniquement pour badges/avatars/toggles. Pas de `2xl` arrondi "bubble" ni d'angle vif brutaliste.                                                        |
| 7   | **Typo Nunito + display serré**        | Nunito (corps, chaleureux RSE) + titres en **poids 700/800 letter-spacing négatif** (`-0.02em`). Le contraste rondeur-corps / titres serrés est la signature typographique.                                        |
| 8   | **Hover bouton à transition franche**  | Bouton primaire : hover = passage `primary-700 → primary-800` + translation `-1px` (lift discret), transition `150ms`. Pas d'effet d'ombre diffuse générique (reprend la refonte hover AEGOV v3).                  |

> Vérification : un écran qui pourrait passer pour n'importe quel SaaS shadcn = écran non conforme. Au moins les leviers 1, 2, 4, 5 doivent être visibles sur chaque vue.

---

## 2. Tokens de design — Couleurs

### 2.1 Palette de marque — échelles tonales complètes (50 → 950)

Deux couleurs fondatrices Savr, déclinées en **échelle complète** (et non plus 4 nuances) pour permettre profondeur et nuances sans casser la cohérence — pratique reprise du UAE DS.

**Primary — Navy Savr** (base = `primary-700 #223870`)

| Token                 | Valeur    | Usage type                                                       |
| --------------------- | --------- | ---------------------------------------------------------------- |
| `--color-primary-50`  | `#EFF2F9` | Fonds de section discrets, badges, zones primary-subtle          |
| `--color-primary-100` | `#DEE4F2` | Hover sur fonds subtils, séparateurs teintés                     |
| `--color-primary-200` | `#BDC8E5` | Bordures actives, états sélectionnés légers                      |
| `--color-primary-300` | `#92A3D2` | Icônes secondaires sur fond clair                                |
| `--color-primary-400` | `#6379B6` | Liens hover, accents discrets                                    |
| `--color-primary-500` | `#3F5599` | **Focus ring**, états interactifs intermédiaires                 |
| `--color-primary-600` | `#2E4080` | Hover sur boutons primary, liens actifs                          |
| `--color-primary-700` | `#223870` | **PRIMARY** — sidebar, headers, boutons principaux, blocs pleins |
| `--color-primary-800` | `#1B2C57` | Active/pressed des boutons primary                               |
| `--color-primary-900` | `#15213F` | Texte navy sur fond clair, titres de section forte               |
| `--color-primary-950` | `#0D1428` | Aplats sombres profonds, footer                                  |

**Accent — Orange Savr** (base = `accent-500 #FF9B00`)

| Token                | Valeur    | Usage type                                                   |
| -------------------- | --------- | ------------------------------------------------------------ |
| `--color-accent-50`  | `#FFF4E0` | Fonds notifications/alertes légères                          |
| `--color-accent-100` | `#FFE8C2` | Hover fond subtil accent                                     |
| `--color-accent-200` | `#FFD489` | Bordures de chip accent                                      |
| `--color-accent-300` | `#FFB340` | Hover sur éléments accent                                    |
| `--color-accent-400` | `#FFA31A` | États intermédiaires                                         |
| `--color-accent-500` | `#FF9B00` | **ACCENT** — CTA secondaires, highlights, états "à faire"    |
| `--color-accent-600` | `#D97F00` | Hover/active accent, texte accent sur fond clair (contraste) |
| `--color-accent-700` | `#B36400` | Texte accent accessible sur fond clair                       |
| `--color-accent-800` | `#8C4D00` | —                                                            |
| `--color-accent-900` | `#663800` | —                                                            |
| `--color-accent-950` | `#3D2100` | —                                                            |

> ⚠ **Accessibilité accent** : `accent-500` sur blanc ne passe pas AA pour du texte. Pour du **texte** orange sur fond clair, utiliser `accent-700` minimum. `accent-500` reste réservé aux **aplats** (boutons, badges) avec texte blanc/navy dessus.

### 2.2 Palette sémantique

Couleurs système indépendantes du branding — jamais modifiées. Chacune a une variante `subtle` (fond) et `strong` (texte/bordure accessibles).

| Token                    | Valeur    | Usage                                        |
| ------------------------ | --------- | -------------------------------------------- |
| `--color-success`        | `#16A34A` | Collecte réalisée, validation, confirmation  |
| `--color-success-strong` | `#15803D` | Texte succès accessible sur fond clair       |
| `--color-success-subtle` | `#F0FDF4` | Fond badge succès                            |
| `--color-warning`        | `#D97706` | Pack AG faible, retard, attention            |
| `--color-warning-strong` | `#B45309` | Texte warning accessible                     |
| `--color-warning-subtle` | `#FFFBEB` | Fond badge warning                           |
| `--color-error`          | `#DC2626` | Erreur formulaire, collecte annulée, blocage |
| `--color-error-strong`   | `#B91C1C` | Texte erreur accessible                      |
| `--color-error-subtle`   | `#FEF2F2` | Fond badge erreur                            |
| `--color-info`           | `#2563EB` | Information neutre, aide contextuelle        |
| `--color-info-strong`    | `#1D4ED8` | Texte info accessible                        |
| `--color-info-subtle`    | `#EFF6FF` | Fond badge info                              |

> La sémantique reste distincte de la marque : on ne réutilise jamais le navy/orange pour "succès" ou "erreur". Cohérence avec le Design System TMS (`02 - …/10 - Design System TMS`) — mêmes familles sémantiques, échelle App plus large.

### 2.3 Neutres tintés navy (levier #1)

**Pas de gris pur.** Tous les neutres sont légèrement désaturés vers le navy — c'est la cohésion de marque la plus efficace et la moins coûteuse. C'est ce qui distingue immédiatement l'app du `slate`/`zinc` shadcn par défaut.

| Token                 | Valeur    | Usage                                                  |
| --------------------- | --------- | ------------------------------------------------------ |
| `--color-neutral-50`  | `#F7F8FB` | Fond général de l'app (root)                           |
| `--color-neutral-100` | `#EEF0F5` | Fond de page, fonds alternés tableau, hover lignes     |
| `--color-neutral-200` | `#DDE1EB` | **Bordures, séparateurs** (bordure portante des cards) |
| `--color-neutral-300` | `#C3C9D9` | Bordures de champ au repos                             |
| `--color-neutral-400` | `#9AA2B8` | Placeholders, texte désactivé                          |
| `--color-neutral-500` | `#6E7790` | Texte tertiaire, metadata                              |
| `--color-neutral-600` | `#515A72` | Texte secondaire                                       |
| `--color-neutral-700` | `#3C4459` | Labels formulaire, texte secondaire fort               |
| `--color-neutral-800` | `#272D3D` | Texte de corps dense                                   |
| `--color-neutral-900` | `#161A26` | **Texte principal**                                    |
| `--color-neutral-950` | `#0C0F18` | Titres très forts, contrastes max                      |
| `--color-white`       | `#FFFFFF` | Fond des cards, modals, inputs                         |

### 2.4 Palette data-viz (dashboards)

Dérivée de la marque pour cohésion graphique — utilisée pour les courbes/barres des dashboards (`11 - Dashboards`). Ordre d'attribution des séries :

1. `#223870` (navy primary) · 2. `#FF9B00` (orange) · 3. `#3F5599` (navy-500) · 4. `#16A34A` (success) · 5. `#6379B6` (navy-400) · 6. `#D97F00` (accent-600)

> Catégoriel uniquement. Pour les graphes ZD/AG, garder une couleur stable par type (AG = orange, ZD = navy) pour ancrer la lecture.

---

## 3. Tokens de design — Typographie

### 3.1 Police retenue : Nunito (corps) + Nunito Sans titres serrés

Nunito (Google Fonts, gratuite) : formes rondes, chaleureuse, cohérente RSE. Conservée. **Chargement** : Google Fonts (CDN), fallback `system-ui, sans-serif`.

**Signature typographique (levier #7)** : le contraste entre un corps rond et des **titres à letter-spacing négatif** crée une identité immédiate.

- Corps : Nunito, poids 400/500/600, `letter-spacing: 0`.
- Titres (`h1`–`h3`, KPIs) : Nunito poids **700/800**, `letter-spacing: -0.02em`, `line-height: 1.15`.

### 3.2 Échelle typographique

| Token         | Taille | Poids | Tracking | Usage                               |
| ------------- | ------ | ----- | -------- | ----------------------------------- |
| `--text-xs`   | 12px   | 400   | 0        | Labels de badge, metadata           |
| `--text-sm`   | 14px   | 400   | 0        | Texte de tableau, labels formulaire |
| `--text-base` | 16px   | 400   | 0        | Corps de texte principal            |
| `--text-lg`   | 18px   | 500   | 0        | Sous-titres de section              |
| `--text-xl`   | 20px   | 600   | -0.01em  | Titres de page (mobile)             |
| `--text-2xl`  | 24px   | 700   | -0.02em  | Titres de page (desktop)            |
| `--text-3xl`  | 30px   | 700   | -0.02em  | Grands chiffres dashboard (KPIs)    |
| `--text-4xl`  | 38px   | 800   | -0.02em  | Hero d'écran, valeur KPI vedette    |

**Interlignage** : `1.5` corps, `1.15`–`1.2` titres.

---

## 4. Tokens de design — Espacements, formes, mouvement

### 4.1 Spacing (grille de 4px)

Tous les espacements sont des multiples de 4px.

| Token        | Valeur | Usage type                                    |
| ------------ | ------ | --------------------------------------------- |
| `--space-1`  | 4px    | Gap icône/texte                               |
| `--space-2`  | 8px    | Padding interne badge                         |
| `--space-3`  | 12px   | Gap entre éléments de liste                   |
| `--space-4`  | 16px   | Padding card, gap standard                    |
| `--space-6`  | 24px   | Padding section, padding interne card large   |
| `--space-8`  | 32px   | Espacement entre sections                     |
| `--space-12` | 48px   | Espacement entre blocs majeurs                |
| `--space-16` | 64px   | Respiration verticale des hero / écrans aérés |

> **Densité (façon institutionnel aéré)** : préférer `--space-6` au padding interne des cards et `--space-8` entre blocs. Les écrans Savr respirent — anti-effet "tableau de bord compressé".

### 4.2 Largeurs de conteneur

| Token                 | Valeur | Usage                                                       |
| --------------------- | ------ | ----------------------------------------------------------- |
| `--container-content` | 1200px | Largeur max du contenu centré (pages de formulaire, détail) |
| `--container-wide`    | 1440px | Dashboards larges, tableaux multi-colonnes                  |
| `--container-prose`   | 720px  | Contenus textuels longs (aide, CGV, registre)               |

### 4.3 Border radius (levier #6)

| Token           | Valeur | Usage                                   |
| --------------- | ------ | --------------------------------------- |
| `--radius-sm`   | 4px    | Badges carrés, tags, chips              |
| `--radius-md`   | 8px    | **Défaut** — boutons, inputs, cards     |
| `--radius-lg`   | 12px   | Modals, panels, sheets                  |
| `--radius-full` | 9999px | Avatars, toggles, badges-pilule, jauges |

### 4.4 Ombres (levier #5 — sobres)

Les ombres sont **discrètes**. La hiérarchie repose d'abord sur la bordure `neutral-200` et l'espace.

| Token           | Valeur                            | Usage                             |
| --------------- | --------------------------------- | --------------------------------- |
| `--shadow-none` | `none`                            | Cards au repos (bordure seule)    |
| `--shadow-sm`   | `0 1px 2px rgba(13,20,40,0.04)`   | Cards interactives, hover discret |
| `--shadow-md`   | `0 4px 12px rgba(13,20,40,0.08)`  | Dropdowns, popovers               |
| `--shadow-lg`   | `0 12px 28px rgba(13,20,40,0.12)` | Modals, sheets                    |

> Teinte d'ombre = navy (`rgba(13,20,40,…)`), jamais noir pur. Détail subtil mais cohérent avec les neutres tintés.

### 4.5 Mouvement

| Token           | Valeur           | Usage                                 |
| --------------- | ---------------- | ------------------------------------- |
| `--motion-fast` | `120ms ease-out` | Hover, focus, changements d'état      |
| `--motion-base` | `200ms ease-out` | Ouverture dropdown, toast, tab switch |
| `--motion-slow` | `320ms ease-out` | Entrée modal/sheet                    |

> Respecter `prefers-reduced-motion: reduce` → animations désactivées/réduites. Transitions franches, jamais de rebond (`bounce`) ni d'easing fantaisie.

---

## 5. Recettes de composants signature

Les composants viennent de shadcn/ui ; ces recettes définissent **comment on les style Savr** (au-delà du défaut). Trois composants portent l'essentiel de l'identité.

### 5.1 Button (levier #3, #4, #8)

| Variante      | Repos                                                  | Hover                                   | Active                               | Focus-visible                   |
| ------------- | ------------------------------------------------------ | --------------------------------------- | ------------------------------------ | ------------------------------- |
| `primary`     | fond `primary-700`, texte blanc                        | fond `primary-800` + `translateY(-1px)` | fond `primary-800`, sans translation | anneau `primary-500` offset 2px |
| `secondary`   | fond blanc, bordure `neutral-300`, texte `neutral-900` | fond `neutral-100`                      | fond `neutral-200`                   | anneau `primary-500` offset 2px |
| `accent`      | fond `accent-500`, texte `primary-950`                 | fond `accent-600` + `translateY(-1px)`  | fond `accent-600`                    | anneau `accent-600` offset 2px  |
| `destructive` | fond `error`, texte blanc                              | fond `error-strong`                     | fond `error-strong`                  | anneau `error` offset 2px       |
| `ghost`       | transparent, texte `primary-700`                       | fond `primary-50`                       | fond `primary-100`                   | anneau `primary-500` offset 2px |

- Hauteur : 40px (`md`), 44px sur mobile (cible tactile). Padding horizontal `--space-4`/`--space-6`.
- Transition : `--motion-fast` sur `background-color` + `transform`. **Pas** d'ombre diffuse au hover.
- Texte sur `accent-500` = `primary-950` (navy quasi-noir), jamais blanc (contraste).

### 5.2 Card (levier #5)

- Fond blanc, **bordure `1px neutral-200`**, radius `md`, ombre `none` au repos.
- Padding interne `--space-6`.
- Card cliquable : hover → bordure `primary-200` + `--shadow-sm`, transition `--motion-fast`.
- Titre de card : `--text-lg` poids 600, `neutral-900`. Séparation contenu via bordure `neutral-100`, pas d'ombre interne.

### 5.3 Bloc primaire plein (levier #2)

Pattern signature institutionnel — sidebar, hero d'écran, bandeau de page.

- Fond `primary-700` (ou `primary-800` pour la sidebar, plus profonde).
- Texte blanc, libellés secondaires `primary-200`.
- Liens/items actifs : fond `primary-800` + barre accent `accent-500` 3px à gauche (sidebar).
- Icônes en `primary-200`, actives en blanc.

### 5.4 Badge / chip

- Pilule (`radius-full`), `--text-xs`, padding `--space-1`/`--space-2`.
- Statut : fond `{semantic}-subtle` + texte `{semantic}-strong` + point coloré 6px.
- État "à faire/action requise" : fond `accent-50` + texte `accent-700` (seul usage texte de l'orange).

### 5.5 Input / champ

- Fond blanc, bordure `neutral-300`, radius `md`, hauteur 40px.
- Focus : bordure `primary-500` + anneau `primary-500` offset (levier #4).
- Erreur : bordure `error` + `FormError` `error-strong` dessous + icône.
- Label `--text-sm` poids 600 `neutral-700`, au-dessus du champ.

---

## 6. Inventaire des composants UI V1

Composants à implémenter pour couvrir tous les écrans V1, issus de shadcn/ui et stylés selon §5.

### Navigation

| Composant    | Description                           | Usage                            |
| ------------ | ------------------------------------- | -------------------------------- |
| `Sidebar`    | Bloc primaire plein, repliable (§5.3) | Desktop                          |
| `TopBar`     | Barre supérieure mobile, burger menu  | Mobile + tablet                  |
| `BottomNav`  | Navigation bas d'écran (4-5 items)    | Mobile                           |
| `Breadcrumb` | Fil d'Ariane pages imbriquées         | Dashboard → Événement → Collecte |

### Données et tableaux

| Composant    | Description                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| `DataTable`  | Tableau paginé, tri colonne, filtre, recherche. Adaptatif mobile (cards sous 768px) |
| `StatCard`   | KPI : valeur (`--text-3xl`/`4xl`), variation %, label, icône                        |
| `EmptyState` | État vide illustré + CTA                                                            |
| `Badge`      | Pilule statut (§5.4)                                                                |

### Formulaires

| Composant             | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `Input` / `Textarea`  | Champ texte (§5.5), états erreur/succès                |
| `Select` / `Combobox` | Déroulant + autocomplétion (lieux, contacts_traiteurs) |
| `DatePicker`          | Date + créneau heure (programmation collecte)          |
| `Switch` / `Checkbox` | Toggle / case à cocher                                 |
| `FormError`           | Message d'erreur inline                                |

### Actions et feedback

| Composant         | Description                                                     |
| ----------------- | --------------------------------------------------------------- |
| `Button`          | Variantes §5.1 (primary, secondary, accent, destructive, ghost) |
| `IconButton`      | Icône seule (actions tableau)                                   |
| `Dropdown`        | Menu contextuel (kebab)                                         |
| `Modal` / `Sheet` | Dialogue / panel latéral (détail collecte mobile)               |
| `Toast`           | Notification temporaire                                         |
| `Alert`           | Message persistant (warning pack AG, blocage)                   |
| `Tooltip`         | Info-bulle au survol                                            |

### Navigation de contenu

| Composant    | Description                           |
| ------------ | ------------------------------------- |
| `Tabs`       | AG / ZD / Vue consolidée (dashboards) |
| `Pagination` | Entre pages de tableau                |
| `Accordion`  | Contenu dépliable (aide, détails)     |

### Spécifiques Savr

| Composant             | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `StatusCollecte`      | Badge enrichi + timeline de statuts                          |
| `PackAGIndicator`     | Jauge de crédit AG (barre `radius-full` + compteur)          |
| `TourneeCard`         | Card résumé tournée (camion, N collectes, chauffeur, plaque) |
| `ImpersonationBanner` | Bandeau **accent-500** quand Admin impersonne un utilisateur |

---

## 7. États système

Chaque écran gère 5 états — aucun laissé sans UI.

| État         | Description             | Rendu attendu                                                   |
| ------------ | ----------------------- | --------------------------------------------------------------- |
| **Loading**  | Chargement              | Skeleton screens (blocs `neutral-100` animés, forme du contenu) |
| **Empty**    | Aucune donnée           | Illustration + texte + CTA si applicable                        |
| **Error**    | Échec chargement/action | Message précis + bouton "Réessayer"                             |
| **Success**  | Action confirmée        | Toast (disparaît après 4s)                                      |
| **Disabled** | Action impossible       | Bouton grisé + tooltip ("Pack AG épuisé — contacter Savr")      |

**Skeleton** : blocs `neutral-100` animés (shimmer subtil), jamais spinner seul.

**Illustrations d'état vide** : style trait fin Lucide agrandi (ou pictos monochromes `primary-300`), jamais d'illustration 3D/stock générique. Cohérence avec l'iconographie.

---

## 8. Responsive — Breakpoints

Desktop-first, adaptation mobile soignée. Tous les écrans fonctionnent sur mobile sans perte de fonctionnalité.

| Nom       | Largeur    | Comportement                                             |
| --------- | ---------- | -------------------------------------------------------- |
| `mobile`  | < 640px    | Bottom bar, tableaux → cards verticales, sidebar masquée |
| `tablet`  | 640–1024px | Sidebar repliée (icônes), tableaux condensés             |
| `desktop` | > 1024px   | Layout complet, sidebar développée, tableaux complets    |

**Règles** :

- **Navigation** : sidebar → top bar + bottom nav (4 items max, icône + label court).
- **Tableaux** : sous 640px, ligne → card verticale (champs clés visibles, secondaires en accordéon "Voir plus").
- **Formulaires** : champs pleine largeur ; > 6 champs → stepper.
- **Modals** : sur mobile → Sheet (panel montant depuis le bas).
- **Boutons** : hauteur min 44px.
- **Dashboard KPIs** : 1 col mobile / 2 tablet / 3-4 desktop.

---

## 9. Iconographie

**Bibliothèque : Lucide Icons** (open source, compatible shadcn).

~1 000 icônes cohérentes, trait fin, SVG. Stroke `1.5`–`2px`, jamais de mélange avec d'autres familles d'icônes (cohérence = identité).

**Tailles** : `16px` (badges, tables) · `20px` (boutons, nav) · `24px` (actions principales, titres).

**Règle** : toujours un label texte ou un tooltip — jamais d'icône seule, sauf picto universel (corbeille = supprimer).

---

## 10. Accessibilité (transversal)

L'accessibilité n'est pas une option — c'est aussi ce qui donne le rendu institutionnel sérieux (héritage UAE DS).

- **Contraste** : texte AA minimum (4.5:1 corps, 3:1 grands titres). Orange en texte → `accent-700` mini (cf. §2.1).
- **Focus** : `focus-visible` à anneau `primary-500` offset sur **tout** élément interactif (levier #4). Jamais `outline: none` sans remplacement.
- **Cibles tactiles** : 44×44px minimum sur mobile.
- **Clavier** : navigation complète au clavier (hérité Radix/shadcn), ordre de tabulation logique.
- **ARIA** : labels sur icônes seules, `aria-live` sur toasts/erreurs, `aria-current` sur item de nav actif.
- **Reduced motion** : respecter `prefers-reduced-motion`.

---

## 11. Dark mode

Hors scope V1. Les tokens CSS sont structurés pour un thème sombre **sans refonte** : ajouter un second jeu sous `[data-theme="dark"]` (échelles tonales déjà complètes → inversion 50↔950 directe). À évaluer V1.1.

---

## 12. Implémentation — où vivent les tokens

- `app/globals.css` : déclaration des variables CSS sous `:root` (toutes les sections §2–§4) + directive `@theme` Tailwind 4 pour exposer les tokens en classes utilitaires (`bg-primary-700`, `text-neutral-900`, etc.).
- Préfixe Tailwind de marque : classes `savr-*` réservées aux tokens de marque pour éviter toute collision (`savr-primary-700`, `savr-accent-500`). Aligné avec la convention TMS (`tailwind.config.ts` partagé via `packages/shared`).
- Les recettes §5 (Button, Card, bloc primaire, badge, input) sont les **variants** des composants shadcn, définis une fois et réutilisés.

> **Cohérence App ↔ TMS** : l'App (navy `#223870` + orange) et le TMS (vert `#2D7A4B`) gardent des primaires distinctes — décision assumée (App = relation client institutionnelle, TMS = outil terrain logistique). Les **sémantiques, neutres, échelle typo, spacing, radius, focus** sont communs via `packages/shared`. Un seul fichier de tokens partagés, la primaire diffère par thème.

---

## Décisions prises

| Décision                                    | Alternative écartée                     | Raison                                                                                          |
| ------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Structure inspirée UAE Design System        | Statu quo tokens minimaux               | Échelles tonales complètes + focus forts + sobriété = identité institutionnelle, anti-générique |
| Navy `#223870` + orange `#FF9B00` conservés | Bascule vers vert TMS / refonte palette | Décision Val 2026-06-08 : garder l'identité App ; vert reste au TMS                             |
| Neutres tintés navy                         | Gris purs (slate/zinc shadcn)           | Cohésion de marque immédiate, différenciation du défaut                                         |
| shadcn/ui + Tailwind 4.x                    | CSS custom / autre lib                  | Maîtrise Claude Code, accessible, customisable à 100 %                                          |
| Nunito + titres serrés                      | Inter, polices payantes                 | Rondeur RSE + contraste typographique signature                                                 |
| Ombres sobres, bordures portantes           | Ombres lourdes génériques               | Hiérarchie par espace/bordure = rendu pro                                                       |
| Lucide Icons                                | Font Awesome, Heroicons                 | Cohérence shadcn, trait fin                                                                     |
| Dark mode hors scope V1                     | Dark mode V1                            | Tokens déjà compatibles, priorité métier                                                        |

## Questions ouvertes

- Pairing display font pour les titres hero (rester Nunito 800 vs ajouter une font display type "Bricolage Grotesque") — à trancher par itération visuelle pendant le dev.
- Dark mode V1.1 — à évaluer selon retours post-lancement.

## Liens

- [[07 - Architecture technique]]
- [[09 - Authentification et permissions]]
- [[11 - Dashboards]]
- [[06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte]]
- Réf. inspiration : [UAE Design System](https://designsystem.gov.ae/) · [AEGOV DLS GitHub](https://github.com/TDRA-ae/aegov-dls)
- Cohérence : [[02 - Cahier des charges TMS/10 - Design System TMS]]
