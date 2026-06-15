# 11 — Dashboards TMS

**Statut** : V1 rédigée 2026-04-27.
**Périmètre** : section transverse — index des dashboards déjà spécifiés dans les modules + patterns communs (routes, navigation cross-app, exports, refresh, responsive). **Ne re-spécifie pas** les écrans détaillés (voir modules sources).
**Persona ciblé** : tous rôles TMS (Ops Savr, Admin TMS, Manager prestataire, Chauffeur).
**Référence Plateforme** : [[01 - Cahier des charges App/00 - Index]] (cumul cross-app Ops).

---

## 1. Objectif et portée de §11

§11 est une **couche d'index transverse**. Les 14 dashboards et écrans agrégés du TMS V1 sont déjà spécifiés en détail dans les modules fonctionnels (§06). §11 ne les réécrit pas — elle :

1. **Index** : recense tous les dashboards par rôle avec leur module source et leur route URL normalisée.
2. **Patterns transverses** : définit les conventions communes (refresh, polling, exports, layouts, accessibilité, responsive, navigation).
3. **Cumul cross-app** : spécifie comment un Ops Savr cumulant Plateforme + TMS navigue entre les deux apps.
4. **Routes** : normalise les routes URL (certaines n'étaient pas documentées dans les modules).
5. **Décisions transverses** : tranche les questions transverses (drill-down événement, reports planifiés, widgets orphelins).

§11 sert de **point d'entrée unique** pour Claude Code lors de la phase de développement quand il faudra implémenter le shell de navigation, le composant header/sidebar, le composant export commun, etc. Il évite à Claude Code de devoir lire les 14 modules pour reconstruire les patterns transverses.

---

## 2. Inventaire des dashboards par rôle

### 2.1 Ops Savr (rôle principal du quotidien TMS)

| # | Nom | Module source | Route normalisée | Refresh | Description courte |
|---|-----|---------------|------------------|---------|--------------------|
| D1 | Dashboard dispatch | [[06 - Fonctionnalités détaillées TMS/M02 - Dispatch Ops Savr\|M02]] E1 | `/dispatch` | Realtime + polling 30s (Z4 jauges) | Vue par défaut au login Ops. 4 zones : alertes, KPIs jour, prochaine action, jauges exutoires. **Page d'accueil par défaut Ops Savr.** |
| D2 | Dashboard alertes | [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse\|M11]] E1 | `/alertes` | Polling 30s | Toutes alertes TMS (open / ack / résolues), filtres + bulk ack. |
| D3 | Dashboard pilotage financier | [[06 - Fonctionnalités détaillées TMS/M07 - Pilotage financier logistique\|M07]] E1 | `/finance` | Vue à la volée `v_m07_dashboard` (sobriété 2026-06-04) | 5 widgets coûts logistiques mois courant (W5 écart facture retiré sobriété A5). |
| D4 | Dashboard trésorerie facturation | [[06 - Fonctionnalités détaillées TMS/M08 - Facturation prestataires\|M08]] E5 | `/facturation` | Vue matérialisée 5 min | KPIs factures (à valider, en litige, DSO). |
| D5 | Dashboard stocks matériel | [[06 - Fonctionnalités détaillées TMS/M09 - Stock matériel Savr\|M09]] E1 | `/stocks` | Realtime sur écritures + polling 60s | 4 KPI cards + grille traiteurs sous seuil. |
| D6 | Page exutoires | [[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia\|M10]] E1 | `/exutoires` (onglets `#stock` / `#passages`) | Realtime triggers + polling 30s | Vision saturation entrepôt + planning passages Veolia. |
| D7 | Dashboard Everest | [[06 - Fonctionnalités détaillées TMS/M14 - Intégration Everest\|M14]] E1 | `/everest` | Polling 60s | Supervision missions Everest, retry, latence. |

### 2.2 Admin TMS (Val + Louis V1, futurs admins)

L'Admin TMS a accès à **tous** les dashboards Ops + 4 dashboards exclusifs.

