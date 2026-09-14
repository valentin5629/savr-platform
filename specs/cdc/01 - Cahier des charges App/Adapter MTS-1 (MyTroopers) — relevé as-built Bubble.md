# Adapter MTS-1 (MyTroopers) — relevé as-built depuis Bubble

**Date** : 2026-06-05
**Source** : API Connector Bubble (projet `savr`), collections `MTS-1` (10 appels), `MyTrooper` (3), `Everest` (2).
**But** : figer le fonctionnement réel de l'intégration Bubble↔MTS-1 pour que l'**adapter MTS-1 de la Plateforme V1** soit au moins iso-fonctionnel (remontée pesées + photos + statuts). MTS-1 = produit **MyTroopers**.

> ⚠ **Précision §08 §3bis** : l'intégration **Bubble** actuelle est en **POLLING** (GET). MAIS la doc officielle MTS-1 V3 montre que **MTS-1 supporte AUSSI les webhooks push** (5 events, cf. §7). Donc l'adapter V1 a le **choix** : polling (comme Bubble) ou webhooks natifs MTS-1 (recommandé — temps réel, moins de charge, colle au design event-driven du contrat §08).

---

## 1. Authentification

- **Endpoint** : `POST https://gateway.pre.mytroopers.com/v2/auth/token` *(env `pre` = préprod ; URL prod à confirmer)*
- **Body / params** : `{ client_secret, grantType: "credentials" }` (OAuth client-credentials)
- **Retour** : token Bearer, utilisé ensuite sur les appels data.
- **Stockage V1** : secret/token → **Supabase Vault**, jamais en clair.
- **Méthode documentée (officielle)** : une **API Key** générée dans l'UI MTS-1, transmise dans chaque requête en header `Authorization: Bearer <api-key>`. C'est la voie la plus simple pour l'adapter (le flow client-credentials `gateway/v2/auth/token` vu côté Bubble est une alternative). À trancher : API Key statique vs token OAuth.

## 2. Environnements / URLs

| Usage | Base URL (relevée, DEMO/PRE) |
|---|---|
| Auth | `https://gateway.pre.mytroopers.com/v2` |
| Data (customer orders / tours) | `https://demo-connector-customer.prod.mytroopers.io/v3` |

→ URLs **prod** à récupérer (remplacer `demo-connector` / `pre`).

## 3. Remontée (ENTRANT) — par polling

| Appel | Endpoint | Rôle / champs clés |
|---|---|---|
| Liste commandes | `GET /v3/customerOrders?minDate&maxDate` | Boucle de polling sur fenêtre de dates. |
| Détail commande | `GET /v3/customerOrders/{customerOrderId}` | `customerOrderStatus` (DRAFT…), `stuffs[]` (`name`, `task: PICKUP`, `measurement{height,length,width,weight}`), `contact`, `place`, `orderNumber`, `trackingUrl`. |
| **Détail tournée** | `GET /v3/tours/{tourId}` | **Porte les pesées réelles.** Voir détail ci-dessous. |
| Photo | `GET {photo_URL}` (type Text) | MTS-1 fournit des **URLs de photos** dans le payload ; Bubble les télécharge une par une. |

### `GET /v3/tours/{tourId}` — structure
- `tourId`, `tourNumber`, `status { dispatch, payment, validation }` (ex : `ACCEPTED` / `VALIDATED` / `DRAFT`)
- `tourDate`
- `stops[]` :
  - `customerOrders[] { customerOrderId, customerOrderStatus, orderNumber, customerOrderProgressionStatus }`
  - `estimatedTimeOfArrival`, `stopId`, `globalStatus`, `atPlaceAt`, `finishedAt`
  - éléments collectés : **`weight`**, **`quantity`**, **`quantityAfterPickup`**, **`quantityAfterDelivery`**, `measurement{…}`
  - `scannerGenericReference`, `scannerUniqueReferences`, `pickupStatusReason`, `deliveryStatusReason`
- `summary { durationInMinutes, distanceInKilometers }`
- `dispatch { carrierShareableCode, transporterUserShareableCode, vehicleShareableCode }`

### Mapping remontée → Plateforme V1
- **Pesées** : `tours.stops[].weight` (+ `quantityAfterPickup/Delivery`) → `collectes` / lignes de flux (pesées ZD).
- **Statut collecte** : `customerOrderStatus` / `customerOrderProgressionStatus` + `status{dispatch,payment,validation}` → `collectes.statut_tms` → trigger `fn_sync_statut_collecte_from_tms`.
- **Photos** : URLs du payload → téléchargées (`GET {photo_URL}`) → ré-upload Storage Savr (persistance légale).
- **Coût / km** : `summary` (info).

