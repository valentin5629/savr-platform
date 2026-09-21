#!/usr/bin/env tsx
/**
 * G12 — ANCRAGE des `ref_cdc` lignés des manifestes (MODE RAPPORT).
 * =============================================================================
 * Cause racine (mesurée 2026-09-21) : `specs/manifests/M*.json` est *authored*,
 * `specs/cdc/**` est DÉRIVÉ (re-synchronisé depuis le Vault). Un sync qui insère
 * des lignes en amont décale tout le fichier — les `ref_cdc: <fichier>.md:<ligne>`
 * figés dans les manifestes pointent alors un passage SANS RAPPORT, en silence.
 * Au relevé initial : 162 des 287 refs lignées (57 %) avaient décroché, deltas
 * +1 à +121. Le chaînon CDC↔code (G2/G10/G11) perd sa fonction : le relecteur qui
 * remonte à la source lit autre chose et ne peut pas juger la couverture.
 *
 * Aucun gate existant ne l'attrape : `check:manifest-grain` ne valide que la
 * STRUCTURE de `ref_cdc` (pattern), `check:cdc-drift` compare un hash de FICHIER
 * ENTIER — ni l'un ni l'autre ne regarde le NUMÉRO DE LIGNE.
 *
 * Principe (déterministe, zéro heuristique lexicale) : le manifeste et le CDC
 * vivent dans le MÊME dépôt, donc l'ancre est reconstructible depuis git.
 *   1. `git blame` de la ligne JSON `"ref_cdc"` → commit qui l'a posée ;
 *   2. `git show <sha>:<fichier cdc>` → le CDC tel qu'il était à ce commit ;
 *   3. le texte qui était à la ligne N est-il TOUJOURS à la ligne N aujourd'hui ?
 *      – oui  → ancré, rien à signaler ;
 *      – non  → on RETROUVE ce texte dans le fichier courant (ancre 3 lignes non
 *        vides, dégradée à 2 puis 1, hit unique exigé) et on propose la ligne.
 *
 * Zéro faux positif : on ne signale que si le texte d'époque est retrouvé ailleurs
 * de façon NON AMBIGUË. Un passage réécrit sur place ne bouge pas de ligne, donc
 * ne remonte pas.
 *
 * Deux limites assumées, à connaître avant de s'y fier :
 *   – un manifeste REFORMATÉ en masse fait sauter le blame sur ses lignes : l'ancre
 *     redevient l'état courant et le gate est aveugle sur ces refs (faux NÉGATIF,
 *     jamais faux positif) ;
 *   – une ref FAUSSE DÈS LA POSE (erreur de saisie) n'est pas détectable ici : le
 *     texte d'époque est bien à sa place, il n'a simplement jamais décrit le
 *     livrable. Ce gate couvre le décrochage (162/194 des défauts du relevé), pas
 *     la justesse sémantique (11/194, relus à la main).
 *
 * `--fix` réécrit les numéros de ligne (édition textuelle chirurgicale du champ,
 * jamais un re-dump JSON qui reformaterait tout le fichier). À lancer après chaque
 * sync de `specs/`.
 *
 * MODE RAPPORT : informe, ne bloque jamais (exit 0). L'enforcement passe par le
 * méta-cliquet `check:ratchet` (baseline 0 : le parc est recalé, toute NOUVELLE
 * divergence fait rougir).
 * =============================================================================
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const MANIFESTS_DIR = 'specs/manifests';
const FIX = process.argv.includes('--fix');

type Ref = {
  fichier: string; // manifeste (M1.2.json)
  id: string; // id du livrable
  rel: string; // chemin CDC
  start: number;
  end: number;
  libelle: string;
  sha: string | null;
};

type Decroche = Ref & { newStart: number; newEnd: number; texteAncre: string };

// ---------------------------------------------------------------------------
// git (le CDC et les manifestes sont dans le même dépôt → ancre reconstructible)
// ---------------------------------------------------------------------------
function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
}

const blameCache = new Map<string, (string | undefined)[]>();
/** Ligne du manifeste (1-indexée) → sha du commit qui l'a écrite. */
function blameOf(fichier: string): (string | undefined)[] {
  if (!blameCache.has(fichier)) {
    const map: (string | undefined)[] = [];
    try {
      const out = git(
        'blame',
        '--line-porcelain',
        '-l',
        '--',
        `${MANIFESTS_DIR}/${fichier}`,
      );
      let sha: string | null = null;
      for (const l of out.split('\n')) {
        const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
        if (m) {
          sha = m[1];
          map[Number(m[2])] = sha;
        }
      }
    } catch {
      /* historique indisponible (checkout shallow) → gate aveugle, pas en erreur */
    }
    blameCache.set(fichier, map);
  }
  return blameCache.get(fichier)!;
}

