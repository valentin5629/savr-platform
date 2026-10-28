# 12 - Reporting et exports


---

## Vue d'ensemble

Deux types de sorties documentaires dans la Plateforme Savr :

1. **Documents PDF** : générés automatiquement ou à la demande, archivés dans Cloudflare R2
2. **Exports tabulaires (CSV)** : à la demande, filtrés par RLS selon le profil utilisateur

**Règle embargo H+24 (énoncé canonique — source unique de cette section, revue sobriété §12 2026-06-03 C1)** : aucun rapport de collecte n'est généré ni accessible avant **`collectes.realisee_at` + 24h** (`realisee_at` = horodatage du passage de la collecte à `realisee`, émis par le webhook S5 terminal du TMS). Ce délai laisse à l'Admin Savr le temps de corriger une pesée erronée reçue du TMS avant la première génération automatique. La fenêtre est matérialisée par `rapports_rse.disponible_a` (cf. [[04 - Data Model]]) et la génération automatique tombe au batch J+1 6h. Toutes les sous-sections (§1.2, §1.3) renvoient à cet énoncé sans le redéfinir.

**Convention de dates (refonte 2026-05-21 D2, mise à jour 2026-05-29)** : sur tous les documents et exports **destinés au client** (rapports de recyclage, attestations, synthèses, CSV), la date de référence affichée est **`evenements.date_evenement`** — champ backend auto-dérivé = `MIN(collectes.date_collecte)` de l'événement (trigger `fn_set_date_evenement`). C'est la date la plus tôt parmi les collectes de cet événement. **La date de collecte** (`collectes.date_collecte`) reste la référence des documents réglementaires/logistiques (bordereau de pesée, constat de présence chauffeur). Plus de distinction "date client vs date logistique" à expliquer côté UX : l'utilisateur ne saisit que `date_collecte`, `date_evenement` est calculé automatiquement.

**Agrégation multi-camions (révisé 2026-05-25, Sujet 1 option A — annule D3/4a)** : un gros volume nécessitant plusieurs camions reste **interne au TMS** (1 collecte ZD traiteur → N tournées prestataire). Les pesées des N camions sont agrégées sous la **collecte ZD unique** (webhook S5 agrège par `collecte_tms_id`). Rapports et alertes opèrent donc **au niveau de la collecte** (= unité programmée par le traiteur), plus au niveau événement. Voir §1.2 et §1.5.

---

## 1. Documents PDF

### 1.1 Bordereau de pesée ZD

**Déclenchement** : batch automatique J+1 à 6h (le lendemain matin de la collecte).

**Contenu** :
- En-tête : nom événement, **date de l'événement** (référence client), **date de collecte** (mention "intervention le {{date_collecte}}" si ≠ date événement — vérité réglementaire du bordereau), lieu, traiteur, nombre de convives de LA collecte (`collectes.pax` ; 0 = inconnu → mention omise — lot C2, décision Val Q5 du 2026-10-24)
- Tableau des pesées par flux (5 flux ZD V1 : biodéchets, emballages, carton, verre, déchet résiduel), avec pour chaque flux le **code déchet européen**, le **code de traitement R/D** et le **mode de traitement** (snapshot depuis `flux_dechets.code_dechet_europeen` / `code_traitement` / `mode_traitement`, ajout 2026-10-02). **Aucune valeur en dur ici** : les codes et les sites de traitement sont ceux du référentiel `flux_dechets` (cf. [[04 - Data Model]] § Table `flux_dechets`, tableau seed — codes Veolia, décision Val 2026-10-04).
- Filière de traitement : **un site de traitement par flux** (`flux_dechets.exutoire` / `exutoire_adresse`), copié par flux dans `bordereaux_savr.detail_flux` à l'émission (plus d'exutoire unique pour la collecte — décision Val 2026-10-04, divergence M4.2). Mention : « Ce bordereau permet de répondre aux exigences du décret n° 2016-288 du 10 mars 2016 ».
- Poids en kg + équivalent en nombre de bacs/rolls
- Totaux par catégorie
- Signature et cachet Savr
- Watermark "Document officiel Savr" + QR code vérification (V1.1)

**Accessibilité** : Admin Savr + traiteur_manager + traiteur_commercial (lecture seule). RLS par `organisation_id`.

**Régénération** : disponible pour Admin Savr uniquement (en cas de correction de pesée post-génération). **V2 (audit cohérence 2026-07-06)** : également **automatique** à réception d'un webhook S5 `type=correction` TMS (toute source — cf. [[08 - APIs et intégrations]] §1), même mécanique de versionnage.

---

### 1.2 Rapport de recyclage ZD (PDF agrégé "rapport RSE" — refonte 2026-05-04)

**Déclenchement** : **au téléchargement** (décision Val 2026-10-16). Aucun rapport n'est fabriqué automatiquement : le batch J+1 6h émet le bordereau, crée la ligne `rapports_rse` (fin d'embargo = `disponible_a`) et envoie l'email « rapport disponible » ; le PDF est fabriqué au clic de celui qui le télécharge, avec ou sans le radar de comparaison, et n'est pas stocké (chacun fabrique le sien). Les données mesurées imprimées sont celles figées à la clôture ; la page 2 reprend l'instantané du bordereau émis, quand le demandeur peut lire ce bordereau sous sa RLS (sinon pas de page 2, §1.7).

**Règle embargo** : voir l'énoncé canonique H+24 en Vue d'ensemble (départ = `collectes.realisee_at`, fenêtre `rapports_rse.disponible_a`).

**Logos du client et du traiteur dans le rapport (maquettes validées 2026-10-13)** : l'en-tête porte le logo Savr et deux emplacements, chacun omis s'il n'a pas de logo.
1. **Logo du client** : si la collecte est programmée par une agence → logo de l'agence (`organisations.logo_url` du programmateur) ; sinon, si `client_organisateur_organisation_id` est renseigné ET `organisations.logo_url` existe → logo du compte Savr ; sinon, si `evenements.logo_client_organisateur_url` est renseigné → logo déposé à la programmation ; sinon pas de logo client.
2. **Logo du traiteur** : `organisations.logo_url` du traiteur opérationnel ; sinon pas de logo traiteur.

**Contenu (refonte 2026-05-04 — PDF agrégé multi-pages)** :

Le PDF dit "rapport RSE" est désormais un document unique multi-pages qui agrège tous les justificatifs de la collecte (refonte §06.04 : suppression UI bordereau / attestation séparée côté traiteur). Architecture du PDF :

