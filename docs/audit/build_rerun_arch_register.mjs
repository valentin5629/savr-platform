import fs from 'node:fs';

const OUT =
  '/private/tmp/claude-501/-Users-valentinleblan-Code-savr-platform/c1f4332b-d2e1-4b75-9dac-4aba6a31e657/tasks/w2fbrf2wy.output';
const DEST =
  '/Users/valentinleblan/Desktop/Obsidian Savr/30. Review Code/Livrable Audit/gap-register-phase3-rerun-arch-strict-2026-06-23.md';
const RUN_ID = 'wf_e0bbcbf2-1ac';
const DATE = '2026-06-23';

const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const result = data.result
  ? typeof data.result === 'string'
    ? JSON.parse(data.result)
    : data.result
  : data;
const { register, critic, sections } = result;

// ---- Ground truth from verdicts ----
const allVerdicts = [];
for (const s of sections || [])
  for (const v of s.verdicts || [])
    allVerdicts.push({ section_id: s.section_id, ...v });
const vSeverity = {}; // deliverable_id -> verdict severity (ground truth)
for (const v of allVerdicts)
  if (v.verdict === 'confirmed_gap') vSeverity[v.deliverable_id] = v.severity;

const confirmed = allVerdicts.filter((v) => v.verdict === 'confirmed_gap');
const fps = allVerdicts.filter((v) => v.verdict === 'false_positive');
const descopes = allVerdicts.filter((v) => v.verdict === 'intentional_descope');

const sevOrder = { critique: 0, eleve: 1, moyen: 2, faible: 3 };
const sevLabel = {
  critique: 'Critique',
  eleve: 'Élevé',
  moyen: 'Moyen',
  faible: 'Faible',
};

// dedupe register.gaps, override severity from verdicts
const gseen = new Set();
const gaps = [];
for (const g of register.gaps || []) {
  if (gseen.has(g.deliverable_id)) continue;
  gseen.add(g.deliverable_id);
  const sev = vSeverity[g.deliverable_id] || g.severity;
  gaps.push({ ...g, severity: sev });
}
gaps.sort(
  (a, b) =>
    sevOrder[a.severity] - sevOrder[b.severity] ||
    String(a.section_id).localeCompare(String(b.section_id)),
);

// counts
const counts = {
  confirmed_gap: 0,
  false_positive: 0,
  intentional_descope: 0,
  pending_module: 0,
};
for (const v of allVerdicts) counts[v.verdict] = (counts[v.verdict] || 0) + 1;
const sevCount = { critique: 0, eleve: 0, moyen: 0, faible: 0 };
for (const v of confirmed) sevCount[v.severity]++;
const perSec = {};
for (const v of confirmed) {
  perSec[v.section_id] = perSec[v.section_id] || {
    critique: 0,
    eleve: 0,
    moyen: 0,
    faible: 0,
    total: 0,
  };
  perSec[v.section_id][v.severity]++;
  perSec[v.section_id].total++;
}
const totalDeliverables = (sections || []).reduce(
  (n, s) => n + (s.deliverables_count || 0),
  0,
);
const statusAgg = {};
for (const s of sections || [])
  for (const k of Object.keys(s.status_counts || {}))
    statusAgg[k] = (statusAgg[k] || 0) + s.status_counts[k];

const secTitle = {
  'arch-outbox-leaseclaim': 'Outbox transactionnelle + lease/claim',
  'arch-interface-provider': 'Interface `logistique_provider` V1',
  'arch-multicamions-terminal': 'Multi-camions & agrégation terminale',
};
const secModule = {
  'arch-outbox-leaseclaim': 'M1.4 / M1.5',
  'arch-interface-provider': 'M1.4 / M2.5',
  'arch-multicamions-terminal': 'M1.5 / M2.5',
};

// previous re-run baseline (wf_f1160365-4ae)
const prev = {
  'arch-outbox-leaseclaim': 6,
  'arch-interface-provider': 1,
  'arch-multicamions-terminal': 5,
};

const L = [];
const p = (...x) => L.push(x.join(''));

