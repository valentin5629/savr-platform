# 05 - Estimation tokens et durée

> Estimations **input + output cumulés** par module (incluant contexte chargé, itérations, tests + corrections ~50%, tooling). Incertitude intrinsèque ±50% sur un 1er build. Source de vérité des budgets pour les autres docs de la roadmap.

---

## Hypothèses de coût

- **Split tokens** : ~85% input / 15% output (agentic coding typique).
- **Tarifs API 2026** (à confirmer) : Sonnet 3 $/Mtok in, 15 $/Mtok out → **blended 4,8 $/Mtok**. Opus 15 $/Mtok in, 75 $/Mtok out → **blended 24 $/Mtok**.
- **FX** : ≈ 0,92 €/$ (indicatif) → **Sonnet ≈ 4,4 €/Mtok**, **Opus ≈ 22 €/Mtok**.
- **Prompt caching** : l'input représente 85% des tokens ; le caching réduit l'input réutilisé de 50-90%. Les coûts ci-dessous sont **sans caching (majorant)** ; le réaliste est souvent 40-60% plus bas. Une ligne « avec caching » est donnée sur les totaux.

---

## Niveau 0 — Foundations

| Module                 | Cat. |    Tokens | Sonnet (€) | Opus (€) |
| ---------------------- | ---- | --------: | ---------: | -------: |
| 0.1 Setup tooling      | S    |      150k |        0,7 |      3,3 |
| 0.2 Setup Supabase     | XS   |       50k |        0,2 |      1,1 |
| 0.3 Schéma DB complet  | XL   |    1 500k |        6,6 |     33,0 |
| 0.4 RLS policies       | XL   |    1 500k |        6,6 |     33,0 |
| 0.5 Auth + JWT         | M    |      400k |        1,8 |      8,8 |
| 0.6 pgTAP RLS 100%     | L    |      800k |        3,5 |     17,6 |
| 0.7 Seed minimal/demo  | M    |      300k |        1,3 |      6,6 |
| 0.8 UI base            | M    |      450k |        2,0 |      9,9 |
| 0.9 Logging + Sentry   | S    |      180k |        0,8 |      4,0 |
| 0.10 Audit trail       | S    |      150k |        0,7 |      3,3 |
| 0.11 Mocks API tierces | M    |      250k |        1,1 |      5,5 |
| **Sous-total N0**      |      | **5,73M** |    **~25** | **~126** |

## Verticale 1 — Cycle traiteur ZD

| Module | Cat. | Tokens | Sonnet (€) | Opus (€) |
|---|---|---:|---:|---:|
| M1.1 Back-office référentiel + collectes | L+ | 1 400k | 6,2 | 30,8 |
| M1.2 Formulaire ZD | L | 700k | 3,1 | 15,4 |
| M1.3 Tarification ZD | S/M | 200k | 0,9 | 4,4 |
| M1.4 États + Outbox | M/L | 600k | 2,6 | 13,2 |
| M1.5 Adapter MTS-1 polling (3 sous-lots) | XL | 1 900k | 8,4 | 41,8 |
| M1.6 PDF ZD (+ transverses A/B) | L | 900k | 4,0 | 19,8 |
| M1.7 Pennylane ZD | L | 800k | 3,5 | 17,6 |
| M1.8 E2E cycle ZD (gate verticale) | M | (300k — imputé ligne E2E) | — | — |
| **Sous-total V1** | | **6,50M** | **~29** | **~143** |

## Verticales V2-V5 (squelettes — à raffiner à la génération du brief)

| Verticale | Modules | Tokens | Sonnet (€) | Opus (€) |
|---|---|---:|---:|---:|
| V2 — Cycle traiteur AG | M2.1-M2.6 (algo L, Everest 🔒) | 4,0M | ~18 | ~88 |
| V3 — Espaces clients & dashboards | M3.1-M3.5 (6 rôles, UI+RLS) | 3,3M | ~15 | ~73 |
| V4 — Reporting/exports/registre | M4.1-M4.3 (transverse D) | 1,4M | ~6 | ~31 |
| V5 — Migration Bubble + go-live | M5.1-M5.4 (scripts) | 1,8M | ~8 | ~40 |
| **Sous-total V2-V5** | | **10,5M** | **~47** | **~232** |

## Transverses émergents A-H

Posés au 1er usage **dans le budget du module de 1er usage** (C en 0.5, E/B/A/G en V1, D en V4). **Pas de ligne séparée** (anti double-comptage). H différé V2.

---

## Total V1

| Poste | Tokens | Sonnet (€) | Opus (€) |
|---|---:|---:|---:|
| Niveau 0 (révisé +0.11) | 5,73M | 25 | 126 |
| V1 (révisé M1.5 1,9M ; M1.8 imputé ligne E2E) | 6,50M | 29 | 143 |
| V2 | 4,0M | 18 | 88 |
| V3 | 3,3M | 15 | 73 |
| V4 | 1,4M | 6 | 31 |
| V5 | 1,8M | 8 | 40 |
| Tests E2E transverses (dont M1.8) + k6 charge (S1+S4) | 1,9M | 8 | 42 |
| **Sous-total** | **24,6M** | **~109** | **~543** |
| Buffer +30% (incertitude 1er build) | +7,4M | +33 | +163 |
| **TOTAL (sans caching)** | **~32M** | **~142 €** | **~710 €** |
| **TOTAL réaliste (avec caching)** | — | **~85-145 €** | **~410-710 €** |

**Fourchette** : 26M (bien cadré, caching agressif) → 43M (dérives, reprises). En €, Sonnet **~85-190 €**, Opus **~410-950 €**.

> Plus bas que la fourchette générique du skill (Sonnet 200-400 €, Opus 1000-2000 €) car : (1) le **TMS natif est hors V1** (économie majeure vs CDC complet) ; (2) prompt caching pris en compte.

---

## Durée

Le facteur limitant n'est **pas** la vitesse de code mais le **rythme de validation de Val** (checkpoint humain entre chaque module/sous-lot). Estimation calendaire : **8-11 semaines** (cf. `16 - Roadmap`), bas de fourchette si validation continue. ~24 modules dev + 4 migration, dont 4 modules XL découpés en sous-lots → **~34 sessions** Claude Code avec checkpoint (le découpage en sous-lots ajoute des checkpoints, pas du périmètre).

---

## Discipline tokens (non négociable)

- Ne jamais charger un CDC entier — uniquement les sections du module (depuis `_DEV-FACING/`).
- Sessions < 2h, redémarrer si dérive.
- Brief précis + critère de fini binaire ; refuser les « essaie de voir ».
- **Dépassement > +50% du budget module = signal d'alerte** : stopper, analyser, reprendre le brief.
- Mesurer la conso réelle à chaque module (cf. `06 - Suivi exécution`) et réajuster les suivants.
