# 12 — App mobile chauffeur

**Statut** : V1 rédigée 2026-04-27. **MAJ Bloc 3 2026-06-04** : D6 refondue (écran d'information géoloc à l'inscription, base légale intérêt légitime).
**Périmètre** : section transverse — vue d'ensemble PWA chauffeur + arbitrages techniques structurants non tranchés dans M05. **Ne re-spécifie pas** les écrans, workflows, alertes, paramètres détaillés (voir [[06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur|M05]] = source de vérité fonctionnelle).
**Persona ciblé** : Chauffeur Strike / Marathon / futurs prestataires.
**Référence transverse** : [[07 - Architecture technique TMS]] (stack), [[09 - Authentification et permissions TMS]] (auth + RLS), [[14 - Scalabilité TMS]] (perf), [[15 - Sécurité et conformité TMS]] (RGPD géoloc).

---

## 1. Objectif et portée de §12

§12 est une **couche transverse**. M05 (1188 lignes, 20 décisions, 10 écrans, 13 workflows) couvre le métier complet de l'app mobile chauffeur. §12 ne réécrit pas — elle :

1. **Identité et déploiement** : domaine PWA, stack technique consolidée, OS supportés.
2. **Décisions techniques transverses** non tranchées dans M05 (Service Worker, émetteur push, kill switch).
3. **Levée des contradictions** §07 vs M05 (offline V1, émetteur push).
4. **Onboarding et formation chauffeur** : aspects non-techniques (PDF mémo, force change password).
5. **Index** des éléments PWA spec ailleurs.

Sert de **point d'entrée unique** pour Claude Code lors de l'implémentation PWA. Évite de devoir lire M05 + §07 + §09 + §14 + §15 pour reconstruire la stack.

---

## 2. Identité PWA

### 2.1 Domaine et déploiement

**Décision D1** : PWA chauffeur servie sur `tms.gosavr.io/m/*` (sous-route, mono-domaine, 1 seul Vercel project). Pas de sous-domaine séparé (rejeté option c).

**Justification** : cohérent avec [[11 - Dashboards TMS]] D1 (mono-domaine TMS). Évite un 3ème front Vercel + cookies cross-domain + complexité CORS supplémentaire. Mention obsolète `chauffeur.savr.fr` à propager retrait dans §07 ligne 24 et §15 ligne 24.

**Routing Next.js 15** : `app/m/layout.tsx` (layout mobile-first, pas de sidebar, bottom nav) + `app/m/page.tsx` (E2 accueil) + sous-routes `/m/login`, `/m/checklist`, `/m/tournee/:id`, `/m/collecte/:id`, `/m/pesee/:id`, `/m/signature/:id`, `/m/incident/:id`, `/m/historique`, `/m/profil`.

### 2.2 OS et versions supportés

**Décision D2** : matrice cible V1.

| OS | Version min | Navigateur | Web Push |
|----|-------------|------------|----------|
| iOS | 16.4+ | Safari (PWA installée) | Oui (depuis 16.4) |
| Android | 10+ | Chrome 100+ | Oui (robuste) |

**Hors matrice** :
- Android 8-9 : message d'erreur au login + invitation à appeler Ops. M05 ligne 72 mentionne Android 8+, à corriger en propagation.
- iOS < 16.4 : idem (Web Push absent, geoloc background fragile).

**Justification** : Android 10+ couvre ~95% du parc 2026 + Web Push robuste. Android 8 trop risqué Web Push (D15 M05 push V1 indispensable pour attribution).

### 2.3 Manifest PWA

Manifest standard `app/m/manifest.ts` :
- `name`: "Savr Chauffeur"
- `short_name`: "Savr"
- `display`: "standalone" (full-screen, pas de barre URL)
- `orientation`: "portrait" (paysage non supporté V1)
- `theme_color`: vert primaire Savr (à valider §10)
- `background_color`: blanc
- `icons`: 192px + 512px + maskable

