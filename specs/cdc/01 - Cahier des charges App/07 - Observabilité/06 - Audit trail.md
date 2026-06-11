# 07 - Observabilité — 06 - Audit trail

> ⚠ **La table `audit_log` est déjà définie dans `04 - Data Model`** (intégrée 2026-06-07, F1 session test-scenarios §06.06). **Ce fichier ne la redéfinit pas** — il fixe le périmètre fonctionnel : quelles actions sont auditées, la rétention, et la frontière avec les logs.
>
> Arbitrage OBS-2 : audit trail = **écritures sensibles seulement** (pas de log de consultation/lecture en V1).

---

## 1. Rappel structure (source : `04 - Data Model`)

Table `plateforme.audit_log`, **append-only et immuable** (aucun UPDATE/DELETE). Écriture **jamais par l'API directe** : INSERT via triggers DB et code serveur (`SERVICE_ROLE` / `SECURITY DEFINER`). RLS : `SELECT` = `admin_savr` + `ops_savr` ; deny tout autre rôle.

Colonnes clés : `user_id`, `impersonator_id`, `role_auteur` (snapshot figé), `action` (snake_case), `table_cible`, `entite_id`, `ancienne_valeur` (jsonb), `nouvelle_valeur` (jsonb), `motif`, `details` (jsonb), `created_at`. Index `(table_cible, entite_id, created_at DESC)`, `(action)`, `(user_id)`.

> Toute évolution de schéma se fait dans `04 - Data Model`, pas ici.

---

## 2. Actions sensibles auditées V1 (périmètre fonctionnel)

Une action est auditée si elle touche **finances, fiscalité, sécurité ou intégrité d'une donnée réglementaire**. Catalogue figé (chaque ligne = une valeur `action`) :

### Financier / facturation

| `action`                        | `table_cible`           | Déclencheur                                 |
| ------------------------------- | ----------------------- | ------------------------------------------- |
| `facture_emise`                 | `factures`              | Validation Admin → Pennylane                |
| `facture_avoir_cree`            | `factures`              | Émission d'un avoir                         |
| `facture_numero_attribue`       | `sequences_facturation` | Attribution numéro gapless                  |
| `tarif_refacture_pax_zd_update` | `organisations`         | Modif tarif refacturé (déjà tracé §04)      |
| `parametres_algo_update`        | `parametres_algo`       | Modif paramètre algo/tarif (déjà tracé §04) |
| `parametres_co2_divers_update`  | `parametres_co2_divers` | Modif facteur CO₂ (déjà tracé §04)          |

### Fiscal / réglementaire

| `action`                  | `table_cible`      | Déclencheur                                                |
| ------------------------- | ------------------ | ---------------------------------------------------------- |
| `attestation_don_generee` | `attestations_don` | Génération attestation AG (mention 2041-GE)                |
| `collecte_statut_force`   | `collectes`        | Bascule manuelle de statut (ex. `realisee → annulee`)      |
| `pesee_corrigee`          | `collecte_flux`    | Édition manuelle pesée (motif obligatoire, déjà tracé §04) |
| `lieu_override_applique`  | `collectes`        | Correction `lieu_overrides` (déjà tracé §04)               |

### Packs AG

| `action`                             | `table_cible`    | Déclencheur                    |
| ------------------------------------ | ---------------- | ------------------------------ |
| `pack_recredite_annulation_collecte` | `packs_antgaspi` | Trigger recrédit (déjà §04)    |
| `pack_debite_annulation_tardive`     | `packs_antgaspi` | Trigger débit < 12h (déjà §04) |
| `pack_ajuste_manuel`                 | `packs_antgaspi` | Ajustement Ops/Admin           |

### Sécurité / accès

| `action`                         | `table_cible`           | Déclencheur                                                 |
| -------------------------------- | ----------------------- | ----------------------------------------------------------- |
| `user_role_modifie`              | `users`                 | Changement de rôle utilisateur                              |
| `user_desactive`                 | `users`                 | Désactivation d'un compte                                   |
| `impersonation_session`          | `users`                 | Session impersonation (`impersonator_id` renseigné, §09 §7) |
| `controle_acces_cascade_upgrade` | `collectes`             | Trigger cascade contrôle d'accès (déjà §04)                 |
| `config_auto_accept_update`      | `config_auto_accept_ag` | Toggle auto-accept AG (déjà §04)                            |

> Les lignes « déjà §04 » sont les actions que les sessions précédentes ont câblées dans la table ; ce fichier les **consolide en un catalogue unique** et ajoute les actions financières/fiscales/sécurité manquantes pour couverture complète.

---

## 3. Hors périmètre audit V1 (décision OBS-2)

- **Pas de log de consultation** (qui a lu quelle facture/donnée). Décidé hors scope V1 — volumétrie + l'`audit_log` est une couche d'intégrité d'écriture. Réévaluable si exigence RGPD/contrôle ultérieure.
- **Pas de doublon avec les logs** (`01`/`02`) : un event business `warn` peut exister en log éphémère ET en `audit_log` (ex. `facture.emise` + `facture_emise`). Le log sert au debug (7 j), l'`audit_log` à la preuve (5 ans).

---

## 4. Rétention

- **5 ans** (obligation comptable factures + traçabilité RGPD). `audit_log` n'est **jamais** purgée par le cron `purge_logs` (qui ne touche que les logs éphémères).
- Archivage > 3 ans = V2 (cf. CLAUDE.md §3 hors scope) ; en V1 la table reste en ligne (volumétrie faible : < quelques milliers de lignes/an).

---

## 5. À implémenter (Claude Code)

1. Pour chaque `action` du §2 non encore câblée (financier/fiscal/sécurité), brancher l'INSERT `audit_log` dans le trigger DB ou la fonction serveur correspondante, dans **la même transaction** que la mutation.
2. `motif` obligatoire (≥ 10 car., validation applicative) pour : `collecte_statut_force`, `pesee_corrigee`, `pack_ajuste_manuel`, `user_role_modifie`, `user_desactive`.
3. Aucun chemin d'écriture `audit_log` via une route API exposée — uniquement `SERVICE_ROLE`/`SECURITY DEFINER`.
4. Test pgTAP : vérifier l'immuabilité (UPDATE/DELETE refusés tous rôles) et la présence d'une ligne `audit_log` par action du §2.
