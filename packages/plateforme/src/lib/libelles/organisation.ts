/**
 * Libellés FR des enums d'organisation / entité de facturation (R-UI-0 B2).
 * Vérification SIRET : enum `statut_verification_siret` (en_attente | verifie | echec).
 */
import type { Database } from '@savr/shared/src/database.types.js';
import type { VarianteBadge as Variant } from './types';

type VerifSiret = Database['plateforme']['Enums']['statut_verification_siret'];
type TypeOrganisation = Database['plateforme']['Enums']['organisation_type'];

/**
 * Type d'organisation (R-UI-2 C8) : une seule graphie par type, alignée sur
 * `LIBELLE_ROLE` (« Gestionnaire de lieux », fin de « Gestionnaire lieux »).
 */
export const LIBELLE_TYPE_ORGANISATION: Record<string, string> = {
  traiteur: 'Traiteur',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire de lieux',
  client_organisateur: 'Client organisateur',
} satisfies Record<TypeOrganisation, string>;

/** Préfixe court « Agence : X » / « Gestionnaire : X » (filtre Programmée par). */
export const LIBELLE_COURT_TYPE_ORGANISATION: Record<string, string> = {
  traiteur: 'Traiteur',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire',
  client_organisateur: 'Client',
} satisfies Record<TypeOrganisation, string>;

export function libelleTypeOrganisation(
  type: string | null | undefined,
): string {
  if (!type) return '—';
  return LIBELLE_TYPE_ORGANISATION[type] ?? type;
}

/** Libellé en cours de phrase (« Programmée par l'agence X ») : minuscule. */
export function libelleTypeOrganisationMinuscule(
  type: string | null | undefined,
): string {
  if (!type) return '—';
  const l = LIBELLE_TYPE_ORGANISATION[type];
  return l ? l.toLowerCase() : type;
}

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
