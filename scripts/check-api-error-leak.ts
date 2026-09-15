#!/usr/bin/env tsx
/**
 * check-api-error-leak — aucun message d'erreur DB/tierce dans une réponse HTTP.
 * =============================================================================
 * Classe fermée par la PR #276 (« synthèse PDF — erreurs génériques ») puis
 * généralisée : un message Postgres renvoyé au client (noms de tables/colonnes,
 * contrainte violée, détail PostgREST) livre la structure interne de la base à
 * qui poste un corps invalide. Relevé une fois de plus par `reviewer-rls-securite`
 * sur `programmation/organisations/shadow` (revue #303).
 *
 * TROIS règles, parce que la fuite a trois formes — la 2e est celle qui, en
 * première version de ce gate, laissait passer une fuite atteignable par n'importe
 * quel client authentifié : `GET /api/v1/exports/collectes?statut=foo` répondait
 * « invalid input value for enum plateforme.collecte_statut: "foo" ».
 *
 * RÈGLE A — dans `app/api/**`, aucun `<expr>.message` (ni `<expr>['message']`, ni
 *   un binding `const { message } = err`) à l'intérieur d'un `NextResponse.json`.
 *     ✅ `return serverError(error, 'admin.collectes.list')`
 *     ✅ `logger.error('api_route.error', { error: error.message })`  (LOG serveur)
 *     ❌ `return NextResponse.json({ error: error.message }, …)`
 *
 * RÈGLE B — dans tout module ATTEIGNABLE depuis un route handler non-cron (calcul
 *   par graphe d'imports, cf. `modulesAtteignables`), aucun message d'erreur ne
 *   peut être FABRIQUÉ pour être rendu : ni `throw new Error(<expr>.message)` — qui
 *   ressort par le `catch (e) { … e.message }` du handler — ni un champ rendu
 *   (`message`/`erreur`/`error`/…) alimenté par un `.message`. Seules les fonctions
 *   de NEUTRALISATION peuvent lire un `.message` : leur rôle est précisément de le
 *   logger sans le rendre. C'est l'invariant qui attrape les vecteurs qu'on ne
 *   connaît pas d'avance.
 *
 * RÈGLE C — dans `app/api/**`, pas de `NextResponse.json(result)` : rendre un objet
 *   de RÉSULTAT APPLICATIF en bloc embarque ses champs de diagnostic
 *   (`erreur_synchro` = corps d'erreur Pennylane) sans qu'aucun `.message`
 *   n'apparaisse dans la route. Ciblée par convention de nommage (`result`/`res`) :
 *   un `NextResponse.json(data)` est la donnée métier du cas nominal.
 *
 * Les crons sont hors périmètre de la règle B : `assertCronAuth` exige
 * `Authorization: Bearer <CRON_SECRET>`, leurs `errors[]` de diagnostic ne sont pas
 * exposés. Ils sont exclus par le GRAPHE, pas par une liste à tenir à jour.
 *
 * Le détecteur s'auto-teste à chaque exécution (SONDES) : un cliquet devenu aveugle
 * à la forme qu'il est né pour attraper produit exactement la fausse confiance
 * qu'il prétend supprimer.
 *
 * Émet RATCHET_COUNT=<n> — câblé dans `pnpm check:ratchet` avec baseline 0.
 * =============================================================================
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';

const SRC = 'packages/plateforme/src';
const API = `${SRC}/app/api`;

/** Champs d'un objet rendu qui portent un message d'erreur vers l'appelant. */
const CHAMPS_RENDUS = /^(message|msg|reason|detail|details)$|^(erreur|error)/;

/**
 * Fonctions dont le rôle EST de lire un message d'erreur pour le logger et n'en
 * rendre qu'un libellé neutre. Elles seules échappent à la règle B.
 */
