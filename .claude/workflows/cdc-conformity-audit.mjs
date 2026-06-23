export const meta = {
  name: 'cdc-conformity-audit',
  description:
    "Audit exhaustif CDC -> code. Extrait les livrables atomiques de chaque section CDC (source de vérité), cherche la preuve d'implémentation câblée dans le code, vérifie chaque écart en adversarial (faux positif ? descope documenté ? module pending ?), et produit un registre d'écarts trié par sévérité + un volet anti-récidive.",
  phases: [
    {
      title: 'Extract',
      detail: 'Extraire les livrables atomiques de chaque section CDC',
    },
    {
      title: 'Evidence',
      detail: "Chercher la preuve d'implémentation câblée dans le code",
    },
    {
      title: 'Verify',
      detail: 'Vérification adverse de chaque écart Missing/Partial',
    },
    {
      title: 'Synthesize',
      detail:
        "Registre d'écarts trié + volet anti-récidive + critique de complétude",
    },
  ],
};

// ---------------------------------------------------------------------------
// Entrée : args = contenu de docs/audit/AUDIT_SCOPE.json (objet { options, sections }).
// Le workflow ne lit AUCUN fichier lui-même (pas de fs en script) : ce sont les
// sous-agents qui lisent le CDC et le code via Read/Grep/Glob.
// ---------------------------------------------------------------------------

// args peut arriver comme objet déjà parsé OU comme chaîne JSON, selon l'appelant.
let scope = args;
if (typeof scope === 'string') {
  try {
    scope = JSON.parse(scope);
  } catch (e) {
    scope = {};
  }
}
scope = scope && typeof scope === 'object' ? scope : {};
const OPTIONS = scope.options || {};
const SECTIONS = Array.isArray(scope.sections) ? scope.sections : null;

if (!SECTIONS || SECTIONS.length === 0) {
  throw new Error(
    'args.sections manquant. Lire docs/audit/AUDIT_SCOPE.json puis relancer : ' +
      'Workflow({ scriptPath: ".claude/workflows/cdc-conformity-audit.mjs", args: <JSON parsé> }). ' +
      "Pour un pilote, ne passer qu'un sous-ensemble de sections.",
  );
}

const repoRoot = OPTIONS.repo_root || '(racine repo)';
const cdcRoot = OPTIONS.cdc_root || 'specs/cdc/01 - Cahier des charges App';
const divDir = OPTIONS.divergences_dir || '(dossier _Divergences)';
const latentPatterns = (OPTIONS.high_value_latent_patterns || [])
  .map((p, i) => `  ${i + 1}. ${p}`)
  .join('\n');
const evidenceRule =
  OPTIONS.evidence_rule ||
  "Preuve = élément câblé et atteignable à l'exécution, pas seulement un fichier qui existe. Citer file:line.";

// ---------------------------------------------------------------------------
// Schémas de sortie structurée (validés au niveau tool-call : pas de parsing).
// ---------------------------------------------------------------------------

const DELIVERABLE_TYPES = [
  'bloc_ui',
  'kpi',
  'filtre',
  'regle_si_alors',
  'email_template',
  'colonne',
  'table',
  'vue',
  'enum',
  'endpoint',
  'rls_policy',
  'cron',
  'pdf_doc',
  'alerte',
  'composant_ui',
  'etat',
  'integration',
  'autre',
];

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['section_id', 'deliverables'],
  properties: {
    section_id: { type: 'string' },
    deliverables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'type',
          'expected',
          'cdc_ref',
          'automatable',
          'criticality',
        ],
        properties: {
          id: {
            type: 'string',
            description: 'slug stable unique, ex: dash-traiteur-bloc2-barres',
          },
          type: { type: 'string', enum: DELIVERABLE_TYPES },
          expected: {
            type: 'string',
            description: 'comportement attendu en 1-2 phrases',
          },
          cdc_ref: { type: 'string', description: 'fichier + § ou ligne' },
          automatable: {
            type: 'boolean',
            description: 'testable automatiquement ?',
          },
          criticality: {
            type: 'string',
            enum: ['critique', 'eleve', 'moyen', 'faible'],
          },
        },
      },
    },
  },
};

const EVIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['section_id', 'findings'],
  properties: {
    section_id: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['deliverable_id', 'status', 'evidence', 'note'],
        properties: {
          deliverable_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['implemented', 'partial', 'missing', 'indeterminate'],
          },
          evidence: {
            type: 'array',
            items: { type: 'string' },
            description: "file:line ou justification d'absence",
          },
          note: { type: 'string' },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['deliverable_id', 'verdict', 'severity', 'justification'],
  properties: {
    deliverable_id: { type: 'string' },
    verdict: {
      type: 'string',
      enum: [
        'confirmed_gap',
        'false_positive',
        'intentional_descope',
        'pending_module',
      ],
    },
    found_at: {
      type: 'string',
      description:
        'si false_positive : où le livrable est réellement implémenté',
    },
    descope_ref: {
      type: 'string',
      description:
        'si intentional_descope : marqueur CDC ou fichier _Divergences',
    },
    severity: {
      type: 'string',
      enum: ['critique', 'eleve', 'moyen', 'faible'],
    },
    justification: { type: 'string' },
  },
};

const VERDICT_BATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: { type: 'array', items: VERDICT_SCHEMA },
  },
};

const REGISTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'gaps', 'prevention'],
  properties: {
    summary: {
      type: 'object',
      additionalProperties: true,
      required: [
        'total_deliverables',
        'implemented',
        'partial',
        'confirmed_gaps',
      ],
      properties: {
        total_deliverables: { type: 'number' },
        implemented: { type: 'number' },
        partial: { type: 'number' },
        confirmed_gaps: { type: 'number' },
        false_positives: { type: 'number' },
        intentional_descopes: { type: 'number' },
        pending: { type: 'number' },
      },
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'deliverable_id',
          'section_id',
          'type',
          'severity',
          'expected',
          'why_gap',
          'remediation',
        ],
        properties: {
          deliverable_id: { type: 'string' },
          section_id: { type: 'string' },
          module: { type: 'string' },
          type: { type: 'string' },
          severity: {
            type: 'string',
            enum: ['critique', 'eleve', 'moyen', 'faible'],
          },
          expected: { type: 'string' },
          why_gap: { type: 'string' },
          remediation: {
            type: 'string',
            description: 'fix manifeste + scénario + note implémentation',
          },
        },
      },
    },
    prevention: { type: 'array', items: { type: 'string' } },
    markdown: {
      type: 'string',
      description:
        'registre complet formaté en Markdown, prêt à écrire sur disque',
    },
  },
};

const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thin_sections', 'recommend_rerun'],
  properties: {
    thin_sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_id', 'reason'],
        properties: {
          section_id: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    recommend_rerun: { type: 'boolean' },
    note: { type: 'string' },
  },
};

// ---------------------------------------------------------------------------
// Prompts.
// ---------------------------------------------------------------------------