Install prompt : automatique au 2e visit (Chrome) ou via menu "Ajouter à l'écran d'accueil" (Safari iOS). Mention dans onboarding W1 (cf. M05).

---

## 3. Stack technique consolidée

### 3.1 Framework et build

- **Next.js 15** App Router, même monorepo `packages/tms`, route `/m/*` (cf. [[07 - Architecture technique TMS]]).
- Build : Vercel (front TMS unique).
- Bundle initial cible : **< 200 Ko gzippé** (cf. [[14 - Scalabilité TMS]]). Code splitting agressif par route, lazy-load images/icônes.

### 3.2 Service Worker

**Décision D3** : Service Worker via **Serwist** (`@serwist/next` v9+).

**Justification** : Serwist = `next-pwa` moderne, support natif Next.js 15 App Router, gère cache shell + runtime + background sync + push out-of-the-box. Communauté active (fork next-pwa après archivage du repo original).

**Configuration cible** :
- Cache shell : statiques (HTML, JS, CSS, fonts, icônes) — strategy `CacheFirst` avec révision auto au déploiement.
- Cache runtime : data tournée (`/api/m/tournees/*`, `/api/m/collectes/*`) — strategy `NetworkFirst` avec fallback IndexedDB.
- Background Sync : queue `sync_queue` pour POST différés (pesées, photos, signatures, plaque, incidents). Fallback polling 30s si Background Sync API indisponible (Safari iOS partiel cf. M05 Q3).
- Skip waiting + claim clients : non (préférence stratégie `update on reload` pour éviter rupture en pleine tournée — kill switch D9 gère le force update).

### 3.3 Stockage offline

- **IndexedDB** : 4 object stores (cf. M05 §8.2) — `sync_queue`, `pesees_local`, `signatures_local` (PNG base64), `photos_local` (Blob JPEG).
- **localStorage** : préférences UI seulement (sidebar repliée, dernier onglet visité). Aucune data métier.
- **Cache Storage API** : géré par Serwist (shell + runtime).
- **Quota** : 50 MB cible (largement sous quota Chrome 60% disque dispo / iOS 50 MB par défaut). Cap queue offline : 3 tournées + 150 photos cf. M05 D2.

### 3.4 Capacité offline V1

**Décision D4** : **offline-first complet V1** (queue 3 tournées + 150 photos, IndexedDB, sync différée Background Sync).

**Justification** : M05 (rédigé 2026-04-24) a spécifié l'offline-first complet V1. §07.7.3 (atelier 2026-04-23) mentionnait "cache HTTP simple V1, offline-first V1.1" — obsolète. M05 = source de vérité (plus récent et plus précis). Propagation §07 nécessaire.

**Implications** :
- Chauffeur peut démarrer une tournée en zone blanche, saisir pesées/photos/signatures hors ligne, sync au retour de réseau.
- Conflits sync : strategy LWW (Last-Write-Wins) avec audit log côté serveur (cf. M05 D1).
- Cap queue dépassé : alerte M11 `m05_queue_offline_saturee` + bandeau PWA "synchroniser ou contacter Ops".

### 3.5 Web Push

**Décision D5** : émetteur Web Push = **Edge Function Supabase** (`tms.push_send`) + lib `web-push` (VAPID).

**Justification** : §07.6.1 disait initialement "pas Edge Functions V1". M13 D4 a depuis acté l'usage d'Edge Functions (`reveal_secret`, `rotate_secret`, `m11_slack_webhook_url` Vault). §11 D5 a aussi mobilisé Edge Function (`dashboard_export`). Donc Edge Functions sont autorisées V1 pour cas spécifiques. Web Push est un cas d'usage légitime (besoin d'invocation depuis triggers DB ou crons).

**Propagation §07.6.1** : section à mettre à jour pour lister les cas d'usage Edge Functions V1 (M13 secrets, §11 export, M05 push).

**Limites iOS Safari** (cf. M05) : Web Push iOS 16.4+ fonctionne mais reste fragile (perte si app fermée trop longtemps). Fallback email Resend critical déjà en place côté M11.

