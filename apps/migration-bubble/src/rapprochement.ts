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
 * Groupe final de chaque fiche : la décision de Val si elle existe (`distinct`
 * pour la séparer, ou la clé de la fiche à rejoindre), sinon le groupe proposé
 * quand il est `auto`, sinon la fiche seule.
 */
export function appliquerDecisions(
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