p('---');
p('tags: [audit, conformite, cdc, livrable, architecture, rerun]');
p('statut: fait');
p('cree: ', DATE);
p(
  'phase: 3 — re-run résiduel arch STRICT (evidence_rule durci, grain branche, verify per_finding)',
);
p('run_id: ', RUN_ID);
p('---');
p('');
p("# Registre d'écarts — Phase 3 · Re-run résiduel ARCHITECTURE (strict)");
p('');
p(
  '> **3e passage ciblé de la Phase 3.** Re-run RÉSIDUEL des **3 seules tranches `arch-*`**, recommandé par le critic du re-run précédent (`wf_f1160365-4ae`). ',
);
p(
  '> Objectif : débusquer les **false-negatives** (« déclaré mais non câblé ») sur le code le plus concurrent de la V1, pas re-confirmer. ',
);
p(
  "> Leviers : `evidence_rule` **DURCI** (chemin d'appel atteignable + test du vrai chemin exigés, pas la signature) · extraction **au grain branche** · **verify per_finding** (1 sceptique adverse par écart). ",
);
p(
  '> Run `',
  RUN_ID,
  '` — 43 agents, ~3,16 M tokens, ~33 min. Source de vérité = `specs/cdc/`, jamais les manifestes. **Détection seule, aucun code corrigé.**',
);
p('');

// ---- Circuit-breaker ----
p('## 🚨 Circuit-breaker — perte de donnée silencieuse (re-confirmée)');
p('');
p('**0 fuite inter-organisation détectée.** Le RLS tient sur les 3 tranches. ');
p('');
p(
  "**2 écarts critiques, tous deux = PERTE DE DONNÉE SILENCIEUSE, même cause racine :** l'agrégation terminale ne dérive **jamais** `collecte_flux` depuis `pesees_tournees`. ",
);
p(
  '`fn_agreger_terminal_collecte` ne fait que basculer `collectes.statut` ; aucun writer/trigger/fonction ne recalcule `collecte_flux.poids_reel_kg` (grep = 0 écriture). ',
);
p(
  "L'UPSERT promis en **commentaire de migration** (bloc2 L247 « dérivée par UPSERT ») n'est jamais codé. ",
);
p(
  '**Conséquence prod :** `poids_reel_kg` reste **NULL** alors que les pesées réelles existent dans `pesees_tournees` → **bordereaux ZD, rapport recyclage, registre réglementaire, dashboards ZD, CO2, exports CSV et factures ZD lisent un tonnage vide (0 kg)**. ',
);
p(
  'Le test e2e M1.8 **mocke `collecte_flux` déjà peuplé**, donc la CI reste verte sur un mécanisme cassé. ',
);
p('');
p(
  "> Ces 2 critiques (`sync-agregation-terminale` + `mc-collecte-flux-derivee-recalcul`) sont la même panne vue depuis 2 tranches. C'est le **gap critique déjà connu** des runs précédents — re-confirmé ici, **non corrigé** (détection seule).",
);
p('');

// ---- Réconciliation ----
p('## Réconciliation obligatoire (compte brut vs synthèse)');
p('');
p(
  'Le `summary` de la synthèse de ce workflow est partiellement faux (connu). **Vérité terrain = verdicts bruts dans `sections[].verdicts`.**',
);
p('');
p(
  '| Métrique | Compte brut (verdicts) | Synthèse (`register.summary`) | Verdict |',
);
p('|---|---|---|---|');
p(
  '| **Écarts confirmés** | **',
  counts.confirmed_gap,
  '** | ',
  register.summary.confirmed_gaps,
  ' | ✅ concordant (rare) |',
);
p(
  '| Faux positifs | **',
  counts.false_positive,
  '** | ',
  register.summary.false_positives,
  ' | ⚠️ **synthèse fausse (+',
  register.summary.false_positives - counts.false_positive,
  ')** |',
);
p(
  '| Descopes assumés | **',
  counts.intentional_descope,
  '** | ',
  register.summary.intentional_descopes,
  ' | ✅ concordant |',
);
p(
  '| Pending | **',
  counts.pending_module || 0,
  '** | ',
  register.summary.pending,
  ' | ✅ |',
);
p(
  '| Livrables totaux | ',
  totalDeliverables,
  ' | ',
  register.summary.total_deliverables,
  ' | ✅ |',
);
p('');
p(
  '**Sévérité des 24 écarts confirmés** (source = verdicts) : **critique ',
  sevCount.critique,
  ' · élevé ',
  sevCount.eleve,
  ' · moyen ',
  sevCount.moyen,
  ' · faible ',
  sevCount.faible,
  '**.',
);
p('');
p('Divergences de la synthèse à signaler (compte brut retenu) :');
p(
  '- La **prose markdown** de la synthèse annonce une répartition « critique 2 · élevé 14 · moyen 8 · faible 0 » — **fausse**. Le compte brut des verdicts donne **2 · 12 · 9 · 1**.',
);
p(
  "- `register.summary.false_positives = 14` alors que les verdicts n'en portent que **10** (les 4 paliers de retry + index + trigger dirty + 4 multicamions = exactement 10 FP listés §5).",
);
p(
  '- `register.gaps` reclasse **`outbox-col-consumed-at` de `faible` (verdict) à `moyen`** — le compte brut faible est retenu.',
);
p(
  '- Headline `confirmed_gaps = 24` : **concordant** cette fois (contrairement aux runs précédents où il hallucinait).',
);
p('');

