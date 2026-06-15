# 13 — Migration MTS-1

> **Statut** : V1 rédigée 2026-04-27
> **Dépendances en amont** : §01 Vision (échéance MTS-1), §03 Périmètre (modules V1), §04 Data Model (paramètres `migration_*`), §06 modules opérationnels, §15 Sécurité (audit migration)
> **Dépendance externe** : Mini-chantier `shared.collectes_legacy` (cross-CDC, hors scope §13) — historique collectes Bubble pour benchmarks TMS + portail traiteur Plateforme

---

## 13.1 Cadrage

§13 spécifie la **bascule opérationnelle** de l'écosystème actuel **Bubble (Plateforme legacy) + MTS-1 (TMS legacy)** vers le nouvel écosystème **Savr Plateforme + Savr TMS**.

**Objectif chiffré V1** : aucune collecte Savr perdue ou mal facturée pendant la fenêtre de bascule. Continuité de production prestataires + chauffeurs sans dégradation de la prestation client.

**Périmètre §13** :
- Seed initial des données de référence (prestataires, chauffeurs, véhicules, grilles tarifaires, lieux logistiques)
- Phasage temporel J-60 → J+30 autour du go-live V1
- Mode migration runtime (paramètre + filtre Pennylane + bandeau)
- Plan de double-run total 1 mois (Bubble/MTS-1 source légale + Savr en shadow)
- Plan de consolidation stocks (rolls + bacs)
- Checklist go/no-go
- Plan de rollback
- Plan de communication parties prenantes
- Procédure backup en cas d'indisponibilité du pilote

**Hors périmètre §13** :
- Reprise historique collectes pour benchmarks TMS et portail traiteur Plateforme (`shared.collectes_legacy`) — chantier cross-CDC dédié à ouvrir
- Reprise factures prestataires héritées : 0 reprise en V1, factures pré-bascule réglées hors TMS via MTS-1 archive (cf. §13.12 D4)
- Reprise transactionnel `collectes_tms` / `tournees` / `pesees` historiques : 0 reprise en V1 (cf. §13.12 D1)

---

## 13.2 Acquis et contraintes

### Décisions héritées (non négociables ici)

| Source | Décision |
|---|---|
| §01 Vision | Phasage monolithique : V1 entier livré en une release, bascule post-V1 complet |
| §01 Vision | Double-run 1 mois MTS-1 + TMS Savr |
| M06 D7 | Seed référentiel = saisie manuelle UI M06, zéro import CSV / SQL dump |
| M13 | Acteur `migration` déjà prévu dans `audit_logs.acteur_type` |
| M13 | Wizard onboarding M13 E7 disponible (utilisé hors seed initial — cf. §13.12 D6) |
| §01 Q9 Index | Date d'échéance licence MTS-1 : 30 mai (année à confirmer 2026/2027) |

### Contrainte temporelle

**Date cible bascule** : mi-mai / début juin (T0 = J0). Calendrier dans §13 exprimé en valeurs relatives J-60 / J-30 / J-15 / J-7 / J-1 / J0 / J+7 / J+15 / J+30, à instancier sur calendrier réel dès confirmation Q9 Index.

### Volumétrie cible mois bascule

- ~30 collectes AG / mois
- ~30 collectes ZD / mois
- Total ~60 collectes / mois sur la fenêtre double-run
- ~30 prestataires actifs à seeder (Strike, Marathon, ~28 prestataires province + A Toutes!)
- ~50-80 chauffeurs actifs à seeder
- ~30-50 véhicules actifs à seeder
- ~5-10 grilles tarifaires en cours

---

## 13.3 Phasage temporel J-60 → J+30

```
J-60                     J-30        J-15  J-7  J-1  J0   J+7  J+15  J+30
 │                        │           │     │    │   │    │    │     │
 │── Seed référentiel ────│           │     │    │   │    │    │     │
 │       (Admin TMS)      │           │     │    │   │    │    │     │
 │                                                                    │
 │                        │── Communication parties prenantes ────────│
 │                        │   (Val + Ops Savr)                        │
 │                                                                    │
 │                                    │── Inventaire stocks ──│       │
 │                                    │   (Ops Savr estim.)   │       │
 │                                                                    │
 │                                                       │── Bascule ─│
 │                                                       │   (Val)    │
 │                                                                    │
 │                                                            │── Double-run total ─│
 │                                                            │   (Val saisit double, │
 │                                                            │   prestataires       │
 │                                                            │   double-saisissent) │
 │                                                                                  │
 │                                                            │── Consolidation     │
 │                                                            │   stocks (Ops)      │
 │                                                                                  │
 │                                                                            │── Désactivation ─
 │                                                                            │   mode migration
 │                                                                            │   et clôture MTS-1
```

### Jalons

| Jalon | Date | Owner | Livrable |
|---|---|---|---|
| J-60 | T0 − 60j | Val | Lancement seed Admin TMS + négociation prolongation MTS-1 |
| J-30 | T0 − 30j | Val | Email J-30 envoyé prestataires + chauffeurs + Ops |
| J-15 | T0 − 15j | Val + Strike/Marathon | Présentiel Strike + Marathon (1h chacun) |
| J-15 | T0 − 15j | Val + Ops Savr | Démarrage estimation stocks rolls/bacs |
| J-7 | T0 − 7j | Ops Savr | Estimation stocks finalisée + saisie Admin TMS |
| J-1 | T0 − 1j | Val | Checklist go/no-go validée |
| J0 | T0 | Val | Activation `migration_mode_active = true` + ouverture TMS aux prestataires |
| J+7 | T0 + 7j | Ops Savr | Premier recompte stock entrepôt + ajustement |
| J+15 | T0 + 15j | Ops Savr | Second recompte stock + ajustement |
| J+30 | T0 + 30j | Val | Désactivation `migration_mode_active = false` + clôture MTS-1 |

