# Sessions de développement parallèles — règle de séquençage

Plusieurs sessions Claude Code peuvent travailler **en parallèle** sur ce repo,
à condition de suivre la règle ci-dessous. Elle est **mécanisée** (hooks +
scripts), pas seulement documentée.

## La règle en une phrase

**Code / UI / tests mockés = parallèle libre. Écriture dans la base PARTAGÉE
`savr-dev` = une seule session à la fois.**

## Pourquoi

`savr-dev` est **un seul projet Supabase** partagé par toutes les sessions (§11
CLAUDE.md). Une migration appliquée, un `seed:*` (qui reset/recharge), un
`db reset` sont **globaux** : deux sessions qui écrivent en même temps →
état DB incohérent, collision de timestamp de migration, données écrasées.
En revanche, éditer/compiler/tester-en-mock ne touche jamais `savr-dev`.

## Ce qui est parallèle vs sérialisé

| Parallèle libre ✅                                                        | Sérialisé (1 session à la fois) ⚠️                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| éditer n'importe quel fichier (**y compris écrire une migration `.sql`**) | **appliquer** une migration à savr-dev (`supabase db push`) |
| `pnpm test:unit` / vitest (mocké)                                         | `pnpm seed:minimal` / `seed:demo` / `seed:auth`             |
| `pnpm typecheck` / `lint` / `build`                                       | `supabase db reset` (déjà bloqué par `block-destructive`)   |
| refactor, composants avec données mockées                                 | tester une route en live contre l'app branchée savr-dev     |

> **Migration** : l'écrire est libre et parallèle ; seule son **application** à
> savr-dev est gardée. La migration prod reste manuelle + revue Val/frère.

## Le mécanisme

1. **`pnpm session:doctor`** — diagnostic à la demande : sur quelle DB pointe le
   worktree courant, quels autres worktrees pointent sur savr-dev, état du lease,
   et verdict « parallèle libre / à sérialiser ».
2. **Hook `db-guard` (automatique, PreToolUse)** — quand une commande qui **écrit**
   dans savr-dev est lancée, il pose un « lease savr-dev » (partagé via le `.git`
   commun). Si **une autre session tient déjà un lease frais**, il **bloque** la
   commande et t'alerte (conflit réel). Sinon il laisse passer silencieusement.
   Fail-safe : hors savr-dev / commande non-DB / lease libre → aucune gêne.
3. **`pnpm session:db-unlock`** — libère le lease si la session détentrice est
   morte. (Le lease expire seul après 30 min d'inactivité DB.)

## Comment vraiment paralléliser du travail DB

Isole la session sur une **base jetable / Supabase local** (pattern
`reference-stack-local-validation-visuelle` / `reference-pgtap-local-validation`) :
son `.env.local` ne pointe plus sur savr-dev → aucun lease requis, aucune
collision avec les autres. ⚠️ Le Supabase _local_ est une seule instance par
machine : pour deux sessions DB vraiment indépendantes, chacune a besoin de sa
**propre base jetable**.

## Ordre recommandé quand deux sessions doivent toucher savr-dev

1. Terminer + merger la migration de la session A (application incluse) **avant**
   que la session B applique la sienne → évite deux migrations concurrentes.
2. Un `seed:*` reset tout : préviens les autres sessions savr-dev avant de le
   lancer (le lease les bloquera de toute façon).

Démarrer une nouvelle session parallèle : **`pnpm session:new <slug>`**.