const NEUTRALISEURS = new Set([
  'logApiError',
  // `messageErreur` n'est DÉLIBÉRÉMENT pas listée : elle RETOURNE le message brut,
  // elle ne neutralise rien. Son seul usage légitime est d'alimenter un `logger.*`
  // — une exemption ici serait une arme chargée (contre-revue sécurité).
  'serverError',
  'writeError',
  'typedRpcError',
  'businessError',
  'authAccountError',
  'erreurInterne',
  'messageEchecEcriture',
  'messageEchecTiers',
  'loaderDbError',
  'dbError',
]);

/**
 * Erreurs applicatives renvoyées telles quelles par une route, dont le message est
 * garanti neutre PAR SA CONSTRUCTION (règle B, qui verrouille la source). Sans
 * cette liste le gate rougirait sur du code correct ; sans la règle B, la liste
 * serait un trou — les deux vont ensemble.
 */
const ALLOWLIST_REPONSE: { fichiers: RegExp; expr: string }[] = [
  {
    // 8 routes renvoient `{ error: e.message }` d'un `LoaderError` attrapé ;
    // `lib/dashboards/loaders.ts` ne le construit que via `loaderDbError`.
    fichiers:
      /\/api\/v1\/(dashboards\/(benchmark|benchmark\/filtres|traiteur-full|blocs|evolution|kpi-traiteur)|traiteur\/marge-attente-facturation|programmation\/pack-ag)\/route\.ts$/,
    expr: 'e.message',
  },
  {
    // 2 routes renvoient `{ error: result.message }` d'un `RegenerateResult` ;
    // `lib/pdf/regenerate.ts` ne construit `DB_ERROR` que via `dbError`.
    fichiers:
      /\/api\/v1\/(admin|traiteur)\/collectes\/\[id\]\/documents\/\[type\]\/regenerate\/route\.ts$/,
    expr: 'result.message',
  },
];

/**
 * Objets de résultat dont le TYPE ne porte aucun champ de diagnostic hors contrat
 * (`ValidationResult` = { ok, statut, numero_facture, pennylane_id, pdf_url, erreur },
 * son `erreur` étant neutralisé à la construction par la règle B ; les trois autres
 * sont des résultats de LECTURE). Les rendre en bloc est sûr tant que ces types ne
 * gagnent pas de champ de diagnostic — à revoir si c'est le cas.
 */
const ALLOWLIST_BLOC: RegExp[] = [
  /\/api\/v1\/admin\/factures\/\[id\]\/(valider|renvoyer)\/route\.ts$/,
  /\/api\/v1\/programmation\/pack-ag\/route\.ts$/,
  /\/api\/v1\/dashboards\/kpi-traiteur\/route\.ts$/,
  /\/api\/v1\/registre\/route\.ts$/,
];

/**
 * Sites de la règle B tolérés, avec leur raison. Volontairement court : chaque
 * entrée est une dette, pas une convention.
 */
const ALLOWLIST_SOURCE: { fichier: RegExp; raison: string }[] = [
  {
    fichier: /^packages\/adapters\//,
    raison:
      'DETTE TRACÉE — libellés d’état écrits par nous (« … auth timeout », « HTTP 502 », ' +
      '« Configuration manquante : <NOMS de variables> ») : jamais un message Postgres, ' +
      'jamais de PII, jamais une VALEUR de secret. Ils alimentent `integrations_logs` et ' +
      'les alertes ; le seul chemin HTTP est `/api/health/logistique` (spread du ' +
      'HealthCheckResult), STAFF-ONLY — admin_savr ou HEALTH_INTERNAL_TOKEN. Site à ' +
      'surveiller : le client HTTP de l’adapter (`erreur: String(err)`).',
  },
  {
    fichier: /^packages\/shared\/src\/email\//,
    raison:
      '`erreur: result.error.message` de Resend est stocké dans `emails_envoyes.erreur` ' +
      '(diagnostic staff-only), jamais rendu à un client.',
  },
  {
    fichier: /\/lib\/pennylane\/mock\.ts$/,
    raison:
      'mock de développement (fixtures) — ne tourne jamais contre la vraie API',
  },
  {
    fichier: /\/lib\/pennylane\/client\.ts$/,
    raison:
      "construit l'objet PennylaneError ; ses consommateurs le neutralisent via messageEchecTiers()",
  },
];

