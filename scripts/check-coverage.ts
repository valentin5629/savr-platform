#!/usr/bin/env node
/**
 * scripts/check-coverage.ts
 * Seconde moitié de la condition /goal d'un module (CLAUDE.md §8) :
 *   pnpm test:module M3.1 && pnpm check:coverage M3.1
 *
 * Vérifie, contre le run Vitest RÉEL de la suite :
 *   1. chaque scénario de specs/manifests/<MODULE>.json a un test (titre) ;
 *   2. (mode module) chaque livrable `implemented` nomme une preuve qui EXISTE —
 *      pas seulement un champ `test` non vide.
 *
 * Usage : pnpm check:coverage M0.3
 *         pnpm check:coverage                    (tous les manifestes, scénarios seuls)
 *         pnpm check:coverage M0.3 --prune-baseline
 *         pnpm check:coverage --self-test        (auto-test du détecteur, CI)
 *         pnpm check:coverage --verifier-baseline origin/main   (CI : baseline sans ajout)
 *
 * Codes de sortie : 0 couverture OK · 1 couverture incomplète · 2 run Vitest
 * inexploitable (la couverture n'a PAS pu être mesurée — ce n'est pas « tout manque »).
 * ⚠ `pnpm check:coverage` propage le code ; `pnpm -s` ramène tout échec à 1 : le
 * message « RUN VITEST INEXPLOITABLE » distingue alors les deux cas.
 *
 * ── Pourquoi le run Vitest est lu dans un FICHIER (2026-09-30) ──
 * Le script lisait `execSync('vitest run --reporter=json')`, donc la sortie
 * standard, plafonnée par le `maxBuffer` par défaut de Node (1 Mio). Fin
 * septembre le JSON de la suite a dépassé ~1,13 Mo : `ENOBUFS` à CHAQUE appel, le
 * `catch` rendait un ensemble vide, et TOUS les scénarios de TOUS les modules
 * sortaient « MANQUANT » (M3.1 : 131/131). Déterministe, pas « flaky sous
 * charge » comme on l'a cru une semaine. D'où : `--outputFile` (aucun plafond),
 * sortie de Vitest redirigée vers un journal (jamais dans un tampon), et un run
 * sans JSON exploitable arrête le script avec le code 2 au lieu de se déguiser.
 *
 * ── Ce qu'est une preuve de livrable « résolue » ──
 * Le champ `test` (cf. _schema.json : « id ou titre EXACT du test ») contient une
 * ou plusieurs références, séparées par ` + ` ou ` ; ` hors parenthèses/crochets/« »
 * (un ` + ` interne à un titre est reconnu : les segments voisins sont recollés,
 * jamais un fichier avec un titre). Chaque référence doit se résoudre :
 *   - titre Vitest : début d'un titre de describe ou de test du run (ou d'un
 *     segment après « / »), jusqu'à une frontière de mot (« T01 » ne vaut pas
 *     « GEST01 », « M0.3-1 » ne vaut pas « M0.3-10 ») ; describe et test séparés
 *     par une espace, ` > ` ou ` › ` ; « … » = texte élidé (fragments dans
 *     l'ordre). Trop vague = refusé : code module seul, mot isolé, > 20 tests.
 *     Les tests skip/todo ne comptent pas ;
 *   - fichier de test nommé (chemin, ou nom seul s'il est unique dans le dépôt) :
 *     il doit exister ; un fichier Vitest doit en plus figurer dans le run ; les
 *     titres « … » qui l'accompagnent doivent y être trouvés ;
 *   - titre pgTAP / Playwright (supabase/tests, e2e/) : présent en tête d'une
 *     chaîne littérale d'UN SEUL fichier. ⚠ Ces suites ne tournent pas ici :
 *     on prouve que le test existe, pas qu'il passe (pnpm test:pgtap, test:e2e).
 *
 * ── Baseline (cliquet) : docs/audit/coverage-deliverables-baseline.json ──
 * Au durcissement, des livrables existants nommaient une preuve non résolue
 * (libellé sans test, id pgTAP ambigu « T15 », titre paraphrasé…). Ils sont
 * tolérés À LEUR TEXTE EXACT : tout autre texte non résolu échoue. La baseline
 * ne peut que DESCENDRE : une entrée devenue résolue, ou dont le livrable a
 * changé, fait échouer le module tant qu'elle n'est pas retirée
 * (`--prune-baseline`, qui ne fait que retirer). Aucun outil n'y ajoute
 * d'entrée, et la CI refuse toute entrée absente de main (`--verifier-baseline`).
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MANIFESTS_DIR = 'specs/manifests';
const BASELINE_PATH = 'docs/audit/coverage-deliverables-baseline.json';
// Fichiers du dossier qui NE SONT PAS des manifestes de module (ajoutés en R0b :
// JSON Schema + index des livrables CDC) — sans scenarios[], à ignorer ici.
const NON_MANIFEST = new Set(['_schema.json', 'cdc-deliverables.index.json']);

// ─────────────────────────────── Run Vitest ────────────────────────────────

/** Le run n'a pas produit de rapport exploitable : la couverture n'est PAS mesurée. */
export class RunVitestInexploitable extends Error {}

export interface CasDeTest {
  fichier: string; // relatif à la racine du dépôt
  chemin: string[]; // [describe…, titre]
}

export interface RunVitest {
  cas: CasDeTest[];
  fichiers: Set<string>;
  suitesSansTest: { fichier: string; message: string }[];
  /** Tests `skip` / `todo` : présents dans le rapport, jamais exécutés → pas une preuve. */
  nonJoues: number;
}

const STATUTS_NON_JOUES = new Set(['skipped', 'pending', 'todo', 'disabled']);

