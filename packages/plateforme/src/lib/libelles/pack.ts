/**
 * Libellés et variantes de badge des packs Anti-Gaspi (R-UI-0 B2).
 */
import type { Database } from '@savr/shared/src/database.types.js';
import type { VarianteBadge as Variant } from './types';

type StatutPack = Database['plateforme']['Enums']['pack_statut'];

export const LIBELLE_STATUT_PACK: Record<string, string> = {
  actif: 'Actif',
  epuise: 'Épuisé',
  annule: 'Annulé',
} satisfies Record<StatutPack, string>;

export const VARIANT_STATUT_PACK: Record<string, Variant> = {
  actif: 'success',
  epuise: 'neutral',
  annule: 'error',
} satisfies Record<StatutPack, Variant>;

// `packs_antgaspi.type_pack` est un `text` en DB (pas d'enum) : liste fermée ici.
/** Types de la grille publique (ordre d'affichage, tarifs Paramètres). */
export const TYPES_PACK_GRILLE = [
  'unitaire',
  'pack_10',
  'pack_30',
  'pack_60',
] as const;
/** Types proposés à la création d'un pack (grille + personnalisé). */
export const TYPES_PACK = [...TYPES_PACK_GRILLE, 'personnalise'] as const;
type TypePack = (typeof TYPES_PACK)[number];

/** Libellé court (badges, listes Clients). */
export const LIBELLE_TYPE_PACK: Record<string, string> = {
  unitaire: 'Unitaire',
  pack_10: 'Pack 10',
  pack_30: 'Pack 30',
  pack_60: 'Pack 60',
  personnalise: 'Pack perso',
} satisfies Record<TypePack, string>;

/**
 * Libellé long (options « Type de pack », titres de modale) — graphie de la
 * grille Paramètres > Tarifs AG, reprise par le formulaire « Créer un pack »
 * de la fiche client (qui disait « 10 collectes », « 1 collecte (Unitaire) »).
 */
export const LIBELLE_LONG_TYPE_PACK: Record<string, string> = {
  unitaire: 'Unitaire (1 collecte)',
  pack_10: 'Pack 10 collectes',
  pack_30: 'Pack 30 collectes',
  pack_60: 'Pack 60 collectes',
  personnalise: 'Personnalisé',
} satisfies Record<TypePack, string>;

/** Crédits pré-remplis à la sélection d'un type (personnalisé : saisie libre). */
export const CREDITS_TYPE_PACK: Record<string, number> = {
  unitaire: 1,
  pack_10: 10,
  pack_30: 30,
  pack_60: 60,
} satisfies Record<(typeof TYPES_PACK_GRILLE)[number], number>;

export function libelleStatutPack(statut: string | null | undefined): string {
  if (!statut) return '—';
  return LIBELLE_STATUT_PACK[statut] ?? statut;
}

export function variantStatutPack(statut: string | null | undefined): Variant {
  return (statut && VARIANT_STATUT_PACK[statut]) || 'neutral';
}

export function libelleTypePack(type: string | null | undefined): string {
  if (!type) return '—';
  return LIBELLE_TYPE_PACK[type] ?? type;
}

export function libelleLongTypePack(type: string | null | undefined): string {
  if (!type) return '—';
  return LIBELLE_LONG_TYPE_PACK[type] ?? type;
}
