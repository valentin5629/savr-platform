#!/usr/bin/env tsx
/**
 * G12 — ANCRAGE des `ref_cdc` lignés des manifestes (MODE RAPPORT).
 * =============================================================================
 * Cause racine (mesurée 2026-09-21) : `specs/manifests/M*.json` est *authored*,
 * `specs/cdc/**` est DÉRIVÉ (re-synchronisé depuis le Vault). Un sync qui insère
 * des lignes en amont décale tout le fichier — les `ref_cdc: <fichier>.md:<ligne>`
 * figés dans les manifestes pointent alors un passage SANS RAPPORT, en silence.
 * Au relevé initial : 162 des 287 refs lignées (56 %) avaient décroché, deltas
 * +1 à +121. Le chaînon CDC↔code (G2/G10/G11) perd sa fonction : le relecteur qui
 * remonte à la source lit autre chose et ne peut pas juger la couverture.
 *
 * Aucun gate existant ne l'attrape : `check:manifest-grain` ne valide que la
 * STRUCTURE de `ref_cdc` (pattern), `check:cdc-drift` compare un hash de FICHIER
 * ENTIER — ni l'un ni l'autre ne regarde le NUMÉRO DE LIGNE.
 *
 * Principe (déterministe, zéro heuristique lexicale) : le manifeste et le CDC
 * vivent dans le MÊME dépôt, donc l'ancre ET son trajet sont reconstructibles
 * depuis git.
 *   1. `git blame` de la ligne JSON `"ref_cdc"` → commit qui l'a posée (l'ANCRE) ;
 *   2. `git log <ancre>..HEAD -- <fichier cdc>` → les versions successives du
 *      fichier, de l'ancre jusqu'à l'arbre de travail ;
 *   3. la ligne N est SUIVIE de version en version par la carte de lignes du
 *      diff (`git diff -U0`), hunk par hunk :
 *        – hors hunk              → décalage cumulé (la ligne est intacte) ;
 *        – hunk de même taille    → 1:1 (passage réécrit sur place) ;
 *        – hunk de taille inégale → le texte est-il ailleurs, à l'identique
 *          (bloc déplacé, hit unique des deux côtés) ? sinon le suivi S'ARRÊTE.
 *
 * Trois issues, jamais confondues :
 *   – ANCRÉE    : la ligne suivie est celle que la ref pointe ;
 *   – DÉCROCHÉE : elle est ailleurs → `--fix` recale le numéro ;
 *   – À RELIRE  : le suivi s'est arrêté (passage remanié ou supprimé). L'outil ne
 *     sait pas, et il le DIT : compteur distinct, jamais noyé dans le zéro.
 *
 * Défaut de la v1, fermé le 2026-10-06. Elle ne suivait pas la ligne : elle
 * RECHERCHAIT le texte d'époque à l'identique dans le fichier courant, et se
 * taisait quand elle ne le retrouvait pas. Un passage réécrit sur place une
 * seule fois (une virgule suffit) n'était donc plus jamais retrouvable, et tout
 * décalage ultérieur devenait invisible — ni signalé, ni recalé, d'un sync à
 * l'autre. Mesure au sync du 2026-10-06 : « 0 décrochée / 440 » après `--fix`
 * alors que 61 refs pointaient un passage étranger. Rejoué sur ce même sync, le
 * suivi version par version retrouve 245 des 269 corrections de la PR (208 pour
 * la v1), en signale 21 « à relire », n'en manque AUCUNE, et en contredit 3 —
 * à raison : le recalage à la main était parti d'une ref déjà fausse.
 *
 * Deux choix mesurés sur ce rejeu, à ne pas défaire sans re-mesurer :
 *   – version par version, pas un seul diff ancre → courant : chaque sync est un
 *     petit diff, donc moins de hunks inégaux (24 « à relire » sur tout le parc
 *     — les 21 ci-dessus + 3 que la PR n'avait pas touchées — contre 26) ;
 *   – pas de repli par similarité dans un hunk inégal : une ligne de tableau
 *     scindée en deux ressemblait à 0,86 à sa seconde moitié quand la relecture
 *     retenait la première, et un passage resté à sa place ne ressemblait plus
 *     qu'à 0,17 à lui-même. Un mauvais recalage automatique est un silence de
 *     plus ; une relecture demandée est visible.
 *
 * Relecture : lire la ligne EN ENTIER contre le libellé du livrable (jamais un
 * affichage tronqué), puis
 *   – le numéro est faux → le corriger dans le manifeste (la ligne JSON modifiée
 *     devient la nouvelle ancre) ;
 *   – le numéro est juste → l'inscrire dans `scripts/ref-cdc-relues.txt`. Le
 *     commit de cette inscription devient l'ancre : la ref reste suivie ensuite.
 *     Le registre ne sert QUE les refs « à relire » : inscrite pour une ref que
 *     l'outil sait suivre, une relecture est ignorée et signalée périmée — elle
 *     ne peut pas faire taire une ref simplement décrochée.
 *
 * Ref composite (`A.md:10 + B.md:5`) : ses parties partagent UNE ligne JSON,
 * donc une ancre. Tant qu'une partie est « à relire », `--fix` ne recale pas les
 * autres — réécrire la ligne ré-ancrerait la partie non relue, qui sortirait du
 * rapport sans avoir été lue.
 *
 * Cinq limites assumées, à connaître avant de s'y fier :
 *   – un manifeste REFORMATÉ en masse fait sauter le blame sur ses lignes : l'ancre
 *     redevient l'état courant et le gate est aveugle sur ces refs (faux NÉGATIF,
 *     jamais faux positif). Seul un changement de BLANCS est neutre (`blame -w`) ;
 *   – une ref FAUSSE DÈS LA POSE (erreur de saisie, ou correction à la main qui
 *     se trompe) n'est pas détectable ici : la ligne est bien suivie, elle n'a
 *     simplement jamais décrit le livrable. Ce gate couvre le décrochage, pas la
 *     justesse sémantique ;
 *   – même famille : une ref posée sur une branche puis REBASÉE par-dessus un
 *     sync est ancrée au CDC d'après, à un numéro choisi contre le CDC d'avant.
 *     Après un rebase qui ramène `specs/cdc`, relire les refs posées par la branche ;
 *   – même cause, à la main : corriger UNE partie d'une ref composite ré-ancre
 *     les autres sans que personne les ait relues. Qui modifie une ligne
 *     `ref_cdc` en relit toutes les parties ;
 *   – une borne posée sur une ligne VIDE est suivie par sa position seule : deux
 *     lignes vides se valent, le diff peut glisser de l'une à l'autre.
 *
 * `--fix` réécrit les numéros de ligne (édition textuelle chirurgicale du champ,
 * jamais un re-dump JSON qui reformaterait tout le fichier), retire du registre
 * les relectures périmées, puis liste ce qui reste à relire. À lancer après
 * chaque sync de `specs/`. `--self-test` rejoue le détecteur sur un dépôt jetable.
 *
 * MODE RAPPORT : informe, ne bloque jamais (exit 0). L'enforcement passe par le
 * méta-cliquet `check:ratchet` (baseline 0 : le parc est recalé, toute NOUVELLE
 * ref décrochée OU à relire fait rougir). Seules sorties en erreur : un clone
 * tronqué (shallow) ou un git qui ne répond pas — aucune ancre n'y est
 * reconstructible, donc aucun compteur émis plutôt qu'un zéro faux. Une ref dont
 * la ligne JSON n'est pas repérable dans un manifeste commité est « à relire ».
 * =============================================================================
 */
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const MANIFESTS_DIR = 'specs/manifests';
const RELUES = 'scripts/ref-cdc-relues.txt';
/** sha que `git blame` attribue à une ligne modifiée mais pas encore commitée. */
const NON_COMMITE = '0'.repeat(40);
/** Dernière « version » d'un fichier quand il diffère de HEAD (sync en cours). */
const ARBRE = 'arbre de travail';

