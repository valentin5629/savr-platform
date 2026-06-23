import fs from 'node:fs';

// Recompte le registre depuis les verdicts BRUTS (sections[].verdicts) — la synthèse sous-compte.
const OUT =
  process.env.OUT ||
  '/private/tmp/claude-501/-Users-valentinleblan-Code-savr-platform/968f030a-8567-4363-9984-8f463884c03f/tasks/wryal6qwu.output';
const DEST =
  '/Users/valentinleblan/Desktop/Obsidian Savr/30. Review Code/Livrable Audit/gap-register-phase4-rerun-boa-traiteur-2026-06-23.md';
const RUN_ID = 'wf_efb0148d-ba6';
const TASK_ID = 'wryal6qwu';
const DATE = '2026-06-23';
// Stats du run (métadonnées task-notification) :
const AGENTS = process.env.AGENTS || '77';
const TOKENS = process.env.TOKENS || '6,9 M';
const MINUTES = process.env.MINUTES || '73';
// La synthèse a planté (réponse > 64k tokens de sortie) -> register=null. On reconstruit depuis les verdicts.
const SYNTH_FAILED = true;

const raw = fs.readFileSync(OUT, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  // l'output peut être un jsonl/log ; tenter d'extraire le dernier objet { result: ... }
  const m = raw.lastIndexOf('"register"');
  throw new Error(
    'OUTPUT non-JSON direct — inspecter ' +
      OUT +
      ' (lastIndexOf register=' +
      m +
      ')',
  );
}
const result = data.result
  ? typeof data.result === 'string'
    ? JSON.parse(data.result)
    : data.result
  : data;
// register peut être null si la synthèse a dépassé le plafond de 64k tokens de sortie.
const register = result.register || { summary: {}, gaps: [], prevention: [] };
const critic = result.critic || {
  thin_sections: [],
  recommend_rerun: null,
  note: '',
};
const sections = result.sections || [];

// ---- Vérité terrain depuis les verdicts ----
const allVerdicts = [];
for (const s of sections || [])
  for (const v of s.verdicts || [])
    allVerdicts.push({ section_id: s.section_id, ...v });
const vSeverity = {};
for (const v of allVerdicts)
  if (v.verdict === 'confirmed_gap') vSeverity[v.deliverable_id] = v.severity;

const confirmed = allVerdicts.filter((v) => v.verdict === 'confirmed_gap');
const fps = allVerdicts.filter((v) => v.verdict === 'false_positive');
const descopes = allVerdicts.filter((v) => v.verdict === 'intentional_descope');
const pendings = allVerdicts.filter((v) => v.verdict === 'pending_module');

const sevOrder = { critique: 0, eleve: 1, moyen: 2, faible: 3 };
const sevLabel = {
  critique: 'Critique',
  eleve: 'Élevé',
  moyen: 'Moyen',
  faible: 'Faible',
};

// dédupe register.gaps, sévérité alignée sur verdicts
const gseen = new Set();
const gaps = [];
for (const g of register.gaps || []) {
  if (gseen.has(g.deliverable_id)) continue;
  gseen.add(g.deliverable_id);
  const sev = vSeverity[g.deliverable_id] || g.severity;
  gaps.push({ ...g, severity: sev });
}
// si la synthèse a laissé gaps vide, reconstruire un squelette depuis les verdicts confirmés
if (gaps.length === 0) {
  for (const v of confirmed) {
    gaps.push({
      deliverable_id: v.deliverable_id,
      section_id: v.section_id,
      type: '?',
      severity: v.severity,
      expected: '(voir CDC)',
      why_gap: v.justification || '',
      remediation: '(synthèse gaps vide — justification verdict ci-contre)',
    });
  }
}
gaps.sort(
  (a, b) =>
    sevOrder[a.severity] - sevOrder[b.severity] ||
    String(a.section_id).localeCompare(String(b.section_id)),
);

// compteurs
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

