# Galerie — vitrine Design System

Captures de la page de dev `/dev/design-system` (`packages/plateforme/src/app/dev/design-system/page.tsx`), qui monte côte à côte les primitives `components/ui` (colonne verte, source unique) et les recettes ad hoc relevées dans l'inventaire [RATIONALISATION_UI.md](./RATIONALISATION_UI.md) (colonne orange). Les identifiants A1…K3 renvoient aux lignes de l'inventaire.

**Voir en direct** : `pnpm --filter @savr/plateforme dev` puis <http://localhost:3001/dev/design-system> (404 sur tout build de production). **Régénérer les captures** : `CHROMIUM_PATH=… node docs/design-system/captures.mjs`.

## Vue d'ensemble

![Vitrine complète](./captures/00-vitrine-complete.png)

## A. Tokens (A1 à A10)

![Tokens](./captures/01-tokens.png)

## B. Boutons, actions, liens (B1 à B11)

![Boutons](./captures/02-boutons.png)

## C. Badges et libellés d'enums (C1 à C15)

![Badges](./captures/03-badges.png)

## D. Filtres, recherche, segmentation (D1 à D11)

![Filtres](./captures/04-filtres.png)

## E. Tableaux et pagination (E1 à E6)

![Tableaux](./captures/05-tableaux.png)

## F. Formulaires (F1 à F11)

![Formulaires](./captures/06-formulaires.png)

## G. Modales et confirmations (G1 à G5, B5)

![Modales](./captures/07-modales.png)

| Modal                              | Confirmation destructive (à remplacer par `ConfirmDialog`) | Sheet (0 usage)                   |
| ---------------------------------- | ---------------------------------------------------------- | --------------------------------- |
| ![Modal](./captures/10-modale.png) | ![Confirmation](./captures/11-confirmation.png)            | ![Sheet](./captures/12-sheet.png) |

## H. Feedback et états système (H1 à H6)

![Feedback](./captures/08-feedback.png)

Toast (primitive jamais montée dans l'app) :

![Toast](./captures/13-toast.png)

## I. En-têtes, cards, KPI (I1 à I9, G3)

![En-têtes](./captures/09-en-tetes.png)

## Mobile 390 px

![Vitrine mobile](./captures/20-vitrine-390.png)
