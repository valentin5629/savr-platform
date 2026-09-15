#!/usr/bin/env tsx
/**
 * check-api-error-leak — cliquet « aucun message d'erreur DB/tierce dans une réponse ».
 * =============================================================================
 * Classe fermée par la PR #276 (« synthèse PDF — erreurs génériques ») puis
 * généralisée : `return NextResponse.json({ error: error.message }, …)` renvoie au
 * client le message Postgres BRUT — noms de tables et de colonnes, nom de la
 * contrainte violée, détail PostgREST. C'est la structure interne de la base
 * offerte à qui poste un corps invalide. Relevé une fois de plus par
 * `reviewer-rls-securite` sur `programmation/organisations/shadow` (revue #303) :
 * 134 sites étaient concernés, dans 95 routes.
 *
 * Garde : dans `packages/plateforme/src/app/api/**`, aucun `<expr>.message` ne
 * doit apparaître à l'intérieur d'un appel `NextResponse.json(...)`.
 *   ✅ `return serverError(error, 'admin.collectes.list')`   (500, message neutre)
 *   ✅ `return writeError(error, 'admin.users.create')`      (422, message neutre)
 *   ✅ `return businessError(error, ev, ['22023'], 422)`     (allowlist de codes)
 *   ✅ `logger.error('api_route.error', { error: error.message })`  (LOG serveur)
 *   ❌ `return NextResponse.json({ error: error.message }, { status: 500 })`
 *
 * Ce que le gate NE voit PAS (angles morts assumés, couverts par revue) :
 *   - le message copié dans une variable intermédiaire puis renvoyée
 *     (`const m = e.message; … json({ error: m })`) ;
 *   - le message transporté par une erreur applicative construite AILLEURS puis
 *     renvoyée par la route. Les deux vecteurs connus de cette forme sont tenus
 *     à leur source, et doivent le rester :
 *       · `lib/dashboards/loaders.ts` → `loaderDbError()` logge et neutralise
 *         (8 routes `dashboards/*` renvoient `e.message` d'un `LoaderError`) ;
 *       · `lib/pdf/regenerate.ts` → `dbError()` pour le code `DB_ERROR`
 *         (2 routes `…/documents/[type]/regenerate` renvoient `result.message`).
 *     Toute nouvelle erreur applicative renvoyée telle quelle doit neutraliser à
 *     la construction, comme ces deux-là.
 * Le détecteur s'auto-teste à chaque exécution (SONDES) : un cliquet devenu
 * aveugle à la forme qu'il est né pour attraper produit exactement la fausse
 * confiance qu'il prétend supprimer.
 *
 * Émet RATCHET_COUNT=<n> — câblé dans `pnpm check:ratchet` avec baseline 0.
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import ts from 'typescript';

const RACINE = 'packages/plateforme/src/app/api';

function fichiers(): string[] {
  const out = execSync(
    `grep -rl --include='*.ts' --include='*.tsx' '\\.message' ${RACINE} || true`,
    { encoding: 'utf8' },
  ).trim();
  if (!out) return [];
  return out.split('\n').filter((f) => !/\.(test|spec)\.tsx?$/.test(f));
}

type Violation = { fichier: string; ligne: number; code: string };

/**
 * RÈGLE B — verrou à la source. Ces fichiers construisent des erreurs qu'une route
 * renvoie TELLES QUELLES au client (`LoaderError.message`, `RegenerateResult.message`) :
 * le message doit donc y être neutralisé à la construction. La garde : aucun
 * `<expr>.message` ne peut y apparaître HORS de la fonction de neutralisation —
 * dont le rôle est précisément de logger le message réel et de n'en renvoyer aucun.
 * C'est ce verrou qui rend l'ALLOWLIST_REPONSE ci-dessous légitime.
 */
const SOURCES_NEUTRALISEES: { fichier: string; fonction: string }[] = [
  {
    fichier: 'packages/plateforme/src/lib/dashboards/loaders.ts',
    fonction: 'loaderDbError',
  },
  {
    fichier: 'packages/plateforme/src/lib/pdf/regenerate.ts',
    fonction: 'dbError',
  },
];

/**
 * Accès `<expr>.message` situés à l'intérieur d'un appel `NextResponse.json(...)`.
 * Pure (non exportée : importer ce module exécuterait le gate) — c'est ce que les
 * sondes d'auto-test ci-dessous exercent, sur du source synthétique.
 */
