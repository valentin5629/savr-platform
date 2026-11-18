# Tests de charge (k6)

Scénarios bloquants avant la production, du CDC
`specs/cdc/01 - Cahier des charges App/08 - Performance/04 - Scenarios de charge.md` :

| Script | Scénario | Charge par défaut | Succès |
|---|---|---|---|
| `s1_nominal.js` | 1 — Charge nominale | 50 utilisateurs, montée 2 min, 30 min | p95 et p99 du `02 - SLA par endpoint`, erreurs < 0,1 % |
| `s4_endurance.js` | 4 — Endurance | 25 utilisateurs, 24 h | idem, et p95 de la dernière heure < p95 de la 2e heure + 20 % |

Les p99 font aussi échouer le run. Le `02 - SLA par endpoint` les définit comme
un plafond (« 1 % des requêtes ne doit pas dépasser ce plafond ») ; le scénario
1 ne cite que les p95. Choix plus strict que la lettre du scénario : un p99
dépassé se lit dans le résumé, ligne `p(99)`.

Les scénarios 2, 3 et 5 (V1.1) ne sont pas écrits. Le scénario 2 (pic à 150
utilisateurs, 80 % d'écritures) buterait sur le frein de débit des espaces
clients avec les 8 traiteurs du jeu de données : il demande d'abord plus
d'organisations de test.

## Ce que le run fait sur dev

- **Cible : dev seulement.** `BASE_URL` n'a pas de valeur par défaut ; la
  production est refusée par une liste blanche d'hôtes (`lib/config.js`).
- **Lectures** : écrans et API des traiteurs (tableau de bord, liste et fiche
  d'événement, fiche collecte, registre, export) et de l'équipe Savr (tableau
  de bord Admin, liste des collectes, fiche d'événement, export). Le registre
  est réservé aux rôles clients.
- **Mix réel** : seuls les traiteurs écrivent ; l'équipe Savr (6 utilisateurs
  sur 50 en S1, 3 sur 25 en S4) ne fait que lire. Les requêtes sont donc
  autour de 72 % lecture, 21 % écriture, 7 % export, au lieu de 70/25/5. Le
  « batch » du CDC est joué par un export CSV des collectes, pas par un batch
  de documents (scénario 3, non écrit).
- **Écritures : des brouillons seulement.** Chaque cycle crée un brouillon de
  programmation, le modifie, le supprime. Un brouillon n'envoie rien à MTS-1
  ni à Everest et ne part par aucun email. Une programmation **confirmée**
  enverrait de vraies commandes aux prestataires depuis dev : le harnais n'en
  fait jamais. Les brouillons portent le préfixe `[charge]` ; ceux qu'un run
  interrompu laisserait sont supprimés au `teardown` du run suivant.
- **Ce qui reste écrit** : journaux (connexions, audit) et sessions de
  connexion des comptes de test.

### Ce que le run ne mesure pas

- L'écriture d'un ordre de collecte dans la file : ni l'ordre de création E1
  (programmation confirmée), ni l'ordre de modification E2. Le brouillon passe
  par la même fonction SQL, sans l'ordre. Écart probable de quelques
  millisecondes, non mesuré.
- **La mémoire des serveurs (scénario 4).** Le CDC demande « pas de fuite
  mémoire (RSS stable côté Vercel/Railway) ». Ni k6 ni `echantillonner-base.sh`
  ne la voient : la relever à la main pendant et après le run (Vercel :
  Observability du projet, mémoire des fonctions ; Railway : onglet Metrics du
  service PDF).
- La production : même code, mais ni la même base (taille de l'instance,
  `max_connections` = 60 mesuré sur dev le 2026-11-15), ni le même volume.
- **Le volume An 1.** Le CDC demande `seed_demo` chargé au volume An 1
  (~300 k lignes). Dev en compte bien moins (847 collectes le 2026-11-15) : un
  run sur dev tel quel est optimiste sur les écrans dont le coût croît avec
  l'historique (tableaux de bord, registre, exports).

## Prérequis

- k6 installé (`brew install k6`).
- Variables (celles de dev sont dans le `.env.local` du clone principal) :
  - `BASE_URL` : `https://dev.app.gosavr.io` ;
  - `MOT_DE_PASSE` : mot de passe des comptes du seed (`SEED_PASSWORD`) ;
  - `PROTECTION_BYPASS` : contournement de la protection Vercel
    (`PROTECTION_BYPASS_DEV`), envoyé en en-tête.
- Pour les critères base : `DATABASE_URL` de savr-dev et `psql`.

## Lancer

Depuis `tests/load/` (les résultats vont dans `resultats/`, non versionné) :

```bash
mkdir -p resultats
```

Fumée (2 utilisateurs, 1 min) avant tout vrai run :

```bash
VUS=2 NB_EQUIPE=1 DUREE=1m MONTEE=10s PAUSE_MIN_S=2 PAUSE_MAX_S=4 k6 run s1_nominal.js
```

Scénario 1, avec le relevé de la base à côté :

```bash
bash echantillonner-base.sh 30 > resultats/s1-base.csv
```

```bash
k6 run --summary-export resultats/s1-resume.json s1_nominal.js
```

Scénario 4 (24 h ; `DUREE=2h` pour un essai raccourci) :

```bash
k6 run s4_endurance.js
```

Réglages : `VUS`, `NB_EQUIPE` (utilisateurs de l'équipe Savr, en tête),
`DUREE`, `MONTEE`, `PAUSE_MIN_S` / `PAUSE_MAX_S` (temps de réflexion entre
deux écrans, 15 à 30 s par défaut).

## Lire le résultat

- **Code de sortie ≠ 0** : un seuil est dépassé. Le résumé de k6 marque en
  rouge la ligne fautive ; chaque requête porte un tag `sla` (catégorie du CDC)
  et un `name` (route).
- `reponses_429` > 0 : le profil a dépassé le frein de débit (100 écritures
  par organisation sur 10 min). Le run ne mesure alors plus la plateforme :
  allonger les pauses ou réduire le nombre d'utilisateurs.
- `duree_pages` : temps des pages (rendu serveur), pour information ; les
  seuils du CDC portent sur les API qui les alimentent.
- `requetes_par_nature` : mix réel (voir « Mix réel » plus haut).
- Une catégorie sans aucune requête passe son seuil sans rien dire
  (comportement de k6) : vérifier qu'elle a un nombre de requêtes dans le
  résumé. Un compte dont le formulaire n'a ni lieu ni type d'événement ne crée
  aucun brouillon : le seuil `checks` échoue et le journal du run nomme le
  compte (une ligne « formulaire sans … »).
- Scénario 4 : la ligne « Dégradation » n'agit pas sur le code de sortie
  (limite de k6) ; la lire, ou `resultats/s4-degradation.json`.
- `resultats/s1-base.csv` : connexions (critère : < 80 % de `max_connexions`)
  et files (`jobs_pdf_en_attente` ne doit pas monter sans redescendre).

Les durées sont prises depuis le poste qui lance k6 : elles incluent
l'aller-retour réseau jusqu'à Vercel, que le CDC ne compte pas.
