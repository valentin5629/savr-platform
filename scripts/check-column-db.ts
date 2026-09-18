#!/usr/bin/env tsx
/**
 * G7 — Cohérence colonne-DB par route (MODE RAPPORT, T0).
 * =============================================================================
 * Classe d'échec silencieux #1 de l'audit 2026-06-23 : des routes lisent/écrivent
 * des colonnes qui N'EXISTENT PAS dans le schéma courant (`.eq('facteur_co2…')`,
 * `.insert({ methode })`, `.update({ type_remise })`…). Au runtime : PGRST204 /
 * 400 / `undefined` silencieux → écran cassé sans qu'aucun test manifeste ne le
 * voie (le test mocke la chaîne Supabase).
 *
 * Mécanique : `tsconfig.column-db.json` recompile l'app avec le client Supabase
 * TYPÉ contre `database.types.ts` (généré depuis le schéma réel) — les DEUX
 * portes d'entrée : factories `@savr/shared` ET `createServerClient` de
 * `@supabase/ssr` (createSupabaseServerClient, page-auth, middleware). Comme
 * `pnpm typecheck` (root) est VERT, toute erreur de cette passe = conséquence du
 * typage du client. En plus des diagnostics tsc, le type de chaque appel
 * `.select(...)` est inspecté : un select-string fantôme n'est PAS une erreur
 * tsc tant que le résultat n'est pas lu champ par champ (cf. selectErrors).
 *
 * Correctif #357 : le gate affichait « 0 call-site » alors que 3 routes
 * gestionnaire échouaient en 42703 — client ssr non typé + select opaque.
 * Deux garde-fous rendent désormais un « 0 » vacant impossible : module
 * introuvable → exit 1 ; auto-test `scripts/fixtures/column-db/` non détecté →
 * exit 1 (pas de RATCHET_COUNT → gate-ratchet rougit). On classe ensuite :
 *
 *   1. COLONNE-DB (haute confiance) — colonne fantôme passée à .eq/.select/
 *      .order/.insert/.update : c'est le cœur du gate.
 *   2. À CONFIRMER — overloads/select-string où la colonne fantôme est probable
 *      mais le message TS est moins univoque.
 *   3. BRUIT TYPAGE — erreurs en aval (résultats désormais typés) hors périmètre
 *      colonne-DB ; comptées pour transparence, pas dans le compteur de tête.
 *
 * MODE RAPPORT : informe, ne bloque pas sur le compteur (exit 0) — seuls les
 * deux garde-fous ci-dessus sortent en 1. Résumé dans
 * $GITHUB_STEP_SUMMARY + compteurs de burn-down. Flip bloquant (T1) = lots
 * R3 (CO2) / R18 (paramètres) corrigés, puis durcissement par cliquet.
 * =============================================================================
 */
import { appendFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const TSCONFIG = 'tsconfig.column-db.json';
const MAX_LIST = 80; // plafond d'affichage par bucket (anti-firehose, tracé)

// Auto-test de non-vacuité (constat #357 : le gate a affiché « 0 call-site »
// alors que 3 routes lisaient des colonnes inexistantes). Les fixtures sont
// compilées DANS LE MÊME programme que l'app : chaque ligne marquée
// `G7-ATTENDU` doit produire un diagnostic colonne-DB, aucune autre ligne ne
// doit en produire. Sinon le détecteur est inerte → exit 1, jamais « 0 ».
const FIXTURES_DIR = 'scripts/fixtures/column-db';
// Marqueur en fin de ligne (`// G7-ATTENDU`), sur la ligne de l'appel `.select(`
// ou de l'argument fautif — là où le diagnostic est ancré ; ou seul sur sa
// ligne, il vise alors la ligne suivante.
const MARQUEUR_ATTENDU = /\/\/\s*G7-ATTENDU\s*$/;

interface TscError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

type Bucket = 'colonne' | 'aconfirmer' | 'bruit';

function fixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.resolve(FIXTURES_DIR, f));
}

function createProgram(): ts.Program {
  const cfg = ts.readConfigFile(TSCONFIG, (f) => ts.sys.readFile(f));
  if (cfg.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(cfg.error.messageText, '\n'),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    cfg.config,
    ts.sys,
    process.cwd(),
  );
  return ts.createProgram({
    rootNames: [...parsed.fileNames, ...fixtureFiles()],
    options: { ...parsed.options, noEmit: true },
  });
}