## 4. Sortant (création + cycle de tournée)

| Appel | Endpoint | Corps clé |
|---|---|---|
| Create customer order | `POST /v3/customerOrders` | `orderDate, timezone, serviceTime, transportersNeededCount, orderCategories (["Alimentaire"] ou ["Déchets"]), orderNumber = collecte_id, place{address.addressSingleLine}, timeslots[{start,end}]`, contacts. |
| Create customer order **dechet** | `POST /v3/customerOrders` | Variante ZD : `orderCategories: ["Déchets"]`. **Stuffs relevés (lecture éditeur 2026-06-10, QO pesées par flux SOLDÉE)** : 1 stuff par flux, `task: PICKUP`, `relatedAddress.placeId = <MTS_1_delivery_place_id>` (exutoire), `quantity: 0` — libellés exacts : `<volume_du_camion>` (qty 1, stuff camion), `Bio-déchets (en kg)`, `Carton (en kg)`, `D.I.B (en kg)`, `Film plastique (en kg)`, `Verre (en kg)`. Mapping → `flux_dechets` figé dans §08 §3bis.7. |
| Create tour **dechet** *(DRAFT)* | `POST /v3/tours` | Crée la tournée ZD. **Corrigé 2026-09-04 (doc OpenAPI V3)** : `TourInput` = `{ tourDate*, tourNumber?, customerOrders?[], comments? }`. `tourDate` (string `yyyy-MM-dd`) est **obligatoire** (400 `INVALID_REQUEST` sinon) ; `customerOrderId`, `stuffs` et `deliveryPlace` y sont **ignorés** → `volume_du_camion` et point B se portent sur les `stuffs` de la COMMANDE. Réponse `TourCreateResponse = { tourId, … }`. |
| Create tour alimentaire | `POST /v3/tours` | Idem pour AG. |
| **Rattacher commande ↔ tournée** | `PUT /v3/tours/addCustomerOrder` | **Étape ajoutée 2026-09-04** — body `{ tourId, customerOrderId }` (`AddCustomerOrderToTourInput`). Sans elle la tournée reste VIDE. Rejouée inconditionnellement tant que la tournée est `planifiee`. |
| Dispatch tour | `POST /v3/dispatch/{tourId}/toCarrier` | **Route corrigée 2026-09-04** — l'ancienne `POST /v3/tours/{tourId}/dispatch` du relevé Bubble renvoie **404 `BAD_ROUTE`**, elle n'existe pas dans la spec V3. Body `DispatchToCarrierInput { carrierShareableCode?, transporterShareableCode?, vehicleShareableCode? }` — on envoie `{ carrierShareableCode }` (= `transporteurs.code_transporteur_mts1`, ex `CA_49TWSU`) → assigne Strike/Marathon. |
| Validate tour | PUT | Body vide → passe `status.validation` à `VALIDATED`. |

**Réponse de `POST /v3/customerOrders`** (corrigée 2026-09-04, doc OpenAPI) : schéma `CreateCustomerOrderResponse = { customerOrderId*, orderNumber*, customerOrderStatus, customerOrderMergedParentId, price, trackingUrl }`. L'id technique s'appelle **`customerOrderId`**, pas `id` — c'est lui qui est stocké dans `tournees.external_ref_commande` (lire `id` renvoyait `undefined` → 400 à l'étape `addCustomerOrder`).

**Point A / point B (règle métier confirmée Val 2026-09-04)** : point A = adresse d'enlèvement traiteur (`place` de la commande) ; **point B = `stuffs[].relatedAddress = { placeId }` de la COMMANDE** (`CustomerOrderPlaceInput`), jamais `deliveryPlace` de la tournée. ZD → **entrepôt Savr Saint-Denis** (favoritePlace `isDepot`, placeId en config `MTS1_ENTREPOT_PLACE_ID`) ; AG → association destinataire (favoritePlace `id_point_collecte_mts1`). ⚠ **Gap AG tracé** : en V1 l'AG n'envoie aucun `stuff`, donc rien ne porte son point B — décision « stuff de livraison AG » à trancher (lot dédié).

