# Squelette V2 — Cycle traiteur AG

> Briefs détaillés **générés juste-à-temps** avant l'exécution de V2 (profondeur validée Val 2026-06-08). Ce squelette fige le périmètre, l'ordre et les dépendances. Régénérer chaque brief module avec le template `04` au moment de coder, après relecture des specs `_DEV-FACING/` à jour.

**Dépend de** : Niveau 0, V1 (machine à états, outbox, PDF, Pennylane, back-office).

| Module | Périmètre | Sources `_DEV-FACING/` | Tests | Budget (≈) |
|---|---|---|---|---|
| M2.1 — Packs AG | CRUD Admin packs, crédits, **FIFO strict `created_at`**, `trg_pack_debit_annulation_tardive` (annulation <12h débite le crédit) | §06/06, §05, §04 | `tests/06.06-...` | M ~400k |
| M2.2 — Formulaire AG + vérif pack | Volet AG du formulaire unifié, vérif pack actif (sans pack = **alerte seule**, F3 06.01), blocage coche étape 1 | §06/01, §05 | `tests/06.01-...` | M ~450k |
| M2.3 — Algo attribution AG | Recommandation top 3 asso/transporteurs, validation Admin, auto-accept par combinaison (`config_auto_accept_ag`) ; poids V1 = Ops manuel photos pesées (F1) ; refus asso = override standard (F2) | §06/09, §04, §09 | `tests/06.09-...` | L ~700k |
| M2.4 — Attestation don AG | Cerfa 2041-GE batch J+1 6h, mention fiscale si `association.habilitee_fiscale`, réutilise moteur PDF (A) ; `realisee_sans_collecte` = pas d'attestation | §05, §12, §06/03 | `tests/06.09-...`, génération | M ~450k |
| M2.5 — Course Everest 🔒 | Impl. `adapter_everest` derrière `logistique_provider`, course vélo cargo A Toutes! | §08, `_PENDING - Everest API V1` | M14 TMS (réf), `tests/08-...` | M ~500k |
| | | **FUSIONNÉ dans M1.7 (2026-06-14)** — AG unitaire livré en V1 avec ZD. Mode mensuel AG = non prévu (décision Val). | — | — |

**🔒 GATE Everest** : M2.5 bloqué tant que la réponse du dev Everest n'est pas reçue (mail Val 2026-06-07, CLAUDE.md §7). Matière en parking `01 - …/_PENDING - Everest API V1`. Possible de livrer V2 sans M2.5 (Everest activable V1.1) si Val tranche ainsi.

**Ordre** : M2.1 → M2.2 → M2.3 → M2.4, M2.5 inséré dès que le gate tombe. M2.6 supprimé (fusionné M1.7).
**Budget V2 ≈ 3,6M** (M2.6 ~400k retiré ; somme modules ~2,5M + intégration/E2E/correctifs ; transverses déjà posés en V1).
