import type { ContactOption } from '@/components/programmation/contact-combobox';
import { PAX_COLLECTE_MAX } from '@/lib/pax-collecte-borne';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';

/**
 * Cartes de l'écran 2 du formulaire de programmation (refonte, lot B2 ;
 * décisions Val 2026-10-22, C4–C5, et 2026-10-24, B2-Q4). Logique pure,
 * partagée par le formulaire, la reprise d'un brouillon et la duplication.
 */

/** Champs qu'une carte reprend de la collecte n°1 tant qu'elle ne les a pas modifiés (C5). */
export const CHAMPS_SUIVIS = [
  'pax',
  'type_evenement_id',
  'contact_principal',
  'contact_secours',
  'informations_supplementaires',
] as const;
export type ChampSuivi = (typeof CHAMPS_SUIVIS)[number];

export const PLAFOND_PAR_TYPE = 10;

export interface CarteSaisie {
  /** Clé React stable. */
  cle: string;
  type: 'zd' | 'ag';
  date_collecte: string;
  heure_collecte: string;
  /** Texte du champ ; entier de 1 à 100 000 exigé avant l'envoi. */
  pax: string;
  type_evenement_id: string;
  contact_principal: ContactOption | null;
  contact_secours: ContactOption | null;
  informations_supplementaires: string;
  /** Champs suivis que l'utilisateur a modifiés dans cette carte. */
  modifies: ChampSuivi[];
}

let compteur = 0;
const nouvelleCle = (): string => `carte-${Date.now()}-${++compteur}`;

export function carteVide(type: 'zd' | 'ag'): CarteSaisie {
  return {
    cle: nouvelleCle(),
    type,
    date_collecte: '',
    heure_collecte: '',
    pax: '',
    type_evenement_id: '',
    contact_principal: null,
    contact_secours: null,
    informations_supplementaires: '',
    modifies: [],
  };
}

/** La collecte n°1 sert de modèle : Zéro-Déchet #1, ou Anti-Gaspi #1 sans Zéro-Déchet (C5). */
export function indexModele(cartes: readonly CarteSaisie[]): number {
  const zd = cartes.findIndex((c) => c.type === 'zd');
  return zd >= 0 ? zd : cartes.length > 0 ? 0 : -1;
}

/** Valeurs affichées : chaque champ suivi non modifié reprend celui de la collecte n°1. */
export function valeursEffectives(
  cartes: readonly CarteSaisie[],
): CarteSaisie[] {
  const i = indexModele(cartes);
  if (i < 0) return [...cartes];
  const modele = cartes[i]!;
  return cartes.map((c, j) => {
    if (j === i) return c;
    const suite: CarteSaisie = { ...c };
    for (const champ of CHAMPS_SUIVIS) {
      if (!c.modifies.includes(champ)) {
        (suite as unknown as Record<string, unknown>)[champ] = modele[champ];
      }
    }
    return suite;
  });
}

/**
 * Les valeurs affichées deviennent les valeurs propres, et les champs que
 * l'utilisateur a remplis dans la collecte n°1 sont marqués « modifiés » (il
 * les a saisis dans cette carte) : à faire avant tout changement de structure
 * (nombre de cartes, ajout), pour qu'une carte ne change pas de contenu quand
 * la collecte n°1 change.
 */
export function figer(cartes: readonly CarteSaisie[]): CarteSaisie[] {
  const i = indexModele(cartes);
  return valeursEffectives(cartes).map((c, j) =>
    j === i
      ? {
          ...c,
          modifies: CHAMPS_SUIVIS.filter(
            (champ) => c.modifies.includes(champ) || !estVide(c[champ]),
          ),
        }
      : c,
  );
}

const estVide = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Changement de structure : fige les cartes, applique `construire`, puis, si
 * la collecte n°1 a changé (une Zéro Déchet arrive devant des Anti-Gaspi, ou
 * la n°1 est retirée), le nouveau modèle reprend les champs encore vides de
 * l'ancien : les cartes qui suivaient la n°1 gardent leur contenu.
 */
function restructurer(
  cartes: readonly CarteSaisie[],
  construire: (figees: CarteSaisie[]) => CarteSaisie[],
): CarteSaisie[] {
  const i = indexModele(cartes);
  const ancien = i >= 0 ? valeursEffectives(cartes)[i]! : null;
  const res = ranger(construire(figer(cartes)));
  const j = indexModele(res);
  if (!ancien || j < 0 || res[j]!.cle === ancien.cle) return res;
  const modele = { ...res[j]!, modifies: [] as ChampSuivi[] };
  for (const champ of CHAMPS_SUIVIS) {
    if (estVide(modele[champ])) {
      (modele as unknown as Record<string, unknown>)[champ] = ancien[champ];
    }
  }
  return res.map((c, k) => (k === j ? modele : c));
}

/** Cartes rangées : Zéro-Déchet puis Anti-Gaspi, dans l'ordre d'ajout (numérotation par type). */
export function ranger(cartes: readonly CarteSaisie[]): CarteSaisie[] {
  return [
    ...cartes.filter((c) => c.type === 'zd'),
    ...cartes.filter((c) => c.type === 'ag'),
  ];
}

export function nombreParType(
  cartes: readonly CarteSaisie[],
  type: 'zd' | 'ag',
): number {
  return cartes.filter((c) => c.type === type).length;
}

