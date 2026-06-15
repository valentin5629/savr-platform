# M05 — App mobile chauffeur (PWA offline-first)

**Statut** : V1 rédigée (session 2026-04-24 — 20 décisions structurantes tranchées + D25 force change password ajoutée 2026-04-27 propagation §12) + revue sobriété 2026-04-29 (E2/E3/E4/E5 simplifiés) + revue sobriété 2026-04-30 (E6/E7/E9)
**Persona principal** : Chauffeur prestataire (Strike, Marathon, A Toutes!) — 30+ profils terrain à V1
**Contexte d'usage** : smartphone personnel ou pro (Android Chrome 100+ Android 10+ / iOS Safari 16.4+ — propagation §12 D2 2026-04-27), conditions terrain dégradées (4G faible, sous-sols parking, extérieur soleil, mains chargées)
**Dernière mise à jour** : 2026-06-04 (**Revue de sobriété M05 (skill `cdc-review-sobriete`)** — relancée après la suppression saisie plaque terrain. **Bloc C cohérence/refs mortes** : C1 S6 `course-cout-calculee` fantôme purgé (cycle de vie §4, W9 step 5, M08 cross-module → trigger DB `fn_recalc_marge_tournee()` ex-S6 §08 A2) ; C2 résidus S7 « sortant M05 » nettoyés (en-tête Cohérence CDC + §1 Objectif → S3/S5/S9, S7 émis par M03) ; C3 présélection contenant/flux purgée (R_M05.3 réécrite sans présélection, **R_M05.4 repurposée « Présélection » → « Override manuel tare » pour réaligner la numérotation sur §05**, W5 steps 2-3, Q11) ; C4 widget géoloc M11 fantôme purgé (E5/W4/C3/D5/Q1 → audit_log `M05_ARRIVEE_GEOLOC_FALLBACK` seul, **+ §11 Dashboards L234 nettoyé**) ; C5 `auth_sessions` → `auth_sessions_tms` (§15.1 + RLS + Liens) ; C6 « 14 règles » corrigé + réf orpheline R_M05.16 → §8.4/C8/D1. **Bloc D** : D1 S9 « enum 12 valeurs » → 6. **Bloc B simplifications** : B1 alerte `m05_checklist_contournement_detecte` critical → **warning** (E3 ne gate plus que tenue/rolls/film depuis retrait plaque) ; B2 badge persistant « modifiée » + tracking `dernière_visualisation_chauffeur` retirés (push suffit) ; B3 kill switch 2 booléens → **enum `m05_force_update_mode` `off|soft|hard`** (supprime état invalide). Cross-fichiers : §11 Dashboards, §04, §12, M13. Cross-CDC 0. Voir mémoire `project_revue_sobriete_m05_tms_2026_06_04`.) / 2026-06-04 (propagation suppression saisie plaque terrain — arbitrage Val : retrait item Plaque checklist E3, skip E3 pour camion AG motorisé, suppression colonne `plaque_saisie_terrain` §04, suppression alertes `plaque_saisie_non_conforme`+`plaque_inconnue_prestataire`+cas C2, R_M05.2 retirée, D10 annulée ; S7 reste émis par le manager M03 E4) / 2026-05-01 (propagation revue sobriété §08 Bloc B+C+D — `photos_urls`→`photos`, S7 supprimé, `type_incident` 14→6 valeurs : retrait `vehicule_panne`/`accident_route`/`chauffeur_indisponible`/`absence_contenant`/`materiel_casse`/`erreur_pesee`/`blessure` ; transition `planifiee→incident` fusionnée dans `inchange` D3 ; E4 motifs avant arrivée 4→1 (`client_annule_avant_arrivee` seul, autres gérés hors app)) / 2026-04-30 (revue sobriété M05 E6/E7/E9 — E6 suppression `bac_660L` + `caisse_isotherme_AG`, suppression présélection contenant, décimale 1 chiffre, min 0 kg, alerte seuils côté Ops uniquement / E7 coefficient kg/repas 0,4 → 0,45 + alignement strict Plateforme + paramètre `m05_equivalent_repas_kg` / E9 5 catégories (acces_refuse couvre lieu fermé, client_absent, probleme_tri, pas_excedents AG-only, autre) — suppression `lieu_ferme`/`bacs_vides`/`bacs_non_conformes`/`panne_vehicule` + suppression alerte M11 `panne_vehicule_signalee` + gestion panne hors app) / 2026-04-29 (revue sobriété M05 — E2 J→J+7 + sticky header + carte résumée/détail + badge "modifiée" / E3 checklist 4 items max + matrice véhicule × ZD/AG + suppression cas A/B plaque + skip vélo cargo / E4 ajout adresse_acces + transition `planifiee`→`incident` + overlay incident / E5 Bloc 1 nouvelle composition pax+traiteur+contact_principal+contact_secours, suppression adresse_grand_public + type_vehicule_max + bouton Appeler Ops + bouton Historique lieu, overlay incident permanent) / 2026-04-27 (propagation §12 App mobile chauffeur V1 — D2 OS supportés Android 10+ / iOS 16.4+ ligne 72, D3 Service Worker Serwist §8.1, D5 Web Push Edge Function `tms.push_send` confirmé §8.1, D7 force change password W1 étape 6-bis + D25 ajoutée, D9 paramètre `m05_force_update_strict` ajouté §12) / 2026-04-24 (propagation M03 — retournement méthode auth chauffeur magic link → email+password)

---

## ⚠ Addendum 2026-04-24 (propagation M03) — Retournement méthode auth chauffeur

Issu de la rédaction de [[M03 - Portail prestataire self-service]] (V1 rédigée 2026-04-24). **Retournement D12 (volet méthode uniquement)** : la méthode de login chauffeur passe de **magic link** à **email + password**.

**Ce qui change** :
- **E1 Connexion** : magic link → formulaire email + password (8 car min)
- **D14 "Fallback magic link KO"** → reset password via magic link (inchangé fonctionnellement : clic sur "Mot de passe oublié" déclenche magic link 30 min qui redirige vers écran nouveau password)
- **Paramètre `m05_magic_link_ttl_min` (15 min)** → fusionné avec `m03_password_reset_ttl_min = 30` (un seul paramètre global)
- **POST `/auth/magic-link`** → `POST /auth/login` (email + password) + `POST /auth/password-reset-request` (magic link reset) + `POST /auth/password-reset-complete`

**Ce qui reste inchangé (IMPORTANT — toujours valide V1)** :
- **D12 device binding 1 device actif chauffeur** : inchangé. Le chauffeur peut être connecté sur 1 seul device. Login sur nouveau device → invalidation session précédente + toast.
- **D13 session 30j rolling** : inchangé.
- **Invalidation auto reinstall PWA (changement téléphone)** : inchangé (D12).
- **Rate limit 5 tentatives/15min/IP** : ajouté (addendum M03 §09).

