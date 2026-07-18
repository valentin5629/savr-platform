# Savr Design System — bundle Claude Design

**Dérivé — ne pas éditer à la main comme source de vérité.** Reflète le DS *en code* :
- Tokens : `packages/plateforme/src/app/globals.css` (`@theme`)
- Composants : `packages/plateforme/src/components/ui/*.tsx`
- Spec : `specs/cdc/01 - …/10 - Design System.md`

## Rôle
Previews HTML autonomes (tokens inlinés, variants réels) au format consommé par
**Claude Design** (`claude.ai/design`). Chaque fichier = une carte, déclarée par le
marqueur de 1re ligne `<!-- @dsCard group="…" -->`. Le pane compile l'index
(`_ds_manifest.json`) depuis ces marqueurs.

## Contenu (passe 1 — fondations + composants clés)
| Groupe | Fichier |
|---|---|
| Fondations | `foundations/colors.html` |
| Fondations | `foundations/typography.html` |
| Fondations | `foundations/layout-elevation.html` |
| Identité | `foundations/leviers-identite.html` (les 8 leviers) |
| Composants | `components/button.html` |
| Composants | `components/badge.html` |
| Composants | `components/card.html` |
| Composants | `components/stat-card.html` |
| Composants | `components/data-table.html` |

## Sync vers Claude Design (outil `DesignSync`)
1. **Auth** — `/design-login` dans un terminal `claude` interactif (rattache l'accès
   design au login claude.ai). Requis une seule fois.
2. `list_projects` → `create_project` (nouveau projet DS Savr).
3. `finalize_plan` (writes = `**/*.html`, localDir = ce dossier) → `write_files`.
4. Itérer côté Claude Design, puis reporter les changements dans le code (globals.css
   + composants), et resync.

## Fidélité
Les classes Tailwind des `.tsx` sont traduites en CSS concret via les mêmes tokens.
Après toute modif du DS en code, **régénérer** les previews concernées pour éviter la
divergence.