**Portée (révisé 2026-05-25, Sujet 1 option A — annule D3/4a)** : le rapport de recyclage est généré **au niveau de la collecte ZD** (unité programmée par le traiteur). Le taux de recyclage, les tonnages et le benchmark kg/pax sont calculés sur cette collecte. Si la collecte a mobilisé plusieurs camions, l'éclatement et l'agrégation des pesées sont **internes au TMS** : la Plateforme reçoit, via webhook S5, les pesées déjà **agrégées par flux pour la `collecte_id`** (somme des N camions). Le taux figé exploité est `collectes.taux_recyclage` (cf. [[05 - Règles métier#R_taux_recyclage]]). La page Bordereau de pesée intégré (page 2) reproduit le bordereau de la collecte, quand le demandeur peut le lire sous sa RLS (§1.7). Plus d'agrégation niveau événement.

- **Page 1 (toujours présente)** — Synthèse RSE :
  - En-tête (maquettes validées 2026-10-13) : logo Savr, titre « Rapport de recyclage », **nom du client organisateur** (`evenements.nom_client_organisateur`, sinon nom du compte client lié, sinon nom de l'événement) suivi de « × {{traiteur}} » (nom du traiteur opérationnel, omis s'il est identique), logo du client et logo du traiteur (voir « Logos » ci-dessous) ; puis **date de l'événement** (`evenements.date_evenement`), lieu et adresse, nombre de convives de LA collecte (`collectes.pax`, « — » à 0 — lot C2, décision Val Q5 du 2026-10-24). La date de collecte reste en page Bordereau.
  - **Taux de recyclage** (%) — indicateur principal, **formule à captation par filière** méthode UE 2019/1004 (cf. [[05 - Règles métier#R_taux_recyclage]]). Lu depuis `collectes.taux_recyclage` (figé à la clôture, reproductibilité PDF). Tooltip côté UI espace traiteur ; en PDF = mention discrète "Calculé selon la méthode UE 2019/1004 — taux de captation par filière. Voir Méthodologie."
  - Tonnage et part par flux (5 flux ZD V1 — sans calcul de "taux par flux", supprimé 2026-05-06 : la métrique unique est le taux de recyclage global de la collecte)
  - **Bloc impact carbone (refonte 2026-06-04, Sujet 3)** — lu depuis les colonnes figées `collectes.co2_*` (snapshot `co2_facteurs_snapshot`, reproductible). Présentation conforme **règle ABC** :
    - Émissions **évitées** (`co2_evite_kg`) en **chiffre principal** (mise en avant client) + équivalence pédagogique **km voiture** seule (`parametres_co2_divers` ; l'équivalence repas bœuf est retirée du PDF — décision Val 2026-10-02 ; foyers reste attachée à l'énergie primaire).
    - Émissions **induites** (`co2_induit_kg`) + **bilan net** (`co2_net_kg`) sur **lignes distinctes** — jamais l'évité soustrait pour annoncer une « compensation ».
    - **Énergie primaire évitée** (`energie_primaire_evitee_kwh`) + équivalence foyers (l'équivalence foyers n'est imprimée que dans la version sans radar — maquettes validées 2026-10-13).
    - Bilan net présenté en valeur absolue : « émissions nettes évitées : X » quand `co2_net_kg` < 0, « émissions nettes : X » sinon (valeur figée inchangée). L'incertitude ADEME ±50 % n'est pas imprimée (décision Val 2026-10-13). Cf. [[05 - Règles métier#R_co2_calcul]].
 - — bloc retiré du rapport (maquettes validées 2026-10-13) : la seule comparaison au parc est le radar ci-dessous.
  - Tonnages par flux : version avec radar = barre empilée (part de chaque flux, du plus lourd au plus léger) + poids par flux + total collecté ; version sans radar = tableau (flux, poids, part — flux valorisés du plus lourd au plus léger, déchet résiduel en dernière ligne), anneau, part valorisée et part résiduelle.
  - **Bloc benchmark kg/pax × parc — « radar » (ZD uniquement), présent sur choix de l'utilisateur (voir « Deux versions de la page 1 » ci-dessous)** : reproduit le Bloc 3 ZD **radar base 100** de la fiche collecte §06.04 (parc = polygone régulier, « Vous » = ligne sans remplissage), avec à droite la liste par flux : kg/pax de la collecte, repère parc, badge d'écart coloré (seuils §06.04). Le nombre de collectes du segment n'est pas imprimé. **Un flux non collecté ou dont le repère parc est masqué (k-anonymat) est retiré du radar** (4 ou 3 axes) ; sa ligne affiche « n/d » et la mention « n/d : données insuffisantes pour comparer ce flux. » — libellé neutre, il ne cite jamais la cause du masquage ; sous 3 axes exploitables, la liste est affichée seule, sans radar. **Source des chiffres (2026-10-13)** : le PDF n'a plus de fonction propre ; il appelle la fonction qui alimente le radar de l'écran (`f_benchmark_single_collecte` + `f_benchmark_kg_pax_zd`, agrégation `aggregateBenchmarkPerFlux` pondérée par `nb_collectes_segment`), **sous l'identité du demandeur**, avec les filtres réglés dans la fiche (filtre vide = « Tous »). Les gardes de l'écran s'appliquent donc telles quelles : k-anonymat (≥ 5 collectes **et ≥ 3 acteurs distincts**, porté par la fonction SQL, jamais rejoué par le gabarit), périmètre du gestionnaire de lieux (une collecte programmée par une autre organisation, tenue sur un lieu rattaché à son organisation, à événement daté, ouvre droit au radar : décision Val 2026-10-20, §06.05), filtre `traiteur_ids[]` toujours exclu. `f_rapport_benchmark_zd` n'est plus appelée. **Rien n'est stocké (décision Val 2026-10-16)** : le radar est calculé à chaque téléchargement, avec les filtres réglés à ce moment ; `rapports_rse.filtres_benchmark` n'est plus écrit pour un rapport ZD (cf. [[04 - Data Model]]). **Légende sous le graphe** : `Benchmark parc Savr calculé sur : période {{…}} · lieux : {{…}} · type d'événement : {{…}} · taille : {{…}}`. Si rien n'est comparable (collecte sans nombre de convives, ou collecte que la fonction refuse à l'appelant — par exemple celle dont son organisation n'est que le client organisateur), la demande de rapport avec radar est refusée avec le message « La comparaison au parc n'est pas disponible pour cette collecte. ». Le taux de recyclage affiché reste figé (`collectes.taux_recyclage`). Cf. [[06 - Fonctionnalités détaillées/04 - Espace client traiteur]] § « Lien avec rapport RSE ».
 - — le rapport de recyclage ne porte jamais de photo (décision Val 2026-10-13 ; le choix des photos par l'équipe Savr reste en vigueur pour les écrans).
  - Encart de présentation de Savr, puis méthodologie (un seul bloc, texte des maquettes validées 2026-10-13) : données mesurées, niveau de qualité ESRS E5, mention « Taux de recyclage selon la méthode UE 2019/1004 », taux de captation appliqués (`collectes.caps_appliques`, une filière absente du snapshot n'est pas imprimée), facteurs carbone ADEME, usage comme pièce justificative, confidentialité. L'incertitude ADEME ±50 % n'y figure pas (décision Val 2026-10-13). Pas de pied de page.
  - **Deux versions de la page 1 (règles Val 2026-10-13 et 2026-10-16)** : **avec radar** quand celui qui télécharge le rapport a coché « Inclure le radar de comparaison dans le rapport » dans la fiche collecte — le radar reprend les filtres de comparaison réglés dans la fiche ; **sans radar** sinon. La case part toujours décochée. Les données mesurées (taux, tonnages, carbone), l'en-tête, la méthodologie et la page 2 figurent dans les deux versions. Rien n'est stocké : chaque téléchargement fabrique son rapport, selon le choix de celui qui clique.
  - Watermark + QR code vérification (V1.1)
- **Page 2 (si collecte ZD)** — Bordereau de pesée intégré : reproduit intégralement le contenu du §1.1 Bordereau ZD (en-tête, tableau pesées par flux, équivalent bacs/rolls, totaux, signature/cachet, mention "Document officiel"). Absente quand le demandeur ne peut pas lire le bordereau sous sa RLS (§1.7, décision Val 2026-10-27).
> **Grain collecte — le rapport RSE §1.2 est un document ZD (2 pages : synthèse ZD + bordereau ; page 1 seule quand le demandeur ne peut pas lire le bordereau, §1.7).** `collectes.type` = `zero_dechet` XOR `anti_gaspi` (§04) → une collecte ne peut alimenter à la fois une page ZD et une page AG. Pour une collecte **AG**, le « rapport RSE » servi au traiteur (bouton §06.04) **EST l'attestation de don standalone §1.3** — pas de « Page 3 attestation » intégrée ni de « Page 1 Synthèse RSE » AG (option a, décision Val 2026-07-07 ; cf. [[05 - Règles métier]] §6 : `rapport_recyclage` strictement ZD).

**Cohérence cross-section** :
- Côté `traiteur` (§06.04) : la fiche collecte expose **uniquement** ce PDF unique (suppression UI bordereau/attestation/photos séparés).
- Côté `gestionnaire_lieux` (§06.05) *(décision Val 2026-10-07 ; page Événements remise le 2026-10-18, sans documents propres)* : depuis la fiche collecte, un document par collecte — le rapport de recyclage sur une collecte ZD, l'attestation de don sur une collecte AG. Le bordereau ZD reste téléchargeable depuis le registre réglementaire.
- Côté `Registre réglementaire` (§06.03) : les bordereaux ZD restent listés et téléchargeables séparément (justificatif réglementaire R541-45, accès indépendant du PDF agrégé).
- Côté `Admin Savr` (back-office §06.06) : accès séparé à tous les PDF unitaires + au PDF agrégé.

**Implémentation Puppeteer** : le PDF agrégé (ZD) est généré en concaténant les 2 templates HTML (synthèse + bordereau ; la synthèse seule quand le bordereau n'est pas lisible par le demandeur, §1.7) avant rendu Puppeteer unique. Pas de PDF merge a posteriori — un seul render = sobriété perf.

**Accessibilité** : Admin Savr + traiteur_manager + traiteur_commercial + client_organisateur (si rattaché à l'événement) + **agence** (si l'organisation est programmatrice de la collecte — extension 2026-05-07) + **gestionnaire_lieux** (s'il est programmateur de la collecte, ou si l'événement, daté, se tient sur un lieu rattaché à son organisation et que la collecte n'est pas un brouillon — décisions Val 2026-10-06 et 2026-10-24, cf. « Régénération manuelle » ci-dessous). RLS : les 4 chemins de la policy A8 ([[09 - Authentification et permissions]]), portés par `f_collecte_visible` — `organisation_id` (programmateur), `traiteur_operationnel_organisation_id` (traiteur sur place), `client_organisateur_organisation_id` (client final), lieu rattaché à l'organisation (`organisations_lieux`, événement daté, collecte hors brouillon).

**Branding (extension 2026-05-07, révisé 2026-10-13)** : le logo de l'agence programmatrice prime dans l'emplacement « client » (voir « Logos du client et du traiteur » ci-dessus) ; le logo du traiteur opérationnel a désormais son propre emplacement au lieu d'être un repli.

Justification : l'agence partage ce rapport avec son client final, son branding doit primer sur celui du traiteur opérationnel (qui n'est pas le donneur d'ordre). Pour les collectes programmées par un gestionnaire de lieux : pas d'override branding (le gestionnaire utilise le rapport en interne, pas de partage client final attendu).

**Téléchargement (décision Val 2026-10-16)** : le rapport se télécharge depuis la fiche collecte par **tout utilisateur autorisé à le lire** (mêmes 4 chemins que la policy A8 SELECT ; gestionnaire de lieux compris, y compris sur une collecte de ses lieux programmée par un traiteur ou une agence — décisions Val 2026-10-02 et 2026-10-06), dès la fin de l'embargo. Dans l'onglet « Bilan & documents », la case « Inclure le radar de comparaison dans le rapport » (décochée à l'ouverture) choisit la version ; le radar reprend les filtres du radar affiché à l'écran. Le PDF est fabriqué au clic et téléchargé ; il n'est pas stocké : chacun obtient le sien, personne n'écrase la version d'un autre. L'Admin a la même case dans l'onglet Documents de sa fiche collecte (filtres du radar de l'onglet, sinon le segment de la collecte : même type, même taille, tous lieux). Le client organisateur, sans fiche collecte, télécharge la version sans radar depuis sa page Documents. Dans les listes Collectes, le picto de téléchargement ouvre la fiche sur « Bilan & documents ». **Canal** : une **Next.js API Route** vérifie l'accès en lisant la collecte puis le rapport **sous l'identité du demandeur** (RLS, policy rr_select), calcule le radar sous cette même identité (k-anonymat compris, Admin inclus), puis lit les données mesurées en service-role et rend le PDF. La policy RLS `rr_write_admin` (§09 A8) reste inchangée — **aucune écriture client directe** ; seule `consulte_par_user_at` est posée (service-role) au premier téléchargement par un client. Test P1 bloquant CI : téléchargement cross-org → 403. Le rapport de recyclage ne se régénère plus (il est fabriqué à chaque téléchargement) ; **il ne porte aucune mention de régénération** (décision Val 2026-10-02).

**Partage (V1)** : pas de lien de partage public natif en V1. Le `traiteur_manager` télécharge le PDF (régénération + download déjà disponibles) et le transmet lui-même à son client organisateur par email. **Lien de partage public horodaté (90 jours) reporté V1.1** (revue sobriété §12 2026-06-03, A1) — aligné sur le QR code de vérification, lui aussi V1.1 : on ne maintient pas en V1 un mécanisme d'accès public (route publique + RLS token-based + expiration) pour un usage occasionnel couvert par le download manuel.

---

#### À INTÉGRER LORS DE LA FINALISATION — Notice méthodologique CSRD / ESRS E5 / AGEC

> Bloc à finaliser au moment où on figera le rendu graphique du PDF Rapport de recyclage. Texte source Val 2026-05-12, à arbitrer (placement, longueur, QR code) avant intégration template Puppeteer.
>
> **Revue sobriété §12 2026-06-03 (C2)** : version canonique V1 = **version courte** (ci-dessous) — une seule formulation maintenue pour éviter le drift de deux textes parallèles. La version longue est conservée comme **matériau de référence** pour la finalisation graphique (page dédiée « Notice méthodologique »), pas comme un second texte à tenir à jour. Si la version longue est retenue au rendu, elle sera dérivée de la version courte à ce moment-là.

**Intention** : positionner le rapport comme pièce justificative opposable (CSRD limited puis reasonable assurance, conformité AGEC, sécurisation anti-greenwashing Green Claims). Renforce le signal de sérieux et la valeur perçue auprès du client final du traiteur / agence / gestionnaire.

**Version longue (encart pleine largeur, dernière page ou page dédiée — "Notice méthodologique")** :

> **Méthodologie de mesure et conformité au reporting de durabilité**
>
> Les volumes de déchets indiqués dans le présent rapport sont des données mesurées (méthode primaire). Chaque flux est pesé individuellement lors de la collecte par notre prestataire logistique référencé, puis tracé jusqu'à un exutoire final identifié (Veolia, Paprec ou filière REP partenaire). Les pesées sont enregistrées par bordereau et archivées 5 ans conformément à la réglementation déchets en vigueur (Code de l'environnement, art. R541-43).
>
> **Hiérarchie de la donnée — référentiel ESRS E5**
>
> La norme européenne ESRS E5 (utilisation des ressources et économie circulaire) distingue trois niveaux de qualité de la donnée déchets : `mesurée` > `calculée` > `estimée`. Les volumes communiqués par Savr relèvent du niveau le plus élevé (`mesurée`), ce qui les rend directement intégrables dans un rapport de durabilité soumis aux exigences CSRD, à un niveau d'assurance limité (limited assurance, exercice 2025) comme raisonnable (reasonable assurance, à terme).
>
> **Chaîne de traçabilité**
>
> Tri à la source sur événement → Collecte séparée par flux → Pesée individuelle (bordereau horodaté) → Acheminement vers exutoire référencé → Émission du présent rapport et archivage des bordereaux sources.
>
> **Usage du rapport**
>
> Ce rapport constitue une pièce justificative opposable pour : (i) le reporting ESRS E5 du donneur d'ordre final dans le cadre de la CSRD, (ii) le suivi des obligations AGEC (tri à la source des biodéchets, tri 5 flux, REP emballages), (iii) la documentation de la chaîne de valeur d'un client soumis à la directive CSRD, (iv) la communication environnementale du traiteur et de son client final, sécurisée contre le risque de greenwashing (directive Green Claims, Code de la consommation art. L121-2).

**Version courte (encart latéral page 1 ou cartouche, ~5 lignes)** :

> **Méthodologie**
>
> Données mesurées. Pesée individuelle par flux, bordereaux horodatés, exutoires référencés (Veolia, Paprec). Niveau de qualité conforme à la norme ESRS E5 (`mesurée` — niveau primaire le plus élevé). Rapport utilisable comme pièce justificative pour reporting CSRD (limited et reasonable assurance), conformité AGEC, et sécurisation des communications environnementales contre le risque de greenwashing.

**Recommandations d'intégration (à arbitrer)** :
- Version courte → encart première page (signal de sérieux immédiat).
- Version longue → dernière page, sous forme de "Notice méthodologique".
- Pied de page de chaque page : "Rapport établi sur la base de données mesurées — conforme ESRS E5 / AGEC".
- **Killer feature à challenger techniquement** : QR code dernière page renvoyant vers une page web Savr listant les bordereaux Strike/Veolia consultables par le client (preuve d'audit). Lève la barrière auditeur CSRD. Reportable V1.1 si trop lourd à industrialiser V1 — à intégrer dans la liste des features V1.1 / V2 si arbitrage défavorable V1.

**Dépendances à valider avant intégration** :
- Confirmation exutoires nominatifs (Veolia, Paprec) — ne mentionner que ceux réellement contractualisés au moment du go-live, sinon formulation générique "filières référencées".
- Référence durée d'archivage (R541-43) à valider avec Cyril / juridique avant publication.
- Mentions normes (ESRS E5, AGEC, Green Claims, art. L121-2) à faire relire pour éviter erreurs de cadrage.
- Si QR code preuve d'audit retenu : nécessite endpoint public Savr exposant les bordereaux Strike par `collecte_id` (à spécifier §08 APIs publiques + RLS lecture token-based).

---

### 1.3 Attestation de don AG

**Déclenchement** : batch automatique J+1 à 6h.

**Règle embargo** : même règle H+24 que le rapport de recyclage (énoncé canonique en Vue d'ensemble).

**Contenu** :
- En-tête événement — **date affichée = `evenements.date_evenement`** (date client). Date de collecte en mention secondaire si ≠ date événement.
- Nom et adresse de l'association bénéficiaire
- Quantité de repas donnés + estimation poids
- **CO₂e évité (ajout 2026-06-04 bis)** : « X kg CO₂e évités » + équivalence km voiture, lu depuis `collectes.co2_evite_kg` figé (= `volume_repas_realise × facteur FAO 2,5 kgCO₂e/repas`, snapshot `co2_facteurs_snapshot` AG → reproductibilité du document officiel). Mention méthodo : « Estimation FAO — 2,5 kgCO₂e par repas sauvé du gaspillage ». Cf. [[05 - Règles métier#R_co2_ag]].
- Mention fiscale 2041-GE si association habilitée, mention neutre sinon
- Signature Savr
- Watermark

**Accessibilité** : Admin Savr + traiteur_manager + traiteur_commercial. RLS par `organisation_id`.

**Régénération** : Admin Savr uniquement. **V2 (audit cohérence 2026-07-06)** : également **automatique** à réception d'un webhook S5 `type=correction` TMS (pesée `don_alimentaire` corrigée/tardive — cf. [[08 - APIs et intégrations]] §1). Si l'association perd son habilitation 2041-GE après génération, les attestations passées restent valides (snapshot).

**Régénération automatique sur correction `volume_repas_realise` (décision 2026-05-29)** : lorsque l'Admin corrige manuellement `attributions_antgaspi.volume_repas_realise` (cf. [[06 - Fonctionnalités détaillées/09 - Flux algo attribution AG (Admin)]]), l'attestation de don correspondante est **régénérée automatiquement** pour refléter le chiffre corrigé (document à valeur quasi-juridique). La version précédente est marquée supersédée : indicateur visuel sur le document + date de dernière mise à jour dans l'interface (même mécanisme que la régénération post-correction de pesée du rapport de recyclage §1.2).

---

### 1.3-bis Rapport "Événement sans excédent alimentaire" (refonte 2026-05-04 — AG `realisee_sans_collecte` uniquement ; affiché « Rapport de don » sur tous les écrans, comme l'attestation de don — décision Val 2026-10-09) **Nom « Rapport de don » partout (décision Val 2026-10-13)** : titre imprimé des PDF, nom des fichiers téléchargés, email de disponibilité et CGU adoptent aussi ce nom — livré le 2026-10-13 pour les PDF, les fichiers et l'email, et le 2026-10-20 pour les CGU publiées.

**Nom « Rapport de don » — ce qui est livré (2026-10-13).** **Titre imprimé** : « Rapport de don » sur les deux PDF, avec en sous-titre « Attestation de don » (pièce fiscale : numéro `ATT-DON-…` et mentions fiscales inchangés) ou « Événement sans excédent alimentaire ». **Nom du fichier servi** : `rapport-de-don-<numéro d'attestation>.pdf` avec excédents, `rapport-de-don-<AAAA-MM-JJ>-<événement>.pdf` sans excédent ; le fichier stocké garde sa clé, le nom est imposé au téléchargement (le document s'ouvre toujours dans l'onglet). **Documents déjà produits** : pas de régénération, « Régénérer » au cas par cas (Admin). **Email** : cf. [[06 - Fonctionnalités détaillées/02 - Templates emails V1]], `attestation_don_disponible`. Une collecte AG sans excédent ne reçoit pas encore d'email de disponibilité (lot à part).

**Contexte** : nouveau PDF dédié aux collectes AG terminées en `realisee_sans_collecte` (chauffeur déclare "aucun repas à collecter" via app mobile TMS). Aucune attestation 2041-GE n'est générée (pas de don à certifier), mais l'utilisateur a besoin d'un justificatif documentant la prestation. Refonte 2026-05-04 §06.04 : remplace l'ancien affichage "Voir les photos" + tooltip motif sur la fiche collecte traiteur.

**Déclenchement (V1)** : batch dédié nightly (`runBatchSansExcedent`, monté dans le cron J+1 6h à côté des batchs bordereau/rapport/attestation) sur les collectes AG `realisee_sans_collecte` sans rapport (idempotent). **Sans embargo H+24** : `rapports_rse.disponible_a = genere_at` (pas de pesée à corriger). Décision Val 2026-07-07 (archi V1 batch vs « immédiat »). _Cible V2 : déclenchement événementiel immédiat à réception du webhook `collecte-terminee` (`statut_final = realisee_sans_collecte`) — inchangé._

**Contenu (texte seul, pas de photos — décision Val 2026-05-04)** :

- En-tête événement : nom, **date de l'événement** (`evenements.date_evenement`, référence client), lieu, traiteur, nombre de convives de LA collecte AG (`collectes.pax` ; 0 → mention omise — lot C2, décision Val Q5 du 2026-10-24), client organisateur si renseigné
- Bloc "Constat" :
  - **Date et heure de présentation chauffeur sur site** (`tournees.heure_debut_reelle`) — c'est ici qu'apparaît la date d'intervention réelle (peut différer de la date événement)
  - Identification chauffeur (nom)
  - Plaque véhicule si `controle_acces_requis = true` (sinon masqué)
  - Motif déclaré par le chauffeur (texte libre saisi via M05)
- Bloc "Conséquences" :
  - Mention explicite : "Aucun repas n'a été collecté lors de cet événement. Aucun don n'ayant eu lieu, ce rapport ne vaut pas reçu fiscal. La prestation logistique reste facturée au tarif normal au titre du déplacement."
  - Référence facture (si déjà émise)
- Mentions légales Savr
- Watermark + QR code vérification (V1.1)

**Pas de photos dans le PDF** : la photo lieu prise par le chauffeur (preuve présence) reste stockée hors du PDF (V1 : colonne `plateforme.collectes.aucun_repas_photo_url`, alimentée par l'adapter logistique ; cible V2 : `tms.collectes_tms.photos[]`) et accessible uniquement à l'Admin Savr / Ops via le back-office. Décision Val 2026-05-04 : justificatif texte suffisant côté traiteur.

**Accessibilité** : Admin Savr + traiteur_manager + traiteur_commercial. RLS par `organisation_id`. Téléchargeable depuis :
- Picto rapport sur la ligne de la collecte (vue liste Collectes §06.04)
- Picto rapport sur la fiche collecte (action "Télécharger le rapport")
- Section Rapports RSE de l'espace traiteur

**Implémentation Puppeteer** : nouveau template HTML dédié (slug `rapport_evenement_sans_excedent`). Pas de variante par flux (un seul flux AG concerné).

**Persistance (tranché 2026-06-07, F1 lot ⑫)** : le PDF est porté par une **ligne `rapports_rse` standard** (le rapport « sans excédent » EST le rapport de cette collecte AG — pas de colonne discriminante, cohérent retrait `type_rapport` sobriété §04 A1). Particularité : `disponible_a = genere_at` (génération immédiate, pas d'embargo H+24 — pas de pesée à corriger). Référence fichier : `shared.fichiers` `entity_type = 'plateforme.rapports_rse'` (existant, liste des 9 inchangée).

**Régénération** : Admin Savr uniquement, en cas de correction du motif chauffeur ou de la plaque post-saisie.

---

### 1.4 Indicateurs de régénération

Quand un rapport ou bordereau est régénéré après sa première émission automatique (suite à correction de pesée ou autre modification) :

- **Dans l'interface** : picto ⟳ accompagné de la mention "Mis à jour le [date à heure précise]" dans l'espace client : à côté du bouton « Télécharger le rapport » de la fiche collecte (la variante B n'a plus de card de document, 2026-10-28) et sur la ligne du document dans la fiche événement du gestionnaire
- **Sur le PDF** : bordereau de pesée et attestation de don — mention discrète en pied de page "Version mise à jour — générée le [date]". **Rapport de recyclage : aucune mention** (décision Val 2026-10-02, l'indicateur reste dans l'interface et l'audit log).
- **Dans l'audit log** : traçabilité complète (qui a demandé la régénération, depuis quel profil, horodatage)

---

### 1.5 Alerte pesées anormales (Admin Savr)

Pour limiter les erreurs de saisie dans le TMS avant la génération des documents, un système d'alerte automatique notifie l'Admin Savr dès qu'une pesée reçue du TMS sort des seuils définis.

**Déclenchement** : à réception du webhook `collecte-terminee` du TMS avec `statut_final = realisee` (avant le batch J+1). **Collectes ZD uniquement** (5 flux V1 : biodechet, emballage, carton, verre, dechet_residuel). Les collectes AG ne sont pas concernées par ce contrôle min/max — le cas "Aucun repas à collecter" (AG) est géré par un statut dédié et une alerte Ops côté TMS.

**Logique V1** : calcul du ratio `(Σ poids_net_kg par flux × 1000) / nb_pax` = g/pax pour chaque flux. Le calcul porte sur le **total agrégé du flux** (somme de toutes les pesées individuelles du même flux — un chauffeur peut faire N pesées successives pour un même flux). Comparaison vs plage [min, max] configurables dans `parametres_algo`. Alerte si la valeur reçue est **inférieure au min** (pesée suspicieusement basse ou absente) **ou supérieure au max** (pesée aberrante). **Alerte in-app back-office seule (tranché 2026-06-07, F2 lot ⑫ — retiré, pas de 20e template §06.02)** : bandeau/notification back-office Admin avec nom de la collecte, flux en anomalie, valeur reçue, plage de référence, lien direct vers la collecte.

**Niveau d'application (révisé 2026-05-25, Sujet 1 option A — annule D3/4a)** : le contrôle g/pax s'exécute **par collecte ZD**, déclenché à réception du webhook `collecte-terminee` (statut `realisee`). Formule par flux : `Σ poids_net_kg du flux X × 1000 / nb_pax`, où `Σ poids_net_kg` est **déjà agrégé sur les N camions par le TMS** sous la collecte ZD avant remontée S5. Comparaison vs plage [min, max] (`parametres_algo`). Une seule alerte par flux en anomalie, avec le lien vers la collecte.

Le cas multi-camions ne produit **plus de faux positifs** : le TMS agrège les pesées des N camions sous la collecte ZD unique, donc le volume complet est rapporté au `nb_pax` complet (et non une fraction). La fenêtre de 24h pour correction Admin avant le batch J+1 6h s'applique comme avant.

**Seuils V1 (seed initial)** :

| Flux | Min (g/pax) | Max (g/pax) |
|---|---|---|
| Biodéchets | 15 | 150 |
| Carton | 2 | 20 |
| Déchet résiduel | 40 | 400 |
| Verre | 20 | 200 |
| Emballage | 20 | 200 |

*Min = 10% du max dans tous les cas. Logique : en dessous du min = données probablement manquantes ou saisie erreur TMS ; au-dessus du max = valeur aberrante.*

**Seuils stockés** dans `parametres_algo`, modifiables par Admin Savr sans redéploiement. Toute modification loggée dans `audit_log`.

**Ce que l'alerte ne fait pas** : elle ne bloque pas la génération des documents. Elle donne 24h à l'Admin Savr pour corriger avant le batch automatique.

---

### 1.6 Rapport de synthèse agrégé (refonte 2026-05-05 — à la demande uniquement, **étendu agences 2026-05-07**)

Rapport multi-collectes à destination des **traiteurs, agences et gestionnaires de lieux** (extension 2026-05-07 — initialement traiteurs + gestionnaires uniquement). **Génération à la demande uniquement** (refonte 2026-05-05 : suppression mode automatique récurrent + suppression archivage). Distinct des rapports de recyclage ZD (§1.2) qui sont unitaires par collecte/événement.

**Périmètre par rôle** :
- `traiteur_manager` / `traiteur_commercial` : agrégation des collectes où `traiteur_operationnel_organisation_id = current_org` (peu importe le programmateur)
- `gestionnaire_lieux` : agrégation des collectes sur ses lieux (`evenements.lieu_id IN organisations_lieux`) ET de celles qu'il a programmées (`evenements.organisation_id = current_org`)
- `agence` *(2026-05-07)* : agrégation des collectes qu'elle a programmées (`evenements.organisation_id = current_org`), branding agence prioritaire en couverture

**Stockage** : aucun. Le PDF est généré, téléchargé directement par l'utilisateur, et **non persisté côté DB** (table `rapports_synthese` supprimée — voir [[04 - Data Model]]).

#### Mode automatique récurrent (supprimé refonte 2026-05-05)

> Suppression complète des batchs mensuel / trimestriel / annuel. Si un utilisateur veut une synthèse mensuelle, il génère à la demande chaque mois via le bouton dashboard. Décision : volume d'usage non démontré V1, complexité batch + stockage non justifiée. Réactivation possible V1.1 sur retour terrain.

#### Mode à la demande (seul mode V1)

Déclenché par un user depuis son **dashboard** (bouton "Exporter une synthèse PDF" — refonte 2026-05-05, ex-formulaire dédié §5 Rapports RSE supprimé). Modal s'ouvre avec les filtres dashboard pré-remplis, ajustables avant génération.

**Formulaire de génération (modal)** :
1. Période : soit présélection (7j / 30j / Trimestre en cours / 12 derniers mois / Année civile / Personnalisée du X au Y), soit intervalle personnalisé (date_debut ≤ date_fin, pas de borne dans le futur)
2. Filtres optionnels cumulables (pré-remplis depuis le dashboard) :
   - Lieux (multi-select) — scopé par périmètre utilisateur
   - Traiteurs (multi-select) — **visible côté gestionnaire de lieux uniquement**. Côté traiteur, filtre absent (par construction = lui-même). **Côté agence : filtre retiré en V1 (revue sobriété §06.11 2026-06-03 — parité absolue §06.04)** ; l'agence exporte sa synthèse comme un traiteur (sans filtre traiteurs). Réévalué post-V1.
   - Types de collecte (multi-select) : `zero_dechet`, `antigaspi`
   - Type d'événement + Taille d'événement (multi-select) — hérités de la barre dashboard (gestionnaire : présents ; traiteur/agence : arriveront avec BL-P2-12), propagés à l'agrégat
   - Client organisateur (multi-select) — visible côté traiteur ET côté agence (refonte 2026-05-04 + extension 2026-05-07). **Construit dans la modale** (multi-select natif étape 2, tranché 2026-07-07 R20b-2), non hérité de la barre dashboard : la barre 5-dimensions traiteur/agence (BL-P2-12) étant déférée, ce filtre est alimenté par l'endpoint dédié `GET /api/v1/dashboards/synthese-pdf/filtres` scopé par rôle (clients résolus depuis `evenements.nom_client_organisateur`). Non applicable côté gestionnaire.
   - Commerciaux (multi-select) — visible côté manager traiteur uniquement (pas applicable agence/gestionnaire en V1). **Construit dans la modale** (même endpoint dédié, commerciaux résolus depuis `evenements.created_by ⋈ users`).
3. Bouton "Générer le rapport" → téléchargement direct du PDF une fois prêt

**Traitement** : génération PDF **synchrone** (Next.js API Route + Railway/Puppeteer, réponse en 5-30 s selon volume, timeout 2 min max). Aucune trace en base : pas de `jobs_pdf`, pas de worker, pas de `shared.fichiers`. Pendant la génération, modal affiche un état "En cours" + spinner. Téléchargement direct dès `pdf_url` disponible (URL pré-signée Cloudflare R2 temporaire, expire 1h après génération — l'utilisateur doit télécharger immédiatement, pas d'archivage).

**Idempotence** : pas de contrainte d'unicité — l'utilisateur peut régénérer autant de fois qu'il veut (la génération est gratuite, c'est un simple assemblage de données). Aucun risque de doublon en DB puisque pas de stockage.

**Agrégat vide** : si aucune collecte ne satisfait période + filtres + prédicat embargo, le PDF est tout de même généré avec les sections à zéro et la mention « Aucune collecte sur la période » ; le bouton n'est jamais bloqué (aligné « aucun embargo sur la génération »).

#### Contenu du PDF (template unique)

> **Sections rendues selon le(s) type(s) de collecte sélectionné(s) (tranché 2026-07-07, R20b-2)** : le PDF n'inclut que les sections applicables au filtre « Types de collecte » de l'étape 2. **ZD seul** → sections ZD (chiffres clés ZD, Section 2 flux + camembert, Section 5 évolution + courbe taux, détail ZD), **pas de Section 3 AG**. **AG seul** → sections AG (chiffres clés AG, Section 3 Anti-Gaspi + Top 3 assos, détail AG), **pas de Sections 2/5 ZD**. Filtre « Types de collecte » **décoché** → le PDF couvre **ZD + AG** (toutes sections applicables). Les sections communes (page de garde, Section 4 géographique si ≥ 2 lieux, Section 4bis par traiteur si gestionnaire, annexes, watermark) sont **toujours** présentes selon leurs conditions propres.

**Page de garde** :
- Logo Savr + logo de l'organisation cible (si `organisations.logo_url` existe)
- Titre : "Rapport de synthèse [périmètre] — [période]"
- Sous-titre : filtres appliqués en clair si ≠ aucun (ex: "Lieux : Palais des Congrès, Carrousel du Louvre · Types : Zéro-Déchet")
- Date de génération
- Nombre de collectes agrégées

**Section 1 — Chiffres clés** :
- Nombre de collectes sur la période
- Tonnage total collecté (ventilé ZD / AG)
- **Taux de recyclage moyen pondéré (ZD)** — moyenne pondérée par tonnage : `Σ (taux_recyclage × tonnage_collecte) / Σ tonnage_collecte`. Lecture directe depuis `collectes.taux_recyclage` (déjà figé à la clôture, formule à captation cf. [[05 - Règles métier#R_taux_recyclage]]). Cas `taux_recyclage IS NULL` (total pesées = 0) → exclu de la pondération.
- Nombre de repas donnés (AG)
- **Impact carbone agrégé (ZD, refonte 2026-06-04, Sujet 3)** : somme des `collectes.co2_evite_kg` (chiffre principal) + `co2_induit_kg` + `co2_net_kg` (lignes distinctes, règle ABC) + `energie_primaire_evitee_kwh` sur le périmètre, avec équivalences pédagogiques. Cf. [[05 - Règles métier#R_co2_calcul]].

**Section 2 — Ventilation par flux (ZD uniquement)** :
- Tableau poids par flux (5 flux ZD V1 : biodéchets, emballages, carton, verre, déchet résiduel)
- Camembert associé
- *(Pas de "taux de recyclage par flux" — supprimé 2026-05-06 : la métrique unique est le taux de recyclage global, calculé sur l'ensemble des 5 flux avec captation par filière.)*

**Section 3 — Ventilation Anti-Gaspi (AG uniquement)** :
- Tableau : association bénéficiaire · nombre de collectes · repas donnés · poids
- Top 3 associations bénéficiaires

**Section 4 — Ventilation géographique** :
- Tableau : lieu · nombre de collectes · tonnage
- Affichée uniquement si le périmètre comporte ≥ 2 lieux

**Section 4bis — Ventilation par traiteur (gestionnaire de lieux uniquement)** :
- Tableau : traiteur · nombre de collectes · tonnage
- Affichée uniquement côté gestionnaire de lieux (cf. §06.05 §4) — non rendue pour traiteur/agence (périmètre = organisation elle-même)

**Section 5 — Évolution mensuelle** :
- Graphique barres : tonnage mois par mois sur la période
- Courbe associée du taux de recyclage moyen pondéré (ZD) — pondération par tonnage de collecte, formule à captation par filière (cf. [[05 - Règles métier#R_taux_recyclage]])

**Section 6 — Détail des collectes** :
- Tableau paginé : **date de l'événement** (`date_evenement`) · événement · lieu · type · tonnage · taux recyclage *(ZD uniquement, vide pour AG — métrique non applicable)* · repas donnés. *(Grain : 1 ligne par événement ; le tonnage et le taux ZD sont ceux de la collecte ZD de l'événement — un éventuel multi-camions est déjà agrégé sous cette collecte côté TMS, révisé 2026-05-25 Sujet 1.)*
- Tri chronologique antéchronologique (sur `date_evenement`)

**Annexes** :
- Méthodologie de calcul des équivalents CO₂ — formules induit/évité/net + énergie (cf. [[05 - Règles métier#R_co2_calcul]]), règle ABC (évitées en ligne séparée), incertitude ADEME ±50 %, biodéchet = méthanisation, mix emballages appliqué.
- Référentiel des facteurs utilisé (**version figée** depuis `collectes.co2_facteurs_snapshot`) : facteurs par flux + mix emballages + équivalences + forfait collecte + horodatage des paramètres. Garantit le quadruplet auditeur RSE (facteur + source + version + date).
- Mentions légales Savr

**Watermark** "Rapport généré par Savr" + horodatage de génération en pied de page de chaque page.

#### Différence avec les rapports de recyclage unitaires

| Aspect | Rapport recyclage (§1.2) | Rapport synthèse agrégé (§1.6) |
|---|---|---|
| Portée | 1 collecte ou 1 événement | Multi-collectes sur période |
| Déclenchement auto | J+1 6h | **Aucun (refonte 2026-05-05 — supprimé)** |
| Génération à la demande | Régénération manager | Bouton "Exporter une synthèse PDF" dashboard |
| Embargo | H+24 après collecte | Aucun sur la génération — **prédicat d'inclusion des collectes (tranché 2026-06-07, F4 lot ⑫)** : `statut = 'cloturee' AND realisee_at + interval '24h' <= now()` (aligné embargo canonique) |
| Filtres utilisateur | Non | Oui (lieux, traiteurs, types, clients organisateurs, commerciaux) |
| Stockage | DB (`rapports_rse`) | **Aucun (refonte 2026-05-05 — table `rapports_synthese` supprimée)** |
| Envoi email | Oui | Non (téléchargement direct par l'utilisateur) |
| Destinataire possible | Client Organisateur (download manager + envoi email ; lien public V1.1) | Interne organisation (l'utilisateur partage le PDF lui-même) |

#### RLS (refonte 2026-05-05)

- Génération uniquement, pas de stockage. RLS appliquée à la **lecture des collectes sources** (la Route API lit les collectes avec le JWT du demandeur).
- Manager traiteur : génère sur toutes les collectes de l'organisation
- Commercial traiteur : génère sur **toutes les collectes de l'organisation** (RLS lecture `organisation_id`, alignée manager — révision 2026-05-29)
- Gestionnaire de lieux : génère sur les collectes liées à ses lieux (via `organisations_lieux`)
- Pas de filtre `traiteur_ids[]` côté traiteur (motif concurrentiel, cf. §06.04)

### 1.7 Rapports cumulés d'un événement (décision Val 2026-10-26)

Deux PDF cumulés sur les collectes réalisées d'un événement (au sens du bilan consolidé : ZD `cloturee`, AG `cloturee` ou `realisee_sans_collecte`), téléchargés depuis l'onglet « Bilan & documents » de la fiche événement. **Fabriqués au clic, jamais stockés** (ni `jobs_pdf`, ni `shared.fichiers`), comme le rapport de recyclage d'une collecte. **Cumul partiel** : disponibles dès qu'une collecte du type a ses résultats ; chaque PDF imprime sa couverture (« Cumul des N collectes réalisées, sur M collectes de l'événement »). Accès : l'événement et ses collectes lus sous l'identité du demandeur ; seules les collectes qu'il voit sont cumulées. **Bordereau** *(décisions Val 2026-10-27)* : un PDF n'imprime le bordereau que si le demandeur peut le lire sous sa RLS (`bord_*_select`), les données lues en service-role ne devant pas exposer ce que la RLS refuse. Rapport cumulé : numéro du bordereau, sinon « — ». Rapport d'une collecte : sans bordereau lisible, pas de page 2 (bordereau intégré) ; le rapport s'arrête à la page 1. Cas concernés : traiteur opérationnel désigné par un autre programmateur, gestionnaire qui programme hors de ses lieux. Livré pour le gestionnaire de lieux ; la fabrication est commune, chaque profil l'aura avec sa fiche événement.

- **Rapport de recyclage de l'événement (ZD)** — gabarit `rapport-recyclage-evenement` : page 1 = page de synthèse du rapport de recyclage (§1.2, maquettes @3), avec ou sans radar au choix du demandeur, sur les chiffres cumulés (poids par flux, taux de recyclage moyen pondéré par le poids, CO₂ induit / évité / net et énergie primaire sommés, équivalences avec les facteurs figés de la collecte la plus récente), bandeau sous-titré « Bilan cumulé de l'événement » ; radar = kilos par convive des collectes ZD réalisées (somme de leurs pesées / somme de leurs convives) face au repère parc des filtres réglés à l'écran. Page 2 = détail des collectes (date, convives, poids, taux, CO₂ évité, numéro du bordereau). Pas de bordereau intégré : il reste dans le rapport de chaque collecte. Fichier `rapport-recyclage-evenement-AAAA-MM-JJ.pdf`.
- **Rapport de don de l'événement (AG)** — gabarit `rapport-don-evenement` : titre « Rapport de don », sous-titre « Récapitulatif de l'événement ». **Sans valeur fiscale**, il le dit : « Ce récapitulatif ne vaut pas reçu fiscal. Seules les attestations de don numérotées, émises pour chaque collecte, font foi ». Repas donnés, repas par convive, CO₂ évité, associations bénéficiaires avec leurs repas, puis une ligne par collecte : date, association, repas, pièce justificative (numéro de l'attestation quand elle est téléchargeable, « Attestation à venir » sinon, « Événement sans excédent » à 0 repas). Fichier `rapport-de-don-evenement-AAAA-MM-JJ.pdf`.

---

## 2. Exports tabulaires (CSV)

### Principe

Disponibles pour tous les profils, filtrés automatiquement par RLS — chaque utilisateur n'exporte que les données auxquelles il a accès sur l'interface. Coût : 0€ (Next.js API Route sur l'infra existante).

### Exports disponibles par profil

| Export | Admin Savr | Traiteur Manager | Traiteur Commercial | Agence | Gestionnaire Lieux | Client Final |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Collectes (toutes / son périmètre) | ✓ | ✓ | ✓ | ✓ | ✓ *(décision Val 2026-10-07 — depuis sa liste Collectes : ses programmations et les collectes tenues sur ses lieux)* | ✓ |
| Événements | ✓ | ✓ | ✓ | ✓ | ✓ *(grain événement)* | ✓ |
| Pesées par flux | ✓ | ✓ | — | ✓ *(extension 2026-05-07 — sur ses propres collectes programmées)* | — *(via PDF synthèse §1.6)* | ✓ |
| Facturation (brouillons + envoyés) | ✓ | ✓ | ✓ (ses événements) | ✓ *(extension 2026-05-07)* | ✓ *(extension 2026-05-07)* | — |
| Packs AG (mouvements) | ✓ | ✓ | — | ✓ *(extension 2026-05-07)* | ✓ *(extension 2026-05-07)* | — |
| Associations bénéficiaires AG | ✓ | ✓ | — | — | — | — |
| Impact RSE consolidé | ✓ | ✓ | — | ✓ *(extension 2026-05-07)* | ✓ | ✓ |
| Courses logistiques | ✓ | — | — | — | — | — |

> **Note M4.1 (2026-06-19, D2)** : les exports CSV génériques (collectes, événements, pesées, factures, packs AG, associations, impact RSE) **ne sont pas journalisés** dans `exports_registre` — cette table est réservée aux exports du registre réglementaire ZD (§06.03 / M4.2). Aucune migration SQL en M4.1 (table et enum inchangés).

> **Note M4.1 (2026-06-19, D1)** : « Courses logistiques » est **hors scope V1** (repose sur `tms.*` inexistant V1 — cohérent avec le descope Bloc 3 Coûts CLAUDE.md §3). Les 7 entités réalisables V1 = collectes, événements, pesées, factures, packs AG, associations bénéficiaires AG, impact RSE consolidé.

**Colonnes figées par entité — décision Val 2026-06-19 (M4.1/D3)** :

- **Collectes** : Date événement, Date collecte, Heure, Événement, Lieu, Code postal, Ville, Traiteur, Client organisateur, Type, Statut, Tonnage ZD (kg), Taux recyclage (%), CO2 évité (kg), Repas AG. *(Décision Val 2026-10-09 : une collecte AG sans excédent sort « Réalisée » dans Statut et **0** dans Repas AG, jamais une cellule vide.)*
- **Pesées (par flux, ZD only)** : Date événement, Date collecte, Événement, Lieu, CP, Ville, Traiteur, Flux, Poids (kg), Nb bacs, Équivalent rolls.
- **Factures (whitelist client-safe)** : Numéro, Type, Statut, Montant HT, Montant TTC, Date émission, Date échéance, Date paiement. **Jamais** `marge_logistique` ni colonnes synchro internes. Brouillons exclus côté rôles clients, inclus côté staff.
- **Packs AG** : Référence, Crédits initiaux, Crédits consommés, Crédits restants, Date début, Date fin, Statut, Prix HT, Devise.
- **Associations bénéficiaires AG** : staff = référentiel (Association, Adresse, Ville, Région, Contact, Email, Habilitée fiscale, Active) ; traiteur_manager = bénéficiaires de ses dons uniquement (Association, Ville, Région, Nb collectes, Repas donnés).
- **Impact RSE consolidé (grain par collecte — décision Val 2026-06-19)** : Date événement, Événement, Lieu, Ville, Traiteur, Type, Tonnage ZD (kg), Taux recyclage (%), CO2 évité (kg), CO2 induit (kg), CO2 net (kg), Énergie primaire évitée (kWh), Repas AG *(0 pour une collecte AG sans excédent, décision Val 2026-10-09)*.

**Précision gestionnaire de lieux V1 (décision Val 2026-10-07)** : la page Événements côté gestionnaire a été retirée (remise le 2026-10-18, sans bouton d'export) → l'export tabulaire CSV du gestionnaire vit sur la liste **Collectes**, avec un **grain collecte** (1 ligne CSV = 1 collecte, colonnes « Collectes » ci-dessus). Périmètre = celui de la liste : ses propres programmations et les collectes tenues sur ses lieux.

**Colonnes export Événements** *(export commun, sans écran dédié depuis le retrait de la liste Événements du gestionnaire le 2026-10-07)* : `date_evenement`, `nom_evenement`, `lieu`, `traiteur`, `type_evenement` (les types de ses collectes non annulées, sans doublon, ordre de la collecte n°1 ; toutes annulées : les types de ses collectes annulées — décision Val Q2 du 2026-10-24), `taille_bracket` et `pax` (ceux de l'événement : `evenements.pax`, calculé depuis ses collectes — décision Val Q4 du 2026-10-25), `nb_collectes_zd`, `nb_collectes_ag`, `tonnage_zd_kg`, `taux_recyclage_pct` *(renommé 2026-05-06 — ex `taux_tri_pct`. Moyenne pondérée par tonnage des `collectes.taux_recyclage` ZD de l'événement, formule à captation cf. [[05 - Règles métier#R_taux_recyclage]])*, `repas_ag`, `statut_consolide`, `date_premiere_collecte`, `date_derniere_collecte`.

### Format

- **CSV UTF-8** avec séparateur `;` (compatible Excel FR sans manipulation)
- Colonnes avec headers en français
- Dates au format `DD/MM/YYYY HH:MM`
- **Convention dates (refonte 2026-05-21)** : les exports exposent **deux colonnes distinctes** quand pertinent — `date_evenement` (date client, colonne de tri/affichage primaire) et `date_collecte` (date d'intervention logistique). L'export Collectes liste les deux ; l'export Événements expose `date_evenement` + `date_premiere_collecte` + `date_derniere_collecte` (grain événement, agrège les collectes ZD/AG de l'événement).
- Poids en kg (décimales avec virgule)
- Bouton "Exporter" disponible sur chaque vue tableau — génère et télécharge le fichier immédiatement

### Filtres appliqués à l'export

L'export respecte les filtres actifs dans l'interface au moment du clic. Exemple : si le traiteur_manager a filtré ses collectes sur "janvier 2026", l'export CSV contient uniquement ces collectes filtrées. Factures Admin : l'export reprend Organisation, Type, Période (date de création) et la pastille « En erreur » de la liste. Exports Factures des espaces clients : période sur la date d'émission *(arbitrage Val 2026-10-01, divergence M1.7_20261001_export-factures-periode)*. Listes Collectes traiteur et agence : l'export applique les filtres de la barre comme la liste affichée (type, statuts de l'onglet, période, lieux, clients organisateurs, info incomplète, programmée par), lus par la même fonction. Liste Collectes gestionnaire *(décision Val 2026-10-07)* : l'export applique les filtres de sa barre (type, période, lieux, traiteurs, type et taille d'événement), lus par la même fonction que la liste ; un filtre Lieu, Traiteur, Type ou Taille dont aucune valeur n'est lisible rend un fichier sans ligne (type et taille de la collecte, comme la liste — lot C1). Les dimensions de drill-down du dashboard traiteur (commercial, association, périmètre) ne sont pas appliquées par l'export. Liste Collectes Admin : l'export applique les filtres de la liste affichée — onglet, pastille rapide, statuts affichés, type, traiteur opérationnel, lieux, période, « Info incomplète », « Infos accès à envoyer », « Rapport non consulté », périmètre d'organisations du drill-down du Dashboard Client Admin — lus et appliqués par la même fonction que la liste ; ni le tri ni la page ne sont repris *(demande Val 2026-10-07, divergence M0.6_20261007_export-csv-liste-collectes-admin)*. L'export Collectes porte toute la sélection, quel que soit le nombre de lignes.

---

## 3. Export REP Emballages / Citeo (V1.1)

**Périmètre** : déclenché après validation officielle du référencement Citeo (attendue début mai 2026).

**Contenu de l'export** :
- Par collecte : date, lieu, traiteur, volumes d'emballages collectés par flux **en équivalent roll** (nombre de rolls × volume unitaire roll)
- Conversion automatique kg → équivalent roll sur la base du référentiel Savr (ratio par flux)
- Format conforme aux exigences de déclaration REP Emballages

**Ce qu'on anticipe en V1 dans le data model** : les champs `pesees.poids_kg` et `pesees.nb_rolls` sont déjà collectés par flux — l'export V1.1 sera une requête SQL supplémentaire sur des données déjà disponibles. Aucune modification de schéma requise au moment du passage V1.1.

---

## Décisions prises

| Décision | Alternative écartée | Raison |
|---|---|---|
| Embargo 24h sur tous les rapports | Génération immédiate post-collecte | Laisse le temps à l'Admin de corriger les pesées TMS avant première émission |
| Exports CSV pour tous les profils | Admin uniquement | Coût nul, valeur pour tous. RLS garantit que chaque profil ne voit que ses données |
| Alerte pesées anormales **in-app back-office** Admin *(F2 lot ⑫ 2026-06-07)* | Blocage automatique / email immédiat | L'alerte informe sans bloquer — l'Admin décide de corriger ou de valider. Email retiré (pas de template §06.02, le back-office est l'outil de travail quotidien Ops) |
| Rapport de recyclage fabriqué à chaque téléchargement par **tout utilisateur autorisé à le lire** *(décision Val 2026-10-16 — remplace la régénération manuelle étendue le 2026-10-02)* | Admin uniquement | Autonomie client, réduit les sollicitations Admin Savr |
| Picto dans l'interface si régénération ; mention en pied de PDF conservée sur le bordereau et l'attestation de don, **retirée du rapport de recyclage** *(2026-10-02, décision Val)* | Pas de signalement | Traçabilité et confiance client — le rapport reflète les données les plus récentes |
| Export Citeo V1.1 | V1 | Validation Citeo non encore obtenue. Données déjà collectées en V1, export = requête SQL |
| CSV séparateur `;` | Séparateur `,` | Compatible Excel FR sans manipulation supplémentaire |
| Rapports de synthèse agrégés sans email auto | Envoi email à chaque génération | Volume emails trop important, faible valeur — l'utilisateur récupère à la demande |
| Périodes civiles + intervalle personnalisé pour synthèse à la demande | Périodes civiles uniquement | Flexibilité nécessaire pour les besoins RFP, bilans clients, reporting interne non aligné calendrier civil |
| Filtres multi-dimensions (lieux + traiteurs + types + commerciaux) | Filtre unique ou aucun | Un seul template, plusieurs angles d'analyse — évite de multiplier les templates PDF spécifiques |
| Pas d'idempotence sur rapports à la demande | Unicité `(org, période, filtres)` | Un même rapport peut légitimement être régénéré après correction de pesée ou nouvelle collecte |
| **Refonte 2026-05-05** — Suppression batchs auto synthèses (mensuel/trimestriel/annuel) + suppression table `rapports_synthese` + suppression bucket | Conservation batchs + archivage | Sobriété V1 max. Volume usage non démontré, complexité batch + stockage non justifiée. Réactivation possible V1.1. |
| **Refonte 2026-05-05** — Bloc benchmark kg/pax intégré au rapport RSE collecte ZD (§1.2 page 1) | Bloc absent du PDF | Le traiteur génère le PDF pour son client → support visuel comparatif valorise la performance. |
| **ANNULÉE 2026-06-03 (arbitrage Val, session sobriété §06.04)** | Snapshot persisté pour PDF reproductible | Décision B2 **revenue** le jour même : Val veut conserver le snapshot des filtres benchmark (PDF reproductible) + **ajout d'une légende sous le graphe** précisant les filtres appliqués. Colonne `rapports_rse.filtres_benchmark` **rétablie** (cf. [[04 - Data Model]]). Le calcul à la volée est abandonné. |
| **Refonte 2026-05-05** — Génération synthèse à la demande via modal depuis le dashboard, plus de section dédiée Rapports RSE | Section dédiée Rapports RSE | Un seul point d'entrée (dashboard), filtres pré-remplis depuis le contexte courant, pas de navigation supplémentaire |
| **Refonte 2026-05-06** — Taux de recyclage indicateur unique ZD-only, formule à captation par filière (méthode UE 2019/1004) | Coexistence "Taux de détournement" + "Taux de recyclage net" + "Taux de valorisation" | Cohérence vocabulaire client + alignement standard UE + simplicité explication. Suppression "Taux de valorisation" du modèle. PDF Rapport RSE §1.2 et synthèse §1.6 alignés. Export CSV ZD enrichi colonne `taux_recyclage_pct` (ex `taux_tri_pct`). |
| **Refonte 2026-05-21 (D2)** — Date de référence client = `date_evenement` sur tous les documents/exports client | Affichage `date_collecte` (date logistique) en tête | Le client reconnaît la date de son événement, pas la date d'intervention (qui peut être la nuit/le lendemain). Date de collecte reléguée en mention "intervention le …" + conservée comme référence des documents réglementaires (bordereau) / logistiques (constat chauffeur). *(Exception 2026-10-02, décision Val : la page 1 du rapport de recyclage affiche la date de collecte, plus la date de l'événement — cf. §1.2.)* |
| **Révisé 2026-05-25 (Sujet 1, option A)** | Rapport par collecte | Révision : multi-camions interne au TMS (1 collecte ZD → N tournées), rapport au **niveau de la collecte ZD** (pesées des N camions agrégées sous la collecte par S5). |
| **Révisé 2026-05-25 (Sujet 1, option A)** | Contrôle g/pax par collecte | Le contrôle revient **par collecte** : le TMS agrège les N camions sous la collecte ZD, donc le volume complet est rapporté au `nb_pax` complet — plus de faux positifs, plus d'attente "toutes collectes ZD realisee". |

## Questions ouvertes

*Aucune pour cette section.*

## Liens

- [[04 - Data Model]]
- [[05 - Règles métier]]
- [[07 - Architecture technique]]
- [[08 - APIs et intégrations]]
- [[11 - Dashboards]]
