/**
 * Libellés et variantes de badge des packs Anti-Gaspi (R-UI-0 B2).
 */
import type { BadgeProps } from '@/components/ui/badge';

type Variant = NonNullable<BadgeProps['variant']>;

export const LIBELLE_STATUT_PACK: Record<string, string> = {
  actif: 'Actif',
  epuise: 'Épuisé',
  annule: 'Annulé',
};

export const VARIANT_STATUT_PACK: Record<string, Variant> = {
  actif: 'success',
  epuise: 'neutral',
  annule: 'error',
};

export const LIBELLE_TYPE_PACK: Record<string, string> = {
  unitaire: 'Unitaire',
  pack_10: 'Pack 10',
  pack_30: 'Pack 30',
  pack_60: 'Pack 60',
  personnalise: 'Pack perso',
};

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
