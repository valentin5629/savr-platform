/**
 * Outils du rapprochement des lieux et des clients (décision Val 2026-11-06) :
 * ressemblance de deux noms, distance entre deux points, regroupement, et
 * lecture des décisions de Val rejouées à chaque répétition.
 *
 * Trois niveaux par fiche : `auto` (regroupée sans intervention), `a_revoir`
 * (rapprochement proposé, appliqué seulement si Val le décide), `distinct`.
 */
import { normaliserNom } from './normalisation';

export type Niveau = 'auto' | 'a_revoir' | 'distinct';

/** Ressemblance de deux noms, de 0 à 1 (coefficient de Dice sur les paires de lettres). */
export function ressemblanceNoms(a: string, b: string): number {
  const na = normaliserNom(a).replace(/ /g, '');
  const nb = normaliserNom(b).replace(/ /g, '');
  if (na === '' || nb === '') return 0;
  if (na === nb) return 1;
  const paires = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const p = s.slice(i, i + 2);
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return m;
  };
  const pa = paires(na);
  const pb = paires(nb);
  let communes = 0;
  for (const [p, n] of pa) communes += Math.min(n, pb.get(p) ?? 0);
  const total = Math.max(na.length - 1, 0) + Math.max(nb.length - 1, 0);
  return total === 0 ? 0 : (2 * communes) / total;
}

export interface Point {
  latitude: number;
  longitude: number;
}

/** Distance à vol d'oiseau, en mètres. */
export function distanceMetres(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Regroupe des clés reliées deux à deux ; rend, pour chaque clé, le représentant de son groupe. */
export function regrouper(
  cles: string[],
  liens: [string, string][],
  /** Choisit le représentant d'un groupe (ex. la fiche la plus ancienne). */
  representant: (membres: string[]) => string,
): Map<string, string> {
  const parent = new Map(cles.map((c) => [c, c]));
  const racine = (c: string): string => {
    let r = c;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(c, r);
    return r;
  };
  for (const [a, b] of liens) {
    if (parent.has(a) && parent.has(b)) parent.set(racine(a), racine(b));
  }
  const groupes = new Map<string, string[]>();
  for (const c of cles) {
    const r = racine(c);
    groupes.set(r, [...(groupes.get(r) ?? []), c]);
  }
  const resultat = new Map<string, string>();
  for (const membres of groupes.values()) {
    const chef = representant(membres);
    for (const m of membres) resultat.set(m, chef);
  }
  return resultat;
}

export interface Proposition {
  cle: string;
  niveau: Niveau;
  /** Clé de la fiche avec laquelle le rapprochement est proposé (elle-même si `distinct`). */
  groupePropose: string;
  motif: string;
}

/**
 * Propose un niveau pour chaque fiche à partir d'un jugement par paire.
 * `auto` : les deux fiches sont regroupées, le représentant du groupe est la
 * plus ancienne. `a_revoir` : chaque fiche garde, parmi ses voisines, la plus
 * ancienne comme rapprochement proposé. Sans avis : `distinct`.
 */
export function proposer<F extends { cle: string }>(
  fiches: F[],
  anciennete: (a: F, b: F) => number,
  juger: (a: F, b: F) => { niveau: 'auto' | 'a_revoir'; motif: string } | null,
): Proposition[] {
  const liensAuto: [string, string][] = [];
  const motifAuto = new Map<string, string>();
  const aRevoir = new Map<string, { autre: F; motif: string }>();
  for (let i = 0; i < fiches.length; i++) {
    for (let j = i + 1; j < fiches.length; j++) {
      const a = fiches[i]!;
      const b = fiches[j]!;
      const avis = juger(a, b);
      if (!avis) continue;
      if (avis.niveau === 'auto') {
        liensAuto.push([a.cle, b.cle]);
        motifAuto.set(a.cle, avis.motif);
        motifAuto.set(b.cle, avis.motif);
        continue;
      }
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as const) {
        const deja = aRevoir.get(x.cle);
        if (!deja || anciennete(y, deja.autre) < 0)
          aRevoir.set(x.cle, { autre: y, motif: avis.motif });
      }
    }
  }
  const parCle = new Map(fiches.map((f) => [f.cle, f]));
  const chefAuto = regrouper(
    fiches.map((f) => f.cle),
    liensAuto,
    (membres) => membres.map((m) => parCle.get(m)!).sort(anciennete)[0]!.cle,
  );
  return fiches.map((f) => {
    const chef = chefAuto.get(f.cle)!;
    if (chef !== f.cle)
      return {
        cle: f.cle,
        niveau: 'auto',
        groupePropose: chef,
        motif: motifAuto.get(f.cle) ?? 'regroupée',
      };
    const voisin = aRevoir.get(f.cle);
    if (voisin && chefAuto.get(voisin.autre.cle) !== f.cle)
      return {
        cle: f.cle,
        niveau: 'a_revoir',
        groupePropose: chefAuto.get(voisin.autre.cle)!,
        motif: voisin.motif,
      };
    return { cle: f.cle, niveau: 'distinct', groupePropose: f.cle, motif: '' };
  });
}

/**
 * Décisions de Val qui ne s'appliquent à rien : fiche inconnue (clé absente de
 * l'export), ou fiche à rejoindre inconnue. Une faute de frappe ne doit pas
 * être ignorée en silence.
 */
export function decisionsSansObjet(
  propositions: Proposition[],
  decisions: Map<string, string>,
): string[] {
  const connues = new Set(propositions.map((p) => p.cle));
  return [...decisions]
    .filter(
      ([cle, decision]) =>
        !connues.has(cle) ||
        (decision.trim() !== 'distinct' && !connues.has(decision.trim())),
    )
    .map(([cle]) => cle);
}

