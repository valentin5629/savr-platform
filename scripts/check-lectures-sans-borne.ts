#!/usr/bin/env tsx
/**
 * check-lectures-sans-borne — toute lecture de lignes dit sa borne.
 * =============================================================================
 * Problème fermé (PR #772, 2026-11-11) : l'API de données ampute une réponse à
 * `max_rows` lignes (1000, `supabase/config.toml`) SANS erreur, et un filtre
 * `in.(…)` de quelques centaines d'identifiants fait échouer la lecture (390
 * passent, 402 échouent — mesures en tête de
 * `packages/plateforme/src/lib/pdf/selection-par-pages.ts`). Le défaut ne se
 * voit pas tant que la base est petite : au-delà de 1 000 lignes, une vingtaine
 * de lectures auraient rendu des totaux faux ou des colonnes vides sans qu'aucun
 * test ne le montre, et rien n'empêchait d'en écrire une de plus.
 *
 * Ce que le gate compte : les LECTURES DE LIGNES — `….from(table).select(…)`,
 * et tout autre appel `x.select(colonnes)` ou `x['select'](colonnes)` qui ne
 * suit pas une écriture — du code non-test de
 * `packages/{plateforme,adapters,shared}/src` (fichiers `.ts`, `.tsx`, `.js`,
 * `.jsx` et leurs variantes `.mts`, `.cts`, `.mjs`, `.cjs`) qui ne portent
 * aucune borne visible. Une lecture est BORNÉE si :
 *   ✅ elle porte `.limit(n)` ou `.range(a, b)` (sur elle-même, pas sur une table
 *      jointe ; un nombre écrit en dur au-dessus du plafond — `5000`, `(5000)`,
 *      `+5000`, `2 * 1000` — ne compte pas : la réponse serait amputée quand même) ;
 *   ✅ elle porte `.single()` ou `.maybeSingle()` (une ligne au plus) ;
 *   ✅ c'est un comptage `select(…, { head: true })` (aucune ligne rendue) ;
 *   ✅ elle est RENDUE à une aide de lecture relue (liste `AIDES`) :
 *      `lireParPages`, `lireParLots`, `lireParTranches` et leurs deux variantes
 *      locales — elles découpent la lecture en pages, en tranches ou en lots.
 *   ❌ `const { data } = await supabase.from('collectes').select('id')`
 *   ❌ `await Promise.all([supabase.from('lieux').select('*'), …])`
 *
 * La requête est SUIVIE dans son fichier quand elle est construite en plusieurs
 * temps :
 *   – rangée dans une variable (`let q = …; if (x) q = q.eq(…); await q.range(…)`) :
 *     bornée si chacune de ses exécutions porte une borne, ou vient APRÈS (dans
 *     l'ordre du texte) une réaffectation SANS condition qui en pose une. Sous
 *     condition = sous un `if`, un ternaire, un `switch`, une boucle, un `try`,
 *     une fonction, `&&`, `||` ou `??` : `if (!tout) q = q.range(…)` et
 *     `q = tout ? q : q.range(…)` ne bornent rien. Une variable qui reçoit une
 *     SECONDE requête (`q = autre…`) n'est jugée que sur ses exécutions ;
 *   – rendue par une fonction locale (`const requete = () => supabase.from(…)…`) :
 *     bornée si TOUS les appels de cette fonction le sont, ou si la fonction est
 *     passée à une aide. Exportée, elle est signalée (appels hors du fichier) ;
 *   – passée à une fonction (`appliquerFiltres(q, f)`) : réputée rendue telle
 *     quelle, la suite de la chaîne décide.
 *
 * Exemptions :
 *   ⚪ les tests et l'outillage de test (`*.test.*`, `*.spec.*`, `test-utils/`,
 *      `__tests__/`, `__mocks__/`) : ils ne tournent pas en production ;
 *   ⚪ les écritures qui rendent leurs lignes (`.insert(…).select()`,
 *      `.update(…).eq(…).select()`) : ce ne sont pas des lectures de liste ;
 *   ⚪ la lecture précédée du commentaire `// borne-par-nature: <raison>` (au
 *      moins 10 caractères de raison), posé au-dessus de l'instruction — ou de
 *      l'élément de liste d'un `Promise.all` — qui la porte, ou en fin d'une de
 *      ses lignes. Un commentaire pour UNE lecture : s'il coiffe une instruction
 *      qui en porte plusieurs, il n'en exempte aucune ; écrit dans une chaîne de
 *      caractères, il ne compte pas. Pour une lecture petite par nature
 *      (paramètres, lignes d'une seule collecte) : une limite arbitraire
 *      pourrait, elle, amputer pour de bon. Ces exemptions sont affichées à
 *      chaque passage, jamais comptées.
 *
 * Listes `.in(colonne, liste)` (décision Val 2026-11-11) : pas de compteur à
 * part, le gate ne regarde pas les `.in(…)`. Une lecture filtrée par une liste
 * est signalée comme les autres quand elle n'a pas de borne — la correction
 * attendue est alors `lireParLots`, pas une limite. Dans une lecture déjà bornée
 * (page d'écran filtrée par des cases cochées ou par les lieux d'un parc), la
 * liste n'est pas comptée : au-delà d'environ 390 identifiants la lecture
 * échoue, avec une erreur visible.
 *
 * CE QUE LE GATE NE VOIT PAS (assumé, écrit pour qu'on ne lui prête pas plus) :
 *   – une borne mal choisie : il vérifie qu'une borne est écrite, pas qu'elle est
 *     juste (`.limit(1000)` sur une liste qui peut dépasser le fait taire ; un
 *     nombre au-dessus du plafond caché dans une constante aussi) ;
 *   – une lecture corrigée et une autre ajoutée dans le même lot : le compteur
 *     ne bouge pas ;
 *   – ce que font les aides de la liste `AIDES` : il leur fait confiance, leurs
 *     propres tests les tiennent ;
 *   – une fonction de base appelée par `.rpc(…)` sans `.select(colonnes)`
 *     derrière elle (avec, l'appel est compté comme une autre lecture) ;
 *   – les listes écrites dans un filtre en texte (`.or('id.in.(…)')`), les
 *     listes `.in(…)` des écritures ;
 *   – un `.select()` SANS argument écrit ailleurs que sur un `.from(…)` (requête
 *     rangée dans une variable avant d'être lue) : il ne se distingue pas du
 *     `select()` d'un champ de saisie. Aucun sur l'arbre du 2026-11-11 ;
 *   – un `.select` détaché de sa requête avant d'être appelé (`t.select.bind(t)`,
 *     `const { select } = t`) ;
 *   – une lecture écrite dans un fichier de test ou d'outillage de test que du
 *     code de production importerait : les imports ne sont pas suivis ;
 *   – un dossier atteint par un lien symbolique : ni le parcours du disque ni
 *     git n'y entrent ;
 *   – `apps/`, `scripts/`, `packages/tms`.
 *
 * CE QU'IL SIGNALE À TORT, du bon côté :
 *   – une lecture attendue DANS le rappel d'une aide (`await` puis `return` des
 *     lignes) — rendre la requête à l'aide ;
 *   – une borne posée dans CHAQUE branche d'un ternaire
 *     (`q = c ? q.limit(5) : q.range(a, b)`) ;
 *   – une borne posée dans un `try` quand la requête est exécutée après lui ;
 *   – toutes les requêtes d'une variable qui en reçoit plusieurs, dès qu'une de
 *     ses exécutions ne porte pas sa propre borne.
 *
 * Le détecteur s'auto-teste à chaque exécution : SONDES ; règle des fichiers
 * lus sondée chemin par chemin ; liste `AIDES` relue sur disque ; liste des
 * fichiers établie deux fois, par deux écritures de la même règle, et
 * recoupée ; plancher de lectures vues par racine ; refus d'un fichier lu avec
 * des erreurs de syntaxe ; plafond de la base comparé à celui avec lequel le
 * gate a été relu. Un cliquet devenu aveugle afficherait sinon un compteur en
 * baisse, que le méta-cliquet lirait comme un progrès. Auto-test en échec = pas
 * de RATCHET_COUNT = `check:ratchet` rouge. Le script exige git (recoupement de
 * la liste des fichiers) : hors d'un dépôt, il s'arrête sans compteur.
 *
 * Émet RATCHET_COUNT=<n> — câblé dans `pnpm check:ratchet`. Baseline = les
 * lectures déjà là ; chaque lot qui en borne une la fait descendre.
 * =============================================================================
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const NOM = 'check-lectures-sans-borne';
const SRC = 'packages/plateforme/src';

/**
 * Racines lues → nombre de lectures qu'on doit AU MOINS y voir. Second filet,
 * grossier : la liste des fichiers est d'abord recoupée (cf. `fichiers`), ce
 * plancher n'arrête que la disparition d'un pan entier de lectures. Il laisse
 * passer tout ce qui tient dans sa marge : 484, 29 et 6 lectures vues le
 * 2026-11-11. Si des lectures ont réellement disparu, baisser le plancher.
 */
const RACINES: Record<string, number> = {
  [SRC]: 400,
  'packages/adapters/src': 20,
  'packages/shared/src': 4,
};

/**
 * Aides de lecture RELUES : fichier → fonctions de premier niveau qui découpent
 * la lecture. Un appel n'est reconnu que s'il désigne l'une d'elles — importée
 * de son fichier (alias compris) ou définie ici même. Une fonction homonyme
 * écrite ailleurs n'est pas une aide. En ajouter une = la faire relire.
 */
