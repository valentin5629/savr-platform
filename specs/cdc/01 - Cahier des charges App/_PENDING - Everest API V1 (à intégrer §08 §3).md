# _PENDING — Everest API V1 (matière à intégrer en §08 §3)

> **Statut** : note de parking — 2026-06-08. NE PAS coder depuis cette note.
> **Action de sortie** : relancer la skill **`cdc-app-savr`** pour intégrer proprement ces éléments dans `08 - APIs et intégrations.md` **§3** (auth, services, mapping, sécu, questions ouvertes), en cohérence avec M14 (réf V2) et le Data Model. **À faire APRÈS réception de la réponse du dev Everest** (cf. questions ouvertes ci-dessous).
> **Gate Everest** (CLAUDE.md §7) : reste partiellement BLOQUANT tant que les 2 questions ouvertes ne sont pas soldées.

---

## 1. Réponses dev Everest confirmées (à figer)

Source : échange mail dev Everest, 2026-06-07/08.

- **TTL token Bearer (`/auth`)** : pas de refresh token. Le token n'expire pas dans le temps ; il est invalidé **uniquement** lorsqu'une nouvelle `/auth` est effectuée.
  - **Conséquence archi** : l'adapter doit avoir **un point d'authentification unique et centralisé** (cache du token, ré-auth seulement sur 401). Deux process concurrents qui ré-authentifient s'invalident mutuellement → à éviter absolument.

- **Sécurisation des webhooks sortants Savr → Everest** (`mission_dispatched`, etc.) : sécurisé **uniquement par l'URL** (secret intégré dans l'URL). **Pas de HMAC**, pas de signature.
  - **Conséquence** : l'URL webhook = secret à stocker en **Supabase Vault**, endpoint non-devinable. Aucune signature à vérifier côté Savr. Niveau de sécurité plus faible que MTS-1 → **risque assumé à documenter**.

- **Environnement de test** : **pas de sandbox** dans l'abonnement A Toutes!. Le dev peut créer un **compte client de test** à la place.

- **Récupération des statuts** (constat swagger) : les statuts de mission ne sont **pas un enum statique**. Ils sont **configurables par plateforme** et récupérables au runtime via **`POST /statuses`** ("List mission status types... with workflow rules"). Ils sont groupés en **catégories de workflow** : `success` / `fail` / `finish` / `cancel` / `pickup` (un webhook par catégorie : `mission_failed`, `mission_succeeded`, etc.).

- **Services (constat swagger)** : `service_id` est un simple `integer`. **Aucun enum**, **aucun endpoint de listing des services**. La table `id → libellé` doit donc venir du dev (faite, cf. §2).

---

## 2. Services Everest utilisés + logique de routage

> ✅ **TRANCHÉ 2026-06-08 (Val)** : Vélo Express = **`74`** (créneau 30 min, confirmé par le dev). Le **`75` est abandonné** (on ne l'utilise pas). Les 4 services retenus : **71 / 74 / 77 / 91**.

| service_id | Libellé | Quand l'utiliser (logique métier Val) |
|---|---|---|
| `71` | (Vélo Frais) Programmé H+2, créneau 30 min | Collecte programmée **> 2h à l'avance** (≈ 99 % des cas) |
| `74` | (Vélo Frais) Express >1.5h, créneau 30 min | Collecte programmée **à la dernière minute** (≈ 1 % des cas) |
| `77` | (Camion Frais) Camion Express >3,5h, créneau 1h | **Marathon indisponible** + besoin d'un camion **à la dernière minute** |
| `91` | (Camion Frais) Camion Programmé H+4, créneau 30 min | **Marathon indisponible** + camion pour collectes programmées **≥ 2h avant** l'événement |

**Impact sur le §08 §3 existant (lignes ~270-284) — données périmées à corriger lors de l'intégration :**
- Le mapping actuel liste « services 71 / 75 / 91 » et ne mappe que `ag_velo_programme → 71` et `ag_marathon_volume_backup_camion → 91`. → Remplacer le `75` par `74` et ajouter le `77`.
- À refaire : intégrer **les 4 services (71 / 74 / 77 / 91)** (ajout des deux variantes Express **Vélo** `74` et **Camion** `77`), avec le critère de routage **programmé (≥2h) vs express (dernière minute)** ci-dessus, et le critère **Marathon indispo → camion Everest**.
- Aligner les `branche_attribution` Plateforme (§06.09 §2.3) sur ces 4 services — **décision métier de mapping branche→service à finaliser en session `cdc-app-savr`**.

---

## 3. Questions ouvertes — mail envoyé au dev Everest (2026-06-08), en attente

1. **Statut « course vide »** (client absent / rien à enlever) : ✅ **résolu métier 2026-06-29** (CLAUDE.md §7 ; décision Val « re-fetch mission_status », spec figée §08 §3 « Course sans marchandise (V1) »). **Wire à figer au compte de test** : `event_type` exact (catégorie `fail` vs `success`), libellés `mission_status` réels (`POST /statuses`), disponibilité d'une photo de lieu. Hypothèse de travail conservée : catégorie `fail` → webhook `mission_failed`.
2. **Compte client de test** : à créer par le dev + transmission des accès. Permettra de récupérer la liste réelle des statuts via `POST /statuses`.

*(Vélo Express `74` vs `75` → TRANCHÉ 2026-06-08 : `74` retenu, `75` abandonné. Cf. §2.)*

---

## 4. Rappel de sortie

- ✅ Matière confirmée consignée (sections 1-2).
- ⏳ Attendre réponse dev (section 3) **avant** de relancer `cdc-app-savr`.
- 🔁 **Relancer `cdc-app-savr`** pour intégrer tout ceci en §08 §3 et clore la session « spec Everest API V1 ». Supprimer cette note de parking une fois l'intégration faite.
- 🔁 Régénérer ensuite l'export `_DEV-FACING/` (`cdc-devfacing-export`) avant le handoff dev.