---

## 13.4 Mode migration (paramètre + filtre + bandeau)

### Paramètre `parametres_tms.migration_mode_active`

Ajout dans `parametres_tms` namespace racine (cf. §04 propagation §13) :

| Clé | Type | Default | Description |
|---|---|---|---|
| `migration_mode_active` | boolean | false | Active le mode migration (bandeau, filtres facturation, audit). À activer à J0 par Val depuis M13 E2, désactiver à J+30. |

### Effets runtime quand `migration_mode_active = true`

1. **Bandeau persistant header TMS** sur tous les écrans (rôles confondus) : `⚠ Mode migration actif — données saisies à des fins de test. Source légale = Bubble + MTS-1 jusqu'à fin de bascule.` Couleur orange. Dismissable session uniquement.

2. **Toutes les factures créées via M08 sont marquées `migration_test = true`** (colonne ajoutée à `factures_prestataires` — cf. §04 propagation §13). Le flux d'export Pennylane CSV (M08 W11) **filtre automatiquement** les factures `migration_test = true`. Aucune facturation Pennylane ne part pour les factures de la fenêtre migration.

3. **Audit log enrichi** : toutes les actions (création collecte, validation prestataire, saisie pesée, création facture) émises en mode migration sont taggées `audit_logs.contexte = 'migration_test'` (colonne ajoutée — cf. §04). Permet filtrage post-bascule.

4. **Codes alertes M11 dégradés** : les alertes critiques opérationnelles (`m08_facture_non_rapprochee_critical`, `m10_passage_non_confirme` criticité critical [V3 sobre 2026-04-30 fusion C1, ex-`m10_passage_realise_non_confirme_j3`], `m07_ajustement_seuil_critical`) émises en mode migration sont auto-résolues à J+30 via cron `m13_migration_cleanup` (intégré au cron M13 existant, +1 ligne SQL). Évite la pollution du dashboard alertes post-bascule.

### Activation / désactivation

- **Activation J0** : Val depuis M13 E2 paramètres TMS, toggle `migration_mode_active` à `true`. Audit `M13_PARAM_UPDATE` (existant). Émission alerte info `m13_migration_mode_active` au catalogue M11.
- **Désactivation J+30** : Val depuis M13 E2, toggle à `false`. Émission alerte info `m13_migration_mode_inactive`. Trigger DB `trg_m13_migration_cleanup` execute le nettoyage (auto-résolution alertes critical de la fenêtre migration).

### Sécurité du toggle

- Modification `migration_mode_active` réservée rôle `admin_tms` (cf. RLS §09 sur `parametres_tms`).
- Pas de hot reload : le flag est cache-aware (cache 60s D6 M13) → effet visible <1 min.
- Audit obligatoire `audit_logs.action = 'M13_MIGRATION_MODE_TOGGLE'` (nouveau code, ajouté §15.4.6 propagation §13).

---

## 13.5 Workflows

### W1 — Seed référentiel (J-60 → J-15)