const AIDES: Record<string, string[]> = {
  // pages de 200 triées par `id` ; lots de 100 identifiants, erreur au plafond
  [`${SRC}/lib/pdf/selection-par-pages.ts`]: ['lireParPages', 'lireParLots'],
  // tranches `.range()` jusqu'au total ; lots de 100 identifiants
  [`${SRC}/lib/exports/shared.ts`]: [
    'lireParTranches',
    'lireParLotsHorsListeBlanche',
  ],
  // enveloppe de `lireParLots` qui lève l'erreur au lieu de la rendre
  [`${SRC}/lib/montant-prestation.ts`]: ['lireParLots'],
};

const BORNES = new Set(['limit', 'range', 'single', 'maybeSingle']);
/** Écritures : le `.select()` qui les suit rend les lignes écrites. */
const ECRITURES = new Set(['insert', 'update', 'upsert', 'delete']);
const MARQUEUR = /borne-par-nature\s*:\s*([^\n]*)/;
const RAISON_MIN = 10;

function echec(message: string): never {
  console.error(
    `🔴 ${NOM} : DÉTECTEUR EN ÉCHEC — ${message}\n   Le gate ne prouve plus rien : pas de compteur émis.`,
  );
  process.exit(1);
}

/**
 * Plafond de lignes d'une réponse avec lequel ce gate et ses aides ont été relus.
 * Il est lu là où il est réglé ; s'il y change, le gate s'arrête : les aides de
 * lecture découpent en fonction de lui, elles sont à relire avant le compteur.
 */
const PLAFOND_RELU = 1000;

function plafondDeLaBase(): number {
  const m = /^max_rows\s*=\s*(\d+)\s*$/m.exec(
    readFileSync('supabase/config.toml', 'utf8'),
  );
  if (!m) echec('`max_rows` introuvable dans supabase/config.toml.');
  const lu = Number(m[1]);
  if (lu !== PLAFOND_RELU)
    echec(
      `\`max_rows\` vaut ${lu} dans supabase/config.toml, ${PLAFOND_RELU} attendu. ` +
        'Relire les aides de lecture (liste AIDES), puis mettre PLAFOND_RELU à jour.',
    );
  return lu;
}
const PLAFOND = plafondDeLaBase();

// ── Petits outils de lecture de l'arbre ──────────────────────────────────────

type Fn =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

function estFn(n: ts.Node): n is Fn {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n)
  );
}

function fonctionEnglobante(n: ts.Node): Fn | null {
  for (let p = n.parent; p; p = p.parent) if (estFn(p)) return p;
  return null;
}

type Portee =
  | ts.Block
  | ts.SourceFile
  | ts.ModuleBlock
  | ts.CaseClause
  | ts.DefaultClause;

function estPortee(n: ts.Node): n is Portee {
  return (
    ts.isBlock(n) ||
    ts.isSourceFile(n) ||
    ts.isModuleBlock(n) ||
    ts.isCaseClause(n) ||
    ts.isDefaultClause(n)
  );
}

/** Bloc où vit une déclaration (ou la boucle `for` qui la déclare). */
function porteeDe(n: ts.Node): ts.Node {
  for (let p = n.parent; p; p = p.parent) {
    if (estPortee(p) || ts.isForStatement(p) || ts.isForOfStatement(p))
      return p;
  }
  return n.getSourceFile();
}

/** Enveloppes sans effet sur la requête : `(q)`, `q as T`, `q!`, `c ? q : r`. */
function enveloppe(p: ts.Node, cur: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(p) ||
    ts.isAsExpression(p) ||
    ts.isNonNullExpression(p) ||
    ts.isSatisfiesExpression(p) ||
    ts.isTypeAssertionExpression(p) ||
    (ts.isConditionalExpression(p) &&
      (p.whenTrue === cur || p.whenFalse === cur))
  );
}

function nomme(liaison: ts.BindingName, nom: string): boolean {
  if (ts.isIdentifier(liaison)) return liaison.text === nom;
  return liaison.elements.some(
    (e) => ts.isBindingElement(e) && nomme(e.name, nom),
  );
}

/**
 * Déclaration que désigne un nom là où il est écrit : variable, fonction,
 * paramètre ou import. Résolution lexicale simple (`let`/`const`, pas de `var`
 * remonté) — elle suffit à ne pas confondre deux `q` de deux fonctions, ni un
 * paramètre nommé comme une aide avec l'aide.
 */
function declarationDe(id: ts.Identifier): ts.Node | null {
  const nom = id.text;
  for (let n: ts.Node = id; n.parent; n = n.parent) {
    const p = n.parent;
    if (estFn(p)) {
      for (const prm of p.parameters) if (nomme(prm.name, nom)) return prm;
      if (ts.isFunctionExpression(p) && p.name?.text === nom) return p;
    }
    if (
      ts.isCatchClause(p) &&
      p.variableDeclaration &&
      nomme(p.variableDeclaration.name, nom)
    )
      return p.variableDeclaration;
    if (
      (ts.isForStatement(p) ||
        ts.isForOfStatement(p) ||
        ts.isForInStatement(p)) &&
      p.initializer &&
      ts.isVariableDeclarationList(p.initializer)
    ) {
      for (const d of p.initializer.declarations)
        if (nomme(d.name, nom)) return d;
    }
    if (!estPortee(p)) continue;
    for (const st of p.statements) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations)
          if (nomme(d.name, nom)) return d;
      } else if (
        (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) &&
        st.name?.text === nom
      ) {
        return st;
      } else if (ts.isImportDeclaration(st) && st.importClause) {
        const c = st.importClause;
        if (c.name?.text === nom) return c;
        const b = c.namedBindings;
        if (b && ts.isNamespaceImport(b) && b.name.text === nom) return b;
        if (b && ts.isNamedImports(b)) {
          for (const el of b.elements) if (el.name.text === nom) return el;
        }
      }
    }
  }
  return null;
}

/** Le nom est-il LU ici (ni déclaré, ni écrit, ni simple nom de propriété) ? */
function estUnUsage(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isMethodDeclaration(p) && p.name === id) return false;
  if (
    (ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isParameter(p)) &&
    p.name === id
  )
    return false;
  return !(
    ts.isBinaryExpression(p) &&
    p.left === id &&
    p.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

/** `q = …` ou `const q = …` : la variable qui reçoit `cur`. */
function variableAffectee(p: ts.Node, cur: ts.Node): ts.Identifier | null {
  if (
    ts.isVariableDeclaration(p) &&
    p.initializer === cur &&
    ts.isIdentifier(p.name)
  )
    return p.name;
  if (
    ts.isBinaryExpression(p) &&
    p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    p.right === cur &&
    ts.isIdentifier(p.left)
  )
    return p.left;
  return null;
}

/**
 * Entre l'affectation `n` et la portée de la variable, y a-t-il de quoi ne pas
 * l'exécuter : `if`, ternaire, `switch`, boucle (zéro tour), `try` (une erreur
 * attrapée avant elle) ou son `catch`, fonction (jamais appelée), `&&` `||` `??` ?
 */
function sousCondition(n: ts.Node, portee: ts.Node): boolean {
  for (let p = n.parent; p && p !== portee; p = p.parent) {
    if (
      ts.isIfStatement(p) ||
      ts.isConditionalExpression(p) ||
      ts.isSwitchStatement(p) ||
      ts.isTryStatement(p) ||
      ts.isIterationStatement(p, false) ||
      estFn(p)
    )
      return true;
    if (
      ts.isBinaryExpression(p) &&
      (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    )
      return true;
  }
  return false;
}

function resoudre(spec: string, depuis: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('@savr/'))
    base = path.join('packages', spec.slice('@savr/'.length));
  else if (spec.startsWith('.')) base = path.join(path.dirname(depuis), spec);
  else return null;
  base = base.replace(/\.js$/, '');
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

/**
 * Valeur d'un nombre écrit en dur : `5000`, `(5000)`, `+5000`, `2 * 1000`.
 * `null` dès qu'un nom entre dans le calcul (constante, variable).
 */
function nombreEcrit(e: ts.Expression | undefined): number | null {
  if (!e) return null;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e))
    return nombreEcrit(e.expression);
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isPrefixUnaryExpression(e)) {
    const n = nombreEcrit(e.operand);
    if (n === null) return null;
    if (e.operator === ts.SyntaxKind.PlusToken) return n;
    return e.operator === ts.SyntaxKind.MinusToken ? -n : null;
  }
  if (ts.isBinaryExpression(e)) {
    const g = nombreEcrit(e.left);
    const d = nombreEcrit(e.right);
    if (g === null || d === null) return null;
    if (e.operatorToken.kind === ts.SyntaxKind.PlusToken) return g + d;
    if (e.operatorToken.kind === ts.SyntaxKind.MinusToken) return g - d;
    return e.operatorToken.kind === ts.SyntaxKind.AsteriskToken ? g * d : null;
  }
  return null;
}