**Règle de cohérence** : lire cet addendum + [[../09 - Authentification et permissions TMS#Addendum 2026-04-24 (propagation M03)]] comme source de vérité. Les sections internes E1, D14 et paramètres plus bas sont corrigées en in-place mais le reste du texte M05 conserve sa logique (toast anti-énumération, device fingerprint, cas terrain).

**Cohérence CDC** :
- [[03 - Périmètre fonctionnel TMS#M05 — App mobile chauffeur (PWA)]] — scope haut niveau
- [[01 - Vision et objectifs TMS#Persona 4 — Chauffeur prestataire]] — profil chauffeur, 8+8 statuts ZD/AG, équivalent repas 0,45 kg
- [[04 - Data Model TMS#Table : `collectes_tms`]] — statut opérationnel, pesées
- [[04 - Data Model TMS#Table : `pesees`]] — structure pesée brute (à enrichir §04)
- [[08 - Contrat API Plateforme-TMS]] — S3, S5, S9 (webhooks sortants M05 ; S7 plaque émis par M03, pas M05)
- [[09 - Authentification et permissions TMS]] — RLS chauffeur (à enrichir §09)
- [[M01 - Réception ordres de collecte]] — amont collectes
- [[M02 - Dispatch Ops Savr]] — amont assignation
- [[M04 - Gestion des tournées]] — conteneur exécution (E5, W4, W5 M04)
- [[M06 - Référentiel prestataires]] — chauffeurs, véhicules, plaques
- [[M11 - Alerting et monitoring ops]] — alertes incidents terrain

---

## 1. Objectif métier

M05 est l'**interface terrain unique** du chauffeur prestataire. Elle pilote l'exécution d'une tournée M04 de bout en bout : prise de connaissance, checklist pré-départ, navigation entre collectes, pesées, signatures AG, signalements, clôture géolocalisée. Toute la donnée terrain (poids, photos, statuts, signatures, coordonnées GPS) transite via M05 et alimente la Plateforme via le contrat webhook TMS→Plateforme (S3, S5, S9).

**Ce que M05 résout vs MTS-1** :
- Offline-first natif (queue locale IndexedDB + sync différée) vs MTS-1 100% online ratant les sous-sols parkings
- Auto-tare contenants paramétrable (Admin TMS) vs saisie tare manuelle erreur-prone
- Signature AG tactile intégrée vs bon papier photographié
- Checklist pré-départ bloquante (tenue Savr, rolls, film — ZD) vs départ sauvage actuel
- Signalements rapides 1-clic (accès refusé, lieu fermé, client absent) vs SMS/appel Ops
- Geofence + GPS clôture → contrôle dérive automatique vs confiance aveugle
- Push Web notifications (attribution, rappel H-30, alerte Ops) vs SMS payant + email ignoré

**KPI cibles V1** :
- < 5 min entre fin physique collecte et remontée événement Plateforme (objectif 6 Vision TMS)
- < 1% des collectes avec pesée manquante (hors cas présumé non-pesé auto)
- > 95% des collectes AG avec signature asso capturée
- 0 perte de donnée terrain sur coupure réseau (queue offline garantit 3 tournées + 150 photos)

---

## 2. Personas et contexte d'usage

### Chauffeur prestataire (persona principal)

**Profil type** :
- Âge 25-55 ans
- Smartphone personnel **Android 10+ Chrome 100+ ou iPhone iOS 16.4+ Safari** (alignement §12 D2 2026-04-27, parc 2026 ≥ 64 Go, ~95% du parc couvert + Web Push robuste). Note : Android 8-9 et iOS < 16.4 = message d'erreur au login + invitation à appeler Ops (Web Push absent ou fragile).
- Digital-low à digital-medium : SMS quotidien, WhatsApp, Waze, pas de power user
- Chauffeur poids lourd (Strike, Marathon camions frigo) ou cycliste (A Toutes! vélo cargo)
- 1 à 3 tournées par jour, 3 à 10 collectes par tournée (moyenne 5)
- Français courant (V1 FR uniquement, D15/bis Vision)

**Contraintes terrain** :
- Mains chargées (porte un bac, pousse un roll) → interactions 1 doigt / 1 main
- Lumière soleil direct en extérieur / pénombre parking sous-sol → contraste max obligatoire (D17)
- 4G saturée en zone dense (Paris intra-muros, grands événements) → offline-first impératif
- Batterie smartphone 8h vacation → consommation géoloc cappée (D6 : permanent basse + boost transitions)
- Chauffeur ne peut pas quitter son véhicule pour re-saisir → saisies rapides, checklist simple, fallback téléphone Ops en 1 tap (D18)

### Cas d'usage cible V1

1. **Chauffeur Strike matin** (camion 20 m³, 5 collectes ZD école + centre affaires) : prend connaissance tournée à 5h45, checklist véhicule 6h, tournée 6h-11h, retour entrepôt Savr, clôture GPS
2. **Chauffeur Marathon soir** (camion 12 m³, 3 collectes AG congrès) : attribution tournée la veille 18h, rappel H-30 à 18h30, collecte 19h-23h, dernière livraison asso 23h30
3. **Cycliste A Toutes! midi** (vélo cargo, 1 collecte AG traiteur) : pas de plaque (D10), checklist allégée (EPI vélo), course unique, rapide
4. **Chauffeur Strike enchaînement matin+AM** (2 tournées même jour) : accueil = liste chronologique des 2 tournées (D19)

### Non-personas V1

- Manager prestataire : utilise M03 portail desktop, **pas M05** (D20 : pas de switch contexte V1, workflow distinct)
- Client (traiteur, lieu) : pas d'accès M05
- Ops Savr : vue temps réel via M02/M04 desktop, pas M05

---

## 3. Architecture des écrans

Dix écrans V1. PWA installable (add to home screen Android/iOS), icône Savr, splash screen.

| # | Écran | Rôle | Transition |
|---|-------|------|------------|
| E1 | Connexion email + password | Saisie email + password → vérification hash argon2 → ouverture session | Vers E2 |
| E2 | Accueil (tournées du jour + J+1) | Liste chronologique + statut + raccourcis | Vers E3 ou E4 ou E10 |
| E3 | Checklist pré-départ (bloquante, ZD uniquement) | Tenue Savr, N rolls, film — *(camion AG motorisé + vélo cargo : E3 sauté, propagation M05 2026-06-04)* | Vers E4 |
| E4 | Liste collectes tournée active | Ordonnée, statut par collecte, navigation | Vers E5 ou E8 |
| E5 | Détail collecte (ZD ou AG) | Fiche lieu, actions contextuelles | Vers E6, E7, E9 |
| E6 | Pesée (ZD principalement) | Balance, contenant auto-tare, photos | Retour E5 |
| E7 | Signature AG + équivalent repas | Signature tactile + kg→repas | Retour E5 |
| E8 | Terminer tournée (capture GPS) | Géoloc clôture + confirmation | Retour E2 |
| E9 | Signalement rapide | Liste incidents pré-catégorisés | Retour E5 |
| E10 | Historique (lecture seule) | 30 derniers jours (RGPD purge 30j) | — |

**Navigation** : header fixe avec logo Savr + bouton retour contextuel + badge push. Pas de menu burger (réduit complexité, 10 écrans total). Bouton "Appeler" (D18) accessible depuis E5 + E9 en overlay permanent.

**Principes UX M05** :
- Mobile-first stricto sensu (jamais affichée en desktop — redirect vers portail si détection)
- Contraste élevé permanent (D17), taille de police min 16 px, boutons min 48×48 px
- Toutes actions critiques avec confirmation (touch slip fréquent en mouvement)
- Feedback visuel immédiat même offline (optimistic UI + file de synchro)
- Zéro placeholder fantaisiste — tout doit être compréhensible en 2 secondes

---

## 4. Cycle de vie côté chauffeur

Rappel statuts opérationnels ZD et AG (cf. [[01 - Vision et objectifs TMS#Statuts opérationnels collectes]]).

**Statuts ZD (8)** : `planifiee` → `en_route` → `arrivee` → `en_cours` → `realisee` (cas nominal) ou dérivés (`incident`, `annulee`, `reportee`, `echec_acces`).

**Statuts AG (8)** : `planifiee` → `en_route` → `arrivee` → `en_cours` → `realisee` ou `realisee_sans_collecte` (AG-only, ex: "aucun repas à collecter" — cf. mémoire feedback AG vs ZD) ou dérivés.

**Transitions déclenchées par M05** :

| Transition                            | Déclencheur M05                                                   | Webhook émis                                                    |
| ------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `planifiee` → `en_route`              | Clic "Démarrer collecte" ou départ tournée (auto 1ère collecte)   | S3 `tournee-upsert` (statut tournée `en_cours`)                 |
| `en_route` → `arrivee`                | Geofence 300m franchi (D4) ou bouton manuel (D5 fallback GPS off) | — (interne)                                                     |
| `arrivee` → `en_cours`                | Clic "Commencer collecte"                                         | — (interne)                                                     |
| `en_cours` → `realisee`               | Clic "Terminer collecte" (ZD avec ≥1 pesée, AG avec signature)    | S5 `collecte-terminee` (batch pesées agrégées)                  |
| `en_cours` → `realisee_sans_collecte` | AG : clic "Aucun repas à collecter" + motif                       | S5 `collecte-terminee` (poids 0 avec source `ag_sans_collecte`) |
| `*` → `inchange` (ex-`incident`, fusion Bloc D D3) | Clic "Signaler incident" + catégorie | S9 `incident` (**enum 5 valeurs** post-décision 2026-06-06 : `acces_refuse`, `client_absent`, `probleme_tri`, `autre`, `client_annule_avant_arrivee` — `pas_excedents` retiré, cf. E5/E9) |
| `planifiee` → `inchange` (ex-`incident`, fusion Bloc D D3) | Clic "Signaler incident" depuis E4 avant arrivée + motif unique `client_annule_avant_arrivee` *(revue sobriété §08 Bloc D 2026-05-01 D1+D2 : `vehicule_panne`/`accident_route`/`chauffeur_indisponible` retirés — gestion hors app via appel direct Ops bouton tel:)* | S9 `incident` avec `geofence_status=avant_arrivee` |
| `arrivee` → `echec_acces`             | Clic "Accès refusé" ou "Lieu fermé"                               | S9 `incident` avec `statut_collecte_apres=echec_acces`          |

**Transitions non-autorisées M05** :
- `realisee` → `en_cours` (Ops uniquement via back-office)
- `annulee` → * (terminal)
- Saut `planifiee` → `en_cours` direct (passer par `arrivee` sauf override géoloc)

**Clôture tournée** : cf. M04 W5. M05 déclenche le clic "Terminer tournée" → M04 applique R2 (calcul coût), recalcul de marge Plateforme via trigger DB `plateforme.fn_recalc_marge_tournee()` (ex-webhook S6 supprimé §08 A2), S3 (`tournee-upsert` statut `terminee`). Plus d'action pesée à la clôture tournée (R_M05.18 supprimée revue sobriété 2026-04-29 avec `flux_prevus`).

---

## 5. Écran par écran

### E1 — Connexion email + password (retournée 2026-04-24 propagation M03)

**Contexte** : première ouverture PWA ou session expirée (D13 : 30 jours rolling, device binding D12 inchangés).

**Layout** :
- Logo Savr centré
- Titre : "Connexion chauffeur"
- Champ email (auto-suggest clavier, type `email`)
- Champ password (type `password`, toggle "afficher/masquer")
- Bouton "Se connecter" (gros, couleur primaire)
- Lien "Mot de passe oublié ?" → flow reset via magic link (cf. EA2 M03)
- Lien discret "Besoin d'aide ?" → ouvre `tel:` Ops Savr (D14 fallback révisé)

**Parcours** :
1. Chauffeur saisit email (présent dans `tms.chauffeurs` M06) + password (min 8 car)
2. Clic "Se connecter" → `POST /auth/login` → Supabase Auth verify hash argon2
3. Session JWT créée + `device_fingerprint` stocké dans `auth_sessions_tms`
4. Redirection E2

**Règles** :
- Message d'erreur unifié "Email ou mot de passe incorrect" (anti-énumération + timing constant bcrypt dummy compare)
- Si device différent d'un device déjà actif (D12 inchangé) → invalidation session précédente + toast "Connecté sur un nouveau appareil. L'ancien appareil est déconnecté."
- Rate limit 5 tentatives échouées / 15 min / IP → 429 + délai d'attente affiché
- Mot de passe initial : fourni par manager prestataire à la création du chauffeur (M06 W7) ou via premier lien "Mot de passe oublié"
- Fallback D14 révisé : si chauffeur a perdu son mot de passe, lien "Mot de passe oublié" (magic link 30 min), puis `tel:` Ops en dernier recours si pas d'accès email

**Accessibilité** : focus auto champ email, autocomplete `username` / `current-password` pour password managers natifs (iOS/Android).

### E2 — Accueil (tournées J → J+7) — révisé revue sobriété 2026-04-29

**Contexte** : écran home de la PWA, point d'entrée quotidien chauffeur. Affiche l'horizon glissant 7 jours pour anticiper les tournées à venir.

**Layout** :
- Header : nom chauffeur + logo prestataire + bouton déconnexion
- Liste chronologique des tournées **validées** assignées au chauffeur (J → J+7), regroupées par jour
- **Sticky header par jour** : ex "Aujourd'hui — Lundi 4 mai", "Mardi 5 mai", "Mercredi 6 mai" … (date relative pour J et J+1, date absolue ensuite)
- Tri intra-jour : `heure_planifiee_debut` croissant
- Section "Notifications" (si push reçues, badges actifs)
- Footer : bouton "Historique" → E10

**Format carte tournée — vue résumée (par défaut)** :
- T# tournée + prestataire
- Fenêtre tournée (`heure_planifiee_debut/fin`)
- Nb collectes
- Statut (badge couleur planifiee/en_cours/terminee)
- Bouton principal contextuel

**Format carte tournée — vue détaillée (au tap)** :
La carte se déplie pour afficher :
- Véhicule(s) assigné(s) (`tournees.vehicule_id` → plaque + type)
- Équipier(s) (`tournees.equipiers_ids` → noms)
- Liste des collectes : nom lieu + adresse accès + heure_collecte + pax + nom traiteur
- Re-tap = repli

**Logique boutons contextuels par carte** :

| Statut tournée                       | Bouton principal         | Action      |
| ------------------------------------ | ------------------------ | ----------- |
| `planifiee` (J = aujourd'hui)        | "Lancer la tournée"      | → E3        |
| `planifiee` (J+1 à J+7)              | "Voir détail"            | dépli carte |
| `en_cours`                           | "Reprendre"              | → E4        |
| `terminee`                           | Badge ✓ "Terminée"       | dépli carte |

**Règles** :
- Tri : date croissante puis `heure_planifiee_debut` croissante intra-jour
- Tournées `annulee` : masquées (pas visibles par le chauffeur, on évite la confusion)
- Si aucune tournée sur 7j : message "Pas de tournée pour les 7 prochains jours. Bonne journée !" + photo sobre
- Enchaînement 2 tournées même jour (D19) : les 2 visibles dans le sticky du jour, chauffeur peut alterner

**Interactions push (D15, D16)** :
- Badge rouge sur icône PWA à la réception d'une notif
- Bandeau sticky "Nouvelle tournée attribuée" cliquable → carte concernée
- **Push "Tournée modifiée"** : déclenchée si `tournees.updated_at` change après attribution (changement horaire, équipier, véhicule, collectes ajoutées/supprimées). *(Badge persistant "modifiée" + tracking `dernière_visualisation_chauffeur` retirés V1 — revue sobriété 2026-06-04 B2 : le push suffit comme signal, pas de tracking de dernière visualisation.)*
- Pas de bannière permanente (fatigue user)

**Volume offline** : 7 jours × moyenne 2 tournées/jour × 5 collectes/tournée = ~70 collectes max en cache. IndexedDB tient sans difficulté (cf. §03 pre-spec).

### E3 — Checklist pré-départ (bloquante) — révisée revue sobriété 2026-04-29

**Contexte** : checklist minimaliste avant démarrage tournée. La conformité véhicule/EPI bascule 100% sous responsabilité du manager prestataire (cf. M03), Savr ne contrôle que ce qui impacte directement la collecte.

**Matrice par type véhicule × ZD/AG** :

| Type véhicule         | ZD                                             | AG                          |
| --------------------- | ---------------------------------------------- | --------------------------- |
| Camion frigo motorisé | Tenue Savr + N rolls + Film plastique          | Skip écran E3 (E2 → E4 direct) |
| Vélo cargo            | Aucune checklist (skip écran E3 → direct E4)   | Aucune checklist (skip E3)  |

> **Suppression saisie plaque terrain (propagation M05 2026-06-04, arbitrage Val)** : l'item « Plaque » de la checklist pré-départ est **retiré V1**. La plaque qui compte (contrôle d'accès site + registre transport réglementaire + affichage traiteur) est la **plaque pré-saisie par le manager prestataire** (`tournees.plaque_preassignee_manager`, émise via webhook S7 depuis M03 E4) — inchangée. La saisie chauffeur au démarrage faisait double emploi (arrivait trop tard pour un contrôle d'accès anticipé) et n'était pas propagée à la Plateforme (TMS-only). Conséquence : colonne `plaque_saisie_terrain` supprimée (§04), alertes de divergence terrain/référentiel supprimées (M11), écran E3 supprimé pour camion AG motorisé.

**Layout camion ZD (Strike, Marathon ZD)** :
Section "Checklist pré-départ" (3 items, tous bloquants) :

1. **[ ] Tenue Savr** (gants, gilet, pantalon, chaussures sécurité — checklist regroupée 1 item)
2. **[ ] N rolls chargés** : affiche `tournees.nb_rolls_suggeres` (ex "12 rolls à charger"), checkbox "Chargés"
3. **[ ] Film plastique**

**Layout camion AG (camion frigo AG)** :
- Plus de checklist (l'unique item « Plaque » est retiré) : E2 → E4 direct (skip E3), comme le vélo cargo. **Retiré V1 (propagation M05 2026-06-04 — suppression saisie plaque terrain)**

**Layout vélo cargo (A Toutes!)** :
- Pas de checklist : E2 → E4 direct (skip E3)

**Règles** :
- Tous les items cochés = bouton "Démarrer tournée" activé (couleur primaire)
- 1 item décroché = bouton grisé + tooltip "Complète la checklist"
- Camion ZD = 3 items bloquants (Tenue, N rolls, Film). Camion AG motorisé + vélo cargo = E3 sauté, transition directe E2 → E4.
- **Retiré V1 (propagation M05 2026-06-04)**
- **Retiré V1 (propagation M05 2026-06-04 — plus de plaque terrain à comparer)**
- À la validation "Démarrer tournée" → M04 W4 (UPDATE `tournees.statut=en_cours`, `heure_reelle_debut`, S3, audit — transition `acceptee` → `en_cours` ; le bouton "Démarrer" suppose la tournée `acceptee`, cf. cycle de vie M04 §4 2026-06-06). Plus d'écriture `plaque_saisie_terrain`, plus de webhook S7 côté chauffeur (S7 reste émis par le manager en M03 E4).

**Suppressions vs version antérieure (revue sobriété 2026-04-29)** :
- Section EPI détaillée (4 items) → regroupée en "Tenue Savr" 1 ligne
- Section Véhicule (état, niveaux, feux, anomalies) → supprimée (responsabilité manager prestataire)
- Section Photos (face avant, plaque) → supprimée (V1.1 si besoin litiges)
- Cas A/B plaque (pré-saisie manager vs saisie chauffeur) → simplifié en saisie chauffeur uniquement
- Flow audit log `PLAQUE_OVERRIDE_CHAUFFEUR` + alerte M11 `m05_plaque_override_chauffeur` → supprimé (plus de pré-saisie donc plus d'override)
- Checklist vélo cargo détaillée (casque/gilet/gants + état/batterie/feux) → supprimée (skip écran complet)
- **Item Plaque (saisie chauffeur démarrage tournée) → supprimé V1 (propagation M05 2026-06-04, arbitrage Val) — voir encadré ci-dessus.**

### E4 — Liste collectes tournée active — révisée revue sobriété 2026-04-29

**Contexte** : vue principale pendant l'exécution.

**Layout** :
- Header : T# tournée (propagation revue sobriété M04 2026-04-29 — suppression "Nom tournée") + fenêtre tournée + compteur "2/5 collectes"
- Liste ordonnée des collectes (`collecte_tournees.ordre_dans_tournee` *(multi-camions 2026-05-25 — colonne déplacée depuis `collectes_tms`)* — initialisé au dispatch M04 W1, modifiable Ops via flèches E3 Section 2 tant que `tournees.statut = 'planifiee'`, propagation revue sobriété M04 2026-04-29)
- Par collecte : numéro ordre, nom lieu, **adresse accès** (`lieux.adresse_acces`), `heure_collecte`, statut (badge couleur), parcours (ZD/AG) ou nb pax (AG), bouton action
- Footer sticky : bouton "Terminer la tournée" (actif si toutes collectes terminales)
- **Overlay sticky bas** : bouton "⚠ Signaler incident" accessible en permanence (cf. règles incident avant arrivée ci-dessous)

**Boutons contextuels par collecte** :

| Statut | Bouton | Action |
|---|---|---|
| `planifiee` | "Démarrer" | → transition `en_route` + E5 |
| `en_route` | "J'arrive" | (visible en E5 uniquement) |
| `arrivee` | "Commencer" | (visible en E5 uniquement) |
| `en_cours` | "Ouvrir" | → E5 (reprise pesées, signature) |
| `realisee` / `realisee_sans_collecte` | Badge ✓ | — |
| `incident` / `echec_acces` | Badge ⚠ | Détail dans E5 |

**Indicateurs GPS** :
- Icône de position à côté de la collecte en cours (vert = dans geofence 300m, gris = pas encore arrivé)
- Pas de carte de routing V1 (D2 M04 : pas d'optimisation routing). Chauffeur utilise Waze/Google Maps en externe.

**Règles** :
- Bouton "Terminer tournée" grisé tant qu'au moins une collecte est non-terminale (ni `realisee`, ni `realisee_sans_collecte`, ni `incident`, ni `annulee`)
- Si toutes collectes terminales → bouton actif, clic → E8 capture GPS
- Clôture auto possible (R_M04.4) si le chauffeur oublie : alerte M11 après 8h inactivité tournée

**Incident avant arrivée (nouveau revue sobriété 2026-04-29)** :
- Nouvelle transition autorisée : `planifiee` → `inchange` (signalement non bloquant, ex-`incident` fusionné Bloc D D3)
- Cas d'usage : client annule en cours de route — évite déplacement inutile. **gérés hors app** (revue sobriété §08 Bloc D 2026-05-01 D1+D2 : appel direct Ops via bouton tel: dans E5/E9, pas de catégorie incident dédiée).
- Accès : depuis E4 via overlay "Signaler incident", sélection collecte concernée, puis E9 avec **1 motif unique "avant arrivée"** :
  - `client_annule_avant_arrivee`
- Webhook S9 émis avec `geofence_status='avant_arrivee'` (cf. §08)
- Statut collecte après : `annulee` (terminal) — propagation Bloc D D3 : ex-valeur `incident` fusionnée dans `inchange`, mais ici `annulee` reste valide (annulation client = collecte non honorable).

### E5 — Détail collecte (ZD ou AG)

**Contexte** : fiche lieu + actions de collecte. Varie ZD vs AG.

**Layout commun** (Bloc 1 révisé revue sobriété 2026-04-29) :
- Header : nom lieu + code postal + badge ZD/AG + statut
- Bloc 1 "Infos lieu"
  - **Adresse accès** (`lieux.adresse_acces`, cliquable → Waze/Maps)
  - **Accès office** (`lieux.acces_office`, texte libre Admin) : ex "Appeler gardien, parking sous-sol B"
  - **Stationnement** : enum (`parking_privé`, `rue_gratuite`, `sas_camion`, `interdit_strict`)
  - **Pax** : `collectes_tms.nb_pax` (affiché ZD et AG — propagation harmonisation 2026-04-29 : nom canonique data model TMS)
  - **Traiteur** : `evenements.traiteur_id` → nom (affiché ZD et AG, cf. couple lieu × traiteur)
  - **Contact principal** : nom + téléphone cliquable (`collectes_tms.contact_principal_*`)
  - **Contact de secours** : nom + téléphone cliquable (`collectes_tms.contact_secours_*`)
  - **Informations supplémentaires concernant la collecte** (`collectes_tms.informations_supplementaires`, ajout 2026-05-06 — texte libre saisi par le programmeur côté Plateforme §06.01 §2.a, ex "Sonner interphone B au RDC", "Quai N°2 fermé le lundi"). Bloc affiché uniquement si non NULL. Lecture seule chauffeur.
- Bloc 2 "Actions"
  - Bouton principal contextuel (cf. §cycle de vie)
- **Overlay sticky bas (toujours visible)** : bouton "⚠ Signaler incident" (D18 : appel direct traiteur + Ops)

**Suppressions Bloc 1 vs version antérieure (revue sobriété 2026-04-29)** :
- Adresse grand public → supprimée (champ `lieux.adresse_grand_public` retiré du data model, fallback inutile)
- Type véhicule max → supprimé (info dispatcher pas chauffeur sur place)
- Bouton "Appeler Ops" Bloc 2 → supprimé (volonté Val : éviter sollicitations excessives ; Ops reste joignable via "Signaler incident" qui déclenche workflow alerte D18)
- Bouton "Historique lieu" Bloc 2 → reporté V1.1
- Bouton "Signaler incident" Bloc 2 → bascule en overlay sticky permanent

**Layout ZD spécifique** (Bloc 3) :
- Bouton "Peser un flux" → E6
- Pesées enregistrées (liste) : flux + poids net + contenant + photo(s)
- Indicateur "N flux pesés"
- Bouton "Terminer collecte" (actif si ≥1 pesée OU toutes pesées explicitement non applicables)

**Layout AG spécifique** (Bloc 3) :
- Nb pax prévus
- Bouton "Capturer la collecte" → E7 (signature + kg→repas)
- Bouton "Aucun repas à collecter" (AG-only, cf. mémoire feedback AG vs ZD) → statut `realisee_sans_collecte` avec motif obligatoire
- Photo(s) contenus (optionnel)
- Bouton "Terminer collecte" (actif si signature capturée OU `aucun_repas` motivé)

**Règles géofence (D4)** :
- Geofence 300m autour `lieux.coords_gps` : entrée → transition auto `en_route` → `arrivee` + toast "Tu es arrivé à <lieu>"
- Sortie du geofence avant clôture → pas de rollback (évite flapping)
- GPS indisponible (D5) : bouton "J'arrive" disponible dès départ tournée, clic = transition manuelle `en_route` → `arrivee` (fallback immédiat, contrat de confiance, audit log `M05_ARRIVEE_GEOLOC_FALLBACK` seul — widget M11 supprimé revue sobriété §05 2026-05-01 A4)

### E6 — Pesée (ZD principalement, AG si nécessaire)

**Contexte** : point chaud UX M05. Saisie rapide poids brut + contenant auto-tare (D7, D8, D9).

**Layout** :
- Header : "<Lieu> — Pesée <flux>" + retour E5
- Champ 1 : **Flux** (dropdown) — 5 enums ZD alignés Plateforme (`biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`) + `don_alimentaire` si AG. Pas de présélection (revue sobriété 2026-04-29 : suppression `flux_prevus` → chauffeur choisit librement). Enum fermée V1 post-refonte 2026-05-02 — `dib` renommé `dechet_residuel`.
- Champ 2 : **Contenant** (dropdown, D7/D8/D9)
  - Options chargées depuis `types_contenants` (table paramétrable Admin TMS, D9) : `roll` (tare 45 kg), `bac_1100L` (tare 50 kg), `bac_240L` (tare 14 kg), **`sans_contenant`** (tare 0 — pesée sac direct, D7 override Val)
  - Pas de présélection — choix explicite à chaque pesée (revue sobriété M05 E6 2026-04-30 : suppression présélection "contenant pesée précédente" pour réduire risque erreur de saisie)
  - Icônes visuelles (pictos roll/bac/sac) pour reconnaissance rapide
- Champ 3 : **Poids brut** (kg, saisie numérique)
  - Clavier numérique natif
  - Décimales 1 chiffre max (revue sobriété M05 E6 2026-04-30 : alignement précision balance terrain — `round(poids_brut, 1)` côté TMS)
  - Min 0 kg / max 2000 kg (règles métier M05)
- **Affichage calcul en direct** :
  - Tare auto = `types_contenants.tare_kg` pour contenant sélectionné
  - Poids net = brut − tare (si `sans_contenant`, poids net = poids brut)
  - Rendu : "Brut 85 kg − Tare 14 kg (bac 240L) = **Net 71 kg**"
- Champ 4 : **Override tare** (D8 : toggle "Corriger la tare")
  - Si activé : champ tare éditable + champ **motif obligatoire** (min 10 caractères)
  - Audit log `action=PESEE_TARE_OVERRIDE` avec before/after + motif
- Champ 5 : **Photo(s)** (obligatoire 1 min, max 5)
  - Bouton caméra → natif OS
  - JPEG compressé qualité 80% (cf. §03 pre-spec)
  - Thumbnails affichées, tap pour supprimer
  - Stockage queue offline (Blob IndexedDB) + upload différé Supabase Storage

- Bouton "Enregistrer la pesée"
  - Valide → INSERT `pesees` (local offline si hors-ligne) + retour E5 + toast "Pesée enregistrée"
  - Webhook S5 `collecte-terminee` émis (dès réseau)

**Règles** :
- Si contenant = `sans_contenant` et poids brut = 0 : toast "Pesée à 0 kg enregistrée (sac vide). Continuer ?" + validation 2 clics
- Alerte M11 si poids net < seuil min ou > seuil max (paramètre `m05_seuils_pesees_kg_min_max_par_flux`, ZD-only cf. mémoire AG vs ZD) — **alerte côté Ops uniquement, AUCUN affichage côté chauffeur** (revue sobriété M05 E6 2026-04-30 : ne pas perturber la saisie terrain, l'arbitrage qualité reste Ops via M11/M02)
- Offline : pesée stockée IndexedDB avec `sync_status=pending`, `idempotency_key=uuid()`
- Edit pesée : possible tant que collecte `en_cours` ; impossible après `realisee` (correction Ops uniquement)

### E7 — Signature AG + équivalent repas

**Contexte** : capture signature association bénéficiaire + calcul équivalent repas.

> **Destination de livraison pré-remplie (ajout 2026-05-29, arbitrage Val)** : l'association bénéficiaire est attribuée + validée côté Plateforme (§06.09) et reçue par le TMS dans `collectes_tms.association_snapshot` (via E2). **Bloc destination affiché en tête d'E7** dès l'ouverture (avant signature) : nom association + adresse + bouton "Itinéraire" (GPS) + contact (nom/téléphone, appel direct) + horaires d'ouverture. Le chauffeur sait ainsi **où livrer** sans la chercher. Si `association_snapshot` est NULL (attribution non encore validée à l'heure de la collecte — cas rare), afficher "Destination non communiquée — contacter Ops" + alerte M11 warning Ops.

**Layout** :
- Header : "<Lieu> — Signature AG" + retour E5
- **Bloc destination** (lecture, depuis `association_snapshot`) : nom + adresse + itinéraire GPS + contact + horaires.
- Champ 1 : **Nom association** — **pré-rempli** depuis `association_snapshot.nom` (cas nominal). Reste éditable (autocomplete `associations` + saisie libre) pour couvrir une **réorientation terrain** (asso fermée/saturée le jour J → le chauffeur livre ailleurs et saisit l'association réelle). La valeur saisie (= association réellement livrée) est celle remontée via S5 et sert l'attestation de don Plateforme.
- Champ 2 : **Nom représentant** (texte libre)
- Champ 3 : **Poids total collecté** (kg)
  - Calcul automatique si ≥1 pesée E6 existe pour cette collecte (agrégé)
  - Override manuel possible (motif requis)
- **Affichage équivalent repas** :
  - Formule : `nb_repas = round(poids_total_kg / plateforme.parametres_algo.poids_par_repas_kg)` (défaut 0,45 — audit sobriété 2026-05-09 B2, source unique cross-app, lecture cross-schema)
  - Exemple : 20 kg → 44 repas
- Champ 4 : **Signature tactile**
  - Zone canvas, stylet/doigt
  - Bouton "Effacer" + "Valider"
  - Stockage PNG compressé base64 → queue offline → Supabase Storage
- Champ 5 : **Photos** (optionnelles, ex : contenus)
- Bouton "Enregistrer la signature"

**Règles** :
- Signature obligatoire sauf `aucun_repas` (alternative E5)
- Pas de re-signature V1 (1 signature = 1 collecte AG) ; si erreur, "Effacer" avant validation
- Signature = source de preuve asso habilitée → archivée 6 ans RGPD (cf. §15 Sécurité)

### E8 — Terminer tournée (capture GPS)

**Contexte** : clôture tournée côté chauffeur après toutes collectes terminales (R_M04.4 + D4).

**Layout** :
- Header : "Terminer la tournée"
- Récap : T# tournée (propagation revue sobriété M04 2026-04-29 — suppression "Nom tournée") + nb collectes réalisées + durée
- Champ **Position actuelle** (capture GPS auto au chargement écran)
  - Si succès : "Position captée ✓ · <distance>m de l'entrepôt"
  - Si échec : "Position indisponible (bouton fallback)"
- Bouton "Confirmer la fin de tournée"
  - Clic → UPDATE `tournees.statut=terminee`, `cloture_gps`, distance vs entrepôt/dernière livraison (D4 M04)
  - Si distance > 300m → `cloture_hors_zone=true`, alerte M11 warning (non bloquant)
  - Déclenche M04 W5 (R2 calcul coût, recalcul marge Plateforme via trigger DB `fn_recalc_marge_tournee()` ex-S6, S3 upsert)
- Redirection E2 + toast "Tournée terminée"

**Règles** :
- GPS indisponible (C8 M04) : clôture autorisée `cloture_gps=null`, pas d'alerte
- Chauffeur peut réouvrir la tournée si erreur (Ops requis — M05 V1 pas de reset chauffeur)

### E9 — Signalement rapide

**Contexte** : déclenchement 1-clic en cas de problème terrain (D18 + pre-spec §03).

**Layout** :
- Header : "Signaler un problème"
- Catégories pré-définies (grosses tuiles) — **4 catégories (décision 2026-06-06 : `pas_excedents` retiré, cf. ci-dessous)** :
  - 🚫 **Accès refusé** (gardien, SAS fermé, code erroné, lieu fermé horaires différents/grève — fusion `lieu_ferme` 2026-04-30)
  - 👤 **Client absent** (pas de contact terrain dispo)
  - ⚠️ **Problème de tri** (mauvais tri, odeur, casse → passage en déchet résiduel — renommé depuis `bacs_non_conformes` 2026-04-30, terminologie mise à jour 2026-05-02)
  - ❗ **Autre** (texte libre obligatoire)

> **Suppression `pas_excedents` E9 (décision 2026-06-06 — chemin unique)** : le cas AG « aucun repas / pas d'excédents » ne passe **plus** par un signalement incident E9 (S9). Il est traité exclusivement par le bouton de clôture **« Aucun repas à collecter » en E5** (AG-only) → statut `realisee_sans_collecte` → webhook **S5** `collecte-terminee` (poids 0, `source=ag_sans_collecte`). Sémantiquement, « aucun repas » est une clôture normale, pas un incident. Cela supprime le doublon (2 UX + 2 webhooks pour le même résultat) et le tarif « course incomplète » reste piloté côté M03/M07 par le statut `realisee_sans_collecte` (cf. §03). Enum `type_incident` S9 : 6 → 5 valeurs.
- Photo(s) (optionnel mais recommandé)
- Commentaire texte libre (optionnel)
- Boutons :
  - "Appeler le traiteur" (D18 tel:)
  - "Appeler Ops Savr" (D18 tel:)
- Bouton "Enregistrer le signalement"

**Règles** :
- Signalement `probleme_tri` / `autre` → statut collecte reste possiblement `realisee` (pas bloquant — Ops arbitre via M02)
- Signalement `acces_refuse` / `client_absent` → statut collecte = `echec_acces` → webhook S9 `incident` émis avec `statut_collecte_apres=echec_acces`
- *(Cas « pas d'excédents » AG : voir E5 bouton « Aucun repas à collecter » → S5, hors E9 depuis décision 2026-06-06.)*
- Audit log `action=COLLECTE_SIGNALEMENT` avec catégorie + photos + commentaire
- Appels téléphonés tracés (D18) : quand le chauffeur clique `tel:`, M05 logge `action=CALL_TRIGGER` avec destinataire et timestamp (pas de capture du contenu)
- **Panne véhicule (gestion hors app — revue sobriété M05 E9 2026-04-30)** : pas de catégorie dédiée dans E9. Le chauffeur appelle directement Ops Savr via le bouton tel: ; gestion opérationnelle (remplacement véhicule) reste pilotée par M04 W6.

### E10 — Historique (lecture seule)

**Contexte** : consultation passé récent. RGPD purge 30j (pre-spec §03 + [[01 - Vision et objectifs TMS]]).

**Layout** :
- Header : "Historique"
- Liste tournées 30 derniers jours, triées date décroissante
- Tap carte tournée → détail read-only (collectes, pesées, signatures, photos thumbnails)
- Pas de bouton action (consultation pure)

**Règles** :
- Purge auto J+30 (pg_cron Supabase) : coords GPS effacées, photos gardées côté Plateforme (si archivage M04), détails restent visibles TMS jusqu'à purge full tournée
- Pas de recherche textuelle V1 (volume limité, scroll suffisant)

---

## 6. Workflows

Douze workflows couvrent les parcours opérationnels M05. **W13 confirmation passage Veolia supprimé revue sobriété 2026-04-30 A1** (cf. M10 V3 sobre — la déclaration Ops `realise` vaut désormais confirmation effective).

### W1 — Onboarding chauffeur (première connexion + device binding)

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Manager prestataire (M03) ou Admin TMS | Crée chauffeur avec email **sans password initial** (refondu revue sobriété §05 2026-05-01 B1) | INSERT `tms.chauffeurs` + INSERT `auth.users` Supabase avec `encrypted_password = NULL` |
| 2 | Chauffeur | Reçoit email "Définir mon mot de passe" + magic link 30 min | Template Resend `chauffeur_bienvenue` (reformaté V1 — magic link uniquement, plus de password en clair) |
| 3 | Chauffeur | Ouvre lien sur smartphone qu'il utilisera | Browser détecte PWA installable + redirection page set-password |
| 4 | Chauffeur | Installe PWA (add to home screen) + définit password (≥ 8 car) | `POST /auth/password-reset-complete` |
| 5 | Chauffeur | Session créée automatiquement + device fingerprint capturé | `auth_sessions_tms` avec `device_fingerprint` |
| **5-bis (ajout Bloc 3 2026-06-04)** | Chauffeur | **Écran d'information géoloc bloquant** : notice (finalité, base légale intérêt légitime, rétention 30j, destinataires, droits + contact) + bouton « J'ai lu et compris » obligatoire pour continuer | `UPDATE users_tms SET consentements = jsonb_set(coalesce(consentements,'{}'), '{geoloc_notice}', '{"acknowledged_at": now, "version_notice": <v>, "ip": <ip>}')`. Si `consentements.geoloc_notice.version_notice` < version courante de la notice → ré-affichage bloquant (sinon skip). Cf. §12 D6 + §15.4.1 |
| 6 (ex-7) | Chauffeur | Arrive sur E2 (accueil vide si pas de tournée) | — |
| 7 (ex-8) | Système | Audit log `action=CHAUFFEUR_FIRST_LOGIN` + `action=PASSWORD_SET_FIRST_LOGIN` + `action=GEOLOC_NOTICE_ACKNOWLEDGED` (Bloc 3) | |

**Règles** :
- Device fingerprint = hash(`user_agent + screen_resolution + timezone + installed_fonts`). Pas d'IP (varie 4G/WiFi).
- Si chauffeur réinstalle PWA (changement téléphone) : D12 invalidation session précédente auto

### W2 — Ouverture PWA + sync tournée du jour

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Ouvre PWA (icône home) | Service worker démarre |
| 2 | Système | Vérifie session active (cookie + device fingerprint) | |
| 3 | Système | Si session valide → requête GET `/api/chauffeur/tournees?date=today&date=tomorrow` | |
| 4 | Système | Affiche E2 avec cache-first (optimistic UI) puis MAJ réseau | |
| 5 | Système | Si version PWA obsolète + `force_update` non actif → bannière discrète "Nouvelle version dispo, redémarrage à la fin de la tournée" (D3) | |
| 6 | Système | Si `force_update=true` côté serveur → reload immédiat + toast | |

**Règles** :
- Sync silencieuse toutes les 2 min si PWA ouverte + connecté
- Pull notifications push si nouvel événement (D15, D16) — server-push indépendant du polling
- Cache SW : accueil + dernière tournée active + photos offline
- **Gate notice géoloc (Bloc 3 2026-06-04)** : à l'ouverture, si `users_tms.consentements.geoloc_notice.version_notice` est absent ou < version courante de la notice → afficher l'écran d'information bloquant (cf. W1 étape 5-bis) avant l'accès à E2. Cas normal (version à jour) : aucun ré-affichage, le chauffeur n'est pas confronté au sujet.

### W3 — Checklist pré-départ + démarrage tournée

> **Saisie plaque retirée V1 (propagation M05 2026-06-04, arbitrage Val)** : plus de saisie plaque par le chauffeur au démarrage. Plus d'écriture `plaque_saisie_terrain` (colonne supprimée §04), plus de webhook S7 côté chauffeur, plus d'alerte de divergence terrain/référentiel. La plaque pour contrôle d'accès / registre reste celle pré-saisie par le manager (M03 E4, webhook S7 émis depuis M03). Pour le **camion AG motorisé et le vélo cargo**, l'écran E3 est entièrement sauté (E2 → E4 direct) ; seul le camion ZD conserve E3 (tenue, rolls, film).

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Clic "Commencer la checklist" depuis E2 carte tournée `acceptee` (camion ZD uniquement ; `acceptee` = tournée prête, cf. cycle de vie M04 §4 2026-06-06) | → E3 |
| 2 | Chauffeur | Coche items checklist ZD (Tenue Savr, N rolls, Film) | Stockage état local (pas persisté serveur V1) |
| 3 | Chauffeur | Clic "Démarrer tournée" | Validation complétude |
| 4 | Système | UPDATE `tournees.statut=en_cours`, `heure_reelle_debut=NOW()` (transition `acceptee` → `en_cours`) | |
| 5 | Système | Re-émet S3 `tournee-upsert` (statut en_cours) | |
| 6 | Système | Transition UI → E4 | |
| 7 | Système | Audit log `action=CHECKLIST_VALIDATED` + `action=TOURNEE_START` | |

: saisie plaque chauffeur, UPDATE `plaque_saisie_terrain`, webhook S7 côté chauffeur (déjà strikethrough C3), alerte plaque ≠ référentiel. *(Étape 8-bis confirmation Veolia déjà supprimée revue sobriété 2026-04-30 A1.)*

**Cas camion AG motorisé + vélo cargo (A Toutes!)** :
- Skip total écran E3 : transition directe E2 → E4 au clic "Démarrer tournée" (UPDATE `statut=en_cours`, `heure_reelle_debut`, S3, audit — transition `acceptee` → `en_cours`)
- Pas de checklist

### W4 — Départ collecte + géolocalisation arrivée

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Clic "Démarrer" sur 1ère collecte de la tournée depuis E4 | |
| 2 | Système | UPDATE `collectes_tms.statut_operationnel=en_route` | |
| 3 | Système | Active geofence monitoring 300m autour `lieux.coords_gps` | Via Background Sync API (D6) |
| 4 | Chauffeur | Conduit vers le lieu (Waze/Maps externe) | — |
| 5 | Système | Détection entrée geofence (fréquence basse D6 + boost transitions) | |
| 6 | Système | Transition auto `en_route` → `arrivee` + toast "Tu es arrivé à <lieu>" | |
| 7 | Chauffeur | Ouvre E5 (auto push ou tap collecte) | |
| 8 | Chauffeur | Clic "Commencer collecte" | UPDATE `statut_operationnel=en_cours` |

**Fallback GPS off/KO (D5)** :
- Bouton "J'arrive" visible dès `en_route` (pas de délai 3 min override Val)
- Clic → transition manuelle `arrivee` + audit log `geoloc_fallback=true`
- Audit log `M05_ARRIVEE_GEOLOC_FALLBACK` seul pour détection abus a posteriori (SQL ad-hoc Admin TMS) — widget M11 supprimé revue sobriété §05 2026-05-01 A4

### W5 — Pesée ZD avec auto-tare contenant

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Depuis E5 détail collecte ZD, clic "Peser un flux" | → E6 |
| 2 | Chauffeur | Sélectionne flux (aucune présélection — choix explicite, cf. E6 2026-04-30) | |
| 3 | Chauffeur | Sélectionne contenant (aucune présélection — choix explicite à chaque pesée, D7) | Tare auto depuis `types_contenants.tare_kg` |
| 4 | Chauffeur | Saisit poids brut (clavier numérique) | Calcul live : brut − tare = net |
| 5 | (optionnel) Chauffeur | Toggle "Corriger la tare" + saisit motif + tare custom | UPDATE local, audit `action=PESEE_TARE_OVERRIDE` |
| 6 | Chauffeur | Prend ≥1 photo | Blob IndexedDB (offline-safe) |
| 7 | Chauffeur | Clic "Enregistrer la pesée" | |
| 8 | Système | INSERT `pesees` local + sync queue `sync_status=pending` | `idempotency_key=uuid()` |
| 9 | Système | Pas de webhook unitaire V1 — pesée conservée en local jusqu'à la clôture collecte (W8) où agrégation dans S5 `collecte-terminee` batch | Simplification V1 (cf. §08 ligne 840) |
| 10 | Système | Si offline : stocké en queue, retry au retour réseau (W11) | |
| 11 | Système | Retour E5 + toast "Pesée enregistrée" + mise à jour liste pesées | |

**Edge case** : contenant `sans_contenant` + poids brut 0 → confirmation UI 2 clics avant INSERT.

### W6 — Capture AG signature + équivalent repas

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Depuis E5 détail collecte AG, clic "Capturer la collecte" | → E7 |
| 2 | Chauffeur | Saisit nom asso (auto-complete) + représentant | |
| 3 | Système | Affiche poids total (agrégé des pesées E6 si existantes, sinon saisie manuelle) | |
| 4 | Système | Calcule équivalent repas live : `poids / plateforme.parametres_algo.poids_par_repas_kg` (défaut 0,45 — audit sobriété 2026-05-09 B2, source unique Plateforme cross-schema) | |
| 5 | Chauffeur | Signe (canvas tactile) | PNG compressé base64 |
| 6 | Chauffeur | Clic "Enregistrer la signature" | |
| 7 | Système | INSERT `collectes_tms.signature_url` (upload Storage Supabase) | `bucket=tms-signatures` |
| 8 | Système | Retour E5 + toast "Signature enregistrée" | |

**Cas "Aucun repas à collecter"** (AG-only, cf. mémoire feedback AG vs ZD) :
- Chauffeur clique bouton dédié depuis E5 AG
- Dialog : motif obligatoire (dropdown `client_annule`, `pas_de_surplus`, `autre`) + commentaire
- UPDATE `collectes_tms.statut_operationnel=realisee_sans_collecte` + INSERT `pesees` avec `source=ag_sans_collecte` poids 0
- Webhook S5 `collecte-terminee` émis (poids 0, `source=ag_sans_collecte`)
- **Si `prestataire.integration_externe = 'everest'` (A Toutes!)** : → **Retiré V1 (revue sobriété §05 2026-05-01 A5)** — W5 reporté V1.1 (Q1 endpoint Everest non confirmé). V1 = webhook S5 émis vers Plateforme normalement + **Ops appelle A Toutes! manuellement** au moment de la clôture `realisee_sans_collecte`. La mission Everest reste `in_progress` jusqu'au prochain webhook entrant Everest (W2 `mission_finished`/`mission_cancelled`).
- Retour E4

### W7 — Signalement incident / accès refusé

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Depuis E5, clic "Signaler incident" | → E9 |
| 2 | Chauffeur | Choisit catégorie (tuile) | |
| 3 | Chauffeur | (optionnel) Photo + commentaire | |
| 4 | Chauffeur | (optionnel) Clic "Appeler traiteur" ou "Appeler Ops" | `tel:` OS natif + audit `CALL_TRIGGER` |
| 5 | Chauffeur | Clic "Enregistrer le signalement" | |
| 6 | Système | UPDATE `collectes_tms.statut_operationnel` selon catégorie (cf. §cycle de vie) | |
| 7 | Système | INSERT `incidents` (table §04, push Plateforme M11) | `type_incident`, `photos`, `description` |
| 8 | Système | Webhook S9 `incident` émis (toute catégorie) avec `statut_collecte_apres` selon bloquant/non-bloquant | `echec_acces` si `acces_refuse` / `client_absent` ; `inchange` si `probleme_tri` / `autre` *(revue sobriété M05 E9 2026-04-30 — confirmée Bloc D D3 : `incident` fusionné dans `inchange`)* ; `annulee` si `client_annule_avant_arrivee`. *(`pas_excedents`→`realisee_sans_collecte` retiré décision 2026-06-06 : ce cas passe par E5→S5.)* |
| 9 | Système | Retour E4 + toast "Signalement enregistré" | |

### W8 — Clôture collecte ZD (après pesées)

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Depuis E5, clic "Terminer collecte" | Validation : ≥1 pesée |
| 2 | Système | UPDATE `collectes_tms.statut_operationnel=realisee`, `heure_fin_reelle=NOW()` | (R_M05.18 présomption 0kg supprimée revue sobriété 2026-04-29 avec `flux_prevus`) |
| 3 | Système | POST webhook S5 `collecte-terminee` batch (pesees[] réelles uniquement) → Plateforme | `idempotency_key` UUID par pesée, `source` enum 2 valeurs |
| 4 | Système | Si offline : queue IndexedDB, retry W11 | Payload S5 complet persisté |
| 5 | Système | Retour E4 + toast "Collecte terminée" | |
| 6 | Système | Vérifie R_M04.4 : si toutes collectes terminales → suggère bouton "Terminer tournée" E4 sticky | |
| 7 | Système | Audit log `action=COLLECTE_REALISEE` | |

### W9 — Clôture tournée

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Clic "Terminer la tournée" sticky E4 | → E8 |
| 2 | Système | Capture GPS (navigator.geolocation, high accuracy ponctuelle D6) | |
| 3 | Chauffeur | Clic "Confirmer la fin de tournée" | |
| 4 | Système | Applique W5 étapes 2-5 de M04 (contrôle géoloc, UPDATE statut `terminee`) | Plus d'action pesée à ce stade |
| 5 | Système | Applique W5 étapes 6-9 de M04 (R2 calcul coût, recalcul marge Plateforme via trigger DB `fn_recalc_marge_tournee()` ex-S6, S3 tournee-upsert terminée, audit) | Plus d'émission pesée à ce stade (revue sobriété 2026-04-29) |
| 6 | Système | Retour E2 + toast "Tournée terminée" | |

### W10 — Déclaration stocks matériel (optionnelle, V1.1)

Reporté V1.1. Décrit dans M09 (hors périmètre M05 V1).

### W11 — Sync différée queue offline

**Déclencheurs** :
- Retour réseau (event `online`)
- Ouverture PWA après coupure
- Background Sync API (Chromium, Safari 16.4+ limité)

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Système | Détecte retour réseau | Event listener |
| 2 | Système | Parcourt queue IndexedDB triée par `created_at` | |
| 3 | Système | Pour chaque item `pending` : retry POST webhook avec `idempotency_key` | |
| 4 | Système | Si succès → marque `sync_status=synced`, supprime de la queue | |
| 5 | Système | Si échec 5× consécutifs (HTTP 5xx) → `sync_status=dlq`, alerte M11 | |
| 6 | Système | Si conflit (ex : collecte déjà `realisee` côté serveur, D1 option b) → accepte/merge selon policy serveur ou DLQ | |
| 7 | Système | Affiche indicateur "Synchronisation en cours : N éléments" dans UI si queue > 0 | |

**Règles** :
- Cap queue = 3 tournées + 150 photos (~300 Mo) (D2)
- Si cap atteint + nouveau item → refus stockage + toast "Queue pleine. Connecte-toi à un réseau." (cas extrême — documenté C7)

### W12 — Réception push notifications

**Déclencheurs serveur** (D16 : tiercé a+c+d) :
- Attribution tournée (chauffeur assigné par manager → push M03)
- Rappel H-30 avant `tournees.heure_planifiee_debut` (pg_cron Supabase) — propagation 2026-04-29
- Alerte Ops : retard, anomalie (déclenchée par M11)

**Flow** :
1. Service worker reçoit push event (Web Push API, VAPID keys)
2. SW affiche notification native (titre + body + icône + action buttons si pertinent)
3. Chauffeur tap → ouvre PWA sur E2 (ou écran contextuel si deep link)

**Paramétrage** :
- Inscription push au 1er onboarding (W1 étape 7) + toggle paramètres (V1.1)
- Pas de notification spam : cap 1 push/collecte/heure

### W13 — Confirmation passage Veolia **SUPPRIMÉ — revue de sobriété 2026-04-30 A1**

> **Suppression V3 sobre 2026-04-30** : workflow W13 (modal confirmation passage Veolia au démarrage tournée ZD chauffeur) entièrement supprimé. M05 ne fait plus aucun check `passages_veolia` ni d'appel API `/tms/passages-veolia/{id}/confirmer-chauffeur` ou `/signaler-bacs-pleins`.
>
> **Motif** : ratio complexité/fréquence cassé (~150 passages/an = ~3 passages/semaine pour potentiellement 5-10 tournées ZD/jour → modal quasi systématique pour un signal rare). Le frottement UX systématique sur app chauffeur 4G dégradée n'était pas justifié pour un cas dont le signal qualité est déjà couvert par R5.6 (recomptage Ops trace écarts dans `audit_logs`).
>
> **Nouvelle responsabilité M10 V3** : la déclaration `realise` par Ops (E5 avec checkbox `verification_video_at` obligatoire) vaut confirmation effective et déclenche reset stock immédiat (R5.4 v3). Plus de second flux applicatif côté chauffeur.
>
> **Impact M05** : étape 8-bis de W3 (déclenchement W13 confirmation Veolia) supprimée. La transition `démarrage tournée → géofence` reste inchangée pour le reste. Aucune intégration M10↔M05 V1 hors lecture de `passages_veolia` à des fins informatives futures (aucune fonction côté chauffeur V1).

---

## 7. Edge cases

### C1 — Perte connexion pendant saisie pesée

**Comportement** : données saisies persistées IndexedDB à chaque action (optimistic UI). Au retour réseau, W11 sync. Chauffeur ne remarque rien (UX seamless).

### C2 — Plaque saisie ≠ véhicule référentiel prestataire — **Retiré V1 (propagation M05 2026-06-04, suppression saisie plaque terrain)**

Plus de saisie plaque chauffeur → plus de cas de divergence terrain/référentiel.

### C3 — GPS indisponible au démarrage tournée

**Comportement** : géofence inactive, bouton "J'arrive" disponible immédiatement (D5 override Val). Transitions manuelles. Audit log `geoloc_fallback=true` + `M05_ARRIVEE_GEOLOC_FALLBACK` toutes les arrivées, exploité en SQL ad-hoc par l'Admin TMS (widget M11 supprimé revue sobriété §05 2026-05-01 A4).

### C4 — Photos prises sans réseau

**Comportement** : stockage Blob IndexedDB avec référence pesée, upload Supabase Storage différé au retour réseau. Cap 150 photos par queue (D2). Si cap atteint, toast "Queue photo pleine, connecte-toi."

### C5 — Device perdu/volé (urgence sécurité)

**Comportement** : Admin TMS peut invalider toutes les sessions d'un chauffeur depuis back-office M06 fiche chauffeur (bouton "Déconnecter tous les appareils"). Au prochain ping PWA, session invalide → redirect E1. Audit log `action=FORCE_LOGOUT` avec auteur.

### C6 — Changement chauffeur in-flight (V1.1 reporté, D11)

**Comportement V1** : pas de workflow M05. Ops traite via M04 W6 remplacement chauffeur (desktop back-office). Nouveau chauffeur (s'il n'a pas encore de compte) reçoit email "Définir mon mot de passe" avec **magic link 30 min** (revue sobriété §05 2026-05-01 B1 — chemin "password provisoire" supprimé V1) — s'il a déjà un compte, il voit simplement la tournée apparaître dans son accueil à la prochaine ouverture PWA. L'ancien chauffeur voit la tournée disparaître de son accueil (RLS).

### C7 — Queue offline saturée (>300 Mo ou >3 tournées)

**Comportement** : toast "Queue pleine. Connecte-toi à un réseau pour synchroniser." + désactivation UI de création de nouvelles pesées/photos jusqu'à sync partielle. Cas extrême (pattern prolongé sans réseau >8h). Alerte M11 si détecté.

### C8 — Conflit sync : collecte modifiée côté serveur pendant offline chauffeur

**Comportement (D1 option b)** : si le serveur accepte le statut (compatible), merge. Sinon DLQ + alerte M11. Exemple : Ops a passé `statut=annulee` côté back-office pendant que le chauffeur `realisee` offline → DLQ, Ops arbitre.

### C9 — Chauffeur oublie de terminer tournée

**Comportement (R_M04.4)** : la tournée reste `en_cours` jusqu'à clôture manuelle. Si >8h inactivité → alerte M11 warning + Ops peut forcer clôture W9 M04. (Plus de présomption 0kg à la clôture — R_M05.18 supprimée revue sobriété 2026-04-29.)

### C10 — Reload nouvelle version PWA en cours de tournée

**Comportement (D3)** : bannière discrète "Nouvelle version dispo, redémarrage à la fin de la tournée." Pas de reload forcé. Kill switch serveur `force_update=true` prime en cas de bug critique sécurité (rare).

### C11 — Signalement doublon (2 collectes, même incident)

**Comportement** : chaque signalement est indépendant (tied à `collecte_tms_id`). Si c'est le même incident pour 2 collectes du même lieu dans la même tournée, le chauffeur signale chacune. Pas de dédup auto V1.

### C12 — "Sans contenant" avec poids brut = 0

**Comportement** : confirmation UI 2 clics ("Tu confirmes une pesée à 0 kg ?"). INSERT pesée `source=chauffeur`, poids net = 0. Cas limite : sac vide retourné ou erreur de saisie. **Audit V1** : INSERT `tms.audit_logs` action `M05_PESEE_ZERO_KG` (acteur = chauffeur, diff = `{pesee_id, contenant, collecte_id}`) — exploitation a posteriori Admin TMS via SQL ad-hoc. → **supprimée revue sobriété §05 2026-05-01 A3** (code `pattern_pesee_zero_kg` jamais seedé au catalogue, R_M11.1 violation latente — audit log + requête SQL admin suffisent V1).

### C13 — Appel "Appeler traiteur" avec numéro manquant côté référentiel

**Comportement** : bouton désactivé avec tooltip "Numéro traiteur non renseigné, contacte Ops". Button "Appeler Ops" toujours actif (numéro Ops en paramètre TMS configurable).

### C14 — Tentative de connexion simultanée 2 devices

**Comportement (D12)** : invalidation session ancienne + toast sur device éjecté "Tu as été déconnecté car l'app a été ouverte sur un autre appareil." Chauffeur doit re-login.

---

## 8. Architecture offline-first

Section spécifique M05 — pattern non applicable aux autres modules.

### 8.1 Stack

- **Service Worker** via **Serwist** (`@serwist/next` v9+, propagation §12 D3 2026-04-27 — fork moderne de `next-pwa`, support natif Next.js 15 App Router) : cache static (HTML, CSS, JS, fonts, icons) `CacheFirst` + cache runtime tournées/collectes `NetworkFirst` + Background Sync queue + offline fallback UI
- **IndexedDB** : queue sync (`sync_queue` object store) + données terrain persistées (`pesees_local`, `signatures_local`, `photos_local` Blob)
- **Background Sync API** : retry différé à la reconnection (Chromium Android), Safari iOS 16.4+ partiel
- **Web Push API** : notifications server-push (VAPID keys, **Edge Function Supabase `tms.push_send` + lib `web-push`** — confirmé §12 D5 2026-04-27, alignement §07.6.1 mis à jour)

### 8.2 Stratégie sync

**Modèle** : eventual consistency via webhooks idempotents.

- Toute mutation terrain (INSERT pesée, UPDATE statut, INSERT signature, photo upload) → ligne `sync_queue` avec `idempotency_key=uuid()`, `payload`, `endpoint`, `created_at`, `sync_status (pending/synced/dlq)`, `retries`
- Job worker PWA : à chaque event `online` + polling 2 min si en ligne, pop la queue, retry HTTP POST avec idem key
- Serveur (Edge Function) : check idem key en DB — si déjà traité → return 200 (noop) ; sinon → INSERT + emit webhook
- Cap 5 retries consécutifs 5xx → DLQ + alerte M11
- Conflit 4xx (ex : collecte terminée côté back-office) → policy D1 option b : merge si compatible, sinon DLQ

### 8.3 Capacité et gestion du cap

- Queue max : 3 tournées + 150 photos (~300 Mo moyenne) — D2
- Photos JPEG qualité 80% (pre-spec §03) : ~1 Mo par photo
- Surveillance capacité : service worker calcule taille IndexedDB à chaque INSERT, avertit chauffeur à 80%, refuse à 100%
- Purge auto : dès `sync_status=synced`, data supprimée (photos Blob incluses, elles vivent désormais sur Supabase Storage)

### 8.4 Conflits fréquents et policy

| Cas | Policy |
|---|---|
| Pesée insérée offline, collecte passée `annulee` côté serveur entre-temps | DLQ + alerte Ops, arbitrage manuel |
| Statut collecte `realisee` local + `incident` serveur | DLQ — incompatible |
| Signature AG insérée offline, collecte passée `annulee` | DLQ + alerte Ops |
| Photo uploadée 2× (retry après timeout ambigu) | Idem key déduplique — 1 seul INSERT |

---

## 9. Intégration cross-module

### M01 — Réception ordres de collecte
Source des collectes (via M04 W1 constitution tournée). M05 n'interagit pas directement avec M01.

### M02 — Dispatch Ops Savr
Les collectes dispatchées M02 sont lues en read-only par M05 pour afficher à l'accueil chauffeur.

### M03 — Portail prestataire self-service
Le manager assigne chauffeur/véhicule sur la tournée via M03. M05 est notifié via push (D16) à l'attribution.

### M04 — Gestion des tournées
M05 est l'**exécuteur** des tournées. Toutes les transitions `acceptee` → `en_cours` → `terminee` sont déclenchées via M05 (la tournée est `acceptee` = prête avant que le chauffeur la démarre, cf. cycle de vie M04 §4 2026-06-06). R_M04.4 (clôture auto tournée via collectes terminales) reste appliquée à la clôture tournée par M04. (Plus de présomption 0kg V1 — R_M05.18 supprimée revue sobriété 2026-04-29.)

### M06 — Référentiel prestataires
Source des chauffeurs (auth), véhicules (auto-complete plaque), contenants (auto-tare table D9). M05 lit en read-only via RLS chauffeur (D12 : `chauffeur_id = current_user.id`).

### M08 — Facturation prestataires
Alimenté via le recalcul de marge Plateforme déclenché par clôture M05 → M04 (trigger DB `plateforme.fn_recalc_marge_tournee()`, ex-webhook S6 supprimé §08 A2).

### M09 — Stock matériel Savr
V1.1 : workflow déclaration stocks fin de tournée. V1 : hors M05.

### M11 — Alerting et monitoring ops
M05 émet 5 alertes automatiques (revue sobriété M05 E9 2026-04-30 : suppression `panne_vehicule_signalee` ; revue sobriété §05 2026-05-01 A3 : suppression `pattern_pesee_zero_kg` ; revue sobriété §05 2026-05-01 A4 : suppression `arrivee_sans_geoloc` info/widget — audit_logs `M05_PESEE_ZERO_KG` + `M05_ARRIVEE_GEOLOC_FALLBACK` conservés seuls ; propagation M05 2026-06-04 : suppression `plaque_saisie_non_conforme` + `plaque_inconnue_prestataire`, suppression saisie plaque terrain) :
- `pesee_anormale_hors_seuil` (warning) — alerte côté Ops uniquement, AUCUN affichage côté chauffeur (revue sobriété M05 E6 2026-04-30)
- → **supprimée propagation M05 2026-06-04** (plus de saisie plaque chauffeur)
- → **supprimée revue sobriété §05 2026-05-01 A4** (widget M11 retiré, criticité `info` déjà dégagée Bloc 3 sobriété 2026-04-25 A1 ; trace conservée via audit_log `M05_ARRIVEE_GEOLOC_FALLBACK` exploité SQL ad-hoc Admin TMS)
- `cloture_hors_zone` (warning via M04)
- `queue_offline_saturation` (warning)
- `sync_dlq_item` (warning)
- `force_update_applied` (info)
- → **supprimée revue sobriété §05 2026-05-01 A3** (code jamais seedé au catalogue M11, R_M11.1 violation latente ; audit_log `M05_PESEE_ZERO_KG` exploité via SQL admin suffit V1)
- → **supprimée propagation M05 2026-06-04** (plus de saisie plaque chauffeur)

### M13 — Administration TMS
Paramètres M05 configurables par Admin TMS (cf. §11).

### M14 — Intégration Everest (A Toutes!)
Les collectes AG vélo sont exécutées via M05 avec parcours allégé (checklist EPI vélo, pas de plaque). Everest missions synchronisées par M14.

---

## 10. Contrat API (récap webhooks M05)

Sortants TMS → Plateforme (déclenchés par M05, cf. [[08 - Contrat API Plateforme-TMS]]) :

| ID | Endpoint | Déclencheur M05 |
|---|---|---|
| S3 | `POST /webhooks/tms/tournee-upsert` | Transitions `en_cours`, `terminee` (via M04) |
| S5 | `POST /webhooks/tms/collecte-terminee` | Clôture collecte (W6/W8) — batch pesées agrégées (`pesees[]` avec `idempotency_key`, `source`, `contenant_code`, `tare_override_motif`, `photos`) |
| S9 | `POST /webhooks/tms/incident` | Signalement E9 (4 catégories : `acces_refuse`, `client_absent`, `probleme_tri`, `autre` — `pas_excedents` retiré décision 2026-06-06, passe par E5→S5) — `statut_collecte_apres=echec_acces` si `acces_refuse`/`client_absent`, `inchange` sinon |

> **Note S7 (propagation M05 2026-06-04)** : le webhook S7 `plaque-saisie` **n'est pas déclenché par M05**. Il est émis par le **manager prestataire** depuis M03 E4 (pré-saisie plaque + nom chauffeur pour contrôle d'accès). M05 ne produit plus aucune donnée de plaque depuis la suppression de la saisie chauffeur. (Lève l'ancienne mention erronée « S7 supprimé C3 / lecture cross-schema `plaque_saisie_terrain` » qui confondait les deux plaques.)

**Idempotence** : tous les webhooks avec `event_id` UUID par événement. Queue offline PWA insert avec `idempotency_key`.

**Fan-out serveur Plateforme (D9 M04)** : email T+3h client **retiré V1 (propagation Q10 M05 2026-04-24)**. La persistance registre transport M08 + l'affichage contrôle d'accès traiteur sont assurés par la **plaque manager** (`plateforme.tournees.plaque_immatriculation` alimentée par S7 depuis M03 E4), indépendamment de M05.

---

## 11. Règles métier spécifiques M05

### R_M05.1 — Checklist pré-départ bloquante (révisée revue sobriété 2026-04-29)

Tournée ne peut pas passer en `en_cours` tant que tous les items obligatoires de la checklist E3 ne sont pas validés. **Matrice véhicule × ZD/AG** :

| Type véhicule         | ZD                                             | AG                          |
| --------------------- | ---------------------------------------------- | --------------------------- |
| Camion frigo motorisé | Tenue Savr + N rolls + Film plastique          | Skip total écran E3 (E2 → E4 direct) |
| Vélo cargo            | Skip total écran E3 (E2 → E4 direct)           | Skip total écran E3         |

Conformité véhicule/EPI = responsabilité manager prestataire (M03). Suppressions : sections EPI 4 items, véhicule (état/niveaux/feux), photos, cas A/B plaque, audit `PLAQUE_OVERRIDE_CHAUFFEUR`, alerte M11 `m05_plaque_override_chauffeur`, **item Plaque (saisie chauffeur, propagation M05 2026-06-04) → seul item AG, son retrait supprime l'écran E3 pour le camion AG motorisé**. Détail spec : §05 R_M05.1 + E3 ci-dessus.

### R_M05.2 — Saisie plaque par chauffeur uniquement — **Retirée V1 (propagation M05 2026-06-04, arbitrage Val)**

Plus de saisie plaque par le chauffeur. La plaque pour contrôle d'accès / registre est la plaque **pré-saisie manager** (M03 E4, webhook S7). Colonne `plaque_saisie_terrain` supprimée (§04).

### R_M05.3 — Auto-tare contenant paramétrable (D7/D8/D9)

Tare par contenant stockée dans `types_contenants.tare_kg` (Admin TMS). Chauffeur sélectionne le contenant à chaque pesée via dropdown E6 (**aucune présélection** — choix explicite, le contenant peut varier au sein d'une même collecte, D7). Contenants gérés par Admin TMS (M13). Aligné §05 R_M05.3.

### R_M05.4 — Override manuel tare avec motif obligatoire (D8)

Si le chauffeur active le toggle "Corriger la tare" E6 et saisit une tare différente de la tare snapshot attendue, un motif texte libre ≥ 10 caractères est obligatoire. Audit log `action=PESEE_TARE_OVERRIDE` (before/after + motif), stocké `pesees.tare_override_motif`. *(Aligné §05 R_M05.4 ; ex-règle "Présélection contenant par pesée précédente" supprimée — propagation E6 2026-04-30, plus de présélection V1, fin du désalignement de numérotation avec §05.)*

### R_M05.5 — "Sans contenant" = pesée sac direct

Contenant `sans_contenant` (D7 override Val) : tare = 0, poids brut = poids net. Confirmation 2 clics si poids brut = 0.

### R_M05.6 — Équivalent repas AG = 0,45 kg/repas

Formule V1 : `nb_repas = round(poids_total_kg / plateforme.parametres_algo.poids_par_repas_kg)` (défaut 0.45 — audit sobriété 2026-05-09 B2). Affichage live en E7. **Source unique cross-app** : le coefficient est défini côté Plateforme (`parametres_algo`). V2 TMS lit cross-schema, pas de paramètre miroir `parametres_tms` (suppression `m05_equivalent_repas_kg`). Conversion documentée CDC App §06/09 + §04 Data Model `parametres_algo`.

### R_M05.7 — Geofence uniforme 300m (D4 override Val)

Rayon geofence 300m autour `lieux.coords_gps` pour tout type de lieu (simplicité, aligné seuil contrôle clôture M04).

### R_M05.8 — Fallback géoloc immédiat (D5 override Val, simplifié revue sobriété §05 2026-05-01 A4)

Bouton "J'arrive" disponible dès `en_route`, pas de délai 3 min. **Audit log seul** (`tms.audit_logs` action `M05_ARRIVEE_GEOLOC_FALLBACK`) pour détection abus a posteriori via SQL ad-hoc Admin TMS. supprimés revue sobriété §05 2026-05-01 A4 (réintroduction V1.1 si abus systémique observé).

### R_M05.9 — Queue offline cap 3 tournées + 150 photos (D2)

Cap dur. Au-delà, blocage UI création nouvelle donnée + toast. Alerte M11 si détecté.

### R_M05.10 — Device binding 1 device actif (D12, volet device binding conservé)

Un seul device actif par chauffeur. Nouvelle connexion invalide l'ancienne. Pas de multi-device V1. **Note** : volet méthode d'auth (magic link → email+password) retourné 2026-04-24 par propagation M03, le device binding reste valide.

### R_M05.11 — Session 30 jours rolling (D13)

Session JWT + refresh silencieux si device actif. Invalidation explicite via Admin TMS (C5) ou re-login autre device (D12).

### R_M05.19 — Auth chauffeur email + password (retournement D12 volet méthode, propagation M03 2026-04-24)

Chauffeur s'authentifie avec email + password (min 8 caractères, hash argon2 Supabase Auth). Retournement de la décision D12 originale qui imposait magic link. Justif : accès email terrain non garanti, password notable sur papier plus robuste, unification stack (1 seul flow auth TMS). Reset password via magic link 30 min (fallback). Device binding D12 conservé, rate limit 5 tentatives/15min/IP, message d'erreur unifié anti-énumération. Détail : voir [[../09 - Authentification et permissions TMS#Addendum 2026-04-24 (propagation M03)]].

### R_M05.12 — Push notifications a+c+d (D16)

Déclencheurs V1 : attribution tournée + rappel H-30 + alerte Ops retard/anomalie. Skip rappel J-1 20h (faible valeur, fatigue).

### R_M05.13 — RGPD purge 30 jours géolocalisation

Coordonnées GPS purgées J+30 via pg_cron Supabase (`tournees.cloture_gps=null`, `collectes_tms.arrivee_gps=null`, etc.). Photos et signatures conservées selon règles Plateforme (archivage 6 ans obligations légales).

### R_M05.14 — PWA reload différé fin tournée (D3)

Sauf kill switch `force_update=true` (rare), reload nouvelle version PWA attend la fin de la tournée active. Bannière informative discrète.

### R_M05.18 — Présomption 0kg auto à la clôture collecte — **Supprimée V1 (revue sobriété 2026-04-29)**

Règle retirée définitivement avec la suppression de `flux_prevus`. Le rapport recyclage Plateforme se base désormais uniquement sur les flux **réellement** pesés par le chauffeur. Plus d'auto-insertion à 0kg, plus de distinction "non pesé" vs "non concerné" côté Plateforme.

Conséquences propagées :
- Enum `pesees.source` 3→2 valeurs (`chauffeur`, `ag_sans_collecte`)
- Webhook S5 : flag `presume_non_pese` retiré du payload
- W8 simplifié : plus d'algo SQL pré-émission S5

---

## 12. Paramètres configurables (M13)

Tous dans `parametres_tms.parametres` (JSONB) :

| Clé | Défaut V1 | Description |
|---|---|---|
| `m05_geofence_rayon_metres` | 300 | Rayon geofence arrivée lieu (D4) |
| `m05_queue_offline_max_tournees` | 3 | Cap nombre tournées queue |
| `m05_queue_offline_max_photos` | 150 | Cap nombre photos queue |
| `m05_queue_offline_max_size_mb` | 300 | Cap taille globale queue |
| → `m03_password_reset_ttl_min` | → 30 | **Retournée propagation M03 2026-04-24** : paramètre renommé + déplacé sur domaine M03 (politique password unifiée manager + chauffeur). Sert désormais au TTL du magic link de reset password uniquement (pas login). |
| `m03_login_rate_limit_per_15min` | 5 | **Nouveau M03** : rate limit login 5 tentatives échouées / 15 min / IP (brute force protection) |
| `m03_password_min_length` | 8 | **Nouveau M03** : longueur minimum password manager + chauffeur (politique unifiée) |
| `m03_password_reset_max_per_day` | 3 | **Nouveau M03** : max reset password / email / 24h (anti-abus) |
| `m05_photo_qualite_jpeg` | 80 | Compression JPEG |
| `m05_photo_max_par_pesee` | 5 | Limite photos par pesée |
| `m05_seuils_pesees_kg_min_max_par_flux` | JSONB enum flux → {min, max} | Seuils alerte pesée anormale (ZD-only) — **alerte côté Ops uniquement, AUCUN affichage côté chauffeur** (revue sobriété M05 E6 2026-04-30) |
| `m05_push_cap_par_heure_par_collecte` | 1 | Cap notifs spam |
| `m05_tournee_inactivite_heures` | 8 | Seuil R_M04.4 |
| `m05_ops_numero_telephone` | (num Ops Savr) | Numéro "Appeler Ops" E5/E9 |
| `m05_force_update_mode` | `off` | **Kill switch reload PWA (enum 3 valeurs, revue sobriété 2026-06-04 B3 — fusion des ex-booléens `m05_force_update_active` + `m05_force_update_strict`)** : `off` = pas de forçage (défaut) ; `soft` = toast bannière non-bloquant + bouton "Recharger" + grace period 24h max (au-delà : escalade modal) ; `hard` = modal bloquant immédiat au boot PWA "Mise à jour requise" (urgence sécurité critique). Supprime l'état invalide ex-`active=false`+`strict=true`. |

Évolution V1.1 : (supprimée — cf. E6 2026-04-30), `m05_push_rappel_j_moins_1_active` (si retour terrain), `m05_mode_soleil_auto_active` (ambient light API).

---

## 13. Décisions prises

Les 20 arbitrages tranchés session 2026-04-24.

**Catégorie Auth / Session**

1. **D12 — Device binding** : 1 seul device actif par chauffeur. Nouvelle connexion invalide l'ancienne. Justif : simplicité sécurité + cohérence queue offline (source de vérité unique), évite plaque saisie simultanément depuis 2 devices. **Volet méthode d'auth retourné 2026-04-24 par propagation M03** : magic link → email + password (cf. D24 ci-dessous). Le device binding lui-même reste valide.

2. **D13 — Durée session** : 30 jours rolling (option c). Justif : re-login quotidien inacceptable pour chauffeurs digital-low, device binding (D12) limite risque vol, refresh silencieux si device actif.

3. **D14 — → Flow reset password (retournée 2026-04-24 propagation M03)** : le fallback en cas de password perdu est un **magic link reset** (TTL 30 min via `m03_password_reset_ttl_min`) déclenché par lien "Mot de passe oublié" sur E1. Si le chauffeur n'a pas accès email, `tel:` Ops en dernier recours (paramètre `m05_ops_numero_telephone`). Justif : retournement D12 volet méthode vers email + password rend le magic link natif obsolète, mais il reste précieux comme vecteur de reset.

4. **D24 — Auth chauffeur email + password (NOUVELLE 2026-04-24 propagation M03)** : email + password (min 8 caractères, hash argon2id Supabase Auth natif) au lieu de magic link (retournement D12 volet méthode). Justif : accès email terrain non garanti pour chauffeurs ponctuels, password notable sur papier plus robuste, unification stack (1 seul flow auth manager + chauffeur). Rate limit 5 tentatives/15min/IP (paramètre `m03_login_rate_limit_per_15min`), message d'erreur unifié anti-énumération, autocomplete navigateur `current-password`. Détail cross-CDC : [[../09 - Authentification et permissions TMS#Addendum 2026-04-24 (propagation M03)]].

5. **D20 — Switch contexte manager ↔ chauffeur** : V1.1 reporté, MVP chauffeur pur (option c). Justif : cas rare, portail manager desktop vs PWA chauffeur mobile ont UX divergentes, fusion dégrade les 2.

**Catégorie Offline / Sync**

5. **D1 — Résolution conflits sync** : accepter si statut compatible, sinon DLQ (option b). Justif : chauffeur ne perd jamais son travail terrain, Ops arbitre uniquement en cas de conflit réel.

6. **D2 — Taille max queue offline** : 3 tournées + 150 photos (~300 Mo) (option b). Justif : enchaînement matin+AM sans saturer les smartphones ≥ 64 Go (90% parc 2026).

7. **D3 — Déploiement nouvelle version PWA** : reload fin tournée + kill switch (option b). Justif : pas de coupure mi-saisie, kill switch serveur `force_update` pour bugs bloquants sécurité.

**Catégorie Géolocalisation**

8. **D4 — Rayon geofence arrivée** : **300m uniforme** (option c override Val). Justif : simplicité max, aligné seuil contrôle clôture M04, pas de différenciation par type de lieu.

9. **D5 — Fallback GPS off/KO** : **bouton "J'arrive" dispo immédiat** (option a override Val). Justif : contrat de confiance chauffeur V1, détection fraude a posteriori via audit_log `M05_ARRIVEE_GEOLOC_FALLBACK` (widget M11 supprimé revue sobriété §05 2026-05-01 A4).

10. **D6 — Fréquence géoloc (batterie)** : permanent basse + boost transitions (option b). Justif : pattern Uber/Deliveroo, évite drain batterie vacation 8h, pas de complexité accéléromètre.

**Catégorie Pesées / Contenants**

11. **D7 — Sélection contenant auto-tare** : **dropdown à chaque pesée + option "Sans contenant"** (option a override Val + ajout). Justif : contenant varie pesée par pesée (ex : biodéchet en 2 bacs 240L + 1 roll), "Sans contenant" = pesée sac direct (poids brut = poids net).

12. **D8 — Override manuel chauffeur auto-tare** : oui avec motif obligatoire (option b). Justif : terrain = cas limite systématique (balance externe, contenant non standard), motif obligatoire = traçabilité sans friction bloquante.

13. **D9 — Paramétrage valeurs tares** : paramétrable Admin TMS table `types_contenants` (option b). Justif : zéro hardcoding (principe CDC), extensible sans refacto pour futurs contenants.

**Catégorie Plaque / Véhicule**

14. **Décision annulée — saisie plaque chauffeur retirée V1 (propagation M05 2026-06-04, arbitrage Val).** La plaque pour contrôle d'accès / registre est la plaque pré-saisie manager (M03 E4, webhook S7). *(Propagation CDC Plateforme historique conservée : suppression email client T+3h V1, template `plaque_chauffeur` retiré, `collectes.recevoir_plaque_chauffeur` + `collectes.email_plaque_envoye_at` supprimés.)*

15. **D11 — Changement véhicule in-flight** : V1.1 reporté (option b). Justif : cas rare (panne), implémenter complet = workflow lourd (re-checklist, re-plaque, re-photo, re-email), MVP = résolution manuelle Ops a posteriori via M04 W6.

**Catégorie Notifications / UX**

16. **D15 — Push PWA V1** : oui Web Push API (option a). Justif : iOS 16.4+ supporté (95% base 2026), 0 coût vs SMS, indispensable pour objectif 6 Vision TMS (délai événement→remontée < 5 min).

17. **D16 — Déclencheurs notifications** : attribution + H-30 + alerte Ops, skip rappel J-1 20h (options a + c + d). Justif : J-1 = faible valeur (planning déjà connu), tiercé opérationnel pur évite notification fatigue.

18. **D17 — Mode soleil / high contrast** : toujours contraste élevé par défaut (option c). Justif : API ambient light inégale (Safari iOS limité), toggle = friction, 1 seul mode cohérent avec principe §7 Vision "Mobile-first chauffeur".

19. **D18 — Bouton appel direct** : traiteur + Ops Savr (option a). Justif : traiteur = résolution immédiate (accès, quantité), Ops = escalade, réduit MTTR incident terrain, audit log capture les appels.

20. **D19 — Enchaînement 2 tournées/jour** : accueil liste chronologique toutes tournées (option a). Justif : visibilité = sérénité chauffeur, cas réel (Strike matin + A Toutes! AM avec ~30 prestataires), évite surprises mi-journée.

**Catégorie Sécurité (propagation §12 2026-04-27)**

21. **D25 — Bootstrap password chauffeur via magic link (refondu revue sobriété §05 2026-05-01 B1, ex-D25 force change)** : à la création du compte (M06 W3 manager + M13 E3 Admin TMS), le user est créé **sans password initial** et reçoit un email "Définir mon mot de passe" avec **magic link 30 min**. Le chauffeur clique le lien, définit son password (≥ 8 car) puis se connecte normalement. + supprimés V1 (le magic link force par construction la création du password à la 1ère connexion). Justif : sécurité renforcée (zéro password en clair transmis par email = surface d'attaque réduite), 1 chemin de code au lieu de 2 (magic link reset password EA2 déjà existant). Détail propagation : §04 (colonne `users_tms.must_change_password` supprimée), §15.4.4, M06 W3, M13 E3 + W4 force rotation, W1 étape 6-bis retirée.

---

## 14. Questions ouvertes

1. **Seuil geofence 300m** — identique M04, à calibrer sur premiers mois. Suivi du taux d'arrivées sans géoloc via requête SQL ad-hoc sur `audit_logs` (widget/dashboard M11 supprimé A4 — réintroduction V1.1 si abus systémique).

2. **Seuils pesée anormale par flux ZD** — à définir avec Ops à partir des moyennes historiques MTS-1. Valeurs initiales V1 : biodéchet [0,5; 500] kg, verre [1; 300] kg, emballage [0,5; 150] kg, carton [1; 400] kg, déchet résiduel [0,5; 800] kg. Ajustable via M13.

3. **Background Sync API Safari iOS** — support partiel. Fallback : retry à chaque ouverture PWA + polling 2 min si ouverte. Monitorer les cas d'iOS qui ne sync pas.

4. **Mode soleil auto (ambient light API)** — report V1.1 selon retour terrain.

5. **Rappel J-1 20h** — skip V1 (D16). Réintroduire V1.1 si incidents "chauffeur oublie sa tournée" remontés.

6. **Recherche textuelle historique** — V1 pas de recherche, scroll suffisant sur 30 jours. V1.1 si volume > 50 tournées/chauffeur/mois.

7. **Déclaration stocks matériel (W10)** — V1.1 reporté, intégration M09.

8. **Upload photos compression avancée** — JPEG 80% V1. Si bande passante 4G saturée pattern récurrent, explorer WebP ou compression adaptative.

9. **Multi-langue** — V1 FR uniquement. V1.1 EN si chauffeurs bilingues requis.

10. **Accessibilité a11y** — V1 contraste + taille police OK. Audit WCAG 2.1 AA V1.1.

11. **Présélection contenant par stats prestataire** — V1 = `bac_240L` défaut. V1.1 : stats par prestataire via Edge Function.

12. **Appels tracés** — V1 = audit log `CALL_TRIGGER` sans contenu. V1.1 : intégrer feedback Ops/chauffeur post-appel (court formulaire après raccrochage) ?

13. **Signature AG renforcée** — V1 = signature tactile PNG. V1.1 : ajouter horodatage GPS + photos du contenu asso pour preuve renforcée.

14. **Gestion équipier tournée** — V1 = champ affiché read-only si renseigné côté manager (W3 M04), pas d'interaction M05. V1.1 : signature équipier + binding device équipier ?

---

## 15. Propagations post-M05

### 15.1 Côté CDC TMS

À acter dans les sections TMS :

1. **§04 Data Model TMS** :
   - Table `types_contenants` (Admin TMS paramétrable, **nom canonique §04** — décision 2026-06-06) : `id`, `code` (ex `roll`, `bac_240L`, `sans_contenant`), `libelle`, `categorie`, `tare_kg`, `statut`, `created_at`
   - Table `incidents` (**nom canonique §04**, table partagée chauffeur M05 + Ops M11 — décision 2026-06-06, ex-`incidents_terrain`) : `id`, `collecte_tms_id` FK, `type_incident` enum, `photos text[]`, `description`, `declarant_chauffeur_id`, `created_at`
   - Enrichir table `pesees` : `type_contenant_id` FK → `types_contenants` (**nom canonique §04**, décision 2026-06-06), `tare_override_motif` text null, `source` enum (`chauffeur`, `ag_sans_collecte` — enum 2 valeurs post-revue sobriété 2026-04-29), `idempotency_key` UUID, `signature_url` null (pour AG), `photos text[]` (champ unique — fusion ex-`photo_url`/`photos_urls`, décision 2026-06-06)
 - Enrichir table `tournees` : **supprimée (propagation M05 2026-06-04)**, `cloture_gps`, `heure_reelle_debut/fin` — rappel
   - Nouvelle table `sync_queue_dlq` : pour items DLQ agrégés (alerte M11)
   - Nouvelle table `auth_sessions_tms` : `chauffeur_id` FK, `device_fingerprint`, `created_at`, `last_seen`, `revoked_at`

2. **§05 Règles métier TMS** :
   - Ajouter les règles R_M05.x ci-dessus (R_M05.1, 3, 4, 5–14, 19 ; R_M05.2 retirée 2026-06-04, R_M05.18 supprimée 2026-04-29)
   - Enrichir R6 cycle de vie statut collecte côté M05 (transitions déclenchées par chauffeur)

3. **§08 Contrat API Plateforme-TMS** :
   - Confirmer payload S5 `collecte-terminee` avec `source` (enum 2 valeurs), `contenant_code`, `tare_kg`, `tare_override_motif`, `idempotency_key` (flag `presume_non_pese` retiré revue sobriété 2026-04-29)
   - Payload S7 `plaque-saisie` : **émis par le manager (M03 E4), pas par M05** — aucune dépendance M05 (propagation M05 2026-06-04, suppression saisie plaque chauffeur)
   - Confirmer payload S9 `incident` avec enum **5 valeurs** (`acces_refuse`, `client_absent`, `probleme_tri`, `autre`, `client_annule_avant_arrivee` — `pas_excedents` retiré décision 2026-06-06) + `statut_collecte_apres` + `photos` + `appels_effectues` + `gravite`

4. **§09 Authentification et permissions TMS** :
   - Rôle `chauffeur` : RLS = `chauffeur_id = auth.user_chauffeur_id()` (correctif audit RLS 2026-06-05, ex-`auth.uid()`) sur `tournees`, `collectes_tms`, `pesees`, `incidents`, `auth_sessions_tms`, `chauffeurs_geolocalisation`
   - Chauffeur ne peut voir que tournées `statut IN (planifiee, en_cours)` du jour + J+1 + historique 30j
   - Chauffeur ne peut pas voir les coûts (`tournees.cout_calcule_ht`) ni grille tarifaire

5. **§03 Périmètre fonctionnel TMS** :
   - MAJ section M05 — remplacer pre-specs par référence à ce document
   - Confirmer index statut `collectes_tms` et `tournees` couverts

6. **§00 Index TMS** :
   - M05 → statut "V1 rédigée 2026-04-24"
   - Date dernière MAJ

### 15.2 Côté CDC Plateforme

Déjà propagé (Q10 M05) en fin de session précédente. Rappel 11 fichiers modifiés : §00 Index, §02 Personas, §03 Périmètre, §04 Data Model, §05 Règles métier, §06/01 Formulaire programmation, §06/02 Templates emails, §07 Architecture, §08 APIs, §11 Dashboards, §16 Roadmap.

Aucune nouvelle propagation Plateforme induite par M05 au-delà de Q10.

---

## 15bis. Alertes M11 émises par M05 (propagation M11 2026-04-24)

> **Normatif (R_M11.1)** : tous les triggers M05 utilisent `tms.alerte_emit(code, ...)` avec codes canoniques catalogue. L'app chauffeur PWA peut émettre des toasts locaux (hors scope M11 serveur) mais toute alerte persistée DB passe par le catalogue.

| Code canonique | Criticité | Trigger M05 |
|----------------|-----------|-------------|
| `m05_geofence_anomalie` | warning | Fallback "J'arrive" hors geofence 300m (D4/D5) |
| `m05_dlq_offline_conflict` | warning | Conflit sync offline non résolvable (cf. §8.4 conflits + edge cases C8/D1). **Criticité abaissée critical → warning (revue sobriété §05 2026-05-01 B2)** — un seul niveau de gravité V1, escalade humaine via traitement Ops standard. |
| `m05_queue_offline_saturee` | warning | Cap 3 tournées / 150 photos / 300 Mo atteint (R_M05.9) |
| `m05_checklist_contournement_detecte` | warning | Contournement checklist pré-départ via exploit. **Criticité abaissée critical → warning (revue sobriété 2026-06-04 B1)** — depuis le retrait de la saisie plaque, E3 ne gate plus que tenue/rolls/film (qualité opérationnelle, zéro enjeu légal/sécurité) ; un réveil Ops `critical` est disproportionné. Code canonique conservé (cf. M11 B5bis, ex-`m04_checklist_bypass`). |
| `m05_device_binding_tentative_secondaire` | warning | Tentative login chauffeur sur device secondaire (R_M05.10) |

**Résolution auto W7** : `m05_queue_offline_saturee` résolue auto dès que queue < 80 % capacité. `m05_dlq_offline_conflict` résolue auto quand entry DLQ retraitée avec succès (manuel Admin TMS).

**Codes dégagés Bloc 3 sobriété 2026-04-25 (A1 criticité `info`)** :
- `m05_realisee_sans_collecte` — l'event est déjà tracé via `collectes_tms.statut = 'realisee_sans_collecte'` (statut métier AG), pas d'alerte M11 nécessaire
- `m05_force_logout_admin` — l'event est déjà tracé dans `tms.audit_logs` côté M13 (action admin). M05 n'émet plus d'alerte M11 mais l'audit log reste obligatoire (cf. M13 W2/W7)

---

## 16. Liens

- [[00 - Index]]
- [[01 - Vision et objectifs TMS]] — Persona chauffeur, statuts ZD/AG, équivalent repas 0,45 kg
- [[03 - Périmètre fonctionnel TMS]]
- [[04 - Data Model TMS]] — `tournees`, `collectes_tms`, `pesees`, `types_contenants`, `incidents`, `auth_sessions_tms`
- [[05 - Règles métier TMS]] — R_M05.x
- [[08 - Contrat API Plateforme-TMS]] — S3, S5, S9 *(S7 plaque émis par M03, pas M05 — propagation 2026-06-04)*
- [[09 - Authentification et permissions TMS]] — RLS chauffeur
- [[M01 - Réception ordres de collecte]] — amont
- [[M02 - Dispatch Ops Savr]] — amont
- [[M04 - Gestion des tournées]] — conteneur exécution
- [[M06 - Référentiel prestataires]] — chauffeurs, véhicules, plaques, contenants
- [[01 - Cahier des charges App/08 - APIs et intégrations]] — contrat Plateforme côté récepteur
- [[01 - Cahier des charges App/00 - Index]] — propagation Q10 (suppression email T+3h) + propagation suppression saisie plaque terrain 2026-06-04