/** Lit et VALIDE un rapport `--reporter=json`. Lève au lieu de rendre un run vide. */
export function lireRapportVitest(fichier: string, racine: string): RunVitest {
  if (!existsSync(fichier)) {
    throw new RunVitestInexploitable(
      `Vitest n'a produit AUCUN rapport JSON (${fichier}).`,
    );
  }
  let json: {
    testResults?: {
      name?: string;
      message?: string;
      assertionResults?: {
        ancestorTitles?: string[];
        title?: string;
        status?: string;
      }[];
    }[];
  };
  try {
    json = JSON.parse(readFileSync(fichier, 'utf8'));
  } catch (e) {
    throw new RunVitestInexploitable(
      `rapport JSON illisible (${statSync(fichier).size} octets) : ${(e as Error).message}`,
    );
  }
  if (!Array.isArray(json.testResults)) {
    throw new RunVitestInexploitable('rapport JSON sans `testResults[]`.');
  }
  const run: RunVitest = {
    cas: [],
    fichiers: new Set(),
    suitesSansTest: [],
    nonJoues: 0,
  };
  for (const suite of json.testResults) {
    const f = relative(racine, suite.name ?? '');
    const assertions = suite.assertionResults ?? [];
    // Fichier qui n'a pas pu se charger (import cassé…) : ses titres manquent,
    // ses scénarios sortiront MANQUANT — on dit pourquoi.
    if (assertions.length === 0 && suite.message) {
      run.suitesSansTest.push({
        fichier: f,
        message: suite.message.split('\n')[0] ?? '',
      });
    }
    for (const a of assertions) {
      if (STATUTS_NON_JOUES.has(a.status ?? '')) {
        run.nonJoues++;
        continue;
      }
      run.cas.push({
        fichier: f,
        chemin: [...(a.ancestorTitles ?? []), a.title ?? ''],
      });
      run.fichiers.add(f);
    }
  }
  if (run.cas.length === 0) {
    throw new RunVitestInexploitable(
      `le run ne contient AUCUN test exécuté (${json.testResults.length} fichier(s), ${run.nonJoues} test(s) non joué(s)).`,
    );
  }
  return run;
}

/**
 * Lance la commande Vitest avec `--outputFile` : le rapport va dans un fichier
 * (aucun plafond), la sortie du processus dans un journal (aucun tampon).
 */
