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
 * RÈGLE F — dans tout fichier SERVEUR qui touche au moteur HTTP (adapters,
 *   shared, plateforme hors composants navigateur, apps : `fetch` appelé ou pris
 *   comme valeur, `new Request`, `new Headers`), l'erreur ATTRAPÉE ne se lit pas.
 *   Ce n'est plus la
 *   structure de la base qui fuit, c'est un SECRET : le moteur recopie dans son
 *   erreur la valeur qu'il refuse — « Headers.append: "Bearer <clé entière>" is an
 *   invalid header value. », « Failed to parse URL from <adresse entière> »
 *   (mesuré le 2026-10-13, Node 22.23.2 et 25.9.0). Et la fuite ne passe pas par
 *   une réponse HTTP, que voient les règles A à E : elle passe par une colonne
 *   (`integrations_logs.erreur`, `outbox_events.last_error`, `jobs_pdf.last_error`,
 *   `factures.erreur_synchro`), un journal ou une alerte, relus plus tard par un
 *   écran. La règle ne suit donc pas le texte : elle interdit de le prendre.
 *   Tout usage de la variable d'un `catch (err)`, du paramètre d'un
 *   `.catch((err) => …)` ou d'un `.then(ok, (err) => …)`, et de la `.reason` d'un
 *   `Promise.allSettled`, est refusé, sauf :
 *     ✅ `libelleErreurReseau(err)` / `decrireErreurReseau(err)` (le classeur)
 *     ✅ `err instanceof X`, `typeof err`, `err.name` (la classe, pas le texte)
 *     ✅ `err.code`, `err.cause?.code` (un code machine : ECONNREFUSED…)
 *     ✅ `throw err` (relancée telle quelle — cf. « ce que la règle ne voit pas »)
 *     ❌ `String(err)`, `${err}`, `err.message`, `err.stack`, `{ cause: err }`,
 *        `logger.error('x', { error: err.message })` (un journal est un texte
 *        conservé), `capturer(err)` (l'erreur entière confiée à un tiers)
 *     ❌ `.catch(console.error)`, `.catch(traiter)`, `.then(ok, traiter)` : un
 *        gestionnaire passé par RÉFÉRENCE reçoit l'erreur hors de vue — l'écrire
 *        sur place.
 *   Portée : TOUT `catch` du fichier, pas seulement celui qui entoure le `fetch`
 *   — l'appel passe souvent par une méthode intermédiaire
 *   (`this.postJson(…).catch(…)`).
 *   CE QUE LA RÈGLE NE VOIT PAS (mesuré par le relecteur sécurité, 2026-10-13) :
 *     – une erreur qui sort du fichier sans y être attrapée (`fetch` sans `try`,
 *       ou `throw err`) : c'est l'appelant qui la lit, dans un fichier sans
 *       `fetch` ;
 *     – un fichier où le moteur n'apparaît sous aucun de ses noms : `fetch`
 *       injecté (`this.appeler(url)`), client bâti sur un SDK (base, stockage,
 *       emails) ;
 *     – une erreur rangée dans une variable d'un autre nom que celui du `catch`
 *       avant d'être lue plus loin dans une AUTRE fonction.
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
      'surveiller : le client HTTP de l’adapter (`erreur: String(err)`) — tenu ' +
      'depuis le 2026-10-13 par la règle F, que cette liste n’exempte pas.',
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
  // La teinte est portée par la PORTÉE LEXICALE de la déclaration, pas par le nom
  // de la fonction englobante : une variable déclarée au niveau module et rendue
  // dans `export const GET = async () => …` reste la même variable (faux négatif
  // d'une première version, relevé en revue). À l'inverse, deux fonctions
  // distinctes qui nomment toutes deux leur variable `message` ne se contaminent
  // pas, puisqu'aucune n'est un ancêtre de l'autre.
  const teintees: { nom: string; portee: ts.Node; ligne: number }[] = [];
  const porteeDe = (n: ts.Node): ts.Node => {
    let p: ts.Node | undefined = n.parent;
    while (p) {
      if (
        ts.isBlock(p) ||
        ts.isSourceFile(p) ||
        ts.isModuleBlock(p) ||
        ts.isCaseClause(p)
      )
        return p;
      p = p.parent;
    }
    return src;
  };
  const estTeinte = (nom: string, usage: ts.Node): number | null => {
    for (const t of teintees) {
      if (t.nom !== nom) continue;
      let p: ts.Node | undefined = usage;
      while (p) {
        if (p === t.portee) return t.ligne;
        p = p.parent;
      }
    }
    return null;
  };
  /**
   * Portée d'une variable AFFECTÉE, résolue en remontant depuis le site
   * d'affectation — la première portée englobante qui déclare le nom (ou le lie
   * comme paramètre). Scanner le fichier de haut en bas, comme le faisait une
   * première version, dépend de l'ORDRE du fichier : avec deux handlers déclarant
   * chacun `let msg`, le gate pouvait désigner la ligne saine du premier pendant
   * que la fuite du second passait — un dev « corrigeant » le site désigné rendait
   * le gate vert sur une fuite vive (relevé en revue). Nom introuvable = pas de
   * teinte : sans déclaration, on ne sait pas de quelle variable on parle.
   */
  const porteeAffectation = (nom: string, depuis: ts.Node): ts.Node | null => {
    const declareLeNom = (portee: ts.Node): boolean => {
      let trouve = false;
      const visiter = (x: ts.Node): void => {
        if (trouve) return;
        if (ts.isVariableDeclaration(x) || ts.isParameter(x)) {
          // Nom simple, mais AUSSI liaison déstructurée (`let { detail } = …`,
          // `let [a, msg] = …`, paramètre `function h({ detail })`) : ne
          // reconnaître que `isIdentifier` laissait ces variables sans portée,
          // donc sans teinte — un fail-open (relevé en revue).
          const lieLeNom = (nomN: ts.Node): boolean => {
            if (ts.isIdentifier(nomN)) return nomN.text === nom;
            if (
              ts.isObjectBindingPattern(nomN) ||
              ts.isArrayBindingPattern(nomN)
            )
              return nomN.elements.some(
                (el) => ts.isBindingElement(el) && lieLeNom(el.name),
              );
            return false;
          };
          if (lieLeNom(x.name)) {
            trouve = true;
            return;
          }
        }
        // Ne pas descendre dans une fonction imbriquée : sa portée est distincte.
        if (
          x !== portee &&
          (ts.isFunctionDeclaration(x) ||
            ts.isFunctionExpression(x) ||
            ts.isArrowFunction(x))
        )
          return;
        ts.forEachChild(x, visiter);
      };
      ts.forEachChild(portee, visiter);
      return trouve;
    };
    let p: ts.Node | undefined = depuis.parent;
    while (p) {
      if (
        ts.isBlock(p) ||
        ts.isSourceFile(p) ||
        ts.isModuleBlock(p) ||
        ts.isCaseClause(p) ||
        ts.isFunctionDeclaration(p) ||
        ts.isFunctionExpression(p) ||
        ts.isArrowFunction(p)
      ) {
        if (declareLeNom(p)) return p;
      }
      p = p.parent;
    }
    return null;
  };

  const marquer = (n: ts.Node): void => {
    // `let m = ''; … m = e.message` : la teinte n'arrive pas par l'initialiseur
    // mais par une affectation (typiquement dans un `catch`). Portée = celle de la
    // déclaration du nom, sinon le module.
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(n.left)
    ) {
      let lit = false;
      const chercher = (x: ts.Node): void => {
        if (litUneErreur(x, src)) lit = true;
        ts.forEachChild(x, chercher);
      };
      chercher(n.right);
      const portee = lit ? porteeAffectation(n.left.text, n) : null;
      if (portee)
        teintees.push({
          nom: n.left.text,
          portee,
          ligne: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        });
    }
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
        teintees.push({
          nom: n.name.text,
          portee: porteeDe(n),
          ligne: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        });
    }
    ts.forEachChild(n, marquer);
  };
  marquer(src);
  if (teintees.length === 0) return [];

  const out: Trouve[] = [];
  const visit = (n: ts.Node): void => {
    const ligneTeinte = ts.isIdentifier(n) ? estTeinte(n.text, n) : null;
    if (ligneTeinte !== null && ts.isIdentifier(n)) {
      const estDeclaration =
        ts.isVariableDeclaration(n.parent) && n.parent.name === n;
      const englobante = fonctionEnglobante(n);
      const versLog =
        sousAppel(n, src, /^(logger|console)\./) ||
        (englobante !== null && NEUTRALISEURS.has(englobante));
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
          expr: `${n.text} (teintée l.${ligneTeinte})`,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/**
 * Racines visitées par la règle F, et le NOMBRE de fichiers que chacune rend
 * aujourd'hui. Ce nombre est un plancher : s'il baisse, le garde sort en erreur
 * au lieu de dire « 0 » sur un périmètre rétréci (racine renommée, recherche
 * cassée, fichier sorti de la découverte). Un fichier qui cesse pour de bon
 * d'appeler `fetch` se traduit ici, par un plancher baissé à la main.
 */
const RACINES_FETCH: Record<string, number> = {
  'packages/adapters/src': 2,
  'packages/shared/src': 3,
  [SRC]: 6,
  apps: 0,
};

/** Les deux seules fonctions à qui l'on confie l'erreur d'un `fetch`. */
const CLASSEURS = /^(libelleErreurReseau|decrireErreurReseau)$/;

/**
 * Le fichier touche-t-il au moteur HTTP ? `fetch` appelé ou pris comme valeur
 * (`const f = fetch`, `globalThis.fetch`, `{ fetch }`), `new Request(…)`,
 * `new Headers(…)` — les trois lèvent la même erreur, qui cite la valeur refusée.
 * `this.fetch(…)` n'en est pas : c'est une méthode maison du même nom.
 */
function appelleFetch(src: ts.SourceFile): boolean {
  let trouve = false;
  const estLeMoteur = (id: ts.Identifier): boolean => {
    const p = id.parent;
    // Membre : seul `globalThis.fetch` (ou window / self) désigne le moteur.
    if (ts.isPropertyAccessExpression(p) && p.name === id)
      return /^(globalThis|window|self)$/.test(p.expression.getText(src));
    // Nom d'une déclaration (méthode, clé, paramètre, variable) : pas un usage.
    if (
      (ts.isMethodDeclaration(p) ||
        ts.isMethodSignature(p) ||
        ts.isPropertyDeclaration(p) ||
        ts.isPropertySignature(p) ||
        ts.isPropertyAssignment(p) ||
        ts.isFunctionDeclaration(p) ||
        ts.isParameter(p) ||
        ts.isVariableDeclaration(p) ||
        ts.isBindingElement(p)) &&
      p.name === id
    )
      return false;
    return true;
  };
  const visit = (n: ts.Node): void => {
    if (trouve) return;
    if (
      (ts.isIdentifier(n) && n.text === 'fetch' && estLeMoteur(n)) ||
      (ts.isNewExpression(n) &&
        /^(Request|Headers)$/.test(n.expression.getText(src)))
    ) {
      trouve = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return trouve;
}

/** Fichiers serveur, hors tests et hors composants navigateur, qui appellent `fetch`. */
function fichiersAvecFetch(): string[] {
  const out = execSync(
    `grep -rl --include='*.ts' --include='*.tsx' -e 'fetch' -e 'new Request' -e 'new Headers' ${Object.keys(RACINES_FETCH).join(' ')} 2>/dev/null || true`,
    { encoding: 'utf8' },
  ).trim();
  return (out ? out.split('\n') : []).filter((f) => {
    // Tests et outillage de test : jamais du code servi.
    if (
      /\.(test|spec)\.tsx?$/.test(f) ||
      f.includes('/test-utils/') ||
      f.includes('/node_modules/')
    )
      return false;
    const source = readFileSync(f, 'utf8');
    // Un composant navigateur n'a aucun secret à citer : il appelle nos routes.
    if (/^\s*['"]use client['"]/m.test(source.slice(0, 400))) return false;
    return appelleFetch(parse(f, source));
  });
}

/** RÈGLE F — l'erreur attrapée d'un fichier qui appelle `fetch` ne se lit pas. */
function regleF(source: string): Trouve[] {
  const src = parse('f.ts', source);
  if (!appelleFetch(src)) return [];
  const vus = new Set<number>();
  const out: Trouve[] = [];
  const noter = (n: ts.Node): void => {
    if (vus.has(n.getStart())) return;
    vus.add(n.getStart());
    // On montre l'expression qui LIT (`String(err)`, `err.message`), pas le nom nu.
    const lu = ts.isIdentifier(n) ? n.parent : n;
    out.push({
      ligne: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
      expr: lu.getText(src).slice(0, 60),
    });
  };
  const usagePermis = (id: ts.Expression): boolean => {
    const p = id.parent;
    if (
      ts.isBinaryExpression(p) &&
      p.left === id &&
      p.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
    )
      return true;
    if (ts.isTypeOfExpression(p)) return true;
    if (ts.isPropertyAccessExpression(p) && p.expression === id) {
      // La classe de l'erreur et son code machine, pas son texte.
      if (p.name.text === 'name' || p.name.text === 'code') return true;
      // `err.cause?.code` — et lui seul : `err.cause` porte aussi un message.
      const pp = p.parent;
      if (
        p.name.text === 'cause' &&
        ts.isPropertyAccessExpression(pp) &&
        pp.expression === p &&
        pp.name.text === 'code'
      )
        return true;
    }
    if (ts.isThrowStatement(p)) return true;
    if (
      ts.isCallExpression(p) &&
      p.arguments.some((a) => a === id) &&
      CLASSEURS.test(p.expression.getText(src))
    )
      return true;
    return false;
  };
  const usagePermisDe = usagePermis;
  const examiner = (nom: string, portee: ts.Node): void => {
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === nom) {
        const p = n.parent;
        // Le MOT `err` employé comme nom de membre ou de clé n'est pas la variable.
        const simpleNom =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n);
        if (!simpleNom && !usagePermis(n)) noter(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(portee);
  };
  const erreurDe = (
    f: ts.Expression | undefined,
  ): { nom: ts.BindingName; corps: ts.Node } | null => {
    if (!f || !(ts.isArrowFunction(f) || ts.isFunctionExpression(f)))
      return null;
    const param = f.parameters[0];
    return param ? { nom: param.name, corps: f.body } : null;
  };
  const visit = (n: ts.Node): void => {
    let liee: { nom: ts.BindingName; corps: ts.Node } | null = null;
    if (ts.isCatchClause(n) && n.variableDeclaration) {
      liee = { nom: n.variableDeclaration.name, corps: n.block };
    } else if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression)
    ) {
      // `.catch(fn)` et le second argument de `.then(ok, fn)`.
      const methode = n.expression.name.text;
      const gestionnaire =
        methode === 'catch'
          ? n.arguments[0]
          : methode === 'then'
            ? n.arguments[1]
            : undefined;
      liee = erreurDe(gestionnaire);
      // Gestionnaire passé par référence (`.catch(console.error)`,
      // `.catch(traiter)`) : il reçoit l'erreur hors de vue. Une fonction écrite
      // sur place sans paramètre (`.catch(() => undefined)`) ne reçoit rien.
      if (
        gestionnaire &&
        !ts.isArrowFunction(gestionnaire) &&
        !ts.isFunctionExpression(gestionnaire)
      )
        noter(gestionnaire);
    } else if (
      // `r.reason` d'un `Promise.allSettled` : la même erreur, sans `catch`.
      ts.isPropertyAccessExpression(n) &&
      n.name.text === 'reason' &&
      !usagePermisDe(n)
    ) {
      noter(n);
    }
    if (liee) {
      if (ts.isIdentifier(liee.nom)) examiner(liee.nom.text, liee.corps);
      // `catch ({ message })` : l'erreur est lue dès la liaison.
      else noter(liee.nom);
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
  regle: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
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
  {
    // Teinte par AFFECTATION, pas par initialiseur : `let m = ''` puis `m = e.message`
    // dans un `catch`. Le commentaire de cette sonde disait « forme corrigée » avec
    // un `attendus: 0` qui épinglait en réalité une fuite comme acceptable — écart
    // relevé en revue, et exactement la fausse confiance que ce cliquet combat.
    regle: 'E',
    source: `let msg = '';\nexport const GET = async () => {\n  msg = err.message;\n  return NextResponse.json({ error: msg });\n};`,
    attendus: 1,
  },
  {
    regle: 'E',
    source: `const m = err.message;\nexport const GET = async () => NextResponse.json({ error: m });`,
    attendus: 1,
  },
  {
    regle: 'E',
    source: `const m = err.message;\nfunction rendre() {\n  return NextResponse.json({ error: m });\n}`,
    attendus: 1,
  },
  {
    // Liaison déstructurée réaffectée depuis une lecture d'erreur.
    regle: 'E',
    source: `function GET() {\n  let { detail } = init();\n  try { run(); } catch (e) { detail = e.message; }\n  return NextResponse.json({ error: detail });\n}`,
    attendus: 1,
  },
  {
    // L'homonyme sain déclaré AVANT ne doit ni masquer la vraie fuite, ni être
    // désigné à sa place (dépendance à l'ordre du fichier, relevée en revue).
    regle: 'E',
    source: `function POST() {\n  let msg = 'ok';\n  return NextResponse.json({ error: msg });\n}\nfunction GET() {\n  let msg = 'ok';\n  try { run(); } catch (e) { msg = e.message; }\n  return NextResponse.json({ error: msg });\n}`,
    attendus: 1,
  },
  {
    // Deux fonctions sœurs qui nomment leur variable pareil ne se contaminent pas.
    regle: 'E',
    source: `function a() {\n  const message = err.message;\n  logger.warn('x', { message });\n}\nfunction b() {\n  return NextResponse.json({ error: message });\n}`,
    attendus: 0,
  },
  // ── Règle F : l'erreur d'un `fetch` rejeté ne se lit pas ──
  {
    // La forme d'origine : le texte du moteur dans l'erreur levée.
    regle: 'F',
    source: `try {\n  res = await globalThis.fetch(url, { headers });\n} catch (err) {\n  throw new LogistiqueTransientError(\`Prestataire réseau : \${String(err)}\`);\n}`,
    attendus: 1,
  },
  {
    // …et dans la ligne de journal écrite en base (que la règle B laisse passer :
    // « stockage de diagnostic »).
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  await supabase.from('integrations_logs').insert({ erreur: String(err) });\n}`,
    attendus: 1,
  },
  {
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  return { ok: false, status: 503, message: String(err) };\n}`,
    attendus: 1,
  },
  {
    // Vers un journal aussi (la règle B exempte `logger.*`, pas la règle F).
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  logger.error('health.db_ko', { error: err instanceof Error ? err.message : 'unknown' });\n}`,
    attendus: 1,
  },
  {
    // Paramètre d'un `.catch(…)`, appel passé par une méthode intermédiaire.
    regle: 'F',
    source: `const r = await this.postJson(path, body).catch((err: unknown) => {\n  throw new LogistiqueAmbiguousError(\`Prestataire timeout : \${String(err)}\`);\n});\nfunction postJson() { return fetch(url); }`,
    attendus: 1,
  },
  {
    regle: 'F',
    source: `await fetch(url).catch((e) => {\n  throw new Error(\`échec : \${e}\`);\n});`,
    attendus: 1,
  },
  {
    regle: 'F',
    source: `await fetch(url).then(lire, (e) => signaler(e.stack));`,
    attendus: 1,
  },
  {
    // L'erreur entière confiée à quelqu'un d'autre : journal, outil tiers, cause.
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  capturer(err);\n  throw new Error('échec', { cause: err });\n}`,
    attendus: 2,
  },
  {
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch ({ message }) {\n  return message;\n}`,
    attendus: 1,
  },
  {
    // La forme voulue : classer, puis n'écrire que le libellé.
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  const libelle = libelleErreurReseau(err);\n  await log({ erreur: libelle });\n  if (err instanceof Error && err.name === 'AbortError') throw new A('délai');\n  throw new T(\`réseau : \${libelle}\`);\n}`,
    attendus: 0,
  },
  {
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  await log({ erreur: err instanceof Error ? err.name : 'erreur réseau' });\n  return 'down';\n}`,
    attendus: 0,
  },
  {
    // Le code machine se lit sans passer par le classeur…
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  await log({ erreur: err.cause?.code ?? err.code ?? 'réseau' });\n}`,
    attendus: 0,
  },
  {
    // …mais pas la cause entière, qui porte un message (hôte, adresse).
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  throw new Error(String(err.cause));\n}`,
    attendus: 1,
  },
  {
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch {\n  return null;\n}`,
    attendus: 0,
  },
  {
    // Relancée telle quelle : limite assumée (cf. docblock), pas une lecture.
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  clearTimeout(t);\n  throw err;\n}`,
    attendus: 0,
  },
  {
    // Gestionnaire passé par référence : il reçoit l'erreur hors de vue.
    regle: 'F',
    source: `await fetch(url).catch(console.error);`,
    attendus: 1,
  },
  {
    regle: 'F',
    source: `function traiter(e) { journal(String(e)); }\nawait fetch(url).catch(traiter);\nawait fetch(url).then(lire, traiter);`,
    attendus: 2,
  },
  {
    // …mais une fonction écrite sur place, sans paramètre, ne reçoit rien.
    regle: 'F',
    source: `const corps = await fetch(url).then((r) => r.text()).catch(() => '');`,
    attendus: 0,
  },
  {
    // `Promise.allSettled` : la même erreur, sans `catch`.
    regle: 'F',
    source: `const [r] = await Promise.allSettled([fetch(url)]);\nif (r.status === 'rejected') journal(String(r.reason));`,
    attendus: 1,
  },
  {
    regle: 'F',
    source: `const [r] = await Promise.allSettled([fetch(url)]);\nif (r.status === 'rejected') journal(libelleErreurReseau(r.reason));\nreturn { status: 'ko', reason: 'config' };`,
    attendus: 0,
  },
  {
    // Le moteur sous un autre nom : alias, `new Headers`, `new Request`.
    regle: 'F',
    source: `const appeler = globalThis.fetch;\ntry {\n  await appeler(url);\n} catch (err) {\n  throw new Error(String(err));\n}`,
    attendus: 1,
  },
  {
    regle: 'F',
    source: `try {\n  const h = new Headers({ Authorization: cle });\n  await this.client.envoyer(h);\n} catch (err) {\n  throw new Error(String(err));\n}`,
    attendus: 1,
  },
  {
    // Le mot `err` comme nom de champ n'est pas la variable.
    regle: 'F',
    source: `try {\n  await fetch(url);\n} catch (err) {\n  return { err: 'réseau', code: res.err };\n}`,
    attendus: 0,
  },
  {
    // Fichier sans `fetch` : hors périmètre de la règle F (les autres règles
    // gardent la main).
    regle: 'F',
    source: `try {\n  JSON.parse(texte);\n} catch (err) {\n  throw new Error(String(err));\n}`,
    attendus: 0,
  },
  {
    // `this.fetch(…)` seul n'est pas un appel au moteur : c'est une méthode maison.
    regle: 'F',
    source: `try {\n  await this.fetch('GET', path);\n} catch (err) {\n  throw new Error(String(err));\n}`,
    attendus: 0,
  },
];

function autoTest(): void {
  const moteur = {
    A: regleA,
    B: regleB,
    C: regleC,
    D: regleD,
    E: regleE,
    F: regleF,
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

/** Nombre de fichiers visités par la règle F au dernier passage (affiché). */
let fichiersVisitesF = 0;

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

  // Règle F — l'erreur d'un `fetch`, dans tout fichier serveur qui en appelle un.
  // Aucune liste d'exemption : ni les adapters, ni le client Pennylane.
  const avecFetch = fichiersAvecFetch();
  fichiersVisitesF = avecFetch.length;
  // Non-vacuité du périmètre : chaque racine rend aujourd'hui au moins un fichier.
  // Une découverte devenue aveugle (racine renommée, recherche cassée) rendrait
  // la règle verte sur une liste vide, et le dirait « ✅ ».
  const retrecies = Object.entries(RACINES_FETCH)
    .map(([racine, plancher]) => ({
      racine,
      plancher,
      trouves: avecFetch.filter((f) => f.startsWith(`${racine}/`)).length,
    }))
    .filter((r) => r.trouves < r.plancher);
  if (retrecies.length > 0) {
    console.error(
      `🔴 check-api-error-leak : DÉTECTEUR EN ÉCHEC (périmètre de la règle F) — ${retrecies.map((r) => `${r.trouves} fichier(s) touchant au moteur HTTP sous ${r.racine}, ${r.plancher} attendus au moins`).join(' ; ')} : le gate ne prouve plus rien. Si un fichier a réellement cessé d'appeler fetch, baisser son plancher (RACINES_FETCH).`,
    );
    process.exit(1);
  }
  for (const f of avecFetch) {
    const source = readFileSync(f, 'utf8');
    for (const { ligne, expr } of regleF(source)) {
      trouvees.push({
        fichier: f,
        ligne,
        code: `[erreur de fetch lue] ${expr} — ${ligneDe(source, ligne)}`,
      });
    }
  }
  return trouvees;
}

autoTest();
const trouvees = violations();
if (trouvees.length > 0) {
  console.error(
    `🔴 check-api-error-leak : ${trouvees.length} message(s) d'erreur exposable(s) (au client, ou secret dans un texte conservé) :`,
  );
  for (const v of trouvees)
    console.error(`   ${v.fichier}:${v.ligne}  ${v.code}`);
  console.error(
    '   → réponse : serverError() / writeError() / typedRpcError(), ou businessError(error, event, [codes], status)\n' +
      '     quand le message est un libellé métier écrit par nous ;\n' +
      '   → module lib/ : erreurInterne() pour un throw, messageEchecEcriture()/messageEchecTiers() pour un champ rendu ;\n' +
      '   → erreur d’un fetch : libelleErreurReseau(err) (@savr/shared/src/api/erreur-reseau.js), jamais String(err) ni err.message.',
  );
} else {
  console.log(
    `✅ check-api-error-leak : 0 message d'erreur exposable au client, 0 erreur de fetch lue dans ${fichiersVisitesF} fichier(s) serveur touchant au moteur HTTP (règles A→F).`,
  );
}
console.log(`RATCHET_COUNT=${trouvees.length}`);