| # | Nom | Module source | Route normalisée | Refresh | Description courte |
|---|-----|---------------|------------------|---------|--------------------|
| D8 | Dashboard admin (home) | [[06 - Fonctionnalités détaillées TMS/M13 - Administration TMS\|M13]] E1 | `/admin` | Polling 60s | Hub Admin : 4 cards résumé + liens rapides + activité récente. **Page d'accueil par défaut Admin TMS.** |
| D9 | Dashboard ingress | [[06 - Fonctionnalités détaillées TMS/M01 - Réception ordres de collecte\|M01]] E1 | `/admin/ingress` | Polling 30s (refresh front-end) | Santé intégrations entrantes Plateforme→TMS, gap de synchronisation (alerte si last ack > 24h). **Allégé sobriété M01 A_M01_04 + A_M01_02 — 2026-04-30** : Zone 2 « Timeline graphique multi-courbes » retirée (volume V1 ~100 webhooks/jour ne le justifie pas), remplacée par 5 compteurs simples par type d'event + lien CSV export 7j. **Métrique « lag polling E6 » retirée — revue sobriété M01 2026-06-04 C3** (polling supprimé Bloc A A4) : remplacée par statut last ack Plateforme + alerte gap > 24h. |
| D10 | Monitoring intégrations | [[06 - Fonctionnalités détaillées TMS/M13 - Administration TMS\|M13]] E6 | `/admin/integrations` | Vue matérialisée 60s | Logs events, replay manuel, agrégats endpoints + tab Everest. |
| D11 | Monitoring M12 attribution | [[06 - Fonctionnalités détaillées TMS/M12 - Attribution transporteur\|M12]] §4.9 (rendu sous M13) | `/admin/integrations#m12-attribution` | Polling 60s | Volumétrie suggestions, qualité, cache Everest. |

### 2.3 Manager prestataire (Strike, Marathon, futurs)

| # | Nom | Module source | Route normalisée | Refresh | Description courte |
|---|-----|---------------|------------------|---------|--------------------|
| D13 | Accueil portail | [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service\|M03]] E1 | `/portail` | Polling 60s | Bloc actions en attente + tournées à assigner + KPI mois. **Page d'accueil par défaut Manager prestataire.** Bandeau alertes intégré (D15). |
| D14 | Dashboard revenus | [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service\|M03]] E9 | `/portail/revenus` | À la demande (date picker) | KPIs revenus + tableau agrégé tournée + export CSV. |

### 2.4 Chauffeur (PWA M05)

Aucun dashboard agrégé V1. Le chauffeur a une **vue tournée du jour** spécifiée dans [[06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur|M05]] (PWA mobile-first), pas un dashboard au sens classique. Pas de KPIs agrégés exposés au chauffeur V1 (cf. M11 décision : « Chauffeur non concerné par alerting / dashboards »).

---

## 3. Patterns transverses

### 3.1 Routes URL — convention

**Décision D1** : convention `/{section}` ou `/{section}/{sous-section}`. Préfixe `/admin/*` pour les dashboards exclusifs Admin TMS. Pas de préfixe par rôle (Ops, Manager) pour limiter la verbosité.

| Section | Route racine | Sous-routes |
|---------|--------------|-------------|
| Dispatch (Ops) | `/dispatch` | — |
| Alertes (Ops + Admin) | `/alertes` | `/alertes/:id` (drawer détail) |
| Pilotage financier (Ops + Admin) | `/finance` | `/finance/tournees/:id` |
| Trésorerie facturation (Ops + Admin) | `/facturation` | `/facturation/:id` |
| Stocks matériel (Ops + Admin) | `/stocks` | `/stocks/traiteurs/:id` |
| Exutoires (Ops + Admin) | `/exutoires` | `/exutoires#stock`, `/exutoires#passages` |
| Everest (Ops + Admin) | `/everest` | `/everest/missions/:id` |
| Tournées (Ops + Admin) | `/tournees` | `/tournees/:id` (cf. M04) |
| Collectes (Ops + Admin) | `/collectes` | `/collectes/:id` (cf. M01/M02) |
| Référentiels (Admin TMS) | `/referentiels/*` | `/referentiels/prestataires`, `/referentiels/users`, `/referentiels/grilles-tarifaires`, `/referentiels/lieux-acces` |
| Admin (Admin TMS only) | `/admin` | `/admin/parametres`, `/admin/users`, `/admin/audit`, `/admin/secrets`, `/admin/integrations`, `/admin/onboarding`, `/admin/codes-alertes`, `/admin/impersonation` |
| Portail prestataire | `/portail` | `/portail/collectes/:id`, `/portail/tournees/:id`, `/portail/revenus`, `/portail/factures`, `/portail/profil`, `/portail/equipe` |