export function lancerVitest(commande: string, args: string[]): RunVitest {
  const dossier = mkdtempSync(join(tmpdir(), 'check-coverage-'));
  const rapport = join(dossier, 'vitest.json');
  const journal = join(dossier, 'vitest.log');
  try {
    const fd = openSync(journal, 'w');
    let res;
    try {
      res = spawnSync(commande, [...args, `--outputFile=${rapport}`], {
        stdio: ['ignore', fd, fd],
      });
    } finally {
      closeSync(fd);
    }
    try {
      // Processus non mené à terme (introuvable, tué, tampon plein…) : même si un
      // JSON traîne, rien ne dit qu'il est complet.
      if (res.error)
        throw new RunVitestInexploitable(
          `le processus Vitest n'a pas abouti (${(res.error as NodeJS.ErrnoException).code ?? res.error.message}).`,
        );
      const run = lireRapportVitest(rapport, process.cwd());
      if (res.status !== 0) {
        console.log(
          `ℹ️   Vitest a rendu le code ${res.status} (tests en échec ?) : la couverture porte sur les titres ` +
            `présents ; c'est test:module qui juge le vert.`,
        );
      }
      return run;
    } catch (e) {
      if (!(e instanceof RunVitestInexploitable)) throw e;
      const fin = readFileSync(journal, 'utf8')
        .split('\n')
        .slice(-25)
        .join('\n');
      const etat = res.error
        ? `erreur : ${res.error.message}`
        : `code ${res.status ?? '—'}${res.signal ? `, signal ${res.signal}` : ''}`;
      throw new RunVitestInexploitable(
        `${e.message}\n    Commande : ${commande} ${args.join(' ')} (${etat})\n` +
          `    Fin du journal Vitest :\n${fin}`,
      );
    }
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

// ──────────────────────── Résolution des références ────────────────────────

const MOT = /[\p{L}\p{N}_]/u;
const SEPARATEURS_CHEMIN = [' ', ' > ', ' › '];
const GUILLEMETS_LITTERAL = new Set(["'", '"', '`']);
const FICHIER_TEST =
  /(?:[\w@.()[\]-]+\/)*[\w@.-]+\.(?:test|spec)\.(?:tsx?|sql)(?![\w.])/g;
const NOMME_UN_FICHIER = new RegExp(FICHIER_TEST.source);
const TITRE_CITE = /«\s*([^»]+?)\s*»/g;

/** Le passage [i, j) de `texte` ne coupe pas un mot à ses deux bords. */
function bordsDeMot(texte: string, i: number, j: number): boolean {
  const colle = (a?: string, b?: string) =>
    a !== undefined && b !== undefined && MOT.test(a) && MOT.test(b);
  return !colle(texte[i - 1], texte[i]) && !colle(texte[j - 1], texte[j]);
}

/** « … » = texte élidé : le 1er fragment commence à `debut`, les suivants suivent. */
function fragmentsEnSuite(texte: string, ref: string, debut: number): boolean {
  const [premier, ...reste] = ref
    .split('…')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!premier || !texte.startsWith(premier, debut)) return false;
  if (!bordsDeMot(texte, debut, debut + premier.length)) return false;
  let pos = debut + premier.length;
  for (const f of reste) {
    let i = texte.indexOf(f, pos);
    while (i !== -1 && !bordsDeMot(texte, i, i + f.length))
      i = texte.indexOf(f, i + 1);
    if (i === -1) return false;
    pos = i + f.length;
  }
  return true;
}

/** Titres candidats d'un cas : chemin complet ou à partir de n'importe quel describe. */
function candidats(c: CasDeTest): string[] {
  const out: string[] = [];
  for (let k = 0; k < c.chemin.length; k++)
    for (const sep of SEPARATEURS_CHEMIN) out.push(c.chemin.slice(k).join(sep));
  return out;
}

/** Débuts admis : début du titre, ou d'un segment après « / » (« M4.2/liste_registre_200 »). */
function debutsDeTitre(t: string): number[] {
  return [0, ...[...t.matchAll(/\/\s*/g)].map((m) => m.index + m[0].length)];
}

/** Vrai si `ref` désigne ce cas Vitest : ancrée au début d'un titre ou d'un segment. */
export function refDesigneCas(ref: string, c: CasDeTest): boolean {
  return candidats(c).some((t) =>
    debutsDeTitre(t).some((d) => fragmentsEnSuite(t, ref, d)),
  );
}

/** Vrai si `ref` ouvre une chaîne littérale de `texte` (titre pgTAP / Playwright). */
export function refDansTexte(ref: string, texte: string): boolean {
  const premier = ref.split('…')[0]?.trim();
  if (!premier) return false;
  for (
    let i = texte.indexOf(premier);
    i !== -1;
    i = texte.indexOf(premier, i + 1)
  )
    if (
      GUILLEMETS_LITTERAL.has(texte[i - 1] ?? '') &&
      fragmentsEnSuite(texte, ref, i)
    )
      return true;
  return false;
}

/**
 * Découpe le champ `test` sur ` + ` / ` ; ` hors () [] « ». Rend aussi les
 * séparateurs : un ` + ` peut appartenir à un titre (« peuplés + filtrage
 * serveur »), resoudrePreuve sait alors recoller les segments voisins.
 */
export function decouperReferences(test: string): {
  segments: string[];
  separateurs: string[];
} {
  const bruts: { segment: string; apres: string }[] = [];
  let profondeur = 0;
  let courant = '';
  for (let i = 0; i < test.length; ) {
    const ch = test[i]!;
    if ('([«'.includes(ch)) profondeur++;
    else if (')]»'.includes(ch)) profondeur = Math.max(0, profondeur - 1);
    if (profondeur === 0) {
      const sep = /^(?:\s+\+\s+|\s*;\s+)/.exec(test.slice(i));
      if (sep) {
        bruts.push({ segment: courant.trim(), apres: sep[0] });
        courant = '';
        i += sep[0].length;
        continue;
      }
    }
    courant += ch;
    i++;
  }
  bruts.push({ segment: courant.trim(), apres: '' });
  // Segment vide (« A ; ; B », séparateur final) : ignoré, pas une référence.
  const pleins = bruts.filter((b) => b.segment !== '');
  return {
    segments: pleins.map((b) => b.segment),
    separateurs: pleins.slice(0, -1).map((b) => b.apres),
  };
}

export interface Corpus {
  run: RunVitest;
  /** Fichiers de test du dépôt (suivis ou non ignorés), chemins relatifs. */
  fichiersTest: string[];
  /** Contenu d'un fichier (pgTAP / Playwright / autre), mis en cache. */
  lire: (fichier: string) => string;
}

/** Fichiers dont les tests ne tournent PAS dans le run Vitest (texte seul). */
function horsRunVitest(f: string): boolean {
  return f.endsWith('.sql') || f.startsWith('e2e/');
}

type Resolution = { ok: true; cible: string } | { ok: false; raison: string };

// Une référence doit DÉSIGNER un test, pas balayer une famille. Mesuré le
// 2026-09-30 sur le run réel : les preuves légitimes visent au plus 14 tests,
// alors que « M3.1 » en visait 203, « M1.5a » 39 et « le » 36.
const PLAFOND_TESTS = 20;
// Code module, éventuellement suivi de ponctuation (« M3.1 — », « M0.3- »).
const CODE_MODULE = /^M\d+(?:\.\d+)?[a-z]?[\s/\-—–:.]*$/i;

/** Raison du refus si `ref` est trop vague pour désigner un test, sinon null. */
export function refTropVague(ref: string): string | null {
  if (CODE_MODULE.test(ref)) return 'un code module seul';
  if ((ref.match(/[\p{L}\p{N}]/gu) ?? []).length < 3) return 'trop court';
  if (!/[\d_/.-]|\s/.test(ref)) return 'un mot isolé';
  return null;
}

function resoudreTitre(ref: string, corpus: Corpus): Resolution {
  const vague = refTropVague(ref);
  if (vague)
    return {
      ok: false,
      raison: `« ${ref} » est ${vague} : il ne désigne aucun test précis`,
    };
  const cas = corpus.run.cas.filter((c) => refDesigneCas(ref, c));
  if (cas.length > PLAFOND_TESTS)
    return {
      ok: false,
      raison: `« ${ref} » vise ${cas.length} tests (plafond ${PLAFOND_TESTS}) : nomme le test`,
    };
  if (cas.length > 0) {
    const fichiers = new Set(cas.map((c) => c.fichier));
    return {
      ok: true,
      cible: `${[...fichiers][0]}${fichiers.size > 1 ? ` (+${fichiers.size - 1})` : ''} — ${cas.length} test(s)`,
    };
  }
  const textes = corpus.fichiersTest
    .filter(horsRunVitest)
    .filter((f) => refDansTexte(ref, corpus.lire(f)));
  if (textes.length === 1)
    return {
      ok: true,
      cible: `${textes[0]} (présence seule, hors run Vitest)`,
    };
  if (textes.length > 1)
    return {
      ok: false,
      raison: `« ${ref} » est ambigu : ${textes.length} fichiers pgTAP/e2e (${textes.slice(0, 3).join(', ')}…)`,
    };
  return { ok: false, raison: `« ${ref} » ne désigne aucun test` };
}

function resoudreFichier(
  chemin: string,
  corpus: Corpus,
): { ok: true; fichier: string } | { ok: false; raison: string } {
  if (existsSync(chemin)) return { ok: true, fichier: chemin };
  const homonymes = corpus.fichiersTest.filter(
    (f) => basename(f) === basename(chemin),
  );
  if (homonymes.length === 1) return { ok: true, fichier: homonymes[0]! };
  if (homonymes.length > 1)
    return {
      ok: false,
      raison: `fichier « ${chemin} » ambigu (${homonymes.length} homonymes)`,
    };
  return { ok: false, raison: `fichier « ${chemin} » introuvable` };
}

function resoudreReference(ref: string, corpus: Corpus): Resolution {
  const chemins = ref.match(FICHIER_TEST) ?? [];
  if (chemins.length === 0) return resoudreTitre(ref, corpus);

  const fichiers: string[] = [];
  for (const chemin of chemins) {
    const r = resoudreFichier(chemin, corpus);
    if (!r.ok) return r;
    if (!horsRunVitest(r.fichier) && !corpus.run.fichiers.has(r.fichier))
      return {
        ok: false,
        raison: `${r.fichier} n'a aucun test dans le run Vitest`,
      };
    fichiers.push(r.fichier);
  }
  for (const [, titre] of ref.matchAll(TITRE_CITE)) {
    const vague = refTropVague(titre!);
    if (vague) return { ok: false, raison: `« ${titre} » est ${vague}` };
    const trouve = fichiers.some((f) =>
      horsRunVitest(f)
        ? refDansTexte(titre!, corpus.lire(f))
        : corpus.run.cas.some(
            (c) => c.fichier === f && refDesigneCas(titre!, c),
          ),
    );
    if (!trouve)
      return {
        ok: false,
        raison: `« ${titre} » absent de ${fichiers.join(', ')}`,
      };
  }
  return { ok: true, cible: fichiers.join(', ') };
}

/**
 * Résout le champ `test` d'un livrable : il faut un découpage en références
 * (segments consécutifs recollés avec leur séparateur) où CHACUNE se résout.
 * Un segment qui nomme un fichier reste seul : recollé à un titre voisin, il
 * ferait passer ce titre pour du commentaire — donc pour prouvé.
 */
export function resoudrePreuve(test: string, corpus: Corpus): Resolution {
  const { segments, separateurs } = decouperReferences(test);
  const n = segments.length;
  const cache = new Map<string, Resolution>();
  const groupe = (i: number, j: number): Resolution => {
    const cle = `${i}:${j}`;
    if (!cache.has(cle)) {
      let ref = segments[i]!;
      for (let k = i + 1; k < j; k++) ref += separateurs[k - 1]! + segments[k]!;
      cache.set(
        cle,
        j - i > 1 && NOMME_UN_FICHIER.test(ref)
          ? { ok: false, raison: 'fichier recollé' }
          : resoudreReference(ref, corpus),
      );
    }
    return cache.get(cle)!;
  };
  // cibles[j] = découpage valide des j premiers segments (le plus long groupe d'abord).
  const cibles: (string[] | null)[] = [[]];
  for (let j = 1; j <= n; j++) {
    cibles[j] = null;
    for (let i = 0; i < j; i++) {
      const r = groupe(i, j);
      if (cibles[i] && r.ok) {
        cibles[j] = [...cibles[i]!, r.cible];
        break;
      }
    }
  }
  if (n === 0) return { ok: false, raison: 'champ test vide' };
  if (cibles[n]) return { ok: true, cible: cibles[n]!.join(' + ') };
  // Échec : on explique le premier segment qu'aucun découpage ne sait couvrir.
  const k = Math.max(...cibles.map((c, i) => (c ? i : 0)));
  return groupe(k, k + 1);
}

// ───────────────────────────────── Baseline ────────────────────────────────

/** module → id du livrable → texte EXACT du champ `test` toléré. */
type Baseline = Record<string, Record<string, string>>;

export interface Deliverable {
  id?: string;
  statut?: string;
  test?: string | null;
  libelle?: string;
}

function lireBaseline(): { doc: string; modules: Baseline } {
  if (!existsSync(BASELINE_PATH)) return { doc: '', modules: {} };
  const j = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  return { doc: j._doc ?? '', modules: j.modules ?? {} };
}

/** Entrées de `apres` absentes de `avant` (ou au texte changé) : la baseline a MONTÉ. */
export function ajoutsBaseline(avant: Baseline, apres: Baseline): string[] {
  const ajouts: string[] = [];
  for (const [module, ids] of Object.entries(apres))
    for (const [id, texte] of Object.entries(ids))
      if (avant[module]?.[id] !== texte) ajouts.push(`${module} › ${id}`);
  return ajouts;
}

/**
 * CI : la baseline de la branche ne contient rien que `ref` (main) n'ait déjà.
 * Sans ce garde, « ne jamais ajouter d'entrée » ne serait qu'une consigne.
 */
function verifierBaseline(ref: string): number {
  // execFileSync : la ref ne passe jamais par un shell. Tout doute = code 2
  // (échec fermé), sauf l'absence AVÉRÉE du fichier sur la ref (première pose).
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    console.error(
      `⛔  ${ref} introuvable : baseline NON vérifiée (fetch manquant ?).`,
    );
    return 2;
  }
  try {
    git('cat-file', '-e', `${ref}:${BASELINE_PATH}`);
  } catch {
    console.log(
      `ℹ️   ${BASELINE_PATH} absent de ${ref} : première pose, rien à comparer.`,
    );
    return 0;
  }
  let avant: Baseline;
  try {
    avant = JSON.parse(git('show', `${ref}:${BASELINE_PATH}`)).modules ?? {};
  } catch (e) {
    console.error(
      `⛔  ${BASELINE_PATH} illisible sur ${ref} : baseline NON vérifiée (${(e as Error).message.split('\n')[0]}).`,
    );
    return 2;
  }
  const ajouts = ajoutsBaseline(avant, lireBaseline().modules);
  if (ajouts.length > 0) {
    console.error(
      `⛔  ${BASELINE_PATH} a MONTÉ par rapport à ${ref} (${ajouts.length}) — la baseline ne peut que descendre :`,
    );
    for (const a of ajouts) console.error(`      - ${a}`);
    console.error('    Corrige la preuve du livrable au lieu de la tolérer.');
    return 1;
  }
  console.log(
    `✅  Baseline check:coverage : aucun ajout par rapport à ${ref}.`,
  );
  return 0;
}

