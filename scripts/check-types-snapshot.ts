#!/usr/bin/env tsx
/**
 * check:types-snapshot — fraîcheur du snapshot de types Supabase. CLIQUET.
 * =============================================================================
 * Trou silencieux fermé (relevé PR #303, corrigé ici) : `packages/shared/src/
 * database.types.ts` est un SNAPSHOT COMMITTÉ, régénéré à la main
 * (`pnpm db:types`). Rien ne garantissait qu'il reflète les migrations. Or G7
 * (`check:column-db`) compile toute l'app contre CE snapshot : une table absente
 * du snapshot n'est pas « mal typée », elle est INVISIBLE — chaque .insert /
 * .update / .select qui la vise échappe intégralement au gate.
 *
 * Constaté : `plateforme.file_revalidation_siret` (migration 20260630130000) et
 * la RPC `fn_claim_outbox_attribution_batch` (20260911150000) manquaient au
 * snapshot. Effet de bord trompeur : G7 signalait l'appel de la RPC comme une
 * « RPC fantôme » (= défaut de code) alors que le défaut était dans le snapshot.
 * Sans ce gate, la lecture naturelle de G7 mène à « corriger » du code sain.
 *
 * Mécanique : rejeu ORDONNÉ du DDL des migrations (CREATE / DROP / RENAME), puis
 * vérification d'INCLUSION à sens unique :
 *
 *      { tables + vues créées par les migrations }  ⊆  { snapshot }
 *
 * Sens unique volontaire : le snapshot est généré depuis savr-dev, qui porte en
 * plus des objets créés à l'exécution — partitions annuelles fabriquées par
 * `f_ensure_partition_annee` (audit_log_2027…2031, integrations_logs_2027). Un
 * extra côté snapshot est inoffensif (au pire du type mort) ; c'est le MANQUE
 * qui aveugle G7. Exiger l'égalité rendrait le gate rouge en permanence.
 *
 * Périmètre = tables + vues, PAS les fonctions ni les enums :
 *   - fonctions : `supabase gen types` n'exporte pas les fonctions trigger
 *     (105 CREATE FUNCTION dans les migrations vs 67 dans le snapshot) — un
 *     contrôle d'inclusion produirait ~38 faux positifs structurels. Le cas qui
 *     compte (RPC appelée par l'app et absente du snapshot) est déjà rouge chez
 *     G7, et ne peut plus être mal diagnostiqué maintenant que la fraîcheur du
 *     snapshot est cliquetée.
 *   - enums : une valeur d'enum manquante élargit un type, elle ne masque aucune
 *     écriture. Hors du trou visé.
 *
 * Pur Node : aucune base, aucune dépendance npm → tourne dans `check:ratchet`
 * avec les autres gates légers. Émet RATCHET_COUNT, exit 0 : le blocage vient du
 * job `gate-ratchet` (baseline 0 ⇒ toute réapparition rougit la CI).
 *
 * Remède quand le gate compte > 0 : `pnpm db:types` (⚠ ce fichier s'édite
 * UNIQUEMENT par redirection Bash de la commande de génération, jamais à la
 * main), puis `pnpm check:column-db` pour mesurer ce que le snapshot frais
 * révèle.
 * =============================================================================
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';
const SNAPSHOT = 'packages/shared/src/database.types.ts';

/** Schémas réellement générés dans le snapshot (cf. script `db:types`). */
const SCHEMAS = ['plateforme', 'shared', 'public'];

// ---------------------------------------------------------------------------
// Nettoyage SQL : les corps de fonction et les commentaires sont du TEXTE, pas
// du DDL. Sans ce passage, `EXECUTE format('CREATE TABLE %I.%I PARTITION OF …')`
// (f_ensure_partition_annee) et la prose française des en-têtes (« DROP TABLE
// des anciennes… ») entrent dans le relevé. Même classe de piège que la garde
// anti-destructif, qui rougit sur un rollback écrit en commentaire.
// ---------------------------------------------------------------------------
export function stripSqlNoise(sql: string): string {
  // 1. Corps dollar-quotés ($$ … $$ / $tag$ … $tag$) — non imbriqués en SQL.
  const sansCorps = sql.replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1?\$/g,
    ' ',
  );
  // 2. Commentaires bloc puis ligne.
  return sansCorps.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const RE_CREATE_TABLE =
  /\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