/** `limit` / `range` / `single` / `maybeSingle` qui borne vraiment la lecture. */
function borneValide(nom: string, appel: ts.CallExpression): boolean {
  if (!BORNES.has(nom)) return false;
  // `limit(5, { referencedTable })` borne une table jointe, pas la lecture.
  const tableJointe = appel.arguments.some(
    (a) =>
      ts.isObjectLiteralExpression(a) &&
      a.properties.some(
        (p) =>
          p.name &&
          ts.isIdentifier(p.name) &&
          /^(referencedTable|foreignTable)$/.test(p.name.text),
      ),
  );
  if (tableJointe) return false;
  if (nom === 'limit') {
    const n = nombreEcrit(appel.arguments[0]);
    if (n !== null && n > PLAFOND) return false;
  }
  if (nom === 'range') {
    const de = nombreEcrit(appel.arguments[0]);
    const a = nombreEcrit(appel.arguments[1]);
    if (de !== null && a !== null && a - de + 1 > PLAFOND) return false;
  }
  return true;
}

// ── Suivi d'une requête jusqu'à son exécution ────────────────────────────────

type Suite =
  | { t: 'bornee'; motif: string }
  | { t: 'sans'; motif: string }
  // La requête retourne dans une variable dont l'examen est en cours
  // (`q = q.eq(…)`). `dUneBranche` : la borne n'a été posée que dans une branche
  // d'un `c ? a : b` (`q = tout ? q : q.range(…)`), elle ne vaut donc pas toujours.
  | {
      t: 'retour';
      vers: ts.Node;
      borne: string | null;
      dUneBranche: boolean;
      noeud: ts.Node;
    };

const bornee = (motif: string): Suite => ({ t: 'bornee', motif });
const sans = (motif: string): Suite => ({ t: 'sans', motif });

class Suivi {
  private enCours = new Set<ts.Node>();

  constructor(private fichier: string) {}

  /** L'identifiant appelé désigne-t-il une aide relue ? */
  private estAide(id: ts.Identifier): boolean {
    const d = declarationDe(id);
    if (!d) return false;
    if (ts.isImportSpecifier(d)) {
      const origine = d.parent.parent.parent.moduleSpecifier;
      const cible = ts.isStringLiteral(origine)
        ? resoudre(origine.text, this.fichier)
        : null;
      return (
        !!cible &&
        (AIDES[cible] ?? []).includes((d.propertyName ?? d.name).text)
      );
    }
    return (
      ts.isFunctionDeclaration(d) &&
      ts.isSourceFile(d.parent) &&
      (AIDES[this.fichier] ?? []).includes(id.text)
    );
  }

  /** `n` est-il passé (tel quel, ou par un ternaire) à une aide ? Son nom. */
  private aideRecevant(n: ts.Node): string | null {
    let cur = n;
    for (;;) {
      const p = cur.parent;
      if (enveloppe(p, cur)) {
        cur = p;
        continue;
      }
      return ts.isCallExpression(p) &&
        p.arguments.includes(cur as ts.Expression) &&
        ts.isIdentifier(p.expression) &&
        this.estAide(p.expression)
        ? p.expression.text
        : null;
    }
  }

  /** Suit la requête portée par `depart` jusqu'à ce qu'elle soit bornée ou exécutée. */
  suivre(depart: ts.Node): Suite {
    let cur = depart;
    let borne: string | null = null;
    let dUneBranche = false;
    for (;;) {
      const p = cur.parent;
      // Méthode chaînée : `.eq(…)`, `.order(…)`, `.limit(…)`…
      if (ts.isPropertyAccessExpression(p) && p.expression === cur) {
        const appel = p.parent;
        if (!ts.isCallExpression(appel) || appel.expression !== p)
          return borne ? bornee(borne) : sans('exécutée sans borne');
        // `.then(…)` rend une promesse : la suite la traite comme la requête
        // (attendue, rangée dans une liste, rendue à une aide…).
        if (borneValide(p.name.text, appel) && (!borne || dUneBranche)) {
          borne = p.name.text;
          dUneBranche = false; // posée après le ternaire : elle vaut pour ses deux branches
        }
        cur = appel;
        continue;
      }
      if (enveloppe(p, cur)) {
        if (borne && ts.isConditionalExpression(p)) dUneBranche = true;
        cur = p;
        continue;
      }
      const cible = variableAffectee(p, cur);
      if (cible) {
        const decl = declarationDe(cible);
        if (decl && this.enCours.has(decl))
          return { t: 'retour', vers: decl, borne, dUneBranche, noeud: p };
        if (borne) return bornee(borne);
        return decl && ts.isVariableDeclaration(decl)
          ? this.suivreVariable(decl, cible.text)
          : sans(
              `rangée dans « ${cible.text} », qui n'est pas une variable locale`,
            );
      }
      if (borne) return bornee(borne);
      if (ts.isAwaitExpression(p)) return sans('exécutée sans borne (await)');
      if (
        ts.isReturnStatement(p) ||
        (ts.isArrowFunction(p) && p.body === cur)
      ) {
        const fn = ts.isArrowFunction(p) ? p : fonctionEnglobante(p);
        return fn ? this.suivreFonction(fn) : sans('exécutée sans borne');
      }
      // `f(q, …)` : la requête traverse la fonction, la suite de la chaîne décide.
      if (
        ts.isCallExpression(p) &&
        p.arguments.includes(cur as ts.Expression)
      ) {
        cur = p;
        continue;
      }
      // Élément d'un `Promise.all([...])`, propriété d'un objet… : exécutée ailleurs.
      return sans('exécutée sans borne');
    }
  }

  /**
   * Variable qui porte une requête. Bornée si chacune de ses exécutions porte
   * une borne, ou vient APRÈS (dans l'ordre du texte) une réaffectation sans
   * condition qui en pose une (`q = q.range(…)`). Le déroulement réel n'est pas
   * suivi : une variable qui reçoit une SECONDE requête (`q = autre…`) n'est
   * donc jugée que sur ses exécutions.
   */
  private suivreVariable(decl: ts.VariableDeclaration, nom: string): Suite {
    this.enCours.add(decl);
    try {
      const portee = porteeDe(decl);
      const sures: { fin: number; borne: string }[] = [];
      let borneConditionnelle = false;
      const fins: { pos: number; suite: Suite }[] = [];
      const affectations: ts.Node[] = []; // toutes les `q = …`
      const derivees = new Set<ts.Node>(); // celles dont la valeur vient de `q`
      const visiter = (n: ts.Node): void => {
        if (ts.isTypeNode(n)) return; // `typeof q` dans un type : pas un usage
        if (ts.isIdentifier(n) && n.text === nom && declarationDe(n) === decl) {
          const p = n.parent;
          if (
            ts.isBinaryExpression(p) &&
            p.left === n &&
            p.operatorToken.kind === ts.SyntaxKind.EqualsToken
          )
            affectations.push(p);
          else if (estUnUsage(n)) {
            const s = this.suivre(n);
            if (s.t !== 'retour') fins.push({ pos: n.getStart(), suite: s });
            else if (s.vers !== decl)
              fins.push({
                pos: n.getStart(),
                suite: sans('exécutée sans borne'),
              });
            else {
              derivees.add(s.noeud);
              if (!s.borne) {
                // `q = q.eq(…)` : ni borne, ni exécution
              } else if (s.dUneBranche || sousCondition(s.noeud, portee))
                borneConditionnelle = true;
              else sures.push({ fin: s.noeud.getEnd(), borne: s.borne });
            }
          }
        }
        ts.forEachChild(n, visiter);
      };
      visiter(portee);
      const requetes =
        (decl.initializer ? 1 : 0) +
        affectations.filter((a) => !derivees.has(a)).length;
      const couverte = (pos: number): string | null =>
        requetes > 1 ? null : (sures.find((b) => b.fin <= pos)?.borne ?? null);
      const ouverte = fins.find(
        (f) => f.suite.t !== 'bornee' && !couverte(f.pos),
      );
      if (fins.length === 0)
        return sans(`« ${nom} » jamais exécutée dans sa portée`);
      if (!ouverte) {
        const premiere = fins[0]!;
        const motif =
          premiere.suite.t === 'bornee'
            ? premiere.suite.motif
            : (couverte(premiere.pos) ?? 'borne');
        return bornee(`${motif} (via ${nom})`);
      }
      if (borneConditionnelle)
        return sans(`borne posée sous condition sur « ${nom} »`);
      if (sures.length > 0)
        return sans(
          requetes > 1
            ? `« ${nom} » reçoit plusieurs requêtes : chaque exécution doit porter sa borne`
            : `exécutée avant d'être bornée, via « ${nom} »`,
        );
      return sans(
        `${ouverte.suite.t === 'sans' ? ouverte.suite.motif : 'exécutée sans borne'}, via « ${nom} »`,
      );
    } finally {
      this.enCours.delete(decl);
    }
  }