export interface BilanLivrables {
  lignes: string[];
  problemes: number;
  toleres: number;
  /** Entrées de baseline à retirer : id → pourquoi. */
  perimees: Map<string, string>;
}

/** Juge les livrables `implemented` d'un module (preuve + tolérance de la baseline). */
export function evaluerLivrables(
  deliverables: Deliverable[],
  tolerance: Record<string, string>,
  corpus: Corpus,
): BilanLivrables {
  const bilan: BilanLivrables = {
    lignes: [],
    problemes: 0,
    toleres: 0,
    perimees: new Map(),
  };
  const vus = new Set<string>();
  for (const d of deliverables) {
    if (d.statut !== 'implemented') continue;
    const nom = d.id ?? d.libelle ?? '?';
    const t = (d.test ?? '').toString().trim();
    const baseline = d.id !== undefined && d.id in tolerance;
    if (baseline) vus.add(d.id!);
    if (baseline && tolerance[d.id!] !== t)
      bilan.perimees.set(d.id!, 'texte du champ test modifié');
    if (t === '') {
      bilan.lignes.push(
        `  ⛔  deliverable « ${nom} » statut=implemented SANS test — nomme sa preuve (3e temps).`,
      );
      bilan.problemes++;
      continue;
    }
    const r = resoudrePreuve(t, corpus);
    const tolere = baseline && tolerance[d.id!] === t;
    if (r.ok) {
      bilan.lignes.push(`  ✅  livrable ${nom} → ${r.cible}`);
      if (tolere) bilan.perimees.set(d.id!, 'sa preuve se résout désormais');
    } else if (tolere) {
      bilan.lignes.push(
        `  ⚠️   livrable ${nom} : preuve non résolue, TOLÉRÉE (baseline) — ${r.raison}`,
      );
      bilan.toleres++;
    } else {
      bilan.lignes.push(
        `  ⛔  livrable ${nom} : preuve non résolue — ${r.raison}.` +
          (baseline
            ? ' (La baseline tolère un AUTRE texte pour ce livrable : elle ne couvre pas ce changement.)'
            : ''),
      );
      bilan.problemes++;
    }
  }
  for (const id of Object.keys(tolerance))
    if (!vus.has(id))
      bilan.perimees.set(id, 'livrable disparu ou plus « implemented »');
  return bilan;
}

// ────────────────────────────────── Main ───────────────────────────────────

type Scenario = string | { id?: string; title?: string; description?: string };

function scenarioTitle(s: Scenario): string {
  if (typeof s === 'string') return s;
  return s.title ?? s.description ?? s.id ?? '';
}