const RE_CREATE_VIEW =
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
const RE_DROP =
  /\bDROP\s+(?:MATERIALIZED\s+)?(?:TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
const RE_RENAME =
  /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s+RENAME\s+TO\s+([a-z_][a-z0-9_]*)/gi;

interface Evenement {
  pos: number;
  type: 'create' | 'drop' | 'rename';
  cle: string;
  nouveau?: string;
}

/**
 * Rejeu ordonné du DDL d'un fichier. L'ordre compte : `DROP VIEW … ; CREATE VIEW
 * …` (recréation idempotente, motif courant ici) doit laisser la vue VIVANTE.
 */
function evenementsDu(sqlNettoye: string): Evenement[] {
  const evs: Evenement[] = [];
  const collecte = (re: RegExp, type: Evenement['type']) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sqlNettoye)) !== null) {
      const schema = m[1]!.toLowerCase();
      if (!SCHEMAS.includes(schema)) continue; // tms.* (V2), auth.*, storage.*…
      evs.push({
        pos: m.index,
        type,
        cle: `${schema}.${m[2]!.toLowerCase()}`,
        nouveau: m[3] ? `${schema}.${m[3].toLowerCase()}` : undefined,
      });
    }
  };
  collecte(RE_CREATE_TABLE, 'create');
  collecte(RE_CREATE_VIEW, 'create');
  collecte(RE_DROP, 'drop');
  collecte(RE_RENAME, 'rename');
  return evs.sort((a, b) => a.pos - b.pos);
}

/** Objets (tables + vues) vivants à l'issue de TOUTES les migrations. */
export function objetsDesMigrations(
  fichiers: { nom: string; sql: string }[],
): Set<string> {
  const vivants = new Set<string>();
  for (const f of [...fichiers].sort((a, b) => a.nom.localeCompare(b.nom))) {
    for (const ev of evenementsDu(stripSqlNoise(f.sql))) {
      if (ev.type === 'create') vivants.add(ev.cle);
      else if (ev.type === 'drop') vivants.delete(ev.cle);
      else if (ev.type === 'rename' && ev.nouveau) {
        vivants.delete(ev.cle);
        vivants.add(ev.nouveau);
      }
    }
  }
  return vivants;
}

/**
 * Noms de premier niveau des sections Tables + Views du snapshot, par schéma.
 * Lecture par INDENTATION (le fichier est généré par la CLI, donc régulier) :
 * 2 espaces = schéma, 4 = section, 6 = entité.
 */
