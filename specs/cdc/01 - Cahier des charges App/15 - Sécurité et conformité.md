# 15 - Sécurité et conformité

**Statut** : Validé V1
**Dernière mise à jour** : 2026-04-20

---

## 1. Hébergement et localisation des données

### Région Supabase

**Région retenue : `eu-west-3` (Paris)**. Même tarif que les autres régions EU. Toutes les données (DB, Storage, Auth) sont hébergées physiquement en France — conformité RGPD sans dérogation ni mécanisme de transfert international.

### Autres services

| Service | Hébergement | Conformité |
|---|---|---|
| Supabase | AWS `eu-west-3` (Paris) | ✓ EU |
| Railway | AWS / GCP (région EU configurable) | ✓ EU à configurer au déploiement |
| Resend | Cloudflare (global, données EU en EU) | ✓ EU |

**Action à la mise en production** : vérifier que Railway est configuré en région EU avant le premier déploiement prod.

---

## 2. Sécurité applicative

### 2.1 Authentification

- JWT session : durée **1h**, refresh token **30 jours**
- Mots de passe : 10 caractères min, 1 majuscule, 1 chiffre, 1 caractère spécial — hashés bcrypt par Supabase Auth (jamais stockés en clair)
- Email de vérification obligatoire à la création de compte
- **2FA** : hors scope V1, à activer en V1.1 (Supabase Auth le supporte nativement)
- **SSO SAML** : architecture anticipée en V1, activable V2 sans migration

### 2.2 Autorisation — RLS

Row Level Security activé sur **toutes les tables sans exception**. Aucune donnée n'est accessible sans politique explicite. Le principe par défaut est `DENY ALL` — toute permission est une exception documentée.

Politiques RLS par profil : voir [[09 - Authentification et permissions]].

### 2.3 Impersonation Admin Savr

L'Admin Savr peut se connecter à la place d'un utilisateur pour résoudre un incident ou vérifier un problème. Contraintes de sécurité :

- Bandeau orange permanent visible à l'écran pendant toute la session impersonée
- Chaque action réalisée en mode impersonation est loggée dans `audit_log` avec `impersonator_id` distinct de `user_id`
- L'utilisateur impersoné peut voir dans son historique que son compte a été accédé (page "Sécurité du compte")

### 2.4 Gestion des secrets

Voir [[07 - Architecture technique]] section 6 pour l'inventaire complet. Principes :

- Aucun secret dans le code ou le repo GitHub
- Rotation des clés API sensibles tous les 6 mois
- `SUPABASE_SERVICE_ROLE_KEY` utilisable uniquement dans les Edge Functions, jamais exposée côté frontend
- Fichiers `.env.local` gitignorés, jamais commités

### 2.5 Sécurité des webhooks entrants

Tous les webhooks entrants (`api.gosavr.io/webhooks/*`) sont validés par signature HMAC avant traitement. Un webhook sans signature valide retourne 401 et est ignoré. Cela protège contre les appels frauduleux se faisant passer pour le TMS ou Everest.

### 2.6 Protection contre les abus à l'onboarding

L'onboarding étant 100% automatisé en V1, les contrôles suivants limitent les risques :

