/**
 * Libellés FR des enums d'organisation / entité de facturation (R-UI-0 B2).
 * Vérification SIRET : enum `statut_verification_siret` (en_attente | verifie | echec).
 */
import type { BadgeProps } from '@/components/ui/badge';

type Variant = NonNullable<BadgeProps['variant']>;

export const LIBELLE_VERIFICATION_SIRET: Record<string, string> = {
  en_attente: 'En attente',
  verifie: 'Vérifié',
  echec: 'Échec',
};

export const VARIANT_VERIFICATION_SIRET: Record<string, Variant> = {
  en_attente: 'warning',
  verifie: 'success',
  echec: 'error',
};

export function libelleVerificationSiret(
  statut: string | null | undefined,
): string {
  if (!statut) return '—';
  return LIBELLE_VERIFICATION_SIRET[statut] ?? statut;
}

export function variantVerificationSiret(
  statut: string | null | undefined,
): Variant {
  return (statut && VARIANT_VERIFICATION_SIRET[statut]) || 'neutral';
}