export function objetsDuSnapshot(source: string): Set<string> {
  const out = new Set<string>();
  let schema: string | null = null;
  let section: string | null = null;
  for (const l of source.split('\n')) {
    let m: RegExpExecArray | null;
    if ((m = /^ {2}([a-z_][a-z0-9_]*): \{$/.exec(l))) {
      schema = m[1]!;
      section = null;
      continue;
    }
    if ((m = /^ {4}([A-Za-z]+): \{$/.exec(l))) {
      section = m[1]!;
      continue;
    }
    if (
      schema &&
      (section === 'Tables' || section === 'Views') &&
      (m = /^ {6}([A-Za-z_][A-Za-z0-9_]*): \{$/.exec(l))
    ) {
      out.add(`${schema}.${m[1]!}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auto-test du détecteur (cliquet sur le cliquet). Un gate qui ne détecte plus
// rien est vert : le vert n'est une preuve que si l'on prouve d'abord que le
// rouge est atteignable. On rejoue donc le cas RÉEL qui a motivé ce gate.
// ---------------------------------------------------------------------------
function autoTest(): void {
  const snapshot = `
  plateforme: {
    Tables: {
      collectes: {
      }
      v_pas_une_vue_ici: {
      }
    }
    Views: {
      v_kpi_admin: {
      }
    }
    Functions: {
      f_app_role: {
      }
    }
  }
`;
  const migrations = [
    {
      nom: '20260101000000_a.sql',
      sql: `
        -- DROP TABLE des anciennes structures (prose : ne doit RIEN retirer)
        CREATE TABLE plateforme.collectes (id uuid);
        CREATE TABLE plateforme.file_revalidation_siret (id uuid);
        CREATE TABLE tms.pesees (id uuid);
        CREATE OR REPLACE FUNCTION plateforme.f_ensure_partition_annee() RETURNS void AS $$
        BEGIN
          EXECUTE format('CREATE TABLE plateforme.%I PARTITION OF plateforme.audit_log', 'audit_log_2031');
        END; $$ LANGUAGE plpgsql;
      `,
    },
    {
      nom: '20260102000000_b.sql',
      sql: `
        CREATE TABLE plateforme.obsolete (id uuid);
        DROP TABLE IF EXISTS plateforme.obsolete;
        DROP VIEW IF EXISTS plateforme.v_kpi_admin;
        CREATE VIEW plateforme.v_kpi_admin AS SELECT 1;
      `,
    },
  ];

  const vivants = objetsDesMigrations(migrations);
  const connus = objetsDuSnapshot(snapshot);
  const manquants = [...vivants].filter((o) => !connus.has(o)).sort();

  const attendu = ['plateforme.file_revalidation_siret'];
  const echecs: string[] = [];
  if (JSON.stringify(manquants) !== JSON.stringify(attendu)) {
    echecs.push(
      `manquants attendus ${JSON.stringify(attendu)}, obtenus ${JSON.stringify(manquants)}`,
    );
  }
  // Assertions de non-vacuité, une par piège fermé :
  if (vivants.has('plateforme.audit_log_2031'))
    echecs.push('CREATE TABLE dans un corps $$…$$ compté comme DDL réel');
  if (vivants.has('tms.pesees')) echecs.push('objet tms.* (hors V1) compté');
  if (vivants.has('plateforme.obsolete'))
    echecs.push('table DROPée encore vivante');
  if (!vivants.has('plateforme.v_kpi_admin'))
    echecs.push(
      'vue DROP puis CREATE dans le même fichier perdue (ordre non respecté)',
    );
  if (
    !connus.has('plateforme.v_kpi_admin') ||
    !connus.has('plateforme.collectes')
  )
    echecs.push('lecture du snapshot (Tables/Views) défaillante');

  if (echecs.length > 0) {
    console.error(
      '⛔ check-types-snapshot : AUTO-TEST EN ÉCHEC — détecteur non fiable :',
    );
    for (const e of echecs) console.error(`   - ${e}`);
    process.exit(1);
  }
}

function main(): void {
  autoTest();

  const fichiers = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((nom) => ({
      nom,
      sql: readFileSync(join(MIGRATIONS_DIR, nom), 'utf8'),
    }));

  const vivants = objetsDesMigrations(fichiers);
  const connus = objetsDuSnapshot(readFileSync(SNAPSHOT, 'utf8'));
  const manquants = [...vivants].filter((o) => !connus.has(o)).sort();

  if (manquants.length > 0) {
    console.error(
      `🔴 check-types-snapshot : ${manquants.length} objet(s) créé(s) par les migrations ` +
        `ABSENT(S) de ${SNAPSHOT} (${fichiers.length} migrations, ${vivants.size} objets vivants) :`,
    );
    for (const o of manquants) console.error(`   - ${o}`);
    console.error(
      '   → snapshot périmé : toute écriture sur ces objets échappe à `check:column-db` (G7).',
    );
    console.error(
      '   → régénérer par redirection Bash : `pnpm db:types` (jamais à la main), puis `pnpm check:column-db`.',
    );
  } else {
    console.log(
      `✅ check-types-snapshot : les ${vivants.size} objets créés par les ${fichiers.length} ` +
        'migrations sont tous présents dans le snapshot de types.',
    );
  }
  console.log(`RATCHET_COUNT=${manquants.length}`);
}

main();