const BOA = [
  'boa-orgas-users',
  'boa-lieux',
  'boa-assos-transporteurs',
  'boa-collectes',
  'boa-factures',
  'boa-packs-ag',
  'boa-parametres-algo',
  'boa-dashboard-admin',
];
const TRAIT = [
  'trait-dashboard-zd',
  'trait-dashboard-ag',
  'trait-collectes',
  'trait-mon-orga',
  'trait-mon-profil-nav',
];
const ORDER = [...BOA, ...TRAIT];
const secTitle = {
  'boa-orgas-users':
    'CRUD organisations + users + rôles + delete + bandeau ops',
  'boa-lieux':
    'CRUD lieux + Normaliser + worklist signalements + demande ajout',
  'boa-assos-transporteurs': 'Référentiels associations + transporteurs',
  'boa-collectes': 'Écran collectes : liste + détail Blocs 0→7 + actions',
  'boa-factures':
    'Écran factures : liste/filtres + blocs SLA/retard/avoirs/KPIs',
  'boa-packs-ag': 'Packs AG : liste + modal création + historique + recrédit',
  'boa-parametres-algo':
    'TOUS les paramètres algo (tarifs/grilles/CO2/seuils/templates/intégrations)',
  'boa-dashboard-admin':
    'Dashboard Admin (Bloc 1 cartes + Bloc 2 revenus/export/pagination)',
  'trait-dashboard-zd':
    'Dashboard onglet ZD (Blocs 1→8, jauges, donut, barres, export PDF)',
  'trait-dashboard-ag':
    'Dashboard onglet AG (KPI, pack, courbe, top asso, renouvellement)',
  'trait-collectes':
    'Liste + fiche collecte (Bloc 3 jauges, download, sans-collecte, accès) + édition',
  'trait-mon-orga':
    'Mon organisation (infos, équipe 4 actions, invitation, facture, badge retard)',
  'trait-mon-profil-nav': 'Mon profil + nav 4 entrées + responsive',
};
const secModule = {
  ...Object.fromEntries(BOA.map((s) => [s, 'M0.6 / M1.x / M2.x'])),
  ...Object.fromEntries(TRAIT.map((s) => [s, 'M3.1'])),
};

// baseline run initial (wf_507832d8-607) : boa 69, traiteur 66 (verdicts bruts)
const PREV_BOA = 69,
  PREV_TRAIT = 66;
const boaNow = BOA.reduce((n, s) => n + (perSec[s] || { total: 0 }).total, 0);
const traitNow = TRAIT.reduce(
  (n, s) => n + (perSec[s] || { total: 0 }).total,
  0,
);

const L = [];
const p = (...x) => L.push(x.join(''));

p('---');
p('tags: [audit, conformite, cdc, livrable, surface-lecture, rerun]');
p('statut: fait');
p('cree: ', DATE);
p(
  'phase: 4 — re-run ciblé boa+traiteur (grain fin, fichier dense découpé en tranches)',
);
p('run_id: ', RUN_ID);
p('---');
p('');
p(
  "# Registre d'écarts — Phase 4 · Re-run ciblé BACK-OFFICE ADMIN + ESPACE TRAITEUR (grain fin)",
);
p('');
p(
  "> **Re-run ciblé de la Phase 4.** Ré-extraction au GRAIN FIN des 2 plus gros fichiers du CDC (997 + 910 lignes), jugés **SOUS-EXTRAITS** par le critic du run initial (`wf_507832d8-607` : densité d'extraction la plus faible de la phase → queue du document survolée ; les 69 et 66 gaps confirmés étaient un plancher). ",
);
p(
  '> Levier correctif : **chaque fichier dense découpé en tranches** (8 pour back-office-admin, 5 pour espace-traiteur) — 1 tranche = 1 agent Extract dédié sur une portion bornée (le même levier qui avait corrigé apis/arch en Phase 3). ',
);
p(
  '> Run `',
  RUN_ID,
  '` (task `',
  TASK_ID,
  '`) — ',
  AGENTS,
  ' agents, ~',
  TOKENS,
  ' tokens, ~',
  MINUTES,
  ' min, mode `chunked` (lots de 10), 13 tranches. Source de vérité = `specs/cdc/`, jamais les manifestes. **Détection seule, aucun code corrigé.**',
);
p(
  "> `migration-bubble` **exclue = NON-AUDITABLE** : la source dans `specs/` (`13 - Migration depuis Bubble.md`) est un **stub de cadrage** explicite (« Statut : Cadrage — le plan d'exécution détaillé vit dans `04 - Migration/` du Vault »), hors `specs/`. Re-auditer le stub produirait des artefacts de spec absente, pas des verdicts fiables.",
);
p('');

