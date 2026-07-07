# 04 - Brief Claude Code par module — Template chirurgical

> Copier-coller ce gabarit au démarrage de chaque session Claude Code. Un brief = une session = un `/goal` = un module (ou **un sous-lot** pour les modules XL, conventions §6). Les briefs concrets V1 sont dans `03 - Modules par verticale/V1/`.
> **Règle d'or** : pas de condition d'achèvement binaire vérifiable par commande = pas de `/goal` lançable. Jamais de critère qualitatif (« l'UI est propre ») — le vérificateur ne sait pas trancher.
> **Re-validation JIT obligatoire** (conventions §4) : avant de coller le brief, le re-vérifier contre `specs/cdc/` à jour. Brief divergent de la spec = brief à régénérer, pas à rafistoler en session.

---

```markdown
# Brief Claude Code — Module X.Y — [Nom]

## Objectif
[1 phrase claire du livrable]

## Contexte (lu depuis CLAUDE.md)
[Pointer les sections, ne pas recopier]

## Périmètre — À coder
- [ ] Fichier : `packages/.../...`
- [ ] Endpoint : `POST /api/...`
- [ ] Migration SQL : `supabase/migrations/...` (+ triggers métier du module)

## Périmètre — Hors scope (ne PAS toucher)
- [ ] Modèle de données figé en 0.3 (pas de rename/drop)
- [ ] Module X.Z (autre session)
- [ ] tms.* (n'existe pas en V1)

## Pièges connus / décisions à ne PAS rouvrir
[Lister les décisions tranchées que Claude Code serait tenté de « réinterpréter » : règles SI/ALORS du CLAUDE.md §4 touchant le module, inversions de reco déjà arbitrées, patterns imposés (lease/claim, gapless, FIFO…). 3-8 lignes max, avec pointeur spec.]

## Sources CDC à lire (uniquement — `specs/cdc/` dans le repo)
- `specs/cdc/01 - Cahier des charges App/...`
- `specs/cdc/01 - Cahier des charges App/05 - Règles métier.md` section [Y]

## Tests à passer (scénarios dans `specs/tests/`, manifest `specs/manifests/M_X.Y.json`)
[Sous-ensemble des scénarios couverts par CE module = le manifest. Chaque test porte l'ID module + scénario dans son titre (conventions §2).]

## Mocks consommés (conventions §3 — jamais de service externe en CI)
[Ex. : mock MTS-1 (0.11), mock INSEE/VIES (0.11). Vérifs sur services réels = checkpoint humain.]

## Définition de fini
- [ ] Tous les scénarios du manifest verts
- [ ] CI verte (lint + types + Vitest + pgTAP + Playwright si UI + build)
- [ ] Démo manuelle : [scénario précis]

## Pré-requis d'entrée (vérifier AVANT le /goal)
- [ ] Modules amont mergés : [...]
- [ ] `specs/` synchronisé (date du dernier `specs: sync` ≥ dernière modif Vault)
- [ ] Manifest `specs/manifests/M_X.Y.json` présent et arbitré
- [ ] Mocks requis disponibles (0.11)
- [ ] `pnpm seed:demo` passe
- [ ] RLS posées sur les tables du module (0.4)

## Condition d'achèvement /goal
> /goal Le module X.Y est terminé quand : `pnpm test:module M_X.Y` est vert (échoue si 0 test) ET `pnpm check:coverage M_X.Y` est vert (100% du manifest couvert) ET `pnpm build` passe ET `pnpm lint` ne renvoie aucune erreur ET les pgTAP RLS du module sont verts [ET Playwright du parcours est vert].

## Budget tokens estimé
[XXX]k — alerte à +50%. [Si > 800k : découper en sous-lots, 1 /goal par sous-lot.]

## Garde-fous /goal
- Trust mode accepté avant lancement.
- Un seul /goal par session ; `/goal clear` avant le module suivant.
- **Checkpoint humain obligatoire entre 2 modules/sous-lots** : dérouler `CHECKLIST_CHECKPOINT.md` (harnais), valider, merger. Jamais d'enchaînement auto.
- Stop si conso > +50% : couper, analyser, reprendre le brief. Conso mesurée via `/cost` → tracker `06`.

## Si tu hésites
Demande à Val. Stop si question ouverte non résolue dans CLAUDE.md §7 (gate Everest, licence MTS-1, profils go-live).
```

---

## Boucle d'exécution par module (rappel)

1. **Re-valider le brief** contre `specs/cdc/` à jour (JIT, conventions §4) ; produire/revoir le manifest.
2. Vérifier les **pré-requis d'entrée**.
3. Coller le brief, lancer le `/goal` (condition binaire `test:module` + `check:coverage`).
4. Laisser tourner en autonomie ; surveiller le budget (stop +50%).
5. Fin du goal : `/goal clear`, **checkpoint humain (CHECKLIST_CHECKPOINT.md)**, `/cost` → tracker, merger.
6. Module suivant.

**Jamais de `/goal` global** sur une verticale entière ou toute la roadmap : condition invérifiable, dérive de contexte, pas de checkpoint, dépendances non séquencées.
