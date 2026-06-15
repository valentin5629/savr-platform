# M03 — Portail prestataire self-service

**Persona principal** : Manager prestataire (Strike, Marathon, A Toutes!)
**Contexte d'usage** : web responsive (desktop bureau + mobile), usage pluriquotidien (acceptation collectes), hebdomadaire (gestion parc), mensuel (facturation).

---

> **NOTE GLOBALE 2026-05-03 — RESTAURATION + EXTENSION** : la chaîne `controle_acces_requis` retirée à la revue 2026-04-29 a été **restaurée 2026-05-01** (audit cohérence inter-CDC) puis **renommée + étendue 2026-05-03** (refonte formulaire §06.01 Plateforme). Nouveau nom : `controle_acces_requis` (flag unique plaque ET nom chauffeur). Trigger renommé `validate_tournee_controle_acces`, R_M04.CONTROLE_ACCES → R_M04.CONTROLE_ACCES (validation étendue à `tournees.chauffeur_id IS NOT NULL` en plus de la plaque). Toutes les mentions ci-dessous référençant `controle_acces_requis` doivent être lues comme `controle_acces_requis`. Webhook S7 réémis (annulation revue Bloc C 2026-05-01) avec payload enrichi 2026-05-03 : `plaque + chauffeur_nom`.

> : **ANNULÉE 2026-05-01 + 2026-05-03** : voir note ci-dessus. Concept restauré + renommé + étendu à plaque + nom chauffeur. **Sont au contraire à appliquer V1**, en remplaçant `controle_acces_requis` par `controle_acces_requis` partout.

## 1. Objectif métier

Portail **self-service** dédié aux **3 prestataires principaux Savr** (Strike, Marathon, A Toutes!) pour :

