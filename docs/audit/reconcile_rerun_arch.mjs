import fs from 'node:fs';

const OUT =
  '/private/tmp/claude-501/-Users-valentinleblan-Code-savr-platform/c1f4332b-d2e1-4b75-9dac-4aba6a31e657/tasks/w2fbrf2wy.output';
const raw = fs.readFileSync(OUT, 'utf8');

// The output file is the tool result. It may be wrapped or be raw JSON. Try to locate the JSON object.
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  // Find first { and last } and try
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  data = JSON.parse(raw.slice(start, end + 1));
}

const result = data.result
  ? typeof data.result === 'string'
    ? JSON.parse(data.result)
    : data.result
  : data;
const { register, critic, sections } = result;

console.log('=== TOP-LEVEL KEYS ===');
console.log(Object.keys(result));

// ---- Ground truth from sections[].verdicts ----
const verdictCounts = {};
const bySectionVerdict = {};
const allVerdicts = [];
for (const s of sections || []) {
  bySectionVerdict[s.section_id] = {};
  for (const v of s.verdicts || []) {
    verdictCounts[v.verdict] = (verdictCounts[v.verdict] || 0) + 1;
    bySectionVerdict[s.section_id][v.verdict] =
      (bySectionVerdict[s.section_id][v.verdict] || 0) + 1;
    allVerdicts.push({ section_id: s.section_id, ...v });
  }
}

console.log('\n=== GROUND TRUTH: verdict counts (sections[].verdicts) ===');
console.log(JSON.stringify(verdictCounts, null, 2));

console.log('\n=== Per-section verdict breakdown ===');
for (const sid of Object.keys(bySectionVerdict)) {
  console.log(sid, JSON.stringify(bySectionVerdict[sid]));
}

// ---- confirmed_gap detail with severity, deduped by deliverable_id ----
const confirmed = allVerdicts.filter((v) => v.verdict === 'confirmed_gap');
const seen = new Set();
const confirmedDedup = [];
const dupes = [];
for (const v of confirmed) {
  if (seen.has(v.deliverable_id)) {
    dupes.push(v.deliverable_id);
    continue;
  }
  seen.add(v.deliverable_id);
  confirmedDedup.push(v);
}

console.log(
  '\n=== confirmed_gap (raw): ' +
    confirmed.length +
    ' | deduped: ' +
    confirmedDedup.length +
    ' ===',
);
if (dupes.length)
  console.log('DUPLICATE deliverable_ids among confirmed verdicts:', dupes);

const sevCount = { critique: 0, eleve: 0, moyen: 0, faible: 0 };
for (const v of confirmedDedup)
  sevCount[v.severity] = (sevCount[v.severity] || 0) + 1;
console.log('Severity (deduped confirmed):', JSON.stringify(sevCount));

// per section severity
console.log('\n=== confirmed_gap per section x severity (deduped) ===');
const perSecSev = {};
for (const v of confirmedDedup) {
  perSecSev[v.section_id] = perSecSev[v.section_id] || {};
  perSecSev[v.section_id][v.severity] =
    (perSecSev[v.section_id][v.severity] || 0) + 1;
}
for (const sid of Object.keys(perSecSev))
  console.log(sid, JSON.stringify(perSecSev[sid]));

// ---- register.summary vs ground truth ----
console.log('\n=== register.summary (UNRELIABLE per task) ===');
console.log(JSON.stringify(register?.summary, null, 2));

// ---- register.gaps deduped ----
const gaps = register?.gaps || [];
const gseen = new Set();
const gapsDedup = [];
const gdupes = [];
for (const g of gaps) {
  if (gseen.has(g.deliverable_id)) {
    gdupes.push(g.deliverable_id);
    continue;
  }
  gseen.add(g.deliverable_id);
  gapsDedup.push(g);
}
console.log(
  '\n=== register.gaps raw: ' +
    gaps.length +
    ' | deduped: ' +
    gapsDedup.length +
    ' ===',
);
if (gdupes.length) console.log('DUP register.gaps:', gdupes);
const gsev = {};
for (const g of gapsDedup) gsev[g.severity] = (gsev[g.severity] || 0) + 1;
console.log('register.gaps deduped severity:', JSON.stringify(gsev));

// ---- Cross-check: confirmed verdicts present in register.gaps? ----
const gapIds = new Set(gapsDedup.map((g) => g.deliverable_id));
const confirmedIds = new Set(confirmedDedup.map((v) => v.deliverable_id));
const inVerdictNotInGaps = [...confirmedIds].filter((id) => !gapIds.has(id));
const inGapsNotInVerdict = [...gapIds].filter((id) => !confirmedIds.has(id));
console.log('\n=== Cross-check confirmed verdicts vs register.gaps ===');
console.log('confirmed verdict IDs NOT in register.gaps:', inVerdictNotInGaps);
console.log('register.gaps IDs NOT in confirmed verdicts:', inGapsNotInVerdict);

// ---- Known criticals present? ----
const knownCrit = [
  'mc-rpc-set-n-for-update',
  'mc-collecte-flux-derivee-recalcul',
];
console.log('\n=== Known criticals re-confirm ===');
for (const k of knownCrit) {
  const v = confirmedDedup.find(
    (x) => x.deliverable_id === k || x.deliverable_id.includes(k),
  );
  const anyV = allVerdicts.find(
    (x) => x.deliverable_id === k || x.deliverable_id.includes(k),
  );
  console.log(
    k,
    '=>',
    v
      ? `confirmed_gap (${v.severity})`
      : anyV
        ? `present as ${anyV.verdict} (${anyV.severity || '-'})`
        : 'NOT FOUND in verdicts',
  );
}

// ---- Dump critical + eleve confirmed for the register ----
console.log('\n=== CRITICAL + ELEVE confirmed (deduped) — full detail ===');
const sevOrder = { critique: 0, eleve: 1, moyen: 2, faible: 3 };
const sorted = [...confirmedDedup].sort(
  (a, b) =>
    sevOrder[a.severity] - sevOrder[b.severity] ||
    a.section_id.localeCompare(b.section_id),
);
for (const v of sorted.filter(
  (x) => x.severity === 'critique' || x.severity === 'eleve',
)) {
  console.log(`\n--- [${v.severity}] ${v.deliverable_id} (${v.section_id})`);
  console.log('justification:', v.justification);
  if (v.found_at) console.log('found_at:', v.found_at);
  if (v.descope_ref) console.log('descope_ref:', v.descope_ref);
}

// Save deduped data for the register builder
fs.writeFileSync(
  '/Users/valentinleblan/Code/savr-platform/docs/audit/_rerun_arch_reconciled.json',
  JSON.stringify(
    {
      verdictCounts,
      bySectionVerdict,
      confirmedDedup,
      sevCount,
      perSecSev,
      gapsDedup,
      registerSummary: register?.summary,
      critic,
      totalDeliverables: (sections || []).reduce(
        (n, s) => n + (s.deliverables_count || 0),
        0,
      ),
      statusCountsPerSection: (sections || []).map((s) => ({
        section_id: s.section_id,
        deliverables_count: s.deliverables_count,
        status_counts: s.status_counts,
      })),
    },
    null,
    2,
  ),
);
console.log('\n=== wrote _rerun_arch_reconciled.json ===');
