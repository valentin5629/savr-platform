# savr-api-contracts

Schémas **JSON Schema (draft 2020-12)** du contrat API **Plateforme Savr ↔ Savr TMS**. Source de vérité unique pour les *contract tests* des deux apps (la CI de chaque app valide ses payloads émis contre ces schémas avant déploiement).

> Pendant exécutable du document [[../08 - Contrat API Plateforme-TMS|§08 Contrat API]]. Toute modif d'un payload doit être répercutée ici **et** dans la prose §08 (des 2 CDC).

## Statut

- Version contrat : **`2026.04`** (header HTTP `X-API-Version` autoritatif).
- Créé 2026-06-03 (Bloc 2, résolution §08 Q1). Validé Ajv v8 : **21/21 cas** (`npm test`).
- ⚠ **Contrat vivant** : le contrat Plateforme↔TMS ne s'active qu'au **temps 2** (en temps 1 la Plateforme parle à MTS-1). Le data model Plateforme V1 aura évolué d'ici là → **re-auditer ces schémas au démarrage du dev TMS** avant de coder contre eux.

## Structure

```
schemas/
  common.schema.json          # $defs : enveloppe, enums normalisés, sous-objets (lieu, contacts, pesee...), réponses
  entrants/                   # Plateforme → TMS
    E1.collecte-creee.json    # POST   /collectes
    E2.collecte-modifiee.json # PATCH  /collectes/:id
    E3.collecte-annulee.json  # DELETE /collectes/:id
    E5.lieu-upsert.json       # PATCH  /lieux/:id
  sortants/                   # TMS → Plateforme (webhooks)
    S1.collecte-acceptee.json
    S2.collecte-refusee.json
    S3.tournee-upsert.json
    S4.collecte-en-cours.json
    S5.collecte-terminee.json
    S7.plaque-saisie.json
    S9.incident.json
    S11.collecte-rejetee.json
validate.mjs                  # contract tests (Ajv)
```

Chaque schéma d'endpoint `$ref` les `$defs` de `common.schema.json` via `$id` absolu (`https://contracts.gosavr.io/2026.04/...`). **Un enum n'est défini qu'une fois**, dans le commun.

## Conventions

- **Enveloppe commune** sur tous les payloads : `{ event_id, emis_le?, occurred_at, source, type, data }`. `source` ∈ `plateforme|tms`, `type` verrouillé en `const` par endpoint. Champ `version` retiré du payload (header autoritatif, Bloc B B3).
- **`additionalProperties: false`** partout → tout champ non déclaré est rejeté (attrape typos + champs périmés).
- Identifiants UUID, montants en centimes (integer), poids en grammes (integer), timestamps ISO 8601 UTC, photos = URL signée Supabase Storage.

## Normalisations vs prose §08 (à valider en `coherence-inter-cdc`)

- `type` sortant **sans préfixe `tms.`** (`collecte.acceptee`, pas `tms.collecte.acceptee`).
- **S7** ramené au format commun (enveloppe + `data`) — la prose montrait un payload plat.
- **`gravite` S9** = `warning|critical` (2 valeurs ; `info` retirée sobriété §04).
- **`data.type` S5** = `cloture` (sans accent).

## Lancer les tests

```bash
npm install
npm test
```

## Questions infra ouvertes (hors schémas)

- §08 Q5 : host du repo (GitHub / GitLab / monorepo Nx) — à trancher avant le 1er commit réel.
- §08 Q7 : timestamps tout-UTC, conversion Europe/Paris en affichage uniquement — à confirmer avec les devs.
