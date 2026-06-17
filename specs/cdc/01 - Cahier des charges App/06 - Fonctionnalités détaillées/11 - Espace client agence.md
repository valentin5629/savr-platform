# 11 - Espace client agence

**Lié à** : [[02 - Personas et cas d'usage]] · [[04 - Data Model]] tables `organisations` (`type='agence'`, `est_shadow`, `cree_par_organisation_id`), `evenements`, `collectes`, `packs_antgaspi`, `entites_facturation` · [[06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte]] §Cas Agence · [[06 - Fonctionnalités détaillées/04 - Espace client traiteur]] (**source de vérité**) · [[11 - Dashboards]] · [[12 - Reporting et exports]]

---

## Contexte

Les **agences événementielles** sont des intermédiaires qui programment des prestations événementielles pour le compte de clients finaux (marques, entreprises, institutions). Elles travaillent avec un portefeuille de traiteurs partenaires (variable selon l'événement) et opèrent sur une grande variété de lieux.

Cibles V1 : agences parisiennes type **WPM**, **Quintessence Event**, **Auditoire**, **Magic Garden**.

Particularité métier : une agence n'est pas le producteur du déchet (le traiteur opérationnel l'est juridiquement), mais elle est le **donneur d'ordre** et celle qui **paye Savr**. Le traiteur opérationnel reçoit une notification info-only de la collecte programmée par l'agence et conserve son droit de retrait (cf. §05 §9 Notifications).

---

## Principe V1 — réplique stricte du §06.04 (parité absolue, 2026-06-03)

**L'espace agence est, en V1, l'espace traiteur (§06.04) à l'identique**, branché sur un autre périmètre de données. Aucune spec dashboard/liste/export n'est redécrite ici : **la source de vérité unique est le §06.04**. Toute évolution du §06.04 s'applique automatiquement à l'agence.

Le rôle `agence` est un **rôle unique** (pas de split manager/commercial) : un user agence voit toute l'activité de son organisation, comme un `traiteur_manager`.

### Différences forcées vs §06.04 (les seules)

| # | Différence | Détail |
|---|-----------|--------|
| 1 | **Périmètre de données** | RLS sur `evenements.organisation_id = current_user_organisation_id()` (l'agence est **donneur d'ordre**, pas traiteur opérationnel). Voir bloc RLS ci-dessous. |
| 2 | **Rôle unique `agence`** | Pas de distinction manager/commercial. **Décision F1 test-scenarios lot ⑨ 2026-06-07 (tranché Val)** : le bloc « Top 5 commerciaux » et le bloc « Mon organisation > Utilisateurs » (invitation/désactivation) sont **retirés V1 côté agence** (divergence forcée #8 ci-dessous). Le rôle `agence` reste « autres » dans la matrice `users` §09 (SELECT/UPDATE self only) — la gestion des utilisateurs agence est 100 % Admin Savr. |
| 3 | **Traiteur opérationnel affiché sur la fiche collecte** | Comme l'agence travaille avec des traiteurs ≠ elle-même, la **fiche collecte** ajoute une ligne « Traiteur opérationnel : {{nom}} » (badge orange « Hors référentiel » si fiche shadow). Nom résolu via la **vue whitelist `v_referentiel_traiteurs`** (F5 2026-06-07 — la RLS `organisations` ne donne pas la lecture du référentiel aux rôles clients, cf. §04/§09). C'est le **seul ajout UI** par rapport au §06.04. Pas de filtre ni de bloc dédié au traiteur opérationnel dans le dashboard en V1 (parité absolue — réévalué ultérieurement). |
| 4 | **Workflow shadow à la programmation** | Voir §06.01 §Cas Agence. La collecte est **programmable immédiatement** avec un traiteur hors référentiel ; tous les champs ne sont pas obligatoires (Nom commercial → `organisations.nom` + Raison sociale obligatoires, SIRET fortement recommandé non bloquant — pas de champ Ville, D2 2026-06-17) ; l'Admin Savr est **notifié en info-only** (in-app uniquement, F3) ; **aucune validation Admin n'est requise pour que la collecte ait lieu**. Seul le **bordereau Cerfa** reste en `brouillon` tant que le SIRET du traiteur shadow n'est pas renseigné — garanti par le trigger DB **`trg_bordereau_gate_shadow_siret`** (gate BEFORE INSERT/UPDATE sur `bordereaux_savr`, D3 2026-06-17). |
| 5 | **Pas de Registre réglementaire** | L'agence n'est pas productrice du déchet → pas d'accès au registre (§06.03). Exclusion câblée DB (F6 2026-06-07, tranché Val) : **prédicat `rôle ≠ 'agence'` dans la vue `v_registre_dechets`** (§04) — la vue scopait par `evenements.organisation_id`, une agence y aurait vu ses propres lignes. pgTAP P1 `registre_agence_denied`. Le bordereau Cerfa est snapshoté sur le traiteur opérationnel. |
| 6 | **Branding agence sur les PDF** | Sur les rapports/synthèses RSE, le logo de l'agence (`organisations.logo_url` du programmateur) prime. Règle déjà portée par [[12 - Reporting et exports]] §1.4 et §1.6 — aucune logique spécifique ici. |
| 7 | **Pas de KPI « Marge générée »** | Le dashboard agence affiche **4 cartes ZD** (Nb collectes ZD · Tonnage · Taux de recyclage · kg/pax), sans la carte Marge du §06.04 (5 cartes). La formule `tarif_refacture_pax_zd × pax − coût Savr` est propre au business model traiteur ; marge agence arbitrée V2. Décision 2026-05-07 maintenue. |
| 8 | **Pas de Top 5 commerciaux ni de gestion utilisateurs** *(décision F1 test-scenarios lot ⑨ 2026-06-07)* | Le Bloc 7 « Top 5 commerciaux » et le bloc « Mon organisation > Utilisateurs » du §06.04 ne sont **pas répliqués** côté agence en V1. Invitation/désactivation des users agence = Admin Savr uniquement (cohérent §09 : création `agence` par Admin only). RLS `users` : `agence` = self only (pas d'exposition org-wide). Réévalué avec le rôle `agence_commercial` V1.5 (QO #2). |

Tout le reste — structure des onglets ZD/AG, filtres globaux, blocs 2 à 8 par onglet, benchmark (4 dimensions §06.04, k-anonymat ≥5), bouton « Programmer un événement » (formulaire unique §06.01), bouton « Exporter une synthèse PDF » (Bloc 8 par onglet), pack AG fondu dans l'onglet AG, section « Mon organisation », section « Mon profil » — est **identique au §06.04** et n'est pas redécrit ici.

---

## Navigation

Identique au §06.04 §1 — **4 entrées** : Dashboard · Collectes (liste + programmation) · Mon organisation · Mon profil. *(correctif D5 2026-06-17 : « Paramètres » → « Mon profil », conforme §06.04 et implémentation M3.3)*

Différence : **pas de Registre réglementaire** (non producteur, cf. différence #5). L'export RSE se fait via le Bloc 8 du dashboard (comme §06.04), il n'y a pas de section nav dédiée. Le pack AG est consultable dans l'onglet AG du dashboard (comme §06.04), pas en section nav dédiée.

**Bouton primaire « Programmer un événement »** : formulaire unique §06.01 (choix ☐ZD ☐AG en étape 1), **cas Agence** (combobox traiteur opérationnel : référentiel + option shadow ; combobox lieu : ouverte sans restriction). Si Anti-Gaspi coché sans pack actif, la soumission AG est bloquée (« Contactez Savr pour négocier un pack AG ») — la collecte ZD reste programmable.

---

## Liste Collectes — seule différence vs §06.04

Vue liste et fiche collecte identiques au §06.04, scopées sur le périmètre de l'agence (différence #1). **Unique ajout** : la **fiche collecte** affiche le traiteur opérationnel (différence #3), avec badge « Hors référentiel » cliquable → modal de complétion SIRET si fiche shadow.

**Mécanique de complétion SIRET (décisions F2/F3/F4 test-scenarios lot ⑨ 2026-06-07, tranché Val)** :

- **F2** : la modal appelle la RPC **`f_completer_siret_shadow(org_id, siret)`** (SECURITY DEFINER) — pas d'UPDATE RLS direct (§09 inchangé : « pas de droit UPDATE sur les fiches shadow »). Gardes internes : fiche cible `est_shadow=true` ET `cree_par_organisation_id = organisation de l'appelant` ET rôle `agence` ; **écrasement interdit** si `siret` déjà renseigné (exception) ; format SIRET 14 chiffres validé.
- **F3** : notifications Admin du workflow shadow (création fiche + SIRET complété) = **in-app seules** (pas de template email — catalogue §06.02 inchangé, 19 actifs).
- **F4** : deux triggers complémentaires garantissent le cycle brouillon/émis pour les bordereaux shadow *(D3 2026-06-17)* :
  - **`trg_bordereau_gate_shadow_siret`** (BEFORE INSERT/UPDATE ON `bordereaux_savr`) — **gate DB** : toute sortie de `brouillon` est ramenée à `brouillon` si le producteur est une fiche shadow sans SIRET. Gate keyé sur shadow-ness (`organisations.est_shadow=true AND siret IS NULL`) : `organisations.siret` = NULL uniquement pour les shadow (les traiteurs normaux ont source de vérité = `entites_facturation`), ce qui évite de bloquer les bordereaux normaux.
  - **`trg_cerfa_debloque_siret`** (`AFTER UPDATE OF siret ON organisations`, scope `est_shadow=true`, siret NULL→NOT NULL) → snapshote le SIRET sur les bordereaux brouillon liés, les passe `emis` (le gate laisse passer car SIRET désormais renseigné) et ré-enqueue le PDF. **Zéro action humaine.**

Workflow d'édition collecte : identique §06.04, cascade webhook E2 vers TMS. Spécificité agence : si l'agence modifie une collecte dont le traiteur opérationnel ≠ agence, le traiteur opérationnel est notifié (cf. §05 §9 « Collecte modifiée par un tiers »).

---

## Règles RLS Supabase

```sql
-- Lecture événements et collectes (périmètre donneur d'ordre)
CREATE POLICY agence_select_evenements ON plateforme.evenements
  FOR SELECT
  USING (organisation_id = current_user_organisation_id());

-- SELECT collectes : couvert par la policy transverse `col_select` (f_collecte_visible).
-- Le snippet `agence_select_collectes` est illustratif/non normatif (décision 2026-06-17 D4).
-- En pratique, une organisation de type `agence` n'est jamais désignée
-- `traiteur_operationnel_organisation_id` → périmètre donneur d'ordre garanti sans restriction
-- supplémentaire. Source de vérité : plateforme.f_collecte_visible (§09, policy `col_select`).
-- Le scénario `agence_ne_voit_pas_collectes_ou_elle_serait_operateur` est retiré du périmètre
-- normatif (org agence jamais traiteur opérationnel).

-- Écriture événements (programmation)
CREATE POLICY agence_insert_evenements ON plateforme.evenements
  FOR INSERT
  WITH CHECK (
    current_user_role() = 'agence'
    AND organisation_id = current_user_organisation_id()
  );

-- Écriture collectes
CREATE POLICY agence_insert_collectes ON plateforme.collectes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM plateforme.evenements e
      WHERE e.id = collectes.evenement_id  -- correctif 2026-06-07 lot ⑨ : NEW. invalide dans un WITH CHECK (référence directe aux colonnes de la row)
      AND e.organisation_id = current_user_organisation_id()
    )
  );

-- Modification collecte (fenêtre de modification = source unique §05 §4)
CREATE POLICY agence_update_collectes ON plateforme.collectes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM plateforme.evenements e
      WHERE e.id = collectes.evenement_id
      AND e.organisation_id = current_user_organisation_id()
    )
    AND statut IN ('programmee', 'validee')  -- Fenêtre de modification niveau collecte = source unique §05 §4. Sujet 2 2026-05-26 : 'attribuee' retiré (valeur de statut_tms, jamais de collectes.statut)
  );

-- Création fiche shadow traiteur (cas hors référentiel, A1)
CREATE POLICY agence_insert_shadow ON plateforme.organisations
  FOR INSERT
  WITH CHECK (
    current_user_role() = 'agence'
    AND est_shadow = true
    AND type = 'traiteur'
    AND cree_par_organisation_id = current_user_organisation_id()
  );

-- Lecture fiches shadow créées par l'agence
CREATE POLICY agence_select_shadow ON plateforme.organisations
  FOR SELECT
  USING (
    est_shadow = true
    AND cree_par_organisation_id = current_user_organisation_id()
  );
```

Cf. [[09 - Authentification et permissions]] pour la matrice complète.

---

## Impact data model

Aucune nouvelle table requise. Réutilise :

- `organisations` (`type='agence'`, et `type='traiteur'` `est_shadow=true` pour les fiches shadow créées par l'agence)
- `users` (rôle `agence`)
- `evenements` (`organisation_id` = agence, `traiteur_operationnel_organisation_id` ≠ agence)
- `collectes`, `packs_antgaspi`, `entites_facturation`, `factures` — réutilisation directe
- `rapports_rse` (colonne `filtres_benchmark` jsonb mutualisée avec §06.04 — snapshot des filtres benchmark persisté pour reproductibilité PDF)

---

## Décisions prises

| Décision | Alternative écartée | Raison |
|----------|---------------------|--------|
| **Espace agence = réplique stricte §06.04 (parité absolue V1, 2026-06-03)** | Spec agence sui generis / divergences dashboard maintenues | Source de vérité unique §06.04 → zéro dérive, surface de code/tests minimale. Divergences agence (filtre + Top 5 traiteurs opérationnels, 5e dim benchmark) réévaluées après V1. |
| Périmètre RLS donneur d'ordre | — | L'agence paye Savr et programme, sans être productrice. Scope `evenements.organisation_id`. |
| Workflow shadow conservé (A1) | Référentiel only + création Admin manuelle | Use case réel : événements ponctuels avec traiteurs jamais référencés. Collecte non bloquée, Admin notifié info-only, aucune validation requise. |
| Traiteur opérationnel affiché sur la fiche collecte uniquement | Filtre + bloc dédiés (ex-spec) | Parité absolue §06.04. L'agence a besoin de savoir qui opère (fiche) sans dupliquer la mécanique analytique en V1. |
| Pas de Registre réglementaire | Réplique §06.03 | Non productrice. Bordereau Cerfa via traiteur opérationnel. |
| Branding agence sur PDF | Branding traiteur | L'agence partage le rapport avec son client final. Règle portée par §12. |
| Pas de KPI Marge ZD (4 cartes) | Hériter la carte Marge §06.04 | Formule propre au business model traiteur. Décision 2026-05-07 maintenue (confirmée 2026-06-03). |
| Pack AG ouvert agence | Réservé traiteur | Agences pré-achetant du volume. Décompte sur pack agence (programmateur=facturé V1). |
| **Top 5 commerciaux + bloc Utilisateurs retirés V1 (F1, 2026-06-07)** | Aligner RLS `users` agence sur traiteur_manager (org-wide) | Tranché Val (inverse reco). Gestion users agence = Admin only ; pas d'exposition org-wide des users. Divergence forcée #8. |
| **Complétion SIRET shadow = RPC `f_completer_siret_shadow` (F2, 2026-06-07)** | UPDATE RLS + trigger garde-colonnes / demande → Admin saisit | RPC SECURITY DEFINER limitée au SIRET, fiche créée par l'agence, écrasement interdit. §09 inchangé. Débloque le Cerfa sans délai Admin. |
| **Lecture référentiel traiteurs = vue whitelist `v_referentiel_traiteurs` (F5, 2026-06-07)** | Policy SELECT élargie sur `organisations` | Vue (id, nom, raison_sociale) SECURITY DEFINER pour agence + gestionnaire — zéro exposition siret/logo. Sans elle, combobox et fiche collecte mortes RLS. |
| **Exclusion registre agence = prédicat dans `v_registre_dechets` (F6, 2026-06-07)** | UI-only assumé | Garantie DB (la vue scopait par `organisation_id`). pgTAP P1 `registre_agence_denied`. |
| **Notifs Admin shadow = in-app seules (F3, 2026-06-07)** | Email + in-app (2 templates) | Info-only sans SLA. Catalogue §06.02 inchangé (19 actifs). Précédent F2 lot ⑫. |
| **Gate Cerfa + Déblocage auto au SIRET (F4, 2026-06-07 + D3 2026-06-17)** | Régénération manuelle Admin | (1) `trg_bordereau_gate_shadow_siret` (BEFORE, gate DB) : toute sortie `brouillon` ramenée à `brouillon` si shadow sans SIRET — non-shadow jamais affectés. (2) `trg_cerfa_debloque_siret` (AFTER, déblocage) : SIRET NULL→NOT NULL → brouillons liés passent `emis` + ré-enqueue PDF. Zéro action humaine. |

---

## Questions ouvertes

1. **Divergences dashboard agence (post-V1)** : réintroduire le filtre + bloc « Top 5 traiteurs opérationnels » et la dimension benchmark « traiteurs » une fois la V1 stabilisée ? (mises de côté en parité absolue 2026-06-03).
2. **Rôle `agence_commercial` V1.5** : segmenter manager (vue toutes collectes) vs commercial (vue ses propres) ? À étudier selon retours grandes agences (WPM/Quintessence : 10-15 utilisateurs).
3. **KPI Marge agence V2** : modèle économique commission/MOA déléguée.
4. **Notifications post-collecte au client final** : email auto au contact `evenements.client_organisateur` avec rapport RSE ? Hors scope V1.
5. **Multi-orga user (consultant inter-agences)** : un user appartenant à plusieurs agences. Hors scope V1.

---

## Liens

- [[01 - Formulaire de programmation de collecte]] §Cas Agence — workflow shadow détaillé
- [[04 - Espace client traiteur]] — **source de vérité** des composants répliqués
- [[05 - Règles métier]] §8 Onboarding, §9 Notifications
- [[04 - Data Model]] tables `organisations.est_shadow`, `evenements.traiteur_operationnel_organisation_id`
- [[09 - Authentification et permissions]] matrice RLS
- [[12 - Reporting et exports]] §Rapport RSE agence
