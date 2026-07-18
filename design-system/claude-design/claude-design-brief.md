# Brief à coller dans Claude Design (claude.ai/design)

> Mode d'emploi : crée un **nouveau projet** sur claude.ai/design, choisis le type
> **Design System** (le type est figé à la création), **joins les 9 fichiers HTML**
> de ce dossier en référence, puis **colle le bloc « PROMPT DE DÉMARRAGE »** ci-dessous.
> Ensuite, itère **une carte à la fois** avec le gabarit « PROMPT D'ITÉRATION ».

---

## 1) PROMPT DE DÉMARRAGE (copier-coller intégral)

Crée le design system de **Savr** — plateforme B2B de lutte contre le gaspillage alimentaire (dons Anti-Gaspi + Zéro Déchet). Ton **institutionnel, sobre, lisible, accessible AA**. Les fondations ci-dessous sont des **tokens figés, pas des suggestions** : respecte-les au pixel. J'ai joint le rendu HTML de référence de chaque élément.

**COULEURS — échelles tonales complètes**

Primary · Navy (base 700) : 50 #EFF2F9 · 100 #DEE4F2 · 200 #BDC8E5 · 300 #92A3D2 · 400 #6379B6 · 500 #3F5599 · 600 #2E4080 · **700 #223870** · 800 #1B2C57 · 900 #15213F · 950 #0D1428

Accent · Orange (base 500) : 50 #FFF4E0 · 100 #FFE8C2 · 200 #FFD489 · 300 #FFB340 · 400 #FFA31A · **500 #FF9B00** · 600 #D97F00 · **700 #B36400 (texte AA)** · 800 #8C4D00 · 900 #663800 · 950 #3D2100

Neutres **tintés navy** (jamais de gris pur) : 50 #F7F8FB · 100 #EEF0F5 · 200 #DDE1EB · 300 #C3C9D9 · 400 #9AA2B8 · 500 #6E7790 · 600 #515A72 · 700 #3C4459 · 800 #272D3D · 900 #161A26 · 950 #0C0F18 · white #FFFFFF

Sémantiques (subtle / base / strong) : success #F0FDF4 / #16A34A / #15803D · warning #FFFBEB / #D97706 / #B45309 · error #FEF2F2 / #DC2626 / #B91C1C · info #EFF6FF / #2563EB / #1D4ED8

Data-viz (ordre des séries) : #223870 · #FF9B00 · #3F5599 · #16A34A · #6379B6 · #D97F00

**TYPO** — Nunito. Corps 16px. Échelle : 12 / 14 / 16 / 18 / 20 / 24 / 30 / 38 px. Titres poids 700/800, `letter-spacing -0.02em`, `line-height 1.15`. Graisses : 400 corps · 500 labels · 600 boutons/titres cards · 700 KPIs · 800 display.

**LAYOUT & ÉLÉVATION** — Grille 4px. Radius : **8px partout** (boutons, inputs, cards) ; `full` pour badges/avatars/toggles. Ombres sobres teintées navy : none au repos sur les cards · sm hover · md popover/dropdown · lg modal. Focus : anneau **primary-500 (#3F5599)**, offset 2px, sur tout élément focusable. Mouvement : 120ms hover · 200ms UI · 320ms overlays.

**IDENTITÉ — 8 leviers OBLIGATOIRES** (règle d'or : un écran qui pourrait passer pour n'importe quel SaaS shadcn générique = NON conforme ; au minimum les leviers 1, 2, 4 et 5 visibles sur chaque écran) :

1. **Neutres tintés navy** — jamais de gris pur (pas de slate/zinc).
2. **Bloc primaire plein** — sidebar, hero, bandeaux clés = aplats **primary-700** texte blanc.
3. **Accent orange parcimonieux** — accent-500 réservé aux CTA secondaires, highlights, états « à faire ». Jamais en aplat de fond large.
4. **Focus ring signature** — anneau primary-500 offset 2px.
5. **Ombres sobres + bordures portantes** — cards = bordure neutral-200 + fond blanc, ombre quasi nulle ; la hiérarchie vient de la bordure et de l'espace.
6. **Radius mesuré** — 8px.
7. **Typo Nunito + display serré** — contraste corps rond / titres serrés.
8. **Hover bouton franc** — primaire : primary-700 → 800 + translation −1px, 120–150ms. Pas d'ombre diffuse générique.

**COMPOSANTS à produire** (reproduis fidèlement variants + états depuis les HTML joints) :

- **Button** — 6 variants (primary, secondary, accent, destructive, ghost, link) × 4 tailles (sm 32 / md 40 / lg 44 / icon), états repos / hover / disabled. Poids 600.
- **Badge** — pilule radius-full, 12px medium, point 6px. 7 variants : success, warning, error, info, action (texte accent-700), neutral, primary.
- **Card** — fond blanc, bordure neutral-200, ombre nulle au repos ; slots header/title(18px semibold)/description/content/footer. Variante cliquable : hover bordure primary-200 + shadow-sm.
- **StatCard** — KPI dashboard : label 14px medium neutral-500 + icône optionnelle, valeur 30px bold display serré, variation ±% (success-strong / error-strong). Grille 1 / 2 / 3-4 colonnes.
- **DataTable** — desktop dense (en-tête 44px, libellés 11px bold uppercase neutral-500, colonnes triables, hover neutral-50, lignes cliquables) ; bascule en cards verticales < 640px.

Commence par les **fondations** (couleurs, typo, layout), puis l'écran **Identité** (les 8 leviers illustrés), puis les **composants un par un** — en démarrant par Button et Card.

---

## 2) PROMPT D'ITÉRATION (un composant à la fois)

> Reprends **<NOM DU COMPOSANT>** de mon design system. Garde les tokens et les 8 leviers d'identité intacts. Propose **2-3 variantes** sur : <ce que tu veux améliorer — ex. hiérarchie visuelle du hover, densité, lisibilité du disabled, micro-interaction>. Montre-les côte à côte pour comparer. Ne touche à aucun autre composant.

Idées de passes d'optimisation (dans l'ordre de valeur) :

1. **Identité / couleurs** — vérifier que les 8 leviers « claquent » et l'accès AA.
2. **Button** — hover/press, focus, cohérence des tailles, densité du `sm`.
3. **Card / StatCard** — hiérarchie, variation ±%, états vides.
4. **DataTable** — densité, tri, ligne active, rendu mobile.
5. **Badge** — lisibilité des statuts collecte, avec/sans point.

---

## 3) Boucle retour → code

Quand une variante te convient sur Claude Design :

- exporte / copie le CSS ou décris le changement, **rapporte-le dans cette session Claude Code** ;
- je le reporte dans `packages/plateforme/src/app/globals.css` (tokens) et/ou le composant `.tsx` concerné, en respectant tes gates (DS par défaut, tests) ;
- je **régénère la preview** correspondante ici pour rester fidèle.

Fichiers de référence à joindre dans Claude Design (ce dossier) :
`foundations/colors.html` · `foundations/typography.html` · `foundations/layout-elevation.html` · `foundations/leviers-identite.html` · `components/button.html` · `components/badge.html` · `components/card.html` · `components/stat-card.html` · `components/data-table.html`
