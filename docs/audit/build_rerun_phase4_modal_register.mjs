import fs from 'node:fs';

// 3e passage Phase 4 — grain modal sur boa-parametres-algo + boa-dashboard-admin (8 sous-tranches).
// Recompte depuis sections[].verdicts (la synthèse peut re-planter au plafond 64k — non bloquant).
// Sortie de la REPRISE (resume) wsetxpzkk — output complet (146 agents cachés + 6 re-run : 4 co2 verify + critic + synth).
const OUT =
  process.env.OUT ||
  '/private/tmp/claude-501/-Users-valentinleblan-Code-savr-platform/968f030a-8567-4363-9984-8f463884c03f/tasks/wsetxpzkk.output';
const DEST =
  '/Users/valentinleblan/Desktop/Obsidian Savr/30. Review Code/Livrable Audit/gap-register-phase4-rerun-boa-modal-2026-06-23.md';
const RUN_ID = 'wf_001a35c7-957';
const TASK_ID = 'wlx7713vc';
const DATE = '2026-06-23';
const AGENTS = process.env.AGENTS || '?';
const TOKENS = process.env.TOKENS || '?';
const MINUTES = process.env.MINUTES || '?';

const raw = fs.readFileSync(OUT, 'utf8');
const data = JSON.parse(raw);
const result = data.result
  ? typeof data.result === 'string'
    ? JSON.parse(data.result)
    : data.result
  : data;
const register = result.register || { summary: {}, gaps: [], prevention: [] };
const critic = result.critic || {
  thin_sections: [],
  recommend_rerun: null,
  note: '',
};
const sections = result.sections || [];

const allVerdicts = [];
for (const s of sections)
  for (const v of s.verdicts || [])
    allVerdicts.push({ section_id: s.section_id, ...v });
const vSeverity = {};
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

const gseen = new Set();
const gaps = [];
for (const g of register.gaps || []) {
  if (gseen.has(g.deliverable_id)) continue;
  gseen.add(g.deliverable_id);
  gaps.push({ ...g, severity: vSeverity[g.deliverable_id] || g.severity });
}
if (gaps.length === 0) {
  for (const v of confirmed)
    gaps.push({
      deliverable_id: v.deliverable_id,
      section_id: v.section_id,
      type: '?',
      severity: v.severity,
      expected: '(voir CDC)',
      why_gap: v.justification || '',
      remediation: '',
    });
}
gaps.sort(
  (a, b) =>
    sevOrder[a.severity] - sevOrder[b.severity] ||
    String(a.section_id).localeCompare(String(b.section_id)),
);

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
const totalDeliverables = sections.reduce(
  (n, s) => n + (s.deliverables_count || 0),
  0,
);
const statusAgg = {};
for (const s of sections)
  for (const k of Object.keys(s.status_counts || {}))
    statusAgg[k] = (statusAgg[k] || 0) + s.status_counts[k];

const PARAM = [
  'param-tarifs-zd-ag',
  'param-grilles-remises',
  'param-co2-4-ecrans',
  'param-seuils-taux-recyclage',
  'param-algo-ag-autoaccept',
  'param-refs-integrations-config',
];
const DASH = ['dash-admin-bloc1-cartes', 'dash-admin-bloc2-revenus'];
const ORDER = [...PARAM, ...DASH];
const secTitle = {
  'param-tarifs-zd-ag':
    'Tarifs ZD + AG publics (grille, historique versions, non-rétroactif)',
  'param-grilles-remises':
    'Grilles tarifaires ZD + Remises négociées (modales, cumul)',
  'param-co2-4-ecrans':
    '4 écrans CO2 (facteurs flux, mix emballages 100%, divers, AG)',
  'param-seuils-taux-recyclage':
    'Seuils pesées + Taux de recyclage (modale 4 champs, idempotence, no-delete)',
  'param-algo-ag-autoaccept':
    'Algo AG (seuils/pondérations) + config auto-accept',
  'param-refs-integrations-config':
    'Templates + Référentiels + Intégrations + Config générale',
  'dash-admin-bloc1-cartes':
    'Dashboard Bloc 1 — 5 cartes KPI (source SQL + redirect + enum)',
  'dash-admin-bloc2-revenus':
    'Dashboard Bloc 2 — histogramme + tableau revenus 6 col + CSV/tri/pagination',
};
const secModule = Object.fromEntries(
  ORDER.map((s) => [s, 'M0.6 / M1.x / M2.x']),
);
secModule['param-co2-4-ecrans'] = 'M0.6 / M2.4 / M4.3';
secModule['param-algo-ag-autoaccept'] = 'M0.6 / M2.3';

// baseline = run grain-fin wf_efb0148d-ba6 : boa-parametres-algo 36, boa-dashboard-admin 18
const PREV_PARAM = 36,
  PREV_DASH = 18;
const paramNow = PARAM.reduce(
  (n, s) => n + (perSec[s] || { total: 0 }).total,
  0,
);
const dashNow = DASH.reduce((n, s) => n + (perSec[s] || { total: 0 }).total, 0);