/** Fiche que chaque fiche rejoint directement : décision de Val, sinon groupe `auto`, sinon elle-même. */
function liensDirects(
  propositions: Proposition[],
  decisions: Map<string, string>,
): Map<string, string> {
  const connues = new Set(propositions.map((p) => p.cle));
  const direct = new Map<string, string>();
  for (const p of propositions) {
    const decision = (decisions.get(p.cle) ?? '').trim();
    if (decision === 'distinct') direct.set(p.cle, p.cle);
    else if (decision !== '' && connues.has(decision))
      direct.set(p.cle, decision);
    else direct.set(p.cle, p.niveau === 'auto' ? p.groupePropose : p.cle);
  }
  return direct;
}

/**
 * Groupe final de chaque fiche : la décision de Val si elle existe (`distinct`
 * pour la séparer, ou la clé de la fiche à rejoindre), sinon le groupe proposé
 * quand il est `auto`, sinon la fiche seule.
 */
export function appliquerDecisions(
  propositions: Proposition[],
  decisions: Map<string, string>,
): Map<string, string> {
  const direct = liensDirects(propositions, decisions);
  // Une fiche peut rejoindre une fiche elle-même rattachée ailleurs : on suit la chaîne.
  const final = new Map<string, string>();
  for (const cle of direct.keys()) {
    let courant = cle;
    const vus = new Set<string>();
    while (direct.get(courant) !== courant && !vus.has(courant)) {
      vus.add(courant);
      courant = direct.get(courant)!;
    }
    final.set(cle, courant);
  }
  return final;
}

/**
 * Chaînes de rattachement qui reviennent sur elles-mêmes (deux fiches qui se
 * désignent l'une l'autre, ou plus) : aucune n'a de tête, elles resteraient
 * séparées sans le dire. Chaque boucle est rendue par ses clés, dans l'ordre de
 * la chaîne. Une fiche qui se désigne elle-même n'en est pas une.
 */
export function decisionsEnBoucle(
  propositions: Proposition[],
  decisions: Map<string, string>,
): string[][] {
  const direct = liensDirects(propositions, decisions);
  const boucles = new Map<string, string[]>();
  for (const depart of direct.keys()) {
    const chemin: string[] = [];
    let courant = depart;
    while (direct.get(courant) !== courant && !chemin.includes(courant)) {
      chemin.push(courant);
      courant = direct.get(courant)!;
    }
    if (direct.get(courant) === courant) continue;
    const boucle = chemin.slice(chemin.indexOf(courant));
    const cle = [...boucle].sort().join('\n');
    if (!boucles.has(cle)) boucles.set(cle, boucle);
  }
  return [...boucles.values()];
}

const RANG_A_FAIRE = {
  'à décider': 0,
  'fusion d’office, à vérifier': 1,
  'rien à faire': 2,
} as const;
const RANG_NIVEAU: Record<string, number> = {
  distinct: 0,
  a_revoir: 1,
  auto: 2,
};
const sansCasseNiAccents = (texte: unknown) =>
  String(texte ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
const comparer = (a: (string | number)[], b: (string | number)[]) => {
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
};

/**
 * Fichier à valider des lieux ou des clients, rangé par dossier (forme posée à
 * la main dans les fichiers de la répétition 1, 2026-11-19). Un dossier = les
 * fiches reliées par leurs rapprochements proposés (`auto` et `a_revoir`).
 * Colonnes ajoutées en tête : `dossier` (D001…), `fiches_dossier`, `a_faire`.
 * Ordre : à décider, puis fusions d'office, puis fiches seules ; à l'intérieur,
 * par nom (sans casse ni accents) de la première fiche du fichier d'origine ;
 * dans un dossier, par niveau (distinct, a_revoir, auto) puis par nom.
 */
export function rangerParDossier(
  lignes: Record<string, unknown>[],
  colonneCle: string,
): Record<string, unknown>[] {
  const cles = lignes.map((l) => String(l[colonneCle]));
  const position = new Map(cles.map((c, i) => [c, i]));
  const liens = lignes
    .filter((l) => l.niveau === 'auto' || l.niveau === 'a_revoir')
    .map((l) => [String(l[colonneCle]), String(l.groupe_propose)]) as [
    string,
    string,
  ][];
  const tete = regrouper(cles, liens, (membres) => membres[0]!);
  const dossiers = new Map<string, Record<string, unknown>[]>();
  for (const l of lignes) {
    const t = tete.get(String(l[colonneCle]))!;
    dossiers.set(t, [...(dossiers.get(t) ?? []), l]);
  }
  const aFaire = (membres: Record<string, unknown>[]) =>
    membres.length === 1
      ? 'rien à faire'
      : membres.some((m) => m.niveau === 'a_revoir')
        ? 'à décider'
        : 'fusion d’office, à vérifier';
  const rangs = (l: Record<string, unknown>) => [
    RANG_NIVEAU[String(l.niveau)] ?? 3,
    sansCasseNiAccents(l.nom),
    position.get(String(l[colonneCle]))!,
  ];
  return [...dossiers]
    .map(([t, membres]) => ({
      membres,
      aFaire: aFaire(membres),
      ordre: [
        RANG_A_FAIRE[aFaire(membres)],
        sansCasseNiAccents(membres[0]!.nom),
        position.get(t)!,
      ],
    }))
    .sort((a, b) => comparer(a.ordre, b.ordre))
    .flatMap(({ membres, aFaire }, i) =>
      [...membres]
        .sort((a, b) => comparer(rangs(a), rangs(b)))
        .map((l) => ({
          dossier: `D${String(i + 1).padStart(3, '0')}`,
          fiches_dossier: membres.length,
          a_faire: aFaire,
          ...l,
        })),
    );
}
