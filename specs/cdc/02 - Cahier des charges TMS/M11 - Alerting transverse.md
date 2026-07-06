# M11 — Alerting transverse

**Parent** : [[03 - Périmètre fonctionnel TMS|§03 M11 Alerting et monitoring ops]]
**Dépendances** : tous modules M01-M08 + M12 (émetteurs d'alertes), M13 (config catalogue et destinataires)

---

## 1. Objectif

Centraliser dans un point unique toutes les alertes opérationnelles émises par le TMS : rapprochement facture, retard chauffeur, webhook DLQ, grille tarifaire manquante, refus prestataire, seuil bac Veolia, etc. Chaque module produit des alertes via **une fonction SQL unique `tms.alerte_emit`** — M11 canalise, déduplique, route, affiche, archive.

**Problème résolu** : sans M11, chaque module émet ses alertes dans son coin, Ops Savr surveille 8 endroits différents, rate des signaux critiques ou subit la fatigue d'alertes redondantes. M11 = chef d'orchestre + single source of truth.

**Non-objectifs V1** :
- Monitoring infrastructure / APM (Sentry/Datadog) — orthogonal, à brancher en parallèle par le frère en atelier tech
- Page d'incident publique — pas de statut page V1
- Intégration PagerDuty / astreinte formalisée — reporté V2
- Alertes business Plateforme (MRR, churn, signatures client) — hors scope TMS

---

## 2. Personas

| Persona | Rôle M11 |
|---------|---------|
| **Ops Savr** | Consomme 90 % des alertes. Dashboard principal. Ack + résolution. Utilise snooze pour temporiser. Aucune alerte `critical` ne doit lui échapper. |
| **Admin TMS** (Val, Louis) | Destinataire des alertes `critical` (email). Configure le catalogue d'alertes (criticité, destinataires, canaux) via M13. Accède au dashboard avec vue exhaustive. |
| **Admin Savr** | Reçoit les alertes `critical` cross-domaine qui ont un impact Plateforme (ex : webhook Plateforme↔TMS DLQ). Peut ack/résoudre comme tout staff (**tranché 2026-06-07 F1**). Intervient rarement. |
| **Manager prestataire** | Ne voit **pas** le dashboard M11. Reçoit uniquement les alertes métier qui le concernent via M03 (rappel facture J+5, relance acceptation collecte) — routées par M11 mais UX dans M03. |
| **Chauffeur** | Non concerné. Les notifications chauffeur (attribution tournée, rappel H-30) passent par M05 PWA push, hors périmètre M11. |

---

## 3. Écrans (dashboard Ops)

### E1 — Dashboard Alertes (page principale Ops)

**Sous-domaine** : `tms.gosavr.io/alertes`

**Accès** : `ops_savr`, `admin_tms`, `admin_savr` — les 3 rôles staff peuvent ack/snoozer/résoudre (**tranché Val 2026-06-07 F1** : ex-mention « lecture seule pour admin_savr » retirée, contradiction avec W4/EC13 levée en faveur du droit d'agir)

**Layout** :
- **Header KPI** (4 tuiles compteurs, rafraîchissement 30s via polling simple, pas de realtime V1) :
  - `Ouvertes` — count alertes `statut = 'ouverte'` toutes criticités (inclut les ackées — `ackee_at IS NOT NULL`)
  - `Critical non ackées` — count `criticite='critical' AND statut='ouverte' AND ackee_at IS NULL` (highlight rouge si > 0)
  - `Résolues 24h` — count `statut='resolue' AND resolue_at >= now() - interval '24 hours'`
  - `Taux résolution 7j` — `resolues_7j / emises_7j` en %, highlight vert si > 90 %, jaune 70-90 %, rouge < 70 %

- **Barre de filtres** (persistent user preferences via `localStorage` — pas de table DB V1) :
  - Criticité : multi-select `warning | critical` (défaut `warning + critical`) — **simplifiée Bloc 3 sobriété 2026-04-25 A1 (criticité `info` dégagée V1)**
  - Code : autocomplete sur `alertes_catalogue.code` (via RPC `tms.alertes_codes_list`)
  - Statut : multi-select `ouverte | snoozee | resolue` (défaut `ouverte + snoozee`) — **simplifié Bloc 3 sobriété 2026-04-25 A7 (statut `expiree` dégagé V1) + Bloc 6 2026-04-28 B2 (`ackee` retiré de l'enum → metadata `ackee_at`, non filtrable comme statut)**
  - Période : `aujourd'hui | 7j | 30j | 90j | personnalisé`
  - Destinataire : multi-select `moi | ops | admin_tms | admin_savr`
  - Entity : champ libre `entity_type + entity_id` (ex : `tournee:uuid`, `facture_prestataire:uuid`)

- **Table principale** (tri par défaut `critical DESC, emise_at DESC`, pagination 50) :
  - Colonnes : Criticité (pastille couleur) | Code | Titre | Entité liée | Destinataires | Statut | Émise à | Age | Actions rapides
  - Actions rapides par ligne : `Ack` | `Snooze ▾ (1h/4h/24h)` | `Résoudre ▾ (motif opt.)` | `Voir détail`
  - Row click → drawer détail (E2)

**États vides** :
- Aucune alerte ouverte : illustration calme + message "Tout est sous contrôle. Dernière alerte résolue il y a X min."
- Filtres trop restrictifs : bouton "Réinitialiser filtres"

### E2 — Drawer détail alerte

**Déclenchement** : click row E1 ou deeplink `/alertes/:id`

**Contenu** :
- Titre + criticité (pastille + libellé)
- Code canonique (monospace, copiable)
- Entity liée : card clickable `{entity_type}:{entity_id}` → navigation vers la fiche (tournée, facture, collecte, prestataire)
- Payload JSONB (expand/collapse, syntax highlight)
- Meta : émise par (module + fonction appelante), timestamps cycle de vie (émise / ackée / snoozée / résolue), destinataires effectifs
- Timeline événements (SELECT `tms.audit_logs WHERE entity_type='alerte' AND row_id=alerte.id ORDER BY created_at` — **Bloc 6 sobriété 2026-04-28 C1** : `alertes_evenements_log` fusionnée dans `tms.audit_logs`) : ack par X à Y, snooze par X à Y jusqu'à Z, résolution par X à Y avec motif "…"
- Actions contextuelles au statut (cf. cycle de vie §7)

### E3 — Vue historique par code

**Dégagée revue sobriété 2026-04-25 (A3)**. Observabilité produit (graphique évolution journalière + KPI temps moyen ack/résolution) hors scope V1. Filtrer par code dans E1 + tri date suffit V1. Index DB `idx_alertes_code_date` conservé (utile pour requêtes E1 KPI agrégés). Réactivation V1.1+ si besoin avéré.

### E4 — Catalogue alertes (Admin TMS uniquement)

**Sous-domaine** : `tms.gosavr.io/alertes/catalogue`

**Accès** : `admin_tms` uniquement (lecture+écriture), `ops_savr` lecture seule

**Layout** :
- Table de tous les codes (`alertes_catalogue` — cf. §11)
- Colonnes : Code | Titre | Description | Criticité par défaut | Destinataires par défaut | Active (bool) | Dernière émission
- Actions : `Éditer` | `Désactiver` (bascule `active=false` → plus aucune émission)

**Bloc 4 sobriété 2026-04-25** :
- A11 colonne `Canaux` retirée (matrice canal/criticité figée hardcodée V1 : `warning` → in-app, `critical` → in-app + email Resend)
- A5 bouton `Tester` retiré (RPC `m11_emit_test` + cron + rate limit dégagés V1, cf.)

**Édition** (modal ou page dédiée) :
- Modifier criticité par défaut (peut être override par code appelant)
- Modifier destinataires (rôles + user IDs + manager prestataire scope)
- Activer / désactiver le code sans redéploiement

**⚠ Garde-fou** : suppression d'un code = soft (colonne `supprime_at`). Les alertes historiques émises avec ce code restent accessibles. Une nouvelle émission avec un code `supprime_at IS NOT NULL` lève exception → cf. R_M11.4.

### E5 — Suivi comportemental chauffeurs

**Dégagée revue sobriété 2026-04-25 (A2)**. Vue analytique agrégée (fenêtre glissante 30/60/90j + drill-down + export CSV) reportée V1.1. À 1-2 chauffeurs ZD au lancement, la dataviz n'est pas critique. V1 = export Supabase Studio à la demande sur `tms.collectes_tms WHERE statut = 'realisee_sans_collecte'` (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m05_realisee_sans_collecte` info retirée du catalogue, statut métier sur la collecte reste source de vérité).

### E6 — Préférences utilisateur

**Dégagée revue sobriété 2026-04-25 (A4 + A12)**. Toggle canaux par criticité + tri/filtres + sonorité in-app supprimés V1. Règle figée codée : `warning` → in-app / `critical` → in-app + email (criticité `info` dégagée Bloc 3 A1 — events ex-info en `audit_logs`/`integrations_logs` directement). Filtres dashboard via querystring URL (pas de persistance DB). Colonne `users_tms.preferences_alertes` JSONB **jamais formalisée dans §04** — pas de migration DDL nécessaire. Notification sonore in-app critical : décision V1 par défaut activée (à reconsidérer V1.1 si plainte Ops).

---

## 4. Workflows

### W1 — Émission d'une alerte

**Source** : n'importe quel module (trigger DB, service Node, cron, fonction SQL métier)

**Point d'entrée unique** (D13) : fonction SQL `tms.alerte_emit`

```sql
CREATE OR REPLACE FUNCTION tms.alerte_emit(
  p_code            text,                     -- code canonique (ex: 'm07_cout_manquant')
  p_entity_type     text            DEFAULT NULL,
  p_entity_id       uuid            DEFAULT NULL,
  p_payload         jsonb           DEFAULT '{}'::jsonb,
  p_criticite_override alerte_criticite DEFAULT NULL,  -- override catalogue.criticite_par_defaut
  p_titre_override  text            DEFAULT NULL,      -- override libellé dynamique
  p_destinataires_extra uuid[]      DEFAULT NULL       -- user_ids à ajouter ad-hoc
)
RETURNS uuid                                 -- id de l'alerte créée ou de l'alerte existante (dédup)
LANGUAGE plpgsql
AS $$
DECLARE
  v_catalogue   tms.alertes_catalogue%ROWTYPE;
  v_criticite   alerte_criticite;
  v_dedup_key   text;
  v_existing_id uuid;
  v_debounce_s  integer;
  v_alerte_id   uuid;
  v_destinataires uuid[];
BEGIN
  -- 1) Lookup catalogue
  SELECT * INTO v_catalogue FROM tms.alertes_catalogue WHERE code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Code alerte inconnu: %', p_code USING ERRCODE = 'ALERT001';
  END IF;
  IF v_catalogue.supprime_at IS NOT NULL THEN
    RAISE EXCEPTION 'Code alerte supprimé: %', p_code USING ERRCODE = 'ALERT002';
  END IF;
  IF v_catalogue.active = false THEN
    RETURN NULL;  -- silencieux, code désactivé par Admin TMS
  END IF;

  v_criticite := COALESCE(p_criticite_override, v_catalogue.criticite_par_defaut);

  -- 2) Debounce (D6) : dédup 5 min par (code, entity_type, entity_id)
  v_debounce_s := COALESCE(
    (SELECT valeur::integer FROM tms.parametres_tms WHERE cle = 'm11.debounce_seconds'),
    300
  );
  v_dedup_key := p_code || ':' || COALESCE(p_entity_type, '') || ':' || COALESCE(p_entity_id::text, '');

  SELECT id INTO v_existing_id
  FROM tms.alertes
  WHERE dedup_key = v_dedup_key
    AND statut IN ('ouverte', 'snoozee')
    AND emise_at >= now() - make_interval(secs => v_debounce_s)
  ORDER BY emise_at DESC LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Dédup hit : on incrémente le compteur d'occurrences, pas de nouvelle alerte
    UPDATE tms.alertes
       SET occurrences = occurrences + 1,
           derniere_occurrence_at = now(),
           payload = payload || jsonb_build_object('dernier_payload', p_payload)
     WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  -- 3) Résolution destinataires
  v_destinataires := tms.m11_resoudre_destinataires(v_catalogue, p_destinataires_extra);

  -- 4) INSERT alerte
  INSERT INTO tms.alertes (
    code, criticite, titre, entity_type, entity_id, payload,
    destinataires_user_ids, statut, emise_at, occurrences
  ) VALUES (
    p_code, v_criticite,
    COALESCE(p_titre_override, v_catalogue.titre_par_defaut),
    p_entity_type, p_entity_id, p_payload,
    v_destinataires, 'ouverte', now(), 1
  ) RETURNING id INTO v_alerte_id;

  -- 5) Trigger notifications (in-app toujours, email si critical V1)
  PERFORM tms.m11_notifier(v_alerte_id);

  RETURN v_alerte_id;
END;
$$;
```

**Contrat** :
- Idempotent sur la fenêtre de debounce : 2 appels identiques en < 5 min → 1 alerte + counter incrémenté
- Jamais bloquant : échec notif → log `integrations_logs` + alerte continue son cycle
- Appelable depuis SECURITY DEFINER (les triggers DB et les services Node passent tous par cette fonction)

### W2 — Routage des destinataires

**Fonction helper** : `tms.m11_resoudre_destinataires(catalogue_row, extras uuid[])`

Logique :
1. Start avec `catalogue_row.destinataires_par_defaut` (JSONB `{"roles": ["ops_savr"], "users": ["..."], "manager_prestataire_scope": "entity"|"none"}`)
2. Résoudre `roles` → liste des `user_ids` ayant le rôle dans `users_tms` actif non archivé
3. Ajouter `users` (user_ids explicites)
4. Si `manager_prestataire_scope = 'entity'` ET `entity_type IN ('facture_prestataire', 'collecte_tms', 'tournee')` : résoudre le `prestataire_id` lié et ajouter le(s) manager(s) actifs du prestataire (table `users_tms` avec `role='manager_prestataire' AND prestataire_id=?`)
5. Union avec `extras` (user_ids additionnels passés par l'appelant, ex : un ops spécifique déjà en charge de la tournée)
6. DISTINCT + retour array uuid

**Cas edge** : si un user est archivé ou suspendu entre émission et dispatch, il est exclu par le service de notification (pas par W2). W2 retourne la liste "théorique" au moment T, le service filtre à T+ε.

### W3 — Notifications (canaux V1)

**Fonction helper** : `tms.m11_notifier(alerte_id)` — SECURITY DEFINER

**V1 (D4 option c) : matrice canal/criticité figée hardcodée — Bloc 4 sobriété 2026-04-25 A11 (colonne `alertes_catalogue.canaux` JSONB retirée, plus d'override par-code)**

1. **In-app** (toutes criticités `warning` + `critical`) : badge et cloche header lus directement via `tms.alertes WHERE auth.uid() = ANY(destinataires_user_ids) AND statut IN ('ouverte','snoozee') ORDER BY emise_at DESC`. **Bloc 6 sobriété 2026-04-28 C2** : `notifications_inbox_tms` supprimée — la table `tms.alertes` avec RLS destinataires remplace le doublon. Pas de delivery externe, juste un SELECT RLS.
2. **Email** : si `criticite = 'critical'` → envoi Resend template `alerte_critical_v1` à chaque destinataire. Contenu : titre + criticité + entity link + CTA "Voir dans le TMS". Batch envoyé asynchrone via worker (queue `email_queue_tms`), latence cible < 60s.
3. **SMS** : hors V1 (coût + fatigue, cf. arbitrage 4).

**Note revue de sobriété 2026-04-25 (A6)** : canal Slack dégagé V1 (infra dormante, route entrante boutons, format Block Kit, paramètres `m11_slack_*` retirés). Si réactivation décidée ultérieurement, recoder à partir de zéro (estimation 1 jour dev).

**V2 (post-feedback terrain)** :
- D7 V2 activera digest matinal 7h (cron + template)

### W4 — Ack (user prend en charge)

**Déclenchement** : click bouton Ack sur E1 ou E2

**RPC** : `tms.m11_ack(alerte_id uuid)`

**Effet** (Bloc 6 sobriété 2026-04-28 B2 + C1) :
- UPDATE `ackee_par_user_id=auth.uid(), ackee_at=now()` — **statut reste `'ouverte'`** (ack = metadata, plus un état enum)
- INSERT `tms.audit_logs` (`entity_type='alerte', row_id=alerte_id, action='M11_ACK', acteur_user_id=auth.uid()`, `contexte JSONB {ackee_at}`)
- Pas de notif re-déclenchée (ack = interne user)

**Contraintes** :
- Alerte doit avoir `statut = 'ouverte'` et `resolue_at IS NULL` (ack sur alerte snoozée ou résolue rejeté)
- User doit avoir rôle staff `ops_savr / admin_tms / admin_savr` (**tranché 2026-06-07 F5** : un manager prestataire destinataire est lecture seule — aligné §13.4 SELECT only + bandeau M03 sans action ; ack manager = V1.1 si un code scope entity apparaît)
- Double ack idempotent : si `ackee_at IS NOT NULL`, retour silencieux (pas d'erreur)

### W5 — Snooze (report temporisé)

**Déclenchement** : click bouton Snooze ▾ sur E1 ou E2, choix durée (1h/4h/24h)

**RPC** : `tms.m11_snooze(alerte_id uuid, duree_heures integer, motif text DEFAULT NULL)`

**Effet** :
- UPDATE `statut='snoozee', snoozee_jusqu_a=now() + (duree_heures * interval '1 hour'), snoozee_par_user_id, snoozee_motif`
- INSERT `tms.audit_logs` (`entity_type='alerte', row_id=alerte_id, action='M11_SNOOZE', acteur_user_id, contexte {duree_heures, motif, jusqu_a}`) — Bloc 6 sobriété 2026-04-28 C1
- L'alerte est filtrée par défaut dans E1 (réapparaît après `snoozee_jusqu_a`)
- Cron `m11_unsnoozer` (toutes les 5 min) repasse `statut='ouverte'` si `snoozee_jusqu_a < now()` ET statut encore `snoozee`

**Contraintes** :
- Durée acceptée : 1h, 4h, 24h uniquement — **hardcodée dans la RPC** (paramètre `m11.snooze_durees_autorisees` supprimé 2026-06-07 F4, source unique, pas de picker libre)
- Motif obligatoire pour `criticite='critical'` (≥ 10 caractères), optionnel sinon
- Snooze réservé au staff `ops_savr / admin_tms / admin_savr` (**tranché 2026-06-07 F5** : manager prestataire destinataire = lecture seule)

### W6 — Résolution manuelle

**Déclenchement** : click bouton Résoudre ▾ sur E1 ou E2, motif facultatif

**RPC** : `tms.m11_resoudre_manuel(alerte_id uuid, motif text DEFAULT NULL)`

**Effet** :
- UPDATE `statut='resolue', resolue_par_user_id, resolue_at, resolue_motif, resolue_source='manuel'`
- INSERT `tms.audit_logs` (`entity_type='alerte', row_id=alerte_id, action='M11_RESOLVE_MANUEL', acteur_user_id, contexte {motif}`) — Bloc 6 sobriété 2026-04-28 C1

**Utilité** : Ops a traité le problème underlying (ex : appelé le prestataire, corrigé la grille) mais le trigger underlying ne sait pas auto-fermer. Le motif est stocké pour post-mortem.

### W7 — Résolution automatique (trigger disparu)

**Principe** (D5 option d combinée auto-résolution) : quand la condition qui a déclenché l'alerte n'est plus vraie, le module émetteur appelle `tms.alerte_resoudre_auto(code, entity_type, entity_id, raison)`.

**Exemples** :
- Facture `m08_facture_ecart_detecte` → manager upload avoir + nouvelle facture → M08 W6 appelle `alerte_resoudre_auto('m08_facture_ecart_detecte', 'facture_prestataire', id_ancienne, 'remplacee_par_avoir')`
- → **Code supprimé revue sobriété §05 2026-05-01 A1** (W11 cron supprimé V1, supervision via widget M08 E0 manuelle).
- → **N/A revue sobriété §05 2026-05-01 D2** (code supprimé V1, cas impossible par construction)
- Bac `m10_bac_satur` → déclaration passage Veolia `realise` par Ops (E5 avec checkbox vidéo) → trigger `trg_m10_reset_total_pleins` appelle `alerte_resoudre_auto('m10_bac_satur', 'stocks_bacs_entrepot', id, 'passage_veolia_realise')` (V3 sobre 2026-04-30 — la résolution dépend désormais de la transition `statut: planifie → realise`, plus de `confirme_at`).

**RPC** : `tms.alerte_resoudre_auto(code, entity_type, entity_id, raison text)`

**Effet** :
- UPDATE toutes les alertes `code + entity_type + entity_id + statut IN ('ouverte','snoozee')` → `statut='resolue', resolue_source='auto', resolue_raison=raison, resolue_at=now()` — **Bloc 6 sobriété 2026-04-28 B2** : `ackee` retiré (ackée = metadata sur `ouverte`, résolvable sans changement d'état préalable)
- INSERT `tms.audit_logs` par alerte résolue (`action='M11_RESOLVE_AUTO', entity_type='alerte', row_id=alerte_id, contexte {raison}`) — Bloc 6 C1
- Pas de notif (résolution silencieuse, user verra l'alerte disparaître du dashboard)

### W8 — Expiration

**Dégagée Bloc 3 sobriété 2026-04-25 (A1+A7)**. Avec la criticité `info` retirée V1, plus aucune alerte ne peut atteindre l'état `expiree` ; le cron `m11_expirer_info` et le statut `expiree` sont supprimés. `warning` et `critical` restent ouverts indéfiniment tant que non ackés/snoozés/résolus — voulu pour forcer le traitement (R_M11.6).

### W9 — Mute (désactivation globale d'un code)

**Déclenchement** : Admin TMS dans E4, bouton "Désactiver"

**Effet** :
- UPDATE `alertes_catalogue SET active=false, desactive_par_user_id, desactive_at, desactive_motif`
- À partir de T, tout appel `alerte_emit(code='X', ...)` avec X désactivé renvoie `NULL` sans INSERT
- Les alertes historiques de ce code restent dans `tms.alertes` (trace)
- Réactivation possible à tout moment (toggle `active=true`)

**Usage** : alerte trop bruyante pendant une période (ex : intégration Everest instable → mute `m14_everest_timeout` pendant l'incident).

### W10 — Test d'une alerte (Admin TMS)

**Dégagée Bloc 4 sobriété 2026-04-25 (A5)**. RPC `tms.m11_emit_test(code)`, bouton E4 "Tester", cron `m11_nettoyer_tests`, paramètres `m11.test_nettoyage_minutes` + `m11.rate_limit_test_par_heure`, dépendance Vercel KV rate limit, `entity_type='test'`, R_M11.12 — tous supprimés V1. Validation routing/delivery couverte par les pgTAP CI (`test_m11_emit_unknown_code_raises`, `test_m11_emit_inactive_code_silent`, etc.) + tests réels via triggers métier post-déploiement. Si Admin a besoin d'un test ad-hoc V1 → `SELECT tms.alerte_emit('code', 'manuel', gen_random_uuid(), '{"test_admin":true}', NULL, '[TEST]', NULL)` via Supabase Studio (1 ligne SQL). Réintroduire V1.1 si fréquence > 1 test/sem post-launch.

---

## 5. Notifications

### 5.1 Matrice V1 canaux/criticités

| Criticité | In-app | Email | SMS V1 | Push PWA |
|-----------|--------|-------|--------|----------|
| `warning` | Oui    | Non   | Non | Non |
| `critical`| Oui    | Oui (Resend) | Non | Non |

**Note Bloc 3 sobriété 2026-04-25 (A1)** : criticité `info` dégagée V1. Les events précédemment émis en `info` (audit only, sans notif) sont désormais tracés directement dans `tms.audit_logs` ou `integrations_logs` selon le module émetteur — voir propagation §13.

### 5.2 Email `alerte_critical_v1`

Template Resend, variables :
- `{{titre}}` — ex : "Grille tarifaire manquante — Tournée T#12345"
- `{{criticite_badge}}` — HTML badge rouge
- `{{code}}` — ex : `m07_cout_manquant`
- `{{entity_link}}` — deeplink fiche tournée
- `{{payload_summary}}` — 3 champs clé extraits du JSONB (ex : `prestataire`, `date_planifiee`, `cout_attendu`)
- `{{cta_dashboard}}` — bouton "Ouvrir le dashboard TMS"
- `{{emise_at_local}}` — datetime Europe/Paris

Objet : `[Savr TMS / Critical] {{titre}}`

**Reply-to** : `ops@gosavr.io` (non-no-reply pour faciliter escalade humaine).

### 5.3 In-app

**Bloc 6 sobriété 2026-04-28 C2** : supprimée. Le front lit directement `tms.alertes` via RLS destinataires.

- Badge compteur en header TMS (polling 30s) : `SELECT count(*) FROM tms.alertes WHERE auth.uid() = ANY(destinataires_user_ids) AND statut IN ('ouverte','snoozee') AND ackee_at IS NULL`
- Click badge → deeplink E1 filtré `destinataire=moi AND statut='ouverte'`
- Simplification : -1 table, -1 INSERT par émission d'alerte dans `m11_notifier()`

---

## 6. Edge cases

| # | Cas | Comportement V1 |
|---|-----|------------------|
| EC1 | Code appelé inconnu (typo dev) | `alerte_emit` lève exception `ALERT001`. Le trigger appelant DB rollback la transaction underlying. **Strict** pour forcer la discipline catalogue. |
| EC2 | Code désactivé par Admin | `alerte_emit` renvoie `NULL` silencieusement. Pas d'exception. Aucune alerte créée. |
| EC3 | Code supprimé (soft delete) | `alerte_emit` lève exception `ALERT002`. Le code doit être réactivé via Admin catalogue ou remplacé dans le code émetteur. |
| EC4 | Destinataire user archivé au moment du dispatch notif | Filtré par service notif (pas par W2). L'alerte reste visible dans E1 pour les autres destinataires. Si aucun destinataire valide après filtre : alerte reste en `statut=ouverte` (pas d'auto-résolution), cas à investiguer par Admin (signal catalogue mal configuré). |
| EC5 | Ack sur alerte déjà résolue | UI : bouton Ack désactivé. Backend : RPC retourne erreur `alerte_non_ackable` + current_status. |
| EC6 | Snooze dépassant 24h demandé | Rejet avec message "Snooze max 24h". Force Ops à re-évaluer régulièrement (D11). |
| EC7 | Même code émis 1000 fois en 1h (bug module émetteur) | Debounce 5 min → ~12 alertes distinctes en 1h au max. Chaque alerte a `occurrences` incrémenté (counter agrégé à l'intérieur de la fenêtre). Dashboard affiche `titre (x250)` si `occurrences > 10`. **Pas d'alerte méta automatique V1 (R_M11.9 dégagée — revue sobriété 2026-04-25 A8)** : Admin TMS détecte les flood en consultant le compteur `occurrences` sur les alertes ouvertes. |
| EC8 | Email Resend down | Fallback : pas de fallback V1 (single provider). Alerte `m11_notification_email_failed` émise `critical` vers Admin TMS (sans email elle-même pour éviter boucle infinie — uniquement in-app). Ops voit directement l'alerte originale dans le dashboard (in-app indépendant). |
| EC9 | Alerte émise pendant transaction DB puis rollback | `alerte_emit` est appelée DANS la transaction underlying. Si la transaction rollback, l'INSERT dans `alertes` rollback aussi → pas d'alerte orpheline. Comportement voulu. |
| EC10 | Deux ops ack simultanément la même alerte | **Double ack idempotent** (W4 Bloc 6 B2) : le premier écrit `ackee_par_user_id/ackee_at`, le second retourne silencieux — pas d'erreur, pas d'écrasement (premier ack conservé), pas de second audit_log. *(Réécrit 2026-06-07 F2 — la version pré-Bloc 6 décrivait une erreur `alerte_non_ackable` via row lock sur `statut='ouverte'`, devenue fausse depuis ackee→metadata.)* |
| EC11 | Résolution auto alors que user snoozait l'alerte | Auto-résolution W7 prioritaire : passe en `resolue` même si `snoozee`. Motif log `snoozee_avant_resolution_auto=true`. |
| EC12 | Catalogue modifié (criticité changée) alors que des alertes ouvertes existent | Les alertes existantes conservent leur criticité au moment de l'émission. Seules les futures émissions héritent de la nouvelle config. Pas de rétroactivité. |
| EC13 | User tente d'ack une alerte dont il n'est pas destinataire | RPC rejette si rôle user ≠ `ops_savr/admin_tms/admin_savr`. Les ops peuvent acker pour les autres (ex : ack au nom de l'équipe). |
| EC14 | Entity liée supprimée (tournée hard-delete) | FK `entity_id` pas contrainte (text + uuid polymorphe). L'alerte reste avec entity dangling. UI affiche "Entité introuvable" avec le type+id en readonly. |
| EC15 | Alerte critical pendant weekend / nuit sans SLA V1 | Aucune escalade auto V1 (D10). Val+Louis reçoivent email Resend dès émission (asynchrone < 60s). Charge à eux de monitorer leur email. V2 activera SLA 2h + escalade. |
| EC17 | Frère déploie nouveau service qui émet alerte mais catalogue pas encore peuplé | Migration SQL + seed catalogue doivent être dans le même PR que le code émetteur. pgTAP test : check que tous les codes utilisés dans `alerte_emit(code='xxx', ...)` existent dans `alertes_catalogue`. |
| EC18 | Alerte sur événement cross-CDC (Plateforme échec sync) | M11 gère uniquement les alertes générées côté TMS. Si la Plateforme échoue à ingérer un webhook TMS, c'est M01/M04 qui détecte le DLQ et appelle M11 via `m01_push_plateforme_dlq`. La Plateforme a son propre système de supervision en parallèle (hors scope). |

---

## 7. Cycle de vie alerte

```
[ouverte] (émise par module via alerte_emit — peut être flaggée ackée via metadata ackee_at)
    │
    ├─ W4 ack user (metadata update — statut reste ouverte, ackee_at=now())
    ├─ W5 snooze user (1h/4h/24h)        → [snoozee]
    ├─ W6 résolution manuelle user       → [resolue]
    └─ W7 résolution auto (trigger part) → [resolue]

[snoozee]
    │
    ├─ cron unsnoozer (jusqu_a < now())  → [ouverte]  (retour visible)
    ├─ W6 résolution manuelle user       → [resolue]
    ├─ W7 résolution auto                → [resolue]

[resolue]   (terminal)
```

**Bloc 6 sobriété 2026-04-28 B2** : statut `[ackee]` retiré (enum 4→3 valeurs). L'ack est désormais une **metadata** sur `[ouverte]` via colonnes `ackee_par_user_id / ackee_at` nullable. Une alerte ackée reste `statut='ouverte'` mais `ackee_at IS NOT NULL`. Filtres dashboard : "non ackée" = `ackee_at IS NULL`.

**Note Bloc 3 sobriété 2026-04-25 (A1+A7)** : statut `[expiree]` retiré V1 (criticité `info` dégagée → plus aucune source de transition vers `expiree`). Cron `m11_expirer_info` supprimé. W8 supprimée du diagramme.

**Règles de transition** :
- `ouverte → ouverte (ackée)` : W4 metadata update — staff uniquement (**F5 2026-06-07** : manager destinataire = lecture seule)
- `ouverte → snoozee` : staff uniquement (idem F5)
- `snoozee → ouverte` : automatique cron `m11_unsnoozer` (unsnooze remet `ackee_at` à NULL — l'alerte revient non ackée pour re-traitement)
- `ouverte → resolue` ou `snoozee → resolue` : tout user staff peut résoudre (ack pas requis avant résolution)
- `resolue → *` : **impossible** V1. Si erreur Ops, émettre nouvelle alerte via module émetteur. (V2 : RPC Admin TMS `m11_rouvrir_alerte` avec motif ≥ 30 car + audit.)

---

## 8. Règles métier R_M11.x

**R_M11.1 — Catalogue source de vérité** : tout appel à `alerte_emit(code='X', ...)` où `X ∉ alertes_catalogue.code` lève exception (EC1). Pas de catch-all "code inconnu" V1.

**R_M11.2 — Criticité immuable post-émission** : une fois l'alerte insérée, sa `criticite` ne change plus. Si Admin TMS modifie le catalogue, effet sur futures émissions uniquement (EC12).

**R_M11.3 — Debounce strict fenêtre glissante** : 2 appels `alerte_emit` avec même `(code, entity_type, entity_id)` dans les 5 min (paramètre `m11.debounce_seconds`) → même alerte, counter `occurrences++`, pas de nouvelle notif.

**R_M11.4 — Code désactivé = silence total** : `active=false` → `alerte_emit` renvoie NULL silencieusement. Utile pour muter pendant incident, sans casser les triggers émetteurs.

**R_M11.5 — Code supprimé = exception** : `supprime_at IS NOT NULL` → exception `ALERT002` à l'émission. Force le nettoyage côté code émetteur (pas de zombie silent).

**R_M11.6 — Pas de rétention automatique ouverte** : les alertes `warning` et `critical` ouvertes ne s'auto-résolvent jamais (hors W7 trigger disparu). Volontaire pour forcer traitement. **Bloc 3 sobriété 2026-04-25 (A1+A7)** : la criticité `info` est dégagée V1 (events ex-`info` désormais en `audit_logs`/`integrations_logs`). Plus aucune source d'expiration auto V1 — règle simplifiée.

**R_M11.7 — Résolution auto idempotente** : `alerte_resoudre_auto` appelée plusieurs fois pour le même (code, entity) résout toutes les alertes ouvertes/ackées/snoozées, mais est idempotente (`UPDATE ... WHERE statut IN (...)` — si toutes déjà `resolue`, 0 ligne affectée, pas d'erreur).

**R_M11.8 — Escalade manager prestataire scope** : pour les alertes liées à une entité appartenant à un prestataire (`facture_prestataire`, `collecte_tms`, `tournee`), le catalogue peut inclure `manager_prestataire_scope='entity'` → le(s) manager(s) du prestataire sont automatiquement ajoutés aux destinataires (W2).

**** : **Dégagée V1 (revue sobriété 2026-04-25 A8)**. Volume V1 ne justifie pas un cron 2 min de scan flood. Le compteur `occurrences` sur `tms.alertes` reste consultable pour debug manuel.

**R_M11.10 — Rétention 3 ans + dump pré-purge** (D8, refondu revue sobriété §05 2026-05-01 B3) : cron `m11_purger_archives` mensuel (1er du mois 4h) en 2 étapes :
1. **Dump pré-purge** : INSERT INTO `tms.alertes_archive_critical` SELECT * FROM `tms.alertes` WHERE `criticite = 'critical' AND statut = 'resolue' AND resolue_at < now() - interval '3 years'` (table archive append-only dédiée, RLS admin_tms read-only).
2. **Purge** : DELETE FROM `tms.alertes` WHERE `statut = 'resolue' AND resolue_at < now() - interval '3 years'` (toutes criticités).

 → **Supprimé revue sobriété §05 2026-05-01 B3**. Trigger sur opération destructive = piège (perf bulk DELETE + complexité debug + couplage audit_logs/alertes incorrect). Remplacé par dump explicite dans table dédiée `tms.alertes_archive_critical` (séparation des préoccupations).

**Bloc 3 sobriété 2026-04-25 (A7)** : statut `expiree` dégagé, scope rétention restreint à `resolue` uniquement.

**R_M11.11 — Pas d'UPDATE sur colonnes immuables** : trigger BEFORE UPDATE bloque modification de `code, criticite, emise_at, entity_type, entity_id, dedup_key, occurrences` (sauf par W7 auto-résolution et debounce W1). Règles UPDATE stricte : seules transitions de statut + ack/snooze/résolution autorisées.

**** : **Dégagée Bloc 4 sobriété 2026-04-25 (A5)**. RPC `m11_emit_test`, cron `m11_nettoyer_tests`, paramètres + Vercel KV rate limit + filtre `entity_type != 'test'` partout — tous supprimés V1. Validation routing/delivery couverte par pgTAP CI. Tests ad-hoc Admin via Supabase Studio si besoin.

---

## 9. Paramètres `parametres_tms.m11_*`

| Clé | Valeur défaut | Description |
|-----|---------------|-------------|
| `m11.debounce_seconds` | 300 | Fenêtre glissante dédup dans `alerte_emit` (R_M11.3) |
| `m11.retention_annees` | 3 | Rétention avant purge (R_M11.10) |
| `m11.snooze_motif_min_car_critical` | 10 | Longueur min motif snooze pour critical (W5) |
| `m11.email_batch_latence_cible_seconds` | 60 | Latence cible worker queue email (SLA soft) |

**Paramètres dégagés revue sobriété 2026-04-25** : `m11.flood_seuil_occurrences` (A8), `m11_slack_active` / `m11_slack_webhook_url` / `m11_slack_criticite_min` (A6), `m11.expiration_info_jours` (Bloc 3 A1+A7), `m11.test_nettoyage_minutes` + `m11.rate_limit_test_par_heure` (Bloc 4 A5 — RPC test + cron + dépendance Vercel KV supprimés).

**Paramètre dégagé 2026-06-07 (F4, scénarios de test)** : `m11.snooze_durees_autorisees` supprimé — les durées {1h, 4h, 24h} sont **hardcodées dans la RPC `m11_snooze`** (source unique, EC6 « max 24h » garanti par construction, cohérent D11). Réintroduire le paramètre V1.1 si besoin avéré d'autres durées.

---

## 10. Décisions structurantes D1-D13

### D1 — Taxonomie criticité : 2 niveaux `warning / critical` (Bloc 3 sobriété 2026-04-25 A1)

**Choix** : option a (révisé Bloc 3 sobriété — initialement option b à 3 niveaux info/warning/critical).

**Rationale** : `warning` pour anomalies à traiter, `critical` pour incidents bloquants + email immédiat. Niveau `info` (audit only, pas de notif) initialement prévu mais dégagé Bloc 3 A1 — duplication avec `tms.audit_logs` / `integrations_logs` qui sont la source de vérité audit. Events ex-`info` désormais tracés directement dans ces tables d'audit, pas dans `tms.alertes`.

**Alternative écartée** : `error` intermédiaire (option c). On regroupe erreurs techniques et incidents métier sous `critical` : si ça casse la prod, c'est critique, peu importe la nature.

### D2 — Catalogue configurable `alertes_catalogue`

**Choix** : option b (table config Admin).

**Rationale** : Admin TMS peut désactiver un code qui spam en prod sans redéploiement (D12 cohérent). Enum SQL dur (option a) aurait forcé migration Postgres pour chaque nouveau code. Catalogue permet aussi Admin de changer criticité par défaut ou destinataires sans modifier le code émetteur.

### D3 — Destinataires via règles configurables

**Choix** : option b (règles par code dans catalogue).

**Rationale** : `destinataires_par_defaut` JSONB permet aux ops + Admin TMS de maintenir le routage sans touchers au code. Option a figée dangereuse (rotation d'Ops = oubli), option c (subscription user) prive d'un filet de sécurité "nouvel Ops reçoit automatiquement les alertes Ops".

### D4 — Canaux V1 minimalistes

**Choix** : V1 = in-app + email critical uniquement.

**Rationale** : Val ne veut pas empiler les canaux V1. L'email critical suffit pour les incidents bloquants, l'in-app couvre tout le reste. **Revue sobriété 2026-04-25 (A6)** : infra Slack dormante dégagée V1 (anti-pattern code mort en prod). Si réactivation Slack ultérieure → recoder à partir de zéro (~1 jour dev).

### D5 — Ack simple + Résoudre séparé motif facultatif

**Choix** : option d.

**Rationale** : 2 actions distinctes — `Ack` (metadata `ackee_at` sur une alerte `ouverte` : je prends en charge, pas de changement de statut — Bloc 6 B2 2026-04-28) et `Résoudre` (statut `resolue` : c'est traité). Motif obligatoire seulement pour snooze critical (R_M11 via W5), pas pour ack ni résolution — trop de friction détruirait l'adoption. Ops a besoin de vitesse.

### D6 — Debounce 5 min par `(code, entity_id)`

**Choix** : option b.

**Rationale** : évite spam sur trigger récurrent sans perdre l'info métier. Fenêtre 5 min paramétrable. Le counter `occurrences` agrège à l'intérieur. Option c (agrégation glissante) reportée V1.1 si le counter simple ne suffit plus.

### D7 — Pas de digest V1, digest matinal V2

**Choix** : V1 = c (pas de digest), V2 = a (digest 7h).

**Rationale** : V1 focus sur la réactivité temps réel (critical email + in-app dashboard). Digest rajoute une infra cron + template email + logique compilation pour un ROI V1 faible (dashboard suffit comme synthèse). Déblocage V2 quand le volume quotidien d'alertes warning dépassera 20 → digest devient utile.

### D8 — Rétention 3 ans

**Choix** : option b.

**Rationale** : cohérent avec `ajustements_couts_log` M07 (3 ans). Suffit pour retrospective pluriannuelle. 5 ans = overkill (audit comptable vit dans `tms.audit_logs`, pas dans `alertes`). Purge mensuelle pg_cron R_M11.10.

### D9 — Dashboard liste + filtres + KPI header

**Choix** : option b.

**Rationale** : équilibre effort/valeur. KPI header donne la radiographie immédiate ("X feux ce matin"). Timeline/heatmap (option c) reporté V1.1 — pas de volumétrie V1 pour justifier.

### D10 — Pas de SLA V1, SLA 2h V2

**Choix** : V1 = a (pas de SLA), V2 = b (2h ack critical + escalade).

**Rationale** : V1 = on fait confiance à Val + Louis + Ops pour traiter. L'escalade V2 ajoutera un filet de sécurité (incident nuit/weekend sans ack). Implémentation V2 = 1 cron + 1 règle, simple — mais pas prioritaire V1.

### D11 — Snooze 1h/4h/24h avec motif

**Choix** : option b.

**Rationale** : safeguard contre réappearance d'alerte Ops a déjà traitée mais trigger encore vrai (ex : attend prestataire demain). Durée max 24h oblige re-évaluation. Motif obligatoire uniquement critical (R_M11 via W5) pour traçabilité.

### D12 — Slack webhook optionnel (infra V1, activation toggle)

**Dégagée revue sobriété 2026-04-25 (A6)** : infra Slack dormante V1 supprimée (paramètres `m11_slack_*`, route entrante boutons, format Block Kit, secret Vault `slack_webhook_alerting`). Anti-pattern code mort en prod. Réactivation ultérieure = recoder à partir de zéro.

### D13 — Fonction SQL unique `tms.alerte_emit`

**Choix** : option b.

**Rationale** : single entry point garantit routing + dédup + insert homogènes. Tous les modules l'appellent (trigger DB + services Node). Testable pgTAP, auditable `tms.audit_logs`. Option a (écriture directe) = duplication, option c (queue async) = complexité overkill pour 30 prestataires.

---

## 11. Data Model — addendum §04

### 11.1 Nouveaux types

```sql
CREATE TYPE alerte_criticite AS ENUM ('warning', 'critical');
CREATE TYPE alerte_statut    AS ENUM ('ouverte', 'snoozee', 'resolue');
CREATE TYPE alerte_resolution_source AS ENUM ('manuel', 'auto');
```

**Note Bloc 3 sobriété 2026-04-25** : `info` retiré de `alerte_criticite` (A1), `expiree` retiré de `alerte_statut` (A7), `expiration` retiré de `alerte_resolution_source` (devenu inutile).

**Note Bloc 6 sobriété 2026-04-28 B2+D2** : `ackee` retiré de `alerte_statut` — enum passe de 4 → 3 valeurs (`ouverte`, `snoozee`, `resolue`). L'ack est désormais une metadata via `ackee_par_user_id / ackee_at` nullable sur `tms.alertes`.

### 11.2 Table `tms.alertes_catalogue`

```sql
CREATE TABLE tms.alertes_catalogue (
  code                       text PRIMARY KEY,                          -- ex: 'm07_cout_manquant'
  titre_par_defaut           text NOT NULL,
  description                text,
  criticite_par_defaut       alerte_criticite NOT NULL,
  destinataires_par_defaut   jsonb NOT NULL DEFAULT '{"roles": ["ops_savr"], "users": [], "manager_prestataire_scope": "none"}'::jsonb,
  -- Colonne `canaux` retirée Bloc 4 sobriété 2026-04-25 (A11) : matrice canal/criticité figée hardcodée V1
  --   (`warning` → in-app / `critical` → in-app + email Resend). Réintroduire si override par-code nécessaire V1.1+.
  module_origine             text NOT NULL,                              -- 'M01' | 'M02' | ... | 'M14' | 'transverse'
  active                     boolean NOT NULL DEFAULT true,
  desactive_par_user_id      uuid REFERENCES users_tms(id),
  desactive_at               timestamptz,
  desactive_motif            text,
  supprime_at                timestamptz,                                -- soft delete
  supprime_par_user_id       uuid REFERENCES users_tms(id),
  -- Colonne `remplace_par_code` retirée Bloc 4 sobriété 2026-04-25 (A10) : codes seedés stables V1, EC16 dégagé.
  --   Si renommage post-launch : soft-delete ancien + créer nouveau, alertes historiques restent sous l'ancien code.
  cree_at                    timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alertes_catalogue_active ON tms.alertes_catalogue(active) WHERE active = true;
CREATE INDEX idx_alertes_catalogue_module ON tms.alertes_catalogue(module_origine);
```

**Seed V1** (extrait — cf. §12 catalogue canonique complet) : 40+ lignes peuplées en migration initiale.

### 11.3 Table `tms.alertes`

```sql
CREATE TABLE tms.alertes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     text NOT NULL REFERENCES tms.alertes_catalogue(code),
  criticite                alerte_criticite NOT NULL,
  titre                    text NOT NULL,
  entity_type              text,                                  -- 'tournee' | 'facture_prestataire' | 'collecte_tms' | 'prestataire' | 'chauffeur' | NULL (Bloc 4 sobriété 2026-04-25 A5 : `'test'` retiré, RPC m11_emit_test dégagée V1)
  entity_id                uuid,
  payload                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key                text GENERATED ALWAYS AS (code || ':' || COALESCE(entity_type, '') || ':' || COALESCE(entity_id::text, '')) STORED,
                                                                  -- Tranché 2026-06-07 (F3) : expression explicite alignée sur v_dedup_key W1 — l'INSERT W1 ne fournit pas la colonne, sans STORED il échouait (NOT NULL)
  occurrences              integer NOT NULL DEFAULT 1,            -- counter incrémenté par debounce
  derniere_occurrence_at   timestamptz NOT NULL DEFAULT now(),

  statut                   alerte_statut NOT NULL DEFAULT 'ouverte',
  destinataires_user_ids   uuid[] NOT NULL DEFAULT '{}',

  -- Cycle de vie
  emise_at                 timestamptz NOT NULL DEFAULT now(),
  ackee_par_user_id        uuid REFERENCES users_tms(id),
  ackee_at                 timestamptz,
  snoozee_jusqu_a          timestamptz,
  snoozee_par_user_id      uuid REFERENCES users_tms(id),
  snoozee_motif            text,
  resolue_par_user_id      uuid REFERENCES users_tms(id),
  resolue_at               timestamptz,
  resolue_source           alerte_resolution_source,
  resolue_raison           text,                                 -- motif manuel OU raison auto (trigger disparu)
  resolue_motif            text,                                 -- motif facultatif W6

  -- Intégrité
  -- Contrainte ackee retirée Bloc 6 sobriété 2026-04-28 B2 : `ackee` n'est plus un statut enum.
  -- ackee_par_user_id / ackee_at = metadata nullable sur statut 'ouverte'. Cohérence assurée par RPC m11_ack.
  CONSTRAINT alertes_ackee_coherence CHECK (
    (ackee_par_user_id IS NULL) = (ackee_at IS NULL)  -- les 2 champs remplis ensemble ou vides ensemble
  ),
  CONSTRAINT alertes_statut_snooze CHECK (
    (statut != 'snoozee') OR (snoozee_jusqu_a IS NOT NULL AND snoozee_par_user_id IS NOT NULL)
  ),
  CONSTRAINT alertes_statut_resolue CHECK (
    (statut != 'resolue') OR (resolue_at IS NOT NULL AND resolue_source IS NOT NULL)
  )
);

CREATE INDEX idx_alertes_dedup_ouvertes ON tms.alertes(dedup_key) WHERE statut IN ('ouverte', 'snoozee');  -- Bloc 6 B2 : 'ackee' retiré
CREATE INDEX idx_alertes_criticite_statut ON tms.alertes(criticite, statut) WHERE statut IN ('ouverte', 'snoozee');  -- Bloc 6 B2
CREATE INDEX idx_alertes_non_ackees ON tms.alertes(criticite, emise_at) WHERE statut = 'ouverte' AND ackee_at IS NULL;  -- Bloc 6 B2 : filtre "non ackée"
CREATE INDEX idx_alertes_destinataires ON tms.alertes USING GIN (destinataires_user_ids);
CREATE INDEX idx_alertes_entity ON tms.alertes(entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX idx_alertes_emise_at ON tms.alertes(emise_at DESC);
CREATE INDEX idx_alertes_code_date ON tms.alertes(code, emise_at DESC);
```

### 11.4 Table `tms.alertes_evenements_log`

**Dégagée Bloc 6 sobriété 2026-04-28 (C1)**. Timeline cycle de vie alerte fusionnée dans `tms.audit_logs` existante (`entity_type='alerte'`, `row_id=alerte_id`, `action` = `M11_ACK` / `M11_SNOOZE` / `M11_UNSNOOZE` / `M11_RESOLVE_MANUEL` / `M11_RESOLVE_AUTO`, `contexte JSONB`). Avantage : -1 table, -1 infrastructure de purge séparée, -1 set de policies RLS. Rétention via purge `tms.audit_logs` existante. E2 drawer lit `tms.audit_logs WHERE entity_type='alerte' AND row_id=alerte.id ORDER BY created_at`.

### 11.5 Fonctions SQL

- `tms.alerte_emit(p_code, p_entity_type, p_entity_id, p_payload, p_criticite_override, p_titre_override, p_destinataires_extra) RETURNS uuid` — W1 ci-dessus
- `tms.alerte_resoudre_auto(p_code, p_entity_type, p_entity_id, p_raison) RETURNS integer` — nombre d'alertes résolues
- `tms.m11_ack(p_alerte_id) RETURNS void`
- `tms.m11_snooze(p_alerte_id, p_duree_heures, p_motif) RETURNS void`
- `tms.m11_resoudre_manuel(p_alerte_id, p_motif) RETURNS void`
- `tms.m11_resoudre_destinataires(p_catalogue_row, p_extras) RETURNS uuid[]`
- `tms.m11_notifier(p_alerte_id) RETURNS void`
- — **dégagée Bloc 4 sobriété 2026-04-25 (A5)**

### 11.6 Crons pg_cron

| Nom | Fréquence | Action |
|-----|-----------|--------|
| `m11_unsnoozer` | toutes les 5 min | `UPDATE alertes SET statut='ouverte' WHERE statut='snoozee' AND snoozee_jusqu_a < now()` |
| `m11_purger_archives` | mensuel (1er du mois 4h) | **Étape 1 (refondu B3 2026-05-01)** : INSERT INTO `tms.alertes_archive_critical` SELECT * FROM `tms.alertes` WHERE `criticite='critical' AND statut='resolue' AND resolue_at < now() - interval '3 years'` (dump pré-purge dans table dédiée append-only). **Étape 2** : DELETE FROM `tms.alertes` WHERE `statut='resolue' AND resolue_at < now() - interval '3 years'`. supprimé V1 (trigger sur destructive = piège, dump explicite plus propre). |
| `cron_m04_alerte_inactivite_tournee` | toutes les 15 min | **(ajout 2026-06-06 — résolution spec floue M04 « détection oubli 8h »)** Scan des tournées `statut='en_cours'` dont `heure_reelle_debut < now() - (m04_seuil_inactivite_tournee_heures \|\| ' hours')::interval` (défaut 8h) sans alerte `m04_tournee_oubliee_cloture_auto` ouverte → `tms.alerte_emit('m04_tournee_oubliee_cloture_auto', warning, 'tournee', tournee_id)`. Un trigger DB est **impossible** (condition sur temps écoulé, aucun event déclencheur) → scan périodique pg_cron, miroir de `cron_m02_alerte_acceptation`. Auto-résolution à la clôture de la tournée. |
| `cron_m04_alerte_tournee_sans_chauffeur_j1` | 1×/h | **(ajout 2026-06-06)** Si heure courante ≥ `m04_delai_assignation_chauffeur_alerte_heures` (défaut 17h) à J-1 : scan des tournées `statut IN ('planifiee','acceptee')` planifiées J+0 sans `chauffeur_id` → `tms.alerte_emit('m04_tournee_sans_chauffeur_j1', warning, 'tournee', tournee_id)`. Auto-résolution à l'affectation chauffeur (M04 §14bis). Même justification : condition temporelle → cron, pas de trigger. |

**Crons dégagés revue sobriété 2026-04-25** :
- `m11_flood_watcher` (A8) — était : scan alertes `occurrences > 100` non signalées → émet méta `m11_flood_suspect`
- `m11_expirer_info` (Bloc 3 A1+A7) — était : `UPDATE alertes SET statut='expiree' WHERE statut='ouverte' AND criticite='info' AND emise_at < now() - interval '30 days'`. Plus de criticité `info` ni de statut `expiree` V1.
- `m11_nettoyer_tests` (Bloc 4 A5) — était : auto-résolution alertes `entity_type='test'` âgées > 15 min. RPC `m11_emit_test` + cron + dépendance Vercel KV rate limit dégagés V1, validation par pgTAP CI.

### 11.7 Catalogue canonique V1 (seed)

Codes regroupés par module (liste extractable exhaustive à partir des modules rédigés M01-M08 + M12, complétée par les transverses) :

| Code | Criticité défaut | Module | Libellé |
|------|------------------|--------|---------|
| `m01_webhook_gap_critical` | critical | M01 | Gap webhook Plateforme > 72h détecté |
| `m01_dlq_event_rejected` | critical | M01 | Event Plateforme en DLQ après 5 retries |
| `m01_push_plateforme_dlq` | critical | M01 | Webhook sortant TMS → Plateforme DLQ |
| `m01_hmac_invalide` | critical | M01 | Signature HMAC invalide sur endpoint ingress (tentative intrusion possible) — propagation §12bis M01 |
| `m01_payload_rejete` | warning | M01 | Payload webhook invalide (schéma JSON) — émission S11 `collecte-rejetee` — propagation §12bis M01 |
| `m02_lieu_snapshot_divergent` | warning | M02 | Lieu modifié côté Plateforme après dispatch |
| `m03_prestataire_refus_consecutifs` | warning | M03 | 2 refus consécutifs prestataire en 7j |
| `m03_plaque_manquante_dispatch` | critical | M03 | Plaque requise + non pré-saisie au dispatch |
| `m03_type_vehicule_a_valider` | warning | M03 | Nouveau type véhicule manager à valider Ops |
| `m04_ecart_cout_dispatch` | warning | M04 | Delta coût tournée > 20% au dispatch |
| `m04_cloture_manuelle_forcee` | warning | M04 | Tournée clôturée manuellement par Ops |
| `m04_tournee_vide` | warning | M04 | Tournée `planifiee` sans collecte |
| `m04_evenement_dlq` | critical | M04 | Event dispatch en DLQ |
| `m04_tournee_sans_chauffeur_j1` | warning | M04 | Tournée J+0 sans chauffeur à J-1 17h |
| `m04_tournee_oubliee_cloture_auto` | warning | M04 | Tournée inactive > 8h, clôture forcée possible Ops (R_M04.4 — propagation A5 2026-04-25) |
| `m04_cloture_hors_zone` | warning | M04 | Clôture GPS > 300m du lieu théorique (M04 W5 étape 3 — propagation A5 2026-04-25) |
| `m04_cloture_reelle_post_forcee` | warning | M04 | Clôture chauffeur rejouée (sync offline) après clôture forcée W9 — replay no-overwrite, Δ horaires affiché, correction via W8 (arbitrage RC-M05-06 ; ajout catalogue 2026-07-06 COH-07, criticité `info`→`warning` — enum sans `info`) |
| `m05_geofence_anomalie` | warning | M05 | Fallback "J'arrive" hors geofence 300m |
| `m05_dlq_offline_conflict` | warning | M05 | Conflit sync offline non résolvable (R_M05.16). **Criticité abaissée critical → warning (revue sobriété §05 2026-05-01 B2)** — un seul niveau de gravité V1, escalade humaine via traitement Ops standard. |
| `m05_queue_offline_saturee` | warning | M05 | Cap 3 tournées / 150 photos / 300 Mo atteint (R_M05.9 — propagation A5 2026-04-25) |
| `m05_device_binding_tentative_secondaire` | warning | M05 | Tentative login chauffeur sur device secondaire (R_M05.10 — propagation A5 2026-04-25) |
| `m05_signalement_incident` | warning | M05 | Signalement chauffeur catégorie incident (4 catégories E9 — décision 2026-06-06 : `acces_refuse` / `client_absent` / `probleme_tri` / `autre` ; `pas_excedents` retiré → cas AG « aucun repas » via E5→S5, hors signalement incident). Criticité override possible via paramètre alerte si catégorie bloquante (`acces_refuse` / `client_absent`). |
| `m05_pesee_anormale_hors_seuil` | warning | M05 | Poids pesé hors seuils ZD-only `m05_seuils_pesees_kg_min_max_par_flux` (revue sobriété M05 E6 2026-04-30 : alerte côté Ops uniquement, AUCUN affichage côté chauffeur — n'interrompt pas la saisie terrain) |
| `m07_duree_nulle` | warning | M07 | Durée réelle tournée = 0 (erreur saisie) |
| `m07_horaires_manquants` | critical | M07 | Tournée passée à `terminee` sans `heure_reelle_debut` ou `heure_reelle_fin` (précheck `trg_m07_calc_cost` step 2 — propagation A6 2026-04-25) |
| `m07_ajustement_pendant_facturation` | critical | M07 | Tentative ajustement sur tournée verrouillée par facture M08 (`cout_final_verrouille = true`, EC9 M07) |
| `m08_facture_ecart_detecte` | warning | M08 | Facture prestataire ne match pas (zéro tolérance) |
| `m08_rapprochement_manuel_requis` | warning | M08 | Tournée période facture sans `cout_final_ht` |
| `m08_export_pennylane_erreur` | warning | M08 | Erreur génération CSV Pennylane |
| `m09_stock_bas` | warning | M09 | Stock rolls traiteur < `seuil_alerte_stock_roll_pct` × cible (default 50%) — W1/W2 (R4.2). **Corrigé V1.1 → V1** propagation arbitrage 3 audit cohérence inter-CDC 2026-04-25 + propagation M09 V1 rédigée |
| `m09_stock_negatif` | warning (audit) | M09 | `stocks_rolls_traiteurs.quantite_actuelle < 0` après W1 — propagation M09 V1 2026-04-25. Auto-résolu via E3 recompte Ops (W2) |
| `m09_tare_manquante` | warning | M09 | Pesée avec `types_contenants.tare_kg = 0` ET `slug != 'sans_contenant'` (EC7) — propagation M09 V1 2026-04-25. Auto-résolu à paramétrage tare via E4 (W4) |
| `m10_bac_satur` | dynamic (warning ≥85%, critical au-delà du seuil ou ≥100%) | M10 | Saturation entrepôt — fusion B3 V3 sobre 2026-04-30 (ancien `m10_bac_remplissage_85` fusionné). Email Resend si critical. |
| `m10_passage_non_confirme` | dynamic (warning J-1/J+1, critical si > 1j de retard) | M10 | Passage Veolia `planifie` non déclaré — fusion C1 V3 sobre 2026-04-30 (anciens `_j1`/`_j3` fusionnés sur cron horaire unique). Email Resend si critical. |
| `m10_passage_reporte` | warning (escalade critical si saturation) | M10 | Passage Veolia reporté (`statut = 'annule'` AND `motif_annulation = 'report'`) — risque débordement |
| `m10_passage_annule` | warning | M10 | Passage Veolia annulé (`motif_annulation IN ('annulation','autre')`) |
| `m10_bacs_vides_sous_seuil` | warning | M10 | `quantite_vide_disponible < quantite_vide_cible` |
| `m10_capacite_max_diminuee_satur` | warning | M10 | Capacité max diminuée par Admin met le stock en dépassement |
| `m10_stock_incoherence` | warning | M10 | Décrément W1 aurait rendu vides_disponible négatif → clamp à 0 + alerte (EC14 redéfini arbitrage 2026-06-07 F4 — chauffeur retourne plus que sortis) |

> **Suppressions revue sobriété 2026-04-30 (5 codes M10)** :
> - `m10_bac_remplissage_85` (fusion B3 dans `m10_bac_satur` criticité dynamique)
> - `m10_passage_realise_non_confirme_j1` (corollaire A2/A4 — dualité `realise`/`confirme_at` supprimée)
> - `m10_passage_realise_non_confirme_j3` (corollaire A2/A4)
> - `m10_passage_auto_confirmee_j7` (corollaire A3 — auto-confirmation J+7 supprimée)
> - `m10_chauffeur_signale_bacs_pleins` (corollaire A1 — confirmation chauffeur M05 supprimée)
>
> Catalogue M10 : 12 codes → 7 codes.
| `m12_aucun_prestataire` | critical | M12 | 0 prestataire couvre la zone de collecte |
| `m13_user_creation_email_failed` | warning | M13 | Magic link email user staff/manager non envoyé (SMTP fail M13 W2/W7 EC5) |
| `m13_prestataire_sans_manager_actif` | warning | M13 | Désactivation seul manager actif d'un prestataire (R_M13.20) — auto-résolu à création nouveau manager |
| `m13_secret_expiration_imminente` | warning | M13 | Secret avec `expire_le` < J+7 (cron W12 quotidien) — admin scope only |
| `m13_onboarding_inacheve_7j` | warning | M13 | Prestataire `statut='en_onboarding'` depuis > 7j (cron quotidien EC17) — auto-résolu à activation ou archive |
| `m13_impersonation_session_longue` | warning | M13 | Session impersonation > 30 min active (cron) — admin scope only |
| `m13_parametre_edition_validation_echec` | warning | M13 | Validation server-side `parametres_tms` échouée (W1 rare) |
| `m13_migration_mode_actif_long` | warning | M13 | `migration_mode_active = true` depuis > 35 jours (cron quotidien, propagation §13 2026-04-27) — protection contre oubli désactivation. Admin scope only. |
| `m13_migration_cleanup_failed` | critical | M13 | Cron `m13_cleanup_legacy` échec à J+30 lors de l'auto-résolution alertes critical migration (R_§13.8, propagation §13 2026-04-27) — admin scope only, action manuelle requise via M13 E2 |
| `m14_everest_timeout` | warning | M14 | Timeout API Everest (M12 `is-handled-address` ou autre call) |
| `m14_everest_auth_failed` | critical | M14 | Re-auth Bearer Everest échoue (W6 lazy refresh — creds invalides ou Everest down auth) — propagation M14 2026-04-25 |
| `m14_everest_mission_create_failed` | critical | M14 | Création mission Everest échec final post-retry W1 — collecte en `creation_failed`, Ops failover E4 — propagation M14 2026-04-25 |
| `m14_everest_mission_cancel_failed` | warning | M14 | Annulation mission Everest échec final W3 — risque double-dispatch, Ops appel manuel — propagation M14 2026-04-25 |
| `m14_everest_webhook_signature_invalid` | warning | M14 | Token webhook entrant invalide (filet sécurité M14 D6) W2 — surveillance attaque potentielle — propagation M14 2026-04-25 |
| `m14_everest_webhook_unknown_mission` | warning | M14 | Webhook reçu pour `mission_id` inconnu en DB W2 — propagation M14 2026-04-25 |
| `m14_everest_mission_failed` | critical | M14 | Webhook `mission_failed` reçu W2 — incident terrain à investiguer avec A Toutes! et chauffeur — propagation M14 2026-04-25 |
| `m14_everest_mission_cancelled_externally` | critical | M14 | Webhook `mission_cancelled` non initié par TMS W2 — A Toutes! a annulé chez eux, Ops contact urgent — propagation M14 2026-04-25 |
| `m14_everest_mission_late` | warning | M14 | Webhook `mission_late` reçu W2 — retard chauffeur A Toutes! signalé Ops — propagation M14 2026-04-25. **Seedé `active = false` V1** (sobriété M14 2026-04-30 A_M14_07 — risque bruit, seuil Everest non confirmé Q4. À activer V1.1 si seuil utile). |
| `integration_ocr_mistral_down` | warning | transverse | OCR Mistral indisponible |
| `integration_resend_email_failed` | critical | transverse | Email Resend échec (fallback in-app) |
| `integration_pennylane_down` | warning | transverse | API Pennylane indisponible — **seedé `active = false` V1** (intégration Pennylane = V2, code ne peut pas se déclencher en V1 ; activer V1.1+ à la mise en place Pennylane TMS) |
| `m11_notification_email_failed` | critical | M11 | Échec notif email pour alerte critical |

> **SOLDE CATALOGUE V1 — décompte autoritaire (revue sobriété M11 2026-06-04)**
> **61 lignes seedées** dans le catalogue ci-dessus (entrées non barrées), dont **2 seedées `active = false` V1** (`m14_everest_mission_late` — seuil Everest non confirmé Q4 ; `integration_pennylane_down` — intégration Pennylane = V2) → **59 codes effectivement émettables V1**.
> Ce solde intègre toutes les passes antérieures (Blocs 1-6 + revues §05/§08 par module), le retrait des 2 codes plaque (`m04_plaque_mismatch_warning`, `m04_plaque_inconnue`) du 2026-06-04 (suppression saisie plaque terrain) **et l'ajout de `m04_cloture_reelle_post_forcee` (2026-07-06 COH-07, arbitrage RC-M05-06 — ex-solde 60/58)**. Les narrations historiques de décompte ci-dessous (« 56 codes », « 61→58 codes » §13.11) sont **périmées** — ce solde fait foi.

**Codes dégagés revue sobriété 2026-04-25** :
- A8 `m11_flood_suspect` (était : flood alerte détecté, lié à R_M11.9 dégagée)
- Bloc 3 A1 (criticité `info` retirée V1) — 12 codes ex-`info` retirés du seed et tracés désormais dans `tms.audit_logs` ou `integrations_logs` selon module : `m05_realisee_sans_collecte` (statut `collectes_tms`), `m05_force_logout_admin` (audit_logs M13), `m09_recompte_ecart_rolls` (table `rolls_mouvements` source `recompte_ops`), `m09_tare_modifiee` (audit_logs `TYPE_CONTENANT_TARE_UPDATE`), `m09_stock_initial_inconnu` (audit_logs M09 fallback), `m10_recomptage_ecart` (table `recomptages_stocks_entrepot_log`), `m13_secret_rotated` (audit_logs M13 W5), `m13_event_manual_replay` (audit_logs M13 W6), `m13_impersonation_started` (audit_logs M13 W9), `m14_everest_coverage_stale` (integrations_logs M12), `m14_everest_webhook_event_unknown` (integrations_logs M14 + statut inbox `failed_unknown_event`), `m14_everest_acceptee_manuellement` (audit_logs M14 W4)
- Bloc 3 A1 reclassement — `m08_rappel_facture_j5` passé `info` → `warning` (rappel actionnable manager, scope `manager_prestataire`, pas Ops). **Renommé `m08_rappel_facture` revue sobriété 2026-04-30 B5 — fusion J+5/J+15 dans même alerte avec UPDATE criticité. Puis code entièrement supprimé revue sobriété §05 2026-05-01 A1 (W11 cron supprimé V1, supervision via widget M08 E0).**

*(Historique de décompte — périmé, voir SOLDE CATALOGUE V1 autoritaire ci-dessus.)* 70+ codes seed V1 → **57 codes après Bloc 3 sobriété 2026-04-25 (12 retirés, 1 reclassé)**. **M10 propagé 2026-04-25 : 9 codes seedés. Propagation A5 2026-04-25 : +9 codes (2 m04_*, 7 m05_*) précédemment référencés sans seed → R_M11.1 désormais respectée pour M04/M05. Propagation A6 2026-04-25 : +1 code (`m07_horaires_manquants` critical) pour précheck `trg_m07_calc_cost`. Propagation M13 2026-04-25 : +10 codes `m13_*` pour M13 Administration TMS (workflows W1-W12, E5 secrets, E6 monitoring, E7 wizard, E9 impersonation). Codes admin scope (`m13_secret_*`, `m13_impersonation_*`) filtrés par `manager_prestataire_scope='admin'` selon R_M11.8. Propagation M14 2026-04-25 : +11 codes `m14_*` (les 2 codes pré-existants `m14_everest_timeout`/`m14_everest_coverage_stale` conservés, redocumentés pour V1 puisque M14 est désormais V1 rédigée). Total catalogue M14 : 13 codes. Propagation §13 2026-04-27 : +4 codes `m13_migration_*` (mode migration MTS-1 — toggle activation/désactivation, garde-fou durée prolongée >35j, échec cleanup J+30). Total catalogue après §13 : 61 codes. **Revue sobriété §05 2026-05-01 A1 : -1 code (`m08_rappel_facture` supprimé) → 60 codes.** **Revue sobriété §05 2026-05-01 A5 : -1 code (`m14_everest_incomplete_notify_failed` supprimé, W5 reporté V1.1) → 59 codes. Catalogue M14 : 10 → 9 codes effectivement seedés.** **Revue sobriété §05 2026-05-01 D2 : -3 codes (`m07_cout_manquant` + `m13_prestataire_sans_grille_post_onboarding` + `m12_presta_sans_grille` supprimés, cas impossibles par construction grâce à R_M06.X grille obligatoire création prestataire) → 56 codes. Catalogue M07 : 4 → 3 codes. Catalogue M12 : 3 → 2 codes.**

> **Résolu Bloc 6 B5bis 2026-04-28** : `m04_checklist_bypass` retiré du catalogue (barré ci-dessus), `m05_checklist_contournement_detecte` est le code canonique unique (convention émetteur M05). Propagation M04 faite.

---

## 12. Dépendances

### 12.1 Modules émetteurs (doivent appeler `alerte_emit`)

M01, M02, M03, M04, M05, M06 (chauffeur archivage), M07, M08, M09, M10, M12, M13 (config audit), M14 (Everest).

Chaque module spécifie dans sa section "Alertes émises" la liste des codes qu'il produit. Cette section est **normative** — ce qui n'est pas listé ne doit pas être émis par le module (discipline catalogue).

### 12.2 Modules consommateurs

- **M13 Admin** : UI catalogue (E4), configuration paramètres `m11.*`, dashboard monitoring tendances
- **M05 PWA chauffeur** : n'affiche PAS le dashboard M11, mais certaines alertes `m05_*` déclenchent des toasts locaux PWA (hors scope M11 serveur)
- **M03 Portail prestataire** : affiche les alertes routées `manager_prestataire_scope='entity'` dans une zone "Notifications" manager (UX M03 E1 bandeau). Codes V1 concernés : aucun à date (le code historique `m08_rappel_facture` a été supprimé revue sobriété §05 2026-05-01 A1, supervision factures déplacée sur widget M08 E0 manuel). Pattern conservé pour codes futurs.

### 12.3 Services externes

- **Resend** : provider email critical V1 (templates `alerte_critical_v1`, `alerte_critical_digest_v2` futur)
- **Supabase Realtime** : non utilisé V1 (polling 30s suffit, simplicité D9). Peut être ajouté V1.1 pour dashboard realtime.
- — **supprimée Bloc 6 sobriété 2026-04-28 C1** → `tms.audit_logs`.
- — **supprimée Bloc 6 sobriété 2026-04-28 C2** → lecture directe `tms.alertes` RLS.

### 12.4 Cloche notifications header (propagation §11 2026-04-27)

Voir aussi [[11 - Dashboards TMS]] §3.9.

**Composant** : `<HeaderBellNotifications />` (factorisé `packages/ui-tms`).

**Spécifications** :
- Présent dans le header de toutes les pages (sauf PWA chauffeur M05).
- Lit `tms.alertes WHERE auth.uid() = ANY(destinataires_user_ids) AND statut IN ('ouverte','snoozee') AND ackee_at IS NULL` (count non ackées). **Bloc 6 sobriété 2026-04-28 C2** : `notifications_inbox_tms` supprimée, lecture directe `tms.alertes`.
- Badge nombre = count alertes `statut='ouverte' AND ackee_at IS NULL` (non ackées uniquement — indique le travail réel restant).
- Polling 30s aligné dashboard alertes D2.
- Clic cloche : dropdown 10 dernières alertes (severity color, snooze quick action 1h/4h/24h).
- Bouton « Voir toutes » → `/alertes` (D2).

**Spécificité Manager prestataire** : la cloche pointe vers le bandeau intégré M03 E1 (cf. décision §11 D6 : pas d'écran dédié notifications V1). Volume faible, bandeau suffit.

---

## 13. Propagations cross-CDC

### 13.1 §03 Périmètre fonctionnel TMS

- Section `M11 — Alerting et monitoring ops` refondue avec lien vers cette spec détaillée
- — dégagée V1 (revue sobriété 2026-04-25 A2)
- Canaux V1 alignés (in-app + email critical)

### 13.2 §04 Data Model TMS

- Nouveau `CREATE TYPE alerte_criticite`, `alerte_statut`, `alerte_resolution_source`
- Nouvelles tables : `tms.alertes_catalogue`, `tms.alertes`, `tms.alertes_evenements_log`
- 12 paramètres `m11.*` dans `parametres_tms`
- 8 fonctions SQL listées §11.5
- 5 crons pg_cron listés §11.6

### 13.3 §05 Règles métier TMS

- Nouvelle règle R11 = R_M11.1 à R_M11.11 (R_M11.12 dégagée Bloc 4 sobriété 2026-04-25 A5)
- Cycle de vie alerte ajouté R6 (cycles de vie existants)

### 13.4 §09 Auth et permissions TMS

- Policies RLS `tms.alertes` : SELECT staff (ops_savr, admin_tms, admin_savr) + destinataires de l'alerte (via `auth.uid() = ANY(destinataires_user_ids)`). INSERT uniquement via fonctions SECURITY DEFINER (pas direct). UPDATE **staff only** (**F5 2026-06-07** — manager destinataire lecture seule), restreint aux transitions de statut + metadata ackee autorisées (R_M11.11) via policy WITH CHECK. Pas de DELETE user (purge via service role uniquement).
- Policies `tms.alertes_catalogue` : SELECT tous staff, INSERT/UPDATE admin_tms uniquement, soft-delete admin_tms
- — **supprimées Bloc 6 sobriété 2026-04-28 C1** (table supprimée)
- — **supprimées Bloc 6 sobriété 2026-04-28 C3** (table supprimée)
- — **supprimées Bloc 6 sobriété 2026-04-28 C2** (table supprimée)
- Manager prestataire : SELECT uniquement alertes où `destinataires_user_ids @> ARRAY[auth.uid()]` (aucun code V1 à date depuis suppression `m08_rappel_facture` revue sobriété §05 2026-05-01 A1 — pattern conservé pour codes futurs scope `manager_prestataire='entity'`)
- Tests pgTAP bloquants CI :
  - `test_m11_emit_unknown_code_raises`
  - `test_m11_emit_inactive_code_silent`
  - `test_m11_debounce_increments_occurrences`
  - `test_m11_ack_requires_staff` (**F5 2026-06-07** : ack/snooze staff only, manager destinataire = SELECT seul — ex-`test_m11_ack_requires_destinataire_or_staff`)
  - `test_m11_ack_idempotent_no_error` — **nouveau Bloc 6 B2** : double ack retourne silencieux
  - `test_m11_snooze_max_24h_enforced`
  - `test_m11_resolue_auto_idempotent`
  - `test_m11_manager_prestataire_scope_rls`
  - `test_m11_catalogue_admin_only_write`
 - — **retiré Bloc 6 C1** (table supprimée)

### 13.5 §15 Sécurité et conformité TMS

- Nouvelle section `15.6 Alertes opérationnelles (tms.alertes)` : rétention 3 ans, trace `tms.audit_logs` pour critical uniquement à la purge, RLS destinataires, append-only `alertes_evenements_log`, email critical `ops@gosavr.io` reply-to
- Confidentialité : payload JSONB peut contenir montants factures, IDs prestataires → confidentiel, jamais public

### 13.6 Modules existants M01-M08, M12 — unification nommage

**Action post-rédaction M11** : audit de chaque module rédigé et remplacement des libellés ad-hoc par le code canonique du catalogue.

Exemples :
- → **Caduc revue sobriété §05 2026-05-01 D2** (EC1 refondu en exception SQL bloquante, code alerte supprimé du catalogue)
- M02 `dispatch_lieu_snapshot_divergent` → renommer `m02_lieu_snapshot_divergent` (convention `mXX_*`)
- **Caduc (propagation suppression saisie plaque terrain 2026-06-04)** — D4 caduque, alertes retirées

Traité dans le task audit propagations cross-CDC.

### 13.7 §00 Index TMS

- Header "Dernière mise à jour" à actualiser
- Row §06 M11 V1 rédigée
- Section "Propagations 2026-04-24 M11" récapitulative
- Renumérotation "Prochaine session" (M11 → étape 13 faite, candidats restants M09/M10/M13/M14)

### 13.10 Bloc 5 sobriété 2026-04-25 — A13 rejeté

**A13 (W7 résolution auto + RPC `alerte_resoudre_auto` + R_M11.7)** : conservé V1.

**Périmètre concerné** : 11 codes auto-résolus sur 57 (~19% du catalogue), répartis sur 6 modules :
- M03 (2) : `m03_type_vehicule_a_valider`, `m03_plaque_manquante_dispatch` (revue sobriété 2026-04-29 — `m03_sla_acceptation_expire` retiré)
- M04 (2) : `m04_evenement_dlq`, `m04_tournee_sans_chauffeur_j1`
- M07 (0 post-propagation S6 2026-06-04) : retiré V1 (webhook S6 supprimé A2 2026-05-01, recalcul marge cross-schema sans DLQ); `m07_cout_manquant` retiré §05 D2. M07 ne contribue plus aucun code auto-résolu.
- M08 (1 post-revue sobriété §05 2026-05-01 A1) : `m08_facture_ecart_detecte` (`m08_rappel_facture` retiré V1)
- M09 (1) : `m09_stock_bas`
- M10 (2) : `m10_bac_satur` (criticité dynamique fusion B3), `m10_passage_non_confirme` (criticité dynamique fusion C1)

**Justification rejet** :
- Charge ops évitée si conservé : ~30-50 résolutions manuelles/jour évitées (volume réparti M03 plaque + M09 stock bas + M10 bacs + M08 J5/J15/écart)
- Coût technique faible : 1 RPC SQL ~20 lignes, idempotente (R_M11.7), pas de cron, pas de side-effect réseau (notif silencieuse)
- Risque inverse non maîtrisable : alert fatigue + perte confiance Ops + dashboard pollué d'alertes mortes (vraies alertes noyées dans le bruit)
- Profil opposé aux dégagements légitimes Blocs 1-4 (A6/A5/A8 = code dormant ou complexe à faible valeur ; A13 = code simple à forte valeur ops)

**Aucune propagation** : la décision conserve l'état V1 actuel — RPC, R_M11.7, codes auto-résolus, sections "Résolution auto W7" des modules M03/M04/M07/M08/M09/M10 inchangés.

### 13.9 Bloc 4 sobriété 2026-04-25 — propagations appliquées

**A5 (W10 test alerte) + A10 (`remplace_par_code` + EC16) + A11 (colonne `canaux` JSONB)** dégagés V1. **A9 (cron `m11_purger_archives`)** rejeté → conservé V1.

Modifications transverses appliquées dans la session courante :
- §04 Data Model TMS — DDL `alertes_catalogue` : colonnes `canaux` (A11) + `remplace_par_code` (A10) retirées ; paramètres `m11.test_nettoyage_minutes` + `m11.rate_limit_test_par_heure` retirés (A5) ; cron `m11_nettoyer_tests` retiré (A5) ; fonction SQL `tms.m11_emit_test` retirée (A5)
- §05 Règles métier TMS — R_M11.5 reformulée (mention `remplace_par_code` retirée), R_M11.12 supprimée
- §15 Sécurité — ligne "Tests d'alerte Admin" supprimée (référence RPC `m11_emit_test` + Vercel KV + R_M11.12)
- M02 — référence historique `dispatch_lieu_snapshot_divergent` → `m02_lieu_snapshot_divergent` reformulée (plus de `remplace_par_code`)

### 13.8 Bloc 3 sobriété 2026-04-25 — propagations à effectuer

**Suppression criticité `info` (A1) + statut `expiree` (A7)**. Modifications transverses appliquées dans la session courante :

- §03 Périmètre fonctionnel TMS — cycle de vie M11 simplifié (`expiree` retiré)
- §04 Data Model TMS — enums `alerte_criticite` (2 valeurs), `alerte_statut` (4 valeurs à l'issue du Bloc 3 ; **réduit à 3 — `ouverte/snoozee/resolue` — au Bloc 6 2026-04-28 B2, `ackee` devenu metadata**), `alerte_resolution_source` (2 valeurs) ; paramètre `m11.expiration_info_jours` retiré ; cron `m11_expirer_info` retiré
- §05 Règles métier TMS — pseudo-code émetteurs M09/M10/M13 (criticite='info' retiré), R_M11.6 + R_M11.10 reformulées, cycle de vie simplifié
- §15 Sécurité — cycle de vie cell + ligne "trace post-purge" alignées (alertes `info` purgées définitivement → ligne supprimée car plus d'`info` en table)
- Modules émetteurs (M05, M09, M10, M13, M14) — pour chaque code ex-`info` : retirer appel `tms.alerte_emit(code='m..._...')` + remplacer par INSERT direct dans `tms.audit_logs` ou `integrations_logs` selon module ; mettre à jour les sections "Alertes émises" de chaque module
- M08 — `m08_rappel_facture_j5` reclassé `info` → `warning` (scope manager_prestataire inchangé, comportement front M03 inchangé, RLS inchangée — uniquement l'étiquette criticité change). **Renommé `m08_rappel_facture` revue sobriété 2026-04-30 B5 — fusion J+5/J+15 (élévation criticité same alerte) + suppression `m08_escalade_absence_j15`.** **Code entièrement supprimé revue sobriété §05 2026-05-01 A1 — W11 cron supprimé V1, supervision via widget M08 E0 manuelle.**

---

### 13.11 Bloc 6 sobriété 2026-04-28 — propagations appliquées

**Décisions Val** : B2a (ackee→metadata), C1a (evt_log→audit_logs), C2a (notif_inbox supprimée), C3a (codes_overrides supprimé), D2 (enum 4→3), P0 bug (m13_migration_mode_active/inactive→audit_logs), B5bis (m04_checklist_bypass→retiré). B5 cron unsnoozer conservé.

**Modifications dans ce fichier M11** :
- Statut header enrichi (Bloc 6)
- E1 KPI "Ouvertes" : `IN ('ouverte', 'ackee')` → `= 'ouverte'` ; "Critical non ackées" : `AND ackee_at IS NULL`
- E2 timeline : `alertes_evenements_log` → `tms.audit_logs`
- W1 dedup : `IN ('ouverte', 'ackee', 'snoozee')` → `IN ('ouverte', 'snoozee')`
- W3 notifier : `notifications_inbox_tms` INSERT → SELECT direct `tms.alertes`
- W4 ack : `UPDATE statut='ackee'` → `UPDATE ackee_par_user_id/ackee_at` + INSERT `tms.audit_logs M11_ACK`
- W5 snooze : `alertes_evenements_log` → `tms.audit_logs M11_SNOOZE`
- W6 résolution : `alertes_evenements_log` → `tms.audit_logs M11_RESOLVE_MANUEL`
- W7 résolution auto : `IN ('ouverte','ackee','snoozee')` → `('ouverte','snoozee')` + audit_logs M11_RESOLVE_AUTO
- §5.3 in-app : ref `notifications_inbox_tms` supprimée
- §7 cycle de vie : état `ackee` → metadata, diagramme simplifié
- §11.1 types : enum `alerte_statut` 4→3 valeurs (retiré `ackee`)
- §11.3 table alertes : CHECK `alertes_statut_ack` → `alertes_ackee_coherence`, index WHERE sans `ackee` + nouvel index `idx_alertes_non_ackees`
- §11.4 `alertes_evenements_log` : table supprimée (strikethrough)
- §12.4 HeaderBellNotifications : lit `tms.alertes` RLS directement
- §13.4 §09 : 3 tables de policies supprimées, test `evt_log_append_only` retiré, `test_ack_idempotent` ajouté
- §11.7 catalogue : 2 codes `m13_migration_mode_active/inactive` retirés (P0 → audit_logs), `m04_checklist_bypass` retiré (B5bis → `m05_checklist_contournement_detecte`)

**Total M11 Bloc 6** : -3 tables (`alertes_evenements_log`, `notifications_inbox_tms`, `alertes_codes_overrides`), -1 valeur enum, -2 codes catalogue invalides (P0), -1 code doublon (B5bis). *(Décompte intermédiaire 2026-04-28 périmé — voir SOLDE CATALOGUE V1 autoritaire en §11.7 : 60 lignes seedées dont 2 `active=false` → 58 émettables V1, après retrait des 2 codes plaque 2026-06-04.)*

**Propagations requises** (autres fichiers) — voir §13.12 ci-dessous.

### 13.12 Propagations Bloc 6 vers autres fichiers (2026-04-28)

| Fichier | Modification |
|---------|--------------|
| **§04 Data Model TMS** | Enum `alerte_statut` : retirer `ackee`. Index `tms.alertes` : mettre à jour WHERE. Retirer table `alertes_evenements_log` (strikethrough). Retirer table `alertes_codes_overrides` addendum M13 (strikethrough). |
| **§09 Auth TMS** | Retirer policies RLS `alertes_evenements_log`. Retirer policies `alertes_codes_overrides`. Retirer pgTAP `test_m11_evenements_log_append_only`. Retirer pgTAP `test_alertes_codes_overrides_*`. |
| **§05 Règles métier TMS** | R_M11.11 : retirer mention contrainte `alertes_statut_ack`, documenter `alertes_ackee_coherence`. |
| **M13 Administration TMS** | D2 `alertes_codes_overrides` → dégagée Bloc 6 C3. Retirer E8 codes alertes override, W2 upsert_alerte_code_override, table architecture, Edge Function `upsert_alerte_code_override`. |
| **§15 Sécurité TMS** | §15.4.5 : retirer référence `alertes_evenements_log` dans ligne "Timeline append-only". |
| **M04 Gestion tournées** | Retirer/strikethrough `m04_checklist_bypass` → `m05_checklist_contournement_detecte` (B5bis — convention émetteur). |
| **§00 Index TMS** | Propagation Bloc 6 M11 + solde catalogue 61→58 codes. |

---

## 14. Liens

- §03 M11 parent : [[03 - Périmètre fonctionnel TMS#M11 — Alerting et monitoring ops]]
- §04 Data Model (addendum M11) : [[04 - Data Model TMS]]
- §05 Règles métier (R_M11) : [[05 - Règles métier TMS]]
- §09 Auth (RLS section 13) : [[09 - Authentification et permissions TMS]]
- §15 Sécurité (15.6) : [[15 - Sécurité et conformité TMS]]
- Modules émetteurs : [[M01 - Réception ordres de collecte]], [[M02 - Dispatch Ops Savr]], [[M03 - Portail prestataire self-service]], [[M04 - Gestion des tournées]], [[M05 - App mobile chauffeur]], [[M07 - Pilotage financier logistique]], [[M08 - Facturation prestataires]], [[M12 - Attribution transporteur]]

---

## 15. Questions ouvertes V1

1. **Reply-to email critical** : `ops@gosavr.io` alias vers qui exactement (Val + Louis + Ops Savr backup) ?
2. **Volumétrie attendue par code** : ordres de grandeur à mesurer post-launch pour calibrer `debounce_seconds`
3. **Fermée (revue sobriété M11 2026-06-04)** : E6 Préférences utilisateur dégagé V1 (Bloc A4+A12), plus de toggle. Décision figée : **sonore critical activé par défaut V1** (§3 E6 note, à reconsidérer V1.1 si plainte Ops).
4. **Fermée (revue sobriété M11 2026-06-04)** : W10 (RPC `m11_emit_test` + bouton E4) dégagé V1 (Bloc 4 A5). Test ad-hoc V1 = 1 ligne SQL `tms.alerte_emit('code','manuel',gen_random_uuid(),'{"test_admin":true}',NULL,'[TEST]',NULL)` via Supabase Studio (cf. W10 §4). Réintroduire V1.1 si fréquence > 1 test/sem.
5. **Export CSV alertes historiques** : format + champs + accès (Admin TMS uniquement ? Ops Savr aussi ?)
6. **Mobile responsive dashboard** : Ops consulte-t-il le dashboard M11 depuis mobile ou strict desktop V1 ?
7. **Traduction notifications** : tout français V1 ou prévoir EN pour futurs chauffeurs non-francophones ? (M05 déjà posé FR uniquement V1)

**QO dégagée revue sobriété 2026-04-25 (A6)** : — Slack dégagé entièrement V1.
