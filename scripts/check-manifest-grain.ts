#!/usr/bin/env tsx
/**
 * G2 — Manifeste au GRAIN LIVRABLE (MODE RAPPORT, T0).
 * =============================================================================
 * Cause racine de l'audit conformité CDC→code (2026-06-23) : les manifestes
 * specs/manifests/M*.json sont au grain SCÉNARIO (`scenarios[]`) → un livrable
 * du CDC non transcrit y est INVISIBLE (aucun gate ne le voit). G2 exige un
 * tableau `deliverables[]` au grain LIVRABLE (cf. specs/manifests/_schema.json),
 * conservé À CÔTÉ de `scenarios[]` (que check-coverage.ts continue d'utiliser).
 *
 * Ce script valide chaque manifeste contre `_schema.json` et SIGNALE :
 *   1. les manifestes au grain scénario-seul (pas de `deliverables[]`) — burn-down
 *      principal G2 ;
 *   2. les manquements structurels (champ requis absent, statut hors énum,
 *      ref_cdc mal formée, descoped sans ref_divergence…).
 *
 * Validateur de sous-ensemble JSON Schema embarqué (zéro dépendance — ajv absent
 * du repo) : il interprète le sous-ensemble réellement utilisé par _schema.json
 * (required, type, enum, pattern, minItems/minLength, additionalProperties:false,
 * $ref, if/then). Il LIT _schema.json → reste aligné si le schéma évolue.
 *
 * MODE RAPPORT : informe, ne bloque jamais (exit 0). Résumé $GITHUB_STEP_SUMMARY
 * + compteur de burn-down. Flip bloquant (T1) : quand tous les manifestes portent
 * un deliverables[] valide (durcissement par cliquet, cf. Lot 0).
 * =============================================================================
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const MANIFESTS_DIR = 'specs/manifests';
const SCHEMA_PATH = join(MANIFESTS_DIR, '_schema.json');
// Fichiers du dossier qui NE SONT PAS des manifestes de module.
const NON_MANIFEST = new Set(['_schema.json', 'cdc-deliverables.index.json']);

type JsonSchema = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Validateur de sous-ensemble JSON Schema (draft-07 partiel)
// ---------------------------------------------------------------------------
function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // 'string' | 'number' | 'boolean' | 'object'
}

function matchesType(v: unknown, t: unknown): boolean {
  const types = Array.isArray(t) ? t : [t];
  const actual = typeOf(v);
  return types.some((ty) => {
    if (ty === 'integer') return actual === 'number' && Number.isInteger(v);
    return ty === actual;
  });
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  // Supporte uniquement les pointeurs locaux '#/definitions/x'.
  const parts = ref.replace(/^#\//, '').split('/');
  let cur: unknown = root;
  for (const p of parts) cur = (cur as Record<string, unknown>)?.[p];
  return (cur ?? {}) as JsonSchema;
}

function validate(
  node: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
): string[] {
  const errs: string[] = [];

  if (typeof schema.$ref === 'string') {
    return validate(node, resolveRef(schema.$ref, root), root, path);
  }

  if (schema.type !== undefined && !matchesType(node, schema.type)) {
    errs.push(
      `${path} : type attendu ${JSON.stringify(schema.type)}, reçu ${typeOf(node)}`,
    );
    return errs; // inutile de continuer si le type de base est faux
  }

  if (schema.enum !== undefined && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(node)) {
      errs.push(
        `${path} : valeur ${JSON.stringify(node)} hors énum ${JSON.stringify(schema.enum)}`,
      );
    }
  }

  // const : indispensable au if/then (if: { properties: { statut: { const } } }).
  // Sans lui, le `if` matcherait toujours (0 erreur) → ref_divergence exigé partout.
  if ('const' in schema && node !== schema.const) {
    errs.push(
      `${path} : valeur ${JSON.stringify(node)} ≠ const ${JSON.stringify(schema.const)}`,
    );
  }

  if (typeof node === 'string') {
    if (
      typeof schema.pattern === 'string' &&
      !new RegExp(schema.pattern).test(node)
    ) {
      errs.push(
        `${path} : "${node}" ne respecte pas le motif /${schema.pattern}/`,
      );
    }
    if (
      typeof schema.minLength === 'number' &&
      node.length < schema.minLength
    ) {
      errs.push(`${path} : longueur < minLength (${schema.minLength})`);
    }
  }

  if (Array.isArray(node)) {
    if (typeof schema.minItems === 'number' && node.length < schema.minItems) {
      errs.push(
        `${path} : ${node.length} élément(s) < minItems (${schema.minItems})`,
      );
    }
    if (schema.items) {
      node.forEach((item, i) =>
        errs.push(
          ...validate(item, schema.items as JsonSchema, root, `${path}[${i}]`),
        ),
      );
    }
  }

  if (node !== null && typeOf(node) === 'object') {
    const obj = node as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;

    if (Array.isArray(schema.required)) {
      for (const req of schema.required as string[]) {
        if (!(req in obj))
          errs.push(`${path} : champ requis manquant « ${req} »`);
      }
    }

    if (schema.additionalProperties === false) {
      for (const k of Object.keys(obj)) {
        if (!(k in props))
          errs.push(
            `${path} : propriété inconnue « ${k} » (additionalProperties:false)`,
          );
      }
    }

    for (const [k, sub] of Object.entries(props)) {
      if (k in obj) errs.push(...validate(obj[k], sub, root, `${path}.${k}`));
    }

    // allOf + if/then (le seul usage : descoped ⇒ ref_divergence requis).
    if (Array.isArray(schema.allOf)) {
      for (const clause of schema.allOf as JsonSchema[]) {
        if (clause.if && clause.then) {
          if (matchesSchema(obj, clause.if as JsonSchema, root)) {
            errs.push(...validate(obj, clause.then as JsonSchema, root, path));
          }
        }
      }
    }
  }

  return errs;
}

// Évalue (sans produire d'erreur) si `node` satisfait un sous-schéma `if`.
function matchesSchema(
  node: unknown,
  schema: JsonSchema,
  root: JsonSchema,
): boolean {
  return validate(node, schema, root, '$if').length === 0;
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------
interface ManifestReport {
  file: string;
  module: string;
  hasDeliverables: boolean;
  nbDeliverables: number;
  structuralErrors: string[];
}

function main(): void {
  if (!existsSync(SCHEMA_PATH)) {
    console.error(`❌  Schéma introuvable : ${SCHEMA_PATH}`);
    process.exit(0); // mode rapport : ne jamais rougir
  }
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchema;

  const files = readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith('.json') && !NON_MANIFEST.has(f))
    .sort();

  const reports: ManifestReport[] = [];
  for (const f of files) {
    const full = join(MANIFESTS_DIR, f);
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(full, 'utf8'));
    } catch (e) {
      reports.push({
        file: full,
        module: f,
        hasDeliverables: false,
        nbDeliverables: 0,
        structuralErrors: [`JSON invalide : ${(e as Error).message}`],
      });
      continue;
    }
    const deliverables = Array.isArray(manifest.deliverables)
      ? manifest.deliverables
      : [];
    reports.push({
      file: full,
      module: String(manifest.module ?? f),
      hasDeliverables: deliverables.length > 0,
      nbDeliverables: deliverables.length,
      structuralErrors: validate(manifest, schema, schema, f),
    });
  }

  const grainScenario = reports.filter((r) => !r.hasDeliverables);
  const structIssues = reports.filter(
    (r) => r.hasDeliverables && r.structuralErrors.length > 0,
  );
  const ok = reports.filter(
    (r) => r.hasDeliverables && r.structuralErrors.length === 0,
  );

  const lines: string[] = [];
  lines.push('## G2 — Manifeste au grain livrable (mode rapport)');
  lines.push('');
  lines.push(
    'Valide chaque manifeste `specs/manifests/M*.json` contre `_schema.json`. ' +
      'Un manifeste sans `deliverables[]` = grain scénario-seul = livrable CDC non transcrit invisible (cause racine).',
  );
  lines.push('');
  lines.push(
    `**Burn-down G2 : ${grainScenario.length} manifeste(s) au grain scénario-seul** ` +
      `(à re-grainer) · ${structIssues.length} avec écart structurel · ${ok.length} au grain livrable valide ` +
      `· ${reports.length} manifeste(s) au total.`,
  );
  lines.push('');

  lines.push('### ⛔ Grain scénario-seul (pas de deliverables[])');
  if (grainScenario.length === 0) {
    lines.push('_Aucun — tous les manifestes portent un deliverables[]._');
  } else {
    for (const r of grainScenario)
      lines.push(`- \`${r.file}\` — module ${r.module}`);
  }
  lines.push('');

  lines.push(
    '### ❗ Écarts structurels (deliverables[] présent mais non conforme au schéma)',
  );
  if (structIssues.length === 0) {
    lines.push('_Aucun._');
  } else {
    for (const r of structIssues) {
      lines.push(`- \`${r.file}\` (${r.nbDeliverables} livrable(s)) :`);
      for (const e of r.structuralErrors.slice(0, 20)) lines.push(`    - ${e}`);
      if (r.structuralErrors.length > 20)
        lines.push(`    - … +${r.structuralErrors.length - 20} autre(s)`);
    }
  }
  lines.push('');

  lines.push('### ✅ Manifestes au grain livrable valide');
  lines.push(
    ok.length === 0
      ? '_Aucun pour l’instant._'
      : ok
          .map((r) => `- \`${r.module}\` (${r.nbDeliverables} livrable(s))`)
          .join('\n'),
  );
  lines.push('');
  lines.push(
    '> Mode RAPPORT — informatif, non bloquant. Flip bloquant (T1) quand tous les ' +
      'manifestes portent un deliverables[] valide (durcissement par cliquet).',
  );

  const report = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  console.log(report);
  console.log('');
  console.log(
    `[manifest-grain] Burn-down : ${grainScenario.length} grain scénario-seul · ` +
      `${structIssues.length} écart(s) structurel(s) · ${ok.length}/${reports.length} valides.`,
  );
  console.log(`RATCHET_COUNT=${grainScenario.length + structIssues.length}`); // C1
  console.log('[manifest-grain] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

main();
