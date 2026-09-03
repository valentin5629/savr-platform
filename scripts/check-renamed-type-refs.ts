#!/usr/bin/env tsx
/**
 * check-renamed-type-refs — Garde anti-récidive : référence EXÉCUTABLE à un type
 * Postgres DÉJÀ RENOMMÉ (cast / annotation vers un nom qui n'existe plus). RAPPORT.
 * =============================================================================
 * Classe de bug (vécue #259, rattrapée en revue) : une migration datée après D
 * caste vers `::plateforme.collecte_type_enum` alors que la migration D
 * (20260623100000_..._noms_cible) a fait
 *   ALTER TYPE plateforme.collecte_type_enum RENAME TO collecte_type;
 * Le type n'existe plus sous l'ancien nom → `CREATE FUNCTION` échoue → le job
 * `migrations` (supabase db reset) rougit TARD en CI, et AUCUN gate léger ne
 * l'attrape en amont. Un commentaire périmé affirmant le mauvais nom suffit à
 * réintroduire le bug (cf. scripts/check-enum-collecte-type.sh, corrigé).
 *
 * Ce gate rejoue, dans l'ordre des timestamps, les `ALTER TYPE … RENAME TO` et
 * `CREATE TYPE` de toutes les migrations pour bâtir l'ensemble des ANCIENS noms
 * MORTS (renommés puis jamais recréés). Puis il flagge, hors commentaires :
 *   1. toute migration datée APRÈS le rename qui référence l'ancien nom ;
 *   2. tout test pgTAP (supabase/tests*, joué contre le schéma FINAL) qui
 *      référence un ancien nom mort dans l'état final.
 *
 * Portée volontairement restreinte au SQL exécuté en CI (migrations + pgTAP) :
 * TypeScript ne caste jamais vers un type Postgres, et le repo n'exécute aucun
 * SQL brut hors migrations/pgTAP. Les commentaires (fin de ligne "-- …" et
 * blocs slash-étoile) et les migrations datées AVANT leur rename (où l'ancien
 * nom existait encore à l'application) ne sont PAS des violations.
 *
 * MODE RAPPORT (exit 0) — durci par le méta-cliquet `check:ratchet`
 * (docs/audit/gate-baseline.json, baseline attendue 0 : toute nouvelle
 * violation fait remonter le compteur au-dessus de 0 → régression → CI rouge).
 * Émet RATCHET_COUNT=<n>.
 * =============================================================================
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

// Chemins relatifs au cwd = racine du repo (les `check:*` sont lancés depuis la
// racine par pnpm — même idiome que check-manifest-grain.ts / check-column-db.ts).
const MIG_DIR = 'supabase/migrations';
// Répertoires de SQL joués contre le schéma FINAL (après toutes les migrations).
const FINAL_SQL_DIRS = ['supabase/tests', 'supabase/tests-report'];

const IDENT = '[a-zA-Z_][a-zA-Z0-9_]*';

interface Rename {
  fqn: string; // schema.old — nom mort
  short: string; // old — nom mort sans schéma
  schema: string;
  target: string; // nouveau nom (RENAME TO …)
  renameTs: string; // timestamp (14 car.) de la migration qui a renommé
}

/** Liste récursive des .sql sous un répertoire (relatif au cwd). */
function listSql(relDir: string): string[] {
  if (!existsSync(relDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(relDir)) {
    const p = join(relDir, entry);
    if (statSync(p).isDirectory()) out.push(...listSql(p));
    else if (entry.endsWith('.sql')) out.push(p);
  }
  return out;
}

/** Timestamp (14 chiffres) en tête du nom de fichier de migration, sinon ''. */
function tsOf(relPath: string): string {
  const base = relPath.split('/').pop() ?? '';
  const m = base.match(/^(\d{14})/);
  return m ? m[1]! : '';
}

/**
 * Retourne, ligne par ligne (1-indexé), le CODE de chaque ligne après retrait
 * des commentaires SQL (blocs slash-étoile + fin de ligne "-- …") ET des
 * littéraux chaîne simple-quote "'…'" (avec échappement "''", persistance
 * multi-lignes). Objectif : ne garder que les références de TYPE réellement
 * exécutables — casts "::schema.type", déclarations de colonnes/variables/args
 * — qui sont toujours HORS chaîne. Les corps dollar-quotés "$$…$$" sont
 * CONSERVÉS (c'est là que vivait le bug #259 : un cast dans un corps de
 * fonction) ; seules leurs sous-chaînes "'…'" internes sont retirées.
 *
 * Faux positifs ainsi éliminés : un nom mort cité dans une chaîne — assertion
 * pgTAP "hasnt_type('…','document_statut_enum',…)", garde "prosrc ~ '…'",
 * message d'erreur — n'est PAS une référence de type exécutable.
 * L'inSingle est testé AVANT "--" : un "--" dans une chaîne n'est pas un
 * commentaire, et un "'" dans un commentaire ne démarre pas de chaîne.
 */
function codeLines(text: string): string[] {
  const raw = text.split('\n');
  const out: string[] = [];
  let inBlock = false;
  let inSingle = false;
  for (const line of raw) {
    let res = '';
    let i = 0;
    while (i < line.length) {
      if (inSingle) {
        if (line[i] === "'") {
          if (line[i + 1] === "'") {
            i += 2; // "''" échappé → reste dans la chaîne
          } else {
            inSingle = false;
            i += 1;
          }
        } else {
          i += 1; // contenu de chaîne : ignoré
        }
        continue;
      }
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end === -1) {
          i = line.length;
        } else {
          inBlock = false;
          i = end + 2;
        }
        continue;
      }
      // Commentaire de fin de ligne.
      if (line[i] === '-' && line[i + 1] === '-') {
        break;
      }
      // Ouverture de bloc.
      if (line[i] === '/' && line[i + 1] === '*') {
        inBlock = true;
        i += 2;
        continue;
      }
      // Ouverture de chaîne simple-quote.
      if (line[i] === "'") {
        inSingle = true;
        i += 1;
        continue;
      }
      res += line[i];
      i += 1;
    }
    out.push(res);
  }
  return out;
}

