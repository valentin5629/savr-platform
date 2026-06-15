# 08 - Génération et édition facture (Admin)

**Statut** : Validé V1
**Dernière mise à jour** : 2026-06-07 (session test-scenarios lot ⑦ — 5 floues tranchées Val + 2 recos : F1 avoir sur `payee` autorisé, F2 mensuelle = agrégation auto J+1 confirmée, F3 lignes libres → `factures_collectes` étendue, F4 numéro conservé après 4xx + table `sequences_facturation`, F5 `factures.marge_logistique` + vue `v_factures_client`, Reco A échéance = `conditions_paiement_jours`, Reco B trigger anti-double-facturation) / 2026-05-08 (revue de sobriété appliquée)
**Lié à** : [[05 - Règles métier]] §4 — Facturation · [[04 - Data Model]] tables `factures`, `factures_collectes`, `tarifs_zero_dechet` · [[08 - APIs et intégrations]] (Pennylane v2)

---

## Principe

Toute facture émise par Savr transite obligatoirement par un **workflow de validation Admin** avant envoi Pennylane. Les PDF visibles dans la plateforme sont des copies de travail — la **facture légale** est celle émise par Pennylane au format Factur-X.

**Relances** : la séquence de relances est gérée **directement dans Pennylane**, pas dans Savr (décision 2026-04-28). Aucun flux relance V1 côté plateforme.

---

## 1. Conformité à la réforme de la facturation électronique (France)

### Contexte réglementaire

- **Réception obligatoire** de factures au format structuré : 1er septembre 2026 (toutes entreprises assujetties TVA)
- **Émission échelonnée** : grandes entreprises et ETI au 1er sept 2026, PME et micro-entreprises au 1er sept 2027
- **Formats obligatoires** : Factur-X (PDF/A-3 + XML CII), UBL ou CII pur
- **Transmission** : via PDP (Plateforme de Dématérialisation Partenaire certifiée) ou PPF (Portail Public de Facturation)
- **E-reporting** : données de transaction transmises en parallèle à la DGFiP

### Stratégie Savr

**Dépendance critique** : Pennylane est l'acteur qui porte la conformité Factur-X et la transmission PPF/PDP. Savr pousse les données brutes via **API Pennylane v2** ; Pennylane produit la facture légale au format conforme et la transmet.

**Conséquence** :
- Le PDF généré par Savr (via Puppeteer/Railway) est une **copie visuelle de travail** uniquement (affichage client, archivage interne)
- La **facture légale** est celle retournée par Pennylane après émission
- Savr stocke dans `factures.pennylane_id` + `factures.pdf_url_pennylane` la référence de la facture légale

### Champs obligatoires à pousser vers Pennylane

Pour que Pennylane produise une Factur-X valide, la plateforme Savr doit transmettre :