- **Validation SIRET** via API INSEE/Sirene : le SIRET doit exister et correspondre à une entreprise active
- **Validation TVA intracom** via API VIES (UE) : si applicable
- **Détection de doublons** : si un SIRET ou un domaine email est déjà rattaché à une organisation existante, l'inscription est bloquée avec message explicite
- **Rate limiting** sur le formulaire d'inscription : max 5 tentatives/IP/heure. **V1 = limiteur in-memory best-effort** (par instance serverless, non distribué — décision Val 2026-06-22) — suffisant comme filet anti-abus. Le quota distribué (strict global toutes instances) = V1.1/archi, sans Redis ni table DB (mécanisme à trancher avec Val le moment venu).
- **Admin Savr peut désactiver** tout compte a posteriori si comportement anormal détecté
- **Domaines email publics/jetables non rattachables** *(validé revue dev senior (frère) 2026-06-08)* : un domaine **public** (gmail, outlook, hotmail, yahoo, free, orange, etc.) ou **jetable** (**source figée 2026-06-10, challenge onboarding** : package npm **`disposable-email-domains`** vendorisé dans le repo — pas de fetch runtime — MAJ de la liste à chaque release ; liste des domaines publics maintenue en **seed DB** éditable Admin) n'est **jamais** utilisé comme clé de rattachement automatique à une organisation existante (cf. règle §09 « domaine reconnu → `traiteur_commercial` »). Un inscrit sur un domaine public crée toujours une organisation isolée et n'hérite d'aucun accès à une orga préexistante partageant ce domaine ; un domaine jetable est refusé à l'inscription. Sans ce garde-fou, deux entités sans lien partageant `gmail.com` seraient fusionnées par rattachement automatique (usurpation d'accès).
- **Dégradation gracieuse si INSEE/VIES indisponible** *(validé revue dev senior (frère) 2026-06-08)* : si l'API INSEE/Sirene ou VIES est injoignable (timeout > 3 s, 5xx) au moment de l'inscription, celle-ci **n'est pas bloquée** — le compte est créé avec un marqueur de vérification `en_attente` — **matérialisé 2026-06-10 (challenge onboarding)** : colonnes `entites_facturation.siret_verification` (`en_attente`/`verifie`/`echec`) + `siret_verifie_le` + `tva_verification` (`en_attente`/`verifie`/`echec`/`non_applicable`) + `tva_verifiee_le` (cf. [[04 - Data Model#Table : `entites_facturation`]]) — un job asynchrone re-tente la validation (3 paliers : 15 min / 1 h / 24 h) et l'Admin voit le flag dans le filtre « nouvelles organisations » du back-office. **Gating tranché (Val 2026-06-10)** : la **facturation est conditionnée au seul `siret_verification = 'verifie'`** (cf. [[05 - Règles métier]] §8 étape 3) ; la TVA VIES **n'est pas bloquante** (`en_attente`/`echec` = alerte Admin in-app seule — VIES trop instable pour conditionner du cash). Distinction des cas : INSEE **répond** « SIRET inexistant/inactif » = erreur bloquante de saisie côté formulaire (l'utilisateur corrige) ; INSEE **injoignable** = passage `en_attente` sans blocage. Ne jamais hard-bloquer l'inscription sur une API tierce down.

---

## 3. Conformité RGPD

### 3.1 Base légale du traitement

Savr traite des données personnelles (noms, emails, téléphones des contacts traiteurs, chauffeurs, contacts événementiels) sur la base :

- **Exécution du contrat** : données nécessaires à la prestation de collecte (contact sur site, coordinateur)
- **Intérêt légitime** : historique des collectes, logs d'audit, amélioration du service
- **Obligation légale** : conservation des documents comptables et registres déchets (10 ans / 5 ans)

### 3.2 Données collectées et leur usage

| Catégorie | Données | Base légale | Rétention |
|---|---|---|---|
| Compte utilisateur | Nom, prénom, email, téléphone, mot de passe hashé | Contrat | Durée du compte + 3 ans |
| Organisation | Raison sociale, SIRET, TVA, adresse facturation | Contrat | Durée relation commerciale + 10 ans (comptable) |
| Événements & collectes | Date, lieu, pax, pesées, photos | Contrat + Obligation légale | 10 ans (bordereaux) / 5 ans (registre déchets) |
| Contacts événementiels | Nom, téléphone (contact sur site) | Intérêt légitime | Durée de l'événement + 1 an |
| Logs d'audit | Actions utilisateur, impersonations | Intérêt légitime (sécurité) | 5 ans (obligation comptable, cf. §07/06 §4) |

### 3.3 Droits des utilisateurs

Tous les droits RGPD sont exercés via :
- **Interface self-service** : modification des données personnelles depuis l'espace compte
- **Demande de suppression** : formulaire dans l'espace compte → validation Admin Savr sous 48h ouvrées

