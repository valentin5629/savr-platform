# Navigateurs : lequel utiliser, et quand

Trois navigateurs sont à la disposition d'une session Claude Code. Ils ne font pas la même chose.

| Besoin                                                                        | Outil                                                              | Pourquoi                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vérifier un écran en local (rendu, contenu, console, réseau, taille mobile)   | **Navigateur intégré** (`mcp__Claude_Browser__*`, `preview_start`) | Il ouvre le serveur de la session (`.claude/launch.json`) et Val le voit dans l'app                                                                        |
| Vérifier sur `dev.app.gosavr.io` ou une préversion Vercel                     | **Claude in Chrome** (`mcp__claude-in-chrome__*`)                  | C'est le Chrome de Val, déjà connecté à Vercel et aux personas. Les deux autres butent sur le mur d'authentification Vercel                                |
| Mesurer la performance, ralentir le réseau ou le processeur, auditer un écran | **Chrome DevTools MCP** (`mcp__chrome-devtools__*`)                | Seul à faire une trace de performance (`performance_start_trace`), un audit Lighthouse (`lighthouse_audit`) et un ralentissement réseau ou CPU (`emulate`) |

Règle courte : **l'écran se vérifie dans le navigateur intégré, la performance se mesure dans Chrome DevTools MCP.**

## Quand sortir Chrome DevTools MCP

1. **Val signale une lenteur** (« ça rame », « le dashboard met du temps ») : mesurer avant de supposer une cause. Une trace, puis `performance_analyze_insight` sur ce qu'elle remonte.
2. **Un écran qui charge des données a été modifié** (requête, jointure, filtre, pagination) : relever la durée des appels `/api/…` (`list_network_requests`) avant et après le changement. Le CDC dit : « Toute requête > 500 ms en dev = signal à indexer avant merge » (`specs/cdc/01 - …/08 - Performance/03 - Cibles techniques transverses.md`).
3. **Écrans marqués « À optimiser » au CDC** (dashboard Admin, exports, inscription) : à mesurer à chaque modification. Cibles : `02 - SLA par endpoint.md` du même dossier.
4. **Usage mobile** (PWA, personnel sur site) : `emulate` avec un réseau lent, à 375 px de large, quand un écran est destiné au terrain.
5. **Avant le go-live** : un passage sur les écrans principaux de chaque rôle (LCP < 2,5 s, CLS < 0,1).

Pour tout le reste (libellé, KPI faux, mise en page, droit d'accès), le navigateur intégré suffit.

## Ce qu'une mesure vaut

- `next dev` compile chaque page à sa première visite : **la première mesure est fausse**. Mesurer à la deuxième visite.
- En local, le serveur tourne sur le poste et la base est à Paris : les durées ne sont pas celles de la production sur Vercel. **Une mesure locale détecte une régression (avant / après sur le même poste), elle ne prouve pas un SLA.** Le SLA se juge sur les benchmarks k6 du CDC et le suivi de production.
- Donner les chiffres tels que l'outil les rend, avec le nombre de mesures, jamais une estimation.

## Verrou et configuration (`.mcp.json`)

Le serveur est déclaré dans `.mcp.json` à la racine du dépôt. Chaque worktree a donc le même. Claude Code demande à Val de l'approuver à la première utilisation : l'approbation ne peut pas aller dans `.claude/settings.json`, qui ne doit porter que `hooks` (cliquet `tests/securite/hooks-chemin-absolu.test.ts`). Une configuration personnelle du même nom (`claude mcp add … -s local`) prend le pas sur celle du dépôt et retire le verrou : `claude mcp get chrome-devtools` doit afficher « Project config ». Version figée (`chrome-devtools-mcp@1.12.0`) : une mise à jour passe par une PR.

- **Sites autorisés** (`--allowedUrlPattern`) : `localhost`, `127.0.0.1` et la base Supabase `savr-dev`. Tout le reste est refusé par le navigateur lui-même, pages et requêtes selon la documentation de l'outil (Vercel et Sentry compris). Mesuré le 2026-10-25 : `app.gosavr.io/login` et la base `savr-prod` refusées (« blocked by blocklist/allowlist rules »), la base `savr-dev` ouverte.
- **Le verrou ne vaut que pour le navigateur.** Une page servie sur `localhost` parle à la base par le serveur Next, et c'est l'environnement de ce serveur qui choisit la base : un `next dev` lancé avec les variables de prod atteindrait la prod en passant par `localhost`. Le serveur local se lance avec le `.env.local` de dev, jamais autre chose.
- Les hooks du dépôt ne voient pas les outils de connecteur (`evaluate_script` exécute du JavaScript dans la page). **Ce verrou est la seule garde.** Ne pas l'élargir sans Val.
- `--redactNetworkHeaders` masque une partie des en-têtes que l'outil juge sensibles (liste non vérifiée : ne pas compter dessus pour un secret). `--no-usage-statistics` et `--no-performance-crux` : aucune statistique ni URL envoyée à Google.
- Profil Chrome séparé, gardé entre les sessions (`~/.cache/chrome-devtools-mcp/`). **La connexion d'un persona reste un geste de Val** dans cette fenêtre, comme ailleurs. Deux sessions ne peuvent pas ouvrir ce profil en même temps : fermer la fenêtre de l'autre.
- `dev.app.gosavr.io` n'est pas autorisé : il faudrait ouvrir `vercel.com` (mur d'authentification), donc le tableau de bord Vercel. Pour la préversion, utiliser Claude in Chrome.