// ---- Synthèse chiffrée ----
p('## Synthèse chiffrée');
p('');
p('| Métrique | Valeur |');
p('|---|---|');
p(
  '| Livrables extraits (grain branche) | ',
  totalDeliverables,
  ' (outbox 49 · interface 30 · multicamions 30) |',
);
p('| Implémentés (conformes) | ', statusAgg.implemented || 0, ' |');
p('| Partiels | ', statusAgg.partial || 0, ' |');
p('| Manquants (evidence) | ', statusAgg.missing || 0, ' |');
p(
  '| **Écarts confirmés** | **',
  counts.confirmed_gap,
  '** (crit ',
  sevCount.critique,
  ' · élevé ',
  sevCount.eleve,
  ' · moyen ',
  sevCount.moyen,
  ' · faible ',
  sevCount.faible,
  ') |',
);
p('| Faux positifs réfutés | ', counts.false_positive, ' |');
p('| Descopes assumés | ', counts.intentional_descope, ' |');
p('');
p('### Par tranche');
p('');
p(
  '| Tranche | Module | Livrables | Confirmés | crit | élevé | moyen | faible |',
);
p('|---|---|---|---|---|---|---|---|');
for (const sid of [
  'arch-outbox-leaseclaim',
  'arch-interface-provider',
  'arch-multicamions-terminal',
]) {
  const s = (sections || []).find((x) => x.section_id === sid);
  const ps = perSec[sid] || {
    critique: 0,
    eleve: 0,
    moyen: 0,
    faible: 0,
    total: 0,
  };
  p(
    '| `',
    sid,
    '` | ',
    secModule[sid],
    ' | ',
    s ? s.deliverables_count : '?',
    ' | **',
    ps.total,
    '** | ',
    ps.critique,
    ' | ',
    ps.eleve,
    ' | ',
    ps.moyen,
    ' | ',
    ps.faible,
    ' |',
  );
}
p('');

// ---- Comparaison ----
p('## Comparaison avec le re-run précédent (`wf_f1160365-4ae`)');
p('');
p(
  'Le re-run précédent (apis + arch) portait **12 gaps arch** ; ce passage strict en porte **24** = **× 2**. ',
);
p(
  "**Verdict : ce passage RÉVÈLE des false-negatives massifs.** L'hypothèse du critic (Evidence indulgente + extraction qui collapse les paragraphes multi-règles) est **confirmée**.",
);
p('');
p('| Tranche | Re-run précédent | Re-run strict | Δ |');
p('|---|---|---|---|');
let totPrev = 0,
  totNow = 0;
for (const sid of [
  'arch-outbox-leaseclaim',
  'arch-interface-provider',
  'arch-multicamions-terminal',
]) {
  const now = (perSec[sid] || { total: 0 }).total;
  totPrev += prev[sid];
  totNow += now;
  p(
    '| `',
    sid,
    '` | ',
    prev[sid],
    ' | ',
    now,
    ' | **+',
    now - prev[sid],
    '** |',
  );
}
p(
  '| **Total arch** | **',
  totPrev,
  '** | **',
  totNow,
  '** | **+',
  totNow - totPrev,
  ' (× ',
  (totNow / totPrev).toFixed(1),
  ')** |',
);
p('');
p(
  'Ce que le grain branche + evidence strict ont fait remonter et que le run précédent avait manqué :',
);
p(
  '- **Toute la procédure de déblocage DLQ a/b/c** (re-queue / skip motivé / résolution manuelle MTS-1) = **3 livrables, tous absents** du code exécutable (`admin_skip` = 0 occurrence).',
);
p(
  "- **Head-of-line traite `dead` comme NON bloquant** (`statut NOT IN ('done','dead')`) — divergence sémantique réelle vs CDC (« dead bloque PERMANENTEMENT ») → E2/E3 poussés au-delà d'un E1 mort.",
);
p(
  '- **Réconciliation N à chaud non câblée** : augmentation N (rangs manquants jamais créés), réduction N (rangs retirés jamais DELETE), fenêtre < 1h (`CANCEL_WINDOW_CLOSED` jamais atteint en réduction).',
);
p(
  "- **`mc-notif-admin-rejetee`** : rejet total transporteur posé en silence (pas d'alerte Admin ni retour file).",
);
p(
  "- **Reaper + alerte anticipée** : code câblé mais **aucun test n'exerce le vrai chemin** (régression silencieuse possible sur double-POST MTS-1).",
);
p(
  "- Re-confirme les **2 critiques connus** + les divergences de schéma (`dead_at`/`consumed_at`) + les marqueurs de traçabilité no-op (`noop_no_remote`, `consumer='manual'`).",
);
p('');
p('### Statut des 2 critiques déjà connus');
p('');
p('| ID | Run précédent | Ce run | Note |');
p('|---|---|---|---|');
p(
  "| `mc-collecte-flux-derivee-recalcul` | critique | **critique** | ✅ re-confirmé à l'identique |",
);
p(
  "| `mc-rpc-set-n-for-update` | critique | **élevé** | ⚠️ re-confirmé mais **rétrogradé** au grain fin (régression d'état terminal interne admin, pas de fuite/perte directe) |",
);
p('');

