# M08 — Facturation prestataires

**Persona principal** : Ops Savr (upload province + contestation + validation + règlement + export Pennylane) + Admin TMS (validation + déverrouillage factures)
**Dépend de** : [[M07 - Pilotage financier logistique]] (coût TMS = référence rapprochement), [[M06 - Référentiel prestataires]] (prestataire + contact facturation), [[M03 - Portail prestataire self-service]] (W10 upload manager), [[M04 - Gestion des tournées]] (périmètre tournées facturées)
**Bloque** : export comptable mensuel Pennylane + pilotage trésorerie logistique

---

## Changelog revue de sobriété 2026-04-30

**Bloc A — Suppressions V1**
- A1 : E5 Dashboard 13 widgets → 5 widgets (W1-W5 facturation uniquement, suppression W6-W13 prestataires/écarts/DSO).
- A2 : W12 cron mensuel rapport PDF + N14 + paramètre `m08.pennylane_export_mensuel_cron_jour` supprimés (Val/Louis exportent CSV à la demande).
- A3 : Bulk validation E1 + W4 supprimée (validation unitaire suffit pour ~5-10 factures/jour pic).
- A4 : E4 standalone supprimé, route `/tms/facturation/prestataires/:id` redirige vers M06 E5#factures.
- A5 : Notifications N5 (upload Ops → prestataire), N9 emails Ops/Admin co-trigger, N12 (rectification Ops/Admin) supprimées.
- A6 : Brouillon localStorage E3 supprimé.