| Droit | Implémentation V1 |
|---|---|
| Accès | Export des données personnelles disponible depuis l'espace compte (JSON) |
| Rectification | Modification directe depuis le profil utilisateur |
| Suppression | Soft delete (défaut) ou hard delete / anonymisation PII sur demande RGPD explicite |
| Opposition | Désactivation des emails non transactionnels (hors scope V1 — pas d'emails marketing) |
| Portabilité | Export JSON des données personnelles |

**Contrainte légale sur la suppression** : les données comptables (factures, bordereaux) et les registres réglementaires ne peuvent pas être supprimés avant l'échéance légale, même sur demande RGPD. Seules les données personnelles identifiantes (nom, email, téléphone) sont anonymisées.

### 3.4 Politique de confidentialité

Un document "Politique de confidentialité" doit être rédigé et publié avant le go-live. Il documente : les données collectées, leur usage, la durée de conservation, les sous-traitants, les droits des utilisateurs et le contact DPO (ou contact RGPD si pas de DPO désigné).

**Format** : page web accessible sans authentification + lien dans le footer de l'app et dans les emails transactionnels.

**À faire avant go-live** : rédiger ce document (hors scope CDC technique, à déléguer à un juriste ou rédiger avec l'aide de Claude).

---

## 4. Sous-traitants — DPA

### Principe

Supabase, Railway et Resend traitent des données personnelles pour le compte de Savr. Le RGPD impose un accord de traitement des données (DPA — Data Processing Agreement) signé avec chaque sous-traitant. Sans DPA, Savr est en non-conformité formelle — risque aggravé en cas d'incident.

### DPAs à signer avant go-live

| Fournisseur | DPA disponible | Procédure |
|---|---|---|
| Supabase | Oui — disponible dans le dashboard (Settings → Legal) | Acceptation en ligne, ~5 min |
| Railway | Oui — disponible sur demande via railway.app/legal | Email à legal@railway.app ou formulaire |
| Resend | Oui — inclus dans les CGU Enterprise ou sur demande | Formulaire sur resend.com/legal |

**Prérequis go-live** : les 3 DPAs doivent être signés et archivés avant la mise en production avec des clients réels.

### Registre des sous-traitants

À maintenir à jour par l'Admin Savr (document séparé, hors CDC). Contenu minimum : nom du sous-traitant, pays d'hébergement, nature des données traitées, base légale, lien DPA.

---

## 5. Sécurité des documents réglementaires

### Watermark et intégrité des PDFs

- **Watermark** "Document officiel Savr" sur tous les PDFs réglementaires (bordereaux, attestations, rapports)
- **QR code de vérification** : page publique permettant de valider l'authenticité d'un document par son numéro de série → prévu V1.1

### Conservation des PDFs

Les PDFs sont stockés dans Supabase Storage avec accès RLS. Un PDF de bordereau ou d'attestation ne peut pas être supprimé par un utilisateur client — uniquement par l'Admin Savr. Les URLs de Storage sont signées (expiration 1h pour les téléchargements directs). **Liens de partage public horodatés (URL permanente 90 jours) reportés V1.1** (revue sobriété §12 2026-06-03, A1) — V1 : pas d'URL publique permanente, le `traiteur_manager` télécharge et transmet le PDF lui-même.

### Audit log

Toutes les actions sensibles sont tracées dans `audit_log` :
- Connexions et déconnexions
- Impersonations (avec `impersonator_id`)
- Régénérations de documents
- Modifications de pesées post-clôture
- Modifications des paramètres algo
- Suppressions ou désactivations de comptes
- Envois vers Pennylane

Rétention : 5 ans (obligation comptable, cf. §07/06 §4). Non modifiable par les utilisateurs, y compris Admin Savr.

---

## 6. Conformité réglementaire métier

### REP Emballages / Citeo

- Validation du référencement Savr comme prestataire collecte attendue début mai 2026
- **Posture V1** : collecter et structurer les données (pesées par flux, équivalent roll) sans survendre l'éligibilité avant validation officielle
- **Export REP V1.1** : déclaration des volumes d'emballages collectés par collecte en format Citeo — voir [[12 - Reporting et exports]]
- Veolia = prestataire direct Savr ET référencé Citeo (maillon de traçabilité clé)

### Registre déchets (Code de l'environnement)

- Obligation légale de conservation minimum 5 ans
- Module 20 (Registre réglementaire) implémenté en V1 : registre chronologique interne, accessible RLS, pas d'intégration Trackdéchets V1
- En cas d'audit : renvoi vers Veolia comme source de vérité exutoire + bordereaux Savr comme pièces justificatives

### Attestations fiscales (2041-GE)

- Mention fiscale uniquement si l'association bénéficiaire est habilitée 2041-GE-SD au moment de la génération
- Si une association perd son habilitation après génération d'attestations : les attestations passées restent valides (snapshot). Les futures attestations passent en format non fiscal.
- Alerte Admin Savr si une association perd son habilitation (`audit_log` + notification email)

---

## 7. Plan de continuité (sécurité opérationnelle)

Voir [[07 - Architecture technique]] section 7 pour le détail complet des scénarios de panne. Points de sécurité spécifiques :

- **Rollback** en < 5 min via revert Git si déploiement défaillant
- **Better Uptime** : alerte SMS en < 3 min si plateforme hors ligne (critique pendant les opérations nocturnes 22h-3h)
- **Supabase Pro** : backups quotidiens automatiques, restauration < 30 min si corruption DB
- **Pas de single point of failure** : chaque brique (Supabase, Railway, Resend) est remplaçable indépendamment

---

## Checklist go-live sécurité et conformité

Actions obligatoires avant mise en production avec clients réels :

- [ ] Supabase configuré en région `eu-west-3` (Paris)
- [ ] Railway configuré en région EU
- [ ] DPA Supabase signé (dashboard Settings → Legal)
- [ ] DPA Railway signé
- [ ] DPA Resend signé
- [ ] DPA Pennylane signé
- [ ] **Confirmation écrite Pennylane : statut certification PDP + date activation** — bloquant absolu si clients ETI/GE (Viparis, Lenôtre, Potel & Chabot) avant sept 2026 (2026-04-28)
- [ ] Test bout en bout Pennylane sandbox : émission Savr → API v2 → Factur-X → PPF DGFiP
- [ ] Politique de confidentialité rédigée et publiée (page web + lien footer)
- [ ] Mentions légales publiées
- [ ] CGU rédigées et publiées (Draft V1 disponible — voir [[CGU Savr V1 - Draft]])
- [ ] Watermark activé sur tous les PDFs
- [ ] Rate limiting activé sur le formulaire d'inscription
- [ ] Validation SIRET (INSEE) opérationnelle
- [ ] Validation TVA intracom (VIES) opérationnelle
- [ ] Webhooks entrants validés par signature HMAC
- [ ] Rotation initiale de toutes les clés API documentée dans le registre des secrets

---

## Décisions prises

| Décision | Alternative écartée | Raison |
|---|---|---|
| Supabase région Paris (`eu-west-3`) | Frankfurt, autres régions EU | Même tarif, hébergement France, conformité RGPD maximale |
| DPAs à signer avant go-live | Couverture par CGU fournisseurs | Non-conformité formelle RGPD sans DPA. Risque aggravé en cas d'incident. Procédure simple (30 min max). |
| `DENY ALL` par défaut sur RLS | Permissions larges restreintes au besoin | Toute permission non documentée = accès refusé. Principe de moindre privilège. |
| Audit log non modifiable | Modifiable par Admin | Intégrité de la traçabilité — un Admin ne doit pas pouvoir effacer ses propres actions |
| 2FA hors scope V1 | 2FA V1 | Supabase Auth le supporte nativement — activable V1.1 en 1 ligne de config |
| Soft delete par défaut | Hard delete immédiat | Permet de corriger une erreur de suppression dans les 48h. Hard delete sur demande RGPD explicite uniquement |
| Registre déchets sans Trackdéchets V1 | Intégration Trackdéchets V1 | Complexité disproportionnée en V1. Renvoi Veolia en cas d'audit. Trackdéchets V2 si requis réglementairement. |

## Questions ouvertes

- Trackdéchets : surveiller l'évolution réglementaire — pourrait devenir obligatoire avant V2

**Clôturé** : CGU V1 rédigées suffisent pour le go-live. Politique de confidentialité à rédiger en parallèle du dev, non bloquante. (2026-04-28)
**Clôturé** : CGU V1 Draft couvre le périmètre V1. Non bloquant go-live. (2026-04-28)

## Liens

- [[07 - Architecture technique]]
- [[09 - Authentification et permissions]]
- [[12 - Reporting et exports]]
- [[05 - Règles métier]]
- [[13 - Migration depuis Bubble]]
