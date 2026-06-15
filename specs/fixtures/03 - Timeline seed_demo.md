# 03 - Timeline seed_demo — 12 mois (juin 2025 → mai 2026)

**Créé** : 2026-06-07. **Référence temporelle figée** : `SEED_REF_DATE = 2026-06-01`. Toutes les dates sont calculées en relatif à cette constante puis **figées dans le script** (pas de `NOW()`), pour des tests non flaky.

---

## Hypothèses actées (Val, 2026-06-07)

- **~40 collectes/mois en moyenne** tous traiteurs confondus → **478 collectes sur 12 mois**.
- **Saisonnalité événementielle** calée sur les vacances scolaires (zone C Paris + été) : creux profond juillet-août, creux février (vacances d'hiver) et avril (printemps), pics mai-juin et septembre-novembre (salons, congrès), décembre porté par les galas (1re quinzaine) puis arrêt à Noël.
- **Mix ZD/AG** : ~60 % ZD / 40 % AG (hypothèse fixture, ajustable).
- **Kaspia ≈ 30 % du volume ZD** (prédominance actée).

## Répartition mensuelle des collectes

| Mois | Total | ZD | AG | Contexte saisonnier |
|---|---:|---:|---:|---|
| 2025-06 | 60 | 36 | 24 | pic congrès + soirées d'été |
| 2025-07 | 18 | 11 | 7 | vacances été |
| 2025-08 | 10 | 6 | 4 | creux maximal |
| 2025-09 | 56 | 34 | 22 | rentrée, salons |
| 2025-10 | 52 | 31 | 21 | salons (creux Toussaint fin de mois) |
| 2025-11 | 56 | 34 | 22 | pic salons/congrès |
| 2025-12 | 40 | 24 | 16 | galas 1re quinzaine, arrêt Noël |
| 2026-01 | 30 | 18 | 12 | redémarrage, vœux |
| 2026-02 | 24 | 14 | 10 | vacances d'hiver zone C |
| 2026-03 | 42 | 25 | 17 | reprise |
| 2026-04 | 38 | 23 | 15 | vacances de printemps |
| 2026-05 | 52 | 31 | 21 | pic printemps |
| **Total** | **478** | **287** | **191** | |

## Répartition par traiteur (moyenne mensuelle, mois nominal ~40)

| Traiteur | Coll./mois | dont ZD | dont AG | Annuel ~ |
|---|---:|---:|---:|---:|
| Kaspia | 12 | 10 | 2 | 143 |
| Potel et Chabot | 7 | 4 | 3 | 84 |
| Lenôtre | 5 | 3 | 2 | 60 |
| Fleur de Mets | 5 | 2,5 | 2,5 | 60 |
| Butard Enescot | 4 | 2 | 2 | 48 |
| Grand Chemin | 3 | 1,5 | 1,5 | 36 |
| Cirette (Rouen) | 2 | 0,5 | 1,5 | 24 |
| Nomad Traiteur | 0* | — | — | 23** |
| **Total** | **~40** | **~24** | **~16** | **478** |

\* Nomad = compte vide dans l'état courant (onboardé mai 2026, zéro collecte) — couvre l'état « nouveau client ».
\*\* Le reliquat (~23) est réparti au prorata sur Kaspia/Potel les mois de pic pour atteindre 478. Vérité = la matrice mois × traiteur du script d'injection (générée déterministe, committée en CSV).

## Répartition par lieu

- ~70 % des collectes sur les 10 lieux Viparis, dont moitié Porte de Versailles + Palais des Congrès (plus gros sites).
- ~15 % Musée des Arts Forains + Trianon.
- ~10 % lieux ponctuels « adresse libre ».
- ~5 % province Rouen (Cirette).

## Cycle de vie documentaire et financier

| Étape | Délai fixture | Détail |
|---|---|---|
| Collecte ZD → pesées (`collecte_flux`) | J0 | 3-4 flux/collecte |
| Collecte → `cloturee` | J+3 | sauf 25 `realisee` récentes (mai 2026) non clôturées |
| Clôture ZD → bordereau + impact (snapshot CO₂/taux figés) | J+3 | |
| Facture ZD par collecte | J+7 | |
| Facture ZD mensuelle (Kaspia) | agrégation auto le 1er du mois suivant (J+1 — F2 §06.08) | |
| Facture AG pack | à l'achat du pack | 4 achats répartis dans l'année |
| Paiements | 70 % à l'échéance (30 j), 20 % +30 j, 7 % +60 j, 3 % impayé > 90 j | les retards alimentent les dashboards créances |
| Attestations de don AG | J+10 après collecte | 80 sur l'année |
| Rapports RSE | 1/mois (12), dont 1 « sans excédent » (août) et 1 régénéré | |

## États « courants » au SEED_REF_DATE (2026-06-01)

- 30 événements à venir (juin → août 2026), dont les cas limites du catalogue (date NULL, AG bloqué, palier haut).
- 25 collectes `realisee` non clôturées (mai 2026) — pipeline de clôture vivant.
- 6 brouillons, 20 programmées/acceptées.
- 12 factures émises non payées (dont 3 en retard), 1 rejetée 4xx, 1 avoir sur payee.
- 1 pack Lenôtre épuisé, 1 pack Butard à 3/30, packs actifs ailleurs.

---

# Volet TMS (2026-06-07) — miroir 1:1

## Principes temporels TMS

- **Miroir 1:1** (arbitrage Val) : chaque collecte App de la matrice CSV a sa `collectes_tms` le même jour. Les 2 collectes manuelles et l'orpheline s'ajoutent hors matrice (481 au total).
- **Tournées** : J0, même jour que les collectes portées. ~370 tournées dérivées de la matrice à **1,3 coll/tournée** (~290 mono, ~80 doubles — mutualisation sur les pics Viparis). La dérivation collecte → tournée est elle aussi **committée en CSV** (pas calculée au run).
- **Répartition prestataires** (corrigée grilles réelles 2026-06-07) : Strike ~50 % (ZD IDF, camions 16/20 m³ vacations), A Toutes! ~28 % (AG IDF vélo cargo, grille matricielle), Marathon ~15 % (forfait 100 €/tournée — backup volume AG camion + dépannage ZD), Transnormandie ~5 % (Rouen), reste cas limites (camion A Toutes! manuel, collectes manuelles).

## Cycle financier prestataires (M07/M08)

| Étape | Délai fixture | Détail |
|---|---|---|
| Tournée `terminee` → `cout_calcule_ht` | J0 (trigger) | figé à la clôture (R2.8) |
| Facture prestataire reçue | M+1, entre J+3 et J+10 | 1 facture / presta actif / mois (R3.8, périodes jointives) |
| Rapprochement | J+1 après réception | ~85 % match exact auto-valid ; ~10 % écart > 100 € manuel ; ~5 % contestation |
| Contestation → avoir (D7) | J+15 | 1/trimestre, dont 1 post-validation W6 (flag) |
| Verrouillage tournées | à la validation | R3.6 ; 1 déverrouillage admin loggé (oct. 2025) |

## Rythmes opérationnels

- **Passages Veolia** : hebdomadaire (mardi), ~55 sur 12 mois ; 1 non confirmé J-1 de REF_DATE, 1 annulé avec motif (janv.), 1 a posteriori (mars), 1 clamping vides 0 (fév.).
- **Stocks rolls** : mouvements à chaque tournée ZD ; recompte Ops trimestriel (2 écarts tracés) ; stock Butard bas et Grand Chemin négatif **à REF_DATE**.
- **Géolocalisation** : points sur les tournées de mai 2026 uniquement + 1 cohorte avril > 30 j (cible du cron purge RGPD).
- **Alertes** : réparties sur l'année ; à REF_DATE restent ouvertes : 1 `m02_acceptation_sans_reponse` (collecte attribuée J-3), 1 stock bas, 1 passage Veolia non confirmé, 1 snoozée.

## Lot migration M13 (§13.4)

- Fenêtre : **avril 2026**, `migration_mode_active = true` sur la période.
- 5 tournées + 2 `factures_prestataires` avec `migration_test = true`, datées pour que la purge J+30 (`m13_cleanup_legacy`) soit **testable autour de REF_DATE** (1 lot purgeable, 1 lot encore dans la fenêtre).

## États « courants » TMS au SEED_REF_DATE (2026-06-01)

- 14 collectes_tms en pipeline : 3 `a_attribuer`, 3 attribuées (dont 1 stale 48 h), 4 acceptées, reste en exécution — miroir des 20 programmées/acceptées App + manuelles.
- 6 tournées à venir (juin) : ≥ 1 par statut non terminal, dont 1 province directe `acceptee`, 1 `en_cours` oubliée depuis J-1 (cron 8 h).
- 2 factures prestataires de mai en rapprochement (1 match exact, 1 écart 120 €).
- Stock entrepôt proche saturation ; passage Veolia du mardi suivant `planifie`.