// ---- Detailed gaps ----
p('## Détail des écarts confirmés');
p('');
p(
  '> Trié par sévérité décroissante puis tranche. `expected` / `why_gap` / `remediation` repris de `register.gaps` (dédupliqué), sévérité alignée sur les verdicts bruts.',
);
p('');
let curSev = null;
let n = 0;
for (const g of gaps) {
  if (g.severity !== curSev) {
    curSev = g.severity;
    p('');
    p('### ', sevLabel[curSev] || curSev, ' (', sevCount[curSev], ')');
  }
  n++;
  p('');
  p('#### ', n, '. `', g.deliverable_id, '`');
  p(
    '- **Tranche / module :** `',
    g.section_id,
    '` · ',
    secModule[g.section_id] || g.module || '',
    '  |  **type :** ',
    g.type || '?',
  );
  p('- **Attendu (CDC) :** ', g.expected);
  p("- **Pourquoi c'est un trou :** ", g.why_gap);
  p('- **Remédiation :** ', g.remediation);
}
p('');

// ---- False positives ----
p('## Faux positifs réfutés (', fps.length, ')');
p('');
p(
  "> Lecture transverse : **presque tous** sont du code métier **correctement câblé en runtime** dont le **test n'exerce pas le vrai chemin** (worker outbox mocké, `getNextRetryAt`/`RETRY_DELAYS_MS` ré-implémentés inline dans le test, RPC d'agrégation mockée). ",
);
p(
  "> Ce n'est PAS un écart de livrable mais une **dette de couverture de test sur du code de concurrence/retry critique** — voir le volet prévention.",
);
p('');
p(
  "| # | Livrable | Tranche | Où c'est réellement implémenté | Raison de réfutation (résumé) |",
);
p('|---|---|---|---|---|');
let fi = 0;
for (const v of fps) {
  fi++;
  const fa = (v.found_at || '').replace(/\|/g, '\\|').slice(0, 180);
  const j = (v.justification || '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .slice(0, 240);
  p(
    '| ',
    fi,
    ' | `',
    v.deliverable_id,
    '` | `',
    v.section_id,
    '` | ',
    fa,
    ' | ',
    j,
    '… |',
  );
}
p('');

// ---- Descope ----
p('## Descope intentionnel assumé (', descopes.length, ')');
p('');
for (const v of descopes) {
  p('### `', v.deliverable_id, '` (`', v.section_id, '`)');
  p('- **Référence descope :** ', (v.descope_ref || '').replace(/\n/g, ' '));
  p('- **Justification :** ', (v.justification || '').replace(/\s+/g, ' '));
  p('');
}

// ---- Critic ----
p('## Critic de complétude (agent du workflow)');
p('');
p('**`recommend_rerun = ', critic.recommend_rerun, '`**');
p('');
if (critic.thin_sections && critic.thin_sections.length) {
  p('Sections jugées suspectes :');
  for (const t of critic.thin_sections) {
    p('');
    p('- **`', t.section_id, '`** — ', (t.reason || '').replace(/\s+/g, ' '));
  }
} else {
  p('Aucune section jugée sous-extraite par le compte.');
}
p('');
p(
  'Note du critic : ',
  (critic.note || '').replace(/\s+/g, ' ').replace(/\\"\}$/, ''),
);
p('');
p(
  "> **Lecture de l'auditeur :** le critic recommande encore un re-run sur `arch-interface-provider` (4 partial / 0 missing = profil « propre » suspect). ",
);
p(
  '> Nuance : ce passage strict y a **quand même fait passer interface de 1 → 4 gaps** (1 critique de perte de donnée + 3 moyens de traçabilité no-op). ',
);
p(
  "> Le profil 0-missing s'explique : l'interface est **réellement implémentée et câblée**, les trous y sont des **branches/traçabilité partielles** (no-op `noop_no_remote`/`manual` jamais écrits en base, warning Everest #savr-alerts-info en `console.warn` au lieu de Slack), pas des méthodes absentes. ",
);
p(
  '> Un 4e passage interface aurait un **rendement marginal faible** : la dérivation `collecte_flux` (le vrai critique) est déjà capturée. **Recommandation : clore les 3 tranches arch ; pas de 4e re-run.**',
);
p('');

// ---- Prevention ----
p('## Volet prévention — anti-récidive');
p('');
p(
  "**Cause racine** (constante sur tout l'audit) : la transcription **CDC → manifeste de module est à perte** ; les gates CI mesurent *code vs manifeste*, **jamais *code vs CDC***. Un livrable énuméré dans le CDC mais oublié du manifeste devient invisible. Ce run ajoute une 2e cause : **des tests qui assertent la présence (colonne/ligne/INSERT) mais pas le vrai chemin d'exécution** → CI verte sur mécanisme cassé.",
);
p('');
const prevention =
  register.prevention && register.prevention.length ? register.prevention : [];
let pi = 0;
for (const rec of prevention) {
  pi++;
  p(pi, '. ', (rec || '').replace(/\s+/g, ' '));
}
if (!prevention.length) {
  p(
    '1. **Gate CI `check:spec-deliverables`** : diff des livrables CDC énumérés vs manifeste de module, bloquant.',
  );
}
p('');
p('### Recommandations spécifiques à ce run (concurrence/retry)');
p('');
p(
  "1. **Bannir le mock du worker outbox dans ses propres tests** : exporter `runOutboxWorker` / `handleError` / `getNextRetryAt` / `RETRY_DELAYS_MS` et exiger au moins un test qui exerce le **vrai** chemin jusqu'à `dead` (DLQ) et jusqu'à l'alerte anticipée. 6 des 10 faux positifs et 4 des écarts confirmés sont des **trous de test sur du code de concurrence** — la classe la plus dangereuse car la régression future sera silencieuse.",
);
p(
  '2. **pgTAP obligatoire sur les RPC de concurrence** (pas seulement les policies RLS) : `fn_reap_outbox_claims`, `fn_agreger_terminal_collecte`, `fn_modifier_collecte` doivent avoir un test SQL exerçant le vrai `FOR UPDATE` + la garde de statut, jamais un retour RPC mocké côté TS.',
);
p(
  '3. **Checklist « procédure CDC → runbook »** : toute procédure opérationnelle décrite dans le CDC (déblocage DLQ a/b/c) doit avoir une entrée correspondante dans `RUNBOOK_INCIDENT.md` ET une RPC `SERVICE_ROLE` tracée `audit_log`. Gate doc.',
);
p(
  '4. **Garde-fou 1 (diff schéma vs DDL cible) à activer sur `outbox_events`** : `dead_at` / `consumed_at` divergent du DDL gelé sans fichier `_Divergences` → soit converger le nom, soit tracer la divergence.',
);
p(
  "5. **Reviewer conformité étendu aux branches énumérées** : pour toute règle SI/ALORS et toute énumération d'états (`{OK,PARTIAL,CANCELED,KO}`, issues DLQ a/b/c, augmentation/réduction N), vérifier **chaque branche** câblée + atteignable, pas seulement la branche nominale.",
);
p('');
p('---');
p('');
p(
  '*Registre généré par réconciliation des verdicts bruts du run `',
  RUN_ID,
  '` (le `summary`/prose de la synthèse divergent — compte brut retenu). Détection seule ; aucun fichier de code modifié.*',
);

fs.writeFileSync(DEST, L.join('\n'));
console.log('WROTE', DEST);
console.log('bytes:', fs.statSync(DEST).size);
console.log(
  'gaps detailed:',
  gaps.length,
  '| FP:',
  fps.length,
  '| descope:',
  descopes.length,
);
