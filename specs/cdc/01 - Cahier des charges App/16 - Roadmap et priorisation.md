# 16 - Roadmap et priorisation


---

## Principe directeur

L'objectif immédiat est un go-live V1 **dans les semaines à venir**. Le développement se fait en sprints intensifs avec Claude Code jusqu'à une V1 fonctionnelle, puis en itérations continues à raison de quelques heures par semaine.

Le facteur limitant n'est pas la capacité de développement (Claude Code peut coder vite) mais **le rythme de validation de Val** entre chaque sprint. Chaque phase se termine par une validation fonctionnelle avant de passer à la suivante.

---

## Ordre de développement V1

### Phase 1 — Fondations infra (1 semaine)

Aucune feature utilisateur — uniquement l'infrastructure qui fait tenir tout le reste.

- Setup projet Supabase prod + dev (région Paris `eu-west-3`)
- Setup Railway (Puppeteer, région EU)
- Setup Resend (domaine d'envoi, DNS)
- Repo GitHub + pipeline CI/CD GitHub Actions (tests bloquants)
- Migrations initiales : toutes les tables du data model + index + RLS DENY ALL
- Seed de données dev (5 orgas, 20 événements, tous les rôles)
- Variables d'environnement configurées sur tous les services

**Jalon** : Claude Code peut se connecter à Supabase, la DB est peuplée avec le seed, le pipeline CI/CD tourne sans erreur.

---

### Phase 2 — Authentification et onboarding (3-5 jours)

- Login / logout / refresh token
- Formulaire d'inscription self-service (validation SIRET INSEE + TVA VIES + CGV)
- Rattachement automatique à une organisation existante (matching domaine email)
- Emails transactionnels : bienvenue + vérification email (via Resend)
- Politiques RLS par rôle (admin_savr, traiteur_manager, traiteur_commercial, agence, gestionnaire_lieux, client_organisateur)
- Gestion du profil utilisateur (modification données perso, suppression compte)

**Jalon** : Val peut créer un compte traiteur, se connecter, et voir un dashboard vide.

---

### Phase 3 — Back-office Admin Savr (1 semaine)

Le back-office Admin est la colonne vertébrale opérationnelle. À construire avant l'espace client pour que Savr puisse gérer les données manuellement pendant les phases de test.

- CRUD organisations (création, modification, désactivation)
- CRUD utilisateurs (invitation, modification de rôle, impersonation)
- CRUD lieux (référentiel, validation des lieux soumis manuellement)
- CRUD événements + collectes (saisie manuelle + modification)
- Vue liste collectes avec statuts, filtres, et actions rapides
- Dashboard Admin : collectes programmées, en cours, incidents, acceptance TMS
- Gestion packs Anti-Gaspi (création, suivi crédits)
- Gestion brouillons factures (validation avant envoi Pennylane)
- Gestion paramètres algo (seuils pesées, pondération AG)

**Jalon** : Val peut créer une organisation, un utilisateur, un lieu, et programmer manuellement une collecte depuis le back-office.

---

### Phase 4 — Formulaire de programmation de collecte (3-5 jours)

Le use case central de la plateforme — ce que fait le traiteur commercial au quotidien.

- Formulaire 3 étapes : événement (nom client, logo, date, pax, type) → lieu/contacts → récap
- Autocomplétion lieux (référentiel) + saisie manuelle si hors référentiel
- Autocomplétion contacts traiteurs
- Gestion collecte ZD + AG sur le même événement (**formulaire unique événement-centré** — choix ☐ZD ☐AG en étape 1, rattachement explicite `evenement_id`, refonte 2026-05-21) + date événement distincte de date collecte *(multi-camions retiré du périmètre App 2026-05-25 — devenu interne TMS, Sujet 1 option A)*
- Calcul automatique tarif ZD selon pax + tarifs préférentiels gestionnaire
- Vérification pack AG disponible (blocage si épuisé)
- Email de confirmation programmation

**Jalon** : un traiteur commercial peut programmer une collecte ZD et/ou AG depuis son espace client. Val valide le parcours complet de programmation.

---

### Phase 5 — Intégrations TMS et gestion des statuts (1 semaine)

Sans cette phase, les collectes restent bloquées au statut `programmee` pour toujours.

- Envoi ordre de collecte au TMS Savr (`POST /collectes`)
- Réception webhooks TMS entrants (collecte-acceptee, collecte-refusee, collecte-en-cours, collecte-terminee, tournee-upsert, plaque-saisie, incident, collecte-rejetee) — **Supprimés revue sobriété §08 Bloc A 2026-05-01 A2+A3** : remplacés par lecture cross-schema directe via vues `plateforme.v_courses_logistiques` + `plateforme.v_stocks_rolls`.
- Mise à jour automatique des statuts collecte selon webhooks TMS
- **Retiré V1 (propagation Q10 M05 2026-04-24)** — scheduler + template + trigger email supprimés
- Alerte pesées anormales (email Admin si hors plage min/max)
- **Supprimé revue sobriété §08 Bloc A 2026-05-01 A4** — retry 3 paliers (Bloc B B1) + dédup `integrations_inbox` couvrent les pannes <24h, intervention manuelle au-delà
- Affichage statuts TMS acceptance dans le back-office Admin

**Jalon** : une collecte programmée depuis la Plateforme est reçue par le TMS, son statut évolue via webhooks, Val voit les mises à jour en temps réel.

---

### Phase 6 — Génération PDF (3-5 jours)

- Setup Railway Puppeteer + file d'attente `jobs_pdf`
- Template PDF bordereau de pesée ZD
- Template PDF rapport de recyclage ZD (avec logo client organisateur)
- Template PDF attestation de don AG (avec/sans mention fiscale 2041-GE)
- Batch cron J+1 à 6h (bordereaux + rapports + attestations)
- Embargo H+24 sur rapport de recyclage
- Alerte pesées anormales déclenchée avant le batch
- Stockage PDFs dans Cloudflare R2 (buckets dédiés, URLs pré-signées)
- Accès PDFs depuis back-office Admin

**Jalon** : une collecte réalisée déclenche la génération automatique des 3 documents au batch J+1. Val vérifie le rendu PDF.

---

### Phase 7 — Intégration Pennylane (3-5 jours)

- Création brouillon facture ZD (mode par collecte + mode mensuel groupé)
- Création brouillon facture AG (par collecte ou achat pack)
- Envoi vers Pennylane API v2 après validation Admin
- Gestion des avoirs
- Numérotation séquentielle des documents

**Jalon** : une collecte clôturée génère un brouillon facture, l'Admin le valide, il apparaît dans Pennylane.

---

### Phase 8 — Espace client traiteur (1 semaine)

Les dashboards traiteur_manager et traiteur_commercial.

- Dashboard manager : KPIs AG/ZD, calendrier collectes, liste événements, taux de recyclage *(ZD uniquement, formule à captation par filière cf. [[05 - Règles métier#R_taux_recyclage]])*
- Dashboard commercial : mes collectes, accès lecture factures
- Accès PDFs (bordereaux, rapports, attestations) + régénération manuelle
- Picto ⟳ si rapport régénéré
- Exports CSV (collectes, événements, pesées, factures)
- **reporté V1.1** (revue sobriété §12 2026-06-03, A1) — V1 : le manager télécharge le PDF et le transmet par email

**Jalon** : un traiteur manager peut voir l'historique de ses collectes, télécharger ses documents, et exporter ses données.

---

### Phase 9 — Profils secondaires (1 semaine)

- Dashboard gestionnaire de lieux (KPIs multi-lieux, filtres, drill-down)
- Dashboard agence
- Dashboard client organisateur (RSE, impact, accès rapports)
- Tarifs préférentiels par gestionnaire (saisie + application automatique)

**Jalon** : Val se connecte avec un profil gestionnaire de lieux et voit uniquement les données des lieux qui lui sont rattachés.

---

### Phase 10 — Algo AG + envoi au TMS (3-5 jours)

- Algorithme AG : recommandation top 3 associations et transporteurs
- Affichage résultat algo AG dans back-office Admin
- Validation/modification attribution par Admin
- Auto-accept par combinaison (association + type événement)
- Envoi de l'ordre de collecte au Savr TMS (webhook Plateforme → TMS). Le TMS se charge de transmettre à Everest pour A Toutes!. La spécification de l'intégration Everest est dans le CDC TMS.

**Jalon** : une collecte AG programmée déclenche l'algo, l'Admin voit les 3 associations recommandées et peut valider, l'ordre est transmis au Savr TMS pour exécution logistique.

---

### Phase 11 — Migration Bubble et go-live (1-2 semaines)

- Script de migration : ~1 500 collectes AG + ~175 collectes ZD (historique complet)
- Migration référentiel lieux depuis Bubble
- Migration organisations et utilisateurs
- Test parallèle Bubble + Nouvelle Plateforme (2-4 semaines)
- Email pré-migration 15 jours avant bascule clients
- Bascule DNS (`app.gosavr.io`)
- Go-live

**Jalon** : Val valide la migration sur un échantillon de données. Période de test parallèle confirmée sans régression.

---

## Estimation globale

| Phase | Durée estimée |
|---|---|
| Phase 1 — Fondations | ~1 semaine |
| Phase 2 — Auth + onboarding | ~3-5 jours |
| Phase 3 — Back-office Admin | ~1 semaine |
| Phase 4 — Formulaire programmation | ~3-5 jours |
| Phase 5 — Intégrations TMS | ~1 semaine |
| Phase 6 — Génération PDF | ~3-5 jours |
| Phase 7 — Pennylane | ~3-5 jours |
| Phase 8 — Espace client traiteur | ~1 semaine |
| Phase 9 — Profils secondaires | ~1 semaine |
| Phase 10 — Everest + algo AG | ~3-5 jours |
| Phase 11 — Migration + go-live | ~1-2 semaines |
| **Total** | **~8-11 semaines** |

L'estimation dépend du rythme de validation de Val entre chaque sprint. En sprints intensifs sans délai de validation, le bas de la fourchette (8 semaines) est atteignable.

**Pas de raccourci** : toutes les phases (1 à 11) sont obligatoires pour le go-live. Les profils secondaires (gestionnaire lieux, client organisateur) et Everest restent en V1. Estimation retenue : **8-11 semaines**.

---

## Scope V1 — Ce qui est dans la version initiale

- Tous les modules documentés dans les sections 01 à 15
- 6 profils utilisateur (admin_savr, traiteur_manager, traiteur_commercial, agence, gestionnaire_lieux, client_organisateur)
- Intégrations : TMS Savr, Pennylane v2, Everest (A Toutes!), Resend
- PDFs : bordereau ZD, rapport de recyclage, attestation de don AG
- Exports CSV pour tous les profils
- Migration complète depuis Bubble (historique intégral)

---

## Scope V1.1 — Post go-live, itérations rapides

Fonctionnalités activables sans refonte d'architecture, en quelques heures ou jours chacune :

- **2FA** (Supabase Auth, 1 ligne de config)
- **Staging environment** (si frère reviewer rejoint la boucle)
- **QR code vérification PDF** (page publique de validation)
- **Export REP Emballages / Citeo** (requête SQL sur données déjà collectées)
- **Magic link** (connexion sans mot de passe, Supabase Auth)
- **Envoi facture automatique** sans validation Admin (une fois process stabilisé)
- **Alerte pack AG** visible aussi côté traiteur_manager (aujourd'hui Admin Savr uniquement)
- **Notifications in-app** (cloche, badge)
- **Dark mode** (tokens CSS déjà structurés)

---

## Scope V2 — Évolutions majeures

Nécessitent un sprint dédié ou un nouveau module :

- **Module 19 — Impact enrichi** : parsing IA des briefs événement, calcul empreinte carbone complète. Déclenché par recrutement chargé projet environnemental.
- **Benchmark sectoriel** : tableaux de bord comparatifs inter-clients (données déjà collectées en V1, UI à construire)
- **SSO SAML** : connexion via Active Directory / Google Workspace (archi déjà anticipée V1)
- **Automatisation facturation complète** : génération + envoi sans validation Admin
- **Trackdéchets** : intégration registre déchets national (si obligation réglementaire)
- **Déploiement multi-régions** : Lyon, Bordeaux, Marseille (data model déjà agnostique)
- **Module scoring prestataires** : historique de fiabilité Strike / Marathon (données à collecter dès V1)

---

## Hors scope (ne sera pas développé)

- Application mobile native (pas de React Native — l'app responsive suffit)
- Module e-commerce (vente de packs en self-service sans Admin)
- Intégration ERP traiteur (type Caterease, Eurest)
- Marketplace prestataires logistiques
- Module RH (planning équipes terrain)

---

## Règles de priorisation pour les arbitrages futurs

Quand une nouvelle demande de feature arrive, l'évaluer selon ces 3 critères dans l'ordre :

1. **Est-ce bloquant pour une collecte ?** → Si oui, priorité maximale (sprint suivant)
2. **Réduit-il une friction opérationnelle quotidienne ?** → Si oui, V1.1 rapide
3. **Crée-t-il de la valeur différenciante perçue par le client ?** → Si oui, planifier en V2

Tout le reste peut attendre ou être écarté.

---

## Décisions prises

| Décision | Raison |
|---|---|
| Go-live rapide (semaines) sans attendre Viparis | Viparis = montée progressive janvier 2027. L'app peut être déployée et stabilisée avant. |
| Sprints intensifs jusqu'à V1, puis itérations continues | Rythme choisi par Val. Permet une V1 en 8-11 semaines. |
| Phases 9-10 potentiellement décalées post go-live | Accélère le go-live si seuls les profils traiteur sont nécessaires au lancement. |
| Historique complet Bubble obligatoire avant go-live | Décision actée section 13. Pas de go-live sans migration intégrale. |
| Pas d'app mobile native | Responsive classique suffisant pour les usages identifiés. |

## Questions ouvertes

- Quels profils sont strictement nécessaires au go-live ? (Si gestionnaire lieux et client organisateur peuvent attendre → go-live phase 8, ~6-7 semaines)
- Décider si Everest (phase 10) est bloquant pour le go-live ou activable en V1.1

## Liens

- [[01 - Vision et objectifs]]
- [[13 - Migration depuis Bubble]]
- [[07 - Architecture technique]]
- [[14 - Scalabilité et évolutivité]]
- [[15 - Sécurité et conformité]]
