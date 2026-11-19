# Migration Bubble (V5) — import de l'historique

Scripts TypeScript rejouables qui importent l'historique Bubble (clients, lieux,
associations, transporteurs, contacts, packs, collectes, pesées) dans la base de
la Plateforme. Modules M5.1 à M5.3 de la roadmap.

**État : répétitions seulement.** L'import refuse toute base qui n'est pas la
base locale jetable (hôte de cette machine + marqueur posé par
`base-jetable.sh`). Rien ici ne tourne sur `savr-dev` ni sur la prod, et rien
n'entre dans `supabase/migrations/` : ce que la prod exigera reste à décider.

Le dépôt est public : exports, cache d'adresses, fichiers de décision et
rapports vivent **hors du dépôt**, sous `~/Documents/savr-migration-bubble/`.
Les tests n'utilisent que des données inventées (`tests/fixtures.ts`).

## Jouer une répétition

```bash
bash apps/migration-bubble/base-jetable.sh demarrer
```

```bash
export MIGRATION_BUBBLE_DATABASE_URL="$(bash apps/migration-bubble/base-jetable.sh adresse)"
```

```bash
pnpm migration:bubble importer --types-proposes
```

```bash
pnpm migration:bubble verifier
```

```bash
pnpm migration:bubble importer --types-proposes
```

```bash
pnpm migration:bubble rapport
```

Le second `importer` est le rejeu : il ne doit rien insérer ni modifier.
`pnpm migration:bubble remettre-a-zero` retire tout ce que l'import a écrit ;
`base-jetable.sh arreter` efface la base.

| Variable                        | Rôle                                                                             | Défaut                              |
| ------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------- |
| `MIGRATION_BUBBLE_DATABASE_URL` | Base locale jetable (obligatoire)                                                | —                                   |
| `MIGRATION_BUBBLE_EXPORTS`      | Dossier des exports CSV Bubble                                                   | `~/Downloads`                       |
| `MIGRATION_BUBBLE_DOSSIER`      | Dossier de travail hors dépôt                                                    | `~/Documents/savr-migration-bubble` |
| `MIGRATION_BUBBLE_REPETITION`   | Sous-dossier de sortie                                                           | `repetition-1`                      |
| `MIGRATION_BUBBLE_DECISIONS`    | Dossier des fichiers validés par Val                                             | le dossier de sortie                |

Options de `importer` : `--types-proposes` applique le type d'organisation
proposé par règle tant que Val ne l'a pas validé (répétitions) ;
`--sans-adresses` n'appelle pas le service d'adresses (seul le cache sert).

## Ce qu'un passage produit (dossier de sortie)

- `lieux-a-valider.csv`, `clients-a-valider.csv` : rapprochement en trois
  niveaux (`auto`, `a_revoir`, `distinct`). Val écrit sa décision dans la colonne
  `groupe_decide` (`distinct`, ou la clé de la fiche à rejoindre).
- `type_overrides.csv` : type d'organisation proposé par règle ; Val écrit le
  type retenu dans `type_valide`.
- `exclusions.csv` : données qui ressemblent à des tests ; Val écrit `oui` dans
  `exclure`.
- `listings/` : listes de complétion ou d'arbitrage.
- `passages/passage-<horodatage>.json`, `checks.json`, `rapport.md` (auquel
  `notes.md`, s'il existe, est joint).

Les fichiers des lieux et des clients sont rangés par dossier (`dossier`,
`fiches_dossier`, `a_faire` en tête) : les fiches reliées par un rapprochement
proposé, « à décider » d'abord, puis « fusion d'office, à vérifier », puis
« rien à faire ».

Ces quatre fichiers sont relus au passage suivant (virgule ou point-virgule) :
une décision prise une fois est rejouée à chaque répétition, et recopiée dans
les fichiers régénérés. Une décision qui ne s'appliquerait à rien arrête
l'import en la nommant : colonne introuvable, deux décisions différentes pour
une fiche, valeur inattendue, fiche inconnue, type posé sur une fiche
regroupée dans une autre, fiches qui se désignent l'une l'autre. Une fiche qui
se désigne elle-même reste seule. Après un changement de décision, repartir d'une
base remise à zéro (un regroupement défait laisserait l'ancienne ligne en base ;
l'import le signale par « disparues du plan »).

## Comment l'import écrit

- Une transaction pour tout `plateforme.*` : un échec ne laisse rien.
- Les déclencheurs à effets (débit de pack, ordre au prestataire, document,
  alerte, recalcul) sont coupés par leur nom puis rétablis ; un déclencheur des
  tables cibles que `src/base.ts` ne classe pas arrête l'import.
- Chaque table : mise à jour des lignes qui diffèrent, insertion des absentes,
  puis relecture de chaque ligne du plan (contrôle de fin positif).
- La transaction est annulée si une table d'ordres, de documents, d'emails,
  d'alertes ou le journal d'audit a reçu une ligne.
- Le CO₂ est calculé par les fonctions de la base, une fois par collecte.
- Seul appel réseau : la Base Adresse Nationale, avec l'adresse postale des
  lieux, à débit modéré, réponses gardées en cache hors dépôt.

## Tests

```bash
pnpm test:module M5.1 M5.2 M5.3
```

La répétition entière sur fixtures inventées (import, rejeu, checks, sabotage,
remise à zéro) ne tourne que contre une base jetable **vide**, quand
`MIGRATION_BUBBLE_TEST_DATABASE_URL` est posée ; la CI, qui n'a pas de base, la
saute.
