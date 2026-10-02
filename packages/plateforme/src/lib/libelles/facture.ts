/**
 * Libellés FR des enums de facturation (R-UI-0 B2 — amorce de `lib/libelles/`,
 * complétée par R-UI-2). Fallback = valeur brute, jamais une chaîne vide.
 */
import type { Database } from '@savr/shared/src/database.types.js';

type Enums = Database['plateforme']['Enums'];

// `satisfies` : une valeur d'enum ajoutée en DB sans libellé casse le typecheck
// (sinon elle retomberait silencieusement sur la valeur brute = bug B2).
export const LIBELLE_STATUT_FACTURE: Record<string, string> = {
  brouillon: 'Brouillon',
  en_attente_pennylane: 'En attente Pennylane',
  emise: 'Émise',
  payee: 'Payée',
  annulee: 'Annulée',
} satisfies Record<Enums['facture_statut'], string>;

export const LIBELLE_TYPE_FACTURE: Record<string, string> = {
  zero_dechet: 'Zéro Déchet',
  achat_pack_antigaspi: 'Achat pack Anti-Gaspi',
  collecte_antigaspi: 'Collecte Anti-Gaspi',
  avoir: 'Avoir',
} satisfies Record<Enums['facture_type'], string>;

export function libelleStatutFacture(
  statut: string | null | undefined,
): string {
  if (!statut) return '—';
  return LIBELLE_STATUT_FACTURE[statut] ?? statut;
}