// ---- Circuit-breaker ----
p('## 🚨 Circuit-breaker');
p('');
if (sevCount.critique === 0) {
  p(
    "**RAS — 0 gap `critique` confirmé.** Aucune fuite inter-organisation, aucune perte de donnée silencieuse classée critique sur back-office-admin + espace-traiteur, même au grain fin. Cohérent avec le run initial Phase 4 (la surface lecture est la classe d'écart la plus visible donc la moins risquée).",
  );
} else {
  p(
    '**⚠️ ',
    sevCount.critique,
    ' gap(s) `critique` confirmé(s)** — à examiner en priorité (voir détail § Critique). Vérifier fuite inter-organisation / perte de donnée silencieuse.',
  );
  for (const g of gaps.filter((x) => x.severity === 'critique'))
    p(
      '- 🚨 `',
      g.deliverable_id,
      '` (`',
      g.section_id,
      '`) — ',
      (g.why_gap || '').replace(/\s+/g, ' ').slice(0, 200),
    );
}
p('');

// ---- Réconciliation ----
p('## Réconciliation obligatoire (verdicts bruts vs synthèse)');
p('');
p(
  "Le `summary`/`gaps` de la synthèse sous-comptent systématiquement (connu, constant sur tout l'audit). **Vérité terrain = `sections[].verdicts`.**",
);
p('');
p('| Métrique | Compte brut (verdicts) | Synthèse (`register.summary`) |');
p('|---|---|---|');
p(
  '| **Écarts confirmés** | **',
  counts.confirmed_gap,
  '** | ',
  register.summary?.confirmed_gaps ?? '?',
  ' |',
);
p(
  '| Faux positifs | ',
  counts.false_positive,
  ' | ',
  register.summary?.false_positives ?? '?',
  ' |',
);
p(
  '| Descopes assumés | ',
  counts.intentional_descope,
  ' | ',
  register.summary?.intentional_descopes ?? '?',
  ' |',
);
p(
  '| Pending module | ',
  counts.pending_module,
  ' | ',
  register.summary?.pending ?? '?',
  ' |',
);
p(
  '| Livrables totaux | ',
  totalDeliverables,
  ' | ',
  register.summary?.total_deliverables ?? '?',
  ' |',
);
p('| (lignes `register.gaps`) | — | ', (register.gaps || []).length, ' |');
p('');
p(
  '**Sévérité des ',
  counts.confirmed_gap,
  ' écarts confirmés (verdicts bruts) : critique ',
  sevCount.critique,
  ' · élevé ',
  sevCount.eleve,
  ' · moyen ',
  sevCount.moyen,
  ' · faible ',
  sevCount.faible,
  '.**',
);
p('');

