/**
 * Libellés FR des enums de facturation (R-UI-0 B2 — amorce de `lib/libelles/`,
 * complétée par R-UI-2). Fallback = valeur brute, jamais une chaîne vide.
 */

export const LIBELLE_STATUT_FACTURE: Record<string, string> = {
  brouillon: 'Brouillon',
  en_attente_pennylane: 'En attente Pennylane',
  emise: 'Émise',
  payee: 'Payée',
  annulee: 'Annulée',
};

export const LIBELLE_TYPE_FACTURE: Record<string, string> = {
  zero_dechet: 'Zéro Déchet',
  achat_pack_antigaspi: 'Achat pack Anti-Gaspi',
  collecte_antigaspi: 'Collecte Anti-Gaspi',
  avoir: 'Avoir',
};

export function libelleStatutFacture(
  statut: string | null | undefined,
): string {
  if (!statut) return '—';
  return LIBELLE_STATUT_FACTURE[statut] ?? statut;
}
