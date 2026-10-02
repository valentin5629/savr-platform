/**
 * Libellés FR des enums d'organisation / entité de facturation (R-UI-0 B2).
 * Vérification SIRET : enum `statut_verification_siret` (en_attente | verifie | echec).
 */
import type { Database } from '@savr/shared/src/database.types.js';
import type { VarianteBadge as Variant } from './types';

type VerifSiret = Database['plateforme']['Enums']['statut_verification_siret'];

export const LIBELLE_VERIFICATION_SIRET: Record<string, string> = {
  en_attente: 'En attente',
  verifie: 'Vérifié',
  echec: 'Échec',
} satisfies Record<VerifSiret, string>;

export const VARIANT_VERIFICATION_SIRET: Record<string, Variant> = {
  en_attente: 'warning',
  verifie: 'success',
  echec: 'error',
} satisfies Record<VerifSiret, Variant>;

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
