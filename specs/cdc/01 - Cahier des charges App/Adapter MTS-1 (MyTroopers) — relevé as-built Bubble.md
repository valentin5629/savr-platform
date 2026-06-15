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
| Create tour **dechet** *(DRAFT)* | POST | Crée la tournée ZD ; ajoute **`volume_du_camion` (ex 9m3)** + **`MTS_1_delivery_place` (exutoire, ex BlueSpaceIvry)**. |
| Create tour alimentaire | POST | Idem pour AG. |
| Dispatch tour | POST `…/tours/…/dispatch` | Body `{ carrierShareableCode }` (= `transporteurs.code_transporteur_mts1`, ex `CA_49TWSU`) → assigne Strike/Marathon. |
| Validate tour | PUT | Body vide → passe `status.validation` à `VALIDATED`. |

**Clé de corrélation** : `orderNumber = collecte.reference` (`#1601…`) — sert à rapprocher commandes/tournées MTS-1 ↔ collectes Plateforme.

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

⚠ **Téléphone chauffeur NON exposé** par l'API : `transporters[]` ne porte ni téléphone ni email (seul `phone` de l'API = contact destinataire de la commande). Aucun endpoint « get transporter ». → seul élément à demander à MTS-1 (ou non récupérable via API). Unité pesées confirmée = **kg**.

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
