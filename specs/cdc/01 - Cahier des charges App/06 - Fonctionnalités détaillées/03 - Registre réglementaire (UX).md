# 06.03 - Registre réglementaire (UX)

**Périmètre V1** : collectes ZD uniquement. Tout le volet AG (associations, attestations 2041-GE, habilitation) est reporté V2 — voir section [[#Reporté V2]] en bas de page.

---

## Contexte

Module 20 MVP. Registre chronologique des flux de déchets ZD accessibles à tous les profils espace client (périmètre filtré par RLS). Source unique de vérité pour audits et démonstrations ESG.

**Périmètre des lignes (tranché F2 2026-06-07)** : collectes `statut = cloturee` ET `type = zero_dechet` uniquement (vue `v_registre_dechets` §04). Les collectes `realisee` n'apparaissent pas (registre = définitif). Le filtre « Statut bordereau dispo/manquant » couvre la fenêtre clôture → batch J+1 6h et les bordereaux `brouillon` (shadow sans SIRET). Les collectes migrées incomplètes portent le badge « Historique partiel » (`collectes.historique_partiel`, F3).

---

## Accès

- Entrée de menu permanente dans l'espace client : "Registre réglementaire"
- Visible pour tous les rôles (périmètre filtré)

---

## Vue liste (par défaut)

### Layout

Tableau principal + barre de filtres en haut + bouton d'export à droite.

### Colonnes du tableau (ordre par défaut)

| Colonne          | Source                                                                                                                                                                                                                         | Tri             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Date événement   | `evenements.date_evenement`                                                                                                                                                                                                    | Desc par défaut |
| Lieu             | `lieux.nom`                                                                                                                                                                                                                    | Oui             |
| Traiteur         | **Traiteur opérationnel** (`evenements.traiteur_operationnel_organisation_id` → `organisations.raison_sociale`) — producteur juridique du déchet, cohérent snapshot bordereau (tranché F4 2026-06-07). Fiches shadow incluses. | Oui             |
| Flux             | Badges 5 flux V1 : biodéchets, emballages, carton, verre, déchet résiduel                                                                                                                                                      | Filtre multi    |
| Poids total (kg) | `SUM(collecte_flux.poids_reel_kg)`                                                                                                                                                                                             | Oui             |
| Exutoire         | `exutoire.nom`                                                                                                                                                                                                                 | Oui             |
| Bordereau        | Lien PDF téléchargeable                                                                                                                                                                                                        | —               |

### Barre de filtres

- Période (date picker début-fin, preset "30 derniers jours")
- Lieu (multi-select)
- Traiteur (multi-select, visible selon RLS)
- Flux (multi-select)
- Statut bordereau (dispo / manquant)

### Tri

Colonnes triables, tri mono-colonne (sobriété 2026-06-03 B1 — multi-tri Shift+clic reporté V1.1).

### Pagination

25 lignes par page par défaut. Option 50 / 100. Infinite scroll envisagé V1.1.

---

## Vue détaillée (drill-down)

Clic sur une ligne → page de détail de la collecte avec :

### Header

- Titre : "Collecte ZD — {{date_evenement}} — {{lieu_nom}}"
- Statut bordereau
- Bouton téléchargement PDF bordereau

### Bloc 1 — Données événement (snapshot)

Nom, date, horaire, pax, type d'événement, client organisateur.

### Bloc 2 — Producteur de déchets (snapshot)

Raison sociale, SIRET, adresse. Lecture seule.

### Bloc 3 — Lieu (snapshot)

Nom, adresse complète.

### Bloc 4 — Transporteur (snapshot ZD)

Nom (prestataire logistique), SIRET.

> Note dev : `plaque_vehicule` et `chauffeur_nom` restent **stockés** dans le snapshot collecte côté DB (audit DREAL en cas de contrôle), mais **non affichés** dans l'UX V1.

### Bloc 5 — Exutoire (snapshot ZD)

Nom, SIRET, adresse, filière de valorisation, code déchet européen.

### Bloc 6 — Détail des flux

Tableau : flux, code déchet européen, filière, poids réel.

### Bloc 7 — Documents

- Bordereau Savr (PDF) + numéro + date émission + version

### Bloc 8 — Historique

Audit log : création, modifications de pesée, régénérations bordereau, contestations.

---

## Vue méthodologie (statique V1)

Bouton "Méthodologie" accessible depuis le registre → ouvre la **même notice méthodologique unique que celle du rapport de recyclage** (formule à captation par filière, méthode UE 2019/1004 — cf. [[12 - Reporting et exports#À INTÉGRER LORS DE LA FINALISATION — Notice méthodologique CSRD / ESRS E5 / AGEC]] et [[05 - Règles métier#R_taux_recyclage]]). Source méthodo unique cross-document (sobriété 2026-06-03 C2 — plus de PDF méthodo séparé uploadé par l'Admin, qui risquait de diverger de la notice §12).

V2 : version dynamique avec paramètres de calcul éditables.

---

## Exports

### Export CSV

Bouton "Exporter" → CSV des lignes filtrées courantes. Colonnes : toutes celles du tableau + colonnes additionnelles (code déchet, filière, poids par flux détaillé).

### Export registre PDF — reporté V1.1 (sobriété 2026-06-03 A1)

Le PDF formaté "registre réglementaire type" (3ᵉ template Puppeteer : tableau chronologique + header Savr + page méthodologie + annexes bordereaux) est reporté V1.1. Le besoin réglementaire V1 (tenue du registre déchets, art. R541-43) est couvert par l'**export CSV registre** (tableau chronologique complet) + le **ZIP bordereaux** (pièces justificatives). V1.1 : templates personnalisables, intégration logo client.

### Export ZIP bordereaux

Bouton "Télécharger tous les bordereaux" → ZIP contenant tous les bordereaux PDF de la période filtrée.

**Plafond : 50 fichiers par export (décision 2026-05-29, alignée sur l'export groupé de rapports §06.04)** — au-delà, l'utilisateur restreint la période. Évite les timeouts de génération. Borne ajustable en V1.1.

---

## Règles de visibilité (RLS)

Source de vérité unique : [[05 - Règles métier#7. Règles d'accès au registre réglementaire (Module 20)]] et [[09 - Authentification et permissions]]. La table de périmètre par rôle a été retirée d'ici (sobriété 2026-06-03 C1 — évite la divergence silencieuse constatée lors de la propagation `lieu_independant → gestionnaire_lieux`). Rappel non normatif : les 6 rôles V1 voient le registre filtré à leur périmètre, `client_organisateur` en lecture seule avec export CSV autorisé.

---

## Décisions prises

- **Watermark PDF** : tous les PDFs réglementaires (bordereaux, export registre) portent la mention "Document généré par Savr — référence {{numero_document}} — toute altération invalide le document" en pied de page, plus un QR code renvoyant à une page publique de vérification (V1.1 pour la page publique, V1 pour le QR inactif).
- **Rétention documents** : accès illimité aux PDFs côté espace client (pas d'archivage masqué V1). Stockage Supabase Storage non capé V1.
- **Export PDF réglementaire reporté V1.1** (sobriété 2026-06-03 A1) : template et rendu à co-construire en phase de build (itérations Puppeteer) lors du passage V1.1. Hors scope V1 — CSV registre + ZIP bordereaux couvrent l'obligation R541-43.
- **Snapshot transporteur** : `plaque_vehicule` et `chauffeur_nom` conservés en DB côté snapshot collecte mais non affichés dans l'UX V1 (audit DREAL).
- **Rapport RSE PDF retiré du registre** (2026-05-04) : le rapport RSE est un livrable consolidé multi-collectes, il ne vit pas sur la page de détail d'une collecte unitaire. Il est adressé dans deux emplacements dédiés :
  - Espace Traiteur → onglet **Rapports RSE** (voir [[04 - Espace client traiteur#5. Rapports RSE]])
  - Espace Gestionnaire de lieux → onglet **Rapports** (voir [[05 - Espace client gestionnaire de lieux#4. Section Rapports]])

---

## Reporté V2

Tout le périmètre AG (Aide à la Générosité) est exclu de la V1 et sera réintégré en V2 :

- Type de collecte AG, filtre AG, badges AG dans la colonne Flux.
- Bloc 6 — Association (snapshot AG) : nom, SIRET, adresse, habilitation 2041-GE.
- Colonne Attestation + statut document attestation.
- Bloc 7 enrichi : équivalent roll déclaré par chauffeur, photos (déclaration AG).
- Bloc Documents : Attestation de don (PDF) + numéro + date émission.
- Décision "Alerte conformité habilitation 2041-GE" (perte d'habilitation entre 2 collectes).
- Notifications in-app "nouveau bordereau / attestation émis".

---

## Questions ouvertes

_Aucune — module stabilisé pour V1 ZD-only. Ré-ouvrir si besoin métier pendant le build._
