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
 * TYPÉ contre `database.types.ts` (généré depuis le schéma réel). Comme
 * `pnpm typecheck` (root) est VERT, toute erreur de cette passe = conséquence du
 * typage du client. On classe ces erreurs :
 *
 *   1. COLONNE-DB (haute confiance) — colonne fantôme passée à .eq/.select/
 *      .order/.insert/.update : c'est le cœur du gate.
 *   2. À CONFIRMER — overloads/select-string où la colonne fantôme est probable
 *      mais le message TS est moins univoque.
 *   3. BRUIT TYPAGE — erreurs en aval (résultats désormais typés) hors périmètre
 *      colonne-DB ; comptées pour transparence, pas dans le compteur de tête.
 *
 * MODE RAPPORT : informe, ne bloque jamais (exit 0). Résumé dans
 * $GITHUB_STEP_SUMMARY + compteurs de burn-down. Flip bloquant (T1) = lots
 * R3 (CO2) / R18 (paramètres) corrigés, puis durcissement par cliquet.
 * =============================================================================
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const TSCONFIG = 'tsconfig.column-db.json';
const MAX_LIST = 80; // plafond d'affichage par bucket (anti-firehose, tracé)

interface TscError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

type Bucket = 'colonne' | 'aconfirmer' | 'bruit';

function runTsc(): string {
  const res = spawnSync(
    'pnpm',
    ['exec', 'tsc', '-p', TSCONFIG, '--noEmit', '--pretty', 'false'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  // tsc sort en erreur dès qu'il y a ≥1 diagnostic — attendu, on lit stdout.
  return `${res.stdout ?? ''}${res.stderr ?? ''}`;
}

const ERR_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;

function parse(out: string): TscError[] {
  const errs: TscError[] = [];
  for (const raw of out.split('\n')) {
    const m = ERR_RE.exec(raw.trim());
    if (!m) continue;
    errs.push({
      file: m[1]!,
      line: Number(m[2]),
      col: Number(m[3]),
      code: m[4]!,
      message: m[5]!,
    });
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
 *    · TS2339 « SelectQueryError<"column 'x' does not exist…"> » → .select string.
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
    e.code === 'TS2339' &&
    /SelectQueryError<"column '[^']+' does not exist/.test(e.message);
  if (litToUnion || excessProp || payloadNever || selectError) return 'colonne';
  if (e.code === 'TS2769') return 'aconfirmer';
  return 'bruit';
}

// Dédup par call-site (fichier:ligne) : un même .insert avec plusieurs clés
// fantômes ne doit compter qu'une fois dans le burn-down "routes fautives".
function dedupByFileLine(errs: TscError[]): TscError[] {
  const seen = new Set<string>();
  const out: TscError[] = [];
  for (const e of errs) {
    const k = `${e.file}:${e.line}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function distinctRoutes(errs: TscError[]): number {
  return new Set(errs.map((e) => e.file)).size;
}

function fmt(errs: TscError[]): string[] {
  return errs
    .slice(0, MAX_LIST)
    .map((e) => `- \`${e.file}:${e.line}\` — ${e.code}: ${e.message}`);
}

function main(): void {
  const out = runTsc();
  const errs = parse(out);

  // Dédup par call-site : un .insert avec N clés fantômes = 1 route, pas N.
  const colonne = dedupByFileLine(
    errs.filter((e) => classify(e) === 'colonne'),
  );
  const aconfirmer = dedupByFileLine(
    errs.filter((e) => classify(e) === 'aconfirmer'),
  );
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
  console.log('[column-db] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

main();