const showCache = new Map<string, string[] | null>();
/** Le fichier CDC tel qu'il était au commit donné. */
function versionDEpoque(sha: string, rel: string): string[] | null {
  const k = `${sha}\0${rel}`;
  if (!showCache.has(k)) {
    try {
      showCache.set(k, git('show', `${sha}:${rel}`).split('\n'));
    } catch {
      showCache.set(k, null);
    }
  }
  return showCache.get(k)!;
}

const courantCache = new Map<string, string[] | null>();
function versionCourante(rel: string): string[] | null {
  if (!courantCache.has(rel)) {
    courantCache.set(
      rel,
      existsSync(rel) ? readFileSync(rel, 'utf8').split('\n') : null,
    );
  }
  return courantCache.get(rel)!;
}

const norm = (s: string | undefined): string =>
  (s ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Ancre : les K premières lignes NON VIDES à partir de `depuis`, avec leur offset
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

/** Ancre 3 lignes, dégradée à 2 puis 1 — on retient le premier K à hit UNIQUE. */
function resoudre(
  epoque: string[],
  courant: string[],
  depuis: number,
): number | null {
  for (const k of [3, 2, 1]) {
    const seq = ancreDepuis(epoque, depuis, k);
    if (seq.length < k) continue;
    const hits = localiser(courant, seq);
    if (hits.length === 1) return hits[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Collecte des refs lignées
// ---------------------------------------------------------------------------
function collecterRefs(): { refs: Ref[]; sansHistorique: number } {
  const refs: Ref[] = [];
  let sansHistorique = 0;
  const fichiers = readdirSync(MANIFESTS_DIR)
    .filter((f) => /^M[\d.]+[a-z]?\.json$/.test(f))
    .sort();

  for (const fichier of fichiers) {
    const brut = readFileSync(join(MANIFESTS_DIR, fichier), 'utf8');
    const lignesJson = brut.split('\n');
    const blame = blameOf(fichier);
    const manifeste = JSON.parse(brut) as {
      deliverables?: { id: string; ref_cdc?: string; libelle?: string }[];
    };

    for (const d of manifeste.deliverables ?? []) {
      // `ref_cdc` tolère plusieurs sources jointes par « + » (grain grossier).
      const parties = String(d.ref_cdc ?? '').split(/\s*\+\s*(?=specs\/cdc\/)/);
      const aiguille = JSON.stringify(d.ref_cdc ?? '').slice(1, -1);
      const idxJson =
        lignesJson.findIndex(
          (l) => l.includes('"ref_cdc"') && l.includes(aiguille),
        ) + 1;
      const sha = idxJson > 0 ? (blame[idxJson] ?? null) : null;

      for (const partie of parties) {
        const m = /^(specs\/cdc\/.*?\.md):(\d+)(?:-(\d+))?\s*$/.exec(
          partie.trim(),
        );
        if (!m) continue; // sans ligne, ou malformée → hors périmètre (G2 le voit)
        if (!sha) sansHistorique++;
        refs.push({
          fichier,
          id: d.id,
          rel: m[1],
          start: Number(m[2]),
          end: m[3] ? Number(m[3]) : Number(m[2]),
          libelle: d.libelle ?? '',
          sha,
        });
      }
    }
  }
  return { refs, sansHistorique };
}

// ---------------------------------------------------------------------------
// Détection
// ---------------------------------------------------------------------------
function detecter(refs: Ref[]): Decroche[] {
  const decroches: Decroche[] = [];
  for (const r of refs) {
    if (!r.sha) continue;
    const courant = versionCourante(r.rel);
    const epoque = versionDEpoque(r.sha, r.rel);
    if (!courant || !epoque || r.end > epoque.length) continue;

    const texteEpoque = norm(epoque.slice(r.start - 1, r.end).join(' ⏎ '));
    const texteCourant = norm(courant.slice(r.start - 1, r.end).join(' ⏎ '));
    if (texteEpoque === texteCourant) continue; // toujours ancré

    const newStart = resoudre(epoque, courant, r.start);
    const newEnd =
      r.end === r.start ? newStart : resoudre(epoque, courant, r.end);
    // Rien de retrouvé sans ambiguïté, ou plage qui s'inverserait → on se tait.
    if (!newStart || !newEnd) continue;
    if (newStart === r.start && newEnd === r.end) continue;
    if (newEnd < newStart) continue;

    decroches.push({
      ...r,
      newStart,
      newEnd,
      texteAncre: norm(epoque[r.start - 1]).slice(0, 100),
    });
  }
  return decroches;
}

// ---------------------------------------------------------------------------
// --fix : édition textuelle chirurgicale du champ `ref_cdc` du livrable visé
// ---------------------------------------------------------------------------
const echapper = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function appliquer(decroches: Decroche[]): { ok: number; ko: string[] } {
  const parFichier = new Map<string, Decroche[]>();
  for (const d of decroches) {
    if (!parFichier.has(d.fichier)) parFichier.set(d.fichier, []);
    parFichier.get(d.fichier)!.push(d);
  }

  let ok = 0;
  const ko: string[] = [];
  for (const [fichier, items] of parFichier) {
    const chemin = join(MANIFESTS_DIR, fichier);
    let txt = readFileSync(chemin, 'utf8');
    for (const d of items) {
      const ancien = d.end !== d.start ? `${d.start}-${d.end}` : `${d.start}`;
      const nouveau =
        d.newEnd !== d.newStart ? `${d.newStart}-${d.newEnd}` : `${d.newStart}`;
      // Cible le ref_cdc du livrable dont l'id précède — jamais un homonyme.
      const re = new RegExp(
        `("id": "${echapper(d.id)}",\\s*\\n\\s*"ref_cdc": "[^"]*?${echapper(d.rel)}):${ancien}(?=[^0-9])`,
      );
      if (!re.test(txt)) {
        ko.push(`${fichier} ${d.id} (${d.rel}:${ancien})`);
        continue;
      }
      txt = txt.replace(re, `$1:${nouveau}`);
      ok++;
    }
    JSON.parse(txt); // garde-fou : doit rester du JSON valide
    writeFileSync(chemin, txt);
  }
  return { ok, ko };
}

// ---------------------------------------------------------------------------
function main(): void {
  if (!existsSync(MANIFESTS_DIR)) {
    console.log(
      `[manifest-ref-anchor] ${MANIFESTS_DIR} absent — rien à vérifier.`,
    );
    console.log('RATCHET_COUNT=0');
    process.exit(0);
  }

  const { refs, sansHistorique } = collecterRefs();
  const decroches = detecter(refs);

  if (FIX && decroches.length > 0) {
    const { ok, ko } = appliquer(decroches);
    console.log(`[manifest-ref-anchor] --fix : ${ok} ref(s) recalée(s).`);
    for (const k of ko)
      console.error(`  ⚠ non appliqué (motif introuvable) : ${k}`);
    process.exit(0);
  }

  const lignes: string[] = ['## G12 — Ancrage des `ref_cdc` lignés', ''];
  lignes.push(
    `${refs.length} référence(s) lignée(s) contrôlée(s) · ` +
      `**${decroches.length} décrochée(s)** de leur passage CDC.`,
  );
  lignes.push('');

  if (decroches.length === 0) {
    lignes.push(
      '_Toutes les références pointent toujours leur passage d’origine._',
    );
  } else {
    lignes.push(
      '| Manifeste | Livrable | Ref actuelle | Passage désormais en | Ancre |',
    );
    lignes.push('|---|---|---|---|---|');
    for (const d of decroches.slice(0, 60)) {
      const plage = d.end !== d.start ? `${d.start}-${d.end}` : `${d.start}`;
      const cible =
        d.newEnd !== d.newStart ? `${d.newStart}-${d.newEnd}` : `${d.newStart}`;
      lignes.push(
        `| \`${d.fichier}\` | \`${d.id}\` | :${plage} | **:${cible}** | ${d.texteAncre.replace(/\|/g, '\\|')} |`,
      );
    }
    if (decroches.length > 60)
      lignes.push(`| … | _${decroches.length - 60} autre(s)_ | | | |`);
    lignes.push('');
    lignes.push('> Recalage : `pnpm check:manifest-ref-anchor --fix`.');
  }

  if (sansHistorique > 0) {
    lignes.push('');
    lignes.push(
      `> ⚠ ${sansHistorique} référence(s) sans ancre git (checkout shallow ou ` +
        'manifeste reformaté) : **non contrôlées**. En CI, le job exige ' +
        '`fetch-depth: 0`.',
    );
  }

  const rapport = lignes.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${rapport}\n`);
  console.log(rapport);
  console.log('');
  console.log(
    `[manifest-ref-anchor] ${decroches.length} décrochée(s) / ${refs.length} lignée(s)` +
      `${sansHistorique > 0 ? ` · ${sansHistorique} sans ancre git` : ''}.`,
  );
  console.log(`RATCHET_COUNT=${decroches.length}`);
  console.log('[manifest-ref-anchor] Mode RAPPORT — non bloquant (exit 0).');
  process.exit(0);
}

main();