  /**
   * Requête rendue par une fonction. Bornée si la fonction est le rappel d'une
   * aide, ou si elle porte un nom local dont TOUS les usages sont bornés.
   */
  private suivreFonction(fn: Fn): Suite {
    const aide = this.aideRecevant(fn);
    if (aide) return bornee(`aide ${aide}`);

    let decl: ts.FunctionDeclaration | ts.VariableDeclaration | null = null;
    if (ts.isFunctionDeclaration(fn) && fn.name) decl = fn;
    else if (
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      ts.isVariableDeclaration(fn.parent) &&
      fn.parent.initializer === fn &&
      ts.isIdentifier(fn.parent.name)
    )
      decl = fn.parent;
    if (!decl || !decl.name || !ts.isIdentifier(decl.name))
      return sans('rendue par une fonction sans nom, hors aide');
    const nom = decl.name.text;
    const porteur = ts.isFunctionDeclaration(decl) ? decl : decl.parent.parent;
    if (
      ts.canHaveModifiers(porteur) &&
      ts
        .getModifiers(porteur)
        ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      return sans(`rendue par ${nom}(), exportée : appels hors du fichier`);
    if (this.enCours.has(decl)) return sans('exécutée sans borne');
    this.enCours.add(decl);
    try {
      let usages = 0;
      let ouvert: string | null = null;
      const visiter = (n: ts.Node): void => {
        if (ts.isTypeNode(n)) return;
        if (
          ts.isIdentifier(n) &&
          n.text === nom &&
          estUnUsage(n) &&
          declarationDe(n) === decl
        ) {
          usages++;
          const p = n.parent;
          let s: Suite;
          if (ts.isCallExpression(p) && p.expression === n) s = this.suivre(p);
          else {
            const a = this.aideRecevant(n);
            s = a ? bornee(`aide ${a}`) : sans('passée sans être appelée');
          }
          if (s.t !== 'bornee')
            ouvert ??= s.t === 'sans' ? s.motif : 'exécutée sans borne';
        }
        ts.forEachChild(n, visiter);
      };
      visiter(porteeDe(decl));
      if (usages === 0)
        return sans(`rendue par ${nom}(), jamais appelée dans le fichier`);
      return ouvert
        ? sans(`rendue par ${nom}() : ${ouvert as string}`)
        : bornee(`tous les appels de ${nom}()`);
    } finally {
      this.enCours.delete(decl);
    }
  }
}

// ── Les lectures d'un fichier ────────────────────────────────────────────────

type Lecture = {
  fichier: string;
  ligne: number;
  table: string;
  etat: 'bornee' | 'exemptee' | 'signalee';
  /** La borne trouvée, la raison de l'exemption, ou ce qui manque. */
  motif: string;
};

/** `x.m(…)` : la méthode appelée et ce sur quoi elle l'est. */
function appelDeMethode(
  n: ts.Node,
): { nom: string; sur: ts.Expression; ou: ts.Node } | null {
  if (!ts.isCallExpression(n)) return null;
  const e = n.expression;
  if (ts.isPropertyAccessExpression(e))
    return { nom: e.name.text, sur: e.expression, ou: e.name };
  // `x['select'](…)` : le même appel, écrit entre crochets.
  if (
    ts.isElementAccessExpression(e) &&
    ts.isStringLiteralLike(e.argumentExpression)
  )
    return {
      nom: e.argumentExpression.text,
      sur: e.expression,
      ou: e.argumentExpression,
    };
  return null;
}

/** Table lue par `….from(table).select(…)`, ou null si le `.select` est ailleurs. */
function tableDe(lecture: ts.CallExpression): ts.Expression | null {
  const sur = appelDeMethode(lecture)!.sur;
  return appelDeMethode(sur)?.nom === 'from'
    ? ((sur as ts.CallExpression).arguments[0] ?? null)
    : null;
}

/**
 * Un `.select(…)` qui lit des lignes. Sur les 519 lectures du dépôt, 518 ont la
 * forme `….from(table).select(…)` (inventaire du 2026-11-11). Un `.select` qui
 * suit une écriture (`.insert(…).select()`) rend ce qu'elle vient d'écrire : ce
 * n'est pas une lecture de liste. Tout autre APPEL `x.select(…)` ou
 * `x['select'](…)` — `.from(…)` rangé dans une variable, enveloppe maison,
 * résultat d'un `.rpc(…)` (la 519e lecture, entrée avec la PR #775 :
 * `packages/plateforme/src/app/api/v1/programmation/lieux/route.ts`) — est
 * compté dès qu'il nomme ses colonnes, pour qu'une façon nouvelle d'écrire une
 * lecture ne rende pas le gate aveugle ; sans argument, ce peut être le
 * `select()` d'un champ de saisie. Un `.select` détaché (`.bind`, déstructuré)
 * n'est pas un appel de cette forme : il n'est pas vu.
 */
function estLecture(n: ts.Node): n is ts.CallExpression {
  const select = appelDeMethode(n);
  if (select?.nom !== 'select') return false;
  if (appelDeMethode(select.sur)?.nom === 'from') return true;
  for (let m = appelDeMethode(select.sur); m; m = appelDeMethode(m.sur)) {
    if (ECRITURES.has(m.nom)) return false;
  }
  return (n as ts.CallExpression).arguments.length > 0;
}

/** `select(…, { head: true })` : un comptage, aucune ligne rendue. */
function comptageSeul(lecture: ts.CallExpression): boolean {
  return lecture.arguments.some(
    (a) =>
      ts.isObjectLiteralExpression(a) &&
      a.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          ts.isIdentifier(p.name) &&
          p.name.text === 'head' &&
          p.initializer.kind === ts.SyntaxKind.TrueKeyword,
      ),
  );
}

/** `pos` tombe-t-elle dans un jeton (chaîne, gabarit, code) plutôt que dans un commentaire ? */
function dansUnJeton(src: ts.SourceFile, pos: number): boolean {
  let n: ts.Node = src;
  for (;;) {
    const enfant = n
      .getChildren(src)
      .find((c) => c.getStart(src) <= pos && pos < c.getEnd());
    if (!enfant) return false;
    if (enfant.getChildCount(src) === 0) return true;
    n = enfant;
  }
}

/**
 * Raison écrite dans un commentaire `borne-par-nature:` attaché à la lecture :
 * au-dessus de l'instruction qui la porte (ou de l'élément de liste, du corps de
 * rappel, de la propriété), ou sur l'une des lignes de sa chaîne. Un commentaire
 * au-dessus d'un `Promise.all([...])` n'exempte donc aucune de ses lectures.
 */
function raisonDExemption(lecture: ts.CallExpression): string | null {
  const src = lecture.getSourceFile();
  const texte = src.text;
  let ancre: ts.Node = lecture;
  let sommet: ts.Node | null = null; // fin de la chaîne `.eq(…).order(…)`
  for (;;) {
    const p = ancre.parent;
    if (
      estPortee(p) ||
      ts.isArrayLiteralExpression(p) ||
      (ts.isArrowFunction(p) && p.body === ancre) ||
      (ts.isPropertyAssignment(p) && p.initializer === ancre)
    )
      break;
    const chaine =
      enveloppe(p, ancre) ||
      (ts.isPropertyAccessExpression(p) && p.expression === ancre) ||
      (ts.isCallExpression(p) && p.expression === ancre);
    if (!chaine) sommet ??= ancre;
    ancre = p;
  }
  sommet ??= ancre;
  const auDessus = (
    ts.getLeadingCommentRanges(texte, ancre.getFullStart()) ?? []
  ).map((c) => texte.slice(c.pos, c.end));
  // Un commentaire pour UNE lecture : s'il coiffe une instruction qui en porte
  // plusieurs (`if` sans accolades, `f(await a, await b)`), il n'en exempte aucune.
  let portees = 0;
  const compter = (n: ts.Node): void => {
    if (estLecture(n)) portees++;
    ts.forEachChild(n, compter);
  };
  compter(ancre);
  if (portees !== 1) return null;
  const debut = ancre.getStart(src);
  const finDeLigne = texte.indexOf('\n', sommet.getEnd());
  const lignes = texte.slice(
    debut,
    finDeLigne === -1 ? texte.length : finDeLigne,
  );
  // Sur les lignes de la lecture, le marqueur ne vaut qu'écrit dans un
  // commentaire : dans une chaîne de caractères, c'est du code.
  const surLesLignes = [...lignes.matchAll(new RegExp(MARQUEUR, 'g'))]
    .filter((m) => !dansUnJeton(src, debut + m.index))
    .map((m) => m[0]);
  const m = MARQUEUR.exec([...auDessus, ...surLesLignes].join('\n'));
  if (!m) return null;
  const raison = m[1]!.replace(/\*\/\s*$/, '').trim();
  return raison.length >= RAISON_MIN ? raison : null;
}

/** Fichier que le compilateur n'a pas lu en entier : son arbre est troué. */
class Illisible extends Error {}