function loadManifests(arg: string | undefined): string[] {
  if (!existsSync(MANIFESTS_DIR)) {
    console.error(`❌  ${MANIFESTS_DIR} introuvable`);
    process.exit(1);
  }
  if (arg) {
    const f = join(MANIFESTS_DIR, `${arg}.json`);
    if (!existsSync(f)) {
      console.error(`❌  Manifest absent : ${f}`);
      console.error(
        `    Le module ${arg} n'a pas de manifeste. CRÉE le manifeste au grain LIVRABLE ` +
          `(deliverables[], cf. specs/manifests/_schema.json) AVANT de coder — ` +
          `ne PAS lancer le lot sans manifeste (R0d, finding #6).`,
      );
      process.exit(1);
    }
    return [f];
  }
  return readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith('.json') && !NON_MANIFEST.has(f))
    .map((f) => join(MANIFESTS_DIR, f));
}

function listerFichiersTest(): string[] {
  // --others : un fichier de test pas encore commité compte aussi (dev en cours).
  const sortie = execSync('git ls-files --cached --others --exclude-standard', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return sortie
    .split('\n')
    .filter(
      (f) =>
        /\.(?:test|spec)\.(?:tsx?|sql)$/.test(f) ||
        (f.startsWith('supabase/tests/') && f.endsWith('.sql')),
    );
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    process.exit(autoTest());
  }
  const iRef = argv.indexOf('--verifier-baseline');
  if (iRef !== -1) {
    process.exit(verifierBaseline(argv[iRef + 1] ?? 'origin/main'));
  }
  const arg = argv.find((a) => !a.startsWith('--'));
  const prune = argv.includes('--prune-baseline');
  // Mode STRICT (R0d) : actif uniquement quand un module précis est demandé
  // (l'usage /goal d'un lot). Vérifie alors AUSSI les deliverables[] — c'est ce qui
  // ferme la cause racine : /goal ne regardait que scenarios[], jamais deliverables[].
  // Le mode tous-manifestes (sans arg) garde le comportement scénario-seul (sanity).
  const strict = Boolean(arg);
  if (prune && !strict) {
    console.error(
      '❌  --prune-baseline exige un module (pnpm check:coverage M3.1 --prune-baseline).',
    );
    process.exit(1);
  }

  const files = loadManifests(arg);
  const bin = join('node_modules', '.bin', 'vitest');
  let run: RunVitest;
  try {
    run = lancerVitest(existsSync(bin) ? bin : 'vitest', [
      'run',
      '--reporter=json',
    ]);
  } catch (e) {
    if (!(e instanceof RunVitestInexploitable)) throw e;
    console.error(
      `\n⛔  RUN VITEST INEXPLOITABLE — couverture NON mesurée (≠ « tout manque »).`,
    );
    console.error(`    ${e.message}`);
    process.exit(2);
  }
  console.log(
    `ℹ️   Run Vitest lu : ${run.cas.length} tests, ${run.fichiers.size} fichiers.`,
  );
  for (const s of run.suitesSansTest)
    console.log(
      `⚠️   ${s.fichier} n'a rendu aucun test (chargement en échec ?) : ${s.message}`,
    );
  const vitestTitles = run.cas.map((c) => c.chemin.join(' '));

  const cache = new Map<string, string>();
  const corpus: Corpus = {
    run,
    fichiersTest: strict ? listerFichiersTest() : [],
    lire: (f) => {
      if (!cache.has(f))
        cache.set(f, existsSync(f) ? readFileSync(f, 'utf8') : '');
      return cache.get(f)!;
    },
  };
  const baseline = lireBaseline();

  let missing = 0;
  let deliverableIssues = 0;
  let toleres = 0;
  for (const f of files) {
    const manifest = JSON.parse(readFileSync(f, 'utf8')) as {
      module: string;
      scenarios?: Scenario[];
      deliverables?: Deliverable[];
    };
    const scenarios = manifest.scenarios ?? [];
    const deliverables = manifest.deliverables ?? [];
    console.log(`\n📋  ${manifest.module} (${f})`);

    // Scénarios → titres vitest (comportement historique conservé).
    for (const sc of scenarios) {
      const title = scenarioTitle(sc);
      if (!title) continue;
      const found = vitestTitles.some((t) => t.includes(title));
      if (found) console.log(`  ✅  ${title}`);
      else {
        console.log(`  ❌  MANQUANT : ${title}`);
        missing++;
      }
    }

    if (!strict) continue;

    // ── Mode lot (arg) : vérifie les deliverables[] ──
    // Vacuité : un module demandé explicitement sans AUCUNE couverture = échec
    // (sinon /goal vert à vide — findings #6/#7).
    if (scenarios.length === 0 && deliverables.length === 0) {
      console.log(
        `  ⛔  ${manifest.module} n'a NI scenarios[] NI deliverables[] — couverture vide interdite pour un module demandé.`,
      );
      deliverableIssues++;
      continue;
    }

    // Tout deliverable 'implemented' DOIT nommer une preuve qui EXISTE (3e temps).
    const tolerance = baseline.modules[manifest.module] ?? {};
    const bilan = evaluerLivrables(deliverables, tolerance, corpus);
    for (const l of bilan.lignes) console.log(l);
    deliverableIssues += bilan.problemes;
    toleres += bilan.toleres;
    const perimees = bilan.perimees;

    if (perimees.size > 0) {
      const liste = [...perimees].map(
        ([id, pourquoi]) => `      - ${id} : ${pourquoi}`,
      );
      if (prune) {
        for (const id of perimees.keys()) delete tolerance[id];
        if (Object.keys(tolerance).length === 0)
          delete baseline.modules[manifest.module];
        else baseline.modules[manifest.module] = tolerance;
        writeFileSync(
          BASELINE_PATH,
          `${JSON.stringify({ _doc: baseline.doc, modules: baseline.modules }, null, 2)}\n`,
        );
        console.log(
          `  ✂️   baseline : ${perimees.size} entrée(s) retirée(s) de ${BASELINE_PATH}`,
        );
        console.log(liste.join('\n'));
      } else {
        console.log(
          `  ⛔  baseline périmée (${perimees.size}) — le cliquet ne descend que si on retire ces entrées : ` +
            `pnpm check:coverage ${manifest.module} --prune-baseline`,
        );
        console.log(liste.join('\n'));
        deliverableIssues += perimees.size;
      }
    }
  }

  if (toleres > 0)
    console.log(
      `\nℹ️   ${toleres} livrable(s) à preuve non résolue tolérés par ${BASELINE_PATH} (dette à résorber).`,
    );
  if (missing > 0 || deliverableIssues > 0) {
    console.error(
      `\n⛔  ${missing} scénario(s) sans test + ${deliverableIssues} problème(s) de livrable — /goal NON satisfait.`,
    );
    process.exit(1);
  } else {
    console.log('\n✅  Couverture complète (scénarios + livrables).');
  }
}