| Catégorie | Champs |
|-----------|--------|
| Émetteur Savr | SIREN, adresse complète, n° TVA intracommunautaire |
| Client | SIREN, adresse complète, n° TVA intracommunautaire, nom légal |
| Facture | Numéro unique séquentiel, date d'émission, date d'échéance, devise |
| Lignes | Désignation, quantité, PU HT, taux TVA, montant HT, montant TVA, montant TTC |
| Totaux | Total HT, total TVA par taux, total TTC |
| Mentions | Conditions de paiement, pénalités de retard, escompte, mention "TVA non applicable art. 293 B CGI" si applicable |
| Référence | `evenements.reference_affaire` si renseigné (ex: numéro d'affaire Potel & Chabot) ; sinon bon de commande / contrat si disponible (facultatif) |

### Timing réglementaire — décision actée (2026-04-28)

Savr compte parmi ses clients des ETI ou grandes entreprises (Viparis, Lenôtre, Potel & Chabot). Ces clients doivent **recevoir** des factures en Factur-X dès le **1er septembre 2026**. Savr doit donc être en mesure d'**émettre** en Factur-X dès cette date, sans attendre l'obligation PME de septembre 2027.

**Conséquence** : la conformité Factur-X via Pennylane est un **prérequis bloquant absolu** avant go-live. Tout retard ou incertitude sur la certification PDP de Pennylane doit être résolu avant le début du développement en production.

### Actions critiques pré go-live (opérationnelles — hors CDC)

Ces actions sont de la responsabilité de Val, pas de Claude Code :

1. **Validation écrite Pennylane** : obtenir confirmation écrite de leur statut de certification PDP + date d'activation + champs API v2 exacts pour Factur-X. **Bloquant absolu avant go-live clients ETI.**
2. **Test de bout en bout en sandbox** : émission Savr → API Pennylane → Factur-X générée → vérification PPF (environnement DGFiP de test disponible). À réaliser pendant la phase de build.
3. **DPA Pennylane** : signer le DPA avec Pennylane (voir checklist §15).

---

## 2. Synchro Pennylane — flux unique (nominal + erreurs + retry)

Tout le flux d'envoi vers Pennylane est décrit ici. Il n'y a **qu'une seule policy de retry** pour tout le module.

### 2.1 Comportement nominal

1. Admin valide le brouillon depuis l'écran d'édition (§4)
2. Numéro définitif attribué : `FZD-YYYY-NNNNN` (ZD), `FAG-YYYY-NNNNN` (AG), `FPK-YYYY-NNNNN` (achat pack), `AV-YYYY-NNNNN` (avoir) — voir §6
3. `factures.statut = en_attente_pennylane`, log audit
4. Push Pennylane tenté immédiatement (POST API v2, timeout 30s)
5. Si succès → `statut = emise`, `pennylane_id` + `pdf_url_pennylane` renseignés, email client envoyé

### 2.2 Erreurs et retry

**Erreur 4xx (données invalides — champ obligatoire manquant, TVA invalide, etc.)** :
- Statut bascule en `brouillon` (revient à l'étape précédente)
- **Le `numero_facture` déjà attribué est conservé** (décision F4 test-scenarios 2026-06-07) : la re-validation réutilise le même numéro, pas de réattribution — garantit la séquence fiscale sans trou
- Message d'erreur Pennylane affiché à l'Admin sur la fiche facture
- Pas de retry (les données sont à corriger manuellement)

**Erreur 5xx ou timeout** :
- Statut reste `en_attente_pennylane`
- **Retry automatique 3 phases : 5 min → 1h → 24h**
- Si les 3 tentatives échouent → alerte in-app Admin (bandeau orange sur fiche facture, type `pennylane_echec_final`) + alerte Slack `#savr-alerts-eleve`. Pas d'email dédié V1 (aucun template alloué dans §06.02).
- Bouton "Renvoyer vers Pennylane" disponible sur la fiche facture pour retry manuel

### 2.3 UI

- **Liste Brouillons à valider** (§3) : filtre statut `en_attente_pennylane / en erreur` + colonne pastille orange si > 2h en `en_attente_pennylane`
- **Fiche facture** : bandeau orange "En attente d'envoi Pennylane — dernier essai : il y a Xmin" + bouton "Renvoyer" si `statut = en_attente_pennylane`
- **L'email client n'est envoyé qu'après succès Pennylane** (statut `emise`)

### 2.4 Plan de continuité — Pennylane indisponible prolongée

Si Pennylane est indisponible plus de quelques heures (panne majeure, incident conformité), l'Admin **édite manuellement les factures urgentes directement dans l'interface Pennylane** (procédure hors plateforme Savr, sans flag ni paramètre dédié côté Savr).

Quand Pennylane redevient OK, l'Admin retraite manuellement la queue des brouillons restés `en_attente_pennylane` côté Savr via le bouton "Renvoyer".

Pas d'automatisation V1 (pas de batch de rattrapage, pas de flag fallback) — la fréquence attendue (<1×/an) ne justifie pas le développement.

---

## 3. Déclencheur de génération brouillon

La facture brouillon est générée **automatiquement à la clôture de la collecte** (`collectes.statut = cloturee`), au batch J+1 à 6h du matin.

### ZD
- 1 facture brouillon par collecte (mode défaut `par_collecte`)
- Si l'organisation a le mode `mensuelle` activé : la collecte est ajoutée à un brouillon en cours pour le mois en cours (agrégation `factures_collectes`)

### AG
- Pas de facture générée au niveau de la collecte (le débit du pack tient lieu de comptabilisation)
- La **facture d'achat de pack** est générée au moment de la création du pack (mode `globale_achat`) → voir [[06 - Back-office Admin Savr#Onglet Packs AG sous-section dédiée — fusionnée 2026-05-07 étoffée 2026-05-08]]
- Cas particulier : collecte AG hors pack ou pack `par_collecte` → facture brouillon générée à la clôture

### Cas "Info incomplète" et "Annulée côté Savr"
- Si `collectes.annulee_cote_savr = true` : **aucune facture** n'est générée (pas de brouillon, pas de ligne ajoutée à un brouillon mensuel existant)
- `informations_completes` n'impacte pas la facturation (la donnée manquante concerne les contacts, pas les données de facturation)

---

## 4. Workflow de validation (Admin)

### Vue liste des brouillons

Accessible via Back-office Admin → Facturation → Brouillons à valider.

Tableau :

| Numéro prévu | Organisation | Type | Montant HT | Lignes | Créée le | Statut |
|-------------|--------------|------|-----------|--------|---------|--------|
| FZD-2026-00124 | Kaspia | ZD | 860,00 € | 2 collectes | 20 avr 2026 | brouillon |
| FAG-2026-00045 | GL Events | AG | 590,00 € | 1 collecte | 20 avr 2026 | en_attente_pennylane |

- Filtres : statut (`brouillon` / `en_attente_pennylane`), organisation, type, période
- Pastille orange dans la colonne Statut si `en_attente_pennylane` depuis > 2h
- Clic sur une ligne → ouvre l'**écran d'édition obligatoire**

### Écran d'édition (passage obligé)

L'Admin ne peut pas valider "en un clic" depuis la liste. Tout brouillon doit transiter par cet écran.

**Structure de l'écran** :

**Bloc 1 — En-tête facture**
- Numéro (généré à la validation, affiché en brouillon avec mention "À attribuer")
- Date d'émission (modifiable, défaut = aujourd'hui)
- Date d'échéance (modifiable, défaut = émission + `entites_facturation.conditions_paiement_jours` de l'entité sélectionnée — *Reco A test-scenarios 2026-06-07, ex-30j fixe qui rendait la colonne morte*)
- Organisation cliente + adresse de facturation (tirée de `entites_facturation`)
- Si multi-SIRET : sélecteur de l'entité de facturation à utiliser