**Objectif** : peupler le TMS avec ~30 prestataires + chauffeurs + véhicules + grilles tarifaires + lieux logistiques avant J-15. Saisie manuelle UI M06 conformément à M06 D7 (pas d'import CSV).

**Owner** : Val (pilote) + Louis (backup).

**Étapes** :
1. **J-60** : Val active sandbox TMS staging (cf. §07 environnements) + génère liste exhaustive prestataires actifs depuis Bubble/MTS-1 (export liste contacts).
2. **J-60 → J-30** : saisie séquentielle des 30 prestataires via M06 :
   - Strike (priorité 1)
   - Marathon (priorité 1)
   - ~28 prestataires province (priorité 2)
   - A Toutes! (priorité 1, intégration Everest M14 à activer en parallèle)
3. **Pour chaque prestataire** : checklist seed M06 stricte 16 champs obligatoires :
   - Identité : raison sociale, SIRET, adresse siège, contacts opérationnel + facturation
   - Coordonnées siège (lat/lng, rayon intervention)
   - Date début contrat (date_debut_contrat)
   - Grille tarifaire active (date_debut, formule, paramètres)
   - Au moins 1 véhicule + 1 chauffeur actif par prestataire majeur (Strike, Marathon)
4. **J-30 → J-15** : seed chauffeurs + véhicules par prestataire (parallélisable, ~5h Admin TMS par prestataire majeur, ~30 min par prestataire province).
5. **J-15** : auto-contrôle Admin TMS via dashboard M02 + M07 :
   - Tous les prestataires en statut `actif`
   - Toutes les grilles tarifaires `active = true` avec `date_debut <= J0`
   - Tous les chauffeurs Strike/Marathon ont permis + CNI uploadés (non bloquant V1, alerte info M06)

**Effort estimé** : 5j Admin TMS (2j Val priorité 1 + 3j Louis priorité 2 si délégué).

**Risque** : oubli de champ critique sur prestataire majeur. **Mitigation** : checklist stricte 16 champs imprimée + revue croisée Val/Louis sur Strike + Marathon.

### W2 — Inventaire stocks (J-15 → J-7)

**Objectif** : peupler `stocks_rolls_traiteurs` (M09) + `stocks_bacs_entrepot` (M10) avec des estimations Ops Savr pré-go-live (sans déplacement physique — décision A5=c).

**Owner** : Ops Savr (Lou ou désigné).

**Étapes** :
1. **J-15** : Ops Savr produit estimations basées sur :
   - Volumes moyens connus par traiteur (historique Bubble)
   - Inventaire entrepôt approximatif (visuel à distance ou téléphonique avec entrepôt)
   - Tares connues (rolls 400L = 40kg, bacs 1100L = 60kg, etc., cf. M09 seed)
2. **J-10** : saisie dans M09 (pour chaque traiteur, estimation rolls par flux : `bio` typiquement) et M10 (pour chaque couple flux × type_contenant entrepôt).
3. **J-7** : revue par Val. Si écart manifeste, rectification manuelle.
4. **J-1** : verrouillage stocks initiaux. Tag d'audit `audit_logs.acteur_type = 'migration'`.

**Effort estimé** : 1-2j Ops Savr.

**Risque accepté** : stocks faux à J0. **Mitigation** : plan de consolidation §13.6 (recompte forcé J+7, J+15, J+30).

### W3 — Communication parties prenantes (J-30 → J-1)

**Objectif** : adoption fluide chauffeurs + prestataires + équipe Ops. Cf. §13.8 plan détaillé.

**Owner** : Val (pilote majeurs) + Ops Savr (relai chauffeurs/prestataires province).

**Échéances** :
- **J-30** : email J-30 à tous les prestataires (template Resend) + planning des sessions formation
- **J-15** : présentiel Strike + Marathon (1h chacun)
- **J-15 → J-7** : Zoom 1h par prestataire province (groupé : 1 session pour tous, replay envoyé)
- **J-7** : Zoom chauffeurs (1h, replay disponible offline)
- **J-1** : email récapitulatif J-1 (URL TMS, identifiants, contact support)

### W4 — Activation mode migration et bascule (J-1 → J0)

**Owner** : Val.

**Checklist J-1 (soir)** :
1. Vérification go/no-go (cf. §13.7)
2. Communication finale : email + SMS prestataires "Bascule active demain matin 6h"
3. Backup DB Supabase avant bascule (snapshot manuel Vault Supabase)

**Procédure J0 (matin 6h)** :
1. Connexion Val M13 E2 paramètres TMS
2. Toggle `migration_mode_active = false → true`
3. Vérification effets runtime (bandeau visible, paramètre cache invalidé sous 60s)
4. Communication prestataires : "TMS ouvert, double-saisie commence aujourd'hui"
5. Surveillance dashboard M02 + M11 toutes les 2h pour la première journée

**Sortie de W4** : TMS ouvert, mode migration actif, prestataires/chauffeurs informés.

### W5 — Double-run shadow (J0 → J+30)

**Principe** : Bubble + MTS-1 = source légale et facturation officielle. Savr Plateforme + Savr TMS = shadow saisie + tests.

**Acteurs et rôles** :
- **Clients (traiteurs)** : continuent leur process habituel sur Bubble. **Aucune duplication côté client.** Ils ne savent pas que la nouvelle Plateforme existe (sauf comm marketing).
- **Val** : duplique manuellement la saisie côté nouvelle Plateforme à la place des clients. ~60 collectes / mois × ~5-10 min / collecte = 8-25h sur le mois.
- **Prestataires (Strike, Marathon, A Toutes!, province)** : valident sur MTS-1 (production légale) **ET** sur TMS Savr (shadow). Double-saisie acceptation, plaque, chauffeur.
- **Chauffeurs** : utilisent l'app MTS-1 (production légale) **ET** l'app PWA TMS Savr (shadow). Double-saisie pesées, photos, statut collecte.
- **Ops Savr** : pilote MTS-1 en production normale. Consulte TMS Savr en lecture pour vérification cohérence.

**Règles métier W5** :
- **R_§13.1** : `migration_mode_active = true` durant toute W5. Toute saisie côté TMS = `migration_test = true` (factures), `contexte = 'migration_test'` (audit).
- **R_§13.2** : Aucune facture TMS exportée vers Pennylane pendant W5 (filtre automatique cf. §13.4).
- **R_§13.3** : Webhooks TMS → Plateforme (S1-S11) émis normalement. La Plateforme reçoit les statuts mais ne déclenche aucune facturation client (Plateforme côté client = encore Bubble en production).
- **R_§13.4** : Webhooks Plateforme → TMS (E1-E10) reçus normalement. TMS traite les ordres comme en production.
- **R_§13.5** : Si une collecte est saisie sur TMS uniquement (oubli côté Bubble), elle est **invalide légalement**. Prestataire ne sera pas payé pour cette collecte. Val a la charge de garantir que toutes les collectes Bubble sont aussi sur la nouvelle Plateforme via duplication manuelle.
- **R_§13.6** : Si une collecte est saisie sur Bubble uniquement (Val a oublié de dupliquer), aucune action TMS. Continuité Bubble normale.
- **R_§13.7** : Aucune action de retrait/correction automatique entre les deux écosystèmes pendant W5. Toute correction = manuelle.

**Surveillance Val durant W5** :
- Dashboard M02 quotidien (collectes du jour, divergences éventuelles)
- Dashboard M07 hebdomadaire (cohérence coûts calculés vs facturation Strike sur MTS-1)
- Alertes M11 : surveiller alertes `m13_migration_*` mais ignorer alertes critical opérationnelles (auto-résolues à J+30)
- 1 retro hebdomadaire (15 min) avec Strike + Marathon : "ce qui marche / ce qui coince sur TMS"

### W6 — Désactivation mode migration et clôture MTS-1 (J+30)

**Owner** : Val.

**Pré-requis J+30 matin** :
1. Confirmer que toutes les factures Strike/Marathon/A Toutes! du mois M (mois de bascule) ont été reçues et réglées via MTS-1 (paiement effectif vérifié).
2. Confirmer que tous les prestataires sont à l'aise avec TMS Savr (retro hebdo W5 OK).
3. Confirmer que Bubble n'a pas de collecte en cours (pas de collecte programmée future via Bubble).

**Procédure J+30** :
1. Communication prestataires + chauffeurs : "Bascule définitive ce soir 18h. À partir de demain, TMS Savr seul système valide."
2. **18h00** : Val désactive `migration_mode_active = false` via M13 E2.
3. **18h05** : trigger DB `trg_m13_migration_cleanup` execute :
   - Auto-résolution alertes M11 critical émises en `contexte = 'migration_test'` (cf. §13.4)
   - Marquage final factures `migration_test = true` (gardées pour audit, jamais re-exportées)
4. **18h10** : Vérification dashboard M02 (bandeau retiré, alertes nettoyées).
5. **J+30 → J+45** : Val coupe les accès Bubble traiteurs (redirection vers nouvelle Plateforme).
6. **J+45** : Val ferme licence MTS-1 (résiliation contrat).

**Garde-fou** : Si à J+30 une condition pré-requis n'est pas remplie (ex. facture Strike du mois M pas réglée), prolongation 1 semaine avec mode migration toujours actif. Décision Val unilatérale.

### W7 — Rollback (procédure d'urgence)

**Déclencheur** : incident critique TMS rendant impossible la production normale (DB corrompue, indisponibilité Supabase >24h, bug bloquant non patchable sous 4h).

**Pré-requis activé en amont (cf. §13.12 D5)** : prolongation licence MTS-1 +1 mois souscrite à J-30 (~200€). MTS-1 reste donc accessible jusqu'à J+30 minimum.

**Procédure rollback** :
1. **T+0** : Val détecte l'incident (alerte M11 critical ou signalement prestataire).
2. **T+15min** : Val prend la décision rollback ou pas (avec Louis si dispo).
3. **Si rollback** :
   - Communication immédiate prestataires + chauffeurs : "Repli sur MTS-1, ignorer TMS Savr jusqu'à nouvel ordre."
   - Val désactive le bandeau migration (statique, pas de réactivation Bubble côté client)
   - Toute saisie nouvelle = MTS-1 / Bubble seulement
   - Investigation incident en parallèle avec Claude Code support
4. **Si pas de rollback** : mode dégradé Admin Savr (saisie manuelle directe Plateforme contournant TMS, cf. §01 ligne 130). Maintenance technique en parallèle.

**Communication rollback** : email + SMS + appel téléphonique aux 2 majeurs (Strike + Marathon) dans la même heure.

**Reprise post-incident** : nouvelle bascule J0' à planifier après stabilisation. Communication post-mortem aux prestataires.

### W8 — Procédure backup Val indisponible (Single Point of Failure mitigation)

**Contexte** : Val pilote 100% durant W5 (~8-25h saisie / mois + supervision quotidienne). Si Val indisponible >24h (maladie, urgence familiale, déplacement), Louis prend le relais.

**Owner** : Louis (backup nominé).

**Pré-requis** :
1. Louis a un compte `admin_tms` actif depuis J-30
2. Louis a suivi 1h de formation Val pré-bascule (procédure double-saisie + dashboard supervision)
3. Louis a accès au CRM Bubble pour consulter les collectes du jour
4. Document de procédure 1 page partagé Drive : "SOP Backup Val — Migration TMS"

**Procédure activation backup** :
1. Val notifie Louis (SMS) "Backup activé, durée prévue X jours"
2. Louis se connecte TMS + Bubble
3. Louis exécute la procédure double-saisie pour les collectes du jour (~30 min/jour estimé)
4. Louis surveille dashboard M02 + M11 toutes les 2h
5. Si incident critique pendant l'absence Val : escalade immédiate via WhatsApp Val (priorité absolue)

**Limite** : Louis assure la continuité de saisie shadow + surveillance, mais ne prend pas de décision structurelle (rollback, désactivation `migration_mode_active`, communication prestataires majeurs). En cas de doute, Louis attend retour Val ou contacte Val par téléphone même en pleine nuit pour décisions critiques.

---

## 13.6 Plan de consolidation stocks (semaines 1-4)

**Contexte** : décision A5=c implique stocks faux à J0. Plan de rectification progressive sur 4 semaines.

| Date | Action | Owner | Effet |
|---|---|---|---|
| J0 | Stocks initiaux estimés Ops Savr | Ops | Baseline approximative |
| J+7 | Recompte entrepôt M10 forcé | Ops | Rectification stocks bacs entrepôt |
| J+7 | Cross-check rolls traiteurs majeurs (5 plus gros) | Ops | Rectification stock rolls top 5 |
| J+15 | Recompte entrepôt M10 forcé | Ops | Stabilisation finale entrepôt |
| J+15 | Cross-check rolls 10 traiteurs suivants | Ops | Couverture top 15 |
| J+30 | Recompte entrepôt M10 dernier | Ops | Validation post-mois |
| J+30 | Cross-check rolls traiteurs restants | Ops | Couverture 100% |

**Effort total Ops Savr** : ~3h × 3 = ~9h sur le mois (intégrable dans temps Ops normal).

**Effets attendus** :
- Alertes saturation `m10_seuil_atteint` parasites les 2 premières semaines (acceptables, ignorables)
- Auto-résolution à J+30 via cron `m13_migration_cleanup`
- Stocks fiables à J+30 pour entrer en régime de croisière

---

## 13.7 Checklist go/no-go J-1 (Admin TMS)

Critères mesurables, validés par Val à J-1 (soir). 12 critères, tous doivent être OK pour autoriser la bascule.

### Catégorie A — Référentiel (5 critères)

- [ ] **A1** Tous les prestataires V1 actifs sont saisis dans M06, statut `actif`. ≥30 prestataires.
- [ ] **A2** Strike + Marathon ont au moins 1 grille tarifaire `active = true` valide à J0 (date_debut ≤ J0, date_fin null ou > J+30).
- [ ] **A3** Chaque prestataire majeur (Strike, Marathon, A Toutes!) a au moins 1 chauffeur actif et 1 véhicule actif rattaché.
- [ ] **A4** Lieux logistiques principaux enrichis (rayon, accès, parking) sur 80% des prestataires.
- [ ] **A5** Onboarding A Toutes! Everest M14 : `everest_client_id` saisi + ping API testé OK.

### Catégorie B — Configuration TMS (3 critères)

- [ ] **B1** Paramètres TMS namespace M01-M14 + M13 seed complet (cf. §04 paramètres).
- [ ] **B2** Codes alertes M11 catalogue complet (57 codes seed après revue sobriété).
- [ ] **B3** Sandbox tests : 5 collectes test saisies de bout en bout (E1 dispatch → S1 acceptation → W4 tournée → W8 pesée → W9 facturation simulée), aucun blocage.

### Catégorie C — Sécurité (2 critères)

- [ ] **C1** SSO Google Ops/Admin actif et testé sur au moins 3 comptes différents.
- [ ] **C2** RLS pgTAP CI : 100% green, aucun test bloquant en échec.

### Catégorie D — Préparation rollback (1 critère)

- [ ] **D1** Prolongation licence MTS-1 +1 mois confirmée par éditeur (email reçu).

### Catégorie E — Communication (1 critère)

- [ ] **E1** Tous les prestataires majeurs ont reçu URL TMS + identifiants + ont confirmé connexion testée.

**Décision Val J-1** : si critères A1-E1 = 12/12 OK → GO. Si <12/12 → décision unilatérale Val (GO avec risque documenté + plan compensation OU NO-GO + report bascule J+1, J+7).

---

## 13.8 Plan de communication détaillé

### Email J-30 prestataires (template Resend)

**Objet** : Migration TMS Savr — votre nouveau espace dans 30 jours

**Contenu cible** :
1. Annonce bascule J0 (date précise)
2. Rappel double-run total 1 mois (vous validez collectes sur les 2 systèmes)
3. URL TMS Savr + identifiants à venir
4. Date présentiel (Strike, Marathon) ou Zoom (province)
5. Contact support : Val (téléphone + email)

### Présentiel Strike (1h, J-15)

- Démo live TMS : E1 réception ordre, E2 acceptation, M03 portail, mobile chauffeur (M05 PWA)
- Q&A
- Distribution PDF mémo manager prestataire (cf. M13 D8)
- Test de connexion sur place avec leurs comptes réels

### Présentiel Marathon (1h, J-15)

Même format que Strike.

### Zoom prestataires province (1h groupé, J-10)

- Démo light + Q&A
- Replay envoyé par email post-session

### Zoom chauffeurs (1h groupé, J-7)

- Démo PWA mobile chauffeur (M05) : connexion, voir tournée, valider collecte, saisir pesée
- Insistance double-saisie : "vous devez utiliser MTS-1 ET TMS pendant 1 mois"
- Replay disponible offline

### Email J-1 récapitulatif

- URL TMS + lien direct mobile (pour chauffeurs)
- Numéro de téléphone support
- Rappel : "Source légale = Bubble + MTS-1 jusqu'à fin du mois. TMS Savr = double-saisie test."

### Email J+30 désactivation

- Annonce bascule définitive
- "À partir de demain, MTS-1 désactivé. TMS Savr seul système valide."
- Coupure Bubble traiteurs côté client (redirection nouvelle Plateforme)

---

## 13.9 Mapping prestataires/chauffeurs/véhicules MTS-1 → TMS

**Approche** : aucun mapping automatisé. Saisie manuelle UI M06 conformément à M06 D7. La référence MTS-1 reste consultable via lecture seule (prolongation licence A7=b).

**Cohérence ID** :
- Aucun ID MTS-1 stocké dans le TMS (pas de colonne `legacy_mts1_id` sur prestataires/chauffeurs/véhicules).
- Si une référence est nécessaire post-bascule (audit), consulter MTS-1 archive ou export final éditeur.

**Cas particulier — Adresses lieux** : `plateforme.lieux.adresse_normalisee` peut inclure des adresses déjà connues dans Bubble. Côté TMS, `collectes_tms.lieu_id` pointe sur `plateforme.lieux.id` (cross-schema). Pendant W5, les lieux sont créés à la volée par Val via la duplication manuelle des collectes côté nouvelle Plateforme (création de lieu si non existant).

---

## 13.10 Risques et mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Val indisponible >48h pendant W5 | Faible | Élevé | Backup Louis nominé + SOP 1 page |
| Prestataire refuse double-saisie | Moyenne | Moyen | Communication présentielle Strike/Marathon, insistance "mois unique de double-saisie", reto hebdo |
| Stocks faux conduisent à perte de collecte | Moyenne | Moyen | Plan consolidation §13.6, recompte forcé |
| Bug bloquant TMS pendant W5 | Faible | Élevé | Prolongation MTS-1 +1 mois, mode dégradé Admin Savr |
| Oubli duplication Val côté nouvelle Plateforme | Élevée | Faible | Source légale = Bubble inchangée. TMS = shadow, oubli sans impact prestataire/client |
| Facture TMS partie sur Pennylane par erreur | Très faible | Moyen | Filtre automatique `migration_test = true`. Surveillance hebdo Val. |
| Date d'échéance MTS-1 confirmée 30 mai 2026 (court délai) | Inconnue | Très élevé | Action Val externe Q9 Index — planning V1 dépend de cette confirmation |

---

## 13.11 Single point of failure Val + procédure backup Louis (résumé)

- **Risque assumé V1** : Val pilote 100%, dépendance forte sur 1 personne pendant 1 mois.
- **Backup nominé** : Louis (Admin TMS).
- **Préparation** : 1h formation J-7, SOP 1 page Drive partagé, accès `admin_tms` actif depuis J-30.
- **Activation** : SMS Val → Louis, prise de relais immédiate.
- **Limite backup** : Louis assure saisie shadow + surveillance, pas de décision structurelle (rollback, désactivation mode migration, comm majeurs).
- **Décisions critiques** : escalade systématique téléphone Val même en pleine nuit.

---

## 13.12 Décisions prises

### D1 — `collectes_tms` démarre vide à J0
- **Décision** : aucune reprise de l'historique transactionnel MTS-1 dans `collectes_tms`, `tournees`, `pesees`.
- **Alternatives écartées** : 6 mois (b), 2 ans (c), tout (d).
- **Justification** : continuité d'analyse passe par `shared.collectes_legacy` (chantier dédié), pas par `collectes_tms`. Évite double stockage et complexité d'import.

### D2 — Double-run total 1 mois (prestataires + chauffeurs double-saisie)
- **Décision** : Val duplique seul côté nouvelle Plateforme. Prestataires + chauffeurs utilisent les 2 systèmes pendant 1 mois. Source légale = Bubble + MTS-1.
- **Alternatives écartées** : big-bang (a), double-run partiel MTS-1 lecture seule (b), bascule par prestataire (d).
- **Justification** : maximum de tests réels prestataires/chauffeurs avec filet de sécurité Bubble/MTS-1. Coût opérationnel concentré sur Val + double-saisie prestataires (acceptable pour 1 mois).

### D3 — 0 reprise factures héritées
- **Décision** : factures Strike/Marathon/A Toutes! émises avant J+30 réglées via MTS-1 archive uniquement. Aucune saisie OCR M08 dans le TMS pour ces factures.
- **Alternatives écartées** : factures en cours OCR (b), 6 mois OCR (c), mix (d).
- **Justification** : simplicité maximale. Continuité paiements via MTS-1, audit fiscal couvert par MTS-1 archive 5 ans.

### D4 — Estimation Ops Savr stocks (sans inventaire physique)
- **Décision** : Ops Savr produit estimations à distance, plan de consolidation J+7 / J+15 / J+30.
- **Alternatives écartées** : inventaire physique J-1 (a, coût 3j Ops), démarrage à 0 + auto-correct (b, stock faux 6 semaines).
- **Justification** : compromis entre précision et coût. Acceptation alertes M10 parasites les 2 premières semaines.

### D5 — Prolongation licence MTS-1 +1 mois
- **Décision** : Val négocie prolongation licence MTS-1 +1 mois (~200€) pour rollback éventuel.
- **Alternatives écartées** : pas de rollback (a), mode dégradé Admin Savr seul (c).
- **Justification** : coût ridicule vs risque. Mode dégradé Admin Savr conservé en backup secondaire.

### D6 — Saisie directe M06 partout (pas de wizard M13 E7 pour seed)
- **Décision** : seed initial 30 prestataires via saisie directe M06, pas via wizard M13 E7.
- **Alternatives écartées** : wizard systématique (a, +10h), mix wizard pour majeurs / direct pour province (c).
- **Justification** : économie maximale (5h vs 15h wizard). Risque oubli compensé par checklist seed M06 stricte 16 champs obligatoires + revue croisée Val/Louis sur Strike + Marathon.

### D7 — Mode migration runtime via `parametres_tms.migration_mode_active` + filtre auto Pennylane
- **Décision** : flag boolean activé par Val à J0, désactivé à J+30. Effets : bandeau header, marquage `factures_prestataires.migration_test = true`, filtre export Pennylane, audit `contexte = 'migration_test'`.
- **Alternatives écartées** : annulation 100% manuelle factures (rejeté : ~30 annulations à la main, risque oubli, double facturation Pennylane).
- **Justification** : zéro effort manuel récurrent. Activation/désactivation = 1 toggle. Filtre automatique = 0 risque double facturation.

### D8 — Checklist go/no-go J-1 sans phase pilote séparée
- **Décision** : 12 critères Admin TMS (catégories A-E) validés par Val à J-1. Pas de phase pilote Strike 1 semaine séparée.
- **Alternatives écartées** : pilote Strike 1 semaine (c).
- **Justification** : D2 (double-run total) joue déjà le rôle de pilote pour les 30 prestataires en parallèle. Pas de redondance nécessaire.

### D9 — Communication recommandée (J-30 + présentiel majeurs + Zoom autres)
- **Décision** : email J-30 + présentiel Strike/Marathon (1h chacun) + Zoom prestataires province + Zoom chauffeurs + email J-1 récapitulatif.
- **Alternatives écartées** : minimal (a), maximal avec sandbox prestataires (c).
- **Justification** : équilibre effort/adoption. Cohérent avec D8 M13 (PDF mémo manager prestataire).

### D10 — Val pilote 100% + Louis backup nominé
- **Décision** : Val pilote toutes les phases (seed, comm majeurs, double-saisie shadow, supervision). Louis backup nominé pour saisie shadow + surveillance si Val indisponible >24h.
- **Alternatives écartées** : Val sec sans backup (a, single point of failure non mitigé), externalisation prestataire data (c).
- **Justification** : ressources internes mobilisées, single point of failure mitigé sans coût additionnel.

---

## 13.13 Edge cases

| Code | Scénario | Comportement attendu |
|---|---|---|
| EC1 | Val active `migration_mode_active = true` mais oublie le bandeau | Le bandeau est calculé runtime depuis le paramètre, pas configurable. Si oubli activation paramètre, pas de bandeau (bug critique). Mitigation : alerte M11 `m13_migration_mode_active` émise à chaque toggle. |
| EC2 | Facture créée juste avant désactivation `migration_mode_active = true → false` | La colonne `migration_test = true` est figée à la création de la facture (pas recalculée à la désactivation). Facture reste exclue Pennylane même après désactivation. |
| EC3 | Prestataire ne valide que côté MTS-1, oublie le TMS | Aucune action TMS (collecte côté TMS reste `attribuee` sans transition). Prestataire payé via MTS-1. À l'analyse Val identifie l'oubli (alerte M02 stale). Communication prestataire pour rappel. |
| EC4 | Prestataire ne valide que côté TMS, oublie MTS-1 | Côté MTS-1 : aucune validation, pas de paiement. Côté TMS : statut `acceptee`. Cas anormal en double-run total. À l'analyse Val identifie via cross-check Bubble + alerte M02 hebdo. |
| EC5 | Val crée une collecte côté nouvelle Plateforme mais oublie côté Bubble | Aucune action légale (Bubble = source). TMS reçoit la collecte mais elle n'a pas de pendant Bubble → potentiel oubli paiement client. R_§13.5 documente le risque. Mitigation : Val cross-check hebdo Bubble vs nouvelle Plateforme. |
| EC6 | Prolongation MTS-1 +1 mois refusée par éditeur | NO-GO si checklist D1 KO. Report bascule. Plan B : mode dégradé Admin Savr. Val négocie alternative ou paye prix fort. |
| EC7 | Strike refuse double-saisie | Communication présentielle insiste sur 1 mois unique. Si refus persistant : rollback partiel Strike (Strike ne valide que MTS-1, TMS reste shadow sans tests Strike). Documentation décision + relance fin de mois. |
| EC8 | Bug bloquant TMS jour 1 W5 | Activation rollback W7. Repli MTS-1 + Bubble. Plan B : mode dégradé Admin Savr en parallèle de fix Claude Code. |
| EC9 | Recompte stock J+7 révèle écart majeur (>50% sur un flux) | Audit Ops Savr : erreur estimation J-7 vs réalité. Rectification immédiate stocks via M09/M10 (bouton "ajustement"). Audit log `acteur_type = 'migration'` + `contexte = 'migration_test'`. |
| EC10 | Louis backup activé mais ne sait pas faire (oubli formation) | Procédure SOP 1 page rattrapage. Si blocage : Val joignable WhatsApp en urgence. Si Val réellement indisponible et Louis bloqué → mode dégradé total : production Bubble/MTS-1 uniquement, TMS pause, désactivation `migration_mode_active = false` temporaire. |
| EC11 | Val tente désactivation `migration_mode_active = true → false` avant J+30 | UI confirmation modale "Êtes-vous sûr ? Avant J+30, le mode migration ne devrait pas être désactivé." Bouton confirmation avec saisie texte "DESACTIVER MIGRATION". Audit log enrichi. Pas de blocage technique mais friction maximale. |
| EC12 | Cron `m13_migration_cleanup` échoue à J+30 | Alerte M11 critical `m13_migration_cleanup_failed`. Val réexécute manuellement via M13 E2 (bouton "Re-exécuter cleanup migration"). Audit log spécifique. |

---

## 13.14 Règles métier R_§13.x

| Règle | Énoncé | Trigger | Implémentation |
|---|---|---|---|
| R_§13.1 | `migration_mode_active = true` durant W5. Toute saisie côté TMS marquée `migration_test = true` (factures) et `contexte = 'migration_test'` (audit). | App writes via M02/M05/M08 | Trigger DB BEFORE INSERT sur `factures_prestataires` (set `migration_test = (SELECT migration_mode_active FROM parametres_tms LIMIT 1)`). Helper SQL `tms.is_migration_active()`. |
| R_§13.2 | Aucune facture `migration_test = true` exportée vers Pennylane. | M08 W11 export Pennylane CSV | Filtre `WHERE migration_test = false` dans la fonction `m08_exporter_pennylane`. |
| R_§13.3 | Webhooks TMS → Plateforme (S1-S11) émis normalement durant W5. La Plateforme reçoit mais ne déclenche aucune facturation client (Plateforme côté client = encore Bubble en production). | S1-S11 émis | Aucune modification TMS. Côté Plateforme nouvelle (CDC App), gating sur réception (cross-CDC à documenter). |
| R_§13.4 | Webhooks Plateforme → TMS (E1-E10) reçus normalement durant W5. TMS traite les ordres comme en production. | E1-E10 reçus | Aucune modification TMS. |
| R_§13.5 | Si une collecte est saisie sur TMS uniquement (oubli côté Bubble), elle est invalide légalement. Prestataire ne sera pas payé pour cette collecte. | Cross-check Val | Aucune implémentation tech. R_§13.5 = règle organisationnelle Val. |
| R_§13.6 | Si une collecte est saisie sur Bubble uniquement (Val a oublié de dupliquer), aucune action TMS. Continuité Bubble normale. | N/A | Aucune implémentation tech. R_§13.6 = règle organisationnelle Val. |
| R_§13.7 | Aucune action de retrait/correction automatique entre les 2 écosystèmes pendant W5. Toute correction = manuelle. | N/A | Aucune implémentation tech. |
| R_§13.8 | Cron `m13_migration_cleanup` à J+30 auto-résout les alertes M11 critical de la fenêtre migration. | Cron pg_cron quotidien (déjà existant via M13) | Ajout 1 ligne SQL dans la fonction `m13_cleanup_legacy` : `UPDATE alertes SET statut = 'resolue', resolue_at = NOW(), resolue_source = 'auto' WHERE contexte = 'migration_test' AND statut IN ('ouverte', 'snoozee') AND criticite = 'critical' AND emise_at < NOW() - INTERVAL '30 days'`. **Statut canonique `resolue`** + `'active'`→`'ouverte'` + `resolue_source = 'auto'` (enums `alerte_statut`/`alerte_resolution_source` R_M11.11) — corrigés revue sobriété §05 2026-06-04. |
| R_§13.9 | Toggle `migration_mode_active` réservée rôle `admin_tms`. Audit obligatoire `M13_MIGRATION_MODE_TOGGLE`. | Update `parametres_tms` clé `migration_mode_active` | RLS existante `parametres_tms_admin_only` + audit fonction `tms.audit_param_update`. |

---

## 13.15 Questions ouvertes

1. **Date d'échéance licence MTS-1** : 30 mai 2026 vs 2027. Action Val externe Q9 Index. Conditionne le calendrier T0 de bascule.
2. **Tarif prolongation MTS-1 +1 mois** : ~200€ estimé. À confirmer avec éditeur lors du contact J-60.
3. **Format export final MTS-1 en clôture compte** : à demander à l'éditeur en parallèle (CSV ? SQL dump ?). Utile pour archive RGPD facturation 5 ans.
4. **Coordination cross-CDC mode migration côté nouvelle Plateforme** : la Plateforme nouvelle a-t-elle aussi un mode shadow/migration ? À acter dans CDC App. Hors scope §13 TMS.
5. **Volumétrie réelle vs estimation 60 collectes/mois** : à valider sur les 2 mois précédents Bubble pour confirmation.
6. **Communication clients (traiteurs)** : pendant W5, les traiteurs continuent Bubble normal. Mais quand on coupe Bubble à J+30, comment on communique la migration côté client ? À traiter dans CDC App, hors §13 TMS.
7. **Trigger DB `trg_m13_migration_cleanup`** : code SQL exact à valider en atelier tech avec son frère.

---

## 13.16 Liens

- [[01 - Vision et objectifs TMS]] — §6 Roadmap (échéance MTS-1, double-run 1 mois)
- [[03 - Périmètre fonctionnel TMS]] — Modules V1 / V2
- [[04 - Data Model TMS]] — Paramètre `migration_mode_active`, colonne `factures_prestataires.migration_test`, colonne `audit_logs.contexte`
- [[05 - Règles métier TMS]] — R_§13.x
- [[06 - Fonctionnalités détaillées TMS/M06 - Référentiel prestataires]] — Seed manuel, checklist 16 champs
- [[06 - Fonctionnalités détaillées TMS/M08 - Facturation prestataires]] — Filtre Pennylane `migration_test`
- [[06 - Fonctionnalités détaillées TMS/M09 - Stock matériel Savr]] — Plan consolidation rolls
- [[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia]] — Plan consolidation entrepôt
- [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]] — Codes alertes `m13_migration_*`
- [[06 - Fonctionnalités détaillées TMS/M13 - Administration TMS]] — Toggle `migration_mode_active` E2
- [[07 - Architecture technique TMS]] — Cron `m13_migration_cleanup`, trigger `trg_m13_migration_cleanup`
- [[15 - Sécurité et conformité TMS]] — Audit `M13_MIGRATION_MODE_TOGGLE`, contexte `migration_test`
- Cross-CDC : [[01 - Cahier des charges App/00 - Index]] — coordination mode migration nouvelle Plateforme
- Mini-chantier dépendant : `shared.collectes_legacy` (à ouvrir séparément, cross-CDC)