**Stuffs par type de collecte** *(figé 2026-09-14)* — le point B se portant sur `stuffs[].relatedAddress`, toute commande doit porter au moins un stuff :
- **ZD** : 1 stuff par flux (`task: PICKUP`, `quantity: 0`, pesé au polling) + 1 stuff camion `<volume_du_camion>` (qty 1). Libellés exacts au §4 ci-dessus. `relatedAddress.placeId` = entrepôt Savr.
- **AG** : **1 seul stuff `{ name: 'Don alimentaire', task: 'PICKUP', quantity: 0, relatedAddress: { placeId: association.id_point_collecte_mts1 } }`** *(validé Val 2026-09-14)*. `quantity: 0` au dispatch : le poids réel du don n'est pas connu à la programmation (mesuré pendant la collecte), exactement comme les 5 flux ZD — poids et photos remontent ensuite par le polling. Cohérent avec `orderCategories: ['Alimentaire']`.
  ⚠ Re-validation live AG à faire au 1er dispatch AG-via-MTS1 réel (read-back `GET /v3/customerOrders/{id}`) : le mécanisme `relatedAddress` → point B n'est prouvé en réel que pour le ZD.

**Contact et créneau de la commande** *(corrigé 2026-09-04, confirmé sur `CustomerOrderInput` et par read-back ; validé Val)* — le POST renvoyait 201 mais MTS-1 stockait `contact: {}` et `timeslots: null` : ni le contact terrain ni le créneau ne parvenaient au chauffeur.
- **`contact` est un objet UNIQUE** (`CustomerOrderContactInput` : `firstname`, `lastname`, `phone`, `phoneAlternatives`, `email`), **pas** un tableau `contacts` `{name, role}`.
- **Le créneau est porté par `place.timeslots`** (`Timeslot[{start, end}]`, format **`HH:mm`** — pas un datetime ISO), **pas** au niveau commande. Point fixe V1 : `start = end = heure_collecte` tronquée en `HH:mm`.
- **Mapping du nom** : Savr n'a qu'un `contact_principal_nom` (nom complet) → **1er mot = `firstname`, reste = `lastname`** (« Paul Pol » → firstname « Paul », lastname « Pol »).
- **Contact de secours** : MTS-1 n'expose qu'un contact par commande → son **téléphone** va dans `phoneAlternatives`, et **son nom est concaténé dans le champ `comment`** de la commande *(arbitrage Val 2026-09-14 — sans quoi le chauffeur a un numéro de secours sans savoir qui appeler)*.

**Flux nominal V3 corrigé** : `POST /v3/customerOrders` → `POST /v3/tours {tourDate}` → `PUT /v3/tours/addCustomerOrder` → `POST /v3/dispatch/{tourId}/toCarrier` → `PUT /v3/tours/{tourId}/validate`.

**Clé de corrélation** : `orderNumber = collecte.reference` (`#1601…`) — sert à rapprocher commandes/tournées MTS-1 ↔ collectes Plateforme.

> ⚠ **Source des contacts + lieu dans le payload V1** : les champs `contacts` et `place` du `POST /v3/customerOrders` sont peuplés depuis l'**ÉVÉNEMENT parent** (`evenements.contact_principal_*` / `contact_secours_*` / `evenements.lieu_id`), **jamais depuis `collectes`** (pas de duplication en V1, §06.04 l.375). Le worker `outbox-worker.fetchCollecte` doit requêter `evenements!inner(contact_principal_nom, contact_principal_prenom, contact_principal_telephone, contact_secours_*, lieu_id, lieux!inner(adresse_complete))`. `mts1/adapter.updateLieu` filtre via `evenements.lieu_id`, non `collectes.lieu_id`. Patch appliqué suite à divergence M1.5a_20260626.

## 5. Everest (A Toutes! / AG vélo cargo) — hors pilote Kaspia ZD
- `POST Create mission` + `GET Get mission` (même pattern create + poll). À détailler quand l'AG entre dans le périmètre.

## 6. Résolution véhicule / plaque d'immatriculation — RÉSOLU (doc MTS-1 V3, 2026-06-05)

La plaque **n'est pas** sur le tour/la commande. Elle est sur l'objet véhicule de **`GET /v3/carrier`** :
```
carriers[] : { carrierShareableCode, name, vehicles[], transporters[] }
vehicles[] : { name, numberPlate, vehicleShareableCode }   // ex numberPlate = "12ABC23"
```
**Algo adapter** :
- **Plaque** : lire `dispatch.vehicleShareableCode` (tour) → matcher `vehicles[].vehicleShareableCode` → `numberPlate`.
- **Chauffeur (nom/prénom)** : lire `dispatch.transporterUserShareableCode` (tour) → matcher `transporters[].transporterShareableCode` → `firstname` + `lastname`. Objet transporteur = `{ firstname, lastname, transporterShareableCode }`.
- `GET /v3/carrier` se met en cache (référentiel quasi statique).

