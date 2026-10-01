# Rationalisation UI — inventaire des éléments à centraliser

**Date** : 2026-10-01 · **Périmètre** : `packages/plateforme/src/{app,components,lib}` (67 pages, 109 fichiers tsx d'écran, 55 primitives `components/ui/`) · **Référence** : CDC §10 Design System (`specs/cdc/01 - Cahier des charges App/10 - Design System.md`).

**Objectif** : pour chaque élément d'interface, désigner **une source unique** (un fichier) telle que la modifier change tous les écrans. Chaque ligne porte une colonne `Décision` à remplir par Val : `OK` (faire tel quel), `MODIF` (faire avec la variante notée), `NON` (écarter).

**Lecture rapide** :
- État sain : tokens `@theme` complets, 55 primitives `ui/`, `Button` 205 usages, `FormField` 187, `Card` 129, `Badge` 100, `DataGrid`/`DataTable` 42, `Combobox` 36, 0 `<select>` natif.
- Dette : **≈ 50 points de rationalisation** (tableau ci-dessous), dont **8 bugs réels** (§1) et **6 primitives existantes jamais branchées** (Toast, Sheet, `Button variant="link"`, `Combobox titre`, `FilterBar.tabs/toggle`, `StatCard`).
- Cause racine : aucun gate ne refuse un `<button>` brut, une classe `red-50` ou un `confirm()`. Les primitives existent, rien n'impose de les utiliser. Le §5 propose les garde-fous.

---

## 1. Bugs à corriger immédiatement (indépendants de toute décision)

| # | Bug | Occurrences | Fichiers | Correctif |
|---|---|---|---|---|
| B1 | Classes vers des **tokens inexistants** `text-savr-success-600` / `text-savr-error-600` : aucun style produit | 6 | `components/collectes/plaque-tms-picto.tsx:19`, `components/compte/changer-mot-de-passe-panel.tsx:91,94`, `app/(admin)/admin/parametres/co2/page.tsx:354,361`, `components/admin/collecte-detail-panel.tsx:1238` | `-strong` |
| B2 | **Enums DB affichés bruts** dans un `<Badge>` (`payee`, `epuise`, `traiteur_manager`, `type_vehicule_max`…) | ≈ 15 | statut facture ×4 (`gestionnaire/mon-organisation:200`, `agence/mon-organisation/factures-table:45`, `traiteur/mon-organisation-client:968`, `collecte-detail-panel:2133`), statut pack ×3 (`mon-pack-ag:121`, `clients/[id]:228,657`), SIRET ×2, rôle ×2, `lieux/[id]:214`, `collecte-detail-panel:1458,1653`, `evenements/[id]:271` | passer par les modules libellés (§2-C) |
| B3 | `<Link><Button>` imbriqué = HTML invalide | 1 | `app/(admin)/admin/collectes/page.tsx:535` | `Button asChild` |
| B4 | Boutons icône **sans `aria-label`** (« ← » textuel, `size="icon"`) | 3 | `gestionnaire/traiteurs/[id]:71`, `gestionnaire/evenements/[id]:164`, `admin/attributions-ag/[collecteId]:343` | `IconButton` |
| B5 | Modale maison non accessible (`fixed inset-0 bg-black/40`, pas de `role="dialog"`, pas de focus-trap) — doublon fonctionnel de `clients/[id]/invite-user-modal.tsx` | 1 | `app/(admin)/admin/settings/users/invite-user-modal.tsx:114` | remplacer par la version `<Modal>` |
| B6 | `toFixed()` affiché à l'écran = **point décimal anglais** (`12.5 %`) | ≈ 10 | `gestionnaire/traiteurs:116`, `traiteurs/[id]:110`, `evenements/[id]:299`, `organisateur/collectes:110`, `gestionnaire/lieux`, `co2:357` | `fmtDec` |
| B7 | Montants factures **non formatés** (`${f.montant_ttc} €`) | 3 | `gestionnaire/mon-organisation:193`, `traiteur/mon-organisation-client:961`, `agence/factures-table:39` | `fmtEuro` |
| B8 | Message unique succès/erreur rendu en gris neutre : indiscernables | 4 | `traiteur/mon-organisation-client:270,838,922`, `gestionnaire/mon-organisation:466` | Toast (§2-H1) |

---

## 2. Catalogue des éléments à rationaliser

Légende `État` : **C** centralisé · **P** partiel (primitive existe, contournée) · **N** non centralisé.

### A. Fondations et tokens

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| A1 | Couleurs palette Tailwind brute (`red-50`, `amber-800`, `neutral-500`…) | P | 88 classes / 12 fichiers (`factures/[id]` 23, `attributions-ag` 10, `auto-accept` 6) | `app/globals.css` (seules classes `savr-*`) | 70 des 88 disparaissent avec H2 (AlertBar). Reste : `text-neutral-*` de `factures/[id]` → `savr-neutral-*` | |
| A2 | Rayons hors token (`rounded-md/lg/full/sm`, `rounded` nu) | P | 54 / 29 fichiers | tokens `--radius-savr-*` | remplacement mécanique ; `rounded-full` → `rounded-savr-full` | |
| A3 | Ombres hors token | P | 5 | `--shadow-savr-*` | mécanique | |
| A4 | **Hex en dur** dans le code | N | 107 / 16 fichiers, dont `palette.ts` 28, `flux.ts` 9, `DOT` copié ×5 | `components/dashboards/charts/cockpit/palette.ts` + `flux.ts` **dérivés** de `globals.css` | 1 fichier de miroir JS des tokens (`lib/design-tokens.ts`) importé par palette/flux ; supprimer les 5 `DOT` et `OPS_DOT` ; `var(--color-savr-*)` en `style` quand c'est possible | |
| A5 | Tokens shadcn hors DS (`bg-muted`, `text-muted-foreground`) | N | 3 | — | remplacer par `savr-neutral-*` | |
| A6 | Tailles de texte arbitraires (`text-[13px]`, `[11px]`, `[10px]`) | N | 90 (34 / 28 / 11) | échelle §3.2 ou nouveaux tokens `--text-2xs` | arbitrage : ajouter `2xs = 11px` et `13px` à l'échelle, ou interdire | |
| A7 | Durées de transition arbitraires (`duration-[120ms]`, `duration-150`) | N | 15 ; `--motion-savr-*` défini mais 0 usage | `globals.css` `--motion-savr-fast` | exposer en utilitaire (`transition-savr-fast`) et migrer | |
| A8 | Recettes typographiques texte courant (`text-sm text-savr-neutral-500` ×95, `text-xs text-savr-neutral-500` ×76, 3 gris concurrents 400/500/600 pour le même rôle) | N | 10 recettes = 290 occurrences | nouveau `components/ui/text.tsx` (`<Text variant="muted|hint|label|caption">`) ou classes utilitaires `@utility text-savr-muted` dans `globals.css` | arbitrage composant vs utilitaire | |
| A9 | Sur-titres majuscules | N | 4 recettes concurrentes | idem A8 (`variant="overline"`) | | |
| A10 | Spacing `--spacing-savr-*` défini, 0 usage (`p-savr-4` jamais écrit) | — | — | — | supprimer les tokens spacing inutiles ou les adopter ; décision de principe | |

### B. Boutons, actions et liens

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| B1 | **État chargement des boutons** : `disabled={x}` + ternaire `{x ? 'Enregistrement…' : 'Enregistrer'}`, 15 verbes, 3 spinners maison, 5 boutons désactivés sans retour visuel, 0 `aria-busy` | N | 52 / 31 fichiers | `components/ui/button.tsx` prop `loading` (+ `loadingText?`) | ajouter prop + spinner Lucide `Loader2` + `aria-busy` ; migrer les 52 | |
| B2 | **Liens texte** : 2 couleurs (`primary-600` / `-700`), 2 soulignements, 3 tailles, constante locale `authLienClass` ; `Button variant="link"` existe, **0 usage** | P | 34 (20 `<a>`/`Link`, 6 `authLienClass`, 8 `<button>` link-like) | `components/ui/button.tsx` variant `link` ou nouveau `components/ui/text-link.tsx` | choisir une recette (couleur, soulignement) et migrer | |
| B3 | **Variantes destructives secondaires** : `ghost` + `className="text-savr-error"`, `secondary` + `ACTION_DESTRUCTIVE_CONTOUR` (constante rangée dans `components/collecte/fiche-blocs.tsx:280`), contour warning, `hover:bg-red-50` | N | 9 overrides, 4 rendus | `button.tsx` variants `ghost-destructive`, `outline-destructive`, `outline-warning` | ajouter 3 variants, supprimer la constante | |
| B4 | **Icône seule** hors `IconButton` (`<button>` brut ou `Button size="icon"`) : tailles h-6 / h-9 / h-11, 2 couleurs de survol destructif | P | 13 (`IconButton` n'est utilisé que dans 2 fichiers) | `components/ui/icon-button.tsx` | migrer ; retirer `size="icon"` de Button (doublon) | |
| B5 | **Pied de modale / rangée d'actions** : `flex justify-end gap-2 …` recopié, position Annuler incohérente (gauche en modale, droite dans 6 formulaires inline), 2 libellés (« Annuler » ×27, « Retour » ×7), variantes `secondary` ×25 / `ghost` ×2 | P | 8 pieds recopiés dans le corps + 6 rangées inline + 33 `Modal` | nouveau `components/ui/form-actions.tsx` (`<FormActions cancel submit loading />`) utilisé par `Modal.footer` et les formulaires | règle §5.5 (8) : secondaire puis primaire, à droite | |
| B6 | Marge `mr-*` sur l'icône dans un `Button` (double le `gap-2` de base) | — | ≈ 24 | `button.tsx` (`[&>svg]:h-4 [&>svg]:w-4`) | retirer les `mr-*`, poser la taille d'icône dans la variante | |
| B7 | **CTA d'en-tête « + Nouveau X »** : 3 variantes (accent 4 / primary 8 / secondary 1), 2 mises en page, **4 libellés pour la même route** `/programmer/nouveau`, 7 `<a>` internes au lieu de `Link` | P | 13 (4 via `PageHero.actions`) | `PageHero.actions` + règle : CTA d'en-tête = `accent` | généraliser PageHero (I1) ; libellé unique « Programmer une collecte » | |
| B8 | **Retour de page** : 5 recettes (« ← » textuel, ArrowLeft brut blanc sur navy, Link gris Tailwind, `<a>` souligné) | N | 7 | `components/ui/breadcrumb.tsx` existant ou nouveau `BackLink` dans `page-hero.tsx` (`back?: {href,label}`) | 1 pattern | |
| B9 | **Déclencheur combobox dupliqué** (`lieu-combobox`, `contact-combobox` : copie des classes d'Input + Popover maison + `<input>` brut, 0 debounce) | N | 2 composants, 3 usages | `components/ui/combobox.tsx` | réécrire sur `Combobox` (slot « + Ajouter… » à ajouter) | |
| B10 | Action ghost « + Ajouter… » dans un menu | N | 2 | `combobox.tsx` prop `onCreate` | | |
| B11 | Labels stylés en bouton d'upload : 3 recettes + 1 `<input type="file">` nu ; **3 implémentations d'upload de logo** | N | 4 | `components/admin/logo-upload.tsx` → promouvoir en `components/ui/file-button.tsx` | 1 composant | |

### C. Badges et libellés d'enums (source unique de vérité métier)

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| C1 | **Statut collecte** : type défini ×2 (`StatutCollecteDb`, `CollecteStatutEnum`), libellés divergents dans `lib/exports/shared.ts:95` (« Réalisée sans collecte » vs « Sans excédents », « Brouillon » vs « Créée »), ordre des étapes défini ×3 (`status-collecte.tsx STEP`, `collecte-statut-frise.tsx ETAPES`, `friseStatutClient`) | P | 5 définitions | `lib/statut-collecte-labels.ts` (déjà source officielle) | y rapatrier type, étapes et export CSV ; `collecte-statut-frise` consomme | |
| C2 | **Type collecte ZD/AG** : ≈ 13 mappings libellés, 3 graphies (« Zéro Déchet », « Zéro-Déchet », « ZD »), **4 codes couleur contradictoires** (`TypeCollecteBadge` ZD vert/AG ambre ; `BadgeTypeCollecte` ZD navy/AG orange ; `transporteurs:179` AG action/ZD primary ; `sous-bloc-collecte` ZD vert/AG primary) | N | 13 + 2 composants badge | nouveau `lib/libelles/type-collecte.ts` + **un seul** `components/ui/type-collecte-badge.tsx` | **arbitrage couleur** : proposition = ZD navy `primary`, AG orange `action` (cohérent §2.4 « AG = orange, ZD = navy ») | |
| C3 | **Statut facture** : 4 définitions (`factures/page:52` = copie exacte `clients/[id]/onglets:211`), 2 libellés (« En attente » / « En attente Pennylane »), 5 listes d'options filtre | N | 4 + 2 | nouveau `lib/libelles/facture.ts` + `components/ui/facture-statut-badge.tsx` | corrige B2 | |
| C4 | **Type facture** : 4 définitions, libellés courts vs longs | N | 4 | `lib/libelles/facture.ts` | | |
| C5 | **Statut / type pack AG** : variant sans libellé (`STATUT_PACK_BADGE`), libellé brut affiché, `PACK_LABELS` vs `TYPE_LABELS` divergents | N | 4 | nouveau `lib/libelles/pack.ts` | | |
| C6 | **Actif / Inactif** : 11 rendus manuels, **3 libellés** (« Inactif », « Désactivé », « Suspendu ») | N | 11 / 3 | nouveau `components/ui/actif-badge.tsx` | **arbitrage libellé** unique | |
| C7 | **Rôle utilisateur** : 4 mappings (« Gestionnaire lieux » vs « Gestionnaire de lieux »), 3 types `Role`/`StaffRole`×2, test `admin_savr || ops_savr` écrit sur **41 lignes / 34 fichiers** | N | 4 + 41 | nouveau `lib/roles.ts` (`ROLE_LABELS`, `isStaff()`, types) | | |
| C8 | **Type organisation** : 4 mappings, 3 libellés pour `gestionnaire_lieux` | N | 4 | `lib/libelles/organisation.ts` | | |
| C9 | **Vérification SIRET** : `SIRET_BADGE` + ternaire divergent ignorant `en_attente`/`echec` | N | 2 | `lib/libelles/organisation.ts` | | |
| C10 | **Lieux** (difficulté, véhicule) : `lib/lieux-labels.ts` **copié intégralement** dans `admin/lieux/page.tsx:36-50` + 3e copie `TYPE_VEHICULE_LABELS` | P | 3 | `lib/lieux-labels.ts` (existe) | supprimer les copies | |
| C11 | **Type TMS** : 2 mappings | N | 2 | `lib/statut-tms-labels.ts` (existe) | | |
| C12 | **Flux déchets** : libellés ×5 (« Carton » vs « Cartons »), ordre ×5, couleurs ×2 | P | 12 | `components/dashboards/flux.ts` → déplacer en `lib/libelles/flux.ts` (libellé + ordre + couleur) | registre, exports, API consomment | |
| C13 | **Statut événement consolidé** : dérivé ×3 (API, export, filtre) | N | 3 | `lib/libelles/evenement.ts` | | |
| C14 | Taille de `Badge` surchargée (`text-xs` ×18, `text-[11px]` ×4, `text-[10px]`) | P | 23 | `badge.tsx` prop `size="sm"` | | |
| C15 | Compteur rouge (nav, onglets, table) : 3 recettes | N | 3 | `badge.tsx` variant `count` | | |

### D. Filtres, recherche, segmentation

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| D1 | **Segment ZD/AG** : 4 implémentations (`CollecteTypeTabs` ×6 usages = clone de `ToggleGroup` sans clavier, pilules `aria-pressed` admin collectes, `ToggleGroup` ×1, `FiltreCoches` Type). Admin collectes : **4 contrôles pour le même filtre** sur un écran | P | 4 / 8 fichiers | `components/ui/toggle-group.tsx` | supprimer `CollecteTypeTabs` ; admin collectes : 1 seul contrôle | |
| D2 | Segment Programmées / Historique : pilules maison (admin) vs `Tabs` dans `FilterBar.tabs` (client) | P | 2 | `FilterBar.tabs` + `Tabs` | aligner admin collectes | |
| D3 | Pastilles statut alertes : pilules maison hors tokens (`bg-neutral-100 text-white`, pas de `type="button"`) | P | 1 | `components/ui/filter-chips.tsx` | | |
| D4 | Onglets soulignés maison `tabCls` **copié à l'identique** dans les 2 `mon-organisation`, sans `role="tab"` | P | 7 boutons / 2 fichiers | `components/ui/tabs.tsx` | | |
| D5 | **6 façons de construire une barre de filtres** (A `FilterBar`+état local, B composant métier, C `DashboardFilterBar`+localStorage, D `BarreFiltres` seul, E boutons maison, F `MultiSelectFilter` libellé au-dessus) ; « Réinitialiser » absent sur 5 écrans / 7 ; 2 libellés de reset ; compteur à **5 emplacements** | P | 18 écrans | `components/ui/filter-bar.tsx` : rendre `count` et reset **obligatoires** ; 1 libellé | règle : toute liste = `FilterBar` complet (tabs, toggle, count, reset) | |
| D6 | **État des filtres dans l'URL** : aucun hook ; 5 façons de faire ; 3 conventions de liste (CSV, `x[]`, clé répétée) ; **7 écrans perdent leurs filtres au rechargement** ; garde anti-réponse périmée recopiée (×7 `derniereRequete`, ×4 `generation`, ×2 `cancelled`) | N | 13 écrans | nouveau `lib/hooks/use-filtres-url.ts` (+ convention de liste unique) | | |
| D7 | Champ de recherche : 6 implémentations, debounce sur 1 écran / 4, pas de bouton effacer commun, 3 `<input>` bruts | P | 6 | `components/ui/filtre-en-ligne.tsx` `FiltreRecherche` (+ debounce intégré, bouton ✕) ; `ui/autocomplete.tsx` sur `Input` | | |
| D8 | Presets de période dupliqués dans `ExportSyntheseBloc` (libellés différents, « Année civile » faux : 1er janv → aujourd'hui) ; défaut dashboard admin calé au 1er du mois (le déclencheur n'affiche donc pas « 12 derniers mois ») | P | 2 | `lib/periodes-raccourcis.ts` (existe) | | |
| D9 | `Combobox` mode `titre` (filtre choix unique) : **0 usage** ; `MultiSelectFilter` quasi mono-usage | — | — | `combobox.tsx` | supprimer `MultiSelectFilter`, utiliser `Combobox titre` | |
| D10 | Listes **sans barre de filtres** alors que les homologues en ont : `gestionnaire/collectes` (filtres URL invisibles), `organisateur/collectes` (from/to appliqués sans indicateur), factures gestionnaire/agence | — | 4 | `CollecteFiltresBar` | parité 3 rôles | |
| D11 | Case à cocher native utilisée comme filtre | P | 1 (`clients/[id]/onglets:1181`) | `components/ui/checkbox.tsx` | | |

### E. Tableaux, pagination, listes

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| E1 | `<table>` brutes (3 recettes) + pseudo-tableaux en `div`/`grid` (`co2` ×2, `factures/[id]` en tokens Tailwind, `sante-systeme`) | P | 4 + 4 | `components/ui/table.tsx` / `data-grid.tsx` | | |
| E2 | **Pagination** : 3 habillages, 3 seuils d'affichage, taille 50 **en dur ×7 côté client et ×9 côté API**, pagination maison registre | P | 8 + 1 | nouveau `components/ui/list-footer.tsx` (compteur + `Pagination` + taille de page) + `lib/pagination.ts` (`DEFAULT_PAGE_SIZE`, `parseLimit`) | | |
| E3 | **Chargement liste paginée serveur** : page, tri, total, anti-périmé, retour page 1 recodés ; **3 conventions de tri API** (`tri/ordre`, `sortBy/sortDir`, `sort/dir`) et 4 formes d'état | N | 9 pages | nouveau `lib/hooks/use-liste-paginee.ts` + 1 convention API | | |
| E4 | États des grilles : `loading` prop (6) vs squelette externe (9) ; `EmptyState` (4) vs `<p>` (15) ; état erreur + Réessayer sur 3 écrans seulement | P | 20 grilles | `data-grid.tsx` props `loading`, `empty`, `error` **obligatoires** | | |
| E5 | **Troncature silencieuse** (page 1 seule chargée) | — | 2 (`clients/[id]/onglets` Collectes, `settings/users`) | E3 | bug fonctionnel | |
| E6 | Menu « Colonnes » actif partout, même petits blocs dashboard | — | — | `data-grid.tsx` `columnsToggle=false` par défaut dans les blocs | | |

### F. Formulaires

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| F1 | `<label>` bruts : 21 recettes (`font-medium mb-1` vs DS `font-semibold mb-1.5`), 15 dans `collecte-detail-panel` | P | 34 / 14 fichiers | `components/ui/label.tsx` / `form-field.tsx` | | |
| F2 | `<input type="checkbox">` bruts (4 sans classe) + 1 radio | P | 7 | `components/ui/checkbox.tsx` + nouveau `radio-group.tsx` | | |
| F3 | **Grille 2 colonnes** : 9 recettes (`sm:` vs `md:`, 7 non responsives) | N | 30 | nouveau `components/ui/form-grid.tsx` (`cols={2|3}`) | règle §5.5 (4) | |
| F4 | **En-tête de section** : `Bloc` copié ×2 (`association-modal`, `organisation-modal`), `BlocHeader` défini ×2 (`fiche-blocs`, `clients/[id]/page:247`) | P | 4 | promouvoir `BlocHeader` en `components/ui/section-header.tsx` | | |
| F5 | Paires label/valeur : `InfoItem`, `Champ` (lieux/[id]), `Field` (registre/[id]), `<dl>` inline (14 `<dt>` dans collecte-detail-panel) | P | 4 implémentations | promouvoir `InfoItem` en `components/ui/info-item.tsx` | | |
| F6 | Erreurs de champ : 7 recettes `<p>` hors `FormError` ; `FormField error=` seulement dans les 4 modales admin | P | 21 | `components/ui/form-error.tsx` (existe) | | |
| F7 | Marqueur obligatoire : astérisque (81/187), « (obligatoire) » dans le libellé ×7, « (facultatif) » ×8 ; attribut `required` HTML décorrélé des astérisques | P | 3 conventions | `Label required` | 1 convention : astérisque seul | |
| F8 | Texte d'aide : `hint=` (41) vs `<p className="text-xs text-savr-neutral-500">` manuel (26) | P | 26 | `FormField hint` | | |
| F9 | **Validation** : ni zod ni react-hook-form ; `useState` par champ (jusqu'à 28 par formulaire) ; 4 `validate()` maison dans les modales admin (2 signatures) ; regex SIREN **×5**, SIRET **×3** ; `validatePasswordStrength` non appliqué côté client sur « changer mot de passe » ; email/téléphone validés uniquement au signup | N | 25 formulaires | `packages/shared/src/validation/` (regex) + `lib/hooks/use-form-errors.ts` | **arbitrage** : zod + react-hook-form (cible V1.1) ou validateurs maison unifiés | |
| F10 | Messages « X obligatoire » écrits en dur | N | 15 variantes | `lib/libelles/validation.ts` | | |
| F11 | `maxLength` littéraux alors que `BORNES_TEXTE_LIBRE` existe | P | 6 | `lib/champs-texte-libre.ts` | | |

### G. Modales, confirmations, fiches

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| G1 | **Confirmation destructive** : 6 `window.confirm()` natifs + 8 `<Modal>` de confirmation ad hoc + 1 confirmation inline ; modale d'annulation **copiée** entre `liste-collectes-client` et `fiche-collecte-client-panel` | N | 15 | nouveau `components/ui/confirm-dialog.tsx` (titre, message, variant destructive, motif optionnel avec longueur min) + hook `useConfirm()` | | |
| G2 | `Sheet` : primitive présente, **0 usage** ; règle §8 « Modal → Sheet sur mobile » non appliquée | — | 33 `Modal` | `components/ui/modal.tsx` : bascule interne vers `Sheet` sous 640 px | arbitrage : appliquer §8 ou retirer la règle | |
| G3 | **7 layouts de fiche** distincts ; seules les 2 fiches collecte partagent `FicheCollecteModalCadre` + `fiche-blocs` ; `factures/[id]` et `attributions-ag` en palette Tailwind brute | P | 10 fiches | promouvoir `fiche-collecte-modal-cadre.tsx` + `fiche-blocs.tsx` en `components/ui/fiche/` | | |
| G4 | Modale « Détail impact carbone » instanciée ×2 dans 2 dashboards | N | 4 | 1 composant | | |
| G5 | Invitation utilisateur : **4 implémentations** (2 modales admin dont B5, traiteur, gestionnaire) | N | 4 | 1 composant `components/organisation/inviter-utilisateur-modal.tsx` | | |

### H. Feedback et états système (§7 CDC : 5 états par écran)

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| H1 | **Toast** : primitive `ui/toast.tsx` présente, `ToastProvider` **jamais monté**, `useToast` 0 usage. Succès rendu en texte inline (12 états `msg`/`successMsg`), 3 boîtes vertes Tailwind, 4 tokens inexistants (B1), 4 messages ambigus (B8) | — | ≈ 20 | monter le provider dans `app/layout.tsx` ; règle §7 « Success = Toast 4 s » | | |
| H2 | **Bandeaux d'alerte inline** au lieu de `AlertBar` : 3 familles (Tailwind brut, hybride, tokens) ; `AlertBar` **sans variante `success`** | P | 28 (erreur 12, warning 10, succès 4) + 2 copies manuelles de la recette | `components/ui/alert-bar.tsx` + variant `success` | élimine ≈ 70 classes Tailwind brutes | |
| H3 | « Chargement… » texte : 27 rendus, 4 recettes (6 sans couleur) ; **0 `loading.tsx` de route** ; `ChartSkeleton` parallèle en `bg-muted` | P | 27 | nouveau `components/ui/loading-state.tsx` + `Skeleton` ; `loading.tsx` par groupe de routes | règle §7 « jamais spinner seul » | |
| H4 | États vides inline « Aucun… » : 48 (`text-sm text-savr-neutral-500` ×33, bandeau ambre ×2) ; `EmptyDashboardState` parallèle | P | 48 | `components/ui/empty-state.tsx` prop `size="inline"` ; fusionner `EmptyDashboardState` | | |
| H5 | **0 `error.tsx` de route** ; état erreur + « Réessayer » sur 3 listes | N | — | `components/ui/error-state.tsx` + `error.tsx` par groupe | règle §7 | |
| H6 | `OpsReadOnlyBanner` absent de `co2`, `algo-ag`, `auto-accept` | — | 3 | — | vérifier le gating attendu | |

### I. En-têtes, cards, typographie, KPI

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| I1 | **h1 fait main** : 45 pages (7 recettes : `text-2xl font-bold text-savr-primary-800` ×23, `…neutral-900` ×8, `text-xl` ×6…) vs `PageHero` sur 10 ; `top-bar.tsx:60` rend aussi un `<h1>` (risque double h1) | P | 45 | `components/ui/page-hero.tsx` | **arbitrage** : PageHero partout (bandeau navy sur chaque écran) **ou** nouveau `PageHeader` sobre pour les écrans non-liste (dashboards, mon-profil, paramètres) ; trancher le h1 de top-bar | |
| I2 | Titres h2/h3 : 9 recettes h2, 6 recettes h3, `CardTitle` surchargé `text-base` ×5 | N | 55 | `components/ui/heading.tsx` (`<Heading level size>`) ou `CardTitle size` | | |
| I3 | Padding `Card` forcé et divergent (`p-5 space-y-4` ×30, `p-6 space-y-4` ×10, `p-4` ×10, `p-6` ×6) | P | 56 | `card.tsx` prop `padding="sm|md|lg"` ; défaut §5.2 = `space-6` | | |
| I4 | Conteneurs carte inline (`rounded-savr-lg border … p-6 shadow-savr-sm` « recette cockpit » ×5, modales ×2) | P | ≈ 12 | `card.tsx` variant `elevated` | | |
| I5 | `rounded-savr-lg` sur des cards (19) : token respecté mais contraire à la règle §4.3 « md partout ; lg = modals/panels » | — | 19 | `card.tsx` | **arbitrage** : élargir la règle (cards cockpit en `lg`) ou aligner sur `md` | |
| I6 | **KPI** : `StatCard` (ui) **1 usage** vs `KpiCockpitCard` 55 usages vs 4 recettes inline (`KpiTile` admin collectes, `traiteurs/[id]`, `mon-pack-ag`, `taux-recyclage`) | P | 3 familles | fusionner : `KpiCockpitCard` devient `components/ui/stat-card.tsx` (supprimer l'ancien) | | |
| I7 | Tooltip de chart inline identique ×5 | N | 5 | `components/ui/chart-tooltip.tsx` | | |
| I8 | `Co2HeroCard` / `Co2HeroCardAg` jumeaux (13 + 9 styles inline) | N | 2 | 1 composant paramétré | | |
| I9 | `LogoCard` dupliqué | N | 2 | `components/organisation/logo-card.tsx` | | |

### J. Formatteurs et constantes

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| J1 | **Dates** : 4 modules concurrents (`shared/temps` `formatJour`/`formatDateParis`, `shared/csv` `formatDateFr` doublon, `lib/format-date-collecte.ts` sur `toLocaleDateString`, `lib/date-iso.ts`) + 2 helpers locaux ; 28 `toLocaleDateString` et 9 `toLocaleString` directs | P | 37 contournements | `packages/shared/src/temps/index.ts` seul ; `lib/format.ts` réexporte | fusionner `formatDateFr` → `formatDateParis` | |
| J2 | **Nombres / unités** : `fmtEuro` sans €, `fmtPct` sans % → 17 « € » et 41 « % » concaténés à la main, 19 « kg » ; 39 `toFixed` ; 7 `Intl.NumberFormat` locaux (pax formaté ×3 à l'identique) ; **2 seuils kg→t** (10 000 dans `fmt.ts`, 1 000 dans `TonnageDisplay`/`organisateur`) ; **7 graphies CO₂** (`kgCO₂e`, `kg CO₂`, `t CO2`…) | P | ≈ 120 | `lib/format.ts` (`fmtEuro(n)` avec €, `fmtPct`, `fmtMasse`, `fmtCo2`, `fmtPax`) | **arbitrages** : seuil kg→t unique ; graphie CO₂ unique | |
| J3 | Code mort probable : `charts/EvolutionFluxChart.tsx`, `EvolutionRepasChart.tsx`, `charts/TonnagesDonut.tsx`, `charts/lazy.tsx`, `charts/format.ts` (`formatMasse`/`formatKg`) — importés nulle part hors tests ; `MultiSelectFilter` quasi mort | — | 6 fichiers | — | supprimer (vérifier `check:orphan-components`) | |
| J4 | **Routes en dur** : `/admin/collectes` ×16, `/login` ×21, `/programmer/nouveau` ×9, `/admin/parametres` ×10… ; **4 tables rôle ↔ chemin** non dérivées (`HOME_BY_ROLE` app/page, `ROLE_PREFIXES` middleware, `NAV_CONFIG`, `API_COLLECTES`) | N | ≈ 80 + 4 | `lib/routes.ts` (dérive de `lib/roles.ts` C7) | | |
| J5 | Debounce : 250 ms ×2, 300 ms ×1, 0 sur 2 combobox qui fetchent à chaque frappe | N | 5 | `lib/hooks/use-debounce.ts` + constante | | |
| J6 | « 12 derniers mois » recalculé à la main dans 5 routes API (`setMonth(-12)`) | P | 5 | `lib/periodes-raccourcis.ts` | | |

### K. Data-viz

| ID | Élément | État | Mesure | Source unique cible | Action | Décision |
|---|---|---|---|---|---|---|
| K1 | `palette.ts` = miroir manuel de 28 hex (26 = tokens exacts) ; `flux.ts` 9 hex ; `DOT` ×5, `OPS_DOT`, `AVATAR_TINT`, `PARC` locaux ; hex inline `PackAgRing`, `EvolutionZdChart` (`#FFE8C2`), `TopRankList` (`#EEF0F5` au lieu de `GRID`) ; 2 hex hors token (`#7ED9A6`, `#FECACA`) | P | 107 hex | A4 | | |
| K2 | Légendes de graphique cliquables : 3 recettes, opacité en style inline | N | 5 | `components/ui/toggle-chip.tsx` (sert aussi aux chips de sélection formulaire, 6 occurrences) | | |
| K3 | Charts Recharts legacy avec grille grise par défaut non tokenisée | — | 3 | J3 (suppression) | | |

---

## 3. Arbitrages Val nécessaires (ambiguïtés du CDC §10)

Ces points ne peuvent pas être tranchés par le code. Chaque réponse se reporte dans la colonne `Décision` de la ligne citée.

| # | Question | Options | Ligne |
|---|---|---|---|
| Q1 | Couleur unique du type de collecte | (a) ZD navy / AG orange (§2.4) · (b) ZD vert / AG ambre (`TypeCollecteBadge` actuel) | C2 |
| Q2 | Libellé unique de l'état inactif | « Inactif » / « Désactivé » / « Suspendu » (ou 2 états distincts désactivé vs suspendu) | C6 |
| Q3 | En-tête des écrans non-liste (dashboards, profil, paramètres) | (a) `PageHero` navy partout (levier #2) · (b) `PageHeader` sobre, PageHero réservé aux listes | I1 |
| Q4 | Rayon des cards cockpit | (a) `lg` autorisé pour les cards dashboard (mettre §4.3 à jour) · (b) tout en `md` | I5 |
| Q5 | Seuil de bascule kg → tonnes | 10 000 kg (§11) ou 1 000 kg | J2 |
| Q6 | Graphie CO₂ unique | « kg CO₂e » / « kgCO₂e » / « t CO₂e » | J2 |
| Q7 | Modal → Sheet sur mobile (§8) | (a) appliquer dans `Modal` · (b) retirer la règle du CDC | G2 |
| Q8 | Validation formulaires | (a) zod + react-hook-form (dépendances nouvelles) · (b) validateurs maison unifiés dans `packages/shared` | F9 |
| Q9 | Tailles 11 px / 13 px | (a) ajouter à l'échelle §3.2 · (b) interdire (arrondir à xs/sm) | A6 |
| Q10 | Texte courant | (a) composant `<Text variant>` · (b) utilitaires CSS `text-savr-muted` etc. | A8 |
| Q11 | Libellé unique du CTA vers `/programmer/nouveau` | « Programmer une collecte » (proposé) | B7 |
| Q12 | Libellé statut facture | « En attente » / « En attente Pennylane » | C3 |

Les réponses Q1, Q2, Q5, Q6, Q12 touchent des libellés métier : à tracer en `_Divergences/` (type `ambigu`) pour patch du Vault.

---

## 4. Plan de lots proposé (ordre ROI)

| Lot | Contenu | Lignes | Effort | Gain |
|---|---|---|---|---|
| R-UI-0 | Bugs §1 (B1-B8) + code mort J3 | — | 0,5 j | 8 bugs visibles |
| R-UI-1 | **Feedback** : monter Toast, `AlertBar success`, migrer 28 bandeaux + 20 messages, `LoadingState`/`EmptyState inline`/`ErrorState`, `loading.tsx`/`error.tsx` | H1-H5, A1 (70 classes) | 2 j | §7 CDC respecté, ≈ 100 classes Tailwind brutes supprimées |
| R-UI-2 | **Libellés** : `lib/libelles/*` (statut collecte, type collecte, facture, pack, rôle, organisation, flux, événement) + `lib/roles.ts` + `lib/routes.ts` ; badges `TypeCollecte`, `FactureStatut`, `Actif` | C1-C13, J4 | 2 j | ≈ 45 mappings → 9 fichiers ; 15 enums bruts corrigés |
| R-UI-3 | **Boutons** : `loading`, variants destructifs, `link`, `IconButton`, `FormActions`, `ConfirmDialog` | B1-B6, G1 | 2 j | 52 ternaires, 34 liens, 15 confirmations |
| R-UI-4 | **Filtres & listes** : `ToggleGroup` partout, `FilterBar` complet obligatoire, `useFiltresUrl`, `useListePaginee`, `ListFooter`, 1 convention tri API | D1-D11, E1-E6 | 3 j | 7 écrans persistants, 6 → 1 façon de filtrer |
| R-UI-5 | **Formulaires & fiches** : `FormGrid`, `SectionHeader`, `InfoItem`, validation partagée, regex partagées, fiche shell | F1-F11, G3-G5 | 3 j | 9 grilles → 1, 4 `validate()` → 1 |
| R-UI-6 | **Tokens & typo** : hex → tokens dérivés, rayons/ombres/durées, `Text`/`Heading`, `Card padding`, `PageHero` généralisé, KPI fusion | A2-A10, I1-I9, K1-K2 | 3 j | 107 hex → 1 fichier, 45 h1 → 1 composant |

Total ≈ 15 j. Chaque lot = 1 PR, tests DS existants (`components.m0-8.test.tsx`, `formulaires-ds.test.tsx`) étendus à chaque nouvelle primitive.

---

## 5. Garde-fous mécaniques (pour que la dette ne revienne pas)

Principe du harnais (CLAUDE.md §12) : une consigne critique = un mécanisme. Aujourd'hui aucun gate ne porte sur l'UI. Proposition, mode cliquet (`check:ratchet`, baseline puis durcissement) :

| Gate | Mécanisme | Refuse |
|---|---|---|
| `check:ds-tokens` | script `rg` sur `app/` + `components/` hors `ui/` | classes Tailwind de palette brute (`\b(bg|text|border)-(red|green|amber|orange|neutral|gray|slate|zinc|blue)-\d`), `rounded(-\w+)?\b` sans `savr`, `shadow(-\w+)?\b` sans `savr`, hex `#[0-9a-f]{6}` hors `lib/design-tokens.ts`, classes `savr-*-600` inexistantes |
| `check:ds-primitives` | `rg` hors `ui/` | `<button`, `<select`, `<label`, `<input type="checkbox"`, `<table`, `window.confirm`, `fixed inset-0` |
| ESLint `no-restricted-syntax` (fichier `eslint.config.js`, à côté des sélecteurs fuseau) | AST | `toFixed(` dans du JSX, `toLocaleDateString` hors `shared/temps`, `confirm(`, littéral `'/admin/…'` hors `lib/routes.ts` |
| Test unitaire `ds-tokens-existent` | parse `globals.css` et toutes les classes `savr-*` du code | toute classe `savr-*` sans token défini (B1 devient impossible) |
| Vitest `components.m0-8` étendu | — | 1 test par nouvelle primitive (`loading`, `ConfirmDialog`, `FormActions`…) |
| `check:orphan-components` étendu à `components/ui/` | existant (`scripts/check-orphan-components.ts`) | primitive exportée jamais importée (aurait détecté Toast, Sheet, `StatCard`, `Combobox titre`) |

Effort câblage : 1 j, à faire **dans R-UI-0** pour que les lots suivants fassent baisser la baseline.

---

## 6. Ce qui est déjà bien centralisé (ne pas toucher)

- Tokens `@theme` complets (couleurs 50-950, sémantiques, data-viz, radius, ombres, motion, conteneurs) et mappage shadcn dans `globals.css`.
- Focus ring unique en `@layer base` + test M0.8-4d qui refuse toute couleur divergente.
- `Button` (205), `FormField` (187), `Input` (142), `Card` (129), `Badge` (100), `Combobox` (36), `FiltreCoches` (34), `DataGrid`/`DataTable` (42), `Modal` (33), `Skeleton` (38), `EmptyState` (26), `AlertBar` (33).
- `lib/statut-collecte-labels.ts` (vue admin/client), `lib/statut-tms-labels.ts`, `lib/lieux-labels.ts`, `lib/periodes-raccourcis.ts`, `lib/collectes-chips.ts`, `lib/nav-config.ts`, `lib/alertes-admin.ts`.
- Aucun `<select>` natif, aucun `rgb()`, aucune police hors Nunito, redirections `/{role}/collectes/[id]` → `?collecte=` uniformes.
