# 05 - Spec d'injection — à destination de Claude Code

**Créé** : 2026-06-07 — **volet TMS ajouté le 2026-06-07**. Spec du mécanisme de seed (App + TMS). Claude Code écrit les scripts ; ce document est le contrat.

---

## 1. Commandes

```
npm run seed:minimal     # reset + injecte seed_minimal (< 30 s)
npm run seed:demo        # reset + injecte seed_demo (< 5 min)
npm run seed:jwt         # génère les JWT de test locaux (jamais commités)
npm run seed:check       # vérifie intégrité seed ↔ mocks API ↔ couverture
```

Environnement **dev uniquement** : les scripts refusent de s'exécuter si `SUPABASE_PROJECT_REF` ≠ projet dev (garde-fou hard-codé, vérifié avant toute écriture).

## 2. Déterminisme (anti-flaky — non négociable)

- **UUID** : uuid v5, namespace fixe `savr-fixtures`, nom = slug (`org_tr_kaspia`, `col_zd_palier_haut`…). Même slug = même UUID à chaque run, sur chaque machine.
- **Dates** : calculées depuis `SEED_REF_DATE = 2026-06-01` (constante du script), jamais `NOW()`. La matrice mois × traiteur (478 collectes) est **committée en CSV** dans `fixtures/data/` — le script la lit, il ne la génère pas.
- **Aucun Faker aléatoire** : si un générateur est utilisé, seed PRNG fixe.

## 3. Idempotence et reset

- Chaque ligne porte `metadata->>'seed_tag' = 'minimal' | 'demo'` (dev only, jamais en prod).
- Reset = `DELETE WHERE seed_tag IS NOT NULL` puis `INSERT`, dans l'ordre inverse des FK ; ou `TRUNCATE ... CASCADE` sur base dev vide. Relancer le script ne crée aucun doublon (upsert sur UUID déterministes).
- Ordre d'insertion (respect FK) : référentiel/paramètres → organisations → entites_facturation → users → lieux → organisations_lieux → associations/transporteurs/prestataires → grilles/tarifs → packs → événements → collectes → collecte_flux/attributions → tournees/collecte_tournees → factures/lignes/séquences → documents (bordereaux, attestations, rapports, exports) → fichiers → briefs → impact → emails/audit/outbox/integrations.

## 4. Contraintes spécifiques App

- **`sequences_facturation` gapless** : seedées en cohérence exacte avec les numéros des factures injectées (y compris la rejetée 4xx qui conserve son numéro — F4 §06.08).
- **Triggers** : l'injection passe par les INSERT normaux (triggers actifs) sauf données historiques figées (snapshots CO₂/taux, `cout/marge` calculés) injectées telles quelles — désactivation ciblée `session_replication_role = replica` UNIQUEMENT sur le bloc historique demo, documentée dans le script.
- **`shared.fichiers` + Storage** : PDF placeholder 1 page par fichier référencé, uploadés dans le bucket dev ; chemins déterministes.
- **RLS** : injection sous rôle service (bypass), mais `seed:check` relit sous chaque JWT de test pour valider le cloisonnement de base (1 requête par persona).
- **Auth** : users créés via `auth.admin` API (emails `@savr-test.local`, mot de passe commun dev `SavrTest2026!`), puis lignes `plateforme.users` liées.

## 5. `seed:check` — intégrité

1. Volumétrie conforme au [[01 - Catalogue]] (comptes par entité × dataset).
2. Tous les objets listés dans [[02 - Couverture règles métier]] existent (lookup par slug).
3. Tous les IDs référencés par les mocks de [[04 - Fixtures API]] existent dans le seed.
4. Zéro email hors `@savr-test.local`, zéro téléphone hors range fictif (scan).
5. Somme matrice CSV = 478 collectes ; séquences facturation sans trou.

Échec d'un check = exit code ≠ 0 (intégrable au harnais CI quality-loop).

## 5 bis. Volet TMS (2026-06-07)

- **Ordre cross-schema** : seed App complet d'abord, puis `tms.*` : référentiel TMS (`parametres_tms`, `formules_catalogue` — **fonctions SQL créées avant le seed**, validation `trg_formules_catalogue_impl_check` —, `types_vehicules`, `types_contenants`, `alertes_catalogue`, `secrets_metadata`) → prestataires/users_tms/chauffeurs/vehicules → grilles → collectes_tms → tournees/collecte_tournees → pesees/incidents → rolls/stocks/passages_veolia → factures_prestataires → alertes/suggestions/logs.
- **Miroir 1:1 déterministe** : `collectes_tms` dérivées de la matrice CSV App par transformation déterministe (même namespace uuid v5 : slug App → slug TMS préfixé `ctms_`). La dérivation collecte → tournée est un **2e CSV committé**.
- **Coûts/marges historiques figés** (R2.8) : injectés tels quels (`session_replication_role = replica` sur le bloc historique demo, comme App) ; les tournées « courantes » passent par les triggers normaux (`trg_m07_calc_cost`).
- **Lot migration** : injecté avec `migration_mode_active = true` le temps du bloc avril 2026, puis le paramètre est remis à sa valeur de seed (false).
- **Grilles réelles (2026-06-07)** : les montants Strike (vacations 16/20 m³), Marathon (forfait 100 €/tournée) et A Toutes! vélo (8 cellules) sont les **grilles négociées réelles** — committés dans `fixtures/data/grilles.json`, source §05 TMS R2.2-R2.5. Ne pas les régénérer ni les arrondir. `seed:check` vérifie le cas de référence Val : tournée Strike 16 m³ de 6 h équipage simple = **360 €**.
- **Everest** : zéro ligne `everest_missions` (🔒 GATE) — le script porte un bloc commenté `// GATE EVEREST`.
- **Mêmes commandes** : `seed:minimal` / `seed:demo` injectent App + TMS d'un seul tenant (pas de commande séparée — le miroir 1:1 interdit un seed TMS isolé).
- **Bascule V1/V2** : si le schéma `tms` n'existe pas (dev V1 Plateforme), le bloc TMS est sauté proprement et `plateforme.tournees` est peuplée par le **miroir MTS-1 (60 tournées)**. Si le schéma `tms` existe (dev V2), le miroir MTS-1 n'est PAS injecté : `plateforme.tournees` est peuplée depuis le CSV tournées TMS (sémantique S3, `acceptee` → `planifiee`). Jamais les deux.

`seed:check` étendu TMS :

1. Count `collectes_tms` = count collectes App dispatchées + 2 manuelles + 1 orpheline.
2. Σ tournées CSV = ~370, ratio 1,3 ±0,05 ; périodes `factures_prestataires` jointives sans chevauchement (R3.8).
3. Payloads `fixtures/api/tms/` valides Ajv contre `savr-api-contracts` (21/21).
4. Tous les objets du volet TMS de [[02 - Couverture règles métier]] présents (lookup slug).
5. Zéro ligne `everest_missions` tant que le gate est actif.

## 6. Documentation

`CLAUDE.md` (généré au handoff) documente : quand réinjecter (après migration destructive, avant suite E2E), les 4 commandes, l'interdiction d'inventer des données hors seed, et le renvoi vers ce dossier `05 - Fixtures/` comme source de vérité.