function position(
  sf: ts.SourceFile,
  pos: number,
): { line: number; col: number } {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, col: lc.character + 1 };
}

function rel(fileName: string): string {
  return path.relative(process.cwd(), fileName);
}

// Diagnostics du compilateur, au format de l'ancienne sortie `tsc --pretty false`
// (1re ligne du message = celle que lisait le parseur).
function compilerErrors(program: ts.Program): TscError[] {
  const errs: TscError[] = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const message = ts
      .flattenDiagnosticMessageText(d.messageText, '\n')
      .split('\n')[0]!;
    if (!d.file || d.start === undefined) {
      errs.push({
        file: '(global)',
        line: 0,
        col: 0,
        code: `TS${d.code}`,
        message,
      });
      continue;
    }
    errs.push({
      file: rel(d.file.fileName),
      ...position(d.file, d.start),
      code: `TS${d.code}`,
      message,
    });
  }
  return errs;
}

/**
 * `.select('…colonne_fantome…')` : supabase-js type le résultat en
 * `SelectQueryError<"column 'x' does not exist on 't'.">`, mais ce type n'est
 * PAS une erreur de compilation — tsc ne rougit que si le code accède ensuite à
 * une propriété du résultat. Un `NextResponse.json(data)`, un cast `as X` ou un
 * spread passent en silence (profil/factures #357). On inspecte donc le type de
 * CHAQUE appel `.select(...)` : son argument générique `Result` nomme la colonne
 * fantôme → diagnostic ancré sur l'appel, indépendant de l'usage en aval.
 */