function messagesDansReponse(
  source: string,
): { ligne: number; expr: string }[] {
  const src = ts.createSourceFile(
    'x.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const trouves: { ligne: number; expr: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'message' &&
      dansReponseJson(node, src)
    ) {
      trouves.push({
        ligne: src.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        expr: node.getText(src),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return trouves;
}

/**
 * RÈGLE B — `<expr>.message` situés HORS de la fonction de neutralisation, dans un
 * fichier dont les erreurs sont renvoyées telles quelles au client.
 */
function messagesHorsNeutralisation(
  source: string,
  fonction: string,
): { ligne: number; expr: string }[] {
  const src = ts.createSourceFile(
    'x.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const trouves: { ligne: number; expr: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'message') {
      let p: ts.Node | undefined = node.parent;
      let dedans = false;
      while (p) {
        if (
          (ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p)) &&
          p.name &&
          p.name.getText(src) === fonction
        ) {
          dedans = true;
          break;
        }
        p = p.parent;
      }
      if (!dedans) {
        trouves.push({
          ligne: src.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          expr: node.getText(src),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return trouves;
}

/** Remonte les parents à la recherche d'un `NextResponse.json(...)` englobant. */
function dansReponseJson(node: ts.Node, src: ts.SourceFile): boolean {
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (
      ts.isCallExpression(p) &&
      /^(NextResponse|Response)\.json$/.test(p.expression.getText(src))
    ) {
      return true;
    }
    p = p.parent;
  }
  return false;
}

/**
 * Erreurs APPLICATIVES renvoyées telles quelles par une route, dont le message est
 * garanti neutre PAR SA CONSTRUCTION (règle B ci-dessous, qui verrouille la source).
 * Sans cette liste le gate rougirait sur du code correct ; sans la règle B, la
 * liste serait un trou — les deux vont ensemble.
 */
const ALLOWLIST_REPONSE: { fichiers: RegExp; expr: string; source: string }[] =
  [
    {
      // 8 routes renvoient `{ error: e.message }` d'un `LoaderError` attrapé.
      fichiers:
        /\/api\/v1\/(dashboards\/(benchmark|benchmark\/filtres|traiteur-full|blocs|evolution|kpi-traiteur)|traiteur\/marge-attente-facturation|programmation\/pack-ag)\/route\.ts$/,
      expr: 'e.message',
      source: SOURCES_NEUTRALISEES[0]!.fichier,
    },
    {
      // 2 routes renvoient `{ error: result.message }` d'un RegenerateResult.
      fichiers: /\/documents\/\[type\]\/regenerate\/route\.ts$/,
      expr: 'result.message',
      source: SOURCES_NEUTRALISEES[1]!.fichier,
    },
  ];

const SONDES: { source: string; attendus: number }[] = [
  // La forme exacte du bug, sur une ligne et sur plusieurs.
  {
    source: `return NextResponse.json({ error: error.message }, { status: 500 });`,
    attendus: 1,
  },
  {
    source: `return NextResponse.json(\n  { error: authError?.message ?? 'x' },\n  { status: 422 },\n);`,
    attendus: 1,
  },
  // Message enfoui dans un gabarit ou une propriété au nom différent.
  {
    source: `return NextResponse.json({ status: 'ko', erreur: \`lecture : \${error.message}\` }, { status: 503 });`,
    attendus: 1,
  },
  // Variable d'erreur au nom quelconque, et statut porté par une variable.
  {
    source: `return NextResponse.json({ error: rpcErr.message }, { status });`,
    attendus: 1,
  },
  // Deux fuites dans le même appel = deux violations.
  {
    source: `return NextResponse.json({ a: e.message, b: f.message }, { status: 500 });`,
    attendus: 2,
  },
  // Chemins légitimes : helpers neutres et LOG serveur.
  {
    source: `if (error) return serverError(error, 'admin.collectes.list');`,
    attendus: 0,
  },
  {
    source: `logger.error('api_route.error', { route, error: error.message });`,
    attendus: 0,
  },
  {
    source: `const m = err instanceof Error ? err.message : '';\nlogger.warn('x', { m });`,
    attendus: 0,
  },
];

function autoTest(): void {
  const echecs = SONDES.filter(
    (s) => messagesDansReponse(s.source).length !== s.attendus,
  );
  if (echecs.length === 0) return;
  console.error(
    '🔴 check-api-error-leak : DÉTECTEUR EN ÉCHEC (auto-test) — le gate ne prouve plus rien :',
  );
  for (const s of echecs) {
    console.error(
      `   ${JSON.stringify(s.source).slice(0, 90)} → ${messagesDansReponse(s.source).length} détecté(s), ${s.attendus} attendu(s)`,
    );
  }
  process.exit(1);
}

function autorise(fichier: string, expr: string): boolean {
  return ALLOWLIST_REPONSE.some(
    (a) => a.fichiers.test(fichier) && a.expr === expr,
  );
}

function violations(): Violation[] {
  const trouvees: Violation[] = [];
  // Règle A — app/api : pas de `.message` dans une réponse.
  for (const f of fichiers()) {
    const source = readFileSync(f, 'utf8');
    const lignesSrc = source.split('\n');
    for (const { ligne, expr } of messagesDansReponse(source)) {
      if (autorise(f, expr)) continue;
      trouvees.push({
        fichier: f,
        ligne,
        code: (lignesSrc[ligne - 1] ?? '').trim().slice(0, 100),
      });
    }
  }
  // Règle B — sources dont les erreurs sont renvoyées telles quelles.
  for (const { fichier, fonction } of SOURCES_NEUTRALISEES) {
    const source = readFileSync(fichier, 'utf8');
    const lignesSrc = source.split('\n');
    for (const { ligne, expr } of messagesHorsNeutralisation(
      source,
      fonction,
    )) {
      trouvees.push({
        fichier,
        ligne,
        code: `[source neutralisée] ${expr} hors ${fonction}() — ${(lignesSrc[ligne - 1] ?? '').trim().slice(0, 70)}`,
      });
    }
  }
  return trouvees;
}

autoTest();
const trouvees = violations();
if (trouvees.length > 0) {
  console.error(
    `🔴 check-api-error-leak : ${trouvees.length} message(s) d'erreur renvoyé(s) au client :`,
  );
  for (const v of trouvees) {
    console.error(`   ${v.fichier}:${v.ligne}  ${v.code}`);
  }
  console.error(
    '   → utiliser serverError() / writeError() / typedRpcError() (message neutre, erreur réelle loggée),\n' +
      '     ou businessError(error, event, [codes], status) quand le message est un libellé métier écrit par nous.',
  );
} else {
  console.log(
    "✅ check-api-error-leak : 0 message d'erreur brut renvoyé au client depuis app/api.",
  );
}
console.log(`RATCHET_COUNT=${trouvees.length}`);