- **Accepter ou refuser** les collectes que Ops Savr leur attribue (M02 dispatch)
- **Assigner** un chauffeur + un véhicule (+ équipier si tournée à 2 personnes) avant exécution par M05
- **Gérer leur parc** : chauffeurs, véhicules, types de véhicules (self-service avec garde-fous)
- **Consulter leurs revenus** calculés par Savr (dashboard transparent, drill-down jusqu'à la tournée)
- **Déposer leurs factures** mensuelles (1 facture par mois auto, rapprochement M08)

**Ce que M03 remplace** :
- Les échanges téléphone/email désordonnés actuels entre Ops Savr et les prestataires
- Le dépôt PDF facture par email chez Val + Louis (flux manuel non tracé)
- L'absence totale de visibilité prestataire sur "combien je vais toucher ce mois"

**Ce que M03 ne couvre pas V1** :
- Les **~30 prestataires province** : gérés par Ops Savr via M02/M06, pas d'accès portail V1
- L'édition des grilles tarifaires : **Admin TMS seul** (lecture-only côté portail)
- La modification du paramètre `nb_personnes_facturation` : **fixé par Ops au dispatch M02**, manager peut seulement assigner l'équipier physique (pas changer le nombre)

**KPI cibles V1** :
- **≥ 90%** des collectes acceptées dans les 24h après dispatch (suivi manuel Ops, pas de SLA système — revue sobriété 2026-04-29)
- **100%** des factures mensuelles uploadées via portail (fin du dépôt email)
- **Temps moyen acceptation** : < 2h sur collectes standard (lead time 24-72h)

---

## 2. Personas et contexte d'usage

### Manager prestataire

- **Identité** : 1 à 3 personnes par prestataire (souvent gérant TPE ou responsable exploitation)
- **Rôle système** : `manager_prestataire` (rôle unique, pas de split dispatcher/admin_facturation en V1 — D4)
- **Accès** : web responsive `portail.tms.gosavr.io` (desktop bureau + mobile), auth email + mot de passe (politique 8 car min — aligné §09 TMS addendum 2026-04-24)
- **Périmètre RLS** : ne voit **que** son propre prestataire (collectes attribuées, parc, revenus, factures). Isolation garantie par policies RLS sur `prestataire_id` (voir §09)
- **Usage** :
  - **Pluriquotidien** : accepter les collectes entrantes (push + email), assigner chauffeur/véhicule
  - **Hebdomadaire** : créer/éditer chauffeur ou véhicule (turn-over), archiver partants
  - **Mensuel** : uploader la facture du mois précédent, consulter le dashboard revenus
  - **Ponctuel** : contester un montant (contact Ops via bouton "Question" sur tournée)

### Cas multi-managers par prestataire

Un prestataire peut avoir 2-3 utilisateurs `manager_prestataire` (ex : Strike = gérant + responsable planning + compta). Tous ont le **même rôle et la même visibilité** (pas de granularité V1). **Notifications V1 : tous les managers du prestataire reçoivent les notifs push + email** (nouvelle collecte à accepter, oubli assignation) — pas de dispatcher désigné (tranché QO#6 2026-06-05, simplicité ; désignation d'un dispatcher unique reportée si bruit constaté). Concurrent access géré par lock optimiste sur acceptation (voir edge case EC2/EC3).

### Chauffeur

**Hors périmètre M03.** Le chauffeur utilise **M05 App mobile chauffeur**. Sa fiche est créée par le manager via M03 (W7). Après activation, il reçoit un **email "Définir mon mot de passe" avec magic link 30 min** pour bootstrap (revue sobriété §05 2026-05-01 B1 — chemin "password initial fourni manager" supprimé). Il définit son password sur la page de reset puis se connecte normalement à M05 (email + password).

### Ops Savr

**Hors périmètre M03 nominal.** Ops n'utilise pas le portail, mais :
- Reçoit les événements d'escalade (2 rejets consécutifs, changement véhicule après acceptation, oubli assignation H-12) — SLA dépassé supprimé revue sobriété 2026-04-29
- Peut consulter l'historique M03 d'un prestataire via M06 (lecture croisée pour support)
- Supervise manuellement les collectes `attribuee_en_attente_acceptation` qui traînent via M02 E1 Zone 2 + override W5 si nécessaire

---

## 3. Architecture des écrans

**10 écrans V1** + 3 écrans transverses auth.

| # | Écran | Rôle | Accès |
|---|-------|------|-------|
| E1 | Accueil / Dashboard | Collectes en attente d'action + KPI mois courant | Manager |
| E2 | Liste collectes | Index paginé + filtres (statut, période, lieu) | Manager |
| E3 | Fiche collecte | Détail d'une collecte + boutons accept / refuse | Manager |
| E4 | Assignation tournée | Assignation chauffeur + véhicule (+ équipier si nb=2) | Manager |
| E5 | Liste chauffeurs | Index + filtres (actif, archivé) + recherche | Manager |
| E6 | Fiche chauffeur | Création / édition / archivage | Manager |
| E7 | Liste véhicules | Index + filtres (type, actif, archivé) | Manager |
| E8 | Fiche véhicule | Création / édition / archivage + création modèle de véhicule (label UI "Modèle", table data model reste `types_vehicules`) | Manager |
| E9 | Dashboard revenus | KPI mois + date picker + drill-down tournée | Manager |
| E10 | Factures | Upload PDF mensuel + historique + statut rapprochement M08 | Manager |
| EA1 | Login | Email + mot de passe | Public |
| EA2 | Mot de passe oublié | Saisie email → envoi magic link reset | Public |
| EA3 | Réinitialisation | Formulaire nouveau mot de passe depuis magic link | Public (token) |

**Navigation** :
- Header : logo Savr / nom prestataire / menu profil (avatar → paramètres / déconnexion)
- Menu principal latéral (desktop) ou hamburger (mobile) :
  - Accueil (E1)
  - Collectes (E2)
  - Parc → sous-menu Chauffeurs (E5) / Véhicules (E7)
  - Revenus (E9)
  - Factures (E10)
- E3 accessible depuis E1 ou E2 (clic sur ligne collecte)
- E4 accessible depuis E3 (clic bouton "Assigner" après acceptation)
- E6/E8 modales ou pages full depuis E5/E7

**Responsive** :
- Desktop : layout 2 colonnes (menu latéral + contenu)
- Mobile : menu hamburger + stack vertical + bottom bar pour actions critiques (accept/refuse)
- Tablette : hybride (menu collapsible)

---

## 4. Cycle de vie d'une collecte côté M03

```
[Ops Savr dispatche M02]
        │
        ▼
  attribuee_en_attente_acceptation
        │
   ┌────┴─────┐
   │          │                              [alerte 2 rejets consécutifs
   ▼          ▼                               si même prestataire re-dispatché]
acceptee  rejetee_par_prestataire
   │          │
   │          ▼
   │    [Ops Savr re-dispatche manuellement]
   │
   ▼
[manager assigne chauffeur + véhicule avant début tournée]
   │
   ▼
  en_attente_execution
   │
   ▼
[chauffeur M05 prend la main]
```

> **Transition supprimée (revue sobriété 2026-04-29)** : `attribuee_en_attente_acceptation → a_attribuer` via SLA dépassé. Plus de cron expiration, plus de retour auto vers Ops. Ops surveille manuellement via M02 E1 Zone 2 et override W5 si traîne.

**États intermédiaires côté M03** :
- `attribuee_en_attente_acceptation` : Ops a dispatché, manager doit accepter/refuser (pas de délai contractuel système V1)
- `acceptee` : manager a accepté, assignation chauffeur/véhicule en attente
- `en_attente_execution` : chauffeur/véhicule assignés, tournée ready pour M05
- `rejetee_par_prestataire` : manager a refusé avec motif
- `annulee_par_traiteur` : événement traiteur côté Plateforme, manager ne peut rien faire (juste constater)

Statuts complets alignés §04 TMS `collectes_tms.statut_dispatch` (enum 6 valeurs — propagation A1 2026-04-25 : `a_attribuer`, `attribuee_en_attente_acceptation`, `acceptee`, `en_attente_execution`, `rejetee_par_prestataire`, `annulee_par_traiteur`).

---

## 5. Écran par écran

### E1 — Accueil / Dashboard

**Objectif** : vue synthétique à l'arrivée, focus sur l'action immédiate.

**Layout** (3 blocs verticaux) :

**Bloc 1 — Collectes en attente d'action** (priorité haute)
- Liste des collectes `attribuee_en_attente_acceptation` triées par **`heure_collecte` croissante** (plus proche en haut)
- Pour chaque collecte : lieu, date + `heure_collecte`, lead time, indicateur urgence (rouge si `heure_collecte` < 2h, orange < 4h), boutons rapides `Accepter` / `Refuser` (ouvre modale de confirmation) / `Voir détails` (→ E3)
- Si aucune collecte en attente : "Tout est à jour" + dernière collecte acceptée

**Bloc 2 — Tournées à assigner**
- Collectes `acceptee` sans chauffeur/véhicule assignés
- Alerte visuelle si H-24 de la tournée
- Clic → E4 Assignation

**Bloc 3 — KPI mois courant** (résumé seul, pas drill-down ici)
- Nombre de collectes effectuées mois courant
- Revenu estimé mois courant (lu depuis M07 via API interne)
- Lien "Voir le détail" → E9

**États** :
- Chargement : skeleton 3 blocs
- Vide : "Bienvenue, pas encore de collecte attribuée"
- Erreur : message + bouton "Réessayer"

**Actions rapides** :
- Accepter (modale confirmation "Vous acceptez la collecte X pour le [date] ?")
- Refuser (modale + champ motif obligatoire)

---

### E2 — Liste collectes

**Objectif** : vue exhaustive des collectes du prestataire avec recherche/filtre.

**Layout** :
- Barre de filtres (haut) : période (date picker default "30 derniers jours"), statut (multi-select), lieu (recherche autocomplete), chauffeur (optionnel)
- Table paginée (50 lignes par page) : date+heure, lieu, statut (badge coloré), chauffeur assigné, véhicule, revenu estimé
- Clic ligne → E3

**Filtres actifs sauvegardés** en localStorage pour retour ultérieur.

**Tri par défaut** : date+heure DESC (plus récent en haut)

**Actions bulk** : aucune V1 (acceptation collecte par collecte — D7)

---

### E3 — Fiche collecte

**Objectif** : détail complet d'une collecte + actions contextuelles selon statut.

**Layout** (structure en sections verticales) :

**Section 1 — Identification**
- Numéro collecte (ex `COL-2026-04789`)
- Statut (badge)
- Indicateur urgence si `attribuee_en_attente_acceptation` (`heure_collecte` dans X heures)

**Section 2 — Lieu et heure de collecte**
- Lieu (nom + adresse + picto plaque si `controle_acces_requis=true`)
- Date + `heure_collecte`
- **Informations supplémentaires concernant la collecte** (lu depuis `collectes_tms.informations_supplementaires`, ajout refonte 2026-05-06 §06.01 §2.a Plateforme — texte libre max 1000 car. saisi par le programmeur, ex: "Sonner interphone B au RDC", "Quai N°2 fermé le lundi"). Remplace l'ancien libellé "Instructions chauffeur" (orphelin, jamais relié à un champ data model V1).
- Code accès si renseigné
- Parking si renseigné

**Section 3 — Traiteur (informations limitées)**
- Nom traiteur
- Contact principal (nom + téléphone) — lu depuis `collectes_tms.contact_principal_nom` + `contact_principal_telephone` (figé au moment de la création TMS via E1, audit cohérence A2 2026-04-28)
- Contact de secours (nom + téléphone, affiché uniquement si renseigné) — lu depuis `collectes_tms.contact_secours_nom` + `contact_secours_telephone`
- **Ne voit PAS** : tarif facturé au traiteur par Savr, marge, historique traiteur, autres prestataires (RLS stricte)

**Section 4 — Tournée**
- Si rattachée à une tournée : lien vers tournée (E4)
- Si pas encore rattachée : "En attente d'assignation"
- `nb_personnes_facturation` affiché en read-only (fixé par Ops M02) — badge "Tournée à 2 personnes" si valeur = 2

**Section 5 — Revenus**
- Coût prévu : lu depuis M07 via API interne
- Détail non affiché en V1 (manager voit le total calculé par le grille tarifaire, pas le détail formule)

**Section 6 — Actions contextuelles** (selon statut)
- Statut `attribuee_en_attente_acceptation` :
  - Bouton vert `Accepter`
  - Bouton rouge `Refuser` (modale avec motif obligatoire — liste déroulante + champ libre)
- Statut `acceptee` sans chauffeur assigné :
  - Bouton bleu `Assigner chauffeur + véhicule` → E4
- Statut `en_attente_execution` :
  - Chauffeur + véhicule affichés read-only
  - Bouton `Modifier assignation` (jusqu'à début tournée — D9)
- Statut `realisee` :
  - Horodatage réel + pesées + drill-down tournée
  - Bouton `Contester / Contact Ops` → **ouvre un email pré-rempli** (réf collecte + tournée + montant calculé) vers l'adresse Ops Savr (mailto ou template serveur). Pas de formulaire structuré ni d'entité contestation en base V1 (tranché QO#4 2026-06-05 — formulaire tracé reporté V1.1).

---

### E4 — Détail tournée + assignation

**Objectif (élargi propagation revue sobriété 2026-04-29 passe 3)** : afficher la **vue tournée complète identique à E3 M04 Ops** au manager prestataire, avec restriction RLS automatique `prestataire_id = current_user.prestataire_id`. L'assignation chauffeur + véhicule (+ équipier) reste l'action principale exposée en édition. Toutes les autres sections sont en lecture seule.

**Principe** : une seule UX cible, zéro divergence Ops vs Manager. Le manager voit ses tournées exactement comme Ops Savr les voit en E3 M04, sauf qu'il ne peut éditer que la section Affectation (Section 3 dans la nomenclature M04 = Sections 2/3/4 dans la nomenclature M03 ci-dessous).

**Sections (alignement E3 M04)** :
- **Section 1 — En-tête tournée** (lecture seule) : T# + statut, fenêtre prévisionnelle + réelle, durée, coût calculé, picto plaque si `controle_acces_requis=true` + bandeau rouge associé
- **Section 2 — Collectes de la tournée** (lecture seule) : tableau enrichi M04 (Lieu, Traiteur, Heure de collecte, Nb pax, Nb rolls prévus, Distance km, Statut opérationnel, Pesées, Photos). **Pas de réordonnancement** (Ops uniquement) — manager voit l'ordre figé
- **Section 3 — Affectation chauffeur** (édition) : voir spec ci-dessous (ex-Section 2)
- **Section 4 — Affectation véhicule** (édition) : voir spec ci-dessous (ex-Section 3) — verrou plaque si `controle_acces_requis=true`
- **Section 5 — Affectation équipier** (édition conditionnelle) : voir spec ci-dessous (ex-Section 4) — visible uniquement si `nb_personnes_facturation = 2`
- **Section 6 — Géolocalisation et clôture** (lecture seule) : visible si `statut IN (en_cours, terminee)` — coords + distance + flag `cloture_hors_zone`
- **Section 7 — Coût** (lecture seule) : détail calcul R2 + grille tarifaire snapshot (pas de correction durée — Ops uniquement)
- **Section 8 — Audit** : badge "Audit disponible (Admin Savr)" sans accès — propagation revue sobriété 2026-04-29 (V2 = feed UI dédié)

**Bouton de validation principal** : `Valider l'assignation` (ex-Section 5) — submit Sections 3+4+5 simultanément. Submit déclenche UPDATE `tournees.chauffeur_id`, `vehicule_id`, `equipier_id`, transition `collectes_tms.statut_dispatch acceptee → en_attente_execution`, webhook S3 émis.

**Layout détail Sections 3-5 (édition)** :

> Note (revue sobriété 2026-04-29 passe 3) : la numérotation des sous-sections "Section 1-5" ci-dessous est la spec V1 historique du bloc édition. Elle reste valide et correspond à : Section 1 héritée = lecture seule récap tournée (déjà couvert par les Sections 1+2 du bloc parent E3-aligné en haut), Sections 2-4 héritées = édition (Affectation chauffeur/véhicule/équipier), Section 5 héritée = validation (couverte par le bouton principal en haut). Pas de réécriture spec V1, juste alignement de cadre.

**Section 1 — Récap tournée**
- Liste des collectes de la tournée (souvent 1, parfois N si tournée multi-collectes)
- Date + créneau tournée (fenêtre opérationnelle `heure_planifiee_debut`/`fin`)
- Picto plaque si au moins 1 collecte avec `controle_acces_requis=true` → **bandeau rouge "Plaque requise par traiteur : véhicule obligatoire avant tournée"**
- `nb_personnes_facturation` : 1 (chauffeur seul) ou 2 (chauffeur + équipier)

**Section 2 — Chauffeur**
- Select autocomplete depuis `chauffeurs` du prestataire (actifs seulement)
- Affichage : nom, téléphone
- Si aucun chauffeur existant : lien "Créer un chauffeur" → E6 (retour auto)
- **Obligatoire avant début tournée** (R_M03.3)

**Section 3 — Véhicule** (révisée propagation revue sobriété M05 2026-04-29 — **partiellement annulée 2026-05-01 audit cohérence inter-CDC sur le cas `controle_acces_requis=true`**)
- Select autocomplete depuis `vehicules` du prestataire (actifs seulement)
- Affichage : plaque, modèle, volume
- Si aucun véhicule existant : lien "Créer un véhicule" → E8
- **Optionnel par défaut** : le manager peut renseigner le véhicule à titre indicatif (utile pour le coût M07 / sélection capacité). La saisie plaque chauffeur terrain M05 E3 a été **supprimée V1** (arbitrage Val 2026-06-04) — il ne reste qu'**une seule plaque**, celle pré-saisie par le manager ici. Si le véhicule n'est pas renseigné et `controle_acces_requis=false`, aucune plaque n'est enregistrée pour la tournée.
- **Obligatoire si `controle_acces_requis=true`** sur au moins 1 collecte de la tournée (R_M03.4 + R_M04.CONTROLE_ACCES — restauré 2026-05-01 audit cohérence inter-CDC, **étendu 2026-05-03 refonte formulaire §06.01 Plateforme : flag unique plaque + nom chauffeur**) : le manager **doit** sélectionner un véhicule (qui porte la plaque, recopiée dans `tournees.plaque_preassignee_manager`) **ET** affecter un chauffeur (Section 2 — `tournees.chauffeur_id`, source du nom chauffeur transmis au traiteur via webhook S7) avant de valider la tournée. Trigger `validate_tournee_controle_acces` bloque la transition `tournees.statut = planifiee → acceptee` si plaque OU chauffeur_id manquant.
- **Exception A Toutes! vélo cargo** : si toutes les collectes de la tournée sont sur prestataire `integration_externe='everest'` ET véhicule type `velo_cargo` → trigger autorise la validation tournée même si une collecte a `controle_acces_requis=true` (sur le critère plaque uniquement). Affichage UI : "Vélo cargo — pas de plaque applicable, validation libre". **Le chauffeur reste obligatoire** dans tous les cas (le nom chauffeur est requis pour le contrôle d'accès même en vélo cargo).

**Section 4 — Équipier** (visible uniquement si `nb_personnes_facturation = 2`)
- Select autocomplete depuis `chauffeurs` du prestataire
- Obligatoire si valeur = 2 (car Ops a facturé 2 personnes)
- Si valeur = 1 : section masquée complètement

**Section 5 — Validation** (révisée propagation revue sobriété M05 2026-04-29 — **partiellement annulée 2026-05-01 audit cohérence inter-CDC**)
- Bouton `Valider l'assignation`
- Validation client : chauffeur obligatoire (toujours), **véhicule obligatoire si au moins 1 collecte de la tournée a `controle_acces_requis=true`** (sauf exception A Toutes! vélo cargo où la plaque est libre — le chauffeur reste obligatoire), véhicule optionnel sinon, équipier si nb=2
- Sur submit : UPDATE `tournees` côté TMS → trigger `validate_tournee_controle_acces` (R_M04.CONTROLE_ACCES) vérifie cohérence plaque + chauffeur → si OK, collecte passe `acceptee` → `en_attente_execution` + émission webhook S7 `plaque-saisie` vers Plateforme (payload enrichi 2026-05-03 : `plaque + chauffeur_nom` → alimente `tournees.plaque_immatriculation` + `tournees.chauffeur_nom`)
- **Si validation TMS rejet** (plaque OU chauffeur manquant hors exception vélo cargo) : message erreur UI "Saisir plaque (véhicule) ET chauffeur avant validation — au moins 1 collecte de la tournée requiert le contrôle d'accès (demande commercial traiteur)"

---

### E5 — Liste chauffeurs

**Objectif** : vue parc chauffeurs du prestataire.

**Layout** :
- Barre filtres : statut (actif / archivé), recherche nom/téléphone
- Bouton `+ Nouveau chauffeur` (top-right) → E6
- Table : nom, téléphone, date création, statut, actions (éditer, archiver si actif / restaurer si archivé)
- Pagination 50/page
- Clic ligne → E6 édition

**Colonnes par défaut** : Nom, Téléphone, Date création, Actif (toggle)

---

### E6 — Fiche chauffeur

**Objectif** : créer ou éditer un chauffeur (self-service complet — D10).

**Layout** (formulaire structuré) :

**Section 1 — Identité**
- Nom (required)
- Prénom (required)
- Email (required, unicité `users_tms.email`)
- Téléphone (required, format E.164)

**Section 2 — Documents (obligatoires V1)**
- Upload permis de conduire (PDF ou image, max 5Mo) — stockage Supabase Storage chiffré
- Upload CNI recto-verso (PDF ou image, max 5Mo)
- Pas d'alerte échéance V1 (cohérence décision M06 — reporté V2)
- Visibilité : manager voit ses propres uploads, Ops/Admin peut consulter pour support

**Section 3 — Compte M05**
- Toggle "Activer le compte app mobile"
- Si activé : envoi auto email invitation à l'adresse saisie, avec mot de passe temporaire + lien pour redéfinir
- Si désactivé : fiche existe dans le référentiel mais chauffeur ne peut pas se connecter à M05
- Paramètre M13 : "Template email invitation chauffeur"

**Section 4 — Actions**
- `Enregistrer` (create ou update)
- `Archiver` (soft delete) — disabled si chauffeur a tournées futures (R_M03.5)
- `Restaurer` (si archivé)

**Audit log** : chaque modification enregistre who/when/what dans `audit_logs` (§04 TMS).

---

### E7 — Liste véhicules

Identique structure E5, colonnes :
- Plaque, Modèle, Volume (m³), Actif

**Bouton** `+ Nouveau véhicule` → E8

---

### E8 — Fiche véhicule

**Objectif** : créer ou éditer un véhicule, avec option de créer un nouveau modèle si nécessaire.

**Layout** :

**Section 1 — Identification**
- Plaque immatriculation (required, format FR AB-123-CD validé regex)
- Modèle de véhicule (select depuis `types_vehicules`) — required (label UI "Modèle", la table reste `types_vehicules` côté data model — cohérence E4 Section 3)
- Si modèle inexistant dans la liste : bouton `+ Créer un nouveau modèle` → ouvre sous-modale (voir Section 2)
- Kilométrage courant (optionnel)

**Section 2 — Création modèle de véhicule (sous-modale)**
Si manager clique "+ Créer un nouveau modèle" :
- Code auto-généré depuis libellé (ex libellé "25m3 hayon frigo" → code `25m3_hayon_frigo`)
- Libellé (required)
- Volume (m³, required)
- Frigorifique (toggle)
- Hayon (toggle)
- **Catégorie Plateforme** *(ajout 2026-05-08)* : dropdown **required** parmi `velo_cargo` / `camionnette` / `fourgon` / `vul` / `poids_lourd`. Tooltip : "Détermine la compatibilité avec les contraintes de véhicule des lieux côté Plateforme. Doit refléter la taille réelle (vélo cargo < camionnette < fourgon < VUL < poids lourd). Modifiable a posteriori par Ops Savr uniquement."
- Submit → création `types_vehicules` avec `actif=true`, `valide_ops=false`, `cree_par=manager_id`, `categorie_plateforme=<choix>`
- Email auto à Ops Savr : "Nouveau modèle de véhicule créé par [prestataire] : [libellé]. Catégorie Plateforme déclarée : [categorie_plateforme]. À vérifier pour éventuel merge ou reclassification."
- Le modèle est utilisable immédiatement par le manager (pas de blocage — éviter friction)
- Ops peut merger a posteriori (décision Q11 option c) : fonction `merger_type_vehicule(type_a, type_b)` qui remappe tous les véhicules utilisant `type_a` vers `type_b`, puis désactive `type_a`. Lors du merge, **`categorie_plateforme` du type cible (`type_b`) prime** — pas de fusion de catégories, pas de conflit possible.
- Ops peut reclasser `categorie_plateforme` a posteriori via UI M13 Admin TMS (audit_log obligatoire). Conséquence : si la reclassification rend des tournées existantes incompatibles avec leurs lieux, alerte Ops V1.1 (V1 : check à la prochaine validation tournée via R_M04.COMPATIBILITE_VEHICULE_LIEU).

**Section 3 — Actions**
- Enregistrer / Archiver / Restaurer (idem E6)

---

### E9 — Dashboard revenus

**Objectif** : transparence totale sur les revenus calculés par Savr (D14).

**Layout** :

**Section 1 — KPI top (2 tuiles)**
- Revenu mois en cours (€)
- Nombre de tournées mois en cours

**Section 2 — Date picker**
- Default : mois courant (cohérent D13)
- Presets : mois précédent, 3 derniers mois, année en cours, custom
- Application au rafraîchissement KPI + tableau

**Section 3 — Tableau agrégé par tournée**
- Tri DESC par date
- Colonnes : date, lieu principal, nb collectes dans tournée, chauffeur, durée réelle, revenu calculé (€)
- Clic ligne → drill-down collectes de la tournée (modale latérale avec pesées par flux + **termes de la rémunération prestataire détaillés**, lus depuis `tournees.cout_detail` (snapshot grille figé à la clôture, R2.8) selon la formule de la grille du prestataire — tranché QO#2 2026-06-05). Exemples selon la formule (§05 R2) :
  - `vacations_paliers` (camion) : « Durée tournée 5h10 → palier 4-8h = 1 vacation × 280 € HT = 280 € » (+ heures supplémentaires si dépassement palier)
  - `grille_matricielle_zone_type_course` (A Toutes! vélo) : « Zone Paris intra × course standard = 45 € HT »
  - `forfait_km` (province) : « Forfait base 90 € + (62 km − 50 km inclus) × 0,80 €/km = 99,60 € HT »

  Transparence cohérente D14 : c'est la grille de rémunération du prestataire lui-même, aucune fuite de marge Savr ni de tarif facturé au traiteur.

**Section 4 — Export**
- Bouton `Exporter CSV` sur la période sélectionnée (colonnes tournée + collectes)
- Pas d'export PDF V1

**Source de données** : vue `v_m03_revenus_manager` définie §04 TMS (join `tournees` + `collectes_tms` + calcul formule via M07 grille tarifaire, filtrée RLS par `prestataire_id` du manager connecté)

---

### E10 — Factures

**Objectif** : dépôt facture mensuelle + historique.

**Propagation M08 2026-04-24** : alignement sur D4 zéro tolérance + D7 avoir obligatoire + D12 plusieurs factures/mois autorisées.

**Layout** :

**Section 1 — Facture en cours**
- Si M-1 pas encore uploadée : bandeau "Votre facture pour [mois M-1] est attendue avant le 15 du mois"
- Bouton `Uploader la facture` → modale upload PDF avec OCR Mistral préremplissage
- Contraintes : PDF seul, max 10Mo. OCR préremplit les champs (numéro, date, période, montants HT/TVA/TTC, lignes). Manager complète les champs required avant submit (blocage si incomplet, M08 D3).
- **Match exact obligatoire** : si `montant_ht saisi ≠ montant calculé TMS`, facture passe en statut `ecart_detecte`, pas de validation auto — Ops Savr prend la main (M08 W5/W6). Aucune tolérance (M08 D4).

**Section 2 — Historique factures**
- Tableau : numéro, date facture, période, montant facturé, montant calculé Savr, écart, statut rapprochement (statuts M08 `en_attente`, `ecart_detecte`, `rapprochement_manuel_requis`, `valide`, `regle`, `conteste`, `remplacee_par_avoir` — revue sobriété 2026-04-30 D1 : `rejetee_pour_correction` fusionné dans `conteste` + flag `conteste_apres_validation` interne ; **revue sobriété §05 2026-05-01 D1 : `rapproche_ok` fusionné dans `valide` direct (auto-validation match exact)**, badge UI manager identique pour les 2 cas "À traiter — émettre avoir + nouvelle facture")
- Clic → modale détail rapprochement (M08 E2 extrait lecture seule)

**Section 3 — Règle mensuelle**
- **Assoupli (propagation M08 2026-04-24 D12)** : plusieurs factures par mois autorisées (cycles de facturation non-calendaires). Warning UX non bloquant si 2e facture même mois : "Une facture est déjà enregistrée pour ce mois (`:numero_precedent`). Confirmer ?"
- Contrainte DB : UNIQUE `(prestataire_id, numero_facture)` — numéro en doublon refusé. Si rectification, cocher option "Cette facture rectifie une précédente" + sélecteur facture contestée (déclenche flux D7 avoir + nouveau numéro).
- **Supprimé revue sobriété §05 2026-05-01 A1** — supervision via widget M08 E0 "Factures attendues mois en cours" (relance Ops manuelle). Le manager voit son propre statut d'attente directement dans M03 E10 (badge "Facture M-1 attendue").

---

### EA1 — Login

**Layout** :
- Logo Savr
- Champ email
- Champ mot de passe (type password, toggle show/hide)
- Bouton `Se connecter`
- Lien `Mot de passe oublié ?` → EA2

**Validation** :
- Email format
- Password longueur 8 min (politique alignée §15)
- Rate limit : 5 tentatives / 15 min / IP (protection brute force)

**Erreurs** :
- Identifiants invalides (message générique sans révéler si email ou password)
- Compte désactivé (contact Admin)

---

### EA2 — Mot de passe oublié

**Layout** :
- Champ email
- Bouton `Envoyer le lien de réinitialisation`
- Après submit : "Si votre adresse existe, vous recevrez un email dans les 2 minutes."

**Flow** :
- Génère un magic link Supabase Auth (token signé, TTL 1h)
- Envoie email template (§13 TMS paramètre `template_reset_password`)
- Clic email → EA3

---

### EA3 — Réinitialisation

**Layout** :
- Nouveau mot de passe (min 8 car)
- Confirmation mot de passe
- Bouton `Valider`

**Post-submit** :
- UPDATE hash via Supabase Auth
- Redirection vers EA1 avec message "Mot de passe mis à jour, connectez-vous."
- Invalidation de toutes les sessions existantes du user (force re-login partout)

---

## 6. Workflows

### W1 — Acceptation collecte standard

1. Ops Savr dispatche collecte au prestataire via M02 → statut `attribuee_en_attente_acceptation`
2. Déclenchement notifs push web (PWA) + email manager
3. Manager ouvre portail → E1 (collecte visible bloc 1)
4. Manager clique `Accepter` → modale confirmation
5. Manager valide → UPDATE `collectes_tms.statut_dispatch` = `acceptee`, `date_acceptation` = now(), `accepted_by` = manager_id (propagation A1 2026-04-25 — colonne renommée `statut` → `statut_dispatch`, `accepted_at` → `date_acceptation`)
6. Webhook sortant **S1** `tms/collecte-acceptee` vers Plateforme (§08 existant) (propagation A2 2026-04-25 — fix ID webhook : S3 = `tournee-upsert`, S1 = `collecte-acceptee`)
7. Collecte passe en Section E1 bloc 2 "Tournées à assigner" → flux W5

**Durée UX cible** : < 10 secondes du clic à la confirmation.

---

### W2 — Refus collecte

1. Étapes 1-3 idem W1
2. Manager clique `Refuser`
3. Modale : liste motifs déroulante (`capacite_insuffisante`, `zone_non_couverte`, `vehicule_indispo`, `autre`) + champ libre (required si `autre`)
4. Submit → UPDATE `collectes_tms.statut_dispatch` = `rejetee_par_prestataire`, `date_refus`, `motif_refus`, `rejected_by` (propagation A1 2026-04-25 — colonne `statut` → `statut_dispatch`)
5. Webhook sortant **S2** `tms/collecte-refusee` vers Plateforme (§08) (propagation A2 2026-04-25 — fix ID webhook : S6 = `course-cout-calculee`, S2 = `collecte-refusee`)
6. Côté TMS, déclenchement logique **R_M03.2** : collecte repasse `a_attribuer` côté M02 dispatch Ops
7. Ops Savr voit l'alerte dispatch + motif → re-dispatche (même ou autre prestataire)
8. Si re-dispatché au **même** prestataire : si c'est le 2e refus consécutif sur cette même collecte, alerte Ops déclenchée (R_M03.2 — "Ce prestataire a déjà refusé cette collecte, confirmer ?")

---

### W3 — SLA dépassé (escalade auto) — **Supprimé (revue sobriété 2026-04-29)**

Le cron expiration SLA + retour auto `a_attribuer` + webhook S2 motif `sla_depasse` + alerte M11 sont supprimés V1. Ops surveille manuellement via M02 E1 Zone 2 les collectes `attribuee_en_attente_acceptation` qui traînent et override via M02 W5 si nécessaire.

---

### W4 — Assignation chauffeur + véhicule

1. Collecte `acceptee` sans chauffeur/véhicule → visible E1 bloc 2
2. Manager clique → E4
3. Si `controle_acces_requis=true` sur ≥ 1 collecte de la tournée : bandeau rouge + véhicule **required**
4. Si `nb_personnes_facturation = 2` : équipier **required**
5. Manager sélectionne chauffeur (+ véhicule + équipier selon contexte)
6. Submit → UPDATE `tournees.chauffeur_id`, `tournees.vehicule_id`, `tournees.equipier_id`
7. UPDATE `collectes_tms.statut_dispatch` = `en_attente_execution` + `date_assignation_execution` = now() pour toutes les collectes de la tournée (propagation A1 2026-04-25 — colonne `statut` → `statut_dispatch`)
8. Si véhicule assigné : UPDATE `tournees.plaque_immatriculation` (copie depuis `vehicules.plaque`)
9. Notification push chauffeur M05 ("Nouvelle tournée assignée le [date]")

---

### W5 — Modification assignation post-acceptation

1. Collecte `en_attente_execution`, tournée pas encore commencée
2. Manager ouvre E3 ou E4 → bouton `Modifier assignation`
3. Remplacement chauffeur OU véhicule OU les deux
4. Submit → UPDATE `tournees` avec nouvelles valeurs
5. Audit log ancienne vs nouvelle valeur
6. Si plaque change et `controle_acces_requis=true` : **notification Ops Savr** "Changement plaque sur collecte X : AB-123-CD → CD-456-EF" (dans l'attente V2 de la re-notif traiteur auto)
7. Notification M05 chauffeur (ancien perd l'accès, nouveau reçoit)
8. Bloqué automatiquement si tournée `en_cours` ou `realisee` (R_M03.4)

---

### W6 — Alerte oubli assignation

1. Scheduled job quotidien à 6h analyse les tournées du jour+1 (H-24)
2. Pour toute tournée `en_attente_execution` **sans** chauffeur OU sans véhicule si `controle_acces_requis=true` :
   - Notif manager (push + email)
3. À H-12 (job 18h la veille) : si toujours incomplet → **email + push Ops Savr** (escalade)
4. Paramétrable M13 : `alerte_oubli_assignation_h24` + `alerte_oubli_assignation_h12_ops`

---

### W7 — Création chauffeur self-service (simplifié revue sobriété §05 2026-05-01 B1)

1. Manager → E5 → `+ Nouveau chauffeur`
2. Saisie identité + upload docs obligatoires (permis + CNI)
3. Si toggle "Activer compte M05" ON : saisie email chauffeur
4. Submit → INSERT `chauffeurs` + si activé `users_tms` (rôle `chauffeur`, **sans password initial** — Supabase Auth user créé sans `encrypted_password`) + envoi email invitation **"Définir mon mot de passe"** avec **magic link 30 min** (template `chauffeur_bienvenue` reformaté V1 = magic link uniquement, pas de password en clair)
5. Chauffeur reçoit email, clique → EA3 page définition password (≥ 8 car) → connexion M05 OK
6. Si magic link expiré (>30 min) → manager peut renvoyer un nouveau lien depuis E5 fiche chauffeur (bouton "Renvoyer lien d'activation")

**Suppressions B1** : génération password temporaire côté serveur, transmission password en clair par email, flag `users_tms.must_change_password` (devenu inutile : le magic link force la création du password à la 1ère connexion).

---

### W8 — Création véhicule + éventuel type véhicule

1. Manager → E7 → `+ Nouveau véhicule`
2. Saisie plaque + sélection type existant OU clic `+ Créer un type`
3. Si création type : sous-modale → soumission → INSERT `types_vehicules` (`valide_ops=false`) + email Ops
4. Retour form véhicule avec nouveau type présélectionné
5. Submit → INSERT `vehicules` (FK `type_vehicule_id`)

---

### W9 — Archivage chauffeur

1. Manager → E6 → bouton `Archiver`
2. Vérification : `SELECT COUNT(*) FROM tournees WHERE chauffeur_id = :id AND heure_planifiee_debut >= now()` (alignement nom colonne TMS — propagation 2026-04-29)
3. Si count > 0 : bloqué avec message "Ce chauffeur est assigné à N tournée(s) future(s). Réassignez-les avant archivage."
4. Si count = 0 : UPDATE `chauffeurs.archived_at` = now()
5. Chauffeur n'apparaît plus dans les selects E4
6. Compte M05 désactivé (révocation session + flag `active=false` sur `users_tms`)
7. Restore possible via bouton `Restaurer` sur E6 (E5 filtre archivés)

---

### W10 — Upload facture mensuelle (refonte propagation M08 2026-04-24 D3/D4/D12)

1. Manager → E10 → bouton `Uploader la facture`
2. Upload PDF (max 10Mo). OCR Mistral déclenché synchrone (< 30s timeout).
3. OCR préremplit : numéro, date facture, période (debut/fin), montants HT/TVA/TTC, lignes détaillées si détectées.
4. Manager complète/corrige les champs required (blocage submit si incomplet, M08 D3). Option "Cette facture rectifie une précédente" + sélecteur facture contestée (déclenche flux avoir D7).
5. Validation côté serveur :
   - Contrainte UNIQUE `(prestataire_id, numero_facture)` (D12). Si doublon → erreur "Ce numéro existe déjà. Si c'est une rectification, cochez l'option correspondante."
   - `periode_debut ≤ periode_fin` et `date_facture ≤ aujourd'hui`
   - `montant_ht + montant_tva = montant_ttc` ± 0,01€
6. INSERT `factures_prestataires` (statut `en_attente`, `source_upload = 'manager_m03'`)
7. **Trigger DB `trg_m08_rapprocher` synchrone** (M08 W3) :
   - Calcul `montant_ht_calcule_tms` agrégé sur tournées période
   - Match exact (zéro tolérance M08 D4 + revue sobriété §05 2026-05-01 D1) : `valide` (auto match exact) OU `ecart_detecte` OU `rapprochement_manuel_requis` si tournées sans coût
8. Notification Ops + Admin TMS (N1/N2/N3 selon résultat rapprochement)
9. Manager voit la facture dans l'historique avec statut. Si `ecart_detecte` : message "Votre facture présente un écart avec notre calcul, nos équipes vont revenir vers vous rapidement."

---

### W11 — Drill-down dashboard revenus

1. Manager → E9 → clic ligne tournée
2. Ouvre modale latérale
3. Charge détail via vue `v_m03_revenus_detail(tournee_id)` :
   - Collectes de la tournée
   - Pesées par flux
   - **Termes de la rémunération prestataire** lus depuis `tournees.cout_detail` (snapshot grille figé à la clôture, R2.8) : libellé de la formule de la grille + valeurs des facteurs ayant produit le montant, pas l'expression SQL brute. Le contenu dépend de la formule de la grille du prestataire (§05 R2) : `vacations_paliers` → palier + nb vacations × tarif vacation (+ heures sup) ; `grille_matricielle_zone[_type_course]` → cellule zone × type ; `forfait_km`/`forfait_fixe` → forfait base + km supplémentaires. **Pas de poids de déchet ni d'équivalent repas** dans le calcul de rémunération (tranché QO#2 2026-06-05). Les pesées restent affichées séparément (info opérationnelle, sans lien avec le montant payé)
4. Manager peut `Contester` une ligne → **email pré-rempli vers Ops Savr** (réf collecte/tournée + montant). Pas de formulaire structuré V1 (tranché QO#4 2026-06-05, cohérent E3 Section 6)

---

### W12 — Login quotidien manager

1. Manager → `portail.tms.gosavr.io` → EA1
2. Saisie email + password
3. Supabase Auth vérifie hash (argon2 natif)
4. Si OK : création session JWT (TTL 30j rolling — D3), redirection E1
5. Si session déjà active : redirection directe E1 (bypass login)
6. Rate limit 5 tentatives / 15 min / IP (§15)

---

## 7. Edge cases

### EC1 — Collecte annulée par traiteur avant acceptation

- Plateforme émet WH `collecte-annulee` (E6 §08)
- TMS met `statut_dispatch` = `annulee_par_traiteur` immédiatement (propagation A1 2026-04-25)
- Manager voit E1 : la collecte disparaît du bloc "en attente" (ou affichée grisée "Annulée") avant qu'il n'agisse
- Pas de pénalité, pas d'alerte

### EC2 — Acceptation simultanée par 2 managers du même prestataire

- Scénario : Manager A et Manager B ouvrent E3 en même temps, cliquent `Accepter` à 500ms d'intervalle
- Lock optimiste : `UPDATE collectes_tms SET statut_dispatch = 'acceptee' WHERE id = :id AND statut_dispatch = 'attribuee_en_attente_acceptation' RETURNING *` (propagation A1 2026-04-25 — colonne `statut` → `statut_dispatch`)
- Le premier qui commit gagne, le second reçoit error "Cette collecte vient d'être acceptée par un collègue."

### EC3 — Manager tente d'accepter une collecte déjà reprise par Ops

- Manager ouvre E3 avec cache client ancien → clique `Accepter`
- Serveur : statut actuel en DB = `a_attribuer` (Ops a fait override W5 dans l'intervalle — revue sobriété 2026-04-29 : remplace l'ancien cas SLA dépassé)
- Retour 409 Conflict : "Cette collecte a été reprise par les équipes Ops, elle n'est plus disponible."

### EC4 — Refus collecte avec motif `autre` sans champ libre

- Validation client : champ libre required si motif = `autre`
- Validation serveur (double sécurité) : NOT NULL constraint sur `rejected_reason_free_text` si `rejected_reason = 'autre'`

### EC5 — Assignation chauffeur dans un autre prestataire (tentative RLS bypass)

- Attaquant manipule l'API pour assigner chauffeur_id d'un autre prestataire
- RLS policy refuse : chauffeurs filtrés `WHERE prestataire_id = auth.prestataire_id()`
- Tentative donne "Chauffeur introuvable" (pas de leak d'info)

### EC6 — Chauffeur avec permis expiré

- **V1** : pas de contrôle automatique (décision M06 — retrait alertes docs)
- Manager responsable juridiquement
- V2 : scan OCR permis → extraction date échéance → alerte 30j avant

### EC7 — Véhicule assigné change de plaque en cours de tournée (remplacement panne)

- Chauffeur panne à la collecte 2/5 → appelle manager → manager swap véhicule via M03 W5
- Si `controle_acces_requis=true` : manager change → notif Ops Savr
- M05 chauffeur reçoit notif push → nouvelle plaque mise à jour
- **V2** : re-notif traiteur auto (reporté Q8.3)

### EC8 — Facture uploadée avec écart vs calcul Savr (refonte propagation M08 2026-04-24 D4/D5)

- **Retiré V1 (propagation M08 D5 pas de paliers)**
- **Zéro tolérance** : tout écart (même 0,01€) → INSERT `factures_prestataires` avec `statut_rapprochement = 'ecart_detecte'`
- Alerte Ops + Admin (N3) → Ops prend la main (validation manuelle W5 avec motif ≥ 30 car OU contestation W6 avec avoir demandé au prestataire)
- Manager notifié "Votre facture présente un écart avec notre calcul, nos équipes vont revenir vers vous rapidement."
- Alerte Admin automatique si Ops valide manuellement un écart > `m08.seuil_alerte_validation_manuelle_ht` (default 100€, N13)

### EC9 — Manager archive un chauffeur puis le restaure le lendemain

- Archive W9 → session révoquée
- Restaure → UPDATE `archived_at = NULL` + `active = true`
- Chauffeur doit redemander mot de passe (session pas restaurée automatiquement)
- Audit log garde trace archivage + restauration

### EC10 — Prestataire fin de contrat avec collectes futures assignées

- Workflow fin de contrat (§06 M06)
- V1 simple : Admin TMS désactive le prestataire J+30, Ops re-dispatche toutes les collectes futures avant désactivation, portail manager devient inaccessible à J+30
- Alerte 30j/15j/7j/1j avant côté Ops (§06 M06)

### EC11 — Manager oublie mot de passe + email de reset bloqué par spam

- Manager tente 5 fois login KO → rate limit 15min
- Magic link reset bloqué par filtre antispam côté prestataire
- Fallback : Admin TMS peut forcer un reset depuis M06 (bouton "Envoyer un nouveau lien magic link") ou saisir manuellement un nouveau mot de passe temporaire pour le manager

### EC12 — Type véhicule créé par manager avec libellé quasi-identique à un existant

- Ex : existant `20m3_hayon`, manager crée `20m3 avec hayon`
- Pas de détection auto V1 (tolérance doublons)
- Ops reçoit l'email notif → décide : merger (fonction `merger_type_vehicule`) ou garder distinct (si vraie différence technique)

### EC13 — Token reset password expiré

- Token TTL 1h (Supabase Auth défaut)
- Clic sur lien après 1h → redirection EA2 avec message "Lien expiré, demandez un nouveau lien."

### EC14 — Manager assigne le MÊME chauffeur sur 2 tournées chevauchantes

- Validation côté serveur : `SELECT COUNT(*) FROM tournees WHERE chauffeur_id = :id AND (heure_planifiee_debut, heure_planifiee_fin) OVERLAPS (:debut, :fin)`
- Si count > 0 : erreur "Ce chauffeur est déjà assigné à la tournée Y dont la fenêtre opérationnelle chevauche celle-ci"
- Même logique pour véhicule
- **Note propagation 2026-04-29** : la collision se calcule sur la **fenêtre tournée** (`heure_planifiee_debut/fin`), pas sur l'`heure_collecte` (point fixe par collecte). Une fenêtre tournée agrège plusieurs heures de collecte avec un tampon.

---

## 8. Architecture technique

### Stack frontend

- **Next.js 15** (App Router, RSC où pertinent, Server Actions pour mutations)
- **Sous-domaine** `portail.tms.gosavr.io` (dédié M03, distinct de `tms.gosavr.io` Ops/Admin)
- **PWA installable** (icône home screen mobile, offline minimal pour E1 consultation uniquement, acceptation nécessite connexion)
- **Composants partagés monorepo** (voir §07) : design system Savr, composants auth, client API

### Stack backend

- **Supabase** : 1 projet, schéma `tms` (cohérent atelier 2026-04-23)
- **Auth** : Supabase Auth natif, provider email+password, hash argon2 géré Supabase
- **API internes** : Server Actions Next.js + endpoints API Routes pour opérations critiques (acceptation, assignation)
- **Webhooks sortants** : pas de webhook propre à M03, utilise les webhooks existants de M01/M02 (`tms/collecte-acceptee` S1, `tms/collecte-refusee` S2) — voir §08 (propagation A2 2026-04-25)

### Stockage

- **Supabase Storage** : docs chauffeurs (permis, CNI) — chiffré at rest, RLS `prestataire_id` (docs véhicules retirés revue sobriété M03 passe 2 — carte grise + assurance supprimés V1)
- **Cloudflare R2** : factures PDF prestataires (volumes plus importants, coût stockage optimisé) — cohérent atelier 2026-04-23

### RLS policies clés

- `collectes_tms` : SELECT si `prestataire_id = auth.prestataire_id()`, UPDATE uniquement sur transitions `statut_dispatch` autorisées : `attribuee_en_attente_acceptation` → `acceptee` ou `rejetee_par_prestataire`, et `acceptee` → `en_attente_execution` (post-assignation chauffeur+véhicule via E4) (propagation A1 2026-04-25 — colonne `statut` → `statut_dispatch` + transitions explicites 6 valeurs)
- `tournees` : SELECT/UPDATE si `prestataire_id = auth.prestataire_id()` et statut NOT IN (`en_cours`, `realisee`)
- `chauffeurs`, `vehicules` : CRUD full si `prestataire_id = auth.prestataire_id()`
- `types_vehicules` : SELECT global, INSERT si rôle `manager_prestataire` OR `ops_savr` OR `admin_tms`, UPDATE/DELETE (désactivation) réservé Ops/Admin
- `factures_prestataires` : SELECT/INSERT si `prestataire_id = auth.prestataire_id()`, UPDATE bloqué (immuable après upload, Ops/Admin pour litige)

### Sessions et auth

- JWT Supabase Auth, TTL 30j rolling
- Multi-device autorisé (D2) : pas de device binding côté M03 (vs M05 chauffeur qui binde)
- Cookie HTTP-only secure sur `portail.tms.gosavr.io`
- Rate limit global : 5 login / 15min / IP, 100 req / min / user authentifié

### Performance

- p95 E1 chargement < 1.5s (alignement §14 Scalabilité)
- Pagination 50 items par page (E2, E5, E7, E10)
- Cache RSC 60s sur E1 KPI (invalidé sur mutation collecte)

---

## 9. Dépendances cross-module

| Module | Nature | Détail |
|--------|--------|--------|
| M01 Réception ordres | Amont | Fournit les collectes entrantes (WH E1 Plateforme→TMS), puis M02 |
| M02 Dispatch Ops Savr | Amont | Dispatche collecte au prestataire → statut `attribuee_en_attente_acceptation` visible M03 |
| M04 Gestion tournées | Aval | M03 alimente `tournees` (assignation chauffeur/véhicule), M04 affiche vue Ops |
| M05 App mobile chauffeur | Aval | Chauffeur créé par M03 reçoit identifiants M05, exécute tournée assignée par M03 |
| M06 Référentiel prestataires | Lecture | Manager = `users_tms` rattaché à `shared.prestataires` (FK `prestataire_id`), config grilles tarifaires depuis M06 Admin TMS |
| M07 Pilotage financier | Lecture | Dashboard revenus E9 lit vue `v_m03_revenus_manager` calculée depuis M07 formules |
| M08 Facturation | Aval | Upload facture E10 déclenche rapprochement M08 |
| M11 Alerting | Amont | Génère alertes oubli assignation H-12, écart facture, 2 rejets consécutifs (escalade SLA supprimée revue sobriété 2026-04-29) |
| M13 Administration TMS | Config | ~10 paramètres M13 consommés par M03 (alertes, templates emails — paramètres SLA supprimés revue sobriété 2026-04-29) |

---

## 10. Contrat API (impacts)

### Webhooks sortants réutilisés (§08 existant)

- **S1 `tms/collecte-acceptee`** : émis sur acceptation manager (W1) (propagation A2 2026-04-25)
- **S2 `tms/collecte-refusee`** : émis sur refus manager (W2) uniquement (propagation A2 2026-04-25). Motif `sla_depasse` supprimé V1 (revue sobriété 2026-04-29 — W3 SLA expiration auto retiré).
- **S7 `tms/plaque-saisie`** : si manager assigne véhicule → plaque copiée dans `tournees.plaque_immatriculation` → déclenche S7 vers Plateforme (comportement existant §08)

### Webhooks entrants consommés (§08 existant)

- **E1 `collecte-creee`** : **impact** — payload enrichi avec `controle_acces_requis BOOLEAN` (voir propagation §08)
- **E6 `collecte-annulee`** : si manager est en train d'accepter, passage immédiat `annulee_par_traiteur`

### Pas de nouveau endpoint externe V1

M03 consomme les webhooks existants et n'ajoute pas de nouvelle intégration Plateforme↔TMS.

### Endpoints internes TMS (Server Actions / API Routes)

- `POST /api/m03/collectes/:id/accept` : acceptation collecte
- `POST /api/m03/collectes/:id/reject` : refus avec motif
- `POST /api/m03/tournees/:id/assign` : assignation chauffeur/véhicule/équipier
- `PATCH /api/m03/tournees/:id/assign` : modification assignation
- `POST /api/m03/chauffeurs` : création
- `PATCH /api/m03/chauffeurs/:id` : édition
- `POST /api/m03/chauffeurs/:id/archive` : archivage
- `POST /api/m03/vehicules` : création
- `POST /api/m03/types-vehicules` : création type (avec `valide_ops=false`)
- `POST /api/m03/factures` : upload PDF + montant

Tous endpoints protégés par middleware JWT + RLS `prestataire_id` + rate limit.

---

## 11. Règles métier R_M03.x

> **Réconciliation 2026-05-02 (audit cohérence inter-CDC — dette intra-TMS R_M03.X)** : la liste des règles `R_M03.x` est désormais **source de vérité unique dans [[../05 - Règles métier TMS#R8 — Portail prestataire self-service (M03) — règles métier (propagation 2026-04-24)|§05 — R8]]**. La duplication §06 M03 ↔ §05 a été supprimée pour éliminer la divergence de numérotation (§06 utilisait une numérotation locale incohérente avec §05 qui est référencée par tous les autres modules : §03, §04, §08, §12, §15). Les 2 règles spécifiques §06 M03 (Fenêtre de modification assignation, Blocage archivage chauffeur avec tournées futures) ont été consolidées dans §05 sous **R_M03.11** et **R_M03.12** respectivement.

**Catalogue R_M03.x après réconciliation (10 règles actives + 1 supprimée)** :

| # | Règle | Source §05 |
|---|-------|------------|
| R_M03.1 | Authentification manager + chauffeur (email + password, min 8 car) | [[../05 - Règles métier TMS#R_M03.1 — Authentification manager + chauffeur : email + password, min 8 caractères (D1, D24)\|§05 R_M03.1]] |
| R_M03.3 | Alerte 2 refus consécutifs (warning M11) | [[../05 - Règles métier TMS#R_M03.3 — Alerte 2 refus consécutifs (D5)\|§05 R_M03.3]] |
| R_M03.4 | Plaque conditionnelle niveau lieu avec override collecte (+ trigger R_M04.CONTROLE_ACCES) | [[../05 - Règles métier TMS#R_M03.4|§05 R_M03.4]] |
| R_M03.5 | Multi-device illimité manager, 1 device actif chauffeur | [[../05 - Règles métier TMS#R_M03.5 — Multi-device illimité manager, 1 device actif chauffeur\|§05 R_M03.5]] |
| R_M03.6 | Session JWT 30 jours rolling | [[../05 - Règles métier TMS#R_M03.6|§05 R_M03.6]] |
| R_M03.7 | Création chauffeur par manager (magic link 30 min) | [[../05 - Règles métier TMS#R_M03.7|§05 R_M03.7]] |
| R_M03.8 | Création véhicule + type véhicule par manager (valide_ops=false) | [[../05 - Règles métier TMS#R_M03.8 — Création véhicule + type véhicule par manager (D11 option c validée Val)\|§05 R_M03.8]] |
| R_M03.9 | Facture 1/mois prestataire (upload manager + lock collectes M-1 + supervision Ops manuelle) | [[../05 - Règles métier TMS#R_M03.9|§05 R_M03.9]] |
| R_M03.10 | Dashboard revenus lecture seule par manager | [[../05 - Règles métier TMS#R_M03.10 — Dashboard revenus lecture seule par manager (D13)\|§05 R_M03.10]] |
| R_M03.11 | Fenêtre de modification assignation (manager modifie jusqu'à début tournée) | [[../05 - Règles métier TMS#R_M03.11|§05 R_M03.11]] |
| R_M03.12 | Blocage archivage chauffeur avec tournées futures | [[../05 - Règles métier TMS#R_M03.12|§05 R_M03.12]] |

**Note pour Claude Code** : ne pas redéfinir les règles ici. Toute modification doit être faite dans §05. Cette section §06 M03 ne contient qu'un index de mapping pour faciliter la lecture du module.

**Mapping ancien → nouveau (pour traçabilité refs historiques)** :
- ex-§06 R_M03.1 () = §05 R_M03.2 () — même suppression
- ex-§06 R_M03.2 (Escalade refus) = §05 R_M03.3 (Alerte 2 refus consécutifs)
- ex-§06 R_M03.3 (Assignation véhicule) = §05 R_M03.4 (Plaque conditionnelle) + R_M04.CONTROLE_ACCES
- ex-§06 R_M03.4 (Fenêtre modif) = §05 **R_M03.11** (nouveau)
- ex-§06 R_M03.5 (Blocage archivage chauffeur) = §05 **R_M03.12** (nouveau)
- ex-§06 R_M03.6 (Création modèle véhicule) = §05 R_M03.8 (Création véhicule + type)
- ex-§06 R_M03.7 (Facture mensuelle strict) = §05 R_M03.9 (Facture 1/mois)
- ex-§06 R_M03.8 (Alerte 2 rejets) = §05 R_M03.3 (doublon interne §06 supprimé — même règle que ex-R_M03.2)
- ex-§06 R_M03.9 (Lock collectes post-facture) = §05 R_M03.9 (intégré dans Facture 1/mois)
- ex-§06 R_M03.10 (Session et auth) = §05 R_M03.1 (Auth) + §05 R_M03.6 (Session JWT)

---

## 12. Paramètres M13

| Clé | Type | Default V1 | Usage |
|-----|------|-----------|-------|
| `m03.alerte_oubli_assignation_h24` | boolean | `true` | W6 step 2 |
| `m03.alerte_oubli_assignation_h12_ops` | boolean | `true` | W6 step 3 |
| `m03.template_email_invitation_chauffeur` | text | template fourni | W7 step 4 |
| `m03.template_email_reset_password` | text | template fourni | EA2 |
| `m03.template_email_facture_uploadee_ops` | text | template fourni | W10 step 6 |
| `m03.facture_max_taille_mo` | integer | `10` | W10 upload |

---

## 13. Décisions structurantes (D1-D16)

| # | Décision | Source Q | Rationale |
|---|----------|----------|-----------|
| D1 | Auth **email + password** unifiée manager + chauffeur (M03 + M05). Politique 8 car min, pas de complexité imposée, reset via magic link fallback | Q1 Val 2026-04-24 | Simplicité, 1 seule techno auth à coder, chauffeurs peuvent noter password (vs magic link dépendant accès email terrain). Ops/Admin restent SSO Google (§09 inchangé) |
| D2 | **Multi-device illimité** pour manager (pas de binding, vs M05 chauffeur bindé 1 device) | Q2 | Manager utilise bureau + mobile, binding = friction inutile |
| D3 | Session JWT **30j rolling** | Q3 | Usage épisodique, forcer re-login = friction |
| D4 | **Rôle unique** `manager_prestataire` (pas de split dispatcher/admin_facturation V1) | Q4 | 90% prestataires TPE, split = complexité RLS pour besoin marginal |
| D5 | → **Pas de SLA système V1** (revue sobriété 2026-04-29). Supervision manuelle Ops via M02 E1 Zone 2 | Q5 | Cron expiration + paramètres + alerte M11 + webhook motif `sla_depasse` = surface de bug pour valeur faible. Ops récupère manuellement les collectes qui traînent |
| D6 | **Escalade Ops manuelle** sur refus uniquement. Re-dispatch possible même prestataire + alerte si 2 rejets consécutifs (revue sobriété 2026-04-29 — escalade SLA auto retirée) | Q6 | Réactivité conservée sur refus, expiration auto retirée |
| D7 | **Acceptation collecte par collecte** (pas en masse par tournée proposée) | Q7 | Maximise taux d'acceptation (prestataire peut accepter 3/5 si capacité insuffisante) |
| D8 | **Plaque conditionnelle** : `controle_acces_requis` toggle niveau lieu (défaut, cohérent sécurité site) OU override par collecte. Si true → assignation véhicule obligatoire M03 pré-dispatch. Sinon → chauffeur saisit plaque M05 début tournée | Q8 + Q8.1(c) + Q8.2(b) + Q8.3(a) + Q8.4 | Répond au cas d'usage enceinte sécurisée traiteur. Communication traiteur V1 = dashboard seul (email V2). Changement plaque post-acceptation notif Ops (pas traiteur V1) |
| D9 | **Modification assignation** manager jusqu'à début tournée | Q9 | Pannes et remplacements dernière minute fréquents |
| D10 | **Chauffeurs self-service complet** manager (CRUD) | Q10 | Turn-over prestataire élevé, goulot Ops insoutenable. RLS + docs obligatoires |
| D11 | **Véhicules self-service** manager + création type véhicule libre avec validation Ops différée (merge possible a posteriori) | Q11(c) | Éviter blocage manager, tolérer doublons, Ops nettoie via `merger_type_vehicule` |
| D12 | **Archivage chauffeur par manager** (soft delete) | Q12 | Cohérence CRUD self-service. Blocage si tournées futures (R_M03.5) |
| D13 | **Dashboard libre** avec default mois courant | Q13 | Flexibilité, coût serveur nul |
| D14 | **Revenus agrégés par tournée + drill-down** collectes/pesées au clic | Q14 | Lisibilité top-level + transparence drill-down pour contestation |
| D15 | **Assoupli propagation M08 2026-04-24 D12** : plusieurs factures/mois autorisées (cycles facturation non-calendaires prestataires). Warning UX non bloquant uniquement. **Rappel le 5 + élévation criticité le 15** (revue sobriété 2026-04-30 B5 — paramètres `m08.rappel_upload_jour_mois` / `m08.escalade_upload_jour_mois`, fusion alerte M11 `m08_rappel_facture` warning → critical, plus 2 codes distincts). | Q15 | Flexibilité cycles facturation prestataires, contrainte DB = UNIQUE `(prestataire_id, numero_facture)` |
| D16 | **Notifications email + push web** (pas de SMS V1) | Q16 | Push couvre urgence, email trace archivable, SMS coût évitable |

---

## 14. Questions ouvertes

1. **Seed initial types véhicules** : Val a donné 4 types (`20m3 hayon`, `16m3`, `6m3`, `Vélo cargo frigo`). À enrichir avec les types réellement utilisés par Strike/Marathon/A Toutes! actuels (migration MTS-1).
2. — **TRANCHÉ QO#2 2026-06-05 : termes de la rémunération prestataire détaillés**, lus depuis `tournees.cout_detail` (snapshot grille figé à la clôture, R2.8) selon la formule de la grille du prestataire (§05 R2 : vacations_paliers / matricielle zone / forfait km|fixe). Le coût prestataire = sa grille de rémunération (vacations, forfait, cellule zone), **PAS le poids de déchet ni l'équivalent repas**. Les pesées sont affichées séparément (info opérationnelle). Transparence cohérente D14, pas de fuite de marge. Voir E9 Section 3 + W11 step 3.
3. **Template emails et notifications push** : rédaction finale à valider (V1 suffit templates génériques, affinage post-UX test).
4. — **TRANCHÉ QO#4 2026-06-05 : email pré-rempli vers Ops** (réf collecte/tournée + montant), pas de formulaire structuré ni d'entité contestation en base V1. Formulaire tracé reporté V1.1. Voir E3 Section 6 + W11 step 4.
5. **Cumul rôle manager + chauffeur** : un gérant qui conduit parfois. V1 = interdit (alignement §09 "cumul ops+manager interdit"). À élargir V2 si demande prestataire.
6. — **TRANCHÉ QO#6 2026-06-05 : tous les managers du prestataire reçoivent les notifs** push + email (simplicité, pas de dispatcher désigné V1). Réintroduction d'un dispatcher unique si bruit constaté. Voir §2 Cas multi-managers.

---

## 15. Propagations CDC

### §04 Data Model TMS

- Table **`types_vehicules`** (déjà définie §04) — pas de colonne `ptac_kg` (retirée revue sobriété M03 passe 2 2026-04-29). Colonnes pertinentes M03 : `code`, `libelle`, `volume_m3_standard`, `frigorifique`, `hayon`, `actif`, `valide_ops`, `cree_par`, **`categorie_plateforme`** *(ajout 2026-05-08, NOT NULL, enum `velo_cargo/camionnette/fourgon/vul/poids_lourd`)*. Seed V1 : `camion_20m3_hayon` (poids_lourd), `camion_16m3` (vul), `camion_6m3` (fourgon), `velo_cargo_frigo` (velo_cargo).
- Suppression colonne **`vehicules.carte_grise_url`** (retirée revue sobriété M03 passe 2 2026-04-29 — docs véhicule supprimés V1 cohérence E8). Suppression aussi du bucket Supabase Storage `docs-vehicules` si défini en §07.
- Nouvelle colonne `tms.collectes_tms.controle_acces_requis boolean DEFAULT false`
- Table `factures_prestataires` : **définition source unique = §04 Data Model TMS** (`numero_facture` NOT NULL, `periode_debut`/`periode_fin`, `date_facture`, `montant_ht`, `statut_rapprochement`, UNIQUE `(numero_facture, prestataire_id)` WHERE `deleted_at IS NULL`, plusieurs factures/mois autorisées — M08 D12).
- Fonction SQL `merger_type_vehicule(type_a_id uuid, type_b_id uuid)` : remap FK + désactivation source
- Vues matérialisées ou vues simples : `v_m03_revenus_manager`, `v_m03_revenus_detail(tournee_id)`

### §04 Data Model Plateforme

- Nouvelle colonne `plateforme.lieux.controle_acces_requis_default boolean DEFAULT false`
- Nouvelle colonne `plateforme.collectes.controle_acces_requis boolean DEFAULT lieux.controle_acces_requis_default` (override possible par collecte)

### §06 Plateforme — Programmation collecte

Addendum à rédiger : ajouter toggle `controle_acces_requis` au formulaire de programmation collecte (client traiteur), alimenté par default depuis le profil lieu, surchargeable.

### §06 Plateforme — Dashboard client traiteur

Addendum : bloc "Véhicule qui viendra" affiché uniquement si `controle_acces_requis=true` et plaque connue (depuis webhook S7 `plaque-saisie`).

### §08 Contrat API

- **E1 `collecte-creee`** : payload enrichi `controle_acces_requis BOOLEAN` (propagé depuis `plateforme.collectes.controle_acces_requis`)
- Pas de nouveau webhook M03 (S1/S2/S7 existants suffisent — propagation A2 2026-04-25)

### §09 Auth TMS

Addendum : bloc **email+password** pour rôles `manager_prestataire` + `chauffeur` (vs SSO Google Ops/Admin + magic link M05 V0) :
- Politique 8 car min, pas de complexité imposée
- Hash argon2 géré Supabase Auth natif
- Reset via magic link email Supabase Auth (TTL 1h)
- Rate limit 5 login / 15min / IP
- Sessions JWT TTL 30j rolling manager, TTL inchangé M05 chauffeur (30j déjà défini M05)

### §06 M05 — App mobile chauffeur

Addendum : remplacement flux magic link par email+password. Écrans EA1/EA2/EA3 similaires M03 côté mobile. Plaque véhicule éditable avec warning si pré-assignée (cohérence décision Val 2026-04-24).

### §06 M04 — Gestion tournées

Addendum : règle de validation pré-dispatch M05 :
- Si ≥ 1 collecte tournée avec `controle_acces_requis=true` et `tournees.vehicule_id IS NULL` → blocage alerte manager (H-24) + escalade Ops (H-12)

### §05 Règles métier TMS

Source unique des règles **R_M03.1 à R_M03.12** (cf. §05 — la section 11 ci-dessus réconcilie le mapping ancien → nouveau). Ne pas redéfinir les règles dans §06 M03.

### §15 Sécurité

Addendum : politique password manager + chauffeur (cohérence D1), doublure hash + rate limit déjà définis.

### §03 Périmètre fonctionnel

Ligne M03 : statut "pré-spec" → "V1 rédigée 2026-04-24".

### §00 Index

Row 6 `06 - Fonctionnalités détaillées TMS` : ajouter M03 V1 rédigée 2026-04-24.

---

## 15bis. Alertes M11 émises par M03 (propagation M11 2026-04-24)

> **Normatif (R_M11.1)** : tous les triggers M03 utilisent `tms.alerte_emit(code, ...)` avec codes canoniques catalogue.

| Code canonique | Criticité | Trigger M03 | Scope |
|----------------|-----------|-------------|-------|
| `m03_prestataire_refus_consecutifs` | warning | 2 refus consécutifs prestataire en 7j (R_M03.3) | Ops |
| `m03_plaque_manquante_dispatch` | critical | Plaque requise + non pré-saisie au dispatch (R_M03.4) | Ops + manager |
| `m03_type_vehicule_a_valider` | warning | Manager crée nouveau type véhicule (R_M03.8) | Ops + Admin TMS |
| `m03_login_rate_limit_depasse` | warning | 5 tentatives login échouées sur 15 min (propagation auth) | Admin TMS |
| `m03_facture_rejetee` | warning | Facture manager rejetée par rapprochement (consommé par M08 aussi) | Manager + Ops |

**Résolution auto W7** : `m03_type_vehicule_a_valider` résolue auto dès validation ou merge Ops. `m03_plaque_manquante_dispatch` résolue auto dès saisie plaque.

> **Code supprimé (revue sobriété 2026-04-29)** : `m03_sla_acceptation_expire` — SLA acceptation supprimé V1.

**Scope manager prestataire** (R_M11.8) : `m03_prestataire_refus_consecutifs` et `m03_plaque_manquante_dispatch` incluent `manager_prestataire_scope='entity'` → le manager concerné reçoit l'alerte dans sa zone Notifications M03 E1 bandeau.

---

## 16. Liens

- [[01 - Vision et objectifs TMS]]
- [[03 - Périmètre fonctionnel TMS]]
- [[04 - Data Model TMS]]
- [[05 - Règles métier TMS]]
- [[07 - Architecture technique TMS]]
- [[08 - Contrat API Plateforme-TMS]]
- [[09 - Authentification et permissions TMS]]
- [[15 - Sécurité et conformité TMS]]
- [[M01 - Réception ordres de collecte]]
- [[M02 - Dispatch Ops Savr]]
- [[M04 - Gestion des tournées]]
- [[M05 - App mobile chauffeur]]
- [[M06 - Référentiel prestataires]]
- [[M07 - Pilotage financier logistique]]
- [[M12 - Attribution transporteur]]
- [[01 - Cahier des charges App/04 - Data Model]] (propagation `lieux.controle_acces_requis_default` + `collectes.controle_acces_requis`)
- [[01 - Cahier des charges App/08 - APIs et intégrations]] (E1 enrichi)