const L = [];
const p = (...x) => L.push(x.join(''));

p('---');
p(
  'tags: [audit, conformite, cdc, livrable, surface-lecture, rerun, grain-modal]',
);
p('statut: fait');
p('cree: ', DATE);
p(
  'phase: 4 — 3e passage GRAIN MODAL (boa-parametres-algo + boa-dashboard-admin)',
);
p('run_id: ', RUN_ID);
p('---');
p('');
p(
  "# Registre d'écarts — Phase 4 · 3e passage GRAIN MODAL (paramètres algo + dashboard Admin)",
);
p('');
p(
  '> **3e passage ciblé de la Phase 4** (complétude totale demandée par Val). Re-run des **2 SEULES tranches** que le critic du re-run grain-fin (`wf_efb0148d-ba6`) flaguait encore comme sous-extraites : `boa-parametres-algo` (densité 3,72) + `boa-dashboard-admin` (3,28, plus bas outlier). ',
);
p(
  '> Levier : **re-découpage en 8 sous-écrans** (6 paramètres + 2 blocs dashboard), 1 agent Extract par sous-écran, à grain **MODALE / CHAMP / VALIDATION-422 / PERMISSION admin-vs-ops / TRIGGER-AUDIT / COHÉRENCE COLONNE-DB**. `evidence_rule` **durci** (contrôle câblé atteignable exigé, pas la signature) + **verify per_finding** (1 sceptique adverse par écart). ',
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
  ' min. Source de vérité = `specs/cdc/`. **Détection seule, aucun code corrigé.**',
);
p('');

p('## 🚨 Circuit-breaker');
p('');
if (sevCount.critique === 0) {
  p(
    '**RAS — 0 gap `critique` confirmé** au grain modal sur ces 2 tranches. 0 fuite inter-organisation.',
  );
} else {
  p(
    '**',
    sevCount.critique,
    ' gap(s) `critique`** — 0 fuite inter-organisation attendue (paramétrage admin) ; vérifier les échecs silencieux (colonne-DB inexistante, KPI enum, validation absente) :',
  );
  for (const g of gaps.filter((x) => x.severity === 'critique'))
    p(
      '- 🚨 `',
      g.deliverable_id,
      '` (`',
      g.section_id,
      '`) — ',
      (g.why_gap || '').replace(/\s+/g, ' ').slice(0, 220),
    );
}
p('');

p('## Réconciliation (verdicts bruts vs synthèse)');
p('');
if (!result.register)
  p(
    '⚠️ **Synthèse plantée** (`register:null`, plafond 64k tokens de sortie) — registre reconstruit depuis `sections[].verdicts`.',
  );
else
  p(
    'Synthèse présente mais `summary`/`gaps` sous-comptent — **vérité terrain = `sections[].verdicts`**.',
  );
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
  '.** FP ',
  counts.false_positive,
  ' · descope ',
  counts.intentional_descope,
  ' · pending ',
  counts.pending_module,
  '.',
);
p('');

p('## Synthèse chiffrée');
p('');
p('| Métrique | Valeur |');
p('|---|---|');
p(
  '| Livrables extraits (grain modal, 8 sous-tranches) | ',
  totalDeliverables,
  ' |',
);
p('| Implémentés | ', statusAgg.implemented || 0, ' |');
p('| Partiels | ', statusAgg.partial || 0, ' |');
p('| Manquants | ', statusAgg.missing || 0, ' |');
p('| Indéterminés | ', statusAgg.indeterminate || 0, ' |');
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
p('### Par sous-tranche (verdicts bruts)');
p('');
p(
  '| Sous-tranche | Sous-écran | Livrables | Confirmés | crit | élevé | moyen | faible |',
);
p('|---|---|---|---|---|---|---|---|');
for (const sid of ORDER) {
  const s = sections.find((x) => x.section_id === sid);
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
    secTitle[sid],
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
  '| **TOTAL paramètres** | (6 sous-écrans) | — | **',
  paramNow,
  '** | | | | |',
);
p('| **TOTAL dashboard** | (2 blocs) | — | **', dashNow, '** | | | | |');
p('');

