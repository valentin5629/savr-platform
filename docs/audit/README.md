# Audit de conformité CDC → code

> But : détecter **tous** les livrables que le CDC impose mais qui n'ont jamais été implémentés (ou seulement à moitié), indépendamment de la couche de tests. C'est la réponse à l'incident « blocs graphiques du dashboard traiteur jamais codés ».

## Pourquoi cet audit existe (cause racine)

Le harnais qualité ne compare jamais le code au **CDC**. Il le compare à une **transcription dérivée** (le manifeste de module + les scénarios Gherkin). Cette transcription est à perte :

- `scripts/check-coverage.ts` vérifie seulement que chaque scénario **listé dans le manifeste** a un test Vitest. Si un livrable n'est pas dans le manifeste, **rien ne le cherche**.
- le reviewer `conformite-spec` s'ancre sur « scénarios + règles métier », pas sur les livrables présentationnels/énumérés.
- résultat : tout livrable du CDC non recopié en scénario est **invisible** pour 100 % des gates. Les blocs graphiques (Bloc 2 barres, Bloc 4 donut…) sont tombés exactement dans ce trou. Le bug `v_factures_client` (vue `SECURITY INVOKER` sans policy backing, 0 ligne pour tous les clients pendant ~5 j — cf. `_Divergences/.../M3.5_20260616.md`) est la version **invisible** du même problème.

Cet audit repart donc de la **source de vérité (le CDC)** et la traite comme une checklist de livrables atomiques.

## Fichiers du setup

| Fichier | Rôle |
|---|---|
| `docs/audit/AUDIT_SCOPE.json` | Base de scope éditable : sections CDC canoniques → fichiers source → racines de code/tests → statut de livraison. **Source de vérité du périmètre.** |
| `.claude/workflows/cdc-conformity-audit.mjs` | Le workflow multi-agents (Extract → Evidence → Verify adverse → Synthesize). |
| `docs/audit/README.md` | Ce runbook. |
| `docs/audit/gap-register-<date>.md` | **Sortie** : registre d'écarts trié (à écrire après le run). |

## Comment lancer (dans une nouvelle session Claude Code)