type Ref = {
  fichier: string; // manifeste (M1.2.json)
  id: string; // id du livrable
  partie: number; // rang de la source dans un `ref_cdc` composite (0 sinon)
  rel: string; // chemin CDC
  start: number;
  end: number;
  libelle: string;
  sha: string | null; // ancre : commit qui a écrit la ligne JSON du `ref_cdc`
  relue: Relue | null; // relecture inscrite au registre pour CETTE valeur
};

type Decroche = Ref & { newStart: number; newEnd: number; texteAncre: string };
type ARelire = Ref & { motif: string; ou: string; texteAncre: string };

const plage = (a: number, b: number): string =>
  b !== a ? `${a}-${b}` : `${a}`;

/**
 * `ref_cdc` tolère plusieurs sources jointes par « + » (grain grossier). Groupe
 * capturant : `split` rend sources (rangs pairs) ET séparateurs (rangs impairs),
 * ce qui permet de réécrire une source sans toucher au reste de la valeur.
 */
const JOINTURE = /(\s*\+\s*(?=specs\/cdc\/))/;

// ---------------------------------------------------------------------------
// git (le CDC et les manifestes sont dans le même dépôt → ancre reconstructible)
// ---------------------------------------------------------------------------
function git(...args: string[]): string {
  // stderr capturé, jamais relayé : un avertissement de git peut citer un nom de
  // fichier, et le cliquet lit le compteur dans la sortie du gate.
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Variante muette : `null` si git échoue (objet absent, chemin inconnu…). */
function gitOuNull(...args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

const blameCache = new Map<string, (string | undefined)[]>();
/** Ligne du fichier (1-indexée) → sha du commit qui l'a écrite. */
function blameDe(chemin: string): (string | undefined)[] {
  if (!blameCache.has(chemin)) {
    const map: (string | undefined)[] = [];
    // `-w` : ré-indenter une ligne ne déplace pas son ancre. `null` = fichier
    // absent de HEAD (l'appelant le sait et ne s'y fie pas).
    const out = gitOuNull(
      'blame',
      '-w',
      '--line-porcelain',
      '-l',
      '--',
      chemin,
    );
    for (const l of (out ?? '').split('\n')) {
      const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
      if (m) map[Number(m[2])] = m[1];
    }
    blameCache.set(chemin, map);
  }
  return blameCache.get(chemin)!;
}

const norm = (s: string | undefined): string =>
  (s ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Versions successives d'un fichier CDC, de l'ancre à l'arbre de travail
// ---------------------------------------------------------------------------
/** `id` = blob git, ou `ARBRE` ; `commit` = qui a produit cette version. */
type Version = { id: string; commit: string };

const blobCache = new Map<string, string | null>();
function blobDe(commit: string, rel: string): string | null {
  const k = `${commit}:${rel}`;
  if (!blobCache.has(k))
    blobCache.set(
      k,
      gitOuNull('rev-parse', '--verify', '--quiet', k)?.trim() || null,
    );
  return blobCache.get(k)!;
}

const arbreCache = new Map<string, string | null>();
/** Blob du fichier tel qu'il est sur disque (calculé, pas écrit dans git). */
function blobArbre(rel: string): string | null {
  if (!arbreCache.has(rel))
    arbreCache.set(
      rel,
      existsSync(rel) ? git('hash-object', '--', rel).trim() : null,
    );
  return arbreCache.get(rel)!;
}

const chaineCache = new Map<string, Version[] | null>();
/**
 * `null` si le fichier n'existe pas à l'ancre, à HEAD ou sur disque. Une chaîne
 * d'un seul maillon = fichier inchangé depuis l'ancre.
 */
function chaine(sha: string, rel: string): Version[] | null {
  const k = `${sha}\0${rel}`;
  if (!chaineCache.has(k)) {
    const depart = blobDe(sha, rel);
    const tete = blobDe('HEAD', rel);
    const arbre = blobArbre(rel);
    let versions: Version[] | null = null;
    if (depart && tete && arbre) {
      const v: Version[] = [{ id: depart, commit: sha }];
      if (depart !== arbre) {
        // Un commit de merge n'émet pas de ligne `--raw` : sa version est sautée,
        // le diff suivant enjambe deux changements (moins fin, toujours juste).
        let commit = sha;
        const log = git(
          'log',
          '--format=%H',
          '--raw',
          '--no-abbrev',
          '--topo-order',
          '--reverse',
          `${sha}..HEAD`,
          '--',
          rel,
        );
        for (const l of log.split('\n')) {
          if (/^[0-9a-f]{40}$/.test(l)) commit = l;
          const m = /^:\d+ \d+ [0-9a-f]{40} ([0-9a-f]{40}) /.exec(l);
          if (m && m[1] !== NON_COMMITE) v.push({ id: m[1], commit });
        }
        v.push({ id: tete, commit: 'HEAD' });
        if (arbre !== tete) v.push({ id: ARBRE, commit: ARBRE });
      }
      versions = v.filter((x, i) => i === 0 || x.id !== v[i - 1].id);
    }
    chaineCache.set(k, versions);
  }
  return chaineCache.get(k)!;
}

const lignesCache = new Map<string, string[]>();
function lignesDe(v: Version, rel: string): string[] {
  const surDisque = v.id === ARBRE || v.id === blobArbre(rel);
  const k = surDisque ? `${ARBRE}\0${rel}` : v.id;
  if (!lignesCache.has(k))
    lignesCache.set(
      k,
      (surDisque
        ? readFileSync(rel, 'utf8')
        : git('cat-file', '-p', v.id)
      ).split('\n'),
    );
  return lignesCache.get(k)!;
}

// ---------------------------------------------------------------------------
// Carte de lignes d'un diff `-U0` : `@@ -a,b +c,d @@`
// ---------------------------------------------------------------------------
type Hunk = { a: number; b: number; c: number; d: number };

const hunksCache = new Map<string, Hunk[]>();
function hunksEntre(de: Version, vers: Version, rel: string): Hunk[] {
  const k = `${de.id}\0${vers.id}\0${vers.id === ARBRE ? rel : ''}`;
  if (!hunksCache.has(k)) {
    // `-b` : une ligne dont seuls les blancs changent (tableau ré-aligné) reste
    // « intacte », comme pour `norm`. Algorithme et contexte figés : même carte
    // en local et en CI, quelle que soit la config `diff.*` du poste (un
    // `diff.interHunkContext` fusionnerait des hunks voisins malgré `-U0`).
    const opts = [
      'diff',
      '-U0',
      '-b',
      '--no-color',
      '--no-ext-diff',
      '--diff-algorithm=myers',
      '--inter-hunk-context=0',
    ];
    // La chaîne garantit que le maillon précédant ARBRE est le blob de HEAD.
    const out =
      vers.id === ARBRE
        ? git(...opts, 'HEAD', '--', rel)
        : git(...opts, de.id, vers.id);
    const hunks: Hunk[] = [];
    for (const l of out.split('\n')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
      if (m)
        hunks.push({
          a: Number(m[1]),
          b: m[2] === undefined ? 1 : Number(m[2]),
          c: Number(m[3]),
          d: m[4] === undefined ? 1 : Number(m[4]),
        });
    }
    hunksCache.set(k, hunks);
  }
  return hunksCache.get(k)!;
}

/** Image de la ligne `n` par le diff, ou le hunk de taille inégale qui la contient. */
function imageDe(hunks: Hunk[], n: number): number | Hunk {
  let delta = 0;
  for (const h of hunks) {
    if (h.b === 0) {
      // Insertion pure APRÈS la ligne `a` : seules les lignes suivantes glissent.
      if (n <= h.a) break;
      delta += h.d;
      continue;
    }
    if (n < h.a) break;
    if (n > h.a + h.b - 1) {
      delta += h.d - h.b;
      continue;
    }
    return h.d === h.b ? h.c + (n - h.a) : h;
  }
  return n + delta;
}

// ---------------------------------------------------------------------------
// Repli dans un hunk inégal : le texte a-t-il été DÉPLACÉ à l'identique ?
// Ancre = les K premières lignes NON VIDES à partir de `depuis`, avec leur offset
// ---------------------------------------------------------------------------
type Ancre = { offset: number; texte: string }[];

function ancreDepuis(lignes: string[], depuis: number, k: number): Ancre {
  const seq: Ancre = [];
  for (let i = depuis - 1; i < lignes.length && seq.length < k; i++) {
    const t = norm(lignes[i]);
    if (t.length > 8) seq.push({ offset: i - (depuis - 1), texte: t });
  }
  return seq;
}

/** Positions (1-indexées) où l'ancre se retrouve intégralement dans `lignes`. */
function localiser(lignes: string[], seq: Ancre): number[] {
  if (seq.length === 0) return [];
  const hits: number[] = [];
  const premier = seq[0];
  for (let i = 0; i < lignes.length; i++) {
    if (norm(lignes[i]) !== premier.texte) continue;
    const base = i - premier.offset; // index 0-based de `depuis - 1`
    if (base < 0) continue;
    if (seq.every((s) => norm(lignes[base + s.offset]) === s.texte))
      hits.push(base + 1);
  }
  return hits;
}

/**
 * Ancre 3 lignes, dégradée à 2 puis 1 — on retient le premier K à hit UNIQUE des
 * deux côtés. Unique avant aussi : d'un texte présent deux fois dont l'exemplaire
 * pointé disparaît, il reste un hit unique… sur l'autre.
 */
function resoudre(
  avant: string[],
  apres: string[],
  depuis: number,
): number | null {
  for (const k of [3, 2, 1]) {
    const seq = ancreDepuis(avant, depuis, k);
    if (seq.length < k) continue;
    if (localiser(avant, seq).length !== 1) continue;
    const hits = localiser(apres, seq);
    if (hits.length === 1) return hits[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Suivi d'une ligne le long de la chaîne
// ---------------------------------------------------------------------------
type Perdu = { motif: string; ou: string; texte: string };

function suivre(
  versions: Version[],
  rel: string,
  n0: number,
  depuis = 0,
): number | Perdu {
  let n = n0;
  for (let i = depuis; i + 1 < versions.length; i++) {
    const image = imageDe(hunksEntre(versions[i], versions[i + 1], rel), n);
    if (typeof image === 'number') {
      n = image;
      continue;
    }
    const avant = lignesDe(versions[i], rel);
    const ailleurs = resoudre(avant, lignesDe(versions[i + 1], rel), n);
    if (ailleurs) {
      n = ailleurs;
      continue;
    }
    // Perdu. On dit OÙ chercher : la zone qui a remplacé le passage, portée
    // jusqu'à la version courante (au mieux — elle peut se perdre à son tour).
    const h = image;
    const jusquAuBout = (x: number): number | null => {
      const r = suivre(versions, rel, Math.max(x, 1), i + 1);
      return typeof r === 'number' ? r : null;
    };
    const z1 = jusquAuBout(h.c);
    const z2 = jusquAuBout(h.d === 0 ? h.c : h.c + h.d - 1);
    const par = versions[i + 1].commit;
    return {
      motif:
        (h.d === 0
          ? 'passage supprimé'
          : `passage remanié (${h.b} ligne(s) → ${h.d})`) +
        ` par ${/^[0-9a-f]{40}$/.test(par) ? par.slice(0, 8) : par}`,
      ou: z1 && z2 ? `L${plage(z1, z2)}` : 'zone non localisée',
      texte: norm(avant[n - 1]).slice(0, 100),
    };
  }
  return n;
}

// ---------------------------------------------------------------------------
// Registre des relectures (`scripts/ref-cdc-relues.txt`)
// ---------------------------------------------------------------------------
type Relue = { ligne: number; sha: string; utilisee: boolean };

const cleRelue = (
  fichier: string,
  id: string,
  rel: string,
  a: number,
  b: number,
): string => `${fichier}\0${id}\0${rel}:${plage(a, b)}`;

function lireRelues(): { relues: Map<string, Relue>; malformees: string[] } {
  const relues = new Map<string, Relue>();
  const malformees: string[] = [];
  if (!existsSync(RELUES)) return { relues, malformees };
  const blame = blameDe(RELUES);
  readFileSync(RELUES, 'utf8')
    .split('\n')
    .forEach((brut, i) => {
      const l = brut.trim();
      if (!l || l.startsWith('#')) return;
      // Le motif (après « # », 20 caractères au moins) est obligatoire : une
      // relecture sans raison écrite est une ancre posée à l'aveugle.
      const m =
        /^(\S+)\s+(\S+)\s+(specs\/cdc\/.+?\.md):(\d+)(?:-(\d+))?\s+#\s*\S.{19,}/.exec(
          l,
        );
      if (!m) {
        malformees.push(`${RELUES}:${i + 1}`);
        return;
      }
      const a = Number(m[4]);
      const cle = cleRelue(m[1], m[2], m[3], a, m[5] ? Number(m[5]) : a);
      if (relues.has(cle)) {
        // Répéter une ligne poserait une ancre plus récente sans le dire.
        malformees.push(`${RELUES}:${i + 1} (doublon)`);
        return;
      }
      relues.set(cle, {
        ligne: i + 1,
        // Fichier ou ligne pas encore commités → même statut qu'une ligne de
        // manifeste en cours d'édition.
        sha: blame[i + 1] ?? NON_COMMITE,
        utilisee: false,
      });
    });
  return { relues, malformees };
}

// ---------------------------------------------------------------------------
// Collecte des refs lignées
// ---------------------------------------------------------------------------
/**
 * Map `id de livrable` → numéro de la ligne JSON portant SON `ref_cdc`.
 * Un seul passage séquentiel : on retient le dernier `"id"` rencontré et on le
 * lie au `"ref_cdc"` qui suit (l'ordre des clés est celui du schéma). Les ids
 * sont uniques par manifeste, donc l'association est bijective.
 */
function lignesRefCdcParId(lignesJson: string[]): Map<string, number> {
  const map = new Map<string, number>();
  let idCourant: string | null = null;
  for (let i = 0; i < lignesJson.length; i++) {
    const mId = /^\s*"id":\s*"([^"]+)"/.exec(lignesJson[i]);
    if (mId) {
      idCourant = mId[1];
      continue;
    }
    if (idCourant && /^\s*"ref_cdc":/.test(lignesJson[i])) {
      map.set(idCourant, i + 1); // 1-indexé, comme le blame
      idCourant = null;
    }
  }
  return map;
}

function collecterRefs(relues: Map<string, Relue>): Ref[] {
  const refs: Ref[] = [];
  const fichiers = readdirSync(MANIFESTS_DIR)
    .filter((f) => /^M[\d.]+[a-z]?\.json$/.test(f))
    .sort();

  for (const fichier of fichiers) {
    const chemin = join(MANIFESTS_DIR, fichier);
    const brut = readFileSync(chemin, 'utf8');
    const lignesJson = brut.split('\n');
    // Manifeste absent de HEAD (nouveau, pas encore commité) : toutes ses refs
    // sont « en cours », comme une ligne modifiée dans l'arbre de travail.
    const nouveau = blobDe('HEAD', chemin) === null;
    const blame = blameDe(chemin);
    const manifeste = JSON.parse(brut) as {
      deliverables?: { id: string; ref_cdc?: string; libelle?: string }[];
    };

    // Ligne JSON du `ref_cdc` de CHAQUE livrable, repérée par son `id` (unique
    // dans un manifeste). Chercher la ligne par la VALEUR de `ref_cdc` serait
    // faux : 53 valeurs sont aujourd'hui partagées par plusieurs livrables (et
    // l'une peut être préfixe d'une autre, « …:36 » dans « …:36 + autre.md:254 »)
    // → tous auraient hérité du sha de la PREMIÈRE occurrence, donc d'un
    // instantané CDC étranger, seule source possible de faux positif ici.
    const ligneRefParId = lignesRefCdcParId(lignesJson);

    for (const d of manifeste.deliverables ?? []) {
      const sources = String(d.ref_cdc ?? '')
        .split(JOINTURE)
        .filter((_, i) => i % 2 === 0);
      const idxJson = ligneRefParId.get(d.id);
      // `null` dans un manifeste commité = ligne `ref_cdc` non repérée (clé
      // avant `"id"`, objet sur une ligne) ou blame muet : la ref sera signalée
      // « à relire », jamais écartée en silence.
      const sha = nouveau
        ? NON_COMMITE
        : idxJson
          ? (blame[idxJson] ?? null)
          : null;

      for (const [partie, source] of sources.entries()) {
        const m = /^(specs\/cdc\/.*?\.md):(\d+)(?:-(\d+))?\s*$/.exec(
          source.trim(),
        );
        if (!m) continue; // sans ligne, ou malformée → hors périmètre (G2 le voit)
        const start = Number(m[2]);
        const end = m[3] ? Number(m[3]) : start;

        refs.push({
          fichier,
          id: d.id,
          partie,
          rel: m[1],
          start,
          end,
          libelle: d.libelle ?? '',
          sha,
          relue: relues.get(cleRelue(fichier, d.id, m[1], start, end)) ?? null,
        });
      }
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Détection
// ---------------------------------------------------------------------------
type Constat =
  | { etat: 'ancree' }
  | { etat: 'decrochee'; newStart: number; newEnd: number; texteAncre: string }
  | { etat: 'a-relire'; motif: string; ou: string; texteAncre: string };

/** Où est aujourd'hui le passage que la ref pointait au commit `sha` ? */
function constater(r: Ref, sha: string): Constat {
  const aRelire = (motif: string, ou = '—', texteAncre = ''): Constat => ({
    etat: 'a-relire',
    motif,
    ou,
    texteAncre,
  });
  const versions = chaine(sha, r.rel);
  if (!versions)
    return aRelire("fichier CDC absent (à l'ancre, à HEAD ou sur disque)");
  const epoque = lignesDe(versions[0], r.rel);
  if (r.start < 1 || r.end < r.start || r.end > epoque.length)
    return aRelire('plage hors du fichier dès la pose');

  const s = suivre(versions, r.rel, r.start);
  const e = r.end === r.start ? s : suivre(versions, r.rel, r.end);
  if (typeof s !== 'number') return aRelire(s.motif, s.ou, s.texte);
  if (typeof e !== 'number') return aRelire(e.motif, e.ou, e.texte);
  if (e < s) return aRelire('bornes inversées après suivi', `L${e}-${s}`);
  if (s === r.start && e === r.end) return { etat: 'ancree' };
  return {
    etat: 'decrochee',
    newStart: s,
    newEnd: e,
    texteAncre: norm(epoque[r.start - 1]).slice(0, 100),
  };
}

type Detection = {
  decroches: Decroche[];
  aRelire: ARelire[];
  enCours: number; // refs posées dans l'arbre de travail, pas encore commitées
};

function detecter(refs: Ref[]): Detection {
  const decroches: Decroche[] = [];
  const aRelire: ARelire[] = [];
  let enCours = 0;

  for (const r of refs) {
    if (!r.sha) {
      aRelire.push({
        ...r,
        motif:
          'ancre git introuvable (dans le manifeste, `"id"` doit précéder ' +
          '`"ref_cdc"`, une clé par ligne)',
        ou: '—',
        texteAncre: '',
      });
      continue;
    }
    if (r.sha === NON_COMMITE) {
      enCours++; // l'ancre EST l'état courant : rien à suivre avant le commit
      continue;
    }
    let c = constater(r, r.sha);
    // Le registre ne sert QUE la ref que l'outil ne sait pas suivre depuis sa
    // propre ancre : la relecture déplace alors l'ancre à son commit.
    if (c.etat === 'a-relire' && r.relue) {
      r.relue.utilisee = true;
      if (r.relue.sha === NON_COMMITE) {
        enCours++;
        continue;
      }
      c = constater(r, r.relue.sha);
    }
    if (c.etat === 'decrochee') decroches.push({ ...r, ...c });
    if (c.etat === 'a-relire') aRelire.push({ ...r, ...c });
  }

  // Ref composite : recaler une partie réécrirait la ligne JSON, donc ré-ancrerait
  // AUSSI la partie « à relire », qui sortirait du rapport sans avoir été lue.
  const livrable = (r: Ref): string => `${r.fichier}\0${r.id}`;
  const enAttente = new Set(aRelire.map(livrable));
  for (const d of decroches.filter((x) => enAttente.has(livrable(x))))
    aRelire.push({
      ...d,
      motif: 'recalage suspendu : une autre partie de cette ref est à relire',
      ou: `L${plage(d.newStart, d.newEnd)}`,
    });
  return {
    decroches: decroches.filter((x) => !enAttente.has(livrable(x))),
    aRelire,
    enCours,
  };
}

// ---------------------------------------------------------------------------
// --fix : édition textuelle chirurgicale du champ `ref_cdc` du livrable visé
// ---------------------------------------------------------------------------
const echapper = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function appliquer(decroches: Decroche[]): { ok: number; ko: string[] } {
  // Par livrable, toutes ses sources en UNE passe, chacune à son rang. Les
  // remplacer une à une par motif confondrait deux sources du même fichier dès
  // que le nouveau numéro de l'une vaut l'ancien de l'autre (`:25 + :26`
  // décalées de 1 : la seconde passe retombait sur la première).
  const parLivrable = new Map<string, Decroche[]>();
  for (const d of decroches) {
    const k = `${d.fichier}\0${d.id}`;
    if (!parLivrable.has(k)) parLivrable.set(k, []);
    parLivrable.get(k)!.push(d);
  }

  let ok = 0;
  const ko: string[] = [];
  const textes = new Map<string, string>();
  for (const items of parLivrable.values()) {
    const { fichier, id } = items[0];
    const chemin = join(MANIFESTS_DIR, fichier);
    const txt = textes.get(chemin) ?? readFileSync(chemin, 'utf8');
    // Cible le ref_cdc du livrable dont l'id précède — jamais un homonyme.
    const m = new RegExp(
      `("id": "${echapper(id)}",\\s*\\n\\s*"ref_cdc": ")([^"]*)`,
    ).exec(txt);
    const morceaux = m ? m[2].split(JOINTURE) : [];
    for (const d of items) {
      const ancien = `${d.rel}:${plage(d.start, d.end)}`;
      if (morceaux[2 * d.partie]?.trim() !== ancien) {
        ko.push(`${fichier} ${id} (${ancien})`);
        continue;
      }
      morceaux[2 * d.partie] = `${d.rel}:${plage(d.newStart, d.newEnd)}`;
      ok++;
    }
    if (m)
      textes.set(
        chemin,
        txt.slice(0, m.index) +
          m[1] +
          morceaux.join('') +
          txt.slice(m.index + m[0].length),
      );
  }
  for (const [chemin, txt] of textes) {
    JSON.parse(txt); // garde-fou : doit rester du JSON valide
    writeFileSync(chemin, txt);
  }
  return { ok, ko };
}

/** Retire du registre les lignes données (1-indexées). Le reste est intact. */
function retirerRelues(lignes: number[]): void {
  const aRetirer = new Set(lignes);
  writeFileSync(
    RELUES,
    readFileSync(RELUES, 'utf8')
      .split('\n')
      .filter((_, i) => !aRetirer.has(i + 1))
      .join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Analyse complète + rapport
// ---------------------------------------------------------------------------
type Analyse = Detection & {
  refs: Ref[];
  nbRelues: number;
  perimees: number[]; // lignes du registre qui ne servent aucune ref « à relire »
  malformees: string[];
};

function viderCaches(): void {
  for (const c of [
    blameCache,
    blobCache,
    arbreCache,
    chaineCache,
    lignesCache,
    hunksCache,
  ])
    c.clear();
}

function analyser(): Analyse {
  viderCaches();
  const { relues, malformees } = lireRelues();
  const refs = collecterRefs(relues);
  const detection = detecter(refs); // marque au passage les relectures utiles
  const toutes = [...relues.values()];
  return {
    ...detection,
    refs,
    nbRelues: toutes.filter((r) => r.utilisee).length,
    perimees: toutes.filter((r) => !r.utilisee).map((r) => r.ligne),
    malformees,
  };
}

const compteur = (a: Analyse): number =>
  a.decroches.length +
  a.aRelire.length +
  a.perimees.length +
  a.malformees.length;

const cellule = (s: string): string => s.replace(/\|/g, '\\|');

function tableARelire(aRelire: ARelire[]): string[] {
  // Jamais tronquée : chaque ligne attend un geste humain.
  const l = [
    '| Manifeste | Livrable | Ref actuelle | Pourquoi | Où chercher | Texte suivi |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of aRelire)
    l.push(
      `| \`${r.fichier}\` | \`${r.id}\` | \`${r.rel}:${plage(r.start, r.end)}\` | ${r.motif} | ${r.ou} | ${cellule(r.texteAncre)} |`,
    );
  l.push('');
  l.push(
    '> Lire la ligne EN ENTIER contre le libellé du livrable. Numéro faux → le ' +
      'corriger dans le manifeste (toutes les parties d’une ref composite). ' +
      'Numéro juste → inscrire ' +
      `\`<manifeste> <id> <fichier>.md:<ligne>  # motif\` dans \`${RELUES}\`.`,
  );
  return l;
}

function rapport(a: Analyse): string {
  const lignes: string[] = ['## G12 — Ancrage des `ref_cdc` lignés', ''];
  lignes.push(
    `${a.refs.length} référence(s) lignée(s) contrôlée(s) · ` +
      `**${a.decroches.length} décrochée(s)** de leur passage CDC · ` +
      `**${a.aRelire.length} à relire** (suivi impossible).`,
  );
  lignes.push('');

  if (compteur(a) === 0)
    lignes.push(
      '_Toutes les références pointent toujours leur passage d’origine._',
    );

  if (a.decroches.length > 0) {
    lignes.push('### Décrochées — recalage automatique');
    lignes.push('');
    lignes.push(
      '| Manifeste | Livrable | Ref actuelle | Passage désormais en | Ancre |',
    );
    lignes.push('|---|---|---|---|---|');
    for (const d of a.decroches.slice(0, 60))
      lignes.push(
        `| \`${d.fichier}\` | \`${d.id}\` | :${plage(d.start, d.end)} | **:${plage(d.newStart, d.newEnd)}** | ${cellule(d.texteAncre)} |`,
      );
    if (a.decroches.length > 60)
      lignes.push(`| … | _${a.decroches.length - 60} autre(s)_ | | | |`);
    lignes.push('');
    lignes.push('> Recalage : `pnpm check:manifest-ref-anchor --fix`.');
    lignes.push('');
  }

  if (a.aRelire.length > 0) {
    lignes.push('### À relire — l’outil ne sait pas suivre le passage');
    lignes.push('');
    lignes.push(...tableARelire(a.aRelire));
    lignes.push('');
  }

  if (a.perimees.length > 0 || a.malformees.length > 0) {
    lignes.push(`### Registre des relectures (\`${RELUES}\`)`);
    lignes.push('');
    for (const n of a.perimees)
      lignes.push(
        `- ligne ${n} : ne sert aucune ref « à relire » (\`--fix\` la retire).`,
      );
    for (const m of a.malformees)
      lignes.push(
        `- ${m} : illisible — attendu \`<manifeste> <id> <fichier>.md:<ligne>  # motif\` (motif ≥ 20 caractères).`,
      );
    lignes.push('');
  }

  if (a.enCours > 0)
    lignes.push(
      `> ${a.enCours} référence(s) posée(s) dans l’arbre de travail, pas encore ` +
        'commitée(s) : leur ancre est l’état courant, rien à suivre avant le commit.',
    );
  return lignes.join('\n').trimEnd();
}

const bilan = (a: Analyse): string =>
  `${a.decroches.length} décrochée(s) · ${a.aRelire.length} à relire / ` +
  `${a.refs.length} lignée(s)` +
  (a.nbRelues > 0 ? ` · ${a.nbRelues} relue(s) à la main` : '') +
  (a.perimees.length + a.malformees.length > 0
    ? ` · ${a.perimees.length + a.malformees.length} ligne(s) de registre à reprendre`
    : '') +
  (a.enCours > 0 ? ` · ${a.enCours} non commitée(s)` : '');

// ---------------------------------------------------------------------------
// Auto-test — non vacant : un dépôt jetable où chaque cas DOIT sortir dans son
// compteur, à commencer par celui que la v1 ne voyait pas (réécrit PUIS décalé).
// ---------------------------------------------------------------------------
function autoTest(): number {
  const echecs: string[] = [];
  const verifier = (nom: string, ok: boolean): void => {
    console.log(`  ${ok ? '✅' : '❌'}  ${nom}`);
    if (!ok) echecs.push(nom);
  };

  const origine = process.cwd();
  const dossier = mkdtempSync(join(tmpdir(), 'ref-anchor-autotest-'));
  // Lancé depuis un hook, git hérite du dépôt, de l'index et du magasin d'objets
  // de l'appelant : aucune variable GIT_* ne passe.
  for (const v of Object.keys(process.env))
    if (v.startsWith('GIT_')) delete process.env[v];
  try {
    process.chdir(dossier);
    const CDC = 'specs/cdc/demo.md';
    const MANIFESTE = `${MANIFESTS_DIR}/M9.9.json`;
    mkdirSync('specs/cdc', { recursive: true });
    mkdirSync(MANIFESTS_DIR, { recursive: true });
    mkdirSync('scripts', { recursive: true });

    const commit = (message: string): void => {
      git('add', '-A');
      git(
        '-c',
        'user.name=autotest',
        '-c',
        'user.email=autotest@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '-q',
        '-m',
        message,
      );
    };
    const ecrireCdc = (lignes: string[]): void =>
      writeFileSync(CDC, `${lignes.join('\n')}\n`);
    const refDe = (id: string): string =>
      (
        JSON.parse(readFileSync(MANIFESTE, 'utf8')) as {
          deliverables: { id: string; ref_cdc: string }[];
        }
      ).deliverables
        .find((d) => d.id === id)!
        .ref_cdc.split(`${CDC}:`)
        .join('');
    const decrochee = (a: Analyse, id: string): string | null => {
      const d = a.decroches.filter((x) => x.id === id);
      return d.length > 0
        ? d.map((x) => plage(x.newStart, x.newEnd)).join(' + ')
        : null;
    };
    const aRelire = (a: Analyse, id: string): number =>
      a.aRelire.filter((x) => x.id === id).length;

    // v0 — 24 lignes distinctes, sauf la 22 qui répète la 16 (texte en double).
    // Une ref par cas ; deux refs composites (deux sources sur une ligne JSON).
    const v0 = Array.from(
      { length: 24 },
      (_, i) => `Paragraphe ${i + 1} du cahier des charges, version initiale.`,
    );
    v0[21] = v0[15];
    const cas: Record<string, string[]> = {
      reecritPuisDecale: ['3'],
      reecritLeger: ['5'],
      decaleSeul: ['7'],
      reecritLourd: ['9'],
      remanie: ['11'],
      plageEtendue: ['13-14'],
      supprime: ['16'],
      deplace: ['23-24'],
      composite: ['7', '11'], // une source suivie, l'autre remaniée
      voisines: ['19', '20'], // deux sources adjacentes du même fichier
    };
    git('-c', 'init.defaultBranch=main', 'init', '-q');
    ecrireCdc(v0);
    writeFileSync(
      MANIFESTE,
      `${JSON.stringify(
        {
          deliverables: Object.entries(cas).map(([id, plages]) => ({
            id,
            ref_cdc: plages.map((l) => `${CDC}:${l}`).join(' + '),
            libelle: id,
          })),
        },
        null,
        2,
      )}\n`,
    );
    commit('v0');

    // v1 — réécritures SUR PLACE seules (aucune ligne ne bouge).
    const v1 = [...v0];
    v1[2] =
      'Paragraphe 3 du cahier des charges, version corrigée d’une virgule.';
    v1[4] = 'Paragraphe 5 du cahier des charges — version initiale.';
    v1[8] = 'Tout autre chose : ce texte ne ressemble plus du tout à l’ancien.';
    ecrireCdc(v1);
    commit('v1 : réécritures sur place');
    let a = analyser();
    verifier(
      'réécriture sur place, légère ou lourde → ni décrochée ni à relire',
      compteur(a) === 0 && a.refs.length === 12,
    );

    // v2 — décalage (+2 en tête), remaniement, suppression, insertion dans une
    // plage, bloc de fin remonté par-dessus 5 lignes (assez loin pour que le
    // diff le supprime ici et l'insère là). D'abord NON commité (sync en cours).
    const v2 = [
      'En-tête ajouté par l’export, ligne 1.',
      'En-tête ajouté par l’export, ligne 2.',
      ...v1.slice(0, 10), // 1-10 → 3-12
      'Le paragraphe 11 a été refondu,', // 11 → 3 lignes sans rapport
      'puis scindé en plusieurs lignes,',
      'dont aucune ne reprend l’ancien texte.',
      v1[11], // 12 → 16
      v1[12], // 13 → 17
      'Ligne insérée au milieu de la plage 13-14.',
      v1[13], // 14 → 19
      v1[14], // 15 → 20 (16 supprimé ; son double, ligne 22, survit en 28)
      v1[16], // 17 → 21
      v1[22], // 23 → 22 (bloc déplacé)
      v1[23], // 24 → 23
      ...v1.slice(17, 22), // 18-22 → 24-28
    ];
    ecrireCdc(v2);
    const attendu = (etat: string): void => {
      verifier(
        `[${etat}] réécrit sur place PUIS décalé → décrochée, recalée en :5`,
        decrochee(a, 'reecritPuisDecale') === '5',
      );
      verifier(
        `[${etat}] décalages simples → :7, :9, :11`,
        decrochee(a, 'reecritLeger') === '7' &&
          decrochee(a, 'decaleSeul') === '9' &&
          decrochee(a, 'reecritLourd') === '11',
      );
      verifier(
        `[${etat}] insertion dans la plage → :17-19`,
        decrochee(a, 'plageEtendue') === '17-19',
      );
      verifier(
        `[${etat}] bloc déplacé à l'identique → :22-23`,
        decrochee(a, 'deplace') === '22-23',
      );
      verifier(
        `[${etat}] remanié (1 → 3 lignes) → à relire, jamais recalé`,
        aRelire(a, 'remanie') === 1 && decrochee(a, 'remanie') === null,
      );
      verifier(
        `[${etat}] supprimé, alors que son texte existe en double → à relire, pas recalé sur le double`,
        aRelire(a, 'supprime') === 1 && decrochee(a, 'supprime') === null,
      );
      verifier(
        `[${etat}] ref composite dont une source est à relire → l'autre n'est pas recalée d'office`,
        aRelire(a, 'composite') === 2 && decrochee(a, 'composite') === null,
      );
      verifier(
        `[${etat}] le compteur du cliquet additionne décrochées (8) et à relire (4)`,
        a.decroches.length === 8 &&
          a.aRelire.length === 4 &&
          compteur(a) === 12,
      );
    };
    a = analyser();
    attendu('arbre de travail');
    verifier(
      '[arbre de travail] zone où chercher le passage remanié : L13-15',
      a.aRelire.find((x) => x.id === 'remanie')?.ou === 'L13-15',
    );
    commit('v2 : sync');
    a = analyser();
    attendu('commité');

    // --fix : recale les décrochées, laisse les « à relire » visibles.
    appliquer(a.decroches);
    verifier(
      '--fix écrit :5, :17-19 et :25 + :26 ; ne touche ni aux à relire ni à la ref composite en attente',
      refDe('reecritPuisDecale') === '5' &&
        refDe('plageEtendue') === '17-19' &&
        refDe('voisines') === '25 + 26' &&
        refDe('remanie') === '11' &&
        refDe('composite') === '7 + 11',
    );
    a = analyser();
    verifier(
      'après --fix, avant commit : 8 refs en cours, 4 toujours à relire',
      a.enCours === 8 && a.decroches.length === 0 && a.aRelire.length === 4,
    );

    // Relecture : « remanie » et la composite corrigées à la main ; « supprime »
    // jugée juste telle quelle → inscrite au registre.
    const corriger = (id: string, valeur: string): void =>
      writeFileSync(
        MANIFESTE,
        readFileSync(MANIFESTE, 'utf8').replace(
          new RegExp(`("id": "${id}",\\s*"ref_cdc": ")[^"]*`),
          `$1${valeur}`,
        ),
      );
    corriger('remanie', `${CDC}:13`);
    corriger('composite', `${CDC}:9 + ${CDC}:13`);
    const relectureSupprime = `M9.9.json supprime ${CDC}:16  # relu : la ligne 16 porte bien le livrable\n`;
    writeFileSync(RELUES, `# registre\n${relectureSupprime}`);
    commit('recalage + relecture');
    a = analyser();
    verifier(
      'refs corrigées à la main + relecture inscrite → 0 décrochée, 0 à relire',
      compteur(a) === 0 && a.nbRelues === 1,
    );

    // v3 — nouveau décalage (+1). La ref relue doit rester SUIVIE, pas acquittée
    // à vie ; et une relecture inscrite pour une ref simplement décrochée ne la
    // fait pas taire.
    const v3 = ['Encore une ligne en tête.', ...v2];
    ecrireCdc(v3);
    writeFileSync(
      RELUES,
      `# registre\n${relectureSupprime}M9.9.json decaleSeul ${CDC}:9  # tentative : faire taire une ref décrochée\n`,
    );
    commit('v3 : sync suivant');
    a = analyser();
    verifier(
      'après relecture, un nouveau décalage est vu : relue :16 → :17, corrigée :13 → :14',
      decrochee(a, 'supprime') === '17' && decrochee(a, 'remanie') === '14',
    );
    verifier(
      'le registre ne fait pas taire une ref décrochée : :9 → :10 signalée, relecture périmée',
      decrochee(a, 'decaleSeul') === '10' &&
        a.perimees.length === 1 &&
        a.decroches.length === 12 &&
        compteur(a) === 13,
    );
    appliquer(a.decroches);
    verifier(
      '--fix recale deux sources voisines sans les confondre (:25 + :26 → :26 + :27)',
      refDe('voisines') === '26 + 27' && refDe('composite') === '10 + 14',
    );
    a = analyser();
    verifier(
      'une relecture dont la valeur n’existe plus est signalée périmée',
      a.perimees.length === 2 && compteur(a) === 2,
    );
    retirerRelues(a.perimees);
    a = analyser();
    verifier(
      '--fix les retire du registre, commentaires conservés',
      compteur(a) === 0 && readFileSync(RELUES, 'utf8') === '# registre\n',
    );
    commit('recalage v3');

    // v4 — insertion DANS une plage, rien en amont : seule la fin bouge.
    ecrireCdc([
      ...v3.slice(0, 18),
      'Seconde insertion dans la plage.',
      ...v3.slice(18),
    ]);
    a = analyser();
    verifier(
      'fin de plage seule déplacée (début inchangé) → décrochée, :18-20 → :18-21',
      decrochee(a, 'plageEtendue') === '18-21',
    );

    // Registre : un motif absent ou expédié est refusé, une ligne répétée aussi.
    const valide = `M9.9.json remanie ${CDC}:14  # relu : la ligne 14 porte bien le livrable\n`;
    writeFileSync(
      RELUES,
      `M9.9.json supprime ${CDC}:17\nM9.9.json deplace ${CDC}:24  # ok\n${valide}${valide}`,
    );
    a = analyser();
    verifier(
      'relecture sans motif, au motif de 2 caractères, ou en double → lignes illisibles, comptées',
      a.malformees.length === 3,
    );

    // Manifeste neuf : « en cours » tant qu'il n'est pas commité. Une fois
    // commité, une ref dont la ligne JSON n'est pas repérable (`ref_cdc` écrit
    // avant `id`) n'a pas d'ancre : elle est à relire, jamais écartée.
    writeFileSync(RELUES, '# registre\n');
    writeFileSync(
      `${MANIFESTS_DIR}/M9.8.json`,
      `${JSON.stringify(
        {
          deliverables: [
            { id: 'neuve', ref_cdc: `${CDC}:1`, libelle: 'neuve' },
            { ref_cdc: `${CDC}:2`, id: 'clesInversees', libelle: 'sans ancre' },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const avant = a.enCours;
    a = analyser();
    verifier(
      'manifeste pas encore commité → ses 2 refs sont en cours, aucune à relire',
      a.enCours === avant + 2 &&
        aRelire(a, 'neuve') + aRelire(a, 'clesInversees') === 0,
    );
    commit('manifeste neuf');
    a = analyser();
    verifier(
      'manifeste commité, ligne `ref_cdc` non repérable → à relire, jamais écartée en silence',
      aRelire(a, 'clesInversees') === 1 &&
        aRelire(a, 'neuve') === 0 &&
        decrochee(a, 'neuve') === null,
    );
  } catch (e) {
    verifier(`auto-test interrompu : ${(e as Error).message}`, false);
  } finally {
    process.chdir(origine);
    rmSync(dossier, { recursive: true, force: true });
  }

  if (echecs.length > 0) {
    console.error(
      `\n⛔  Auto-test manifest-ref-anchor : ${echecs.length} échec(s).`,
    );
    return 1;
  }
  console.log('\n✅  Auto-test manifest-ref-anchor OK.');
  return 0;
}

// ---------------------------------------------------------------------------
function main(): void {
  if (process.argv.includes('--self-test')) process.exit(autoTest());

  if (!existsSync(MANIFESTS_DIR)) {
    console.log(
      `[manifest-ref-anchor] ${MANIFESTS_DIR} absent — rien à vérifier.`,
    );
    console.log('RATCHET_COUNT=0');
    process.exit(0);
  }

  // Deux cas où chaque ancre vaudrait l'état courant et où le gate compterait
  // zéro sans rien voir : un clone tronqué (le blame attribue tout au commit de
  // coupe) et un git qui ne répond pas (dépôt non approuvé, binaire absent).
  // Aucun compteur émis → le cliquet rougit (« gate illisible »).
  const tronque = gitOuNull('rev-parse', '--is-shallow-repository')?.trim();
  if (tronque !== 'false') {
    console.error(
      '⛔ [manifest-ref-anchor] ' +
        (tronque === 'true'
          ? 'dépôt tronqué (shallow) : relancer sur un historique complet (`fetch-depth: 0`).'
          : 'git ne répond pas dans ce dépôt.') +
        ' Les ancres ne sont pas reconstructibles, aucun compteur émis.',
    );
    process.exit(1);
  }

  let a = analyser();

  if (process.argv.includes('--fix')) {
    const { ok, ko } = appliquer(a.decroches);
    // Une ref recalée change de valeur : sa relecture ne vaut plus. On ne le
    // sait qu'après coup.
    a = analyser();
    const retirees = a.perimees.length;
    if (retirees > 0) {
      retirerRelues(a.perimees);
      a = analyser();
    }
    console.log(
      `[manifest-ref-anchor] --fix : ${ok} ref(s) recalée(s)` +
        (retirees > 0
          ? ` · ${retirees} relecture(s) périmée(s) retirée(s)`
          : '') +
        '.',
    );
    for (const k of ko)
      console.error(`  ⚠ non appliqué (motif introuvable) : ${k}`);
    if (a.aRelire.length > 0) {
      console.log('');
      console.log(
        `⚠ ${a.aRelire.length} ref(s) À RELIRE À LA MAIN — l'outil ne les recale pas :`,
      );
      console.log('');
      console.log(tableARelire(a.aRelire).join('\n'));
    }
    console.log('');
    console.log(`[manifest-ref-anchor] ${bilan(a)}.`);
    process.exit(0);
  }

  const texte = rapport(a);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${texte}\n`);
  console.log(texte);
  console.log('');
  console.log(`[manifest-ref-anchor] ${bilan(a)}.`);
  console.log(`RATCHET_COUNT=${compteur(a)}`);
  console.log('[manifest-ref-anchor] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

main();