/** `.tsx` et `.jsx` portent des balises ; un `.ts` lu comme tel serait mal lu. */
function modeDeLecture(fichier: string): ts.ScriptKind {
  if (fichier.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fichier.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?js$/.test(fichier) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/**
 * Les lectures d'un fichier. Lève `Illisible` si le fichier est lu avec des
 * erreurs de syntaxe : à l'appelant de décider (le compteur s'arrête, l'aide
 * « ajouts par rapport à origin/main » passe outre).
 */
function analyser(fichier: string, texte: string): Lecture[] {
  const src = ts.createSourceFile(
    fichier,
    texte,
    ts.ScriptTarget.Latest,
    true,
    modeDeLecture(fichier),
  );
  // Un fichier mal lu rend un arbre troué, donc des lectures invisibles. Mesuré
  // en préparant ce gate : 9 fichiers `.ts` lus en mode TSX (leur fonction
  // fléchée générique `<T>(…) =>` y passe pour une balise), 22 lectures manquées.
  // Plutôt aucun compteur qu'un compteur trop bas.
  const erreurs = (src as unknown as { parseDiagnostics?: unknown[] })
    .parseDiagnostics;
  if (!Array.isArray(erreurs))
    throw new Illisible(
      'erreurs de syntaxe du compilateur illisibles (version de TypeScript ?).',
    );
  if (erreurs.length > 0)
    throw new Illisible(
      `${fichier} : ${erreurs.length} erreur(s) de syntaxe à la lecture, arbre incomplet.`,
    );
  const suivi = new Suivi(fichier);
  const lectures: Lecture[] = [];
  const visiter = (n: ts.Node): void => {
    if (estLecture(n)) {
      const ou = appelDeMethode(n)!.ou;
      const table = tableDe(n);
      const suite = comptageSeul(n) ? bornee('comptage head') : suivi.suivre(n);
      const raison = suite.t === 'bornee' ? null : raisonDExemption(n);
      lectures.push({
        fichier,
        ligne: src.getLineAndCharacterOfPosition(ou.getStart(src)).line + 1,
        table: !table
          ? '(forme inhabituelle)'
          : ts.isStringLiteralLike(table)
            ? table.text
            : table.getText(src),
        etat:
          suite.t === 'bornee' ? 'bornee' : raison ? 'exemptee' : 'signalee',
        motif:
          suite.t === 'bornee'
            ? suite.motif
            : (raison ??
              (suite.t === 'sans' ? suite.motif : 'exécutée sans borne')),
      });
    }
    ts.forEachChild(n, visiter);
  };
  visiter(src);
  return lectures;
}

// ── Auto-test ────────────────────────────────────────────────────────────────

const IMPORT_PAGES = `import { lireParPages, lireParLots } from '@/lib/pdf/selection-par-pages.js';\n`;
const IMPORT_TRANCHES = `import { lireParTranches } from '@/lib/exports/shared.js';\n`;

/**
 * Chaque sonde : un fichier fictif, le nombre de lectures qu'on doit y signaler
 * et, s'il y a lieu, y exempter. `fichier` par défaut : `${SRC}/sonde.ts`.
 */
const SONDES: {
  nom: string;
  source: string;
  signalees: number;
  exemptees?: number;
  fichier?: string;
}[] = [
  // ── La forme d'origine, et chaque borne reconnue ──
  {
    nom: 'lecture attendue sans borne',
    source: `const { data } = await supabase.from('collectes').select('id');`,
    signalees: 1,
  },
  {
    nom: 'schéma explicite et filtres : toujours sans borne',
    source: `const r = await admin.schema('plateforme').from('collectes').select('id').eq('type', t).order('id');`,
    signalees: 1,
  },
  {
    nom: '.limit(n)',
    source: `const { data } = await supabase.from('collectes').select('id').order('id').limit(50);`,
    signalees: 0,
  },
  {
    nom: '.range(a, b)',
    source: `const { data } = await supabase.from('collectes').select('id').range(debut, debut + 99);`,
    signalees: 0,
  },
  {
    nom: '.single() et .maybeSingle()',
    source: `await supabase.from('collectes').select('id').eq('id', id).single();\nawait supabase.from('lieux').select('id').eq('id', id).maybeSingle();`,
    signalees: 0,
  },
  {
    nom: 'comptage head: true',
    source: `const { count } = await supabase.from('collectes').select('id', { count: 'exact', head: true });`,
    signalees: 0,
  },
  {
    nom: 'count sans head : les lignes sont rendues',
    source: `const { data, count } = await supabase.from('collectes').select('id', { count: 'exact' });`,
    signalees: 1,
  },
  {
    nom: 'head: false, ou head donné par une variable : pas un comptage',
    source: `await supabase.from('collectes').select('id', { count: 'exact', head: false });\nawait supabase.from('collectes').select('id', { count: 'exact', head: sansLignes });`,
    signalees: 2,
  },
  // ── Bornes qui n'en sont pas ──
  {
    nom: 'limite écrite au-dessus du plafond',
    source: `await supabase.from('collectes').select('id').limit(1001);\nawait supabase.from('collectes').select('id').range(0, 1000);`,
    signalees: 2,
  },
  {
    nom: 'nombre au-dessus du plafond écrit entre parenthèses, signé ou calculé',
    source: `await supabase.from('collectes').select('id').limit((5000));\nawait supabase.from('collectes').select('id').limit(+5000);\nawait supabase.from('collectes').select('id').limit(2 * 1000);\nawait supabase.from('collectes').select('id').range(0, 500 + 500);\nawait supabase.from('collectes').select('id').range(0, 3000 - 1000);`,
    signalees: 5,
  },
  {
    nom: 'calcul écrit en dur sous le plafond : accepté',
    source: `await supabase.from('collectes').select('id').limit(10 * 10);\nawait supabase.from('collectes').select('id').range(100, 100 + 99);\nawait supabase.from('collectes').select('id').range(1000 - 1000, 999);`,
    signalees: 0,
  },
  {
    nom: 'limite au plafond : acceptée',
    source: `await supabase.from('collectes').select('id').limit(1000);\nawait supabase.from('collectes').select('id').range(0, 999);`,
    signalees: 0,
  },
  {
    nom: 'limite posée sur une table jointe',
    source: `await supabase.from('collectes').select('id, collecte_flux(*)').limit(5, { referencedTable: 'collecte_flux' });\nawait supabase.from('collectes').select('id, collecte_flux(*)').limit(5, { foreignTable: 'collecte_flux' });`,
    signalees: 2,
  },
  // ── Exécutions ──
  {
    nom: 'Promise.all : chaque lecture est jugée',
    source: `const [a, b] = await Promise.all([\n  supabase.from('lieux').select('*'),\n  supabase.from('collectes').select('id').limit(1),\n]);`,
    signalees: 1,
  },
  {
    nom: '.then() sur une lecture sans borne, puis sur une lecture bornée',
    source: `supabase.from('lieux').select('*').then((r) => r.data);\nsupabase.from('lieux').select('*').limit(1).then((r) => r.data);`,
    signalees: 1,
  },
  {
    nom: 'un appel par identifiant (map)',
    source: `await Promise.all(ids.map((id) => supabase.from('fichiers').select('*').eq('entity_id', id)));`,
    signalees: 1,
  },
  {
    nom: 'écritures qui rendent leurs lignes : hors sujet',
    source: `await supabase.from('lieux').insert(v).select('id');\nawait supabase.from('lieux').update(v).eq('id', id).select();\nawait supabase.from('lieux').delete().in('id', ids).select('id');\nawait supabase.from('lieux').upsert(v).select();`,
    signalees: 0,
  },
  // ── Formes inhabituelles : le gate ne doit pas devenir aveugle ──
  {
    nom: '.from() rangé dans une variable avant le .select()',
    source: `const t = supabase.from('lieux');\nconst a = await t.select('*');\nconst b = await t.select('id').limit(5);`,
    signalees: 1,
  },
  {
    nom: 'enveloppe maison autour de .from()',
    source: `const table = (nom) => supabase.schema('plateforme').from(nom);\nconst { data } = await table('lieux').select('id, nom');`,
    signalees: 1,
  },
  {
    nom: 'from et select écrits entre crochets',
    source: `const a = await supabase['from']('lieux')['select']('*');\nconst b = await supabase['from']('lieux')['select']('*').limit(5);`,
    signalees: 1,
  },
  {
    nom: 'fichier .ts avec une fonction fléchée générique avant la lecture',
    source: `const un = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);\nconst { data } = await supabase.from('lieux').select('*');`,
    signalees: 1,
  },
  {
    nom: 'fichier .js',
    source: `const { data } = await supabase.from('collectes').select('id');`,
    signalees: 1,
    fichier: `${SRC}/sonde.js`,
  },
  {
    nom: 'fichier .mts',
    source: `const { data } = await supabase.from('collectes').select('id');`,
    signalees: 1,
    fichier: `${SRC}/sonde.mts`,
  },
  {
    nom: 'fichier .jsx, balises comprises',
    source: `export default async function Page() {\n  const { data } = await supabase.from('lieux').select('*');\n  return <ul>{data.map((l) => <li key={l.id}>{l.nom}</li>)}</ul>;\n}`,
    signalees: 1,
    fichier: `${SRC}/sonde.jsx`,
  },
  {
    nom: 'select() d’un champ de saisie : pas une lecture',
    source: `champ.current?.select();\ninput.select();`,
    signalees: 0,
  },
  // ── Requête rangée dans une variable ──
  {
    nom: 'variable filtrée puis attendue sans borne',
    source: `let q = supabase.from('collectes').select('id');\nif (type) q = q.eq('type', type);\nconst { data } = await q;`,
    signalees: 1,
  },
  {
    nom: 'variable bornée à l’exécution',
    source: `let q = supabase.from('collectes').select('id');\nif (type) q = q.eq('type', type);\nconst { data } = await q.range(0, 49);`,
    signalees: 0,
  },
  {
    nom: 'variable bornée par une réaffectation sans condition',
    source: `let q = supabase.from('collectes').select('id');\nq = q.order('id').range(debut, fin);\nif (type) q = q.eq('type', type);\nconst { data } = await q;`,
    signalees: 0,
  },
  {
    nom: 'borne posée sous condition (if)',
    source: `let q = supabase.from('collectes').select('id');\nif (!tout) q = q.range(debut, fin);\nconst { data } = await q;`,
    signalees: 1,
  },
  {
    nom: 'borne posée dans une seule branche d’un ternaire',
    source: `let q = supabase.from('collectes').select('id');\nq = tout ? q : q.range(debut, fin);\nconst { data } = await q;`,
    signalees: 1,
  },
  {
    nom: 'ternaire sur les filtres, puis borne commune',
    source: `let q = supabase.from('collectes').select('id');\nq = (type ? q.eq('type', type) : q).range(debut, fin);\nconst { data } = await q;`,
    signalees: 0,
  },
  {
    nom: 'borne dans une branche du ternaire, puis borne commune',
    source: `let q = supabase.from('collectes').select('id');\nconst autre = supabase.from('lieux').select('id');\nq = (court ? q.limit(5) : autre).range(debut, fin);\nconst { data } = await q;`,
    signalees: 0,
  },
  {
    nom: 'borne dans chaque branche du ternaire : signalée, du bon côté',
    source: `let q = supabase.from('collectes').select('id');\nq = court ? q.limit(5) : q.range(debut, fin);\nconst { data } = await q;`,
    signalees: 1,
  },
  {
    nom: 'affectation bornée écrite dans une branche de ternaire',
    source: `let q = supabase.from('collectes').select('id');\npage ? (q = q.range(debut, fin)) : journaliser();\nconst { data } = await q;`,
    signalees: 1,
  },
  {
    nom: 'borne posée sous && , || ou ??',
    source: `let a = supabase.from('collectes').select('id');\npage && (a = a.range(debut, fin));\nconst x = await a;\nlet b = supabase.from('lieux').select('id');\ntout || (b = b.range(debut, fin));\nconst y = await b;\nlet c = supabase.from('factures').select('id');\nlimite ?? (c = c.limit(50));\nconst z = await c;`,
    signalees: 3,
  },
  {
    nom: 'borne posée dans une boucle (zéro tour possible)',
    source: `let a = supabase.from('collectes').select('id');\nfor (const n of tailles) a = a.limit(n);\nconst x = await a;\nlet b = supabase.from('lieux').select('id');\nwhile (encore()) b = b.limit(10);\nconst y = await b;`,
    signalees: 2,
  },
  {
    nom: 'borne posée dans un cas de switch',
    source: `let q = supabase.from('collectes').select('id');\nswitch (mode) {\n  case 'page':\n    q = q.range(debut, fin);\n    break;\n  default:\n    break;\n}\nconst { data } = await q;`,
    signalees: 1,
  },
  {
    nom: 'borne posée dans un try, ou dans son catch',
    source: `let a = supabase.from('collectes').select('id');\ntry {\n  verifier();\n  a = a.limit(10);\n} catch {\n  journaliser();\n}\nconst x = await a;\nlet b = supabase.from('lieux').select('id');\ntry {\n  verifier();\n} catch {\n  b = b.limit(10);\n}\nconst y = await b;`,
    signalees: 2,
  },
  {
    nom: 'requête déclarée, bornée et exécutée dans le même try',
    source: `try {\n  let q = supabase.from('collectes').select('id');\n  q = q.range(debut, fin);\n  const { data } = await q;\n} catch (e) {\n  journaliser(e);\n}`,
    signalees: 0,
  },
  {
    nom: 'borne posée dans une fonction qui peut ne pas être appelée',
    source: `let q = supabase.from('collectes').select('id');\nconst borner = () => {\n  q = q.limit(10);\n};\nif (page) borner();\nconst { data } = await q;`,
    signalees: 1,
  },
  {
    nom: 'deux exécutions, une seule bornée',
    source: `const q = supabase.from('collectes').select('id');\nconst un = await q.limit(1);\nconst tout = await q;`,
    signalees: 1,
  },
  {
    nom: 'typeof q dans un type : pas un usage',
    source: `${IMPORT_PAGES}const lire = (apresId: string | null) => {\n  let q = supabase.from('collectes').select('id');\n  q = filtrer(q as never) as typeof q;\n  if (apresId) q = q.gt('id', apresId);\n  return q.order('id').limit(TAILLE_PAGE);\n};\nawait lireParPages(lire);`,
    signalees: 0,
  },
  {
    nom: 'deux variables du même nom : chacune jugée sur ses propres usages',
    source: `const q = supabase.from('lieux').select('*');\nconst autre = async () => {\n  const q = supabase.from('collectes').select('id');\n  return (await q).data;\n};\nconst { data } = await q.limit(5);`,
    signalees: 1,
  },
  {
    nom: 'borne posée après l’exécution',
    source: `let q = supabase.from('collectes').select('id');\nconst { data } = await q;\nq = q.limit(10);`,
    signalees: 1,
  },
  {
    nom: 'variable réutilisée pour une seconde requête : jugée sur ses exécutions',
    source: `let q = supabase.from('collectes').select('id');\nq = q.range(0, 49);\nconst a = await q;\nq = supabase.from('lieux').select('*');\nconst b = await q;`,
    signalees: 2,
  },
  {
    nom: 'deux requêtes au choix dans une variable, bornées à l’exécution',
    source: `let q;\nif (zd) q = supabase.from('collectes').select('id');\nelse q = supabase.from('lieux').select('id');\nconst { data } = await q.range(debut, fin);`,
    signalees: 0,
  },
  {
    nom: 'deux requêtes au choix, borne réaffectée ensuite : signalées, du bon côté',
    source: `let q;\nif (zd) q = supabase.from('collectes').select('id');\nelse q = supabase.from('lieux').select('id');\nq = q.range(debut, fin);\nconst { data } = await q;`,
    signalees: 2,
  },
  // ── Requête passée à une fonction ──
  {
    nom: 'requête passée à une fonction puis bornée',
    source: `const q = appliquerFiltres(supabase.from('collectes').select('id'), f);\nconst { data } = await q.range(0, 49);`,
    signalees: 0,
  },
  {
    nom: 'requête passée à une fonction puis attendue',
    source: `const { data } = await appliquerFiltres(supabase.from('collectes').select('id'), f);`,
    signalees: 1,
  },
  // ── Aides de lecture ──
  {
    nom: 'rappel de lireParLots',
    source: `${IMPORT_PAGES}const r = await lireParLots(ids, (lot) => supabase.from('lieux').select('*').in('id', lot));`,
    signalees: 0,
  },
  {
    nom: 'rappel nommé, async, passé à lireParLots',
    source: `${IMPORT_PAGES}const lire = async (lot) => supabase.from('lieux').select('*').in('id', lot);\nconst r = await lireParLots(ids, lire);`,
    signalees: 0,
  },
  {
    nom: 'aide importée sous un autre nom',
    source: `import { lireParLots as parLots } from '@/lib/pdf/selection-par-pages.js';\nconst r = await parLots(ids, (lot) => supabase.from('lieux').select('*').in('id', lot));`,
    signalees: 0,
  },
  {
    nom: 'fonction homonyme définie sur place : pas une aide',
    source: `async function lireParLots(ids, lire) { return lire(ids); }\nconst r = await lireParLots(ids, (lot) => supabase.from('lieux').select('*').in('id', lot));`,
    signalees: 1,
  },
  {
    nom: 'même nom importé d’un autre module : pas une aide',
    source: `import { lireParLots } from '@/lib/api-helpers.js';\nconst r = await lireParLots(ids, (lot) => supabase.from('lieux').select('*').in('id', lot));`,
    signalees: 1,
  },
  {
    nom: 'paramètre nommé comme une aide : pas une aide',
    source: `${IMPORT_PAGES}async function f(lireParLots) {\n  return lireParLots(ids, (lot) => supabase.from('lieux').select('*').in('id', lot));\n}`,
    signalees: 1,
  },
  {
    nom: 'aide définie dans son propre fichier',
    source: `async function lireParLots(ids, lire, contexte) { return lire(ids); }\nconst r = await lireParLots(ids, (lot) => supabase.from('lieux').select('*').in('id', lot), 'x');`,
    signalees: 0,
    fichier: `${SRC}/lib/montant-prestation.ts`,
  },
  {
    nom: 'fonction locale passée à lireParTranches',
    source: `${IMPORT_TRANCHES}const requete = () => supabase.from('factures').select('*', { count: 'exact' }).order('id');\nconst lignes = await lireParTranches(requete);`,
    signalees: 0,
  },
  {
    nom: 'fonction locale appelée dans le rappel d’une aide (ternaire)',
    source: `${IMPORT_TRANCHES}const base = () => supabase.from('collectes').select('*', { count: 'exact' });\nconst staff = (f) => appliquerFiltres(base().order('id'), f);\nconst client = () => {\n  let q = base().order('id');\n  if (x) q = q.eq('type', x);\n  return q;\n};\nconst lignes = await lireParTranches(f ? () => staff(f) : client);`,
    signalees: 0,
  },
  {
    nom: 'lecture attendue DANS le rappel d’une aide : signalée (rendre la requête)',
    source: `${IMPORT_PAGES}const r = await lireParLots(ids, async (lot) => {\n  const { data, error } = await supabase.from('lieux').select('*').in('id', lot);\n  return { data, error };\n});`,
    signalees: 1,
  },
  // ── Requête rendue par une fonction locale ──
  {
    nom: 'fonction locale jamais appelée : rien ne dit qu’elle sera bornée',
    source: `const requete = () => supabase.from('factures').select('*');`,
    signalees: 1,
  },
  {
    nom: 'fonction locale dont l’appel est attendu sans borne',
    source: `const requete = () => supabase.from('factures').select('*');\nconst { data } = await requete();`,
    signalees: 1,
  },
  {
    nom: 'fonction locale : tous les appels bornés',
    source: `function requete() {\n  return supabase.from('factures').select('*');\n}\nconst a = await requete().limit(10);\nconst b = await requete().eq('id', id).maybeSingle();`,
    signalees: 0,
  },
  {
    nom: 'fonction locale : un appel sur deux sans borne',
    source: `function requete() {\n  return supabase.from('factures').select('*');\n}\nconst a = await requete().limit(10);\nconst b = await requete();`,
    signalees: 1,
  },
  {
    nom: 'fonction exportée qui rend la requête',
    source: `export const requete = () => supabase.from('factures').select('*');\nexport function autre() {\n  return supabase.from('lieux').select('*');\n}`,
    signalees: 2,
  },
  {
    nom: 'fonction exportée : un appel local borné ne dit rien des autres fichiers',
    source: `export const requete = () => supabase.from('factures').select('*');\nconst { data } = await requete().limit(10);`,
    signalees: 1,
  },
  {
    nom: 'fonction qui rend une requête déjà bornée',
    source: `export function requete() {\n  return supabase.from('factures').select('*').order('id').limit(20);\n}`,
    signalees: 0,
  },
  {
    nom: 'fonction appelée sur place (IIFE) dans un Promise.all',
    source: `const [r] = await Promise.all([\n  (() => {\n    let q = supabase.from('v_kpi_admin').select('*');\n    if (de) q = q.gte('mois', de);\n    return q.order('mois');\n  })(),\n]);`,
    signalees: 1,
  },
  {
    nom: 'deux lectures au choix, puis un filtre commun',
    source: `const r = await (zd ? admin.from('collectes').select(A) : rls.from('collectes').select(B)).in('id', ids);`,
    signalees: 2,
  },
  {
    nom: 'deux lectures au choix, bornées ensemble',
    source: `const r = await (zd ? admin.from('collectes').select(A) : rls.from('collectes').select(B)).in('id', ids).limit(20);`,
    signalees: 0,
  },
  // ── Exemption par commentaire ──
  {
    nom: 'commentaire borne-par-nature au-dessus de l’instruction',
    source: `// borne-par-nature: une ligne par flux de la collecte\nconst { data } = await supabase\n  .from('collecte_flux')\n  .select('*')\n  .eq('collecte_id', id);`,
    signalees: 0,
    exemptees: 1,
  },
  {
    nom: 'commentaire en fin de ligne de la chaîne',
    source: `const { data } = await supabase\n  .from('collecte_flux')\n  .select('*')\n  .eq('collecte_id', id); // borne-par-nature: une ligne par flux de la collecte`,
    signalees: 0,
    exemptees: 1,
  },
  {
    nom: 'raison absente ou trop courte : pas d’exemption',
    source: `// borne-par-nature: ok\nconst a = await supabase.from('flux_dechets').select('*');\n// borne-par-nature:\nconst b = await supabase.from('flux_dechets').select('*');`,
    signalees: 2,
    exemptees: 0,
  },
  {
    nom: 'raison de 9 caractères refusée, de 10 acceptée',
    source: `// borne-par-nature: parametre\nconst a = await supabase.from('flux_dechets').select('*');\n// borne-par-nature: parametres\nconst b = await supabase.from('flux_dechets').select('*');`,
    signalees: 1,
    exemptees: 1,
  },
  {
    nom: 'le commentaire ne vaut que pour SA lecture',
    source: `// borne-par-nature: référentiel d'une dizaine de lignes\nconst a = await supabase.from('flux_dechets').select('*');\nconst b = await supabase.from('collectes').select('*');`,
    signalees: 1,
    exemptees: 1,
  },
  {
    nom: 'commentaire au-dessus d’un Promise.all : aucune lecture exemptée',
    source: `// borne-par-nature: référentiels d'une dizaine de lignes\nconst [a, b] = await Promise.all([\n  supabase.from('flux_dechets').select('*'),\n  supabase.from('collectes').select('*'),\n]);`,
    signalees: 2,
    exemptees: 0,
  },
  {
    nom: 'commentaire au-dessus d’un élément de Promise.all : lui seul',
    source: `const [a, b, c] = await Promise.all([\n  supabase.from('lieux').select('*'), // sans rapport\n  // borne-par-nature: référentiel d'une dizaine de lignes\n  supabase.from('flux_dechets').select('*'),\n  supabase.from('collectes').select('*'),\n]);`,
    signalees: 2,
    exemptees: 1,
  },
  {
    nom: 'commentaire de fin de ligne de l’élément précédent : pas pour le suivant',
    source: `const [a, b] = await Promise.all([\n  supabase.from('flux_dechets').select('*'), // borne-par-nature: référentiel d'une dizaine de lignes\n  supabase.from('collectes').select('*'),\n]);`,
    signalees: 1,
    exemptees: 1,
  },
  {
    nom: 'commentaire de fin de ligne de l’instruction précédente : pas pour la suivante',
    source: `const a = await supabase.from('flux_dechets').select('*'); // borne-par-nature: référentiel d'une dizaine de lignes\nconst b = await supabase.from('collectes').select('*');`,
    signalees: 1,
    exemptees: 1,
  },
  {
    nom: 'marqueur écrit dans une chaîne de caractères : pas une exemption',
    source: `const { data } = await supabase\n  .from('notes')\n  .select('*')\n  .eq('texte', '// borne-par-nature: ceci est une chaîne de caractères');`,
    signalees: 1,
    exemptees: 0,
  },
  {
    nom: 'un commentaire pour deux lectures de la même instruction : aucune exemptée',
    source: `// borne-par-nature: référentiels d'une dizaine de lignes\nconst r = combiner(await supabase.from('flux_dechets').select('*'), await supabase.from('types_evenements').select('*'));\n// borne-par-nature: référentiels d'une dizaine de lignes\nif (zd) lire(await supabase.from('flux_dechets').select('*'));\nelse lire(await supabase.from('types_evenements').select('*'));`,
    signalees: 4,
    exemptees: 0,
  },
  {
    nom: 'une lecture bornée n’a pas besoin d’exemption',
    source: `// borne-par-nature: une ligne par flux de la collecte\nconst { data } = await supabase.from('collecte_flux').select('*').limit(50);`,
    signalees: 0,
    exemptees: 0,
  },
];

/** La règle `estSource`, chemin par chemin : ce qui est lu, ce qui ne l'est pas. */
const SONDES_CHEMINS: [string, boolean][] = [
  [`${SRC}/lib/pagination.ts`, true],
  [`${SRC}/app/(admin)/admin/[id]/page.tsx`, true],
  [`${SRC}/lib/attestation.ts`, true], // « test » dans le nom n'est pas un test
  [`${SRC}/lib/a.js`, true],
  [`${SRC}/lib/a.jsx`, true],
  [`${SRC}/lib/a.mjs`, true],
  [`${SRC}/lib/a.cjs`, true],
  [`${SRC}/lib/a.mts`, true],
  [`${SRC}/lib/a.cts`, true],
  [`${SRC}/lib/a.test.ts`, false],
  [`${SRC}/lib/a.spec.tsx`, false],
  [`${SRC}/lib/a.test.js`, false],
  [`${SRC}/lib/a.spec.mts`, false],
  [`${SRC}/lib/types.d.ts`, false],
  [`${SRC}/lib/types.d.mts`, false],
  [`${SRC}/test-utils/api.ts`, false],
  [`${SRC}/lib/__tests__/a.ts`, false],
  [`${SRC}/lib/__mocks__/a.ts`, false],
  [`${SRC}/lib/a.json`, false],
  [`${SRC}/lib/notes.md`, false],
];

function autoTest(): void {
  const cheminsFaux = SONDES_CHEMINS.filter(
    ([chemin, attendu]) => estSource(chemin) !== attendu,
  );
  if (cheminsFaux.length > 0)
    echec(
      `auto-test, règle des fichiers lus : ${cheminsFaux
        .map(
          ([chemin, attendu]) =>
            `${chemin} devrait être ${attendu ? 'lu' : 'écarté'}`,
        )
        .join(' ; ')}`,
    );
  const compte = (s: (typeof SONDES)[number]) => {
    let lectures: Lecture[];
    try {
      lectures = analyser(s.fichier ?? `${SRC}/sonde.ts`, s.source);
    } catch (e) {
      if (e instanceof Illisible)
        echec(`auto-test, sonde « ${s.nom} » : ${e.message}`);
      throw e;
    }
    return {
      signalees: lectures.filter((l) => l.etat === 'signalee').length,
      exemptees: lectures.filter((l) => l.etat === 'exemptee').length,
    };
  };
  const ecarts = SONDES.map((s) => ({ s, vu: compte(s) })).filter(
    ({ s, vu }) =>
      vu.signalees !== s.signalees || vu.exemptees !== (s.exemptees ?? 0),
  );
  if (ecarts.length === 0) return;
  echec(
    `auto-test, ${ecarts.length} sonde(s) sur ${SONDES.length} :\n${ecarts
      .map(
        ({ s, vu }) =>
          `   « ${s.nom} » → ${vu.signalees} signalée(s) et ${vu.exemptees} exemptée(s), ` +
          `${s.signalees} et ${s.exemptees ?? 0} attendues`,
      )
      .join('\n')}`,
  );
}

/** La liste AIDES dit vrai : chaque aide existe, au premier niveau de son fichier. */
function verifierAides(): void {
  for (const [fichier, noms] of Object.entries(AIDES)) {
    if (!existsSync(fichier))
      echec(`aide de lecture : ${fichier} introuvable.`);
    const src = ts.createSourceFile(
      fichier,
      readFileSync(fichier, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const nom of noms) {
      const definie = src.statements.some(
        (st) => ts.isFunctionDeclaration(st) && st.name?.text === nom,
      );
      if (!definie)
        echec(
          `aide de lecture : ${nom}() n'est plus définie au premier niveau de ${fichier}. Mettre la liste AIDES à jour.`,
        );
    }
  }
}

// ── Le dépôt ─────────────────────────────────────────────────────────────────

/**
 * Ce qui est du code de production sous une racine — PREMIÈRE écriture de la
 * règle, sur le chemin du fichier : tout `.ts` / `.tsx`, sauf les tests, les
 * déclarations de types et les dossiers d'outillage de test.
 */
const DOSSIERS_HORS_PRODUCTION = new Set([
  'test-utils',
  '__tests__',
  '__mocks__',
  'node_modules',
]);

/** Extensions lues : `allowJs` est actif, un `.js` sous `src` est compilé aussi. */
const EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];

function estSource(fichier: string): boolean {
  const morceaux = fichier.split('/');
  const nom = morceaux[morceaux.length - 1]!;
  return (
    EXTENSIONS.includes(nom.slice(nom.lastIndexOf('.') + 1)) &&
    !/\.d\.[cm]?ts$/.test(nom) &&
    !/\.(test|spec)\.[cm]?[jt]sx?$/.test(nom) &&
    !morceaux.some((m) => DOSSIERS_HORS_PRODUCTION.has(m))
  );
}

/**
 * SECONDE écriture de la même règle, en motifs d'exclusion donnés à git. Elle
 * n'a qu'un rôle : recouper la première. Changer l'une sans l'autre arrête le
 * gate (cf. `fichiers`) — écarter des fichiers du compteur demande donc deux
 * gestes, pas une ligne passée inaperçue.
 */
const MOTIFS_HORS_PRODUCTION = [
  ...EXTENSIONS.flatMap((e) => [`**/*.test.${e}`, `**/*.spec.${e}`]),
  '**/*.d.ts',
  '**/*.d.mts',
  '**/*.d.cts',
  '**/test-utils/**',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/node_modules/**',
];

function parcourir(dossier: string, trouves: string[] = []): string[] {
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = `${dossier}/${entree.name}`;
    if (entree.isDirectory()) parcourir(chemin, trouves);
    else trouves.push(chemin);
  }
  return trouves;
}

/**
 * Fichiers à lire sous une racine, établis DEUX fois : en parcourant le disque
 * avec `estSource`, puis en demandant à git (fichiers suivis ou non) avec
 * `MOTIFS_HORS_PRODUCTION`. Les deux listes doivent être identiques. Un dossier
 * écarté par une retouche de l'une des deux règles, ou un parcours devenu
 * aveugle à une forme de chemin, afficherait sinon un compteur en baisse — que
 * le méta-cliquet lirait comme un progrès.
 */
function fichiers(racine: string): string[] {
  const parDisque = parcourir(racine).filter(estSource).sort();
  let sortie: string;
  try {
    sortie = git([
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--',
      ...EXTENSIONS.map((e) => `:(glob)${racine}/**/*.${e}`),
      ...MOTIFS_HORS_PRODUCTION.map((m) => `:(exclude,glob)${racine}/${m}`),
    ]);
  } catch {
    echec(
      `git ne rend pas la liste des fichiers de ${racine} : elle ne peut pas être recoupée.`,
    );
  }
  const parGit = sortie
    .split('\0')
    .filter((f) => f !== '' && existsSync(f))
    .sort();
  // macOS peut rendre un nom accentué décomposé là où git le rend composé.
  const absents = (de: string[], dans: string[]): string[] => {
    const vus = new Set(dans.map((f) => f.normalize('NFC')));
    return de.filter((f) => !vus.has(f.normalize('NFC')));
  };
  const ecarts = [
    ...absents(parDisque, parGit).map((f) => `${f} (disque seul)`),
    ...absents(parGit, parDisque).map((f) => `${f} (git seul)`),
  ];
  if (ecarts.length > 0)
    echec(
      `les deux listes des fichiers de ${racine} divergent sur ${ecarts.length} fichier(s) : ` +
        `${ecarts.slice(0, 5).join(' ; ')}. Les règles estSource et MOTIFS_HORS_PRODUCTION doivent dire la même chose.`,
    );
  return parDisque;
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * Fichiers où la branche AJOUTE des lectures sans borne par rapport à
 * `origin/main` — sans quoi il faudrait chercher la nouvelle parmi toutes
 * celles que la baseline tolère. Aide à la lecture seulement : cette
 * comparaison n'a aucun effet sur le compteur (qui, lui, exige git pour
 * recouper la liste des fichiers, cf. `fichiers`). `null` si la référence manque.
 */
function ajoutsParRapportAMain(signalees: Lecture[]): string[] | null {
  try {
    const base = git(['merge-base', 'HEAD', 'origin/main']).trim();
    const racines = Object.keys(RACINES);
    const touches = new Set(
      [
        git(['diff', '--name-only', '-z', base, '--', ...racines]),
        git([
          'ls-files',
          '-z',
          '--others',
          '--exclude-standard',
          '--',
          ...racines,
        ]),
      ]
        .join('\0')
        .split('\0')
        .filter(estSource),
    );
    const ajouts: string[] = [];
    for (const f of [...touches].sort()) {
      const apres = signalees.filter((l) => l.fichier === f).length;
      if (apres === 0) continue;
      let avant = 0;
      try {
        avant = analyser(f, git(['show', `${base}:${f}`])).filter(
          (l) => l.etat === 'signalee',
        ).length;
      } catch {
        // fichier absent d'origin/main (ou illisible là-bas) : toutes ses
        // lectures comptent comme nouvelles
      }
      if (apres > avant)
        ajouts.push(`${f} : ${apres} (${avant} sur origin/main)`);
    }
    return ajouts;
  } catch {
    return null;
  }
}

function main(): void {
  autoTest();
  verifierAides();

  const lectures: Lecture[] = [];
  for (const [racine, plancher] of Object.entries(RACINES)) {
    if (!existsSync(racine)) echec(`racine ${racine} introuvable.`);
    let vues: Lecture[];
    try {
      vues = fichiers(racine).flatMap((f) =>
        analyser(f, readFileSync(f, 'utf8')),
      );
    } catch (e) {
      if (e instanceof Illisible) echec(e.message);
      throw e;
    }
    if (vues.length < plancher)
      echec(
        `${vues.length} lecture(s) vue(s) sous ${racine}, au moins ${plancher} attendues. ` +
          'Si des lectures ont réellement disparu, baisser le plancher (RACINES).',
      );
    lectures.push(...vues);
  }

  const signalees = lectures.filter((l) => l.etat === 'signalee');
  const exemptees = lectures.filter((l) => l.etat === 'exemptee');
  const nbBornees = lectures.length - signalees.length - exemptees.length;

  for (const l of signalees)
    console.error(`   ${l.fichier}:${l.ligne}  ${l.table} — ${l.motif}`);
  if (exemptees.length > 0) {
    console.log(
      `⚪ ${exemptees.length} lecture(s) exemptée(s) par un commentaire borne-par-nature :`,
    );
    for (const l of exemptees)
      console.log(`   ${l.fichier}:${l.ligne}  ${l.table} — ${l.motif}`);
  }
  console.log(
    `${signalees.length > 0 ? '🔴' : '✅'} ${NOM} : ${signalees.length} lecture(s) de lignes sans borne visible ` +
      `(${lectures.length} vues, ${nbBornees} bornées, ${exemptees.length} exemptée(s) ; ` +
      `plafond de la base : ${PLAFOND} lignes par réponse ; auto-test : ${SONDES.length} sondes).`,
  );
  for (const racine of Object.keys(RACINES)) {
    const sous = (l: Lecture) => l.fichier.startsWith(`${racine}/`);
    console.log(
      `   ${racine} : ${signalees.filter(sous).length} sans borne sur ${lectures.filter(sous).length} lectures`,
    );
  }
  if (signalees.length > 0) {
    const ajouts = ajoutsParRapportAMain(signalees);
    if (ajouts === null)
      console.log(
        '   Ajouts par rapport à origin/main : non calculés (référence absente).',
      );
    else if (ajouts.length === 0)
      console.log('   Ajouts par rapport à origin/main : aucun.');
    else {
      console.log(
        '   Fichiers où cette branche en AJOUTE par rapport à origin/main :',
      );
      for (const a of ajouts) console.log(`     ${a}`);
    }
    console.log(
      '   → tout lire : lireParPages (pages triées par id) ou lireParTranches (exports) ;\n' +
        '   → lecture filtrée par une liste d’identifiants (.in) : lireParLots — une limite ne suffit\n' +
        '     pas, au-delà d’environ 390 identifiants la lecture échoue ;\n' +
        '   → troncature voulue : .limit(n) avec son tri, n au plus égal au plafond ;\n' +
        '   → petite par nature (paramètres, lignes d’une seule collecte) : commentaire\n' +
        '     `// borne-par-nature: <raison>` au-dessus de la lecture.',
    );
  }
  console.log(`RATCHET_COUNT=${signalees.length}`);
}

main();