p('## Comparaison avec le re-run grain-fin (`wf_efb0148d-ba6`)');
p('');
p(
  '| Tranche | Re-run grain-fin (1 agent Extract) | 3e passage grain modal | Δ |',
);
p('|---|---|---|---|');
p(
  '| `boa-parametres-algo` | ',
  PREV_PARAM,
  ' | **',
  paramNow,
  '** | ',
  paramNow - PREV_PARAM >= 0 ? '+' : '',
  paramNow - PREV_PARAM,
  ' |',
);
p(
  '| `boa-dashboard-admin` | ',
  PREV_DASH,
  ' | **',
  dashNow,
  '** | ',
  dashNow - PREV_DASH >= 0 ? '+' : '',
  dashNow - PREV_DASH,
  ' |',
);
p(
  '| **Total** | **',
  PREV_PARAM + PREV_DASH,
  '** | **',
  paramNow + dashNow,
  '** | **',
  paramNow + dashNow - (PREV_PARAM + PREV_DASH) >= 0 ? '+' : '',
  paramNow + dashNow - (PREV_PARAM + PREV_DASH),
  '** |',
);
p('');
p(
  '> ',
  paramNow + dashNow > PREV_PARAM + PREV_DASH
    ? 'Le grain modal **fait remonter ' +
        (paramNow + dashNow - (PREV_PARAM + PREV_DASH)) +
        ' écart(s) de plus** que le re-run grain-fin → la sous-extraction signalée par le critic est **confirmée** : le détail modal/validation/permission/audit avait bien été collapsé.'
    : 'Le grain modal **ne fait pas remonter** de net supplémentaire — la couverture grain-fin était déjà au plafond sur ces 2 tranches (critic infirmé).',
);
p('');

p('## Détail des écarts confirmés');
p('');
p(
  '> Trié par sévérité puis sous-tranche. Reconstruit depuis les verdicts adverses bruts (justification = `why_gap`).',
);
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
    '- **Sous-tranche :** `',
    g.section_id,
    '` · ',
    secModule[g.section_id] || '',
    '  |  **type :** ',
    g.type || '?',
  );
  if (g.expected && g.expected !== '(voir CDC)')
    p('- **Attendu (CDC) :** ', (g.expected || '').replace(/\s+/g, ' '));
  p("- **Pourquoi c'est un trou :** ", (g.why_gap || '').replace(/\s+/g, ' '));
  if (g.remediation)
    p('- **Remédiation :** ', (g.remediation || '').replace(/\s+/g, ' '));
}
p('');

p('## Faux positifs réfutés (', fps.length, ')');
p('');
p('| # | Livrable | Sous-tranche | Réfutation (résumé) |');
p('|---|---|---|---|');
let fi = 0;
for (const v of fps) {
  fi++;
  const j = (v.justification || '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .slice(0, 220);
  const fa = (v.found_at || '').replace(/\|/g, '\\|').slice(0, 110);
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

p('## Descope intentionnel assumé (', descopes.length, ')');
p('');
if (descopes.length)
  for (const v of descopes)
    p(
      '- `',
      v.deliverable_id,
      '` (`',
      v.section_id,
      '`) — ',
      (v.descope_ref || '').replace(/\s+/g, ' '),
      ' — ',
      (v.justification || '').replace(/\s+/g, ' ').slice(0, 160),
    );
else p('Aucun.');
p('');

p('## Critic de complétude');
p('');
p('**`recommend_rerun = ', critic.recommend_rerun, '`**');
p('');
if (critic.thin_sections && critic.thin_sections.length) {
  p('Sous-tranches encore suspectes :');
  for (const t of critic.thin_sections)
    p('- **`', t.section_id, '`** — ', (t.reason || '').replace(/\s+/g, ' '));
} else
  p(
    'Aucune sous-tranche jugée sous-extraite — **couverture grain modal jugée suffisante**.',
  );
p('');
p('Note du critic : ', (critic.note || '').replace(/\s+/g, ' '));
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
  ' min, verify `per_finding`, 8 sous-tranches (6 paramètres + 2 dashboard).',
);
p(
  '- **Recompte** : sur `sections[].verdicts` (autorité). ',
  result.register
    ? 'Synthèse présente.'
    : 'Synthèse PLANTÉE (`register:null`, plafond 64k) → reconstruit depuis les verdicts bruts.',
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
  ') · FP ',
  counts.false_positive,
  ' · descope ',
  counts.intentional_descope,
  ' · pending ',
  counts.pending_module,
  '.',
);
p(
  '- **Comparaison grain-fin** : boa-parametres-algo ',
  PREV_PARAM,
  ' → ',
  paramNow,
  ' · boa-dashboard-admin ',
  PREV_DASH,
  ' → ',
  dashNow,
  '.',
);
p(
  '- **Circuit-breaker** : ',
  sevCount.critique === 0
    ? 'NON déclenché (0 critique).'
    : sevCount.critique +
        ' critique(s) — voir §Circuit-breaker (0 fuite inter-orga attendue).',
);
p('- **Détection seule** : aucun fichier de code modifié.');
p('');
p(
  '*Registre généré par réconciliation des verdicts bruts du run `',
  RUN_ID,
  '`. Détection seule.*',
);

fs.writeFileSync(DEST, L.join('\n'));
console.log('WROTE', DEST, '|', fs.statSync(DEST).size, 'bytes');
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
  'param:',
  paramNow,
  '(prev 36) | dash:',
  dashNow,
  '(prev 18) | FP:',
  counts.false_positive,
  '| descope:',
  counts.intentional_descope,
);
console.log(
  'per-tranche:',
  JSON.stringify(
    Object.fromEntries(
      ORDER.map((s) => [s, (perSec[s] || { total: 0 }).total]),
    ),
  ),
);
console.log('register:', result.register ? 'present' : 'NULL (synth crashed)');
