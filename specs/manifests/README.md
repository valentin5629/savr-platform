# Manifestes de couverture par module

Artefacts **authored** (exception CLAUDE.md : éditables à la main, **non dérivés** du Vault). Ils doivent rester du **JSON valide** (`specs/` est ignoré par prettier → valider via le JSON Schema / les gates).

## Grain LIVRABLE (Lot 0 / R0b)

Cause racine de l'audit conformité CDC→code (2026-06-23) : les gates mesuraient **code vs manifeste**, jamais **code vs CDC**, et les manifestes étaient au **grain scénario** (`scenarios[]` seul) → un livrable du CDC non transcrit y était **invisible**.

R0b ajoute, **à côté de `scenarios[]` (conservé)**, un tableau **`deliverables[]` au grain livrable** : 1 entrée = 1 livrable atomique du CDC (policy / colonne / event / bloc UI / action audit / endpoint / règle SI-ALORS).

### Fichiers

| Fichier | Rôle |
|---|---|
| `M*.json` | Manifeste de module. Doit porter `module` + `deliverables[]` (+ `scenarios[]` historique). |
| `_schema.json` | JSON Schema du manifeste (grain livrable). Source de vérité de la structure `deliverables[]`. |
| `cdc-deliverables.index.json` | Index des livrables **atomiques** du CDC (seedé depuis l'audit = 1er diff CDC↔manifeste fait à la main). Diffé par G1. |

### Schéma d'un `deliverable`

```jsonc
{
  "id": "BL-P0-01",                          // = id ticket backlog si existant (traçabilité audit↔manifeste↔index), sinon <module>-<slug>
  "ref_cdc": "specs/cdc/…/04 - Data Model.md:1483", // fichier:ligne du CDC (ligne précise attendue ; fichier seul toléré au seed)
  "artefact": "supabase/migrations/…sql",    // chemin code, ou null si pas encore implémenté
  "test": "M1.8 › dérivation collecte_flux", // id/titre exact du test, ou null (à-vérifier / partial)
  "statut": "implemented",                   // implemented | partial | descoped | à-vérifier
  "ref_divergence": "BLOC7_20260624.md",     // requis SSI statut=descoped
  "libelle": "dérivation collecte_flux (recalcul UPSERT)"
}
```

**Énum `statut`**
- `implemented` — livrable réalisé **et** testé.
- `partial` — **déclaré au manifeste** mais implémentation incomplète / en attente d'un lot de fix R* (ferme la cause racine : le livrable est transcrit donc **visible**).
- `descoped` — hors scope V1 ; exige `ref_divergence` (fichier `_Divergences/` ou décision Val tracée).
- `à-vérifier` — livrable **présentationnel** non testable-auto (badge, timeline `audit_log`, tokens DS, watermark) → mappe la discipline **GO-VISUAL** du reviewer conformité-spec (preuve screenshot/Loom exigée en PR, jamais GO implicite).

## Gates (mode RAPPORT, T0)

| Gate | Script / job CI | Vérifie |
|---|---|---|
| **G2** grain livrable | `pnpm check:manifest-grain` · job `manifest-grain` | Chaque manifeste valide vs `_schema.json` ; rejette le grain scénario-seul. |
| **G1** couverture CDC | `pnpm check:spec-deliverables` · job `spec-deliverables` | Diff `cdc-deliverables.index.json` ↔ union des `deliverables[]`. Un livrable CDC non transcrit (et non descopé) = signalé. |
| (rappel) couverture test | `pnpm check:coverage` | `scenarios[]` → test (par titre exact). **Inchangé** : G1/G2 ajoutent une couche, ne le remplacent pas. |

Les deux gates sont `continue-on-error: true` (mode rapport) : résumé `$GITHUB_STEP_SUMMARY` + compteur de burn-down, **exit 0**. **Flip bloquant (T1)** par périmètre/module, derrière le lot de fix correspondant (cliquet) — cf. `30. Review Code/Backlog final priorisé/Lot 0 …`.

## Couverture R0b (P0-modules-first)

- **Re-grainés au grain livrable** : tous les manifestes existants (amorçage `deliverables[]` depuis `scenarios[]`) + **transcription des gaps** de l'audit pour les modules du chemin P0 (R1→R7) : `M1.8`, `M1.5a`, `M1.4`, `M2.3`, `M2.5`, `M0.6`.
- **Souches créées** (modules à livrables P0 sans manifeste) : `M0.4` (auth/onboarding/RGPD), `M2.4` (PDF AG attestation + paramètres CO2), `M3.5` (dashboard Admin KPI/blocs).
- **Reste** : transcription des gaps non-P0 **au fil de l'eau**, par chaque lot de fix (R8→R23), qui flippe alors le gate de son module/cluster.

> ⚠️ `cdc-deliverables.index.json` est **plus granulaire** (147 livrables atomiques) que le compteur réconcilié de l'audit (~118 distincts) : l'index n'agrège pas les atomes consolidés du backlog. C'est volontaire (sur-atomisation = direction sûre). 3 descopes V2 tracés (watermark PDF, alerte + seuils pesées g/pax).

### Modules encore SANS manifeste (à traiter par leur lot ou G10/R0c)

`M0.1`, `M0.2`, `M0.3`, `M1.2` (formulaire programmation → R12), `M1.5b` (polling entrant MTS-1), `M2.2` — pas de livrable **P0** → non créés en R0b (NOTÉS). La **complétude inverse** (chaque section §M-N du CDC ⇒ un manifeste) est le mandat de **G10** (R0c). Leurs livrables CDC restent visibles dans `cdc-deliverables.index.json` (G1) jusqu'à transcription.