function sectionHeader(s) {
  return [
    `Section CDC : ${s.id} — ${s.title}`,
    `Statut de livraison : ${s.delivery_status} (delivered=manquant => GAP ; partial=distinguer gap vs sous-lot ; pending=manquant => attendu, PAS un gap).`,
    `Criticité de section : ${s.criticality}.`,
    `Fichiers CDC canoniques (source de vérité, sous "${cdcRoot}/") :\n${(s.canonical_files || []).map((f) => `  - ${cdcRoot}/${f}`).join('\n')}`,
    `Racines de code où chercher la preuve :\n${(s.code_roots || []).map((r) => `  - ${r}`).join('\n')}`,
    `Racines de tests :\n${(s.test_roots || []).map((r) => `  - ${r}`).join('\n')}`,
    s.notes ? `Notes de scope : ${s.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractPrompt(s) {
  return `Tu audites le CDC de la plateforme Savr. Repo : ${repoRoot}.

${sectionHeader(s)}

TÂCHE : lis INTÉGRALEMENT le(s) fichier(s) CDC canonique(s) ci-dessus (outil Read), puis extrais TOUS les livrables atomiques et vérifiables que la spec impose. Un livrable = une chose précise qui doit exister dans le produit : un bloc d'UI, un KPI, un filtre, une règle métier SI/ALORS (chaque branche compte), un template email, une table/colonne/vue/enum, un endpoint, une policy RLS, un job cron, un document PDF, une alerte, un composant UI, un état de machine à états, une intégration.

RÈGLES D'EXTRACTION :
- Granularité fine : "dashboard traiteur" n'est PAS un livrable ; "dashboard traiteur Bloc 2 = histogramme barres empilées 5 flux" en est un.
- Pour une règle SI/ALORS, crée un livrable par branche significative (le SI ET le SINON).
- Inclure les livrables non automatisables (rendu visuel, contenu éditorial) : ils sont justement la classe d'écart la plus négligée. Marque-les automatable=false.
- Ne PAS inventer : un livrable doit être explicitement adossé à une phrase du CDC (renseigne cdc_ref avec fichier + § ou n° de ligne).
- Ignore les éléments marqués dans le CDC comme hors V1 / V1.1 / V2 / DESCOPÉ : ne les extrais pas (ou marque-les clairement dans expected).

Renvoie l'objet structuré { section_id: "${s.id}", deliverables: [...] }. Sois exhaustif : il vaut mieux trop de livrables que pas assez.`;
}

function evidencePrompt(s, extracted) {
  const list = (
    extracted && extracted.deliverables ? extracted.deliverables : []
  )
    .map(
      (d) =>
        `  - [${d.id}] (${d.type}, ${d.criticality}) ${d.expected}  {ref: ${d.cdc_ref}}`,
    )
    .join('\n');
  return `Tu vérifies l'implémentation réelle dans le code Savr. Repo : ${repoRoot}.

${sectionHeader(s)}

LIVRABLES À VÉRIFIER (extraits du CDC) :
${list || '  (aucun)'}

RÈGLE DE PREUVE : ${evidenceRule}

PATTERNS DE BUGS LATENTS À TRAQUER ACTIVEMENT (haute valeur) :
${latentPatterns || '  (aucun)'}

TÂCHE : pour CHAQUE livrable, cherche la preuve d'implémentation dans les racines de code/tests (Grep/Glob/Read). Classe :
- implemented : présent ET câblé/atteignable + (si applicable) testé. Cite file:line.
- partial : défini mais pas câblé (ex. composant jamais monté), ou une seule branche d'une règle, ou sans test exerçant le vrai chemin. Explique ce qui manque.
- missing : aucune trace d'implémentation. Justifie où tu as cherché.
- indeterminate : ne peux pas trancher sans contexte ; explique pourquoi.

Pour les vues SECURITY INVOKER et les policies RLS, vérifie SYSTÉMATIQUEMENT la policy backing + un test pgTAP sous le rôle réel (leçon du bug v_factures_client). Pour les templates email, vérifie le seed. Pour un composant UI, vérifie qu'il est importé/monté dans une page rendue, pas seulement défini.

Renvoie { section_id: "${s.id}", findings: [...] } avec un finding par livrable.`;
}

function verifyPrompt(s, finding, deliverable) {
  return `Tu es un sceptique adverse. Repo : ${repoRoot}. Ta mission : RÉFUTER l'écart suivant. Par défaut, méfie-toi du faux positif.

Section : ${s.id} — ${s.title}  (statut livraison : ${s.delivery_status})
Livrable : [${finding.deliverable_id}] ${deliverable.expected || ''}
Type : ${deliverable.type || '?'} | Criticité : ${deliverable.criticality || s.criticality}
Réf CDC : ${deliverable.cdc_ref || '?'}
Statut trouvé par l'agent preuve : ${finding.status}
Preuve/justification fournie : ${(finding.evidence || []).join(' | ')}
Note : ${finding.note || ''}

VÉRIFICATIONS OBLIGATOIRES avant de conclure :
1. FAUX POSITIF ? Le livrable existe-t-il sous un autre nom / dans un autre fichier / via une abstraction ? Cherche les synonymes FR/EN, les noms de colonnes/routes/composants proches (Grep/Glob/Read). Si trouvé câblé => verdict false_positive + found_at (file:line).
2. DESCOPE DOCUMENTÉ ? Cherche un marqueur de descope : (a) INLINE dans le CDC (DESCOPÉ, V1.1, V2, "hors scope V1", "reporté", "différé") ; (b) dans les fichiers de "${divDir}" (traités + ouverts). Si le manque est un descope assumé => verdict intentional_descope + descope_ref.
3. MODULE PENDING ? Si le statut de livraison de la section est "pending" (module non construit), un manque attendu => verdict pending_module.
4. Sinon, et seulement si tu ne peux NI le trouver NI le justifier comme descopé/pending => verdict confirmed_gap. Attribue une severity en pensant à l'impact réel : critique = sécurité/conformité/cloisonnement/perte de donnée silencieuse ; eleve = règle métier ou facturation ; moyen = donnée/UX ; faible = cosmétique/UI visible.

Renvoie le verdict structuré.`;
}

function verifyBatchPrompt(s, findings, byId) {
  const items = findings
    .map((f) => {
      const d = byId[f.deliverable_id] || {};
      return `--- Écart [${f.deliverable_id}]
  Attendu : ${d.expected || '?'}
  Type : ${d.type || '?'} | Criticité : ${d.criticality || s.criticality} | Réf CDC : ${d.cdc_ref || '?'}
  Statut trouvé : ${f.status}
  Preuve/justif : ${(f.evidence || []).join(' | ')}
  Note : ${f.note || ''}`;
    })
    .join('\n');
  return `Tu es un sceptique adverse. Repo : ${repoRoot}. Pour CHAQUE écart ci-dessous, ta mission est de le RÉFUTER. Par défaut, méfie-toi du faux positif.

Section : ${s.id} — ${s.title}  (statut livraison : ${s.delivery_status})
Dossier divergences : "${divDir}"

ÉCARTS À VÉRIFIER (${findings.length}) :
${items}

Pour CHAQUE écart, applique ces vérifications avant de conclure (cherche réellement dans le code/CDC/divergences avec Grep/Glob/Read) :
1. FAUX POSITIF ? Existe sous un autre nom / fichier / abstraction (synonymes FR/EN, colonnes/routes/composants proches) ? Si trouvé câblé => false_positive + found_at (file:line).
2. DESCOPE DOCUMENTÉ ? Marqueur INLINE dans le CDC (DESCOPÉ, V1.1, V2, "hors scope V1", "reporté") OU fichier dans "${divDir}". Si oui => intentional_descope + descope_ref.
3. MODULE PENDING ? Statut section "pending" + manque attendu => pending_module.
4. Sinon, irréfutable => confirmed_gap + severity (critique = sécurité/conformité/cloisonnement/perte silencieuse de donnée ; eleve = règle métier/facturation ou affichage systématiquement faux ; moyen = donnée/UX ; faible = cosmétique).

Renvoie { verdicts: [...] } avec EXACTEMENT un verdict par écart, dans l'ordre.`;
}

function synthPrompt(payloadJson) {
  return `Tu es l'agent de synthèse de l'audit de conformité CDC->code Savr.

Voici les données agrégées de toutes les sections (extraction + preuve + verdicts adverses), en JSON :

${payloadJson}

TÂCHE :
1. Calcule le summary (total_deliverables, implemented, partial, confirmed_gaps, false_positives, intentional_descopes, pending) en agrégeant toutes les sections.
2. Construis la liste 'gaps' = uniquement les verdicts confirmed_gap. Pour chacun : module concerné, type, severity (reprends celle du verdict), expected, why_gap (pourquoi c'est un vrai trou), remediation = action concrète en 3 temps (corriger le manifeste du module + ajouter le(s) scénario(s) Gherkin + note d'implémentation).
3. TRIE les gaps par sévérité décroissante (critique -> faible), puis par module.
4. Rédige 'prevention' : 3 à 6 recommandations structurelles anti-récidive, ancrées sur la cause racine (la transcription CDC->manifeste est à perte ; les gates mesurent code vs manifeste, jamais code vs CDC). Inclure : gate CI check:spec-deliverables (diff livrables CDC énumérés vs manifeste), manifestes au grain livrable, mandat reviewer conformité étendu aux livrables présentationnels avec statut "à vérifier manuellement".
5. Produis 'markdown' : le registre complet formaté (tableau des gaps trié, résumé chiffré, volet prévention), prêt à écrire dans docs/audit/.

Renvoie l'objet structuré.`;
}

function criticPrompt(statsJson) {
  return `Tu es le critique de complétude de l'audit. Voici, par section, le nombre de livrables extraits et de findings, en JSON :

${statsJson}

TÂCHE : repère les sections suspectes d'avoir été SOUS-extraites ou survolées (trop peu de livrables au vu de la densité attendue de la section — ex. Data Model, Règles métier, Back-office Admin, Auth/RLS devraient en avoir beaucoup). Pour chaque section douteuse, donne section_id + raison. Indique recommend_rerun=true si au moins une section critique semble sous-couverte. Sois concret.`;
}

// ---------------------------------------------------------------------------
// Orchestration : pipeline Extract -> Evidence -> Verify (sans barrière),
// puis barrière implicite (pipeline await tout) -> Synthesize + Critic.
// ---------------------------------------------------------------------------

log(`Audit CDC->code : ${SECTIONS.length} section(s) à auditer.`);

const perSection = await pipeline(
  SECTIONS,
  // Stage 1 — Extract
  (s) =>
    agent(extractPrompt(s), {
      label: `extract:${s.id}`,
      phase: 'Extract',
      schema: EXTRACT_SCHEMA,
      effort: s.criticality === 'critique' ? 'high' : 'medium',
    }),
  // Stage 2 — Evidence
  (extracted, s) =>
    agent(evidencePrompt(s, extracted || { deliverables: [] }), {
      label: `evidence:${s.id}`,
      phase: 'Evidence',
      schema: EVIDENCE_SCHEMA,
    }).then((ev) => ({ extracted, ev })),
  // Stage 3 — Verify (adverse, uniquement sur les écarts)
  async (bundle, s) => {
    if (!bundle || !bundle.ev) return null;
    const { extracted, ev } = bundle;
    const deliverables = (extracted && extracted.deliverables) || [];
    const byId = {};
    for (const d of deliverables) byId[d.id] = d;
    const suspects = (ev.findings || []).filter(
      (f) =>
        f.status === 'missing' ||
        f.status === 'partial' ||
        f.status === 'indeterminate',
    );

    // Mode de vérification : 'chunked' (défaut, lots adverses), 'per_finding'
    // (1 sceptique par écart, réservé aux sections critiques), 'batched' (1 seul agent).
    const mode = s.verify_mode || OPTIONS.verify_mode || 'chunked';
    const batchSize = s.verify_batch_size || OPTIONS.verify_batch_size || 10;
    log(
      `[${s.id}] ${deliverables.length} livrables, ${suspects.length} écart(s) à vérifier (mode=${mode}).`,
    );

    let verdicts = [];
    if (suspects.length === 0) {
      verdicts = [];
    } else if (mode === 'per_finding') {
      verdicts = (
        await parallel(
          suspects.map(
            (f) => () =>
              agent(verifyPrompt(s, f, byId[f.deliverable_id] || {}), {
                label: `verify:${s.id}:${f.deliverable_id}`,
                phase: 'Verify',
                schema: VERDICT_SCHEMA,
                effort: 'high',
              }),
          ),
        )
      ).filter(Boolean);
    } else {
      // 'chunked' / 'batched' : un agent par lot (batched = un seul lot global).
      const size = mode === 'batched' ? suspects.length : batchSize;
      const chunks = [];
      for (let i = 0; i < suspects.length; i += size)
        chunks.push(suspects.slice(i, i + size));
      const batchResults = await parallel(
        chunks.map(
          (chunk, ci) => () =>
            agent(verifyBatchPrompt(s, chunk, byId), {
              label: `verify:${s.id}:lot${ci + 1}/${chunks.length}`,
              phase: 'Verify',
              schema: VERDICT_BATCH_SCHEMA,
              effort: 'high',
            }),
        ),
      );
      verdicts = batchResults
        .filter(Boolean)
        .flatMap((r) => (r && r.verdicts) || []);
    }

    return {
      section_id: s.id,
      module: (s.delivered_modules || []).join('/'),
      delivery_status: s.delivery_status,
      deliverables_count: deliverables.length,
      findings: ev.findings || [],
      verdicts: verdicts.filter(Boolean),
    };
  },
);

const sections = perSection.filter(Boolean);

// Agrégats pour la synthèse (on borne la taille du payload : pas les preuves brutes).
const aggregate = sections.map((r) => ({
  section_id: r.section_id,
  module: r.module,
  delivery_status: r.delivery_status,
  deliverables_count: r.deliverables_count,
  status_counts: (r.findings || []).reduce((acc, f) => {
    acc[f.status] = (acc[f.status] || 0) + 1;
    return acc;
  }, {}),
  verdicts: (r.verdicts || []).map((v) => ({
    deliverable_id: v.deliverable_id,
    verdict: v.verdict,
    severity: v.severity,
    justification: v.justification,
    found_at: v.found_at,
    descope_ref: v.descope_ref,
  })),
}));

const confirmedCount = aggregate.reduce(
  (n, s) => n + s.verdicts.filter((v) => v.verdict === 'confirmed_gap').length,
  0,
);
log(
  `Vérification terminée : ${confirmedCount} écart(s) confirmé(s) avant synthèse.`,
);

const register = await agent(synthPrompt(JSON.stringify(aggregate, null, 2)), {
  label: 'synthese-registre',
  phase: 'Synthesize',
  schema: REGISTER_SCHEMA,
  effort: 'high',
});

const critic = await agent(
  criticPrompt(
    JSON.stringify(
      aggregate.map((s) => ({
        section_id: s.section_id,
        deliverables_count: s.deliverables_count,
        status_counts: s.status_counts,
      })),
      null,
      2,
    ),
  ),
  { label: 'critique-completude', phase: 'Synthesize', schema: CRITIC_SCHEMA },
);

return {
  register,
  critic,
  sections: aggregate,
};