function main(): void {
  const migFiles = existsSync(MIG_DIR)
    ? readdirSync(MIG_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort() // tri lexicographique = ordre des timestamps
        .map((f) => join(MIG_DIR, f))
    : [];

  // 1. Recense renames (ALTER TYPE s.old RENAME TO new) et créations (CREATE TYPE
  //    s.name) sur le CODE (hors commentaires), dans l'ordre des timestamps.
  const renameRe = new RegExp(
    `ALTER\\s+TYPE\\s+(${IDENT})\\.(${IDENT})\\s+RENAME\\s+TO\\s+(${IDENT})`,
    'i',
  );
  const createRe = new RegExp(`CREATE\\s+TYPE\\s+(${IDENT})\\.(${IDENT})`, 'i');

  const renames = new Map<string, Rename>(); // fqn -> rename (garde le PLUS ANCIEN)
  const recreatedAt = new Map<string, string>(); // fqn -> ts de CREATE le plus RÉCENT

  for (const rel of migFiles) {
    const ts = tsOf(rel);
    const code = codeLines(readFileSync(rel, 'utf8')).join('\n');
    for (const m of code.matchAll(new RegExp(renameRe, 'gi'))) {
      const fqn = `${m[1]}.${m[2]}`;
      const prev = renames.get(fqn);
      if (!prev || ts < prev.renameTs) {
        renames.set(fqn, {
          fqn,
          short: m[2]!,
          schema: m[1]!,
          target: m[3]!,
          renameTs: ts,
        });
      }
    }
    for (const m of code.matchAll(new RegExp(createRe, 'gi'))) {
      const fqn = `${m[1]}.${m[2]}`;
      recreatedAt.set(fqn, ts); // dernier CREATE l'emporte
    }
  }

  // 2. Noms morts = renommés ET non recréés après le rename.
  const dead: Rename[] = [...renames.values()].filter((r) => {
    const rec = recreatedAt.get(r.fqn);
    return !(rec && rec > r.renameTs);
  });

  interface Violation {
    file: string;
    line: number;
    name: string;
    detail: string;
  }
  const violations: Violation[] = [];

  const wordRe = (short: string) =>
    new RegExp(`(?<![a-zA-Z0-9_])${short}(?![a-zA-Z0-9_])`);

  // 3a. Migrations datées APRÈS le rename. `dead` a déjà écarté les noms recréés
  //     après leur rename (step 2), donc tout nom de `dead` est mort du rename
  //     jusqu'au schéma final → une référence à ts > renameTs est bien cassée.
  //     (Le cas rename-puis-recréation-du-même-nom, inexistant ici, est traité
  //     conservativement : le nom sort de `dead`, aucune violation émise.)
  for (const rel of migFiles) {
    const ts = tsOf(rel);
    if (!ts) continue;
    const lines = codeLines(readFileSync(rel, 'utf8'));
    for (const d of dead) {
      if (!(ts > d.renameTs)) continue;
      const re = wordRe(d.short);
      lines.forEach((code, idx) => {
        if (re.test(code)) {
          violations.push({
            file: rel,
            line: idx + 1,
            name: d.fqn,
            detail: `renommé → ${d.schema}.${d.target} par migration ${d.renameTs}`,
          });
        }
      });
    }
  }

  // 3b. SQL joué contre le schéma FINAL (pgTAP) : tout nom mort final = cassé.
  const finalFiles = FINAL_SQL_DIRS.flatMap((d) => listSql(d));
  for (const rel of finalFiles) {
    const lines = codeLines(readFileSync(rel, 'utf8'));
    for (const d of dead) {
      const re = wordRe(d.short);
      lines.forEach((code, idx) => {
        if (re.test(code)) {
          violations.push({
            file: rel,
            line: idx + 1,
            name: d.fqn,
            detail: `nom mort dans le schéma final (renommé par ${d.renameTs})`,
          });
        }
      });
    }
  }

  // Rapport.
  const lines: string[] = [
    '## check-renamed-type-refs — référence à un type Postgres renommé (report-only)',
    '',
    `Renames \`ALTER TYPE … RENAME\` recensés : ${renames.size} | noms morts (non recréés) : ${dead.length}`,
    `Migrations scannées : ${migFiles.length} | fichiers SQL schéma-final : ${finalFiles.length}`,
    '',
  ];
  if (violations.length === 0) {
    lines.push(
      '✅  Aucune référence exécutable à un ancien nom de type renommé.',
    );
  } else {
    lines.push(
      `⛔  ${violations.length} référence(s) à un type renommé (le nom n'existe plus → \`db reset\` échouera) :`,
    );
    for (const v of violations) {
      lines.push(`- \`${v.file}\`:${v.line} → \`${v.name}\` (${v.detail})`);
    }
    lines.push(
      '',
      '   → utiliser le NOM COURANT du type. Vérifier avec :',
      '     `grep -E "ALTER TYPE .* RENAME" supabase/migrations/`',
    );
  }
  const report = lines.join('\n');
  console.log(report);
  console.log(`\nRATCHET_COUNT=${violations.length}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, {
      flag: 'a',
    });
  }
  // Report-only : jamais bloquant en direct (le cliquet `check:ratchet` enforce).
  process.exit(0);
}

main();
