# 07 - Observabilité — 01 - Logs business

> Events **métier** à émettre par le code Plateforme dès le premier commit. Sert au debug d'incident, au alerting (`03`) et à la reconstitution d'un parcours. **N'est pas l'audit trail** (`06`) : ces logs sont éphémères (7 j Supabase).

---

## 1. Format obligatoire

Un event = **une ligne JSON** sur `stdout` (capté par Supabase/Vercel Logs), schéma uniforme :

```json
{
  "ts": "2026-06-08T22:14:03.221Z",
  "level": "info",
  "service": "platform",
  "event": "collecte.realisee",
  "actor_id": "<uuid user ou null si système>",
  "actor_role": "ops_savr",
  "org_id": "<uuid ou null>",
  "trace_id": "<uuid requête, propagé OTel>",
  "payload": { "...": "..." }
}
```

Règles :
- `ts` en **UTC ISO 8601**.
- `level` ∈ `info | warn | error`.
- `service` ∈ `platform` | `adapter_mts1` | `adapter_everest` | `cron` | `pdf` (Railway). *(Pas de `tms` en V1.)*
- `event` = nom canonique `domaine.action` snake/dot (liste §2, **figée** — pas de drift).
- `trace_id` propagé sur toute la chaîne d'une requête (instrumentation OTel légère).
- **PII** : jamais d'email en clair → `actor_email_hash` (SHA-256) si besoin, jamais le mot de passe/token/montant nominatif de facture hors `payload` strictement nécessaire.

---

## 2. Catalogue des events métier (figé V1)

> Aligné sur le vocabulaire `10 - Glossaire` (CLAUDE.md) et la machine à états collecte (`05 - Règles métier`). `type` collecte ∈ `ag | zd`.

### Organisations / utilisateurs / packs
| Event | Niveau | Payload obligatoire | Émis par |
|---|---|---|---|
| `organisation.created` | info | `org_id, type, created_by, source(web\|api\|migration)` | Onboarding / Admin |
| `user.invited` | info | `org_id, invited_role, by_user` | Back-office / espace client |
| `user.role_changed` | warn | `target_user, role_avant, role_apres, by_user` | Admin (⚠ aussi audit_log) |
| `pack.purchased` | info | `org_id, pack_id, credits, source` | Admin (référentiel packs AG) |
| `pack.credit_consumed` | info | `org_id, pack_id, collecte_id, credits_restants` | Trigger conso AG (FIFO) |
| `pack.credit_recredited` | info | `org_id, pack_id, collecte_id, motif(annulation)` | Trigger recrédit annulation |
| `pack.exhausted` | warn | `org_id, pack_id, last_collecte_id` | Trigger passage `epuise` |

### Événements / collectes / pesées
| Event | Niveau | Payload obligatoire | Émis par |
|---|---|---|---|
| `evenement.created` | info | `evenement_id, org_id, lieu_id, type_evenement_id, date_evenement` | Formulaire programmation |
| `collecte.scheduled` | info | `collecte_id, evenement_id, type, date_collecte` | Formulaire (statut `programmee`) |
| `collecte.statut_changed` | info | `collecte_id, type, statut_avant, statut_apres, by_user` | Machine à états |
| `collecte.realisee` | info | `collecte_id, type, poids_total_kg(null si AG), by_user` | Transition `realisee` |
| `collecte.realisee_sans_collecte` | warn | `collecte_id, motif, by_user` *(AG only)* | Transition dédiée |
| `collecte.annulee` | warn | `collecte_id, type, statut_avant, by_user, pousse_tms(bool)` | Annulation (→ outbox E3) |
| `pesee.recorded` | info | `pesee_id, collecte_id, poids_kg, hors_seuil(bool)` *(ZD)* | Adapter MTS-1 / saisie Ops |
| `pesee.hors_seuil` | warn | `pesee_id, collecte_id, type_depassement(min\|max)` *(ZD only)* | Trigger seuil (→ alerte **in-app**, cf. `03`) |

### Logistique (adapters V1) / outbox
| Event | Niveau | Payload obligatoire | Émis par |
|---|---|---|---|
| `outbox.event_emitted` | info | `outbox_id, event_type(E1\|E2\|E3\|E5), collecte_id` | Mutations métier (transactional outbox) |
| `outbox.event_consumed` | info | `outbox_id, event_type, adapter(mts1\|everest)` | Adapter |
| `mts1.poll.completed` | info | `nb_orders, nb_tours, nb_photos, duree_ms` | Cron polling 15 min |
| `mts1.order.pushed` | info | `collecte_id, external_ref_commande, http_status` | Adapter MTS-1 (sortant) |
| `tournee.synced` | info | `tournee_id, collecte_ids[], statut_tms` | Adapter (sync entrant) |
| `everest.mission.created` | info | `collecte_id, everest_mission_id, service_id` | Adapter Everest (⚠ gate §7 CLAUDE.md) |

### Facturation / documents
| Event | Niveau | Payload obligatoire | Émis par |
|---|---|---|---|
| `facture.draft_created` | info | `facture_id, org_id, type, montant_ht` | Génération brouillon (collecte/mensuel) |
| `facture.emise` | info | `facture_id, org_id, numero, montant_ttc` | Validation Admin → Pennylane |
| `facture.payee` | info | `facture_id, montant_paye, mode` | Polling Pennylane J+1 |
| `facture.avoir_created` | warn | `facture_id, avoir_id, montant` | Émission avoir |
| `attestation.generee` | info | `attestation_id, collecte_id, mention_fiscale(bool)` *(AG)* | Batch J+1 6h |
| `bordereau.genere` | info | `bordereau_id, collecte_id` *(ZD)* | Batch J+1 6h |
| `rapport_recyclage.genere` | info | `rapport_id, collecte_id` *(ZD)* | Batch J+1 6h |
| `pdf.job_failed` | error | `job_id, type_doc, collecte_id, retry_count` | File `jobs_pdf` (Railway) |

### Auth / sécurité
| Event | Niveau | Payload obligatoire | Émis par |
|---|---|---|---|
| `auth.login_success` | info | `user_id, ip, role` | Auth |
| `auth.login_failed` | warn | `email_hash, ip, reason` | Auth (→ alerte bruteforce, cf. `03`) |
| `auth.impersonation_started` | warn | `impersonator_id, target_user, by_role` | Mode impersonation §09 (⚠ aussi audit_log) |
| `api.external.called` | info | `service(pennylane\|everest\|mts1\|resend\|mistral), endpoint, latency_ms, http_status` | Tout appel sortant |
| `api.external.failed` | error | `service, endpoint, error_code, retry_count` | Échec appel sortant (→ alerte, cf. `03`) |

---

## 3. Ce qu'on ne logge PAS comme event business

- Le contenu intégral d'une facture ou d'une attestation (PII + volumineux) → seul l'`id` + montant.
- Les lectures/consultations (pas de log de navigation) — décision OBS-2, hors scope V1.
- Les payloads bruts MTS-1/Everest (peuvent contenir des coordonnées) → uniquement les champs listés.

---

## 4. Lien avec le reste du dossier

- Les events `warn`/`error` ci-dessus alimentent les alertes → `03 - Alertes`.
- `api.external.*` et `mts1.poll.completed` alimentent le monitoring intégrations → `04 - Dashboards business` (vue ops) + `05 - Health checks`.
- Les events marqués **⚠ aussi audit_log** déclenchent EN PLUS une ligne `audit_log` (couche 5 ans) → `06 - Audit trail`.