function fichiersApi(): string[] {
  const out = execSync(
    `grep -rl --include='*.ts' --include='*.tsx' -e '\\.message' -e "\\['message'\\]" -e 'NextResponse.json' ${API} || true`,
    { encoding: 'utf8' },
  ).trim();
  return out
    ? out.split('\n').filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
    : [];
}

/**
 * Modules atteignables depuis un route handler NON-cron, par parcours du graphe
 * d'imports. C'est ce qui distingue « rendu à un utilisateur » de « diagnostic de
 * batch derrière CRON_SECRET » sans liste à tenir à jour.
 */
function modulesAtteignables(): Set<string> {
  const routes = execSync(
    `find ${SRC}/app -name 'route.ts' -o -name 'route.tsx' || true`,
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((f) => f && !f.includes('/api/cron/'));

  const resoudre = (spec: string, depuis: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = path.join(path.dirname(depuis), spec);
    // Frontière de package : `@savr/shared` et `@savr/adapters` vivent dans le même
    // graphe d'exécution qu'une route. S'y arrêter rendait l'invariant faux hors de
    // `packages/plateforme` (contre-revue sécurité).
    else if (spec.startsWith('@savr/'))
      base = path.join('packages', spec.slice('@savr/'.length));
    else return null;
    base = base.replace(/\.js$/, '');
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (existsSync(base + ext)) return base + ext;
    }
    return null;
  };

  const vus = new Set<string>();
  const file = [...routes];
  while (file.length) {
    const f = file.shift()!;
    if (vus.has(f)) continue;
    vus.add(f);
    let src: ts.SourceFile;
    try {
      src = ts.createSourceFile(
        f,
        readFileSync(f, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    } catch {
      continue;
    }
    for (const st of src.statements) {
      const spec =
        (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) &&
        st.moduleSpecifier &&
        ts.isStringLiteral(st.moduleSpecifier)
          ? st.moduleSpecifier.text
          : null;
      if (!spec) continue;
      const cible = resoudre(spec, f);
      if (cible && !vus.has(cible)) file.push(cible);
    }
  }
  return vus;
}

function parse(nom: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    nom,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/**
 * Toute lecture du TEXTE d'une erreur : `x.message` / `x['message']`, le binding
 * `const { message } = err`, mais aussi `x.details` / `x.hint` (où PostgREST met
 * la valeur en cause : « Key (email)=(…) already exists »), et les formes qui
 * stringifient l'erreur entière — `String(err)`, `${err}`, `JSON.stringify(err)`.
 * Ces trois-là étaient l'angle mort le plus gênant : le bug `message: String(err)`
 * de `health/logistique` échappait au détecteur né pour l'empêcher (contre-revue
 * sécurité).
 */
const CHAMPS_ERREUR = /^(message|details|hint)$/;
const NOM_ERREUR = /^(err|error|e|ex)$|[eE]rr/;

function litUneErreur(n: ts.Node, src: ts.SourceFile): boolean {
  if (ts.isPropertyAccessExpression(n) && CHAMPS_ERREUR.test(n.name.text))
    return true;
  if (
    ts.isElementAccessExpression(n) &&
    n.argumentExpression &&
    ts.isStringLiteral(n.argumentExpression) &&
    CHAMPS_ERREUR.test(n.argumentExpression.text)
  )
    return true;
  if (
    ts.isBindingElement(n) &&
    ts.isObjectBindingPattern(n.parent) &&
    CHAMPS_ERREUR.test((n.propertyName ?? n.name).getText(src))
  )
    return true;
  if (
    ts.isCallExpression(n) &&
    /^(String|JSON\.stringify)$/.test(n.expression.getText(src)) &&
    n.arguments[0] &&
    NOM_ERREUR.test(n.arguments[0].getText(src))
  )
    return true;
  // `${err}` : l'erreur ELLE-MÊME dans un gabarit. On exige un identifiant nu —
  // `${err.message}` est déjà compté par le cas `PropertyAccess` ci-dessus, le
  // compter deux fois ferait diverger l'auto-test (et le RATCHET_COUNT).
  if (
    ts.isTemplateSpan(n) &&
    ts.isIdentifier(n.expression) &&
    NOM_ERREUR.test(n.expression.getText(src))
  )
    return true;
  return false;
}

/** Remonte les parents jusqu'à un appel dont l'expression matche `motif`. */
function sousAppel(n: ts.Node, src: ts.SourceFile, motif: RegExp): boolean {
  let p: ts.Node | undefined = n.parent;
  while (p) {
    if (
      (ts.isCallExpression(p) || ts.isNewExpression(p)) &&
      motif.test(p.expression.getText(src))
    )
      return true;
    p = p.parent;
  }
  return false;
}

/** Nom de la fonction englobante la plus proche (déclaration ou const fléchée). */
function fonctionEnglobante(n: ts.Node): string | null {
  let p: ts.Node | undefined = n.parent;
  while (p) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (
      ts.isVariableDeclaration(p) &&
      ts.isIdentifier(p.name) &&
      p.initializer &&
      (ts.isArrowFunction(p.initializer) ||
        ts.isFunctionExpression(p.initializer))
    )
      return p.name.text;
    p = p.parent;
  }
  return null;
}

type Trouve = { ligne: number; expr: string };

/** RÈGLE A — message lu à l'intérieur d'un `NextResponse.json(...)`. */
function regleA(source: string): Trouve[] {
  const src = parse('a.tsx', source);
  const out: Trouve[] = [];
  const visit = (n: ts.Node): void => {
    if (
      litUneErreur(n, src) &&
      sousAppel(n, src, /^(NextResponse|Response)\.json$/)
    ) {
      out.push({
        ligne: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        expr: n.getText(src),
      });
    }
    // Un binding `const { message } = err` rend la variable `message` opaque à la
    // remontée de parents : on la traite comme une lecture si elle est ensuite
    // rendue (détecté par le nom, volontairement conservateur).
    if (
      ts.isVariableDeclaration(n) &&
      ts.isObjectBindingPattern(n.name) &&
      n.name.elements.some(
        (e) => (e.propertyName ?? e.name).getText(src) === 'message',
      ) &&
      /NextResponse\.json\([^)]*\bmessage\b/.test(source)
    ) {
      out.push({
        ligne: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        expr: n.getText(src),
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/** RÈGLE B — message FABRIQUÉ pour être rendu, hors fonction de neutralisation. */
function regleB(source: string): Trouve[] {
  const src = parse('b.ts', source);
  const out: Trouve[] = [];
  const visit = (n: ts.Node): void => {
    if (litUneErreur(n, src)) {
      // `body.message` / `payload.message` : une donnée ENTRANTE, pas une erreur.
      if (
        ts.isPropertyAccessExpression(n) &&
        /^(body|payload|input|params|form)$/.test(n.expression.getText(src))
      ) {
        ts.forEachChild(n, visit);
        return;
      }
      const englobante = fonctionEnglobante(n);
      // Lu DANS une fonction de neutralisation, ou PASSÉ EN ARGUMENT à l'une
      // d'elles (`erreur: messageEchecTiers(res.message, …)`) : c'est le chemin
      // voulu, le message n'atteint pas le champ rendu.
      const neutralise =
        (englobante !== null && NEUTRALISEURS.has(englobante)) ||
        sousAppel(n, src, new RegExp(`^(${[...NEUTRALISEURS].join('|')})$`));
      const versLog = sousAppel(n, src, /^(logger|console)\./);
      // Écrit en BASE (`.update({ erreur_synchro: … })`) : c'est du stockage de
      // diagnostic, au même titre qu'un log — pas un rendu au client.
      const versStockage = sousAppel(n, src, /\.(update|insert|upsert)$/);
      if (!neutralise && !versLog && !versStockage) {
        // `new LoaderError(...)` autant que `new Error(...)` : la sous-classe est la
        // régression exacte que le docblock de `loaders.ts` dit prévenir.
        const versThrow = sousAppel(n, src, /Error$/);
        let p: ts.Node | undefined = n.parent;
        let versChamp = false;
        while (p) {
          if (
            ts.isPropertyAssignment(p) &&
            CHAMPS_RENDUS.test(p.name.getText(src))
          ) {
            versChamp = true;
            break;
          }
          p = p.parent;
        }
        if (versThrow || versChamp) {
          out.push({
            ligne: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
            expr: n.getText(src),
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/**
 * RÈGLE D — `messageErreur(...)` RETOURNE le message brut : c'est un helper, pas une
 * neutralisation. Enveloppée dans un appel, la fuite d'origine redevient invisible
 * aux règles A/B (le call-site ne porte aucun `.message` à voir) — démontré par
 * sonde en contre-revue. Seul usage légitime : alimenter un `logger.*`, ou être
 * appelée DEPUIS une fonction de neutralisation.
 */
function regleD(source: string): Trouve[] {
  const src = parse('d.ts', source);
  const out: Trouve[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(src) === 'messageErreur'
    ) {
      const englobante = fonctionEnglobante(n);
      const versLog = sousAppel(n, src, /^(logger|console)\./);
      if (!versLog && !(englobante !== null && NEUTRALISEURS.has(englobante))) {
        out.push({
          ligne: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          expr: n.getText(src).slice(0, 60),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/**
 * RÈGLE E — variable intermédiaire. `const m = e.message; json({ error: m })` :
 * le `.message` n'est lexicalement ni sous `NextResponse.json` (règle A) ni dans
 * un champ rendu (règle B). C'est le réflexe naturel d'un dev face à une règle A
 * rouge — extraire une variable rendait le cliquet vert (contre-revue sécurité).
 * On tient donc les variables TEINTÉES : toute locale initialisée par une lecture
 * d'erreur, puis rendue dans une réponse ou un champ.
 */
function regleE(source: string): Trouve[] {
  const src = parse('e.ts', source);
  // Clé = `<fonction englobante>::<nom>` : sans le scope, deux fonctions d'un même
  // fichier qui nomment toutes deux leur variable `message` se contaminent (faux
  // positif observé entre `messageEchecEcriture` et `businessError`).
  const teintees = new Map<string, number>();
  const cle = (nom: string, n: ts.Node): string =>
    `${fonctionEnglobante(n) ?? '<module>'}::${nom}`;
  const marquer = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer
    ) {
      let lit = false;
      const chercher = (x: ts.Node): void => {
        // `cond ? 'libellé A' : 'libellé B'` : la lecture d'erreur sert de TEST,
        // la valeur retenue est un littéral — la variable n'est pas teintée.
        if (
          ts.isConditionalExpression(x) &&
          ts.isStringLiteral(x.whenTrue) &&
          ts.isStringLiteral(x.whenFalse)
        )
          return;
        if (litUneErreur(x, src)) lit = true;
        ts.forEachChild(x, chercher);
      };
      chercher(n.initializer);
      if (lit)
        teintees.set(
          cle(n.name.text, n),
          src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        );
    }
    ts.forEachChild(n, marquer);
  };
  marquer(src);
  if (teintees.size === 0) return [];

  const out: Trouve[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && teintees.has(cle(n.text, n))) {
      const estDeclaration =
        ts.isVariableDeclaration(n.parent) && n.parent.name === n;
      const versLog = sousAppel(n, src, /^(logger|console)\./);
      let rendu = sousAppel(n, src, /^(NextResponse|Response)\.json$/);
      if (!rendu) {
        let p: ts.Node | undefined = n.parent;
        while (p) {
          if (
            (ts.isPropertyAssignment(p) &&
              CHAMPS_RENDUS.test(p.name.getText(src))) ||
            (ts.isShorthandPropertyAssignment(p) &&
              CHAMPS_RENDUS.test(p.name.getText(src)))
          ) {
            rendu = true;
            break;
          }
          p = p.parent;
        }
      }
      if (rendu && !estDeclaration && !versLog) {
        out.push({
          ligne: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          expr: `${n.text} (teintée l.${teintees.get(cle(n.text, n))})`,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/** RÈGLE C — `NextResponse.json(result)` : objet de résultat applicatif rendu en bloc. */
function regleC(source: string): Trouve[] {
  const src = parse('c.tsx', source);
  const out: Trouve[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      /^(NextResponse|Response)\.json$/.test(n.expression.getText(src)) &&
      n.arguments[0] &&
      ts.isIdentifier(n.arguments[0]) &&
      // Un `data`/`org` est la donnée métier du cas nominal ; un `result` est le
      // RÉSULTAT APPLICATIF d'un helper `{ ok, erreur, erreur_synchro }` — c'est
      // celui-là qui embarque du diagnostic. La règle B tient la construction de
      // ces champs ; cette règle-ci empêche de les rendre en bloc par accident.
      /^(result|resultat|res)$/.test(n.arguments[0].getText(src))
    ) {
      out.push({
        ligne: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        expr: n.arguments[0].getText(src),
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

const SONDES: {
  regle: 'A' | 'B' | 'C' | 'D' | 'E';
  source: string;
  attendus: number;
}[] = [
  // ── Règle A : la forme d'origine, et ses contournements ──
  {
    regle: 'A',
    source: `return NextResponse.json({ error: error.message }, { status: 500 });`,
    attendus: 1,
  },
  {
    regle: 'A',
    source: `return NextResponse.json(\n  { error: authError?.message ?? 'x' },\n  { status: 422 },\n);`,
    attendus: 1,
  },
  {
    regle: 'A',
    source: `return NextResponse.json({ status: 'ko', erreur: \`lecture : \${error.message}\` }, { status: 503 });`,
    attendus: 1,
  },
  // Contournements relevés en revue sécurité : crochets et binding.
  {
    regle: 'A',
    source: `return NextResponse.json({ error: error['message'] }, { status: 500 });`,
    attendus: 1,
  },
  {
    regle: 'A',
    source: `const { message } = error;\nreturn NextResponse.json({ error: message }, { status: 500 });`,
    attendus: 1,
  },
  {
    regle: 'A',
    source: `if (error) return serverError(error, 'admin.collectes.list');`,
    attendus: 0,
  },
  {
    regle: 'A',
    source: `logger.error('api_route.error', { route, error: error.message });`,
    attendus: 0,
  },
  // Formes stringifiées et champs PostgREST (angles morts de la v1) :
  {
    regle: 'A',
    source: `return NextResponse.json({ erreur: String(err) }, { status: 503 });`,
    attendus: 1,
  },
  {
    regle: 'A',
    source: `return NextResponse.json({ error: \`échec : \${err}\` }, { status: 500 });`,
    attendus: 1,
  },
  {
    regle: 'A',
    source: `return NextResponse.json({ error: error.details }, { status: 500 });`,
    attendus: 1,
  },
  // ── Règle B : le message fabriqué pour être rendu ──
  {
    regle: 'B',
    source: `if (error) throw new Error(error.message);`,
    attendus: 1,
  },
  {
    regle: 'B',
    source: `throw new Error(\`rpc_x: \${error.message}\`);`,
    attendus: 1,
  },
  {
    regle: 'B',
    source: `return { ok: false, erreur: error.message, statut: 422 };`,
    attendus: 1,
  },
  {
    regle: 'B',
    source: `return { ok: false, erreur: err['message'] };`,
    attendus: 1,
  },
  {
    regle: 'B',
    source: `if (error) throw erreurInterne(error, 'exports.builders');`,
    attendus: 0,
  },
  {
    // Sous-classe d'Error : la régression que le docblock de loaders.ts prévient.
    regle: 'B',
    source: `if (error) throw new LoaderError(error.message);`,
    attendus: 1,
  },
  {
    regle: 'B',
    source: `logger.warn('x', { error: error.message });`,
    attendus: 0,
  },
  {
    // Lecture interne sans rendu ni throw (ex. un `includes`) : hors portée.
    regle: 'B',
    source: `const msg = (error?.message ?? '').toLowerCase();\nif (msg.includes('already')) return 1;`,
    attendus: 0,
  },
  {
    // La fonction de neutralisation elle-même a le droit de lire le message.
    regle: 'B',
    source: `function erreurInterne(err) {\n  return new Error(err.message);\n}`,
    attendus: 0,
  },
  {
    // …et on a le droit de LUI PASSER le message.
    regle: 'B',
    source: `return { ok: false, erreur: messageEchecTiers(res.message, 'pennylane.x') };`,
    attendus: 0,
  },
  {
    // Écriture en base d'un champ de diagnostic : stockage, pas rendu.
    regle: 'B',
    source: `await supabase.from('factures').update({ erreur_synchro: res.message });`,
    attendus: 0,
  },
  // ── Règle C : l'objet de résultat rendu en bloc ──
  {
    regle: 'C',
    source: `return NextResponse.json(result, { status });`,
    attendus: 1,
  },
  {
    regle: 'C',
    source: `return NextResponse.json({ data: result }, { status: 201 });`,
    attendus: 0,
  },
  // ── Règle D : le helper qui rend le message brut ──
  {
    regle: 'D',
    source: `return NextResponse.json({ error: messageErreur(err) }, { status: 500 });`,
    attendus: 1,
  },
  {
    regle: 'D',
    source: `return { ok: false, erreur: messageErreur(err) };`,
    attendus: 1,
  },
  {
    regle: 'D',
    source: `logger.error('api_route.error', { error: messageErreur(err) });`,
    attendus: 0,
  },
  // ── Règle E : la variable intermédiaire ──
  {
    regle: 'E',
    source: `const message = e instanceof Error ? e.message : 'x';\nreturn NextResponse.json({ error: message }, { status: 500 });`,
    attendus: 1,
  },
  {
    regle: 'E',
    source: `const msg = err.message;\nreturn { ok: false, erreur: msg };`,
    attendus: 1,
  },
  {
    regle: 'E',
    source: `const msg = err.message;\nlogger.warn('x', { error: msg });`,
    attendus: 0,
  },
  {
    regle: 'E',
    source: `const nb = data.total;\nreturn NextResponse.json({ error: nb });`,
    attendus: 0,
  },
  {
    // La lecture d'erreur sert de TEST, la valeur rendue est un littéral.
    regle: 'E',
    source: `const motif = err.message.includes('x') ? 'Libellé A' : 'Libellé B';\nreturn NextResponse.json({ error: motif }, { status: 401 });`,
    attendus: 0,
  },
  {
    // …mais un repli qui laisse passer le message reste teinté.
    regle: 'E',
    source: `const motif = cond ? 'Libellé A' : err.message;\nreturn NextResponse.json({ error: motif }, { status: 401 });`,
    attendus: 1,
  },
];

function autoTest(): void {
  const moteur = {
    A: regleA,
    B: regleB,
    C: regleC,
    D: regleD,
    E: regleE,
  } as const;
  const echecs = SONDES.filter(
    (s) => moteur[s.regle](s.source).length !== s.attendus,
  );
  if (echecs.length === 0) return;
  console.error(
    '🔴 check-api-error-leak : DÉTECTEUR EN ÉCHEC (auto-test) — le gate ne prouve plus rien :',
  );
  for (const s of echecs) {
    console.error(
      `   [${s.regle}] ${JSON.stringify(s.source).slice(0, 80)} → ${moteur[s.regle](s.source).length} détecté(s), ${s.attendus} attendu(s)`,
    );
  }
  process.exit(1);
}

type Violation = { fichier: string; ligne: number; code: string };

function violations(): Violation[] {
  const trouvees: Violation[] = [];
  const ligneDe = (source: string, n: number): string =>
    (source.split('\n')[n - 1] ?? '').trim().slice(0, 100);

  // Règles A et C — les réponses HTTP.
  for (const f of fichiersApi()) {
    const source = readFileSync(f, 'utf8');
    for (const { ligne, expr } of regleA(source)) {
      const autorise = ALLOWLIST_REPONSE.some(
        (a) => a.fichiers.test(f) && a.expr === expr,
      );
      if (!autorise)
        trouvees.push({ fichier: f, ligne, code: ligneDe(source, ligne) });
    }
    // Les crons sont derrière CRON_SECRET : leurs `errors[]` de diagnostic ne sont
    // pas exposés (même exclusion que pour la règle B, via le graphe).
    if (f.includes('/api/cron/')) continue;
    for (const { ligne, expr } of regleD(source).concat(regleE(source))) {
      trouvees.push({
        fichier: f,
        ligne,
        code: `[message rendu indirectement] ${expr} — ${ligneDe(source, ligne)}`,
      });
    }
    for (const { ligne, expr } of regleC(source)) {
      if (ALLOWLIST_BLOC.some((r) => r.test(f))) continue;
      trouvees.push({
        fichier: f,
        ligne,
        code: `[objet rendu en bloc] NextResponse.json(${expr}) — ${ligneDe(source, ligne)}`,
      });
    }
  }

  // Règle B — les fabricants de messages, sur le périmètre atteignable.
  for (const f of modulesAtteignables()) {
    if (/\.(test|spec)\.tsx?$/.test(f)) continue;
    // Les routes ne sont PAS exclues : un `throw new Error(pgErr.message)` écrit
    // dans le fichier de route lui-même, rattrapé par son propre `catch` puis rendu
    // via une variable intermédiaire, échappait simultanément à A, B et C
    // (vecteur (e), contre-revue sécurité).
    if (ALLOWLIST_SOURCE.some((a) => a.fichier.test(f))) continue;
    const source = readFileSync(f, 'utf8');
    // D et E valent AUSSI côté producteur : `const m = error.message; return
    // { ok: false, erreur: m }` dans `lib/facturation/**` est le même réflexe
    // d'extraction de variable, juste de l'autre côté de la frontière HTTP.
    for (const { ligne, expr } of regleD(source).concat(regleE(source))) {
      trouvees.push({
        fichier: f,
        ligne,
        code: `[message rendu indirectement] ${expr} — ${ligneDe(source, ligne)}`,
      });
    }
    for (const { ligne, expr } of regleB(source)) {
      // Même justification que pour la règle A : ces expressions portent une erreur
      // applicative dont le message est neutralisé à la construction.
      if (ALLOWLIST_REPONSE.some((a) => a.fichiers.test(f) && a.expr === expr))
        continue;
      trouvees.push({
        fichier: f,
        ligne,
        code: `[message fabriqué] ${expr} — ${ligneDe(source, ligne)}`,
      });
    }
  }
  return trouvees;
}

autoTest();
const trouvees = violations();
if (trouvees.length > 0) {
  console.error(
    `🔴 check-api-error-leak : ${trouvees.length} message(s) d'erreur exposable(s) au client :`,
  );
  for (const v of trouvees)
    console.error(`   ${v.fichier}:${v.ligne}  ${v.code}`);
  console.error(
    '   → réponse : serverError() / writeError() / typedRpcError(), ou businessError(error, event, [codes], status)\n' +
      '     quand le message est un libellé métier écrit par nous ;\n' +
      '   → module lib/ : erreurInterne() pour un throw, messageEchecEcriture()/messageEchecTiers() pour un champ rendu.',
  );
} else {
  console.log(
    "✅ check-api-error-leak : 0 message d'erreur exposable au client (règles A→E).",
  );
}
console.log(`RATCHET_COUNT=${trouvees.length}`);