function selectErrors(program: ts.Program): TscError[] {
  const checker = program.getTypeChecker();
  const errs: TscError[] = [];
  const flags =
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;

  const resultText = (t: ts.Type): string | null => {
    if (!(t.flags & ts.TypeFlags.Object)) return null;
    const ref = t as ts.TypeReference;
    if (!(ref.objectFlags & ts.ObjectFlags.Reference)) return null;
    const params = ref.target.typeParameters ?? [];
    const args = checker.getTypeArguments(ref);
    // `Result$1` dans le .d.ts bundlé de postgrest-js (renommage de collision).
    const i = params.findIndex((p) => /^Result(\$\d+)?$/.test(p.symbol.name));
    if (i < 0 || !args[i]) return null;
    return checker.typeToString(args[i]!, undefined, flags);
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('/node_modules/'))
      continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'select'
      ) {
        const txt = resultText(checker.getTypeAtLocation(node));
        const m = txt ? /SelectQueryError<"([^"]*)">/.exec(txt) : null;
        if (m) {
          errs.push({
            file: rel(sf.fileName),
            ...position(sf, node.expression.name.getStart(sf)),
            code: 'SELECT',
            message: `select-string invalide : SelectQueryError<"${m[1]}">`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return errs;
}

/**
 * Classement heuristique mais précis (le baseline root est vert → 0 faux
 * positif structurel ; on ne fait que router le delta).
 *
 *  - colonne (haute confiance) :
 *    · TS2345 « Argument of type '"x"' is not assignable to parameter of type
 *      '"a" | "b" | …' » → colonne/RPC fantôme sur .eq/.order/.select(single)/.rpc.
 *    · TS2353 « … does not exist in type » → clé fantôme dans .insert/.update.
 *    · TS2322 « Type 'X' is not assignable to type 'never' » → payload .insert/
 *      .update effondré par une clé fantôme (pattern DOMINANT, sinon faux négatifs).
 *    · SELECT (inspection de type, cf. selectErrors) → .select string fantôme,
 *      ancré sur l'appel. TS2339 « SelectQueryError<…> » = la même erreur vue
 *      depuis un accès en aval → fusionnée avec l'appel par `dedup`.
 *  - aconfirmer : TS2769 (no overload matches) — souvent select-string fantôme.
 *  - bruit : tout le reste (accès propriété sur résultat désormais typé, etc.).
 */
function classify(e: TscError): Bucket {
  // .eq/.order/.select(single) avec colonne (ou .rpc avec fonction) fantôme :
  // littéral non assignable à l'union des noms valides.
  const litToUnion =
    e.code === 'TS2345' &&
    /Argument of type '"[^"]+"' is not assignable to parameter of type '"/.test(
      e.message,
    );
  // .insert/.update avec clé fantôme — DEUX formes possibles :
  //   · excès de propriété explicite (TS2353)
  //   · effondrement du payload entier en `never` dès qu'une clé est inconnue
  //     (TS2322) — c'est le pattern DOMINANT, à ne PAS rater (sinon faux négatifs
  //     sur grilles ZD `methode`, remises `type_remise`, taux `commentaire_modif`).
  const excessProp =
    e.code === 'TS2353' && /does not exist in type/.test(e.message);
  const payloadNever =
    e.code === 'TS2322' && /is not assignable to type 'never'/.test(e.message);
  // .select('a, b, colonne_fantome') : supabase-js renvoie un SelectQueryError
  // dont le message NOMME littéralement la colonne inexistante → univoque.
  const selectError =
    e.code === 'SELECT' ||
    (e.code === 'TS2339' && /SelectQueryError<"/.test(e.message));
  if (litToUnion || excessProp || payloadNever || selectError) return 'colonne';
  if (e.code === 'TS2769') return 'aconfirmer';
  return 'bruit';
}

// Dédup par call-site (fichier:ligne) : un même .insert avec plusieurs clés
// fantômes ne doit compter qu'une fois dans le burn-down "routes fautives".
// Un TS2339 « SelectQueryError » en aval est la MÊME erreur qu'un appel
// `.select` déjà relevé (même fichier, même message, ligne antérieure) → écarté.
function dedup(errs: TscError[]): TscError[] {
  const sqe = (e: TscError): string | undefined =>
    /SelectQueryError<"[^"]*">/.exec(e.message)?.[0];
  const selects = errs.filter((e) => e.code === 'SELECT');
  const seen = new Set<string>();
  const out: TscError[] = [];
  for (const e of errs) {
    if (
      e.code === 'TS2339' &&
      selects.some(
        (x) => x.file === e.file && x.line <= e.line && sqe(x) === sqe(e),
      )
    )
      continue;
    const k = `${e.file}:${e.line}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function distinctRoutes(errs: TscError[]): number {
  return new Set(errs.map((e) => e.file)).size;
}

function fmt(errs: TscError[]): string[] {
  return errs
    .slice(0, MAX_LIST)
    .map((e) => `- \`${e.file}:${e.line}\` — ${e.code}: ${e.message}`);
}

// Garde-fou n°1 : une résolution de modules cassée (worktree sans
// `pnpm install`, remap `paths` erroné) laisse les clients en `any` → toutes les
// erreurs tombent en « bruit » et le gate affiche « 0 » en toute bonne foi.
// Vécu en préparant ce correctif : 1 367 diagnostics, 0 colonne-DB.
function modulesIntrouvables(errs: TscError[]): TscError[] {
  return errs.filter((e) => e.code === 'TS2307' || e.code === 'TS2792');
}

// Garde-fou n°2 : chaque ligne `G7-ATTENDU` des fixtures doit être détectée,
// et aucune autre ligne des fixtures ne doit l'être (anti faux positif).
function autoTest(fixtures: string[], colonne: TscError[]): string[] {
  const echecs: string[] = [];
  const detectees = new Set(colonne.map((e) => `${e.file}:${e.line}`));
  const attendues = new Set<string>();
  for (const abs of fixtures) {
    const f = rel(abs);
    const src = ts.sys.readFile(abs) ?? '';
    src.split('\n').forEach((l, i) => {
      if (!MARQUEUR_ATTENDU.test(l)) return;
      // Marqueur seul sur sa ligne (prettier y déplace un commentaire de fin de
      // ligne d'appel multi-ligne) → vise la ligne SUIVANTE.
      const seul = l.trim().startsWith('//');
      attendues.add(`${f}:${seul ? i + 2 : i + 1}`);
    });
  }
  for (const a of attendues)
    if (!detectees.has(a)) echecs.push(`non détectée : ${a}`);
  for (const d of detectees)
    if (!attendues.has(d)) echecs.push(`faux positif : ${d}`);
  if (attendues.size === 0)
    echecs.push('aucun marqueur G7-ATTENDU dans les fixtures');
  return echecs;
}

function main(): void {
  const program = createProgram();
  const tous = [...compilerErrors(program), ...selectErrors(program)];

  const introuvables = modulesIntrouvables(tous);
  if (introuvables.length > 0) {
    console.error(
      `⛔ [column-db] ${introuvables.length} module(s) introuvable(s) — le client ` +
        'Supabase ne peut pas être typé, le compteur serait faussement à 0.',
    );
    for (const e of introuvables.slice(0, 10))
      console.error(`   ${e.file}:${e.line} — ${e.message}`);
    console.error('   → `pnpm install` puis relancer.');
    process.exit(1); // pas de RATCHET_COUNT : check-ratchet signale le gate illisible
  }

  const fixtures = fixtureFiles();
  const estFixture = (e: TscError): boolean =>
    e.file.startsWith(`${FIXTURES_DIR}/`);
  const echecs = autoTest(
    fixtures,
    dedup(tous.filter((e) => estFixture(e) && classify(e) === 'colonne')),
  );
  if (echecs.length > 0) {
    console.error(
      `⛔ [column-db] Auto-test en échec (${FIXTURES_DIR}) — détecteur inerte ou ` +
        'trop large, le compteur ne serait pas fiable :',
    );
    for (const e of echecs) console.error(`   - ${e}`);
    process.exit(1);
  }

  const errs = tous.filter((e) => !estFixture(e));

  // Dédup par call-site : un .insert avec N clés fantômes = 1 route, pas N.
  const colonne = dedup(errs.filter((e) => classify(e) === 'colonne'));
  const aconfirmer = dedup(errs.filter((e) => classify(e) === 'aconfirmer'));
  const bruit = errs.filter((e) => classify(e) === 'bruit');
  const colonneRoutes = distinctRoutes(colonne);

  const lines: string[] = [];
  lines.push('## G7 — Cohérence colonne-DB par route (mode rapport)');
  lines.push('');
  lines.push(
    'Compilation de l’app avec le client Supabase **typé** contre le schéma réel ' +
      '(`database.types.ts`). Le typecheck racine étant vert, ces diagnostics sont ' +
      'la conséquence du typage du client.',
  );
  lines.push('');
  lines.push(
    `**Colonne-DB (haute confiance) : ${colonne.length} call-site(s) sur ` +
      `${colonneRoutes} route(s)** · ` +
      `À confirmer : ${aconfirmer.length} · ` +
      `Bruit typage (aval) : ${bruit.length} · ` +
      `Total diagnostics : ${errs.length}`,
  );
  lines.push('');

  lines.push('### ⛔ Colonne-DB (haute confiance) — colonnes/RPC fantômes');
  if (colonne.length === 0) {
    lines.push('_Aucune — 0 colonne fantôme détectée._');
  } else {
    lines.push(...fmt(colonne));
    if (colonne.length > MAX_LIST)
      lines.push(
        `- … +${colonne.length - MAX_LIST} (liste tronquée à ${MAX_LIST})`,
      );
  }
  lines.push('');

  lines.push('### ❓ À confirmer (overloads / select-string)');
  if (aconfirmer.length === 0) {
    lines.push('_Aucune._');
  } else {
    lines.push(...fmt(aconfirmer));
    if (aconfirmer.length > MAX_LIST)
      lines.push(
        `- … +${aconfirmer.length - MAX_LIST} (liste tronquée à ${MAX_LIST})`,
      );
  }
  lines.push('');

  lines.push(
    `### ℹ️ Bruit typage en aval (hors périmètre colonne-DB) : ${bruit.length}`,
  );
  lines.push(
    '_Conséquence du passage du client de `any` à typé (résultats désormais typés). ' +
      'Non comptabilisé dans le burn-down colonne-DB._',
  );
  lines.push('');
  lines.push(
    '> Mode RAPPORT — informatif, non bloquant. Flip bloquant prévu avec R3 (CO2) / ' +
      'R18 (paramètres) puis durcissement par cliquet.',
  );

  const report = lines.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }

  // Sortie console (toujours).
  console.log(report);
  console.log('');
  console.log(
    `[column-db] Compteur burn-down (colonne-DB haute confiance) : ` +
      `${colonne.length} call-site(s) sur ${colonneRoutes} route(s).`,
  );
  console.log(
    `[column-db] Auto-test OK : ${fixtures.length} fixture(s), détecteur non vacant.`,
  );
  console.log(`RATCHET_COUNT=${colonne.length}`); // lu par check-ratchet (C1)
  console.log('[column-db] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

main();