**Bloc B — Simplifications V1**
- B1 : Rapprochement ligne-à-ligne supprimé V1, rapprochement global seul (zéro tolérance préservée). **Re-affiné revue sobriété §04 2026-04-30 A5** : la table `factures_prestataires_lignes` est **entièrement supprimée V1** (l'audit visuel est couvert par `factures_prestataires.pdf_url` + `pdf_extraction_json`). Plus de RLS dédiée, plus de trigger cohérence `SUM`, plus d'audit_logs surveillance.
- B2 : Table dédiée `exports_pennylane_log` supprimée → trace via `tms.audit_logs` action `M08_EXPORT_PENNYLANE` (+ compensation `M08_EXPORT_PENNYLANE_ANNULEE`). CSV archivé R2 conservé.
- B3 : Enum + colonne `mode_reglement` supprimés (V1 = virement par défaut, détail dans `commentaire_reglement` libre).
- B4 : Enum `source_upload` 3 → 2 valeurs (suppression `ops_rectification`, info portée par `facture_corrigee_id IS NOT NULL`).
- B5 : Cron W11 J+5 + J+15 fusionné en mécanique unique (J+5 email manager + alerte M11 warning ; J+15 = upgrade criticité même alerte vers `critical`, pas de nouvel email auto). Paramètre `m08.escalade_absence_jour_mois` retiré.
- B6 : Notification N5 supprimée (couvert par A5).

**Bloc C — Fusions**
- C1 : E4 fusionné dans onglet M06 E5 (couvert par A4).
- C2 : Notification N12 fusionnée dans N4 (template conditionnel si `facture_corrigee_id IS NOT NULL`).
- C3 : Notification N9 simplifiée (email Admin retiré, conservé prestataire + Ops/Admin in-app + alerte M11 critique).

**Bloc D — Enums**
- D1 : Enum `statut_rapprochement` 9 → 8 valeurs (fusion `rejetee_pour_correction` dans `conteste` + flag `conteste_apres_validation` boolean).
- D2/D3 : couverts par B4 / B3.
- D4 : **Réajusté revue sobriété §04 2026-04-30 D3** : passage en `text` libre (CHECK constraint enum retiré), aucun comportement applicatif distinct. UI E6 garde dropdown préremplie + saisie libre.

---

## 1. Objectif métier

Centraliser la réception des factures prestataires, automatiser le rapprochement avec les coûts calculés M07, déclencher le verrouillage des tournées facturées et transmettre les factures validées à Pennylane (V1 manuel, V2 API).

**Frontière claire** :
- **M07 calcule** : coût TMS théorique par tournée (source de vérité interne).
- **M08 reçoit et rapproche** : facture prestataire uploadée (PDF + montants saisis/OCR) vs coût M07 agrégé sur période.
- **M08 paie** (déclenche le paiement) : au sens où la facture validée est exportée vers Pennylane qui pilote le virement. La saisie `regle_at` dans TMS V1 est déclarative (Val/Louis notent après virement).
- **Pennylane** : pièce comptable, rapprochement bancaire, virement.
- **M08 ne calcule pas de coût** (lecture seule `cout_final_ht` depuis M07).
- **M08 ne facture pas le client** (c'est la Plateforme via Pennylane).

**Fréquence d'usage** :
- Upload factures : ~30 factures/mois V1 (~30 prestataires × 1 facture/mois), pic concentré du 1 au 15 du mois.
- Rapprochement auto : synchrone à l'upload (< 2s p95).
- Validation Ops : quotidien du 1 au 20 du mois, ~5-10 factures/jour en pic.
- Contestation : ~10% des factures (écart calcul, erreur saisie prestataire) estimé.
- Règlement : saisie hebdo Val/Louis après virements bancaires.
- Export Pennylane : mensuel (clôture compta jour 5 du mois suivant).

**Économie cible V1** : ~30 min/prestataire/mois économisées (rapprochement auto). Sur 30 prestataires = 15h/mois récupérées + fin du dépôt email + traçabilité audit 5 ans.

---

## 2. Personas et contexte d'usage

### 2.1 Ops Savr (2-3 personnes)

- **Contexte** : bureau, desktop, double écran. Sessions dédiées facturation du 1 au 15 du mois (~1-2h/jour).
- **Besoins** :
  - Consulter inbox factures du mois (à traiter / en écart / validées / en contestation).
  - Uploader factures prestataires province (reçues par email).
  - Valider factures en match exact (en mode bulk si possible).
  - Contester factures en écart (émission avoir demandée au prestataire).
  - Enregistrer règlement après virement bancaire.
  - Préparer export mensuel Pennylane (liste factures validées).
- **Contraintes** : zéro tolérance sur écart = workflow strict, pas d'erreur silencieuse. Actions tracées audit_log 5 ans (Registre transport + obligations compta).
- **Fréquence** : quotidien pic 1-15 du mois, hebdo hors pic.

### 2.2 Admin TMS (Val, backup Louis)

- **Contexte** : bureau, desktop. Sessions courtes et ciblées (validation exceptionnelle, déverrouillage).
- **Besoins** :
  - Valider factures (équivalent Ops, pouvoir étendu).
  - Déverrouiller une facture déjà validée (rejet a posteriori, correction erreur Ops, découverte d'un bug de calcul).
  - Consulter dashboard pilotage trésorerie (DSO prestataires, montants en litige).
  - Exporter CSV Pennylane mensuel.
- **Contraintes** : rejet facture validée = workflow strict (motif obligatoire ≥ 30 car, audit log append-only, notification prestataire + Ops).
- **Fréquence** : 2-5 actions/mois typiques.

### 2.3 Manager prestataire (M03 E10)

- **Contexte** : bureau prestataire, upload mensuel.
- **Besoins** :
  - Uploader facture mensuelle (PDF + saisie montants si OCR rate).
  - Consulter statut rapprochement (en attente / validée / en litige / réglée).
  - Uploader facture rectificative si avoir demandé (nouveau numéro, nouveau PDF).
- **Contraintes** : ne peut pas valider ni déverrouiller. Voit uniquement ses propres factures (RLS `prestataire_id = current_user_prestataire_id()`).
- **Fréquence** : mensuelle (1 upload/mois, peut être suivi d'1 rectificatif si contestation).

### 2.4 Système (automatismes)

- **Trigger** : rapprochement auto à l'INSERT `factures_prestataires` (synchrone).
- **Supprimé revue sobriété §05 2026-05-01 A1** — supervision via widget E0 "Factures attendues mois en cours" (relance Ops manuelle).
- **Supprimé revue sobriété 2026-04-30 A2** — export à la demande via E5/E1.
- **Trigger DB** : propagation `cout_final_verrouille = true` sur `tournees` à la validation facture + reset `false` au déverrouillage.

---

## 3. Architecture des écrans

| # | Écran | Route | Persona | RLS |
|---|-------|-------|---------|-----|
| E0 | Widget "Factures attendues mois en cours" (zone Inbox E1) | `/tms/facturation/inbox#attendues` | Ops Savr + Admin TMS | staff_read |
| E1 | Inbox factures | `/tms/facturation/inbox` | Ops Savr + Admin TMS | staff_read |
| E2 | Détail facture | `/tms/facturation/:id` | Ops Savr + Admin TMS | staff_read + facturation_write |
| E3 | Upload facture Ops (province + manuel) | `/tms/facturation/upload` | Ops Savr + Admin TMS | facturation_write |
| E5 | Dashboard trésorerie | `/tms/facturation/dashboard` | Admin TMS (principal), Ops Savr (lecture) | staff_read |
| E6 | Contestation facture (modale) | `/tms/facturation/:id#contester` | Ops Savr + Admin TMS | facturation_write |
| E7 | Saisie règlement (modale) | `/tms/facturation/:id#regler` | Ops Savr + Admin TMS | facturation_write |
| E8 | Déverrouillage facture (modale) | `/tms/facturation/:id#deverrouiller` | Admin TMS uniquement | admin_tms only |
| E9 | Export Pennylane | `/tms/facturation/export-pennylane` | Ops Savr + Admin TMS | staff_read |

Note : E10 (M03 manager) existe déjà dans M03 W10, pas redéfini ici.

---

### E0 — Widget "Factures attendues mois en cours" (revue sobriété §05 2026-05-01 A1)

**Objectif** : remplacer le cron de rappel J+5/J+15 supprimé. Donner à Ops une vue immédiate des prestataires sans facture pour la période en cours, sans alerte M11 ni email automatique.

**Emplacement** : panneau supérieur de l'inbox E1 (`/tms/facturation/inbox#attendues`), repliable, ouvert par défaut entre le 1er et le 20 du mois, replié les autres jours.

**Layout** :
- Titre : "Factures attendues — `<mois M-1>`"
- Liste : 1 ligne par prestataire `actif` n'ayant pas de `factures_prestataires` rattachée à `periode_facturee = M-1`.
- Colonnes : prestataire (nom + lien M06 fiche), nb tournées clôturées sur la période, montant TMS calculé HT (somme `tournees.cout_final_ht`), badge statut, dernière relance manuelle (date saisie via bouton "Relance notée").
- Badge statut :
  - Jusqu'au 10 du mois suivant la période → badge `attente` (gris)
  - À partir du 10 → badge `retard` (rouge)
- Bouton ligne : "Relance notée" (UPSERT `tms.relances_facture_log` — table légère append-only `prestataire_id`, `periode`, `relance_at`, `relance_par_user_id`, `commentaire?`). Aucune notification automatique.

**Règles métier** :
- Filtre prestataires : `statut = 'actif'` ET `integration_externe IS NULL OR != 'everest'` (les A Toutes! sont facturés via Everest, pas via le portail prestataire — cf. M14).
- Pas de cron, pas d'INSERT alerte M11, pas d'email auto.
- Suppression auto de la ligne dès qu'une facture est uploadée pour la période.

**Permissions** : `staff_read` (Ops Savr + Admin TMS). Manager prestataire ne voit pas ce widget (M03 affiche déjà sa propre attente d'upload côté E10).

---

### E1 — Inbox factures

**Objectif** : file de travail Ops Savr — toutes les factures à traiter classées par statut et priorité.

**Layout** :

**Filtres** (persistés en session) :
- Statut (multi-select) : `en_attente`, `ecart_detecte`, `rapprochement_manuel_requis`, `conteste`, `valide`, `regle`, `remplacee_par_avoir` (revue sobriété 2026-04-30 D1 : `rejetee_pour_correction` fusionné dans `conteste` + flag `conteste_apres_validation` ; **revue sobriété §05 2026-05-01 D1 : `rapproche_ok` fusionné dans `valide` direct, auto-validation match exact zéro tolérance**).
- Sous-filtre `conteste` : option « Contestation post-validation » (filtre `conteste_apres_validation = true`) pour Ops qui veulent isoler les rejets W9 Admin.
- Prestataire (multi-select, recherche)
- Période facturée (mois / plage dates)
- Date upload (plage dates)
- Reset filtres (bouton)

**Widgets KPI haut de page** (cliquables → filtre E1) :
- W1 : Nb factures en écart (rouge si > 0)
- W2 : Nb factures en attente de validation (orange)
- W3 : Nb factures en contestation (gris)
- W4 : Nb factures validées non réglées (bleu)
- W5 : Total HT en attente de règlement (montant agrégé)

**Tableau principal** :
- Colonnes : Prestataire, Numéro, Date facture, Période (debut-fin), Montant HT, Écart € (highlight rouge si non zéro), Statut, Date upload, Uploadé par, Actions
- Tri par défaut : `date_upload DESC`
- Highlight `ecart_detecte` : ligne rouge clair
- Highlight `valide non réglée` : ligne bleu clair
- Actions par ligne : `Voir détail` (→ E2), → **supprimée revue sobriété §05 2026-05-01 D1** (validation auto match exact, plus d'étape Ops requise), `Contester` (→ E6 si `ecart_detecte`, `rapprochement_manuel_requis` ou `valide` — **arbitrage Val 2026-06-06 : Ops peut contester une facture `valide`, ce qui déverrouille les tournées rapprochées; `regle` reste W9 Admin only**), `Régler` (→ E7 si `valide`)

**Actions** :
- `Exporter sélection CSV` (sélection multi-lignes possible pour export uniquement)
- **Supprimé revue sobriété 2026-04-30 A3** — validation unitaire suffit pour ~5-10 factures/jour pic, pas de gain temps significatif.

**Empty state** :
- Si aucune facture ce mois : "Aucune facture reçue. Les prestataires ont jusqu'au 15 pour uploader."

**Source de données** : vue `v_m08_inbox` — join `factures_prestataires + shared.prestataires + users_tms` (uploadé par).

---

### E2 — Détail facture

**Objectif** : vue complète d'une facture, permet toutes les actions de traitement.

**Layout (3 zones)** :

**Zone 1 — Header facture**
- Prestataire (lien M06 E5)
- Numéro facture + Date facture
- Période facturée
- Uploadé le ... par ... (chauffeur/manager/ops)
- Statut rapprochement (badge)
- Actions principales (selon statut + rôle, refondu revue sobriété §05 2026-05-01 D1) :
 - → **supprimée V1** (validation auto match exact, plus d'étape Ops requise)
  - `Valider avec motif` (Ops + Admin si statut = `ecart_detecte` — motif ≥ 30 car, alerte Admin si écart > 100€, cf. W5)
  - `Contester` (Ops + Admin si statut = `ecart_detecte`, `rapprochement_manuel_requis` ou `valide`) — **arbitrage Val 2026-06-06** : si statut = `valide`, la contestation déverrouille les tournées rapprochées (`cout_final_verrouille = false`) + `conteste_apres_validation = true`. Pas disponible sur `regle` (immuable R_M08.6 → W9 Admin only).
  - `Régler` (Ops + Admin si statut = `valide`)
  - `Déverrouiller` (Admin TMS uniquement si statut = `valide` ou `regle`)

**Zone 2 — Rapprochement**
- Montant facture HT (prestataire) : `XXX,XX €` (éditable par Ops avant validation si OCR inexact)
- Montant HT calculé TMS : `XXX,XX €` (lecture seule, agrégat `tournees.cout_final_ht`)
- **Écart HT** : `XX,XX €` (rouge si ≠ 0)
- **Statut** : badge vert "Match exact" si écart = 0, badge rouge "Écart détecté" sinon
- Rappel règle zéro tolérance : "Une facture est validée uniquement si le montant HT correspond exactement au calcul TMS. En cas d'écart, une contestation est requise (avoir + nouvelle facture)."

**Zone 3 — Détail PDF + OCR** (revue sobriété §04 2026-04-30 A5 — table `factures_prestataires_lignes` supprimée V1)
- **Affichage du PDF intégré** (iframe ou viewer) à gauche : `factures_prestataires.pdf_url` (PDF source prestataire).
- **Bloc OCR à droite** : si `pdf_extraction_json.lignes` non vide → tableau **lecture seule** des lignes extraites par Mistral (Tournée, Libellé, Quantité, PU HT, Total HT). Si vide ou OCR partiel : message "OCR partiel ou indisponible — référez-vous au PDF source".
- **Pas de lien direct par ligne vers la tournée M07** V1 (la table `factures_prestataires_lignes` n'existe plus). Ops navigue via filtres M07 E3 si besoin de croiser.
- **Motivation** : pratique comptable FR opère au niveau facture (l'avoir annule la facture entière, pas une ligne). Zéro tolérance R_M08.1 préservée au niveau global. Le PDF source + l'OCR JSON couvrent l'audit visuel sans table dédiée. Réintroduction V1.1 si rapprochement ligne-à-ligne devient nécessaire.

**Zone 4 — Tournées couvertes (sans lignes)**
- Si pas de lignes détaillées, afficher la liste des tournées TMS agrégées dans `cout_final_ht` :
  - Tableau : Date, Tournée ID (lien M04), Événement, Prestataire matched, Coût calculé HT, Statut ajustement M07
  - Utile à Ops pour comprendre d'où vient le montant TMS.

**Zone 5 — Métadonnées** (revue sobriété M08 2026-06-05 C1 — viewer PDF dédupliqué, désormais unique en Zone 3)
- Bouton `Télécharger PDF` (le viewer intégré iframe Storage signé 1h est en Zone 3, pas redécrit ici).
- Bloc métadonnées : OCR score de confiance, champs auto-extraits vs saisis Ops, `uploade_par`, timestamps.

**Zone 6 — Historique statuts (timeline)**
- Timeline verticale : upload → rapprochement auto → actions Ops successives → règlement
- Chaque entrée : timestamp, acteur, action, commentaire
- Source : `audit_logs WHERE table_name = 'factures_prestataires' AND row_id = :id`

**Zone 7 — Commentaire Ops** (si existant)
- Zone libre commentaires Ops/Admin (éditable tant que pas `regle`).

---

### E3 — Upload facture Ops (province + manuel)

**Objectif** : écran Ops pour upload factures reçues par email (prestataires province sans portail M03 ou manager défaillant).

**Layout** :

**Étape 1 — Sélection prestataire**
- Sélecteur prestataire (dropdown recherche, source `shared.prestataires` actifs).
- Si prestataire a un portail M03 actif : warning "Ce prestataire dispose d'un portail self-service. Préférer un upload direct par le manager. Continuer ?"

**Étape 2 — Upload PDF**
- Dropzone PDF (max 10 Mo).
- OCR Mistral déclenché dès upload (progress bar).

**Étape 3 — Pré-remplissage OCR**
- Formulaire pré-rempli avec champs OCR extraits :
  - Numéro facture (required)
  - Date facture (required)
  - Période début (required) / Période fin (required)
  - Montant HT prestataire (required)
  - Montant TVA (default 0)
  - Montant TTC prestataire (required, vérif `montant_ht + montant_tva = montant_ttc` ± 0,01€)
  - Lignes détaillées (optionnel, table éditable si OCR a extrait des lignes, Ops peut ajouter/supprimer)
- Score confiance OCR affiché par champ (badge vert > 85%, orange 60-85%, rouge < 60%).
- Tous les champs required doivent être renseignés avant submit (blocage upload).

**Étape 4 — Validation client**
- Vérif périodes : `periode_debut ≤ periode_fin` et `periode_debut ≥ date_facture - 3 mois` et `periode_fin ≤ date_facture`.
- Vérif numéro facture non dupliqué pour ce prestataire (query live `factures_prestataires` + `deleted_at IS NULL`).
- Si rectification d'une facture existante : option `Cette facture rectifie une précédente` → sélecteur facture à rectifier (filtré `rejetee_pour_correction OU conteste`).

**Étape 5 — Submit**
- Bouton `Enregistrer la facture`.
- Déclenche W2 (upload Ops → rapprochement auto).

**États possibles** :
- **Supprimé revue sobriété 2026-04-30 A6** — pas de brouillon V1, upload en une session. Si interruption Ops, re-upload depuis zéro (durée < 2 min).
- Si `conteste` sélectionné existant : override `facture_corrigee_id` + reset statut facture d'origine.

---

### E4 — Historique facturation prestataire **Supprimé revue sobriété 2026-04-30 A4 / C1**

E4 standalone fusionné dans **onglet « Factures » de M06 E5** (fiche prestataire). Route `/tms/facturation/prestataires/:id` → redirection 301 vers `/tms/prestataires/:id#factures`.

**Onglet M06 E5#factures (enrichi par fusion E4)** :
- Header : nom prestataire, statut contrat, contact facturation, IBAN (si renseigné).
- KPI fusionnés (4 widgets) : total CA HT 12 mois, nb factures validées, nb en litige, DSO moyen (jours entre validation et règlement — convention DSO §15 Q5 M08).
- Tableau factures (colonnes identiques E1, pas de filtre statut — tout affiché).
- Tri date facture DESC.
- Export CSV périmètre prestataire.
- Bouton `+ Ajouter facture manuellement` (→ E3 préremplit prestataire).

**Source** : `factures_prestataires WHERE prestataire_id = :id ORDER BY date_facture DESC`.

**Motivation** : suppression écran doublon (deux entry points sur même donnée → divergence comportementale + maintenance double).

---

### E5 — Dashboard trésorerie (simplifié revue sobriété 2026-04-30 A1)

**Objectif** : pilotage mensuel Val + Louis. KPIs essentiels santé financière logistique.

**Layout (grid 5 widgets V1)** :

**Bloc Factures**
- W1 : Nb factures reçues ce mois (+ delta vs M-1)
- W2 : Nb factures validées ce mois
- W3 : Nb factures en contestation
- W4 : Nb factures validées non réglées
- W5 : Total HT validé non réglé (€)

 : nb prestataires uploadé M-1, retard upload, top 5 CA → exports CSV à la demande, pas de widget.
 : factures rejetées 12 mois, taux écart par prestataire, tendance écarts → exports CSV à la demande.
 : DSO moyen + factures en retard règlement → onglet M06 E5#factures porte le DSO par prestataire (cf. A4/C1); export CSV global à la demande.

**Actions** :
- `Exporter dashboard CSV` (factures du mois + agrégats W1-W5).
- **Supprimé V1 A1** — V1 = CSV uniquement.
- Clic widgets → filtre E1 contextualisé.

**Source** : vue `v_m08_dashboard` (agrégats sur `factures_prestataires` du mois courant + cumul HT non réglé).

**Motivation** : 30 factures/mois sur 30 prestataires ne justifient pas un dashboard analytique 13 widgets (graphique tendance, top 5 CA, taux écart par prestataire). Pour ces analyses ad hoc, Val/Louis exportent CSV E1 et travaillent dans Excel/Sheets.

---

### E6 — Contestation facture (modale)

**Objectif** : Ops conteste une facture (écart détecté ou rapprochée OK mais Ops repère erreur manuelle).

**Layout** :
- Header : rappel facture (numéro, prestataire, montants)
- Champ `motif_contestation` (textarea, required, min 30 car)
- Sélecteur `type_contestation` (required) — **dropdown préremplie + saisie libre possible** (revue sobriété §04 2026-04-30 D3 — colonne `text` sans CHECK constraint enum, aucun comportement applicatif distinct par valeur, sert au reporting/filtrage Ops) :
  - `ecart_montant` (montants divergent calcul TMS)
  - `erreur_periode` (période facturée incorrecte)
  - `erreur_prestataire` (tournée sur la facture non effectuée par ce prestataire)
  - `erreur_doublon` (tournée facturée deux fois)
  - `autre`
  - **Saisie libre** : Ops peut typer une catégorie ad-hoc si aucune ne correspond.
- Lignes à contester (si détail dispo) : checkbox multi-select lignes en écart
- Option `Demander facture rectificative` (cochée par défaut) : envoi email prestataire avec motif.
- Bouton `Valider la contestation`.

**Effet** :
- INSERT dans `audit_logs` (acteur, motif, type).
- UPDATE `factures_prestataires.statut_rapprochement = 'conteste'`, `motif_contestation`, `conteste_par_user_id`, `conteste_at`.
- **Flag `conteste_apres_validation`** (arbitrage Val 2026-06-06) : `true` si la facture était `valide` avant contestation, `false` si elle était `ecart_detecte` / `rapprochement_manuel_requis` (jamais validée). Le flag signifie désormais « la facture avait-elle été validée avant d'être contestée », indépendamment de l'acteur (W6 Ops ou W9 Admin).
- **Tournées rattachées (arbitrage Val 2026-06-06)** :
  - Si contestation depuis `ecart_detecte` / `rapprochement_manuel_requis` : `cout_final_verrouille` **non modifié** (reste `false`, tournées jamais verrouillées).
  - Si contestation depuis `valide` : déclenche `tms.m08_deverrouiller_tournees` → `cout_final_verrouille = false`, `verrouillee_par_facture_id = NULL` sur les tournées rapprochées (Ops peut donc déverrouiller via contestation ; chemin distinct du W9 Admin qui garde les actions étendues `reouverte_pour_validation` + traitement `regle`).
- Si option `Demander facture rectificative` : email auto au contact facturation prestataire (template M13 `notif_contestation_prestataire`) avec CTA "Émettre un avoir + nouvelle facture dans votre portail" ou "Répondre par email".
- Notification Ops + Admin.

---

### E7 — Saisie règlement (modale)

**Objectif** : Ops/Admin enregistre le règlement effectif d'une facture validée (virement effectué via Pennylane).

**Layout** (simplifié revue sobriété 2026-04-30 B3) :
- Header : rappel facture.
- Champ `date_reglement` (date picker, default = aujourd'hui, required).
- **Supprimé V1 B3** — V1 = virement par défaut (99% cas), modalité atypique tracée dans `commentaire_reglement` libre.
- Champ `reference_reglement` (text, optionnel — ex : référence virement bancaire).
- Champ `commentaire_reglement` (textarea, optionnel — utilisé pour modalité non-virement si besoin).
- Bouton `Enregistrer le règlement`.

**Effet** :
- UPDATE `factures_prestataires.statut_rapprochement = 'regle'`, `regle_at`, `reference_reglement`, `commentaire_reglement`. Acteur tracé via `audit_logs.acteur_user_id` (revue sobriété §04 2026-04-30 B1 — colonne `regle_par_user_id` retirée V1).
- Notification prestataire (email template `notif_facture_reglee`).
- Audit log.

**Règle** : bouton `Régler` disponible uniquement si `statut_rapprochement = 'valide'`. Pas de passage direct `en_attente → regle`.

---

### E8 — Déverrouillage facture (modale) — Admin TMS uniquement

**Objectif** : Admin TMS rejette une facture déjà validée (ou réglée) pour correction. Déclenche déverrouillage `cout_final_verrouille = false` sur les tournées concernées.

**Layout** (simplifié revue sobriété 2026-04-30 D1) :
- Header : alerte rouge "Action critique — Rejeter une facture déjà validée déverrouille les tournées et efface le rapprochement."
- Rappel facture + statut actuel.
- Champ `motif_deverrouillage` (textarea, required, min 30 car).
- Sélecteur `action_post_deverrouillage` :
  - `rejetee_pour_correction` : facture passe à statut `conteste` + flag `conteste_apres_validation=true` (fusion D1, ex-statut dédié supprimé), prestataire doit uploader une rectificative via avoir.
  - `reouverte_pour_validation` : facture remise à statut `en_attente`, nouveau rapprochement déclenché (ex : recalcul M07 intervenu).
- Checkbox confirmation : "Je comprends que cette action est tracée et notifie le prestataire."
- Bouton `Déverrouiller` (désactivé si checkbox non cochée).

**Effet** :
- UPDATE `factures_prestataires` selon `action_post_deverrouillage` (cf. W9 step 4).
- UPDATE `tournees SET cout_final_verrouille = false, verrouillee_par_facture_id = NULL` pour toutes les tournées rattachées (périmètre = agrégat période — revue sobriété 2026-04-30 B1).
- INSERT append-only dans `audit_logs` action `M08_DEVERROUILLAGE_ADMIN` (niveau critique).
- Notification prestataire (email N9) + Ops alerte M11 critique (email retiré C3) + Admin in-app (email retiré C3).
- Warning M11 « facture déverrouillée » en rouge (catégorie `alerte_facturation`).

**Contrainte** : si la facture déverrouillée a déjà généré une ligne d'export Pennylane, INSERT entrée compensatoire dans `tms.audit_logs` action `M08_EXPORT_PENNYLANE_ANNULEE` payload `{facture_id, motif_deverrouillage}` (simplifié revue sobriété 2026-04-30 B2). V1 manuel : Ops doit alerter expert-compta séparément.

---

### E9 — Export Pennylane

**Objectif** : préparer l'export mensuel des factures validées vers Pennylane (V1 manuel CSV, V2 API).

**Layout** :

**Section 1 — Factures à exporter**
- Tableau factures `statut_rapprochement IN ('valide', 'regle')` ET `exporte_pennylane_at IS NULL` ET **`migration_test = false`** (filtre automatique propagation §13 2026-04-27 — exclusion factures émises pendant `migration_mode_active = true`).
- Colonnes : Prestataire, Numéro, Date facture, Période, Montant HT, Montant TVA, Montant TTC, PDF link.
- Filtre période (default : mois en cours).
- Checkbox multi-select.

**⚠ Filtre `migration_test` (propagation §13 2026-04-27)** : les factures créées pendant la fenêtre migration MTS-1 (J0 → J+30) sont automatiquement marquées `migration_test = true` (cf. §04 addendum §13). Elles sont exclues du flux Pennylane par filtre SQL strict — aucune action manuelle requise. Les factures restent visibles ailleurs dans M08 (E1-E8) avec badge `Test migration` (UI). Cf. R_§13.2.

**Section 2 — Actions**
- Bouton `Exporter CSV` — génère CSV conforme import Pennylane (format à définir avec expert-compta, template M13 `pennylane_csv_colonnes`).
- Bouton `Marquer comme exportées` (après upload manuel dans Pennylane par Ops) — UPDATE `exporte_pennylane_at = now()`, INSERT `tms.audit_logs` action `M08_EXPORT_PENNYLANE` payload `{periode_export, facture_ids, total_ht, total_tva, total_ttc, csv_url}` (simplifié revue sobriété 2026-04-30 B2 — table dédiée `exports_pennylane_log` supprimée). Acteur tracé via `audit_logs.acteur_user_id` (revue sobriété §04 2026-04-30 B1 — colonne `exporte_par_user_id` retirée V1).
- Les deux actions peuvent être découplées (Ops exporte CSV, vérifie import Pennylane, puis revient marquer).

**Section 3 — Historique exports** (simplifié revue sobriété 2026-04-30 B2)
- Tableau alimenté par vue SQL `v_m08_exports_pennylane` (lecture sur `tms.audit_logs WHERE action IN ('M08_EXPORT_PENNYLANE', 'M08_EXPORT_PENNYLANE_ANNULEE') ORDER BY created_at DESC`) : date export, nb factures, montant total, acteur, statut (exporté / annulée).
- Lien téléchargement CSV archivé (R2 Storage 5 ans, URL stockée dans `audit_logs.payload->>'csv_url'`).

**V2 (roadmap)** : bouton `Pousser vers Pennylane` (API) remplace les deux boutons précédents. Workflow inchangé mais asynchrone.

---

## 4. Workflows

### W1 — Upload facture par manager prestataire (via M03 W10)

Détail complet côté M03 W10. Rappel ici :

1. Manager → M03 E10 → clic `Uploader la facture`.
2. Upload PDF (max 10 Mo) + saisie montants (OCR préremplit).
3. Validation client-side : champs required OK, numéro non dupliqué.
4. POST `/api/m03/factures` → INSERT `factures_prestataires` statut `en_attente`.
5. **Trigger W3 rapprochement auto synchrone**.
6. Réponse au manager avec statut final (`valide` si match exact zéro tolérance — revue sobriété §05 2026-05-01 D1, ou `ecart_detecte`, ou `rapprochement_manuel_requis`).
7. Notification Ops + Admin (email template `notif_facture_uploadee_ops`).
8. Si `ecart_detecte` : notification manager "Votre facture présente un écart avec notre calcul, nos équipes vont revenir vers vous rapidement."

---

### W2 — Upload facture par Ops Savr (E3)

Province ou manager défaillant :

1. Ops → E3 → sélection prestataire.
2. Upload PDF → OCR Mistral synchrone (< 30s timeout).
3. Pré-remplissage formulaire.
4. Ops corrige/complète champs required (blocage submit si incomplet).
5. Check : numéro facture non dupliqué (si dupliqué, message "Ce numéro existe déjà pour ce prestataire : facture `:id_existing`. Cliquez ici pour l'ouvrir").
6. Submit → INSERT `factures_prestataires` (`uploade_par_user_id = ops_user_id`, `source_upload = 'ops_manuel'`).
7. **Trigger W3 rapprochement auto synchrone**.
8. Redirection E2 détail.
9. Notification prestataire (email template `notif_facture_uploadee_prestataire`) avec accès M03 portail pour consultation.

---

### W3 — Rapprochement auto (synchrone post-INSERT)

Déclenché par trigger DB `trg_m08_rapprocher` AFTER INSERT sur `factures_prestataires` :

1. Calcul `montant_ht_calcule_tms` :
   ```sql
   SELECT COALESCE(SUM(cout_final_ht), 0)
   FROM tms.tournees
   WHERE prestataire_id = NEW.prestataire_id
     AND date_planifiee BETWEEN NEW.periode_debut AND NEW.periode_fin
     AND statut = 'terminee'
     AND cout_final_verrouille = false
   ```
2. Check cas A Toutes! ou autre : si au moins une tournée dans la période a `cout_final_ht IS NULL` (grille absente) → statut `rapprochement_manuel_requis`, alerte Ops "Tournée(s) sans coût calculé, vérification manuelle requise" (N2).
3. UPDATE `factures_prestataires.montant_ht_calcule_tms`.
4. **Logique zéro tolérance** (D4 + revue sobriété §05 2026-05-01 D1) :
   - Si `montant_ht_prestataire = montant_ht_calcule_tms` (match exact centime) :
     - `statut_rapprochement = 'valide'` **directement (auto-validation, refondu D1 2026-05-01)**
     - Trigger M07 verrouillage tournées (`cout_final_verrouille = true`, cf. W4 step 4)
     - INSERT audit_log `action='M08_FACTURE_AUTO_VALIDEE'` acteur=trigger système
     - Notification Ops + Admin (N1 informative) : "Facture prestataire :numero validée automatiquement (match exact zéro tolérance)"
     - Notification prestataire (email `notif_facture_validee` — cohérent W4 manuel)
   - Sinon :
     - `statut_rapprochement = 'ecart_detecte'`
     - `ecart_ht` calculé (generated column)
     - Notification Ops + Admin : "Écart détecté sur facture prestataire, contestation requise" (N3).
5. **Supprimé V1 revue sobriété 2026-04-30 B1 + table supprimée 2026-04-30 A5** — rapprochement global uniquement. Plus de table `factures_prestataires_lignes` (revue sobriété §04 2026-04-30 A5). L'audit visuel des lignes est couvert par `factures_prestataires.pdf_url` (PDF source) + `pdf_extraction_json.lignes` (OCR Mistral).
6. INSERT audit_log (action `rapprochement_auto`).

> **Périmètre période — pas de rapprochement partiel V1 (§05 R3.8, arbitrage Val 2026-06-03)** : règle V1 = **1 facture = 1 période sans chevauchement** avec une période déjà facturée. Le filtre `cout_final_verrouille = false` de l'étape 1 exclut **automatiquement** les tournées déjà rapprochées/facturées (verrouillées par une facture antérieure) → aucun double comptage même si la période d'une nouvelle facture recouvre des tournées déjà payées. Si une facture à cheval refacture du déjà-payé, l'écart tombe en `ecart_detecte` (étape 4) → Ops tranche (W5/W6). **Pas de découpage automatique, pas de nouvelle colonne, pas de nouvel état.** Rapprochement partiel/ligne-à-ligne réévaluable V1.1 si volume × 5.

**Performance** : cible p95 < 2s pour une facture avec < 100 tournées / lignes. Index clés `tournees(prestataire_id, date_planifiee, statut)`.

---

### W4 — Validation Ops (facture `rapproche_ok`) **Supprimé V1 (revue sobriété §05 2026-05-01 D1)**

> **Refonte D1** : la validation Ops sur match exact n'a plus lieu d'être (zéro tolérance R_M08.1 + match exact = aucune décision humaine à prendre, juste un clic). W3 passe directement en `statut_rapprochement = valide` + trigger M07 verrouillage tournées + audit_log `M08_FACTURE_AUTO_VALIDEE` + notification N1 informative + email prestataire `notif_facture_validee`. La supervision Ops reste possible a posteriori via filtre E1 statut `valide` + colonne "Validée par : système" (acteur audit_log = trigger système). Réintroduction V1.1 si Val/Louis ré-instaurent une revue humaine systématique.
>
> déjà supprimée revue sobriété 2026-04-30 A3 (validation unitaire seule).
>
> Validation manuelle après écart détecté reste W5 ci-dessous (motif ≥ 30 car obligatoire).

---

### W5 — Validation manuelle (facture `ecart_detecte`)

Cas rare : Ops estime que l'écart est justifié (exception négociée hors règle standard, remise ponctuelle acceptée, etc.).

1. Ops → E2 facture en écart → clic `Valider manuellement` (action secondaire, moins visible que `Contester`).
2. Modale : "Valider malgré l'écart ? Motif requis."
3. Champ `motif_validation_ecart` (textarea, required, min 30 car).
4. Confirmation + submit.
5. Check rôle : **Ops** peut valider manuellement sans limite (D6 option a) mais alerte Admin M11 "validation manuelle écart facture" si `|ecart_ht| > 100€`.
6. UPDATE `factures_prestataires` : `statut_rapprochement = 'valide'`, `motif_validation_ecart`, `valide_at`. Acteur tracé via `audit_logs.acteur_user_id` (revue sobriété §04 2026-04-30 B1).
7. Reste identique à W4 : verrouillage tournées, notifications, audit.

**Nota** : `motif_validation_ecart` est obligatoire pour traçabilité. Audit log retient l'écart validé.

---

### W6 — Contestation + demande d'avoir (facture rejetée)

1. Ops → E2 ou E1 → clic `Contester` → ouverture E6. Disponible si statut = `ecart_detecte`, `rapprochement_manuel_requis` ou `valide` (arbitrage Val 2026-06-06). **Pas** sur `regle` (immuable R_M08.6 → W9 Admin only).
2. Ops remplit motif (≥ 30 car) + type + lignes contestées.
3. Si option `Demander facture rectificative` cochée :
   - Email auto au contact facturation prestataire.
   - Template inclut : motif, montants TMS, montants facture, lignes contestées, CTA portail M03 ou réponse email.
4. UPDATE `factures_prestataires.statut_rapprochement = 'conteste'`, `motif_contestation`, `conteste_par_user_id`, `conteste_at`, `conteste_apres_validation` (= `true` si statut précédent `valide`, sinon `false`).
5. **Déverrouillage tournées (arbitrage Val 2026-06-06)** : si statut précédent = `valide`, le trigger `trg_m08_deverrouiller` appelle `tms.m08_deverrouiller_tournees` → reset `cout_final_verrouille = false` + `verrouillee_par_facture_id = NULL`. Si statut précédent = `ecart_detecte` / `rapprochement_manuel_requis` : aucune tournée verrouillée, no-op.
6. Notification prestataire (email) + Ops/Admin.
7. Audit log.
8. Facture reste visible E1 avec badge `conteste`.

**Note séparation des pouvoirs** : la contestation Ops d'une facture `valide` est un **rejet a posteriori léger** (l'auto-validation W3 zéro tolérance ne laisse aucune revue humaine avant verrouillage — Ops doit pouvoir rattraper une auto-validation erronée). Le **W9 Admin** garde ses pouvoirs étendus exclusifs : action `reouverte_pour_validation`, traitement des factures `regle`, écriture des colonnes `action_deverrouillage`/`motif_deverrouillage` (gardées admin-only par trigger, cf. §11.14).

---

### W7 — Upload facture rectificative

Prestataire (manager ou Ops pour province) émet un avoir puis une nouvelle facture :

1. Via M03 W10 ou M08 W2, upload d'une **nouvelle** facture.
2. Dans le formulaire : option `Cette facture rectifie une précédente` cochée → sélecteur facture contestée.
3. Check : facture référencée a `statut_rapprochement = 'conteste'`.
4. INSERT nouvelle facture avec `facture_corrigee_id = ancienne_facture.id`.
5. **Trigger DB `trg_m08_rectification`** :
   - UPDATE `factures_prestataires` ancienne : `statut_rapprochement = 'remplacee_par_avoir'`, `remplacee_par_facture_id = new.id`.
   - Rapprochement auto sur la nouvelle facture (W3 normal).
6. Audit log sur les deux factures.
7. Notification Ops/Admin.

**Règle** : le numéro de la facture rectificative doit être différent (contrainte UNIQUE) — conforme pratique comptable FR (avoir + nouvelle facture).

---

### W8 — Règlement (saisie manuelle V1)

1. Val/Louis effectue virement bancaire via Pennylane (hors TMS).
2. Ops/Admin → E2 facture `valide` → clic `Régler` → E7.
3. Saisie date + mode + référence.
4. UPDATE `factures_prestataires.statut_rapprochement = 'regle'`, `regle_at`, `reference_reglement` (`mode_reglement` supprimé B3, `regle_par_user_id` supprimé revue sobriété §04 2026-04-30 B1). Acteur tracé via `audit_logs.acteur_user_id`.
5. Notification prestataire (email template `notif_facture_reglee`).
6. Audit log.
7. Facture disparaît de E5 W4 "validées non réglées".

**V2 (API Pennylane)** : endpoint Pennylane push statut règlement → webhook TMS → UPDATE auto `regle_at`.

---

### W9 — Déverrouillage facture validée (Admin TMS)

Cas d'urgence : erreur détectée post-validation.

1. Admin → E2 facture validée ou réglée → clic `Déverrouiller` → E8.
2. Admin remplit motif + choisit action post-déverrouillage.
3. Confirmation checkbox + submit.
4. UPDATE `factures_prestataires` (simplifié revue sobriété 2026-04-30 D1) :
   - Si `action_post_deverrouillage = 'rejetee_pour_correction'` : `statut_rapprochement = 'conteste'` + `conteste_apres_validation = true` + reset `valide_at`, `regle_at`, `reference_reglement` (`mode_reglement` supprimé B3, `valide_par_user_id`/`regle_par_user_id` supprimés revue sobriété §04 2026-04-30 B1).
   - Si `reouverte_pour_validation` : `statut_rapprochement = 'en_attente'`, reset validation.
5. **Trigger DB `trg_m08_deverrouillage`** :
   - UPDATE `tournees SET cout_final_verrouille = false, verrouillee_par_facture_id = NULL` pour toutes les tournées liées (revue sobriété 2026-04-30 B1 + A5 : périmètre = agrégat période uniquement, table `factures_prestataires_lignes` supprimée V1 — plus de fallback `factures_prestataires_lignes.tournee_id`).
   - Si `action = reouverte_pour_validation` : trigger W3 rapprochement auto re-calcule.
6. Si facture déjà exportée Pennylane : INSERT `tms.audit_logs` action `M08_EXPORT_PENNYLANE_ANNULEE` (revue sobriété 2026-04-30 B2) + alerte Ops M11 « export Pennylane à annuler manuellement ».
7. INSERT audit_log niveau critique action `M08_DEVERROUILLAGE_ADMIN`.
8. Notifications (revue sobriété 2026-04-30 C3) : prestataire (email N9) + Ops (alerte M11 critique seule, email retiré) + Admin (in-app + audit log entry, email retiré).
9. Warning M11 catégorie `alerte_facturation_critique`.

---

### W10 — Export Pennylane (V1 manuel)

1. Ops → E9 (1er ou 5 du mois).
2. Filtre période (default M-1 ou mois en cours).
3. Sélection factures à exporter (check multi-lignes, default sélection = toutes non exportées statut `valide` ou `regle`).
4. Clic `Exporter CSV` → génération fichier CSV (format M13 `pennylane_csv_colonnes`).
5. Download CSV local.
6. Ops upload CSV dans Pennylane hors TMS.
7. Vérification Pennylane OK → retour E9 → clic `Marquer comme exportées` sur les factures.
8. UPDATE `factures_prestataires.exporte_pennylane_at = now()`. Acteur tracé via `audit_logs.acteur_user_id` (revue sobriété §04 2026-04-30 B1 — colonne `exporte_par_user_id` retirée V1).
9. INSERT `tms.audit_logs` action `M08_EXPORT_PENNYLANE` payload `{periode_export, facture_ids, total_ht, total_tva, total_ttc, csv_url}` (CSV archivé R2 5 ans — simplifié revue sobriété 2026-04-30 B2 vs ex-table dédiée `exports_pennylane_log`).
10. **Fusionné dans step 9** (audit_logs est maintenant la trace canonique des exports).

**V2 (API)** : `Pousser vers Pennylane` → async job → API Pennylane → maj statut Pennylane récupéré → UPDATE auto.

---

### W11 — Cron quotidien : rappels upload **Supprimé revue sobriété §05 2026-05-01 A1**

V1 supprimé : volume V1 ≈ 30 factures/mois ne justifie pas un cron + alerte M11 dédiée. Supervision Ops via widget E0 "Factures attendues mois en cours" (relance manuelle hebdomadaire suffisante).

**Conséquences** :
- Cron Edge Function `m08_rappel_upload` retiré.
- Code alerte M11 `m08_rappel_facture` retiré du catalogue (cf. §13bis ci-dessous + M11).
- Notification N10 retirée (cf. §5).
- Template email `rappel_facture_j5` retiré.
- Paramètres `m08.rappel_upload_jour_mois` + `m08.escalade_upload_jour_mois` retirés (cf. §9).

**Réintroduction V1.1** : si volume × 5 (>150 factures/mois) ou dérive significative > 1 mois sur > 5 prestataires.

---

### W12 — Cron mensuel : rapport export Pennylane **Supprimé revue sobriété 2026-04-30 A2**

V1 supprimé : Val/Louis exportent CSV E5 ou E1 à la demande quand ils veulent piloter (mensuellement, hebdomadairement, peu importe). Pas de cron + génération PDF + archive R2 + template `rapport_facturation_mensuel` + envoi email auto.

**Conséquences** :
- Cron pg_cron `m08_rapport_mensuel` retiré.
- Paramètre `m08.pennylane_export_mensuel_cron_jour` retiré (cf. §9).
- Notification N14 retirée (cf. §5).
- Template email `rapport_facturation_mensuel` retiré.

---

## 5. Notifications

| # | Déclencheur | Cible | Canal | Template |
|---|-------------|-------|-------|----------|
| N1 | Facture validée auto (W3 match exact, refondu revue sobriété §05 2026-05-01 D1) | Ops Savr + Admin TMS | In-app + email (informative, pas d'action requise) | "Facture `:numero` de `:prestataire` validée automatiquement (match exact zéro tolérance). Tournées verrouillées. Audit dispo dans M08." |
| N2 | Tournée sans coût détectée (W3) | Ops Savr + Admin TMS | In-app + email | "Facture `:numero` : tournée(s) sans coût calculé (grille absente), vérification manuelle requise" |
| N3 | Écart détecté (W3) | Ops Savr + Admin TMS | In-app + email | "Écart détecté facture `:numero` `:prestataire` : `:ecart_ht €`" |
| N4 | Facture uploadée (W1 normale OU W7 rectification — fusion C2) | Ops Savr + Admin TMS | Email | Template conditionnel : si `facture_corrigee_id IS NULL` → "Facture `:numero` reçue de `:prestataire` via portail" / si `facture_corrigee_id IS NOT NULL` → "Facture rectificative `:numero` reçue de `:prestataire`, remplace `:numero_precedent`" |
| N6 | Contestation (W6) | Prestataire (contact facturation) | Email | "Votre facture `:numero` fait l'objet d'une contestation. Motif : `:motif`. CTA : émettre avoir + nouvelle facture" |
| N7 | Facture validée (W3 auto match exact OU W5 validation manuelle écart) | Prestataire (contact facturation) | Email | "Votre facture `:numero` a été validée. Règlement selon les conditions prévues au contrat." (revue sobriété M08 2026-06-05 D6 — ex-« W4/W5 », W4 supprimé revue sobriété §05 2026-05-01 D1) |
| N8 | Facture réglée (W8) | Prestataire (contact facturation) | Email | "Virement effectué pour facture `:numero` le `:date_reglement`" |
| N9 | Déverrouillage (W9) — simplifiée C3 | Prestataire (email) + Ops (in-app + alerte M11 critique) + Admin (in-app uniquement) | Cf. cellule cible | "Facture `:numero` déverrouillée. Motif : `:motif`. Action requise : `:action_post_deverrouillage`" — **Email Admin retiré** (Admin a déclenché l'action, confirmation in-app + audit log entry suffit). **Email Ops retiré** (alerte M11 catégorie `alerte_facturation_critique` couvre la visibilité). |
| N13 | Validation manuelle écart > 100€ (W5) | Admin TMS | In-app + email | "Validation manuelle écart `:ecart_ht €` sur facture `:numero` par `:acteur`" |

---

## 6. Edge cases

| # | Scénario | Comportement attendu |
|---|----------|----------------------|
| EC1 | OCR rate un champ required | Blocage upload. Ops/Manager doit compléter manuellement avant submit (D3). |
| EC2 | Facture hors période tournées (prestataire facture mais aucune tournée réalisée sur la période) | `montant_ht_calcule_tms = 0`, `ecart_ht = montant_facture`, statut `ecart_detecte`. Notification "Aucune tournée TMS trouvée sur la période facturée, vérifier la cohérence". Contestation probable par Ops. |
| EC3 | Prestataire archivé en cours de période | Si des tournées restent dans la période avant archivage : rapprochement normal. Si prestataire archivé après upload d'une facture : upload Ops reste possible (source `factures_prestataires.prestataire_id` FK vers archive), validation normale. Aucun nouveau upload manager possible (session révoquée). |
| EC4 | Tournée avec `cout_final_ht IS NULL` dans la période (A Toutes! grille absente) | W3 détecte → statut `rapprochement_manuel_requis`, exclusion de la tournée du `montant_ht_calcule_tms`, alerte Ops N2. Ops doit intervenir (saisir grille M07 puis re-trigger rapprochement via E2 bouton `Re-rapprocher`) ou valider manuellement l'écart (W5 motif). **Bouton `Re-rapprocher` disponible uniquement si `statut_rapprochement = 'rapprochement_manuel_requis'`** (arbitrage Val 2026-06-06 — garde server-side ; pas de re-rapprochement sur `valide`/`ecart_detecte`). |
| EC5 | Tournée annulée dans la période | Exclue automatiquement (`statut != 'terminee'`). |
| EC6 | Contestation alors qu'une autre facture est déjà validée sur la même période | Possible (plusieurs factures/mois autorisées D12). Les tournées déjà verrouillées par l'autre facture restent verrouillées. Ne concerne que les tournées non verrouillées à la date de rapprochement. |
| EC7 | Déverrouillage alors que nouvelle facture déjà uploadée pour la même période | Bloqué : Admin doit d'abord statuer sur la nouvelle facture (valider ou contester). Message : "Une autre facture `:numero` est en cours de traitement sur cette période. Traiter en priorité." |
| EC8 | Numéro facture dupliqué sur le même prestataire | Contrainte UNIQUE DB refuse INSERT. Message UX : "Ce numéro existe déjà. Si c'est une rectification, cochez l'option correspondante." |
| EC9 | PDF corrompu / illisible | OCR retourne erreur → blocage upload, message "Le PDF n'a pas pu être lu, vérifier le fichier et réessayer". Pas d'INSERT. |
| EC10 | `periode_debut > periode_fin` (saisie ou OCR erroné) | Validation client et server-side refuse submit. |
| EC11 | Plusieurs factures même mois même prestataire | Acceptées (D12). UNIQUE sur `(prestataire_id, numero_facture)` seul. Warning UI "Ce prestataire a déjà une facture pour ce mois : `:numero_precedent`. Continuer ?" |
| EC12 | Ops Savr upload facture pour prestataire dont manager a déjà uploadé doublon numéro | Refusé par UNIQUE + message "Numéro déjà présent (upload manager le `:date`)". |
| EC14 | Facture uploadée avec `montant_ht_prestataire = 0` | Refusée (CHECK constraint `montant_ht_prestataire > 0`). Message UX "Le montant HT doit être supérieur à 0." |
| EC15 | Avoir sans facture de remplacement (prestataire émet avoir mais n'émet pas de nouvelle facture dans X jours) | Pas de mécanisme auto V1. Ops fait le suivi manuel via E1 filtre `conteste` + alerting M11 "Contestation > 30j sans rectification". |
| EC16 | Manager tente d'uploader rectification sans avoir contesté (statut original = `valide` ou `regle`) | Interdit côté M03. Seul Admin peut déverrouiller la facture d'origine (W9) avant upload rectificative. |
| EC17 | Modification de `cout_final_ht` d'une tournée après validation facture (déverrouillage M07 via ajustement) | Impossible : M07 refuse tout ajustement si `cout_final_verrouille = true` (D11 M07 existant). Admin doit d'abord déverrouiller la facture (W9). |
| EC18 | Contestation avec prestataire qui ne répond jamais (pas d'avoir émis) | Pas de mécanisme auto V1. Ops monitore via E1 + alerte M11 « contestation ancienne » si > 60j. V2 : workflow escalade automatique. |
| EC19 | Export Pennylane marqué comme exporté puis facture déverrouillée | Compensation manuelle obligatoire côté Pennylane par Ops (alerte M11 critique). INSERT entrée `tms.audit_logs` action `M08_EXPORT_PENNYLANE_ANNULEE` (simplifié revue sobriété 2026-04-30 B2). V2 API : annulation auto. |
| EC20 | Ops upload facture avec `date_facture` > aujourd'hui (erreur OCR ou saisie) | Refusé (CHECK `date_facture ≤ CURRENT_DATE`). |

---

## 7. Cycle de vie des factures

```
[upload W1 ou W2]
    ↓ (trigger W3 rapprochement auto)
    ├─ montant facture = montant TMS → valide  (auto-validation, refondu revue sobriété §05 2026-05-01 D1)
    │    ↓ (trigger M07 verrouillage tournées + audit_log + N1 + email prestataire)
    │    ├─ (W6 contestation Ops/Admin — arbitrage Val 2026-06-06) → conteste (`conteste_apres_validation = true`, déverrouille les tournées) → cycle contestation
    │    ↓ (W8 règlement)
    │    → regle
    │        ↓ (terminal sauf déverrouillage Admin W9)
    │
    ├─ montant facture ≠ montant TMS → ecart_detecte
    │    ↓
    │    ├─ (W5 validation manuelle Ops avec motif ≥ 30 car) → valide → regle
    │    └─ (W6 contestation Ops) → conteste (`conteste_apres_validation = false`)
    │         ↓
    │         ├─ (W7 rectificative uploadée) → remplacee_par_avoir (terminal)
    │         │    (nouvelle facture démarre cycle normal)
    │         └─ (pas de réponse prestataire > 60j) → alerting M11 manuel
    │
    └─ tournée(s) sans coût → rapprochement_manuel_requis
         ↓
         (Ops saisit grille M07 + re-rapprochement) OU (Ops valide manuel écart W5)
         → retour branche `valide` direct ou `ecart_detecte`

[W9 déverrouillage Admin depuis valide ou regle] (simplifié revue sobriété 2026-04-30 D1)
    → conteste (`conteste_apres_validation = true`, attente rectificative — fusion ex-`rejetee_pour_correction`)
    → OU reouverte_pour_validation → en_attente → re-trigger W3
```

**Statuts terminaux** : `regle`, `remplacee_par_avoir`. ( supprimé — fusionné dans `conteste` D1. supprimé — fusionné dans `valide` direct revue sobriété §05 2026-05-01 D1.)

**Transitions interdites** :
- `en_attente → regle` direct (doit passer par `valide`).
- `valide → en_attente` direct (doit passer par `conteste` avec flag `conteste_apres_validation=true`, ou `reouverte_pour_validation` via W9).
- `valide → conteste` : **autorisé** via W6 (Ops/Admin, arbitrage Val 2026-06-06 — déverrouille les tournées + `conteste_apres_validation=true`) OU via W9 Admin (action `rejetee_pour_correction`). Dans les deux cas `conteste_apres_validation=true` (cohérent pgTAP §11.13).
- `regle → conteste` : **exclusivement** via W9 Admin avec motif obligatoire (immuabilité post-règlement R_M08.6). Ops ne peut pas contester une facture `regle`.
- Modification de tournées liées via M07 si `cout_final_verrouille = true`.

---

## 8. Règles R_M08.x

### R_M08.1 — Match exact obligatoire (zéro tolérance, refondu revue sobriété §05 2026-05-01 D1)

Une facture est **automatiquement validée** (`statut_rapprochement = 'valide'` direct, refondu D1 2026-05-01) **uniquement si** `montant_ht_prestataire = montant_ht_calcule_tms` au centime près. Trigger M07 verrouillage tournées + audit_log `M08_FACTURE_AUTO_VALIDEE` (acteur=système) + N1 informative + email prestataire `notif_facture_validee`.

Tout écart (même 0,01€) → `statut_rapprochement = 'ecart_detecte'`. Pas de seuil, pas de tolérance. Ops tranche via W5 (validation manuelle motif ≥ 30 car) ou W6 (contestation).

 supprimé V1 (revue sobriété §05 2026-05-01 D1) — match exact zéro tolérance = aucune décision humaine à prendre, donc pas d'étape Ops manuelle. Réintroduction V1.1 si Val/Louis ré-instaurent une revue humaine systématique.

**Raison** : intégrité financière + traçabilité + alignement pratique comptable FR (un écart = un avoir).

### R_M08.2 — Contestation = émission d'avoir obligatoire

Si Ops conteste une facture (écart ou erreur manuelle), la résolution standard est :
- Prestataire émet un avoir pour annuler la facture originelle.
- Prestataire émet une **nouvelle facture** avec un **numéro différent** (contrainte UNIQUE).
- Nouvelle facture référence l'ancienne via `facture_corrigee_id`.
- Ancienne facture passe à `remplacee_par_avoir`.

Pas de rectification in-place d'une facture existante.

### R_M08.3 — Validation manuelle écart = motif obligatoire

Si Ops/Admin valide une facture malgré un écart (W5), `motif_validation_ecart` est obligatoire (min 30 car) et tracé audit log.

Seuil d'alerte Admin : si `|ecart_ht| > 100€`, notification Admin TMS automatique (N13) — Admin peut demander justification ou déverrouiller a posteriori.

### R_M08.4 — Verrouillage tournées à la validation

À la validation (`statut_rapprochement = 'valide'`), toutes les tournées rapprochées passent `cout_final_verrouille = true` + `verrouillee_par_facture_id`.

Périmètre tournées : **agrégat période uniquement** (revue sobriété §04 2026-04-30 A5 — table `factures_prestataires_lignes` supprimée V1, plus de fallback ligne-à-ligne) = toutes les tournées du prestataire dans la période `[periode_debut, periode_fin]` en statut `terminee`.

### R_M08.5 — Déverrouillage des tournées : deux chemins (révisé arbitrage Val 2026-06-06)

Le reset `cout_final_verrouille = false` + `verrouillee_par_facture_id = NULL` sur les tournées liées peut être déclenché par :
- **(a) Contestation Ops/Admin d'une facture `valide`** (W6, arbitrage Val 2026-06-06) : rejet a posteriori léger d'une auto-validation, statut → `conteste` + `conteste_apres_validation=true`. Motif de contestation ≥ 30 car (champ `motif_contestation`).
- **(b) W9 Admin TMS** (rejet `rejetee_pour_correction` ou `reouverte_pour_validation`) : motif ≥ 30 car (`motif_deverrouillage`), audit log niveau critique, notification prestataire. Pouvoirs étendus exclusifs Admin : réouverture pour re-validation + traitement des factures `regle`.

**Admin-only strict** : seul `admin_tms` peut (i) déverrouiller une facture `regle`, (ii) utiliser `reouverte_pour_validation`, (iii) écrire les colonnes `action_deverrouillage` / `motif_deverrouillage` / `deverrouillee_at` (garde par trigger `trg_factures_deverrouillage_admin_only`, cf. §11.14). La RLS étant row-level, le cloisonnement colonne de ces champs W9 passe par ce trigger, pas par une policy.

### R_M08.6 — Immuabilité post-règlement sauf déverrouillage Admin

Une facture en statut `regle` ne peut être modifiée (ni contestée par Ops, ni ré-éditée). Seule la procédure W9 Admin permet de revenir en arrière. (Une facture `valide` non encore réglée reste contestable par Ops via W6, cf. R_M08.5(a).)

### R_M08.7 — 1 facture par mois applicatif (warning non bloquant)

La règle « 1 facture par mois par prestataire » (hérité M03) est un warning UX, pas une contrainte DB. UNIQUE DB = `(prestataire_id, numero_facture)` uniquement.

Warning affiché si upload d'une 2e facture même mois : "Ce prestataire a déjà une facture pour ce mois : `:numero_precedent`. Confirmer l'upload ?"

Motivation : certains prestataires province peuvent facturer plusieurs vacations séparément.

### R_M08.8 — Tournées A Toutes! sans coût = rapprochement manuel

Si au moins une tournée dans la période a `cout_final_ht IS NULL` (grille absente, typique A Toutes! V1) :
- Statut intermédiaire `rapprochement_manuel_requis`.
- Exclusion de la tournée du calcul `montant_ht_calcule_tms`.
- Notification Ops N2.
- Ops doit :
  - Saisir/valider grille M07 et re-trigger rapprochement (bouton `Re-rapprocher` dans E2).
  - OU valider manuellement écart (W5 motif).

### R_M08.9 — Export Pennylane bloqué si non validée

Une facture en statut `en_attente`, `ecart_detecte`, `rapprochement_manuel_requis`, `conteste`, `remplacee_par_avoir` ne peut pas être exportée vers Pennylane. Seuls `valide` et `regle` sont exportables. (revue sobriété M08 2026-06-05 D1 — `rejetee_pour_correction` retiré, statut fusionné dans `conteste`.)

### R_M08.10 — OCR pré-remplissage sans blocage si incomplet

L'OCR pré-remplit les champs, mais si un champ required reste vide, l'UX bloque le submit (R_M08.10). L'Ops/Manager peut compléter manuellement tous les champs — zéro INSERT en mode "draft" côté DB.

### R_M08.11 — **Supprimée revue sobriété §05 2026-05-01 A1**

. W11 supprimé V1 (volume V1 ≈ 30 factures/mois ne justifie pas un cron + alerte M11 + email auto). Supervision déplacée sur **widget E0 "Factures attendues mois en cours"** (relance Ops manuelle, pas de notification automatique).

Réintroduction V1.1 si volume × 5 ou dérive significative > 1 mois sur > 5 prestataires.

### R_M08.12 — Traçabilité immuable (audit log 5 ans)

Toutes les actions sur `factures_prestataires` (INSERT, UPDATE statut, validation, contestation, règlement, déverrouillage, export) sont tracées dans `audit_logs` avec rétention 5 ans (obligation comptable FR).

---

## 9. Paramètres (`parametres_tms` namespace `m08`)

| Clé | Type | Default | Usage |
|-----|------|---------|-------|
| `m08.ocr_timeout_secondes` | integer | `30` | W2/W1 timeout OCR Mistral |
| `m08.ocr_confiance_min_blocage_pourcent` | numeric | `0` | 0 = jamais bloquer sur score OCR, Ops valide manuellement (D3 blocage sur champs vides seulement) |
| `m08.seuil_alerte_validation_manuelle_ht` | numeric | `100` | R_M08.3 seuil notification Admin si validation manuelle écart |
| `m08.seuil_alerte_contestation_anciennete_jours` | integer | `60` | EC18 alerte M11 contestation > 60j |
| `m08.max_taille_pdf_mo` | integer | `10` | Upload W1/W2 |
| `m08.pennylane_csv_encoding` | text | `UTF-8-BOM` | W10 export CSV (import Pennylane FR) |

---

## 10. Décisions D1-D12

| # | Décision | Alternatives écartées | Justification |
|---|----------|----------------------|---------------|
| D1 | **A Toutes! dans M08 V1 avec rapprochement manuel si grille absente** | Hors M08 V1 (traitement email direct Pennylane) | Unification UX Ops, audit unifié, éviter double système. Grille A Toutes! à saisir dans seed data onboarding. |
| D2 | **Écran dédié E3 Upload Ops pour prestataires province (emails)** | Upload via M06 E5 onglet factures | Centralisation M08 (1 seul endroit factures), Ops ne jongle pas entre modules. |
| D3 | **OCR pré-remplit, blocage upload tant que champs required incomplets** | INSERT en mode draft `en_attente_saisie` | Éviter dette de factures incomplètes. Audit propre (INSERT = facture complète). |
| D4 | **Zéro tolérance — match exact obligatoire** | Seuils 10€ + 2% cumulatifs | Intégrité financière stricte + pratique FR avoir obligatoire. Workflow binaire **`valide` direct (auto-validation match exact, refondu revue sobriété §05 2026-05-01 D1) / `ecart_detecte`**. **Impact rétroactif** : retrait `seuil_tolerance_ht/pct` de §04 + refonte §05 R3. |
| D5 | **Pas de paliers de seuil (suppression `ecart_critique`)** | Palier warning/critique 20% | Cohérence D4 zéro tolérance, UX Ops simplifiée. Alerting via `m08.seuil_alerte_validation_manuelle_ht` (100€) pour validations manuelles atypiques, pas pour l'écart brut. |
| D6 | **Ops ET Admin peuvent valider (toutes factures)** | Ops si auto OK, Admin si écart | Simplicité Ops en pic de charge (validation manuelle fréquente si A Toutes! ou EC atypiques), seuil d'alerte 100€ suffit pour tracer écarts importants. Admin peut toujours déverrouiller a posteriori. |
| D7 | **Rectification = nouveau numéro obligatoire (avoir + nouvelle facture)** | Même numéro avec `version_facture int` | Aligne pratique comptable FR standard, trace claire Pennylane, zéro ambiguïté audit. |
| D8 | **`facture_corrigee_id` self-ref FK dans `factures_prestataires`** | Table séparée `factures_rectifications_log` | Self-ref plus simple, requête intuitive ("quelle facture rectifie quoi"). |
| D9 | **Règlement V1 saisie manuelle (bouton + date), V2 API Pennylane** | Import CSV relevé bancaire V1 | V1 low-tech, pas de dépendance API Pennylane v2 stabilisée. V2 aligné avec généralisation Plateforme ↔ Pennylane. |
| D10 | **Export Pennylane V1 manuel (CSV + bouton "marquer exportée"), V2 API push** | API V1 dès le lancement | V1 réduit risque d'intégration, Ops garde la main. CSV + marquage permet découplage temporel export/marquage. |
| D11 | **Déverrouillage = Admin TMS uniquement + motif ≥ 30 car + audit log critique + notification prestataire** | Workflow via avoir automatique déverrouillant | Cas exceptionnel (erreur calcul, bug détecté), Admin seul responsabilité, trace obligatoire. |
| D12 | **UNIQUE `(prestataire_id, numero_facture)` seul, plusieurs factures par mois autorisées** | UNIQUE `(prestataire_id, mois_concerne)` 1 seule par mois | Flexibilité cycles facturation non-calendaires (Strike 26→25, prestataires qui facturent par vacation). Règle « 1/mois » devient warning applicatif non bloquant. |

---

## 11. Data model addendum M08

Compléments à §04 TMS suite décisions M08 (propagation 2026-04-24).

### 11.1 Colonnes ajoutées à `factures_prestataires`

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `source_upload` | text | NOT NULL, default `'manager_m03'` | Enum `manager_m03`, `ops_manuel` (revue sobriété 2026-04-30 B4 : ex-valeur `ops_rectification` supprimée — info portée par `facture_corrigee_id IS NOT NULL`) |
| `facture_corrigee_id` | uuid | FK `factures_prestataires(id)`, nullable | Self-ref : facture que celle-ci rectifie (D8) |
| `remplacee_par_facture_id` | uuid | FK `factures_prestataires(id)`, nullable | Self-ref inverse : facture qui remplace celle-ci suite avoir |
| `conteste_par_user_id` | uuid | FK `users_tms(id)`, nullable | Qui a contesté |
| `conteste_at` | timestamptz | nullable | Horodatage contestation |
| `conteste_apres_validation` | boolean | NOT NULL, default `false` | **Ajout revue sobriété 2026-04-30 D1 ; redéfini arbitrage Val 2026-06-06** : flag = « la facture avait-elle été validée avant d'être contestée ». `true` si contestation depuis `valide` (W6 Ops/Admin OU W9 Admin) ; `false` si contestation depuis `ecart_detecte` / `rapprochement_manuel_requis` (jamais validée). Permet filtre E1 sous-section "Contestation post-validation". |
| `type_contestation` | text | nullable | **Text libre (revue sobriété §04 2026-04-30 D3 — CHECK constraint enum retiré V1)**. UI E6 dropdown préremplie : `ecart_montant`, `erreur_periode`, `erreur_prestataire`, `erreur_doublon`, `autre` + saisie libre. |
| `motif_validation_ecart` | text | nullable | Si validation manuelle malgré écart (R_M08.3) |
| `reference_reglement` | text | nullable | Ex référence virement bancaire |
| `commentaire_reglement` | text | nullable | Note libre (modalité atypique si non-virement) |
| `exporte_pennylane_at` | timestamptz | nullable | Marquage export Pennylane (V1 manuel via E9) |
| `action_deverrouillage` | text | nullable | Enum `rejetee_pour_correction`, `reouverte_pour_validation` (si W9 exécuté). **Note D1** : la valeur `rejetee_pour_correction` ici est la valeur de cette colonne d'audit ; le `statut_rapprochement` correspondant devient `conteste` + `conteste_apres_validation = true` (vs ex-statut dédié). |
| `motif_deverrouillage` | text | nullable | Si déverrouillé (W9). Garde RLS active : `motif_deverrouillage IS NOT NULL AND char_length >= 30` (revue sobriété §04 2026-04-30 B1). |
| `deverrouillee_at` | timestamptz | nullable | Horodatage déverrouillage |

### 11.2 Colonnes retirées de `factures_prestataires` (propagation D4/D5 2026-04-24)

| Colonne | Raison |
|---------|--------|

### 11.3 Enum `statut_rapprochement` (refonte propagation D4/D11, simplifié revue sobriété 2026-04-30 D1)

```
en_attente                      (upload en cours de rapprochement)
ecart_detecte                   (W3 mismatch)
rapprochement_manuel_requis     (R_M08.8 tournée sans coût)
valide                          (W3 match exact auto-validé revue sobriété §05 2026-05-01 D1, OU W5 validation manuelle motif après écart)
regle                           (W8 règlement enregistré)
conteste                        (W6 Ops conteste OU W9 Admin déverrouille post-validation, distingués par flag `conteste_apres_validation`)
remplacee_par_avoir             (W7 rectificative reçue)
```

**Enum retirés** :
- (fusion `en_attente`)
- (fusion `ecart_detecte` D5)
- (fusion `conteste` revue sobriété 2026-04-30 D1) — comportement aval identique (avoir + nouvelle facture), distinction portée par flag `conteste_apres_validation` boolean.
- (fusion `valide` direct revue sobriété §05 2026-05-01 D1) — match exact zéro tolérance auto-validé, plus d'étape Ops manuelle V1.

**Compteur enum** : 8 → **7 valeurs**.

### 11.4 Colonnes ajoutées à `tournees`

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `verrouillee_par_facture_id` | uuid | FK `factures_prestataires(id)`, nullable | Facture qui a verrouillé cette tournée (R_M08.4) |

### 11.5 Nouvelle table `exports_pennylane_log` **Supprimée revue sobriété 2026-04-30 B2**

Table dédiée supprimée V1 — trace via `tms.audit_logs` action `M08_EXPORT_PENNYLANE` (export normal) et `M08_EXPORT_PENNYLANE_ANNULEE` (compensation W9).

**Schéma payload audit_logs** (canonique) :

```jsonc
// action = 'M08_EXPORT_PENNYLANE'
{
  "periode_export": "2026-04-01",     // 1er du mois exporté
  "facture_ids": ["uuid1", "uuid2"],   // IDs factures incluses
  "nb_factures": 12,
  "total_ht": 24580.50,
  "total_tva": 4916.10,
  "total_ttc": 29496.60,
  "csv_url": "https://r2.../exports/2026-04.csv"  // R2 Storage 5 ans
}

// action = 'M08_EXPORT_PENNYLANE_ANNULEE'
{
  "facture_id": "uuid",
  "motif_deverrouillage": "...",
  "export_origine_audit_id": "uuid"  // FK logique vers l'INSERT M08_EXPORT_PENNYLANE
}
```

**Vue SQL** `v_m08_exports_pennylane` (alimentation E9 Section 3 Historique) :

```sql
CREATE VIEW tms.v_m08_exports_pennylane AS
SELECT
  al.id,
  (al.payload->>'periode_export')::date AS periode_export,
  CASE al.action
    WHEN 'M08_EXPORT_PENNYLANE' THEN 'exporte'
    WHEN 'M08_EXPORT_PENNYLANE_ANNULEE' THEN 'annulee'
  END AS statut,
  (al.payload->>'nb_factures')::int AS nb_factures,
  (al.payload->>'total_ht')::numeric AS total_ht,
  (al.payload->>'total_tva')::numeric AS total_tva,
  (al.payload->>'total_ttc')::numeric AS total_ttc,
  al.payload->>'csv_url' AS csv_url,
  al.payload->'facture_ids' AS facture_ids,
  al.acteur_user_id,
  al.created_at AS exporte_at
FROM tms.audit_logs al
WHERE al.action IN ('M08_EXPORT_PENNYLANE', 'M08_EXPORT_PENNYLANE_ANNULEE')
ORDER BY al.created_at DESC;
```

**Index recommandé** : sur `tms.audit_logs(action, created_at DESC)` partial WHERE action IN (...).

**RLS** : héritée de `tms.audit_logs` (lecture Ops + Admin TMS via policies existantes).

**Rétention** : 5 ans (alignée rétention `tms.audit_logs` Registre transport + obligations compta).

### 11.6 Fonction SQL `tms.m08_rapprocher(facture_id uuid)`

```sql
CREATE OR REPLACE FUNCTION tms.m08_rapprocher(p_facture_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_facture tms.factures_prestataires%ROWTYPE;
  v_montant_tms numeric(10,2);
  v_has_null_cost boolean;
BEGIN
  SELECT * INTO v_facture FROM tms.factures_prestataires WHERE id = p_facture_id FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM tms.tournees
    WHERE prestataire_id = v_facture.prestataire_id
      AND date_planifiee BETWEEN v_facture.periode_debut AND v_facture.periode_fin
      AND statut = 'terminee'
      AND cout_final_ht IS NULL
      AND cout_final_verrouille = false
  ) INTO v_has_null_cost;

  IF v_has_null_cost THEN
    UPDATE tms.factures_prestataires
    SET statut_rapprochement = 'rapprochement_manuel_requis'
    WHERE id = p_facture_id;
    -- TODO notif N2
    RETURN;
  END IF;

  SELECT COALESCE(SUM(cout_final_ht), 0) INTO v_montant_tms
  FROM tms.tournees
  WHERE prestataire_id = v_facture.prestataire_id
    AND date_planifiee BETWEEN v_facture.periode_debut AND v_facture.periode_fin
    AND statut = 'terminee'
    AND cout_final_verrouille = false;

  UPDATE tms.factures_prestataires
  SET montant_ht_calcule_tms = v_montant_tms,
      statut_rapprochement = CASE
        -- Refondu revue sobriété §05 2026-05-01 D1 : auto-validation direct si match exact (zéro tolérance)
        WHEN montant_ht_prestataire = v_montant_tms THEN 'valide'
        ELSE 'ecart_detecte'
      END
  WHERE id = p_facture_id;

  -- Si statut_rapprochement = 'valide' : trigger M07 verrouillage tournées + audit_log M08_FACTURE_AUTO_VALIDEE + N1 + email prestataire
  -- Sinon (ecart_detecte) : N3 Ops + Admin
END;
$$;
```

Invoquée par trigger AFTER INSERT sur `factures_prestataires` et par bouton `Re-rapprocher` E2 (EC4 résolution).

### 11.7 Fonction SQL `tms.m08_verrouiller_tournees(facture_id uuid)`

Appelée au passage `valide` pour verrouiller toutes les tournées rapprochées.

### 11.8 Fonction SQL `tms.m08_deverrouiller_tournees(facture_id uuid)`

Appelée à W9 pour reset `cout_final_verrouille = false` et `verrouillee_par_facture_id = NULL` sur toutes les tournées liées.

### 11.9 Trigger DB `trg_m08_rapprocher` AFTER INSERT

Appelle `tms.m08_rapprocher(NEW.id)` synchrone.

### 11.10 Trigger DB `trg_m08_verrouiller` BEFORE UPDATE statut `valide`

Appelle `tms.m08_verrouiller_tournees(OLD.id)`.

### 11.11 Trigger DB `trg_m08_deverrouiller` BEFORE UPDATE statut vers `conteste` (avec `conteste_apres_validation = true`) ou `en_attente` depuis `valide/regle` (revue sobriété M08 2026-06-05 D2 ; révisé arbitrage Val 2026-06-06 — chemin W6 Ops ajouté)

Appelle `tms.m08_deverrouiller_tournees(OLD.id)` uniquement si `OLD.statut_rapprochement = 'valide'` ou `'regle'` (no-op sinon : `ecart_detecte`/`rapprochement_manuel_requis` n'ont aucune tournée verrouillée).

**Garde motif (arbitrage Val 2026-06-06)** : la transition vers `conteste`/`en_attente` depuis `valide`/`regle` exige un motif ≥ 30 car, dans **l'un** des deux champs selon le chemin :
- chemin W6 Ops/Admin (contestation d'une `valide`) → `motif_contestation IS NOT NULL AND char_length(motif_contestation) >= 30` ;
- chemin W9 Admin (`rejetee_pour_correction` / `reouverte_pour_validation`) → `motif_deverrouillage IS NOT NULL AND char_length(motif_deverrouillage) >= 30`.

Garde : `(motif_contestation IS NOT NULL AND char_length(motif_contestation) >= 30) OR (motif_deverrouillage IS NOT NULL AND char_length(motif_deverrouillage) >= 30)` (revue sobriété §04 2026-04-30 B1 — `deverrouillee_par_user_id` retirée V1, acteur tracé via `audit_logs.acteur_user_id`).

### 11.14 Trigger DB `trg_factures_deverrouillage_admin_only` BEFORE UPDATE (nouveau — arbitrage Val 2026-06-06, #1 enforcement)

**Problème** : la RLS PostgreSQL est row-level, pas column-level, et le discriminant de rôle (`admin_tms`) vit dans le JWT (rôle Postgres unique `authenticated`) → ni une policy ni un `REVOKE UPDATE (colonne)` ne peuvent réserver les colonnes W9 à l'Admin. La policy permissive `factures_staff_all` (FOR ALL, `auth.user_is_staff()` incluant `ops_savr`) autoriserait sinon Ops à écrire ces colonnes.

**Trigger** : `BEFORE UPDATE ON tms.factures_prestataires` — si l'une des colonnes `action_deverrouillage`, `motif_deverrouillage`, `deverrouillee_at` est modifiée (`NEW IS DISTINCT FROM OLD`) ET `NOT auth.user_has_role('admin_tms')` → `RAISE EXCEPTION 'Déverrouillage W9 réservé à admin_tms'`.

**Portée** : ne bloque **pas** la contestation Ops d'une facture `valide` (W6) — celle-ci écrit `statut_rapprochement`/`motif_contestation`/`conteste_*` et déverrouille les tournées via `trg_m08_deverrouiller`, sans toucher les colonnes W9. Le trigger ne garde que le chemin W9 stricto sensu (E8).

### 11.12 Index complémentaires

- `factures_prestataires(statut_rapprochement)` WHERE `deleted_at IS NULL` (E1 filtres)
- `factures_prestataires(exporte_pennylane_at) WHERE exporte_pennylane_at IS NULL` (E9 factures à exporter)
- `factures_prestataires(facture_corrigee_id)` WHERE `facture_corrigee_id IS NOT NULL`

### 11.13 Tests pgTAP bloquants

- Policy RLS : manager ne peut pas voir factures d'un autre prestataire.
- Trigger `trg_factures_deverrouillage_admin_only` : Ops (non-admin) qui modifie `action_deverrouillage`/`motif_deverrouillage`/`deverrouillee_at` → RAISE EXCEPTION (§11.14, arbitrage Val 2026-06-06 — l'enforcement est au trigger, pas à la RLS row-level).
- Trigger : Ops PEUT contester une facture `valide` (W6) → statut `conteste` + `conteste_apres_validation=true` + tournées déverrouillées (arbitrage Val 2026-06-06).
- Trigger : INSERT `factures_prestataires` déclenche rapprochement.
- Trigger : UPDATE `valide` verrouille tournées.
- Trigger : déverrouillage requires `motif_deverrouillage NOT NULL AND char_length >= 30` (revue sobriété §04 2026-04-30 B1 — `deverrouillee_par_user_id NOT NULL` retiré V1, acteur tracé via `audit_logs.acteur_user_id`).
- Contrainte UNIQUE `(prestataire_id, numero_facture)` bloque doublon.
- **Ajout revue sobriété 2026-04-30 D1, révisé arbitrage Val 2026-06-06** : transition `valide/regle → conteste` requires `conteste_apres_validation = true` (s'applique aux deux chemins : W6 Ops contestation d'une `valide` ET W9 Admin). Inversement, contestation depuis `ecart_detecte`/`rapprochement_manuel_requis` requires `conteste_apres_validation = false`.
- **Ajout revue sobriété 2026-04-30 B2** : audit_log INSERT `M08_EXPORT_PENNYLANE` après UPDATE `exporte_pennylane_at`.
- **Ajout revue sobriété 2026-04-30 B1 + A5** : table `factures_prestataires_lignes` **supprimée V1** (revue sobriété §04 2026-04-30 A5). Test schema check pré-migration : la table n'existe pas. RLS / triggers cohérence retirés.

---

## 12. Dépendances cross-modules

| Module | Sens | Description |
|--------|------|-------------|
| M03 Portail prestataire | Amont | W10 M03 = upload manager factures (input M08) |
| M04 Gestion tournées | Amont | Périmètre tournées à facturer (`statut = terminee`) |
| M06 Référentiel prestataires | Amont | `shared.prestataires` (contact facturation, statut contrat) |
| M07 Pilotage financier | Amont | `cout_final_ht` source de vérité rapprochement |
| M11 Alerting | Aval | Warning factures en retard, écarts, déverrouillages, contestations anciennes |
| M13 Administration | Aval | Paramètres M08 configurables, templates emails |
| Plateforme | Transverse | Pas d'endpoint API V1 (M08 100% interne TMS). V2 API Pennylane via Plateforme possible si mutualisation |

---

## 13. Propagations cross-CDC (à exécuter immédiatement)

### §04 Data Model TMS
- Retrait colonnes `seuil_tolerance_ht` et `seuil_tolerance_pourcent` (D4) — barrer + propagation
- Ajout colonnes §11.1 à `factures_prestataires` (incluant `conteste_apres_validation` boolean — revue sobriété 2026-04-30 D1)
- Retrait colonne `mode_reglement` (revue sobriété 2026-04-30 B3)
- Modification enum `source_upload` 3→2 valeurs (revue sobriété 2026-04-30 B4)
- Ajout colonne `verrouillee_par_facture_id` à `tournees`
- → **supprimée revue sobriété 2026-04-30 B2**, vue SQL `v_m08_exports_pennylane` sur `tms.audit_logs` à la place
- **Suppression V1 table `factures_prestataires_lignes` entière** (revue sobriété §04 2026-04-30 A5 — initialement B1 sabré 3 colonnes 2026-04-30, A5 finit le travail). RLS, trigger cohérence `SUM`, audit_logs surveillance retirés. Audit visuel via `factures_prestataires.pdf_url` + `pdf_extraction_json`.
- Index complémentaires (§11.12)
- Refonte enum `statut_rapprochement` → **7 valeurs** (§11.3 fait foi : revue sobriété 2026-04-30 D1 `rejetee_pour_correction` fusionné dans `conteste` + revue sobriété §05 2026-05-01 D1 `rapproche_ok` fusionné dans `valide`. Compteur corrigé revue sobriété M08 2026-06-05 D3 — ex-mention « 9→8 » périmée)
- **Caduc revue sobriété M08 2026-06-05 D4** — paramètre supprimé depuis (revue sobriété §05 2026-05-01 A1, W11 cron retiré).
- Suppression paramètre `m08.pennylane_export_mensuel_cron_jour` (revue sobriété 2026-04-30 A2)
- Index sur `tms.audit_logs(action, created_at DESC)` partial pour vue `v_m08_exports_pennylane`

### §04 Data Model Plateforme
- Aucun impact direct (M08 100% interne TMS V1)

### §05 Règles métier TMS
- Refonte complète R3.3 (zéro tolérance, suppression seuils)
- **Caduc revue sobriété M08 2026-06-05 D5** — rapprochement ligne-à-ligne supprimé (revue sobriété 2026-04-30 B1) + table `factures_prestataires_lignes` supprimée (revue sobriété §04 2026-04-30 A5). Rapprochement global seul.
- Maj R3.5 workflow contestation (référence D7 avoir + nouveau numéro)
- **Caduc revue sobriété M08 2026-06-05 D5** — plus de lignes, plus de check SUM (table supprimée A5).
- Ajout règles R_M08.1 à R_M08.12 (§8 M08)

### §08 Contrat API Plateforme-TMS
- Aucun nouvel endpoint V1 (M08 interne TMS)
- Note V2 : endpoint Pennylane push statut règlement (si mutualisation Plateforme)

### §09 Auth et permissions TMS
- Nouvelle section RLS factures_prestataires (W9 Admin only déverrouillage)
- **Supprimée revue sobriété 2026-04-30 B2** — table dédiée supprimée, RLS audit_logs standard
- Tests pgTAP §11.13 (mise à jour revue sobriété 2026-04-30 : ajout test `conteste_apres_validation` D1 + **test schema `factures_prestataires_lignes` ne doit pas exister** revue sobriété §04 A5, retrait test `exports_pennylane_log` B2)

### §03 Périmètre fonctionnel TMS
- M08 §03 description : ajuster « zéro tolérance » (retrait seuils), « nouveau numéro obligatoire en rectification », « déverrouillage Admin TMS »

### §06 M03 Portail prestataire
- E10 : MAJ message "validation auto si match exact", retrait mention tolérance
- W10 : step 3 "calcul écart %" → "match exact ou rejet" + propagation OCR préremplit
- R_M03.9 : refonte totale (retrait tolerance, match exact obligatoire)
- EC8 M03 : refonte (retrait "écart > 20%", tout écart = contestation)
- Paramètres M03 : mise à jour templates emails

### §06 M07 Pilotage financier
- EC9 M07 : wording à vérifier (déverrouillage = W9 Admin TMS, motif ≥ 30 car)

### §00 Index TMS
- Ajout M08 V1 rédigée 2026-04-24
- Section propagations 2026-04-24 M08
- **Ajout 2026-04-30** : ligne « Revue de sobriété M08 appliquée » avec liste 16 simplifications (Bloc A 6 + Bloc B 6 + Bloc C 3 + Bloc D enums)

---

## 13bis. Alertes M11 émises par M08 (propagation M11 2026-04-24)

> **Normatif (R_M11.1)** : tous les triggers M08 utilisent `tms.alerte_emit(code, ...)` avec codes canoniques catalogue.

| Code canonique | Criticité | Trigger M08 | Scope |
|----------------|-----------|-------------|-------|
| `m08_facture_ecart_detecte` | warning | Rapprochement zéro tolérance : facture ne match pas (D4) | Ops + Admin TMS |
| `m08_rapprochement_manuel_requis` | warning | Tournée sur période facture sans `cout_final_ht` (M07 pas calculé) | Ops |
| `m08_export_pennylane_erreur` | warning | Génération CSV Pennylane échouée (V2) | Admin TMS |

**Compteur catalogue M08** : 5 → 4 (revue sobriété 2026-04-30 B5) → **3 codes** (revue sobriété §05 2026-05-01 A1).

**Codes ajustés Bloc 3 sobriété 2026-04-25 (A1 — criticité `info` dégagée V1)** :
- → code **supprimé revue sobriété §05 2026-05-01 A1**
- `m08_deverrouillage_admin` (ex-`info`, non seedé au catalogue) retiré : trace via `tms.audit_logs` action `M08_DEVERROUILLAGE_ADMIN` (W9) — audit_logs reste source de vérité de l'action admin

**Résolution auto W7** :
- `m08_facture_ecart_detecte` → résolue auto dès que manager upload avoir + nouvelle facture qui match (W6 cycle contestation)
- → **N/A revue sobriété §05 2026-05-01 A1** (code supprimé)

---

## 14. Liens

- [[01 - Vision et objectifs TMS]] — §2 douleurs MTS-1 (rapprochement manuel 1h/prestataire/mois)
- [[03 - Périmètre fonctionnel TMS]] — M08 périmètre V1
- [[04 - Data Model TMS]] — `factures_prestataires` (addendum M08). **Table `factures_prestataires_lignes` supprimée V1 (revue sobriété §04 2026-04-30 A5)** — audit visuel via `pdf_url` + `pdf_extraction_json`. Table `exports_pennylane_log` supprimée revue sobriété 2026-04-30 B2 (trace via `tms.audit_logs` action `M08_EXPORT_PENNYLANE`).
- [[05 - Règles métier TMS]] — R3 Rapprochement (refonte M08), R6.3 cycle de vie factures
- [[08 - Contrat API Plateforme-TMS]] — pas d'endpoint V1, note V2 Pennylane
- [[09 - Authentification et permissions TMS]] — RLS factures_prestataires + exports
- [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]] — W10 upload manager, E10
- [[06 - Fonctionnalités détaillées TMS/M04 - Gestion des tournées]] — cycle tournée, clôture
- [[06 - Fonctionnalités détaillées TMS/M06 - Référentiel prestataires]] — `shared.prestataires`, contacts facturation
- [[06 - Fonctionnalités détaillées TMS/M07 - Pilotage financier logistique]] — `cout_final_ht` source rapprochement, `cout_final_verrouille`
- [[01 - Cahier des charges App/08 - APIs et intégrations]] — Pennylane v2 (plateforme, pas TMS V1)

---

## 15. Questions ouvertes M08 post-rédaction

1. **Format CSV Pennylane V1** : colonnes exactes à spécifier avec expert-compta (template `m08.pennylane_csv_colonnes`). Action Val : fournir ou récupérer modèle import Pennylane.
2. **Contact facturation prestataire** : stocké dans `shared.prestataires.contact_facturation` (M06). Vérifier présence de l'email dans seed data.
3. **IBAN prestataire** : Pennylane gère probablement les RIB côté Pennylane. À confirmer. Si TMS stocke IBAN = section RGPD à traiter (§15).
4. **Alerting contestation > 60j** : M11 W ?. À intégrer lors de la rédaction M11.
5. **Dashboard DSO** : définition précise DSO (jour upload → jour règlement ou jour validation → jour règlement ?). V1 : **jour validation → jour règlement** (plus aligné convention gestion).
6. **Double devise** : uniquement EUR V1. V2 si prestataire international (A Toutes! belgique, prestataire allemand). Hors périmètre V1.
7. **Facturation intracommunautaire / TVA spéciale** : uniquement TVA FR standard V1 (20% ou exonération). V2 si besoin.
8. **Annulation règlement après saisie** : cas Ops saisit règlement par erreur → correction possible uniquement via W9 déverrouillage Admin (cohérent R_M08.6).
