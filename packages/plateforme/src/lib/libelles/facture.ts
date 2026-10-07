/**
 * Libellés FR des enums de facturation (R-UI-0 B2 — amorce de `lib/libelles/`,
 * complétée par R-UI-2 C3/C4). Fallback = valeur brute, jamais une chaîne vide.
 */
import type { Database } from '@savr/shared/src/database.types.js';
import type { VarianteBadge as Variant } from './types';
import { LIBELLE_TYPE_COLLECTE } from './type-collecte';

type Enums = Database['plateforme']['Enums'];
type StatutFacture = Enums['facture_statut'];
type TypeFacture = Enums['facture_type'];

// `satisfies` : une valeur d'enum ajoutée en DB sans libellé casse le typecheck
// (sinon elle retomberait silencieusement sur la valeur brute = bug B2).
// `en_attente_pennylane` : « En attente Pennylane » = graphie majoritaire
// (fiche facture, Mon organisation ×3, fiche collecte, pastille filtre, exports)
// contre « En attente » (liste Factures, onglet Factures client, options de
// filtre) — arbitrage Q12 OUVERT.
export const LIBELLE_STATUT_FACTURE: Record<string, string> = {
  brouillon: 'Brouillon',
  en_attente_pennylane: 'En attente Pennylane',
  emise: 'Émise',
  payee: 'Payée',
  annulee: 'Annulée',
} satisfies Record<StatutFacture, string>;

/** Pastilles de filtre au pluriel (liste Factures Admin). */
export const LIBELLE_STATUT_FACTURE_PLURIEL: Record<string, string> = {
  brouillon: 'Brouillons',
  en_attente_pennylane: 'En attente Pennylane',
  emise: 'Émises',
  payee: 'Payées',
  annulee: 'Annulées',
} satisfies Record<StatutFacture, string>;

export const VARIANT_STATUT_FACTURE: Record<string, Variant> = {
  brouillon: 'neutral',
  en_attente_pennylane: 'warning',
  emise: 'info',
  payee: 'success',
  annulee: 'error',
} satisfies Record<StatutFacture, Variant>;

/** Ordre d'affichage des statuts (cycle de vie). */
export const STATUTS_FACTURE = [
  'brouillon',
  'en_attente_pennylane',
  'emise',
  'payee',
  'annulee',
] as const satisfies readonly StatutFacture[];

// Type long (fiche facture, filtre Admin, exports) : ZD aligné sur le type de
// collecte ; « Achat Pack AG » / « Anti-Gaspi » = graphies majoritaires (fiche
// facture + filtre Admin) contre « Achat pack Anti-Gaspi » / « Collecte
// Anti-Gaspi » (exports CSV seuls).
export const LIBELLE_TYPE_FACTURE: Record<string, string> = {
  zero_dechet: LIBELLE_TYPE_COLLECTE.zero_dechet!,
  collecte_antigaspi: LIBELLE_TYPE_COLLECTE.anti_gaspi!,
  achat_pack_antigaspi: 'Achat Pack AG',
  avoir: 'Avoir',
} satisfies Record<TypeFacture, string>;

/** Type court (colonne Type des listes, filtres Mon organisation). */
export const LIBELLE_COURT_TYPE_FACTURE: Record<string, string> = {
  zero_dechet: 'ZD',
  collecte_antigaspi: 'AG',
  achat_pack_antigaspi: 'Pack',
  avoir: 'Avoir',
} satisfies Record<TypeFacture, string>;

export const TYPES_FACTURE = [
  'zero_dechet',
  'collecte_antigaspi',
  'achat_pack_antigaspi',
  'avoir',
] as const satisfies readonly TypeFacture[];

export function libelleStatutFacture(
  statut: string | null | undefined,
): string {
  if (!statut) return '—';
  return LIBELLE_STATUT_FACTURE[statut] ?? statut;
}

export function variantStatutFacture(
  statut: string | null | undefined,
): Variant {
  return (statut && VARIANT_STATUT_FACTURE[statut]) || 'neutral';
}

export function libelleTypeFacture(type: string | null | undefined): string {
  if (!type) return '—';
  return LIBELLE_TYPE_FACTURE[type] ?? type;
}

export function libelleCourtTypeFacture(
  type: string | null | undefined,
): string {
  if (!type) return '—';
  return LIBELLE_COURT_TYPE_FACTURE[type] ?? type;
}

/**
 * Options `{ id, nom }` d'un filtre à cocher, ids typés par l'enum DB (un
 * renommage d'enum casse la compilation au lieu de devenir un filtre ignoré).
 */
export function optionsStatutFacture<S extends StatutFacture = StatutFacture>(
  statuts: readonly S[] = STATUTS_FACTURE as readonly StatutFacture[] as readonly S[],
): { id: S; nom: string }[] {
  return statuts.map((id) => ({ id, nom: LIBELLE_STATUT_FACTURE[id]! }));
}

export function optionsTypeFacture(
  forme: 'long' | 'court' = 'long',
): { id: TypeFacture; nom: string }[] {
  const libelles =
    forme === 'court' ? LIBELLE_COURT_TYPE_FACTURE : LIBELLE_TYPE_FACTURE;
  return TYPES_FACTURE.map((id) => ({ id, nom: libelles[id]! }));
}