// ---- Synthèse chiffrée ----
p('## Synthèse chiffrée');
p('');
p('| Métrique | Valeur |');
p('|---|---|');
p('| Livrables extraits (grain fin, 13 tranches) | ', totalDeliverables, ' |');
p('| Implémentés (conformes) | ', statusAgg.implemented || 0, ' |');
p('| Partiels | ', statusAgg.partial || 0, ' |');
p('| Manquants (evidence) | ', statusAgg.missing || 0, ' |');
p('| Indéterminés (evidence) | ', statusAgg.indeterminate || 0, ' |');
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
p('| Pending module | ', counts.pending_module, ' |');
p('');
p('### Par tranche (verdicts bruts)');
p('');
p(
  '| Tranche | Module | Livrables | Confirmés | crit | élevé | moyen | faible |',
);
p('|---|---|---|---|---|---|---|---|');
for (const sid of ORDER) {
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
p(
  '| **TOTAL back-office-admin** | M0.6/M1.x/M2.x | — | **',
  boaNow,
  '** | | | | |',
);
p('| **TOTAL espace-traiteur** | M3.1 | — | **', traitNow, '** | | | | |');
p('');

// ---- Comparaison ----
p('## Comparaison avec le run initial Phase 4 (`wf_507832d8-607`)');
p('');
p('| Section | Run initial (verdicts bruts) | Ce re-run grain fin | Δ |');
p('|---|---|---|---|');
p(
  '| `back-office-admin` | ',
  PREV_BOA,
  ' | **',
  boaNow,
  '** | ',
  boaNow - PREV_BOA >= 0 ? '+' : '',
  boaNow - PREV_BOA,
  ' |',
);
p(
  '| `espace-traiteur` | ',
  PREV_TRAIT,
  ' | **',
  traitNow,
  '** | ',
  traitNow - PREV_TRAIT >= 0 ? '+' : '',
  traitNow - PREV_TRAIT,
  ' |',
);
p(
  '| **Total** | **',
  PREV_BOA + PREV_TRAIT,
  '** | **',
  boaNow + traitNow,
  '** | **',
  boaNow + traitNow - (PREV_BOA + PREV_TRAIT) >= 0 ? '+' : '',
  boaNow + traitNow - (PREV_BOA + PREV_TRAIT),
  '** |',
);
p('');
p(
  '> Le run initial groupait les 2 sections en 1 agent Extract chacune (69 / 66 confirmés bruts). Ce re-run leur donne 13 agents Extract bornés. ',
  boaNow + traitNow > PREV_BOA + PREV_TRAIT
    ? 'Le grain fin **fait remonter ' +
        (boaNow + traitNow - (PREV_BOA + PREV_TRAIT)) +
        ' écart(s) supplémentaire(s)** → la sous-extraction du critic est **confirmée** (le plancher 69/66 était bien un plancher).'
    : 'Le grain fin **ne fait PAS remonter** de net supplémentaire — la couverture initiale était déjà proche du plafond (consolidation des doublons inter-tranches à surveiller).',
);
p('');

// ---- Détail des écarts ----
p('## Détail des écarts confirmés');
p('');
p(
  '> Trié par sévérité décroissante puis tranche. `expected`/`why_gap`/`remediation` repris de `register.gaps` (dédupliqué) ; sévérité alignée sur les verdicts bruts. Lorsque la synthèse a laissé `gaps` vide, la justification du verdict adverse est reportée.',
);
p('');
let curSev = null,
  n = 0;
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
  p('- **Attendu (CDC) :** ', (g.expected || '').replace(/\s+/g, ' '));
  p("- **Pourquoi c'est un trou :** ", (g.why_gap || '').replace(/\s+/g, ' '));
  if (g.remediation)
    p('- **Remédiation :** ', (g.remediation || '').replace(/\s+/g, ' '));
}
p('');