**Route racine `/`** : redirection automatique selon rôle (cf. § 3.5 navigation).

### 3.2 Page d'accueil par défaut selon rôle

**Décision D2** : à la connexion (ou clic logo), redirection vers la home rôle.

| Rôle | Home par défaut |
|------|-----------------|
| Ops Savr | `/dispatch` |
| Admin TMS (sans cumul Ops) | `/admin` |
| Admin TMS + Ops (cumul fréquent V1) | `/dispatch` (poste de commandement opérationnel) |
| Manager prestataire | `/portail` |
| Chauffeur (PWA) | `/m/tournee` (cf. M05) |

Si cumul de rôles (ex: Admin TMS + Ops Savr — cas de Val), la home par défaut est celle du rôle « le plus opérationnel » (Ops > Admin > Manager). L'utilisateur peut accéder à `/admin` via le menu sidebar.

### 3.3 Navigation — sidebar et header

**Sidebar gauche persistante** (desktop), repliable (icônes only) avec largeur 240px (déployée) / 64px (repliée). État (déployé/replié) sauvegardé dans `localStorage` clé `tms.sidebar.collapsed`.

**Sections sidebar par rôle** (logique : seules les routes accessibles s'affichent — gating RLS + frontend) :

- **Ops Savr** : Dispatch · Alertes · Tournées · Collectes · Stocks · Exutoires · Pilotage financier · Trésorerie · Everest
- **Admin TMS** : Admin (home) · tous les liens Ops · Référentiels (sous-menu déroulant : Prestataires, Users, Grilles tarifaires, Lieux accès) · Audit · Secrets · Intégrations
- **Manager prestataire** : Accueil · Collectes · Tournées · Factures · Revenus · Équipe · Profil
- **Chauffeur** : pas de sidebar (PWA mobile, navigation bottom nav cf. M05)

**Header** (toutes pages, sauf chauffeur PWA) :
- Logo Savr (clic = home rôle)
- Fil d'Ariane (breadcrumb) — section courante
- Recherche globale (V1.1+, désactivée V1)
- Cloche notifications (alertes M11 ack/non-ack pour le rôle, badge nombre)
- Avatar user → menu déroulant : profil, **switch app (cf. § 3.4)**, déconnexion

**Bandeau impersonation** (Admin TMS) : si session impersonation active (M13 D13), bandeau orange persistant en haut, hauteur 32px, message "Impersonation : <nom user> · [Quitter]".

**Bandeau test mode** : non applicable V1 (M11 Bloc 4 — A5/A10/W10 retirés V1).

### 3.4 Cumul cross-app Ops Plateforme ↔ Ops TMS

**Décision D3** : un Ops Savr peut avoir 2 profils (Plateforme + TMS) avec même email Google Workspace SSO. La navigation entre apps se fait par **liens permanents en sidebar** + SSO transparent.

**Implémentation** *(simplifiée revue sobriété §08 Bloc A 2026-05-01 A1 — suppression endpoint has-profile)* :
- En bas de la sidebar TMS (au-dessus du logo Savr), bloc **« Switcher d'app »** avec 2 boutons : « → Plateforme » (bouton **toujours affiché**) et « TMS » (bouton actif/highlight courant).
- Au clic « → Plateforme » : redirection cross-domain `https://app.gosavr.io/dashboard` (ou la home Plateforme du rôle). SSO Google Workspace gère la session transparente — pas de re-auth.
- Symétrique côté Plateforme : même bloc avec boutons « Plateforme » + « → TMS ».
- **Pas de détection conditionnelle** : si l'user n'a pas de profil sur l'app cible, page d'accès refusé propre côté cible (« Vous n'avez pas accès au TMS Savr. Contactez Val ou Louis. »).

**Détection cumul** : **Supprimé revue sobriété §08 A1 2026-05-01** — confort UX pur (≤4 users cumul concernés). Coût opérationnel d'une page 403 propre = 0.

**Contre-exemple** : pas de switch de contexte dans le header (option c rejetée, overkill V1). Pas d'iframe ni de mini-app embarquée. Les 2 apps restent strictement séparées techniquement.

**Risque assumé V1** : un user sans profil sur l'app cible voit un bouton qui mène à une page d'accès refusé. Acceptable — pas de fuite de données, message UX clair.

### 3.5 Refresh, polling, realtime

Pattern unifié selon criticité :

| Mode | Usage | Implémentation |
|------|-------|----------------|
| **Realtime (Supabase Realtime)** | Données critiques temps réel : statuts collectes (D1), stocks (D5), exutoires (D6) | Subscription Supabase channels, fallback polling 30s si déconnexion socket > 60s |
| **Polling 30s** | Alertes (D2), KPIs jour (D1 Z2), suivi opérationnel actif | `setInterval` côté React, pause si tab inactive (Page Visibility API) |
| **Polling 60s** | Dashboards stratégiques (D8 admin home), KPIs agrégés Everest (D7), monitoring intégrations (D10) | Idem polling 30s, pause si tab inactive |
| **Vue à la volée** | Pilotage financier (D3) | Vue `v_m07_dashboard` calculée à chaque chargement (sobriété 2026-06-04 — ex-vue matérialisée + cron 5 min supprimés ; volume ~300 tournées/mois, index composites suffisent) |
| **Vue matérialisée 5 min** | Dashboard financier lourd : trésorerie (D4) | `pg_cron` refresh `mat_view` toutes 5 min, requête frontend = lecture vue |
| **À la demande** | Dashboards avec date picker : revenus prestataire (D14), drill-downs | Requête au changement de filtre + bouton rafraîchir manuel |

**Décision D4** : pause systématique du polling sur tab inactive (réduit charge serveur de ~80% en moyenne, pattern Page Visibility API standard). Reprise immédiate au focus.

### 3.6 Exports — pattern unique

**Décision D5** (arbitrage 7 = a) : **tous les dashboards** ont un bouton **« Exporter »** standardisé en haut à droite (entre filtres et avatar header). Composant React partagé `<DashboardExportButton />`.

**Spec composant** :
- Menu déroulant au clic : « Exporter en CSV » + « Exporter en PDF » (PDF = snapshot dashboard avec graphes inclus, généré côté serveur via Puppeteer Edge Function).
- Convention nommage fichier : `tms_{dashboard_slug}_{YYYY-MM-DD}_{HHmm}.{ext}`. Ex : `tms_finance_2026-04-27_1430.csv`, `tms_alertes_2026-04-27_1430.pdf`.
- Périmètre exporté : **filtres actifs respectés** (export = ce qui est affiché à l'écran, pas l'intégralité de la table sous-jacente).
- Limite hard CSV : 10 000 lignes (au-delà → message « Affinez vos filtres ou contactez l'admin pour un export complet »).
- Limite hard PDF : 1 page A4 paysage par dashboard (les tables longues sont tronquées avec footer « XX lignes au total — voir CSV pour exhaustif »).

**Dashboards concernés V1** : D1, D2, D3, D4, D5, D6 (onglets séparés), D7, D8, D9, D10, D11, D13, D14. **Soit 13 dashboards × 2 formats = 26 exports possibles.**

**Implémentation** :
- Edge Function `dashboard_export` paramétrée `(dashboard_slug, format, filters_json)` + auth JWT + RLS appliqué (l'export voit ce que l'user voit).
- Génération CSV : streaming `pg_dump_csv` via fonction SQL dédiée par dashboard.
- Génération PDF : Puppeteer dans Edge Function lourde (timeout 30s), template HTML par dashboard.
- Audit log `audit_logs` : action `EXPORT_DASHBOARD`, diff = `{dashboard_slug, format, filters, rows_count, ms_duration}`.

**Reporté V1.1+** : exports planifiés (envoi email scheduled), exports vers SFTP/S3 prestataires.

### 3.7 Layouts et composants UX communs

Composants React partagés (à packager dans `packages/ui-tms` du monorepo) :

| Composant | Usage | Modules consommateurs |
|-----------|-------|------------------------|
| `<DashboardHeader />` | Header dashboard : titre, breadcrumb, filtres rapides, export | Tous |
| `<KPICard />` | Carte KPI avec valeur, libellé, variation %, sparkline | D1 Z2, D3, D4, D5, D7, D8 |
| `<TuileJauge />` | Tuile saturation (jauge circulaire % + texte) | D6, D1 Z4 |
| `<DataTable />` | Table paginée 50 lignes, tri colonne, filtres header | D2, D3, D4, D8, D9, D10, D14 |
| `<AlerteBandeau />` | Bandeau alerte (info/warning/critical) ack/snooze inline | D1 Z1, D2, D13 |
| `<DateRangePicker />` | Picker plage dates avec presets (Aujourd'hui, 7j, 30j, mois courant, mois précédent, custom) | D3, D4, D7, D14 |
| `<ChartBar />`, `<ChartLine />`, `<ChartPie />` | Wrappers Recharts customisés (palette Savr, accessibilité) | D3 W2/W6, D7, D11 |
| `<DashboardExportButton />` | Bouton export commun (cf. 3.6) | Tous |
| `<EmptyState />` | État vide standardisé (illustration + message + CTA) | Tous |
| `<LoadingSkeleton />` | Squelette chargement par type (KPI, table, chart) | Tous |

**Palette couleurs** : définie dans [[10 - Design System TMS]] §2 (propagation §10 2026-04-28). Palette complète : vert primaire `#2D7A4B`, orange warning `#F59E0B`, rouge critical `#DC2626`, info `#3B82F6`, neutres `neutral-50` → `neutral-950`. Tokens Tailwind `savr-*` dans `tailwind.config.ts`.

### 3.8 Responsive et accessibilité

**Responsive** :
- **Desktop ≥ 1280px** : layout 2-3 colonnes, sidebar déployée, dashboards pleins (toutes zones).
- **Laptop 1024-1279px** : sidebar repliée par défaut, layouts en accordéon (zones empilées).
- **Tablette 768-1023px** : sidebar masquée (drawer ouvrable bouton hamburger), 1 colonne, KPIs en grille 2×N.
- **Mobile < 768px** : non supporté V1 sauf PWA chauffeur M05 (mobile-first dédié). Si Ops/Admin/Manager accède en mobile, message « Optimisé pour desktop, certaines fonctions limitées ». Lecture seule autorisée, pas d'actions.

**Accessibilité (WCAG 2.1 AA visé V1, pas certifié)** :
- Contraste texte/fond ≥ 4.5:1 (couleurs Savr respectent).
- Tous boutons + liens accessibles clavier (focus visible).
- Labels ARIA sur composants custom (jauges, charts).
- Skip-to-content au top de chaque page.
- Pas d'auto-refresh agressif (réspect motion-reduced).
- Pas d'audit accessibilité externe V1 (cf. [[15 - Sécurité et conformité TMS]] §15.10quinquies si jamais ajoutée).

### 3.9 Notifications cloche header

Cloche dans header affiche les **alertes M11 actives pour le rôle de l'user** (scope_role + scope_entity selon M11 §12.2).

- Badge nombre = total alertes `open` (pas `ack`, pas `resolved`).
- Clic cloche → dropdown 10 dernières alertes (liste compacte, severity color, snooze quick action).
- Bouton « Voir toutes » → redirige `/alertes` (D2).
- Polling cloche : 30s (aligné D2).
- Manager prestataire : cloche pointe vers bandeau intégré M03 E1, pas d'écran dédié `/portail/notifications` (décision D6 ci-dessous).

**Décision D6** (arbitrage 4 = a) : pas d'écran dédié notifications côté manager prestataire. Cloche header + bandeau D15 dans M03 E1 suffisent V1. Volume faible (manager reçoit ~5-10 alertes/mois max — rappels factures, relances).

### 3.10 Shell de navigation et SSR/CSR

- Shell rendu **côté serveur** (Next.js App Router, Server Components) : header, sidebar, gating rôle, breadcrumbs.
- Contenu dashboards rendu **côté client** (Client Components avec « use client »), fetch via React Query (SWR pattern), polling/realtime géré côté client.
- Cookie session Supabase Auth lu en SSR pour déterminer rôle + cumul cross-app.
- 404 : page custom `/404` avec sidebar + lien retour home rôle.
- 403 : page custom `/403` (tentative d'accès route non autorisée), sidebar + message + lien retour home rôle. Audit log `AUDIT_403_ACCESS` (M13).

---

## 4. Décisions transverses tranchées V1

### D7 — Widgets orphelins reportés V1.1+

**Contexte** : 3 widgets identifiés dans les modules sans écran hôte défini :
1. Widget « Arrivées sans géoloc » par chauffeur (M05/M11, seuil 15%).
2. Widget « Taux Aucun repas / chauffeur » (§03 fenêtre 30/60/90j).
3. Rapport « Taux clôture hors zone » mensuel par chauffeur (M04 question ouverte).

**Décision** (arbitrage 3 = c) : **pas de dashboard dédié V1**. Exposition via **exports CSV à la demande** depuis pages détail Tournées (M04) ou Collectes (M01/M02). Si besoin terrain remonté post go-live, créer dashboard « Qualité opérationnelle chauffeurs » V1.1.

**Impact** :
- Aucune nouvelle route V1.
- Requêtes SQL ad-hoc pour Ops/Admin (templates dans `/admin/audit` ou via Supabase Studio).
- À documenter dans [[16 - Roadmap et priorisation TMS]] comme « Dashboard qualité opérationnelle chauffeurs — V1.1 ».

### D8 — Drill-down événement M07 reporté V1.1+

**Contexte** : depuis dashboard pilotage financier (D3), pas de drill-down par événement Plateforme V1 (la vue reste par tournée).

**Décision** (arbitrage 5 = b) : V1 = drill-down par tournée uniquement. Drill-down par événement (jointure cross-schema avec `plateforme.evenements`, agrégation coût total = somme tournées de l'événement) reporté V1.1.

**Justification** : effort moyen (jointure cross-schema, gating RLS), valeur utile mais non bloquante go-live. Pilotage financier V1 fonctionne par tournée — l'Ops fait l'agrégation manuelle si besoin. Si demande forte post go-live, V1.1.

**Impact** : ajouter à [[16 - Roadmap et priorisation TMS]] sous V1.1 « Pilotage financier — drill-down événement ».

### D9 — Reports planifiés (digest hebdo, mensuel) reportés V1.1+

**Contexte** : aucun digest email scheduled spécifié V1 (digest hebdo Ops, rapport mensuel Admin).

**Décision** (arbitrage 8 = b) : V1 = pas de reports planifiés. Tous les dashboards en accès direct. Si demande remontée post go-live (Val ou Louis « j'aimerais recevoir mon résumé hebdo lundi 7h »), V1.1.

**Justification** : ajouter pg_cron + templates email + gating per-rôle = effort non négligeable pour un besoin non exprimé. La cloche header + alertes critiques email (M11) couvrent l'essentiel V1.

**Impact** : à documenter [[16 - Roadmap et priorisation TMS]] V1.1+ « Reports email scheduled (digest Ops, mensuel Admin) ».

### D10 — Vue carte M02 reportée V2

**Contexte** : M02 mentionnait initialement une vue carte des collectes du jour (heatmap géo). Tranchée non V1 dans M02 D2.

**Confirmation §11** : pas de vue carte V1 ni V1.1. Reporté V2 (nécessite intégration cartographique Mapbox/MapLibre + géocodage rigoureux + UX dédiée mobile/desktop).

---

## 5. Statuts et transitions globales

Pas de machine à états dédiée §11 (les statuts sont propres à chaque entité, gérés dans les modules sources). §11 ne fait que **lire et afficher** les statuts.

---

## 6. Accès et permissions (synthèse)

Tous les dashboards respectent le gating RLS spécifié dans [[09 - Authentification et permissions TMS]]. Synthèse :

| Dashboard | Rôles autorisés | Note |
|-----------|----------------|------|
| D1 Dispatch | Ops Savr (R), Admin TMS (R) | — |
| D2 Alertes | Ops Savr (R+ack), Admin TMS (R+ack+résolution) | Manager prestataire voit ses alertes scope dans D13 |
| D3 Pilotage financier | Ops Savr (R), Admin TMS (R+ajustement) | — |
| D4 Trésorerie | Ops Savr (R), Admin TMS (R+rapprochement) | — |
| D5 Stocks | Ops Savr (R+correction), Admin TMS (R+correction) | — |
| D6 Exutoires | Ops Savr (R+confirmation), Admin TMS (R+confirmation) | — |
| D7 Everest | Ops Savr (R), Admin TMS (R+retry) | — |
| D8 Admin home | Admin TMS uniquement | — |
| D9 Ingress | Admin TMS uniquement | — |
| D10 Monitoring intégrations | Admin TMS uniquement | — |
| D11 Monitoring M12 | Admin TMS uniquement | — |
| D13 Portail home | Manager prestataire (de cette org) | RLS scope `prestataire_id` |
| D14 Revenus | Manager prestataire (de cette org) | RLS scope `prestataire_id` |

**Frontend gating** : routes inaccessibles → redirect `/403`. Sidebar masque les sections non autorisées (pas juste désactivation visuelle).

---

## 7. Performances cibles V1

- **First Contentful Paint** (FCP) shell : < 800ms (sur connexion Paris fibre, Macbook standard).
- **Time To Interactive** (TTI) dashboard : < 2s.
- **Polling load** par session : < 100 req/min (toutes pages combinées).
- **Vue à la volée** D3 (`v_m07_dashboard`) : chargement p95 < 2s (sobriété 2026-06-04, ex-matérialisée).
- **Vue matérialisée refresh** D4 : < 30s par refresh (cron 5 min).
- **Export CSV** : < 5s pour 10 000 lignes.
- **Export PDF** : < 15s par dashboard.

Cibles cohérentes avec [[14 - Scalabilité TMS]] (p95 M02 < 1.5s, PWA < 200Ko).

---

## 8. Décisions prises

| # | Décision | Justification | Date |
|---|----------|---------------|------|
| D1 | Convention routes `/{section}` + préfixe `/admin/*` | Lisibilité, redirection rôle sur `/` | 2026-04-27 |
| D2 | Home par défaut Ops = `/dispatch`, Admin = `/admin`, Admin+Ops = `/dispatch` | Poste de commandement opérationnel prioritaire | 2026-04-27 |
| D3 | Cumul cross-app via boutons sidebar « ← Plateforme / TMS → » + SSO transparent — **bouton toujours affiché** (revue sobriété §08 Bloc A 2026-05-01 A1, suppression endpoint has-profile + cookie 1h) | Simple, pas de re-auth, page d'accès refusé propre côté cible | 2026-04-27 / **2026-05-01** |
| D4 | Pause polling sur tab inactive (Page Visibility API) | -80% charge serveur en moyenne | 2026-04-27 |
| D5 | Composant `<DashboardExportButton />` partagé, CSV + PDF, nommage standardisé | Cohérence UX, factorisation, audit log | 2026-04-27 |
| D6 | Pas d'écran notifications dédié manager prestataire | Volume faible, bandeau M03 E1 + cloche suffisent | 2026-04-27 |
| D7 | Widgets orphelins (géoloc, aucun repas, hors zone) → exports SQL ad-hoc V1, dashboard dédié V1.1+ | Effort vs valeur, besoins terrain non confirmés | 2026-04-27 |
| D8 | Drill-down événement M07 reporté V1.1+ | Effort moyen jointure cross-schema, vue par tournée suffit V1 | 2026-04-27 |
| D9 | Pas de reports email scheduled V1 | Besoin non remonté, complexité cron + templates | 2026-04-27 |
| D10 | Pas de vue carte M02 V1 ni V1.1, reporté V2 | Nécessite intégration cartographique lourde | 2026-04-27 |

---

## 9. Questions ouvertes

1. — **Résolu 2026-04-28 (propagation §10)** : palette complète définie §10 §2. vert `#2D7A4B`, warning `#F59E0B`, critical `#DC2626`, info `#3B82F6`, neutres. Tokens Tailwind `savr-*`. Débloque implémentation `<KPICard />`, `<ChartBar />`, etc.
2. **Export PDF Puppeteer Edge Function** : valider que Vercel Edge Functions supportent Puppeteer (ou bascule Render/Fly worker dédié). À traiter en atelier tech avec le frère (cf. [[03 - Ateliers/Atelier tech avec frère - 2026-04-23]]).
3. **Limite 10 000 lignes export CSV** : valider à l'usage. Si Admin TMS demande régulièrement plus, prévoir une « extraction complète » via Edge Function lourde paramétrée.
4. **Recherche globale header** (V1.1+) : périmètre à définir (collectes par ID/référence ? tournées ? prestataires ? lieux ?). Reporté V1.1.
5. — **Résolu 2026-04-28 (propagation §10 §6.2)** : **Recharts V1 définitif**. Tremor rejeté V1 (overkill consumer). Visx évalué si charts avancés V1.1+ (waterfall, heatmap). Wrappers `<ChartBar />` / `<ChartLine />` / `<ChartPie />` dans `packages/ui-tms` isolent migration future.

---

## 10. Liens

### CDC TMS (sections internes)

- [[00 - Index]] — index global TMS
- [[01 - Vision et objectifs TMS]] — vision et objectifs métier
- [[03 - Périmètre fonctionnel TMS]] — périmètre fonctionnel des 14 modules V1
- [[04 - Data Model TMS]] — data model (vue à la volée D3 `v_m07_dashboard` + vue matérialisée D4 spécifiées dans addendum M07/M08)
- [[07 - Architecture technique TMS]] — monorepo pnpm, Next.js 15, Vercel 2 fronts
- [[09 - Authentification et permissions TMS]] — RLS + gating frontend
- [[10 - Design System TMS]] — palette + composants (**V1 rédigée 2026-04-28**)
- [[12 - App mobile chauffeur]] — PWA M05 (consolidation à rédiger)
- [[14 - Scalabilité TMS]] — cibles performance
- [[15 - Sécurité et conformité TMS]] — accessibilité, audit logs export

### Modules sources des dashboards

- [[06 - Fonctionnalités détaillées TMS/M01 - Réception ordres de collecte]] — D9 Ingress
- [[06 - Fonctionnalités détaillées TMS/M02 - Dispatch Ops Savr]] — D1 Dispatch
- [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]] — D13 Accueil + D14 Revenus
- [[06 - Fonctionnalités détaillées TMS/M07 - Pilotage financier logistique]] — D3 Pilotage
- [[06 - Fonctionnalités détaillées TMS/M08 - Facturation prestataires]] — D4 Trésorerie
- [[06 - Fonctionnalités détaillées TMS/M09 - Stock matériel Savr]] — D5 Stocks
- [[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia]] — D6 Exutoires
- [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]] — D2 Alertes + cloche header
- [[06 - Fonctionnalités détaillées TMS/M12 - Attribution transporteur]] — D11 Monitoring M12
- [[06 - Fonctionnalités détaillées TMS/M13 - Administration TMS]] — D8 Admin home + D10 Monitoring intégrations
- [[06 - Fonctionnalités détaillées TMS/M14 - Intégration Everest]] — D7 Everest

### CDC Plateforme (cohérence cross-app)

- [[01 - Cahier des charges App/00 - Index]] — index global Plateforme
- [[01 - Cahier des charges App/03 - Périmètre fonctionnel global]] — périmètre Plateforme dont navigation home rôles Plateforme

---

**Fin §11 — V1 rédigée 2026-04-27.**