### 3.6 Géolocalisation

Cf. M05 D4-D6 + R_M05.7-R_M05.8 + §15.4.1. Synthèse :
- Geofence 300m uniforme (D4 M05).
- Fréquence GPS : permanent basse + boost transitions (D6 M05).
- Throttling : 60s + batch 5 min (cf. §15.4.1).
- Rétention : 30 jours pg_cron (cf. R_M05.13 + §14 + §15).

**Décision D6 — refondue Bloc 3 2026-06-04** : **écran d'information géoloc bloquant à la 1ère connexion** PWA chauffeur (notice : finalité, base légale **intérêt légitime**, rétention 30j, destinataires, droits + canal de contact) + bouton « J'ai lu et compris » obligatoire pour accéder à la PWA. Trace dans `users_tms.consentements jsonb = { geoloc_notice: { acknowledged_at, version_notice, ip } }`. Ré-affichage bloquant **uniquement si la notice change matériellement** (exceptionnel). **Aucune UI géoloc après l'inscription V1** : pas d'écran « Mes données » permanent, pas de bouton de révocation/opposition (rejet du « point 4 »). La mention CGU prestataire signée à l'embauche reste en complément.

> **Évolution vs ancienne D6 (2026-04-27)** : l'ancienne décision « consentement via CGU uniquement, **pas d'UI in-app** » est remplacée. Val a arbitré (Bloc 3) l'ajout d'un écran d'information **uniquement à l'inscription** pour maximiser la preuve et la transparence RGPD, tout en gardant la friction minimale (le chauffeur n'est plus confronté au sujet ensuite). Point clé : la base légale est **l'intérêt légitime**, pas le consentement (position CNIL géoloc salariés) — l'écran informe, il ne recueille pas un consentement refusable.

**Justification Val** : preuve propre à Savr (horodatée, nominative, versionnée), opposable sans dépendre du dossier RH prestataire ; obligation d'information (Art. 13) renforcée ; friction minimale conservée. La PWA exige la géoloc pour fonctionner (sans GPS, fallback bouton "J'arrive" cf. M05 D5 mais audit + alerte).

**Risque assumé V1 documenté §15.4.1 + §15.5.1** : pas de mécanisme self-service d'exercice des droits in-app (révocation/opposition/export). Demande d'opposition (Art. 21) traitée hors app par Admin TMS / manager prestataire. Si CNIL/audit/grand compte remonte un manque, V1.1 ajoute l'écran d'exercice des droits in-app.

### 3.7 Photos et signature

Cf. M05 E6/E7 + W5/W6. Stack :
- Capture : `getUserMedia` (caméra) ou `<input type="file" accept="image/*" capture>`.
- Compression : JPEG qualité 80 (V1), max 5/pesée. WebP/adaptative reporté V1.1.
- Stockage local : Blob IndexedDB.
- Upload : Supabase Storage buckets `photos-collectes-tms`, `photos-incidents`, `signatures-assos` (cf. §07.6.4).
- Différé : queue offline + sync.

### 3.8 Détection version + kill switch

**Décision D9** (révisée revue sobriété 2026-06-04 B3 — kill switch piloté par l'enum unique `m05_force_update_mode` `off|soft|hard`) : au boot PWA, comportement selon `m05_force_update_mode`. `soft` = **toast bannière non-bloquant** + bouton "Recharger maintenant" + grace period 24h.

**Mécanisme technique** :
- Au boot SW, fetch `/api/m/version` (réponse `{server_version, force_update_mode}`).
- Si `server_version > local_version` :
  - Si `force_update_mode = off` : aucune notification de forçage (mise à jour au prochain reload naturel).
  - Si `force_update_mode = soft` (défaut quand forçage) : toast bannière "Nouvelle version disponible" + bouton "Recharger" + dismiss possible. Grace period 24h max (au-delà : escalade en modal bloquant).
  - Si `force_update_mode = hard` (cas urgence sécurité) : modal bloquant immédiat "Mise à jour requise, recharger pour continuer".
- Comparaison version : `package.json` version build-time injectée dans bundle + `parametres_tms.m05_min_client_version`.

**Paramètre M13** : `m05_force_update_mode text default 'off'` (enum `off|soft|hard`, revue sobriété 2026-06-04 B3 — fusion des ex-booléens `m05_force_update_active` + `m05_force_update_strict`). Propagation §04 + M13.

---

## 4. Auth chauffeur

Cf. M05 D24 + R_M05.10-R_M05.11 + §addendum 2026-04-24 + §15.4.4 + §09. Synthèse :
- Email + password (Supabase Auth, argon2id).
- Reset password via magic link 30 min (Resend).
- Rate limit 5 tentatives / 15 min / IP.
- Device binding 1 device actif (R_M05.10).
- Session 30 jours rolling.

**Décision D7** (refondue revue sobriété §05 2026-05-01 B1) : **bootstrap chauffeur via magic link 30 min uniquement** (pas de password initial transmis par email). Le chauffeur reçoit un email "Définir mon mot de passe", clique le lien, définit son password (≥ 8 car) puis se connecte normalement. Aucun password en clair transmis par email.

→ **Supprimé V1 (revue sobriété §05 2026-05-01 B1)** — la colonne devient inutile, le magic link force par construction la création du password à la 1ère connexion. Plus d'écran intermédiaire "force change" puisqu'il n'y a jamais de password par défaut.

**Justification** : sécurité renforcée (zéro password en clair transmis par email — réduit la surface d'attaque), implémentation simplifiée (1 chemin de code au lieu de 2 — magic link reset password déjà existant pour EA2), cohérence R_M03.1 (reset password = magic link 30 min), ergonomie identique pour le chauffeur (1 email reçu, 1 clic, 1 saisie password).

**Propagations** : §04 (colonne `users_tms.must_change_password` supprimée), §09 (workflow login simplifié — pas d'écran intermédiaire force change), M05 W1 (étape "1er login → force change" retirée), M06 W7 (création chauffeur sans password initial, magic link envoyé), M13 (bouton "Forcer rotation password" Admin TMS = invalider sessions actives + envoyer magic link reset, plus de flag à reset).

---

## 5. Onboarding et formation chauffeur

### 5.1 Onboarding technique (1ère connexion PWA)

Cf. M05 W1. Synthèse (simplifiée revue sobriété §05 2026-05-01 B1 — magic link uniquement) :
- Étape 1 : email invitation manager "Définir mon mot de passe" → magic link 30 min `https://tms.gosavr.io/m/auth/set-password?token=...`.
- Étape 2 : install PWA (prompt natif Chrome / instructions Safari).
- Étape 3 : page set-password → saisie nouveau password (≥ 8 car) → submit → session ouverte automatiquement.
- → **fusionnée dans étape 3 (D7 refonte B1)** — le magic link est par construction l'établissement du password.
- Étape 4 (ex-5) : opt-in push notifications (toggle, V1.1 si refus).
- Étape 5 (ex-6) : tour rapide 3 écrans (Accueil, Tournée, Pesée) — illustrations PNG, skip-able.
- Étape 6 (ex-7) : redirect E2 accueil.

### 5.2 Formation terrain

**Décision D8** : **PDF mémo 1 page distribué par manager prestataire**. Pas de tutoriel embarqué, pas de vidéo dans la PWA V1.

**Justification** : responsabilité prestataire (Strike/Marathon ont déjà process formation chauffeur). Savr fournit le PDF mémo (template Word/PDF V1). PWA reste simple. Vidéo ou tutoriel interactif = dev pour valeur incertaine, V1.1+ si demande remontée.

**PDF mémo Savr V1** : 1 page A4 recto avec captures d'écran annotées (E2 accueil, E5 collecte, E6 pesée, E8 clôture), QR code lien WhatsApp Ops Savr en pied de page. À produire hors CDC par Val + Louis avant go-live.

---

## 6. Performance cible V1

Cf. [[14 - Scalabilité TMS]]. Synthèse :
- p95 chargement initial : < 2s sur 3G.
- Saisie pesée offline : < 300ms.
- Saisie pesée online (sync) : < 800ms.
- Bundle initial gzippé : < 200 Ko.
- Volume V1 : 10-20 chauffeurs PWA simultanés (pic 8).

---

## 7. Index complet — où trouver quoi

| Élément | Source spec |
|---------|-------------|
| Écrans E1-E10 (login, accueil, checklist, collectes, pesée, signature, terminer, incident, historique, profil) | M05 §3 + §5 |
| Workflows W1-W12 (onboarding, sync tournée, départ, pesée, signature, incident, clôture, queue, push) — W13 Veolia supprimé revue sobriété 2026-04-30 A1 | M05 §6 |
| Cas C1-C14 (offline saturée, GPS off, queue conflit, etc.) | M05 §7 |
| Décisions D1-D24 (sync, geofence, push, device binding, session, etc.) | M05 §13 |
| Auth chauffeur (email+password, MFA non, device binding, session 30j) | [[09 - Authentification et permissions TMS]] §A3 + M05 D24 |
| RLS chauffeur (scope `chauffeur_id = auth.user_chauffeur_id()`, correctif audit RLS 2026-06-05) | [[09 - Authentification et permissions TMS]] §A3 + M05 §11 |
| Géoloc (geofence 300m, fréquence, rétention 30j) | M05 D4-D6 + [[15 - Sécurité et conformité TMS]] §15.4.1 |
| Push (VAPID, déclencheurs, cap, fallback iOS) | M05 D15-D16 + W12 + §07.7.2 |
| Photos / signature (JPEG 80 max 5, signature canvas, buckets) | M05 E6/E7 + §07.6.4 |
| Saisie pesée (auto-tare, override motif, photos) | M05 E6 + W5 + R_M05.3-R_M05.5 + §04 `pesees` |
| Saisie plaque (Cas A/B, regex FR, override warning) | M05 E3 + W3 + R_M05.2 |
| Multi-tournées même jour (kit) | M05 D19 |
| — **supprimé revue sobriété 2026-04-30 A1** (déclaration `realise` Ops vaut désormais confirmation effective, plus d'intégration M05↔M10) | — |
| Alertes M11 émises par M05 (6 codes canoniques) | M05 §15bis + [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]] |
| Webhooks émis (S3, S5, S7, S9) | M05 §10 + [[08 - Contrat API Plateforme-TMS]] |
| Paramètres M13 (`m05_*` 15 paramètres) | M05 §12 |
| Performance cible (p95, bundle, offline) | [[14 - Scalabilité TMS]] |
| RGPD (CGU, géoloc, rétention, contrat prestataire) | [[15 - Sécurité et conformité TMS]] §15.4.1 + §15.4.4 |

---

## 8. Décisions prises §12

| # | Décision | Justification | Date |
|---|----------|---------------|------|
| D1 | PWA servie sur `tms.gosavr.io/m/*` (sous-route, mono-domaine) | Cohérent §11 D1, pas de 3ème front | 2026-04-27 |
| D2 | OS supportés V1 : iOS 16.4+ Safari, Android 10+ Chrome 100+ | Couvre 95% parc 2026, Web Push robuste | 2026-04-27 |
| D3 | Service Worker = Serwist (`@serwist/next` v9+) | Native Next.js 15 App Router, gère cache + sync + push | 2026-04-27 |
| D4 | Offline-first complet V1 (queue 3 tournées + 150 photos) | M05 source de vérité, §07 obsolète à propager | 2026-04-27 |
| D5 | Émetteur Web Push = Edge Function Supabase + lib web-push (VAPID) | Cohérent M13 D4 et §11 D5, §07.6.1 obsolète à propager | 2026-04-27 |
| D6 | **Refondu Bloc 3 2026-06-04** : écran d'information géoloc bloquant **à l'inscription uniquement** (base légale intérêt légitime, trace `users_tms.consentements.geoloc_notice`, versioning), pas d'UI après inscription (pas de révocation/opposition in-app) | Preuve propre Savr + transparence Art. 13, friction minimale conservée. Base légale ≠ consentement (CNIL géoloc salariés). Risque assumé : exercice droits hors app. V1.1 si CNIL/grand compte remonte | 2026-04-27 / refondu 2026-06-04 |
| D7 | **Refondu B1 2026-05-01** : bootstrap chauffeur via magic link 30 min uniquement (pas de password initial transmis par email, plus de flag `must_change_password`) | Sécurité renforcée + 1 chemin de code, magic link force par construction la création password à 1ère connexion | 2026-04-27 / refondu 2026-05-01 |
| D8 | Formation chauffeur = PDF mémo 1 page distribué par manager prestataire | Responsabilité prestataire, PWA reste simple | 2026-04-27 |
| D9 | Kill switch `force_update` = toast bannière non-bloquant + grace 24h, escalade modal si `force_strict=true` | Pas de modal bloquant en pleine tournée. Strict réservé urgence sécu | 2026-04-27 |

---

## 9. Questions ouvertes

1. — **Résolu (propagation §10 2026-04-28)** : `theme_color: "#2D7A4B"` (savr-green, cf. §10 §2.1). À injecter dans `app/m/manifest.ts`.
2. **PDF mémo chauffeur Savr** : template à produire hors CDC par Val + Louis avant go-live (D8).
3. **Edge Function `tms.push_send` infra Supabase** : valider le déploiement (Edge Functions Supabase = TypeScript runtime Deno, lib `web-push` compatible). À traiter en atelier tech avec frère.
4. **Détection PWA installée vs navigateur classique** : utile pour pousser l'install au 2e visit (M05 W1). Implémentation `window.matchMedia('(display-mode: standalone)')` standard, mais à valider sur iOS Safari 16.4+.
5. **Stratégie de versioning** : `package.json.version` lue au build et exposée via `/api/m/version`. À documenter en CI/CD §07.
6. **Limite quota IndexedDB iOS Safari** : 50 MB par défaut sans demande user. Cap M05 (3 tournées + 150 photos) = ~30-40 MB estimés. À mesurer en pré-prod.

---

## 10. Liens

### CDC TMS (sections internes)

- [[00 - Index]] — index global TMS
- [[03 - Périmètre fonctionnel TMS]] — description M05
- [[04 - Data Model TMS]] — tables `users_tms`, `chauffeurs`, `pesees_brutes`, `tournees`, `auth_sessions_tms`
- [[07 - Architecture technique TMS]] — stack Next.js 15, monorepo, Storage, Edge Functions
- [[08 - Contrat API Plateforme-TMS]] — webhooks émis par M05 (S3/S5/S7/S9)
- [[09 - Authentification et permissions TMS]] — auth chauffeur, RLS, device binding
- [[11 - Dashboards TMS]] — pas de dashboard chauffeur (PWA mobile, navigation bottom nav)
- [[14 - Scalabilité TMS]] — cibles performance PWA
- [[15 - Sécurité et conformité TMS]] — RGPD géoloc, CGU chauffeur

### Module source

- [[06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur]] — **source de vérité fonctionnelle** (10 écrans, 13 workflows, 20 décisions, 15 paramètres, 6 alertes M11)

### Modules interactions

- [[06 - Fonctionnalités détaillées TMS/M04 - Gestion des tournées]] — création tournée par Ops, affectation chauffeur
- [[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia]] — aucune intégration V1 (W13 confirmation chauffeur supprimé revue sobriété 2026-04-30 A1)
- [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]] — alertes émises par M05 (chauffeur non destinataire)
- [[06 - Fonctionnalités détaillées TMS/M13 - Administration TMS]] — paramètres `m05_*`, force_update flag

---

**Fin §12 — V1 rédigée 2026-04-27.**