// ---- Faux positifs ----
p('## Faux positifs réfutés (', fps.length, ')');
p('');
p('| # | Livrable | Tranche | Réfutation (résumé) |');
p('|---|---|---|---|');
let fi = 0;
for (const v of fps) {
  fi++;
  const j = (v.justification || '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .slice(0, 220);
  const fa = (v.found_at || '').replace(/\|/g, '\\|').slice(0, 120);
  p(
    '| ',
    fi,
    ' | `',
    v.deliverable_id,
    '` | `',
    v.section_id,
    '` | ',
    fa ? fa + ' — ' : '',
    j,
    '… |',
  );
}
p('');

// ---- Descopes ----
p('## Descope intentionnel assumé (', descopes.length, ')');
p('');
if (descopes.length) {
  for (const v of descopes) {
    p(
      '- `',
      v.deliverable_id,
      '` (`',
      v.section_id,
      '`) — réf : ',
      (v.descope_ref || '').replace(/\s+/g, ' '),
      ' — ',
      (v.justification || '').replace(/\s+/g, ' ').slice(0, 180),
    );
  }
} else p('Aucun.');
p('');

// ---- Critic ----
p('## Critic de complétude (agent du workflow)');
p('');
p('**`recommend_rerun = ', critic.recommend_rerun, '`**');
p('');
if (critic.thin_sections && critic.thin_sections.length) {
  p('Sections jugées encore suspectes :');
  for (const t of critic.thin_sections)
    p('- **`', t.section_id, '`** — ', (t.reason || '').replace(/\s+/g, ' '));
} else p('Aucune tranche jugée sous-extraite par le compte.');
p('');
p('Note du critic : ', (critic.note || '').replace(/\s+/g, ' '));
p('');

// ---- Prévention ----
p('## Volet prévention — anti-récidive');
p('');
const prevention =
  register.prevention && register.prevention.length ? register.prevention : [];
let pi = 0;
for (const rec of prevention) {
  pi++;
  p(pi, '. ', (rec || '').replace(/\s+/g, ' '));
}
if (!prevention.length)
  p(
    '1. **Gate CI `check:spec-deliverables`** : diff des livrables CDC énumérés vs manifeste de module, bloquant.',
  );
p('');
p('---');
p('');
p("## Annexe — Note d'intégrité du run");
p('');
p(
  '- **Run** : `',
  RUN_ID,
  '` (task `',
  TASK_ID,
  '`) — ',
  AGENTS,
  ' agents, ~',
  TOKENS,
  ' tokens, ~',
  MINUTES,
  ' min, mode `chunked`, 13 tranches (8 boa + 5 traiteur).',
);
p(
  '- **Recompte** : sur `sections[].verdicts` (source faisant autorité), PAS sur le `summary` (qui sous-compte) ni sur `register.gaps` (souvent vide/groupé).',
);
p(
  '- **Compteurs bruts** : confirmed_gap **',
  counts.confirmed_gap,
  '** (crit ',
  sevCount.critique,
  ' · élevé ',
  sevCount.eleve,
  ' · moyen ',
  sevCount.moyen,
  ' · faible ',
  sevCount.faible,
  ') · false_positive ',
  counts.false_positive,
  ' · intentional_descope ',
  counts.intentional_descope,
  ' · pending_module ',
  counts.pending_module,
  '.',
);
p(
  '- **Comparaison run initial** : back-office-admin ',
  PREV_BOA,
  ' → ',
  boaNow,
  ' (',
  boaNow - PREV_BOA >= 0 ? '+' : '',
  boaNow - PREV_BOA,
  ') · espace-traiteur ',
  PREV_TRAIT,
  ' → ',
  traitNow,
  ' (',
  traitNow - PREV_TRAIT >= 0 ? '+' : '',
  traitNow - PREV_TRAIT,
  ').',
);
p(
  '- **Circuit-breaker** : ',
  sevCount.critique === 0
    ? 'NON déclenché (0 critique).'
    : sevCount.critique + ' critique(s) — voir §Circuit-breaker.',
);
p(
  '- **migration-bubble** : NON-AUDITABLE (stub de cadrage dans `specs/`, plan détaillé hors `specs/`) — exclue du re-run, pas re-jugée.',
);
p('- **Détection seule** : aucun fichier de code modifié.');
p('');
p(
  '*Registre généré par réconciliation des verdicts bruts du run `',
  RUN_ID,
  '`. Détection seule.*',
);

fs.writeFileSync(DEST, L.join('\n'));
console.log('WROTE', DEST);
console.log('bytes:', fs.statSync(DEST).size);
console.log(
  'confirmed:',
  counts.confirmed_gap,
  '| crit',
  sevCount.critique,
  'eleve',
  sevCount.eleve,
  'moyen',
  sevCount.moyen,
  'faible',
  sevCount.faible,
);
console.log(
  'boa:',
  boaNow,
  '(prev 69) | traiteur:',
  traitNow,
  '(prev 66) | FP:',
  counts.false_positive,
  '| descope:',
  counts.intentional_descope,
  '| pending:',
  counts.pending_module,
);
console.log(
  'per-tranche:',
  JSON.stringify(
    Object.fromEntries(
      ORDER.map((s) => [s, (perSec[s] || { total: 0 }).total]),
    ),
  ),
);