**Bloc 2 — Lignes**
Tableau ligne par ligne :

| Collecte | Désignation | Quantité | PU HT | TVA | Montant HT |
|----------|-------------|---------|-------|-----|-----------|
| COL-12345 · 12 avr 2026 | Collecte Zéro-Déchet — Soirée de gala L'Oréal | 1 | 430,00 € | 20 % | 430,00 € |

- Désignation **modifiable** (texte libre)
- Quantité **modifiable** (V1 : toujours 1 pour ZD et AG)
- PU HT **modifiable** (voir §5 Édition manuelle du montant)
- Taux TVA modifiable (défaut 20 %)
- Suppression d'une ligne possible avec confirmation

**Bloc 3 — Ajout de lignes**
Bouton "Ajouter une ligne" → ouvre un sélecteur :
- "Collecte existante" (voir §6 Sélection manuelle de collectes)
- "Ligne libre" (pour frais divers, remises ponctuelles, etc.)

**Bloc 4 — Totaux**
- Total HT
- TVA par taux (20 %, 10 %, 5,5 %, 0 %)
- Total TTC

**Bloc 5 — Référence et conditions**
- **Référence client** : pré-rempli depuis `evenements.reference_affaire` si renseigné (ex: numéro d'affaire Potel & Chabot). Champ modifiable par Admin. Transmis à Pennylane (champ "Référence") et affiché sur l'aperçu PDF brouillon.
- Conditions de paiement (texte libre, template par défaut configurable dans Paramètres)
- Mention pénalités de retard
- Mention escompte (optionnelle)

**Bloc 6 — Actions**
- **Sauvegarder le brouillon** (reste en `brouillon`, pas d'envoi Pennylane)
- **Valider et envoyer à Pennylane** (déclenche le flux décrit en §2)
- **Annuler la facture** (passe en `annulee`, les collectes redeviennent non facturées — voir §7)

---

## 5. Édition manuelle du montant

**Règle V1** : le système pré-remplit le PU HT de chaque ligne selon les règles de tarification, mais l'Admin peut modifier librement.

### ZD *(refonte 2026-05-26 — base de grille + remises)*
Pré-rempli = **base × remises** (cf. [[05 - Règles métier#Tarifs et remises — résolution du prix]]) :
- **Base** : grille du catalogue affectée à l'organisation (`organisations.grille_tarifaire_zd_id`, NULL = grille défaut), ligne couvrant le pax → `montant_fixe_ht + montant_par_pax_ht × pax`.
- **Remises** éligibles (`tarifs_negocie`, scope organisation et/ou gestionnaire du lieu) cumulées multiplicativement.
- Exemple : Butard (grille « Forfait + variable » 200 € + 1 €/pax), 300 pax chez Viparis (−5 %) → 500 × 0,95 = **475 € HT**.

### AG (par collecte)
Pré-rempli selon le pack actif de l'organisation (prix unitaire du pack).
- Exemple : Kaspia a un Pack 30 actif → PU HT = 460 €
- Si pack `personnalise` : PU HT issu de `packs_antgaspi.montant_total_ht / credits_initiaux`
- Si aucun pack : PU HT = 590 € (tarif unitaire), **moins les remises AG éligibles** (`tarifs_negocie` activite=ag) — la remise AG ne s'applique qu'aux collectes facturées à l'unité.

### Override manuel
- L'Admin peut modifier le PU HT librement
- Le calcul appliqué est **figé à l'émission** dans `factures_collectes.tarif_detail` (jsonb : base + remises), `tarif_applique_id` + `tarif_applique_source` (la base) et `montant_ligne_ht` (valeur finale)
- Le log audit (qui / quand / ancien montant / nouveau montant) tient lieu de traçabilité — pas de champ "motif" dédié

---

## 6. Sélection manuelle de collectes

### Cas d'usage

Certains clients (typiquement grands comptes avec beaucoup d'événements) demandent une facture mensuelle groupée plutôt qu'une facture par collecte. Le mode `mensuelle` est activable par Admin sur la fiche organisation (cf. §3).

En complément, l'Admin peut **regrouper ponctuellement** plusieurs collectes dans une même facture sans modifier la config de l'organisation.

### Sélecteur multi-collectes

Depuis l'écran d'édition d'une facture, le bouton "Ajouter une ligne → Collecte existante" ouvre un sélecteur multi-choix :

- Liste des collectes `cloturee` de l'organisation non encore facturées. **Définition formelle « non facturée » (Reco B test-scenarios 2026-06-07)** : aucune ligne `factures_collectes` rattachée à une facture de `statut ≠ annulee` et `type ≠ avoir`. Ce prédicat est aussi appliqué en intégrité par le trigger `trg_fc_collecte_non_facturee` (BEFORE INSERT sur `factures_collectes`, voir [[04 - Data Model]]) — impossible de rattacher une collecte à deux factures actives, même par race batch/manuel
- Filtres : période, type, lieu
- Sélection multiple (checkbox)
- Bouton "Ajouter N collectes" → ajoute autant de lignes dans la facture en cours

Utile pour :
- Grouper manuellement sans activer le mode `mensuelle`
- Récupérer une collecte clôturée en retard après émission d'une facture initiale

---

## 7. Numérotation et avoirs

### Format V1 — séries de numérotation

| Type | Format | Exemple |
|------|--------|---------|
| Facture ZD | `FZD-YYYY-NNNNN` | FZD-2026-00124 |
| Facture AG | `FAG-YYYY-NNNNN` | FAG-2026-00045 |
| Facture achat pack AG | `FPK-YYYY-NNNNN` | FPK-2026-00008 |
| Avoir (toutes typologies) | `AV-YYYY-NNNNN` | AV-2026-00012 |

**Séquences indépendantes** par série. Remise à zéro de `NNNNN` au 1er janvier de chaque année.

**Génération** : numéro attribué **uniquement à la validation** (statut `brouillon` → `en_attente_pennylane`). Pas de numéro en brouillon pour éviter les trous dans la séquence en cas d'annulation.

**Intégrité** : numérotation séquentielle stricte et non modifiable (exigence fiscale française — pas de saut de numéros autorisé). **Implémentation (figée F4 test-scenarios 2026-06-07)** : table `plateforme.sequences_facturation` (`serie`, `annee`, `dernier_numero`, UNIQUE(serie, annee) — voir [[04 - Data Model]]), attribution sous verrou ligne (`SELECT ... FOR UPDATE`) dans la transaction de validation + contrainte UNIQUE `numero_facture`. Un rejet Pennylane 4xx ne libère pas le numéro (cf. §2.2).

**Distinction ZD/AG d'un avoir** : tracée via `factures.avoir_de_facture_id` qui pointe la facture d'origine (la série `AV-` est unique mais le typage métier reste accessible).

### Avoir intégral V1

V1 supporte uniquement l'**avoir intégral** (annulation totale d'une facture).

- Déclenché par "Annuler la facture" depuis la fiche facture (si `statut = emise` **ou `payee`** — *décision F1 test-scenarios 2026-06-07, arbitrage Val : §05 §5 Avoirs fait foi, cas trop-perçu/remboursement couvert ; l'ex-règle « Annulation impossible si payee » est supprimée*)
- Création automatique d'une facture d'avoir avec montant total négatif (push Pennylane type `credit_note`)
- Numérotation `AV-YYYY-NNNNN`
- Envoi automatique à Pennylane (via le flux §2)
- La facture d'origine passe à `statut = annulee` (`date_paiement` conservée si elle était payée)
- Les collectes liées redeviennent non facturées au sens du prédicat Reco B (peuvent être re-rattachées à une nouvelle facture)

### Avoir partiel — V1.1

L'avoir partiel (annulation d'une ou plusieurs lignes d'une facture mensuelle groupée sans invalider la facture entière) est **reporté V1.1**.

V1 fallback : annuler la facture entière (avoir intégral) puis refacturer les bonnes collectes.

### Lien facture ↔ avoir
- `factures.avoir_de_facture_id` (FK self-ref) : si la facture est un avoir, référence la facture d'origine
- `factures.type` enum : `standard | avoir`

---

## 8. Suivi des factures émises

### Section "Factures émises" (Back-office)
Tableau filtrable sur toutes les factures émises :
- Par statut : `emise` / `payee` / `annulee` (le statut "en retard" est un calcul en lecture, pas un statut stocké — voir §10)
- Par organisation
- Par période
- Indicateur visuel "En retard" si `statut = emise` ET `date_echeance < now()` (calculé à l'affichage)

### Relances

**Pas de flux relance V1 côté Savr.** Les relances sont gérées **directement dans Pennylane** (décision 2026-04-28). L'Admin pilote les relances depuis l'interface Pennylane.

Aucun bouton "Envoyer une relance", aucun template `facture_relance`, aucun compteur de relances en base côté Savr.

---

## 9. Impact data model

Champs sur la table `factures` :

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `type` | enum | NOT NULL, défaut `standard` | `standard` \| `avoir` |
| `avoir_de_facture_id` | uuid | FK self-ref → factures | Si type `avoir`, réfère la facture d'origine |
| `pdf_url_pennylane` | text | | PDF Factur-X émis par Pennylane (source de vérité légale) |
| `pdf_url_savr` | text | | PDF copie de travail généré par Savr (affichage client) |
| `erreur_synchro` | text | | Message d'erreur Pennylane si échec synchro (4xx ou retry épuisé) |
| `erreur_synchro_at` | timestamptz | | Horodatage de la dernière erreur |
| `derniere_tentative_pennylane_at` | timestamptz | | Horodatage du dernier push Pennylane (utilisé pour calcul "il y a Xmin" sur le bandeau) |
| `marge_logistique` | decimal | | **Ajout F5 test-scenarios 2026-06-07 (ex-colonne fantôme)** — marge Savr au grain facture (`montant_ht − Σ cout_reparti_ht` des collectes liées), écrite par le trigger cross-schema `fn_recalc_marge_tournee`. **Jamais exposée aux clients** : rôles clients lisent la vue whitelist `v_factures_client` (sans `marge_logistique` ni `erreur_synchro*`), SELECT table direct = staff only (cf. §09) |

Champs **supprimés V1** vs spec antérieure : `derniere_relance_at`, `nb_relances`, `motif_modification_montant`.

**Lignes de facture (décision F3 test-scenarios 2026-06-07)** : `factures_collectes` est étendue en table des **lignes de facture** — `collecte_id` nullable + `CHECK (collecte_id IS NOT NULL OR designation IS NOT NULL)`, colonnes ajoutées `designation`, `quantite` (défaut 1), `taux_tva` (défaut 20.0). Les « lignes libres » du Bloc 3 (frais divers, remises ponctuelles) et la TVA par ligne (totaux Bloc 4) vivent dans cette table. Voir [[04 - Data Model]].

Enum `factures.statut` : `brouillon` | `en_attente_pennylane` | `emise` | `payee` | `annulee`. Le statut "en retard" est calculé en lecture (cf. §10), pas stocké.

---

## 10. Statut "en retard" — calculé, pas stocké

Le caractère "en retard" d'une facture est dérivé en lecture, pas matérialisé dans `factures.statut`. Aucune transition d'état, aucun cron, aucun trigger.

**Calcul** :
```sql
CASE 
  WHEN statut = 'emise' AND date_echeance < CURRENT_DATE THEN 'en_retard'
  ELSE statut::text
END
```

Implémentation V1 : vue SQL `v_factures_with_retard` ou colonne calculée à l'affichage côté front.

Bénéfice : aucune logique de transition, pas de fenêtre de désynchronisation, le retard est toujours juste.

---

## Décisions prises

| Décision | Alternative écartée | Raison |
|----------|-------------------|--------|
| Écran d'édition obligatoire avant validation | Validation en 1 clic depuis la liste | Le passage systématique par l'édition évite les erreurs et garantit la vérification Admin |
| Conformité Factur-X portée par Pennylane | Génération Factur-X côté Savr | Mutualisation de la conformité réglementaire. Dépendance critique assumée |
| PDF Savr = copie de travail, pas la facture légale | PDF Savr = facture légale | Évite le double statut juridique. La source de vérité est Pennylane |
| Numérotation FZD / FAG / FPK + série avoir unique `AV-` | Séries `AZD-`/`AAG-` distinctes | Réduction du nombre de séquences sans perte d'information (avoir_de_facture_id porte l'origine) |
| Numéro attribué à la validation uniquement | Numéro en brouillon | Évite les trous dans la séquence fiscale (obligation légale) |
| Avoir intégral seul V1 (avoir partiel V1.1) | Avoir partiel V1 | Cas d'usage <1×/mois — fallback "avoir intégral + refacturation" acceptable |
| Groupement mensuel = config par organisation | Groupement auto tous clients | Respect des préférences client |
| Sélection manuelle multi-collectes | Groupement 100% auto | L'Admin peut regrouper ponctuellement sans modifier la config |
| Relances déléguées à Pennylane | Relances pilotées côté Savr | Décision 2026-04-28 — Pennylane gère nativement la relance |
| Statut "en retard" calculé, pas stocké | Transition d'état + cron | Pas de logique applicative distincte = pas de stockage. Toujours juste. |
| Retry Pennylane unifié 3 phases (5 min/1h/24h) | 5 phases ou retry exponentiel court | Une seule policy claire, suffisante pour la fréquence d'échec attendue |
| Pas de flag fallback Pennylane + pas de batch rattrapage | Bascule UI flagged + Edge Function rattrapage | Fréquence attendue <1×/an — édition manuelle dans Pennylane sans automatisation V1 |

---

## Questions ouvertes

- **Champs exacts API Pennylane v2** : valider avec la doc Pennylane (https://pennylane.readme.io) que tous les champs Factur-X sont bien couverts — à vérifier au moment du build.

**Clôturé** : V1.1. (2026-04-28)
**Clôturé** : format comptabilité classique. (2026-04-28)
**Clôturé** : V1.1, relance unique J+30. Géré directement dans Pennylane, pas via la plateforme Savr. (2026-04-28)
**Clôturé** : reporté V1.1 (2026-05-08, revue de sobriété).
**Clôturé** : retiré du CDC, pas une décision V1 (2026-05-08, revue de sobriété).

---

## Liens

- [[05 - Règles métier]] — §4 Facturation
- [[04 - Data Model]] — `factures`, `factures_collectes`, `tarifs_zero_dechet`, `packs_antgaspi`
- [[08 - APIs et intégrations]] — Pennylane v2
- [[05 - Règles métier#3. Packs Anti-Gaspi — Décrémentation et blocage]] (règles packs AG) + [[06 - Back-office Admin Savr]] §8 onglet Packs AG (UI)
- [[15 - Sécurité et conformité]] — dépendance critique Pennylane
- [[06 - Back-office Admin Savr]] — §4 Facturation