// ──────────────────────────────── Auto-test ────────────────────────────────
// Non vacant : chaque garde est confrontée à un cas qui DOIT la faire rougir,
// dont un rapport au-dessus de 1 Mio — la taille qui cassait l'ancien code.

function autoTest(): number {
  const echecs: string[] = [];
  const verifier = (nom: string, ok: boolean) => {
    console.log(`  ${ok ? '✅' : '❌'}  ${nom}`);
    if (!ok) echecs.push(nom);
  };
  const leve = (f: () => unknown): boolean => {
    try {
      f();
      return false;
    } catch (e) {
      return e instanceof RunVitestInexploitable;
    }
  };

  const dossier = mkdtempSync(join(tmpdir(), 'check-coverage-autotest-'));
  try {
    // Faux Vitest : écrit dans --outputFile le rapport demandé par son mode,
    // et inonde sa sortie standard (> 1 Mio) comme une suite bavarde.
    const faux = join(dossier, 'faux-vitest.mjs');
    writeFileSync(
      faux,
      `import { writeFileSync } from 'node:fs';
const [mode, ...rest] = process.argv.slice(2);
const out = rest.find((a) => a.startsWith('--outputFile='))?.slice(13);
const suite = (titres) => ({ testResults: [{ name: process.cwd() + '/a.test.ts',
  assertionResults: titres.map((t) => ({ ancestorTitles: ['M9.9 / bloc'], title: t })) }] });
process.stdout.write('x'.repeat(1_200_000));
if (mode === 'gros') writeFileSync(out, JSON.stringify({ ...suite(['M9.9-1 — cas repère']), bourre: 'y'.repeat(1_500_000) }));
if (mode === 'echec') { writeFileSync(out, JSON.stringify(suite(['M9.9-2 — cas en échec']))); process.exit(1); }
if (mode === 'illisible') writeFileSync(out, '{"testResults": [');
if (mode === 'vide') writeFileSync(out, JSON.stringify({ testResults: [] }));
if (mode === 'sans-resultats') writeFileSync(out, JSON.stringify({ numTotalTests: 3 }));
if (mode === 'skip') writeFileSync(out, JSON.stringify({ testResults: [{ name: process.cwd() + '/a.test.ts',
  assertionResults: [{ ancestorTitles: [], title: 'M9.9-3 — ignoré', status: 'skipped' },
    { ancestorTitles: [], title: 'M9.9-4 — à faire', status: 'todo' },
    { ancestorTitles: [], title: 'M9.9-1 — joué', status: 'passed' }] }] }));
if (mode === 'crash') process.exit(3);
`,
    );
    const node = process.execPath;

    console.log('▶  Lecture du run Vitest');
    // Témoin : le même faux, lu par l'ancienne méthode (stdout + maxBuffer par
    // défaut), DOIT casser — sinon ce test ne prouve rien.
    let temoin = '';
    try {
      // Sans shell (chemin de TMPDIR quelconque), même maxBuffer par défaut.
      execFileSync(
        node,
        [faux, 'gros', `--outputFile=${join(dossier, 't.json')}`],
        { encoding: 'utf8' },
      );
    } catch (e) {
      temoin = (e as NodeJS.ErrnoException).code ?? '';
    }
    verifier(
      'témoin : l’ancienne lecture par stdout lève ENOBUFS au-delà de 1 Mio',
      temoin === 'ENOBUFS',
    );
    // Cas positifs : une exception doit compter comme un échec, pas interrompre.
    const titres = (mode: string): string[] => {
      try {
        return lancerVitest(node, [faux, mode]).cas.map((c) =>
          c.chemin.join(' '),
        );
      } catch (e) {
        console.log(`      (${(e as Error).message.split('\n')[0]})`);
        return [];
      }
    };
    verifier(
      'rapport de 1,5 Mo + 1,2 Mo sur stdout : titres lus sans ENOBUFS',
      titres('gros').join() === 'M9.9 / bloc M9.9-1 — cas repère',
    );
    verifier(
      'tests en échec (code 1) : le rapport reste exploitable',
      titres('echec').join() === 'M9.9 / bloc M9.9-2 — cas en échec',
    );
    verifier(
      'aucun rapport → erreur, pas un run vide',
      leve(() => lancerVitest(node, [faux, 'crash'])),
    );
    verifier(
      'rapport tronqué → erreur',
      leve(() => lancerVitest(node, [faux, 'illisible'])),
    );
    verifier(
      'rapport sans aucun test → erreur',
      leve(() => lancerVitest(node, [faux, 'vide'])),
    );
    verifier(
      'rapport sans `testResults` → erreur explicite (pas un TypeError)',
      leve(() => lancerVitest(node, [faux, 'sans-resultats'])),
    );
    verifier(
      'tests skip / todo : jamais comptés comme preuve',
      titres('skip').join() === 'M9.9-1 — joué',
    );
    verifier(
      'binaire introuvable → erreur',
      leve(() => lancerVitest(join(dossier, 'inexistant'), [])),
    );

    console.log('▶  Résolution des preuves de livrable');
    const cas = (fichier: string, ...chemin: string[]): CasDeTest => ({
      fichier,
      chemin,
    });
    const run: RunVitest = {
      cas: [
        cas(
          'p/a.test.ts',
          'M3.2 / espace',
          'M3.2/GEST01_bouton_programmer_present',
        ),
        cas('p/a.test.ts', 'M0.3 — alertes', 'M0.3-10 — dixième cas'),
        cas(
          'p/b.test.ts',
          'M0.4 — RGPD (BL-P0-09)',
          'GET export-rgpd renvoie les PII',
        ),
        cas('p/b.test.ts', 'M0.4 — /signup : parcours', 'envoie les 7 champs'),
        cas('p/b.test.ts', 'M0.6 — filtres', 'lieu peuplé + filtrage serveur'),
        cas('p/b.test.ts', 'cloisonnement', 'entre organisations'),
        cas('p/b.test.ts', 'X9 — cas court'),
        ...Array.from({ length: 21 }, (_, i) =>
          cas('p/c.test.ts', 'M7.7 / famille large', `cas ${i}`),
        ),
      ],
      fichiers: new Set(['p/a.test.ts', 'p/b.test.ts', 'p/c.test.ts']),
      suitesSansTest: [],
      nonJoues: 0,
    };
    const textes: Record<string, string> = {
      'supabase/tests/x.test.sql':
        "SELECT ok(true, 'T15 gestionnaire voit 1 ligne');",
      'supabase/tests/y.test.sql':
        "SELECT ok(true, 'T15 autre fichier');\nSELECT ok(true, 'T16 unique ici');\n-- T17 cité en commentaire",
    };
    const corpus: Corpus = {
      run,
      fichiersTest: [
        'p/a.test.ts',
        'p/b.test.ts',
        'p/c.test.ts',
        'p/hors-run.test.ts',
        ...Object.keys(textes),
      ],
      lire: (f) => textes[f] ?? '',
    };
    const ok = (t: string) => resoudrePreuve(t, corpus).ok;
    verifier(
      'titre Vitest ancré (describe > test)',
      ok('M0.4 — /signup : parcours > envoie les 7 champs'),
    );
    verifier(
      'texte élidé « … » accepté',
      ok('M0.4 — RGPD … GET export-rgpd renvoie les PII'),
    );
    verifier('« T01 » ne vaut pas « GEST01 »', !ok('T01'));
    verifier('« M0.3-1 » ne vaut pas « M0.3-10 »', !ok('M0.3-1'));
    verifier('un mot en milieu de titre ne vaut pas preuve', !ok('bouton'));
    verifier(
      'un code module seul ne vaut pas preuve',
      !ok('M3.2') && !ok('M3.2/') && !ok('M3.2 /'),
    );
    verifier(
      'code module suivi de ponctuation, référence trop courte → refusés',
      !ok('M0.3 —') && !ok('M0.3-') && !ok('M0.3 :') && !ok('X9'),
    );
    verifier(
      'titre cité trop vague dans un fichier nommé → refusé',
      !ok('p/b.test.ts « M0.4 »'),
    );
    verifier('un mot isolé ne vaut pas preuve', !ok('cloisonnement'));
    verifier(
      'au-delà de 20 tests visés : trop large',
      !ok('M7.7 / famille large'),
    );
    verifier(
      '« … » : les fragments doivent venir dans l’ordre',
      !ok('M0.4 — RGPD … renvoie les PII … GET export-rgpd'),
    );
    verifier(
      'titre pgTAP hors chaîne littérale (commentaire) → non résolu',
      !ok('T17 cité en commentaire'),
    );
    verifier(
      'fichier pgTAP inexistant',
      !ok('supabase/tests/fantome.test.sql'),
    );
    verifier(
      'segment de titre après « / » accepté',
      ok('GEST01_bouton_programmer_present'),
    );
    verifier('libellé sans test → non résolu', !ok('M9.9/libelle/sans-test'));
    verifier('titre pgTAP unique → résolu', ok('T16 unique ici'));
    verifier('id pgTAP présent dans 2 fichiers → ambigu', !ok('T15'));
    verifier(
      'toutes les références doivent se résoudre',
      !ok('M3.2/GEST01_bouton_programmer_present + libellé fantôme'),
    );
    verifier(
      '« + » interne à un titre : segments recollés',
      ok(
        'M3.2/GEST01_bouton_programmer_present + lieu peuplé + filtrage serveur',
      ),
    );
    verifier(
      'fichier pgTAP nommé seul → résolu',
      ok('supabase/tests/x.test.sql'),
    );
    verifier(
      'fichier nommé + titre fantôme voisin : le titre n’est pas absorbé',
      !ok('supabase/tests/x.test.sql ; libellé fantôme') &&
        !ok('libellé fantôme + supabase/tests/x.test.sql'),
    );
    verifier(
      'fichier nommé + titre cité présent',
      ok('p/b.test.ts « M0.4 — RGPD … export-rgpd »'),
    );
    verifier(
      'fichier nommé + titre cité absent',
      !ok('p/b.test.ts « M0.4 — titre inventé »'),
    );
    verifier('fichier de test hors du run Vitest', !ok('p/hors-run.test.ts'));
    verifier('fichier introuvable', !ok('p/fantome.test.ts'));

    console.log('▶  Baseline (cliquet)');
    const livrable = (
      id: string,
      test: string,
      statut = 'implemented',
    ): Deliverable => ({ id, test, statut });
    const juge = (ds: Deliverable[], tolerance: Record<string, string>) =>
      evaluerLivrables(ds, tolerance, corpus);
    let b = juge([livrable('L1', 'libellé fantôme')], {
      L1: 'libellé fantôme',
    });
    verifier(
      'preuve introuvable tolérée à son texte exact',
      b.problemes === 0 && b.toleres === 1 && b.perimees.size === 0,
    );
    b = juge([livrable('L1', 'autre libellé fantôme')], {
      L1: 'libellé fantôme',
    });
    verifier(
      'texte modifié : plus toléré, et l’entrée est périmée',
      b.problemes === 1 && b.perimees.has('L1'),
    );
    b = juge([livrable('L1', 'T16 unique ici')], { L1: 'T16 unique ici' });
    verifier(
      'preuve désormais résolue : entrée périmée (le cliquet descend)',
      b.problemes === 0 && b.perimees.has('L1'),
    );
    b = juge([livrable('L1', 'libellé fantôme', 'partial')], {
      L1: 'libellé fantôme',
    });
    verifier(
      'livrable plus « implemented » : entrée périmée',
      b.perimees.has('L1'),
    );
    b = juge([livrable('L2', 'libellé fantôme')], { L1: 'libellé fantôme' });
    verifier(
      'la tolérance ne s’étend pas à un autre livrable',
      b.problemes === 1 && b.toleres === 0,
    );
    b = juge([livrable('L1', '')], {});
    verifier('livrable implemented sans test → problème', b.problemes === 1);
    const avant = { M1: { L1: 'a', L2: 'b' } };
    verifier(
      'garde CI : retirer une entrée est permis',
      ajoutsBaseline(avant, { M1: { L1: 'a' } }).length === 0,
    );
    verifier(
      'garde CI : ajouter une entrée ou changer son texte = montée refusée',
      ajoutsBaseline(avant, { M1: { L1: 'a', L2: 'b', L3: 'c' } }).join() ===
        'M1 › L3' &&
        ajoutsBaseline(avant, { M1: { L1: 'a', L2: 'b2' } }).join() ===
          'M1 › L2' &&
        ajoutsBaseline(avant, { M2: { L1: 'a' } }).join() === 'M2 › L1',
    );

    // Le contrat de sortie du CLI lui-même (main) : 0 / 1 / 2, jamais un faux
    // « MANQUANT » quand le run est inexploitable ; livrables et baseline câblés.
    console.log('▶  CLI de bout en bout (codes de sortie)');
    const depot = join(dossier, 'depot');
    mkdirSync(join(depot, 'specs', 'manifests'), { recursive: true });
    mkdirSync(join(depot, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(depot, 'docs', 'audit'), { recursive: true });
    const manifeste = (test: string) =>
      writeFileSync(
        join(depot, 'specs', 'manifests', 'M9.9.json'),
        JSON.stringify({
          module: 'M9.9',
          scenarios: ['M9.9-1 — cas repère'],
          deliverables: [{ id: 'L1', statut: 'implemented', test }],
        }),
      );
    const baselineDepot = join(depot, BASELINE_PATH);
    const poserBaseline = (modules: Baseline) =>
      writeFileSync(baselineDepot, JSON.stringify({ _doc: '', modules }));
    // Lancé depuis un hook git, l'environnement porterait GIT_DIR / GIT_INDEX_FILE :
    // les `git commit` ci-dessous écriraient alors dans le VRAI dépôt. On les
    // retire — et on le PROUVE : pendant toute la section, GIT_DIR pointe un dépôt
    // sentinelle qui doit en ressortir intact.
    const sansGit = () =>
      Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
      );
    const sentinelle = join(dossier, 'sentinelle');
    mkdirSync(sentinelle);
    const gitSentinelle = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
        { cwd: sentinelle, env: sansGit(), encoding: 'utf8' },
      );
    gitSentinelle('init', '-q');
    gitSentinelle('commit', '-q', '--allow-empty', '-m', 'sentinelle');
    const gitHerite = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    };
    process.env.GIT_DIR = join(sentinelle, '.git');
    process.env.GIT_INDEX_FILE = join(sentinelle, '.git', 'index');
    try {
      const env = sansGit();
      const git = (...args: string[]) =>
        execFileSync(
          'git',
          ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
          { cwd: depot, stdio: 'ignore', env },
        );
      git('init', '-q');
      const vitestFactice = join(depot, 'node_modules', '.bin', 'vitest');
      const cli = (mode: string, ...args: string[]) => {
        writeFileSync(
          vitestFactice,
          `#!/bin/sh\nexec "${node}" "${faux}" ${mode} "$@"\n`,
        );
        chmodSync(vitestFactice, 0o755);
        return spawnSync(
          node,
          [...process.execArgv, fileURLToPath(import.meta.url), ...args],
          { cwd: depot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env },
        );
      };
      manifeste('M9.9-1 — cas repère');
      let r = cli('gros', 'M9.9');
      verifier('CLI : scénario et livrable couverts → exit 0', r.status === 0);
      r = cli('echec', 'M9.9');
      verifier(
        'CLI : scénario absent du run → exit 1 « MANQUANT »',
        r.status === 1 && r.stdout.includes('MANQUANT'),
      );
      r = cli('crash', 'M9.9');
      verifier(
        'CLI : run inexploitable → exit 2, message explicite, aucun « MANQUANT »',
        r.status === 2 &&
          r.stderr.includes('INEXPLOITABLE') &&
          !r.stdout.includes('MANQUANT'),
      );
      writeFileSync(
        join(depot, 'specs', 'manifests', 'M9.9.json'),
        JSON.stringify({ module: 'M9.9' }),
      );
      r = cli('gros', 'M9.9');
      verifier(
        'CLI : module demandé sans scénario ni livrable → exit 1',
        r.status === 1 && r.stdout.includes('couverture vide'),
      );
      manifeste('M9.9/libelle/sans-test');
      r = cli('gros', 'M9.9');
      verifier(
        'CLI : livrable à preuve non résolue → exit 1',
        r.status === 1 && r.stdout.includes('preuve non résolue'),
      );
      poserBaseline({ 'M9.9': { L1: 'M9.9/libelle/sans-test' } });
      r = cli('gros', 'M9.9');
      verifier(
        'CLI : même livrable toléré par la baseline → exit 0',
        r.status === 0,
      );
      manifeste('M9.9-1 — cas repère');
      r = cli('gros', 'M9.9');
      verifier(
        'CLI : entrée de baseline périmée → exit 1',
        r.status === 1 && r.stdout.includes('baseline périmée'),
      );
      r = cli('gros', 'M9.9', '--prune-baseline');
      verifier(
        'CLI : --prune-baseline retire l’entrée périmée',
        r.status === 0 &&
          JSON.stringify(
            JSON.parse(readFileSync(baselineDepot, 'utf8')).modules,
          ) === '{}',
      );

      console.log('▶  Garde CI --verifier-baseline (mini-dépôt git)');
      rmSync(baselineDepot);
      git('add', '-A');
      git('commit', '-q', '-m', 'sans baseline');
      poserBaseline({ 'M9.9': { L1: 'a' } });
      r = cli('gros', '--verifier-baseline', 'HEAD');
      verifier(
        'fichier absent de la ref → première pose, exit 0',
        r.status === 0 && r.stdout.includes('première pose'),
      );
      git('add', '-A');
      git('commit', '-q', '-m', 'base');
      r = cli('gros', '--verifier-baseline', 'HEAD');
      verifier('baseline identique à la ref → exit 0', r.status === 0);
      poserBaseline({ 'M9.9': { L1: 'a', L2: 'b' } });
      r = cli('gros', '--verifier-baseline', 'HEAD');
      verifier(
        'entrée ajoutée → exit 1',
        r.status === 1 && r.stderr.includes('M9.9 › L2'),
      );
      poserBaseline({});
      r = cli('gros', '--verifier-baseline', 'HEAD');
      verifier('entrée retirée → exit 0', r.status === 0);
      r = cli('gros', '--verifier-baseline', 'origin/absente');
      verifier('ref introuvable → exit 2 (échec fermé)', r.status === 2);
      r = cli('gros', '--verifier-baseline', 'HEAD;true');
      verifier('ref invalide (« HEAD;true ») → exit 2', r.status === 2);
      writeFileSync(baselineDepot, '{"modules": {');
      git('add', '-A');
      git('commit', '-q', '-m', 'baseline corrompue');
      poserBaseline({ 'M9.9': { L9: 'z' } });
      r = cli('gros', '--verifier-baseline', 'HEAD');
      verifier(
        'baseline illisible sur la ref → exit 2, jamais « première pose »',
        r.status === 2,
      );
    } finally {
      for (const [k, v] of Object.entries(gitHerite)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    verifier(
      'isolement git : le dépôt pointé par GIT_DIR ressort intact',
      gitSentinelle('rev-list', '--count', 'HEAD').trim() === '1' &&
        gitSentinelle('status', '--porcelain').trim() === '',
    );
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }

  if (echecs.length > 0) {
    console.error(
      `\n⛔  Auto-test check:coverage : ${echecs.length} échec(s) — le détecteur n'est plus fiable.`,
    );
    return 1;
  }
  console.log(
    '\n✅  Auto-test check:coverage : toutes les gardes rougissent quand elles le doivent.',
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