/** Ajuste le nombre de cartes d'un type (écran 1) : ajout en fin, retrait des dernières. */
export function ajusterNombre(
  cartes: readonly CarteSaisie[],
  type: 'zd' | 'ag',
  voulu: number,
): CarteSaisie[] {
  const n = Math.max(0, Math.min(PLAFOND_PAR_TYPE, Math.floor(voulu)));
  return restructurer(cartes, (figees) => {
    const duType = figees.filter((c) => c.type === type);
    const autres = figees.filter((c) => c.type !== type);
    const garde = duType.slice(0, n);
    while (garde.length < n) garde.push(carteVide(type));
    return [...garde, ...autres];
  });
}

/** « Ajouter une collecte » (écran 2) : une carte de plus, qui suit la collecte n°1. */
export function ajouterCarte(
  cartes: readonly CarteSaisie[],
  type: 'zd' | 'ag',
): CarteSaisie[] {
  if (nombreParType(cartes, type) >= PLAFOND_PAR_TYPE) return [...cartes];
  return restructurer(cartes, (figees) => [...figees, carteVide(type)]);
}

/** Modification d'un champ d'une carte : marqué « modifié » hors collecte n°1 (C5). */
export function modifierCarte<K extends keyof CarteSaisie>(
  cartes: readonly CarteSaisie[],
  cle: string,
  champ: K,
  valeur: CarteSaisie[K],
): CarteSaisie[] {
  const i = indexModele(cartes);
  return cartes.map((c, j) => {
    if (c.cle !== cle) return c;
    const suivi = (CHAMPS_SUIVIS as readonly string[]).includes(champ);
    const modifies =
      suivi && j !== i && !c.modifies.includes(champ as ChampSuivi)
        ? [...c.modifies, champ as ChampSuivi]
        : c.modifies;
    return { ...c, [champ]: valeur, modifies };
  });
}

/** Libellé d'une carte : « Collecte Zéro Déchet #2 » (graphie de l'app, D38). */
export function libelleCarte(
  cartes: readonly CarteSaisie[],
  cle: string,
): string {
  const carte = cartes.find((c) => c.cle === cle);
  if (!carte) return '';
  const rang =
    cartes
      .filter((c) => c.type === carte.type)
      .findIndex((c) => c.cle === cle) + 1;
  return `Collecte ${libelleTypeCollecte(carte.type)} #${rang}`;
}

/**
 * Cartes qui ont le même type, la même date et la même heure qu'une autre
 * (C4) : avertissement non bloquant « une seule collecte suffit ». Aucun
 * avertissement si l'heure diffère ou n'est pas encore choisie.
 */
export function clesEnDoublon(cartes: readonly CarteSaisie[]): Set<string> {
  const vus = new Map<string, string[]>();
  for (const c of cartes) {
    if (!c.date_collecte || !c.heure_collecte) continue;
    const k = `${c.type}|${c.date_collecte}|${c.heure_collecte.slice(0, 5)}`;
    vus.set(k, [...(vus.get(k) ?? []), c.cle]);
  }
  return new Set([...vus.values()].filter((l) => l.length > 1).flat());
}

/** Le pax saisi est-il un entier de 1 à PAX_COLLECTE_MAX ? (même règle que la route et la base). */
export function paxSaisiValide(pax: string): boolean {
  const texte = pax.trim();
  return /^[1-9]\d*$/.test(texte) && Number(texte) <= PAX_COLLECTE_MAX;
}

/** Une carte (valeurs affichées) est-elle complète pour être envoyée ? */
export function carteComplete(c: CarteSaisie): boolean {
  return (
    c.date_collecte !== '' &&
    c.heure_collecte !== '' &&
    paxSaisiValide(c.pax) &&
    c.type_evenement_id !== '' &&
    c.contact_principal !== null &&
    c.contact_principal.telephone.trim() !== ''
  );
}

const nomContact = (c: ContactOption): string => `${c.prenom} ${c.nom}`.trim();

/** Corps envoyé à la route pour une carte (valeurs affichées). */
export function carteVersCorps(c: CarteSaisie) {
  return {
    type: c.type,
    date_collecte: c.date_collecte,
    heure_collecte: c.heure_collecte,
    pax: Number.parseInt(c.pax, 10),
    type_evenement_id: c.type_evenement_id,
    contact_principal_nom: c.contact_principal
      ? nomContact(c.contact_principal)
      : '',
    contact_principal_telephone: c.contact_principal?.telephone ?? '',
    contact_secours_nom: c.contact_secours
      ? nomContact(c.contact_secours)
      : null,
    contact_secours_telephone: c.contact_secours?.telephone ?? null,
    informations_supplementaires: c.informations_supplementaires || null,
  };
}

/** Contact déjà enregistré (brouillon, duplication) présenté comme une option du sélecteur. */
export function contactDepuis(
  nom: string | null | undefined,
  telephone: string | null | undefined,
): ContactOption | null {
  if (!nom) return null;
  return { id: '', prenom: '', nom, telephone: telephone ?? '' };
}

/**
 * Cartes d'un brouillon ou d'une duplication : valeurs propres ; une carte qui
 * n'est pas la collecte n°1 ne suit celle-ci que sur les champs égaux.
 */
export function cartesDepuis(
  sources: readonly Omit<CarteSaisie, 'cle' | 'modifies'>[],
): CarteSaisie[] {
  const cartes = ranger(
    sources.map((s) => ({ ...s, cle: nouvelleCle(), modifies: [] })),
  );
  const i = indexModele(cartes);
  if (i < 0) return cartes;
  const modele = cartes[i]!;
  const egal = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  return cartes.map((c, j) =>
    j === i
      ? c
      : {
          ...c,
          modifies: CHAMPS_SUIVIS.filter(
            (champ) => !egal(c[champ], modele[champ]),
          ),
        },
  );
}