1. Ouvre une session dans ce repo.
2. Donne cette consigne (l'agent lira le scope et lancera le workflow) :

   > « Lis `docs/audit/AUDIT_SCOPE.json`, puis lance le workflow d'audit avec ce scope en `args`. Quand il renvoie, écris `register.markdown` dans `docs/audit/gap-register-<date du jour>.md` et donne-moi la synthèse + les écarts critiques/élevés. »

   Concrètement, l'agent doit faire :

   ```
   // 1) Read docs/audit/AUDIT_SCOPE.json  -> objet `scope`
   Workflow({
     scriptPath: ".claude/workflows/cdc-conformity-audit.mjs",
     args: scope            // l'objet { options, sections } parsé depuis le JSON
   })
   ```

   Le workflow tourne en arrière-plan ; une notification arrive à la fin. Suivi live : `/workflows`.

3. **Pilote d'abord (recommandé)** pour calibrer : passe en `args` un `scope` ne contenant qu'une ou deux sections (ex. `dashboards`, `espace-traiteur`). Vérifie le registre produit, puis relance avec toutes les sections.

4. **Run complet** : passe le scope entier. ~24 sections → fan-out de quelques dizaines d'agents (Extract + Evidence + 1 Verify par écart). Token-lourd mais c'est le prix de l'exhaustivité (objectif : audit définitif).

## Coût & calibrage (pilote du 2026-06-22)

Pilote réel sur **1 section dense** (`dashboards`) en mode `per_finding` :

| Métrique | Valeur |
|---|---|
| Livrables extraits | 98 (48 implemented / 20 partial / 30 confirmed_gaps / 7 faux positifs / 1 pending) |
| Agents | 54 (1 extract + 1 evidence + ~50 verify + synth + critic) |
| Tokens sous-agents | ~3,6 M |
| Durée | ~25 min |

**Le coût est dominé par la vérification adverse par écart (~50 agents).** D'où le réglage `verify_mode` :

- `chunked` (défaut, 1 agent adverse / lot de `verify_batch_size`=10 écarts) → **~10× moins d'agents de vérif** par section, en gardant le raisonnement adverse par item.
- `per_finding` (1 sceptique / écart) → réservé aux sections critiques. Activé dans le scope sur `auth-permissions-rls` et `facturation`.
- `batched` (1 seul agent / section) → le moins cher, le moins rigoureux.

**Ordre de grandeur du run complet (23 sections, config par défaut)** : la plupart des sections sont moins denses que `dashboards`, et le mode `chunked` réduit fortement le poste verify. Estimation prudente : **~20–40 M tokens, plusieurs heures de wall-clock** (fan-out concurrent plafonné). Lance-le quand tu peux le laisser tourner ; suis avec `/workflows`. Pour réduire encore : passer les sections non critiques en `batched`, ou auditer par vagues (ex. d'abord les 7 sections critiques).

> Validation : le pilote a **re-détecté les écarts connus** (RevenusHistogramme orphelin, blocs graphiques) ET découvert un **bug réel inédit** — deux cartes KPI Admin filtrant `type='zd'/'ag'` contre l'enum `zero_dechet/anti_gaspi` → comptes toujours à 0, masqué par un test mockant Supabase. L'instrument détecte donc bien la classe d'écart *invisible*. Registre pilote : `docs/audit/gap-register-pilote-dashboards-2026-06-22.md`.

## Phasage en 4 vagues (audit) + ordre de remédiation

Le scope est découpé en 4 phases (clé `phases` de `AUDIT_SCOPE.json`) pour qu'aucun run ne soit trop gros. `dashboards` est déjà audité (pilote) → hors phases.

| Phase | Thème | Sections |
|---|---|---|
| **1** | Socle : sécurité, accès, données, transverse | `auth-permissions-rls`, `data-model`, `securite-conformite`, `observabilite`, `design-system` |
| **2** | Cœur métier : règles & flux amont | `regles-metier`, `formulaire-programmation`, `onboarding-cgu`, `algo-attribution-ag`, `co2-ademe` |
| **3** | Argent & systèmes externes | `facturation`, `architecture-adapters-outbox`, `apis-integrations`, `templates-emails`, `registre-reglementaire` |
| **4** | Surface lecture : back-office, espaces, reporting | `back-office-admin`, `espace-traiteur`, `espace-gestionnaire-lieux`, `espace-agence`, `espace-client-organisateur`, `reporting-exports`, `migration-bubble` (pending, optionnel) |

**Lancer une phase** : lire `AUDIT_SCOPE.json`, filtrer `sections` aux `phases.phase_N.section_ids`, garder `options`, passer en `args`. Écrire la sortie dans `docs/audit/gap-register-phaseN-<date>.md`.

### Ordre recommandé : auditer les 4 phases d'ABORD, corriger ENSUITE

Ne PAS faire « audit phase 1 → fix phase 1 → audit phase 2 → … ». Faire les **4 audits d'abord**, puis remédier sur le registre consolidé. Pourquoi :

1. **Priorisation globale** — un écart `critique` en phase 4 doit être corrigé avant un `moyen` en phase 1. Le fix-au-fil-de-l'eau force à traiter les `moyen` de la phase 1 avant de savoir ce que cachent les phases suivantes.
2. **Mutualisation des patterns** — un même bug-pattern (ex. littéraux `'zd'/'ag'` vs enum) revient souvent sur plusieurs sections. Tout auditer d'abord = corriger le pattern **une fois** partout, pas 4 fois en ordre dispersé.
3. **Prévention globale** — la gate `check:spec-deliverables` et les lints anti-récidive se conçoivent mieux une fois tous les écarts vus.
4. **Pas de re-churn** — corriger la phase 1 puis auditer la phase 3 ferait relire du code qui a bougé.

**Une seule exception (circuit-breaker)** : tout écart `critique` de **fuite inter-organisation / perte de donnée silencieuse** (classe du bug `v_factures_client`) se **hotfixe immédiatement**, sans attendre. Ces écarts-là ne font pas la queue.

**Entre chaque audit de phase**, faire la passe bon marché « cite puis confirme » (vérifier chaque écart contre son `file:line`) pour arriver, après la phase 4, à un backlog **confirmé, dédupliqué, trié par sévérité**, prêt à corriger top-down. La remédiation est alors une campagne unique et priorisée (et son coût tokens est SÉPARÉ de l'audit).

## Reprise (resume)

Si le run est interrompu : relance avec le même `scriptPath` + `resumeFromRunId: "<runId renvoyé au 1er appel>"`. Les `agent()` inchangés (même prompt) renvoient leur résultat en cache ; seuls les nouveaux/édités re-tournent. Même scope = 100 % cache.

## Ce que fait le workflow (4 phases)

1. **Extract** — 1 agent/section lit le(s) fichier(s) CDC canonique(s) et en extrait les **livrables atomiques** (bloc UI, KPI, filtre, règle SI/ALORS par branche, template email, table/colonne/vue/enum, endpoint, policy RLS, cron, PDF, alerte, état…). Inclut les livrables **non automatisables** (c'est là que vivent les écarts).
2. **Evidence** — 1 agent/section cherche la **preuve câblée** dans le code (pas « le fichier existe » mais « c'est monté/atteignable/testé »). Traque activement les **patterns de bugs latents** (vue `SECURITY INVOKER` sans policy, composant non monté, template non seedé, branche SI/ALORS partielle…). Statut : implemented / partial / missing / indeterminate.
3. **Verify** — 1 agent adverse **par écart** (missing/partial/indeterminate) qui tente de **réfuter** : faux positif (trouvé ailleurs/sous un autre nom) ? descope documenté (marqueur CDC V1.1/V2/DESCOPÉ ou fichier `_Divergences`) ? module pending (V5) ? Sinon → `confirmed_gap` + sévérité.
4. **Synthesize** — registre trié par sévérité (critique = sécurité/conformité/cloisonnement/perte silencieuse > règle métier/facturation > donnée/UX > UI cosmétique), + volet **anti-récidive**, + **critique de complétude** (sections sous-extraites à re-run).

## Garde-fous de précision (anti faux positifs / faux négatifs)

- **Source = CDC, jamais les manifestes** (les manifestes sont la cause du problème).
- **Preuve = câblage réel**, pas existence de fichier (leçon `RevenusHistogramme`).
- **Vérification adverse obligatoire** avant tout `confirmed_gap`.
- **Croisement descopes** : un manque documenté (CDC inline ou `_Divergences`) n'est pas un gap.
- **Statut de livraison par section** : un manque dans un module `pending` (V5 migration) = attendu, pas un gap.
- **Patterns latents** injectés dans le scope (`options.high_value_latent_patterns`) pour ne pas rater la classe invisible.

## Après l'audit : fix structurel (anti-récidive)

Le registre `prevention[]` propose le mécanisme qui empêche la récidive — à implémenter ensuite :
- **gate CI `check:spec-deliverables`** : diff des livrables énumérés d'une section CDC vs le manifeste du module → la transcription elle-même devient auditée ;
- **manifestes au grain livrable** (pas seulement scénario) ;
- **mandat du reviewer `conformite-spec` étendu** aux livrables présentationnels (statut « à vérifier manuellement » au lieu d'omission muette).

## Éditer le scope

`AUDIT_SCOPE.json` est fait pour être ajusté : ajouter/scinder une section (ex. découper `data-model` ou `regles-metier` s'ils sont trop gros pour un seul agent), corriger une racine de code, changer un `delivery_status`. Le workflow consomme ce JSON tel quel via `args`.
