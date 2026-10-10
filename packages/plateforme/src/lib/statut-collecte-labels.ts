import type { Database } from '@savr/shared/src/database.types.js';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * Libellés d'affichage du statut d'une collecte (UX uniquement — la table garde
 * les valeurs d'enum DB). Deux vues (décision Val 2026-06-30) :
 *
 * - `admin`  : granularité complète. L'enum DB `programmee` s'y lit en deux
 *   temps (décision Val 2026-10-07) : « Créée » tant que la demande n'est pas
 *   partie vers le prestataire, « Programmée » ensuite — la clé d'affichage est
 *   résolue par `statutCollecteAdmin` (lib/statut-collecte-admin). Un brouillon
 *   n'apparaît pas côté Admin ; son libellé « Brouillon » n'est qu'un repli.
 * - `client` : vue simplifiée pour les rôles non-admin (traiteur, agence,
 *   gestionnaire de lieux, client organisateur). Jamais « Programmée » ;
 *   « Réalisée » à `cloturee` ; le rejet prestataire est masqué (affiché
 *   « Créée », sujet interne Ops).
 *
 * « Sans excédent » n'est pas un statut d'avancement (décision Val 2026-10-09) :
 * une collecte AG `realisee_sans_collecte` s'affiche « Réalisée » dans les deux
 * vues. Qu'elle n'ait rien donné est un RÉSULTAT, affiché là où se lisent les
 * repas d'une collecte AG (`LIBELLE_SANS_EXCEDENT`).
 */
/** Statut d'une collecte = enum DB `collecte_statut` (type unique, R-UI-2 C1). */
export type StatutCollecteDb =
  Database['plateforme']['Enums']['collecte_statut'];

/**
 * Statut AFFICHÉ côté Admin : l'enum DB, plus « Créée » (`creee`) pour une
 * collecte `programmee` dont la demande n'est pas encore partie. Ici
 * `programmee` veut donc dire « demande envoyée au prestataire ».
 */
export type StatutCollecteAdmin = StatutCollecteDb | 'creee';

export type VueStatut = 'admin' | 'client';

type Variant = NonNullable<BadgeProps['variant']>;

export interface StatutDisplay {
  label: string;
  variant: Variant;
}

// Vue admin — granularité métier complète, par clé d'affichage Admin.
const ADMIN: Record<StatutCollecteAdmin, StatutDisplay> = {
  brouillon: { label: 'Brouillon', variant: 'neutral' },
  creee: { label: 'Créée', variant: 'neutral' },
  programmee: { label: 'Programmée', variant: 'neutral' },
  validee: { label: 'Validée', variant: 'primary' },
  en_cours: { label: 'En cours', variant: 'info' },
  realisee: { label: 'Réalisée', variant: 'success' },
  realisee_sans_collecte: { label: 'Réalisée', variant: 'success' },
  cloturee: { label: 'Clôturée', variant: 'neutral' },
  annulation_demandee: { label: 'Annulation demandée', variant: 'error' },
  annulee: { label: 'Annulée', variant: 'error' },
  rejetee_par_prestataire: { label: 'Rejetée', variant: 'error' },
};

// Vue client (non-admin) — collapse 2026-06-30 (Val) :
//   brouillon, programmee, rejetee_par_prestataire → « Créée »
//   realisee → « En cours » (« Réalisée » réservé à cloturee)
const CLIENT: Record<StatutCollecteDb, StatutDisplay> = {
  brouillon: { label: 'Créée', variant: 'neutral' },
  programmee: { label: 'Créée', variant: 'neutral' },
  validee: { label: 'Validée', variant: 'primary' },
  en_cours: { label: 'En cours', variant: 'info' },
  realisee: { label: 'En cours', variant: 'info' },
  realisee_sans_collecte: { label: 'Réalisée', variant: 'success' },
  cloturee: { label: 'Réalisée', variant: 'success' },
  annulation_demandee: { label: 'Annulée', variant: 'error' },
  annulee: { label: 'Annulée', variant: 'error' },
  rejetee_par_prestataire: { label: 'Créée', variant: 'neutral' },
};

/**
 * Résultat d'une collecte AG `realisee_sans_collecte`, affiché à la place des
 * repas donnés : colonne « Indicateurs » de la liste Admin, colonne
 * « Résultats » des listes client, fiche Admin (décision Val 2026-10-09).
 */
export const LIBELLE_SANS_EXCEDENT = 'Sans excédent';

/**
 * Libellés du statut collecte pour les exports CSV : vue admin (granularité
 * complète), dérivés du mapping canonique ci-dessus (R-UI-2 C1).
 */
export const LIBELLE_STATUT_COLLECTE: Record<StatutCollecteAdmin, string> =
  Object.fromEntries(
    Object.entries(ADMIN).map(([statut, d]) => [statut, d.label]),
  ) as Record<StatutCollecteAdmin, string>;

/**
 * Parcours nominal d'une collecte côté Admin — étapes des frises et timelines :
 * creee → programmee → validee → en_cours → realisee → cloturee. Les deux
 * premières étapes sont le même statut DB `programmee` (machine à états §05),
 * avant puis après l'envoi de la demande au prestataire.
 */
export const ETAPES_STATUT_COLLECTE = [
  'creee',
  'programmee',
  'validee',
  'en_cours',
  'realisee',
  'cloturee',
] as const satisfies readonly StatutCollecteAdmin[];

/**
 * Rang de chaque statut sur le parcours nominal (1 = creee … 6 = cloturee ;
 * 0 = hors parcours : brouillon, annulation, rejet). `realisee_sans_collecte`
 * (AG sans excédent) occupe le rang de `realisee`, sous le même libellé.
 */
export const RANG_STATUT_COLLECTE: Record<StatutCollecteAdmin, number> = {
  brouillon: 0,
  creee: 1,
  programmee: 2,
  validee: 3,
  en_cours: 4,
  realisee: 5,
  realisee_sans_collecte: 5,
  cloturee: 6,
  annulation_demandee: 0,
  annulee: 0,
  rejetee_par_prestataire: 0,
};

/**
 * Résout (label, variant Badge) selon la vue : un statut DB en vue client, une
 * clé d'affichage Admin (`statutCollecteAdmin`) en vue admin. Statut inconnu
 * (ne devrait pas arriver, enum fermé) → neutre avec la valeur brute (défensif).
 */
export function statutCollecteDisplay(
  statut: string,
  vue: VueStatut = 'admin',
): StatutDisplay {
  const map: Partial<Record<string, StatutDisplay>> =
    vue === 'client' ? CLIENT : ADMIN;
  return map[statut] ?? { label: statut, variant: 'neutral' };
}

/**
 * Groupes de statuts pour le filtre « Statut » des listes CLIENT (§06.04 §3).
 *
 * En vue client plusieurs statuts DB partagent un libellé (« Créée » =
 * brouillon + programmee + rejetee_par_prestataire ; « En cours » = en_cours +
 * realisee ; « Réalisée » = realisee_sans_collecte + cloturee ; « Annulée » =
 * annulation_demandee + annulee). Le filtre doit donc
 * proposer les LIBELLÉS affichés — l'utilisateur ne voit jamais « Programmée » —
 * et chaque libellé retenu se traduit par l'ensemble des statuts DB qu'il couvre.
 *
 * Les groupes sont dérivés du mapping canonique CLIENT (source unique) et bornés
 * aux statuts réellement présents dans l'onglet courant, dans leur ordre d'entrée.
 */
export function groupesStatutClient(
  statutsDisponibles: readonly string[],
): { label: string; statuts: string[] }[] {
  const groupes: { label: string; statuts: string[] }[] = [];
  for (const statut of statutsDisponibles) {
    const { label } = statutCollecteDisplay(statut, 'client');
    const existant = groupes.find((g) => g.label === label);
    if (existant) existant.statuts.push(statut);
    else groupes.push({ label, statuts: [statut] });
  }
  return groupes;
}

export interface EtapeFriseClient {
  label: string;
  etat: 'passee' | 'courante' | 'a_venir';
}

// Rang de chaque statut DB sur la frise client : Créée(0) · Validée(1) ·
// En cours(2) · Réalisée(3).
const RANG_FRISE_CLIENT: Record<string, number> = {
  brouillon: 0,
  programmee: 0,
  rejetee_par_prestataire: 0,
  validee: 1,
  en_cours: 2,
  realisee: 2,
  cloturee: 3,
  realisee_sans_collecte: 3,
};

/**
 * Frise de statut de la fiche collecte CLIENT (§06.04 refonte pop-up, décision
 * Val 2026-09-29, Q1) — vocabulaire client uniquement, dérivé du mapping
 * canonique ci-dessus (jamais « Programmée » ni « Clôturée ») :
 *  · parcours : Créée · Validée · En cours · Réalisée (une collecte AG sans
 *    excédent s'y lit « Réalisée » comme les autres, décision Val 2026-10-09) ;
 *  · collecte annulée : Créée · Annulée (étape courante « Annulée »).
 */
export function friseStatutClient(statut: string): EtapeFriseClient[] {
  const label = (s: StatutCollecteDb) =>
    statutCollecteDisplay(s, 'client').label;
  if (statut === 'annulee' || statut === 'annulation_demandee') {
    return [
      { label: label('programmee'), etat: 'passee' },
      { label: label('annulee'), etat: 'courante' },
    ];
  }
  const courant = RANG_FRISE_CLIENT[statut] ?? 0;
  const etapes = [
    label('programmee'),
    label('validee'),
    label('en_cours'),
    label('cloturee'),
  ];
  return etapes.map((l, i) => ({
    label: l,
    etat: i < courant ? 'passee' : i === courant ? 'courante' : 'a_venir',
  }));
}