⚠ **Téléphone chauffeur NON exposé** par l'API : `transporters[]` ne porte ni téléphone ni email (seul `phone` de l'API = contact destinataire de la commande). Aucun endpoint « get transporter ». → seul élément à demander à MTS-1 (ou non récupérable via API). Unité pesées confirmée = **kg**. *(Divergence PLAQUES 2026-07-15 : le champ optionnel `transporters[].phone` est **réservé** — capté auto si l'API l'expose un jour ; en V1 le téléphone chauffeur reste **saisi manuellement (Admin)**, et l'accompagnant n'est jamais auto — 1 transporteur par dispatch. Point d'extension prêt sans refonte.)*

## 7. Statuts (enums officiels)

- `customerOrderStatus` : `QUOTE, DRAFT, PLANNED, VALIDATED, IN_PROGRESSION, KO, OK, PARTIAL, ARCHIVED, CANCELED`
- `customerOrderProgressionStatus` : `NOT_STARTED, STARTED, FINISHED`
- `tour.status` = objet `{ validation, payment, dispatch, progression, dispatchedAt, startedAt, finishedAt }`
- Webhook **tour/update** eventType : `DISPATCHED, CANCELED, VALIDATED, UNVALIDATED, UPDATED`
- Webhook **tour/progress** / **customerOrder/progress** eventType : `STARTED, FINISHED`
- Webhook **stop/progress** eventType : `ON_THE_WAY, AT_PLACE, FINISHED, RESET` ; `stopStatus { globalStatus, deliveryStatus, pickupStatus }`
- `appointmentStatus` : `NONE, AWAIT_RESPONSE, RESPONSE_KO, RESPONSE_OK`
- Photos : sur le webhook `stop/progress` (`photos[]` = StopPhoto download links) + `GET /v3/tours/photo/{tourId}/{stopId}/{photoId}` ; signatures via `GET /v3/tours/signature/{tourId}/{stopId}/{signatoryType}` (`contact` | `transporter`).

## 8. Webhooks push — alternative recommandée au polling

MTS-1 appelle des endpoints **que l'adapter expose** (à implémenter côté Plateforme) :
- `POST /v3/webhook/stop/progress` (photos + signatures + statuts stop)
- `POST /v3/webhook/customerOrder/progress` (+ `customerOrderStatus`)
- `POST /v3/webhook/customerOrder/update` (CANCELED/UPDATED)
- `POST /v3/webhook/tour/progress` / `POST /v3/webhook/tour/update`
- Côté MTS-1 : `GET /v3/webhook` (liste des webhooks envoyés + statut) et `POST /v3/webhook/{id}` (relance) → filet de rattrapage en cas de panne réception.

→ **Recommandation adapter V1** : webhooks push pour le temps réel + `GET /v3/webhook` (ou polling `GET /v3/tours`) comme rattrapage. Les pesées détaillées restent lues sur `GET /v3/tours/{id}` (`stops[].weight`).

## 9. Décisions actées (2026-06-05, Val)

- **Auth = API Key statique** : `Authorization: Bearer <clé>` générée dans l'UI MTS-1, stockée Supabase Vault, server-side only. Vérif d'amorçage : générer la clé + tester `GET /v3/tours` ; si le compte prod n'accepte que l'OAuth gateway → bascule (plan B), sinon on reste API Key.
- **Remontée = Polling** : cron interroge `GET /v3/customerOrders` + `GET /v3/tours` (+ photos) sur fenêtre `minDate/maxDate` glissante, cadence **15-30 min** en journée (suffisant pour batch J+1). Pas de webhooks en V1. Dédup via `integrations_inbox`. Webhooks reportés (seulement si besoin temps réel émerge).

## 10. Points ouverts restants

1. **URLs + clé de production** (à générer console MTS-1 ; remplacer DEMO/PRE) — action Val avant go-live, non bloquant pour spécifier.
2. **Téléphone du chauffeur** : non exposé par l'API → à demander à MTS-1 « dans un second temps » (ou non récupérable). _(Unité pesées `stops[].weight` = kg : confirmé.)_
