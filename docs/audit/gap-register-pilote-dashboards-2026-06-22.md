# Registre d'audit de conformité CDC -> code — Section Dashboards (M3.x)

_Date : 2026-06-22 — Branche : fix/converge-enums-valeurs-c-cible-g1_

## 1. Résumé chiffré

| Indicateur                           | Valeur |
| ------------------------------------ | ------ |
| Livrables analysés (section)         | 98     |
| Implémentés                          | 48     |
| Partiels                             | 20     |
| **Écarts confirmés (confirmed_gap)** | **30** |
| Faux positifs                        | 7      |
| Descopes intentionnels               | 0      |
| En attente de module (pending)       | 1      |

Répartition des écarts par sévérité : **critique 0 · élevé 0 · moyen 26 · faible 4**.

Lecture : aucun écart de sécurité, de facturation ou de perte de donnée. L'intégralité des écarts porte sur des **livrables présentationnels (data-viz, filtres multi-dimensions, navigation au clic, colonnes de tableau, parité UI)** et deux **bugs de filtre d'enum** rendant des KPI Admin silencieusement nuls. La donnée sous-jacente reste correcte et, le plus souvent, accessible par un autre chemin.

## 2. Tableau des écarts (trié sévérité décroissante, puis module)

| #   | Sévérité | Module | Livrable                                      | Type                     | Attendu (résumé)                                            |
| --- | -------- | ------ | --------------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| 1   | moyen    | M3.5   | dash-admin-bloc1-carte-non-transmises         | bug filtre enum          | Carte 'Non transmises ZD/AG' avec counts réels splittés     |
| 2   | moyen    | M3.5   | dash-admin-bloc1-carte-zd-48h                 | bug filtre enum          | Carte 'ZD dans 48h' comptant les collectes ZD imminentes    |
| 3   | moyen    | M3.5   | dash-admin-bloc1-cartes-cliquables-filtre     | fonctionnalité manquante | 5 cartes-actions Bloc 1 cliquables vers Collectes filtré    |
| 4   | moyen    | M3.5   | dash-admin-bloc2-histogramme-12mois           | composant orphelin       | Histogramme 12 mois empilé ZD/AG monté                      |
| 5   | moyen    | M3.5   | dash-admin-bloc2-histogramme-toggle           | composant orphelin       | Toggle Montant HT / Nb collectes atteignable                |
| 6   | moyen    | M3.5   | dash-admin-bloc2-histogramme-statuts-factures | composant orphelin       | Histogramme alimenté factures emise/payee                   |
| 7   | moyen    | M3.5   | dash-admin-bloc2-histogramme-avoirs-negatif   | composant orphelin       | Avoirs affichés en négatif dans l'histogramme               |
| 8   | moyen    | M3.5   | dash-admin-bloc2-tableau-revenus-org          | fonctionnalité partielle | Sélecteur période (défaut mois en cours) + 6 colonnes       |
| 9   | moyen    | M3.5   | dash-admin-bloc2-tableau-colonnes             | fonctionnalité partielle | Colonnes nb/montant ZD et AG (2 livrées sur 6)              |
| 10  | moyen    | M3.5   | dash-admin-bloc2-tableau-export-csv           | fonctionnalité manquante | Export CSV du tableau Revenus                               |
| 11  | moyen    | M3.1   | dash-traiteur-filtres-globaux-5               | fonctionnalité manquante | 5 filtres globaux traiteur (1 livré)                        |
| 12  | moyen    | M3.1   | dash-traiteur-kpi-cartes-clickables           | fonctionnalité partielle | Toutes les cartes KPI cliquables (1 par onglet)             |
| 13  | moyen    | M3.1   | dash-traiteur-bloc2-zd-barres-empilees-5flux  | composant manquant       | Bloc 2 ZD barres empilées 5 flux                            |
| 14  | moyen    | M3.1   | dash-traiteur-bloc2-ag-courbe                 | composant manquant       | Bloc 2 AG courbe évolution mensuelle                        |
| 15  | moyen    | M3.1   | dash-traiteur-benchmark-filtres-dedies-4      | fonctionnalité manquante | Encart filtres benchmark 4 dimensions                       |
| 16  | moyen    | M3.1   | dash-traiteur-bloc3-ag-top-associations       | composant manquant       | Bloc 3 AG top associations                                  |
| 17  | moyen    | M3.1   | dash-traiteur-bloc4-zd-donut                  | composant manquant       | Bloc 4 ZD donut répartition tonnages                        |
| 18  | moyen    | M3.1   | dash-traiteur-bloc5-zd-prochaines-collectes   | composant manquant       | Bloc 5 ZD prochaines collectes                              |
| 19  | moyen    | M3.1   | dash-traiteur-bloc5-ag-prochaines-collectes   | composant manquant       | Bloc 5 AG prochaines collectes                              |
| 20  | moyen    | M3.1   | dash-traiteur-bloc6-zd-top5-lieux             | composant manquant       | Bloc 6 ZD Top 5 lieux                                       |
| 21  | moyen    | M3.1   | dash-traiteur-bloc6-ag-top5-lieux             | composant manquant       | Bloc 6 AG Top 5 lieux                                       |
| 22  | moyen    | M3.1   | dash-traiteur-bloc7-zd-top5-commerciaux       | composant manquant       | Bloc 7 ZD Top 5 commerciaux                                 |
| 23  | moyen    | M3.1   | dash-traiteur-bloc7-ag-top5-commerciaux       | composant manquant       | Bloc 7 AG Top 5 commerciaux                                 |
| 24  | moyen    | M3.2   | dash-gest-filtres-globaux-5                   | fonctionnalité manquante | 5 filtres globaux gestionnaire (1 livré)                    |
| 25  | moyen    | M3.2   | dash-gest-benchmark-filtres-dedies-5          | fonctionnalité manquante | Encart filtres benchmark 5 dimensions                       |
| 26  | moyen    | M3.2   | dash-gest-kpi-cartes-clickables-evenements    | fonctionnalité partielle | Cartes KPI cliquables vers Événements                       |
| 27  | moyen    | M3.2   | dash-gest-bloc2-zd-barres-5flux               | composant manquant       | Bloc 2 ZD barres empilées 5 flux                            |
| 28  | moyen    | M3.2   | dash-gest-bloc2-ag-courbe                     | composant manquant       | Bloc 2 AG courbe évolution mensuelle                        |
| 29  | moyen    | M3.2   | dash-gest-bloc3-ag-top-associations           | composant manquant       | Bloc 3 AG top associations                                  |
| 30  | moyen    | M3.2   | dash-gest-bloc4-zd-donut                      | composant manquant       | Bloc 4 ZD donut répartition tonnages                        |
| 31  | moyen    | M3.2   | dash-gest-bloc5-prochaines-collectes          | composant manquant       | Bloc 5 prochaines collectes ZD/AG                           |
| 32  | moyen    | M3.2   | dash-gest-bloc6-top5-lieux                    | composant manquant       | Bloc 6 Top 5 lieux ZD/AG                                    |
| 33  | moyen    | M3.2   | dash-gest-bloc7-top5-traiteurs                | composant manquant       | Bloc 7 Top 5 traiteurs ZD/AG                                |
| 34  | moyen    | M3.2   | dash-gest-bloc8-export-pdf                    | parité UI manquante      | Bouton synthèse PDF (stub) absent (présent traiteur/agence) |
| 35  | moyen    | M3.2   | dash-gest-bouton-programmer-evenement         | fonctionnalité manquante | Bouton 'Programmer un événement' (aucun point d'entrée)     |
| 36  | faible   | M3.1   | dash-traiteur-bloc8-zd-export-pdf             | fonctionnalité manquante | Synthèse PDF à la demande (stub V4 non adossé à descope)    |
| 37  | faible   | M3.3   | dash-agence-branding-pdf                      | fonctionnalité manquante | Logo agence en page de garde synthèse PDF                   |
| 38  | faible   | M3.5   | dash-admin-picto-plaque-tms                   | fonctionnalité manquante | Picto plaque TMS vert/gris                                  |

> Note de numérotation : la liste 'gaps' structurée contient 30 entrées confirmed_gap. Le tableau ci-dessus comptabilise séparément certains items mutualisés (Bloc 2 histogramme Admin éclaté en 4 sous-livrables CDC, blocs traiteur/gestionnaire par onglet) reflétant la granularité réelle des verdicts.

## 3. Cause racine

Les 30 écarts confirmés ne sont pas des régressions de code : ce sont des **omissions de transcription CDC -> manifeste**. Les gates qualité en place (typecheck, lint, Vitest, pgTAP RLS/outbox, anti-coupling) mesurent toutes **code vs manifeste**, jamais **code vs CDC**. Quand un bloc (Bloc 2/4/5/6/7), une colonne ou une dimension de filtre n'atteint pas le manifeste, il devient invisible à toute la chaîne de contrôle. Symptômes :

- **Manifestes au grain feature** : M3.1 = « KPIs + jauges benchmark + pack AG », M3.2 = 3 tests KPI. Les blocs présentationnels n'y figurent pas.
- **Composants orphelins** : RevenusHistogramme est livré, testé, conforme à la spec — mais monté sur aucune page, donc 4 livrables Bloc 2 Admin inatteignables.
- **Ruptures de parité inter-rôles** : Bloc 8 (bouton synthèse PDF stub) présent chez traiteur et agence, absent chez gestionnaire.
- **Bugs masqués par mocks** : 2 KPI Admin renvoient toujours 0 (filtre `.eq('type','zd')` contre un enum `zero_dechet/anti_gaspi`), bug invisible car le test mocke entièrement Supabase.

## 4. Volet prévention

1. **Gate CI `check:spec-deliverables`** — diffe les livrables énumérés du CDC (cartes, blocs numérotés, colonnes, filtres, boutons) contre le manifeste du module ; tout item CDC absent fait échouer le build. Cible directement la cause racine de 28 des 30 gaps.
2. **Manifestes au grain livrable atomique** — une ligne par bloc (Bloc 1..8), par colonne de tableau, par dimension de filtre ; interdiction des manifestes au grain « feature » qui masquent les composants présentationnels.
3. **Mandat reviewer `conformite-spec` étendu aux livrables présentationnels** (data-viz, filtres, navigation au clic, parité UI inter-rôles) avec statut explicite « à vérifier manuellement » — angle mort des tests automatisés.
4. **Lint garde anti-littéraux `'zd'`/`'ag'` sur `collectes.type`** dans les routes de lecture ; normalisation centralisée. Évite les KPI silencieusement nuls.
5. **Interdiction des mocks complets de la chaîne Supabase** sur les tests KPI/dashboard ; exécution contre DB seedée réelle.
6. **Règle CI `no-orphan-exported-component`** — tout composant exporté du barrel dashboards doit être importé par au moins une page non-test.
