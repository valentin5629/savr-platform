/**
 * Libellés et couleurs du type de collecte (enum `collecte_type`) — R-UI-2 C2.
 * Source unique des 3 formes de libellé :
 * - long  « Zéro Déchet » / « Anti-Gaspi » (graphie affichée dans l'app, celle
 *   des segmentés ; le CDC écrit « Zéro-Déchet » — divergence D38 en attente
 *   d'arbitrage Val, ne pas trancher ici) ;
 * - court « ZD » / « AG » (badges de liste, colonnes étroites) ;
 * - complet « Zéro Déchet (ZD) » / « Anti-Gaspi (AG) » (options).
 * Les alias UI du formulaire de programmation (`zd` / `ag`) sont tolérés.
 */
import type { Database } from '@savr/shared/src/database.types.js';
import type { VarianteBadge as Variant } from './types';

type TypeCollecte = Database['plateforme']['Enums']['collecte_type'];

export const LIBELLE_TYPE_COLLECTE: Record<string, string> = {
  zero_dechet: 'Zéro Déchet',
  anti_gaspi: 'Anti-Gaspi',
} satisfies Record<TypeCollecte, string>;

/**
 * Graphie du CDC (« Zéro-Déchet », §12 l.287) — gardée là où elle était déjà
 * affichée avant R-UI-2 (export synthèse PDF : modale et ligne de filtre).
 * D38 OUVERT : l'app affiche « Zéro Déchet », les exports synthèse
 * « Zéro-Déchet » ; une seule des deux maps survivra à l'arbitrage.
 */
export const LIBELLE_TYPE_COLLECTE_CDC: Record<string, string> = {
  zero_dechet: 'Zéro-Déchet',
  anti_gaspi: 'Anti-Gaspi',
} satisfies Record<TypeCollecte, string>;

export const LIBELLE_COURT_TYPE_COLLECTE: Record<string, string> = {
  zero_dechet: 'ZD',
  anti_gaspi: 'AG',
} satisfies Record<TypeCollecte, string>;

/**
 * Couleurs du badge de type — arbitrage Q1 OUVERT : DEUX codes couleur
 * cohabitent, tous deux tenus ici en attendant l'arbitrage.
 * - pastille (listes Collectes Admin / gestionnaire / historique, onglet
 *   Collectes de la fiche client) : ZD vert `success` / AG ambre `warning` —
 *   `VARIANT_TYPE_COLLECTE` ;
 * - badge CDC (liste Transporteurs) : ZD navy `primary` / AG orange `action`,
 *   sans icône — `VARIANT_CDC_TYPE_COLLECTE` (conforme §10 l.140) ;
 * - aplat (sur-titre des fiches collecte Admin et client, §06.04 Q2 / §06.06) :
 *   ZD navy primary-700 texte blanc / AG orange accent-500 texte primary-950 —
 *   `CLASSES_APLAT_TYPE_COLLECTE`.
 * Option (a) §2.4 : ZD navy / AG orange partout ; option (b) : vert / ambre.
 */
export const VARIANT_TYPE_COLLECTE: Record<string, Variant> = {
  zero_dechet: 'success',
  anti_gaspi: 'warning',
} satisfies Record<TypeCollecte, Variant>;

export const VARIANT_CDC_TYPE_COLLECTE: Record<string, 'primary' | 'action'> = {
  zero_dechet: 'primary',
  anti_gaspi: 'action',
} satisfies Record<TypeCollecte, 'primary' | 'action'>;

export const CLASSES_APLAT_TYPE_COLLECTE: Record<string, string> = {
  zero_dechet: 'bg-savr-primary-700 text-savr-white',
  anti_gaspi: 'bg-savr-accent-500 text-savr-primary-950',
} satisfies Record<TypeCollecte, string>;

/** Classes de l'aplat (fiches collecte) ; type inconnu → aplat ZD (rendu historique). */
export function classesAplatTypeCollecte(
  type: string | null | undefined,
): string {
  const t = normaliserTypeCollecte(type);
  return (
    (t && CLASSES_APLAT_TYPE_COLLECTE[t]) ||
    CLASSES_APLAT_TYPE_COLLECTE.zero_dechet!
  );
}

/** Ordre d'affichage (options, listes) : ZD puis AG. */
export const TYPES_COLLECTE = [
  'zero_dechet',
  'anti_gaspi',
] as const satisfies readonly TypeCollecte[];

const ALIAS: Record<string, TypeCollecte> = {
  zd: 'zero_dechet',
  ag: 'anti_gaspi',
};

/** Valeur d'enum à partir de l'enum DB ou d'un alias UI (`zd` / `ag`). */
export function normaliserTypeCollecte(
  type: string | null | undefined,
): string | null {
  if (!type) return null;
  return ALIAS[type] ?? type;
}

export function libelleTypeCollecte(type: string | null | undefined): string {
  const t = normaliserTypeCollecte(type);
  if (!t) return '—';
  return LIBELLE_TYPE_COLLECTE[t] ?? t;
}

export function libelleCourtTypeCollecte(
  type: string | null | undefined,
): string {
  const t = normaliserTypeCollecte(type);
  if (!t) return '—';
  return LIBELLE_COURT_TYPE_COLLECTE[t] ?? t;
}

/** Graphie CDC « Zéro-Déchet » (exports synthèse, D38 ouvert). */
export function libelleCdcTypeCollecte(
  type: string | null | undefined,
): string {
  const t = normaliserTypeCollecte(type);
  if (!t) return '—';
  return LIBELLE_TYPE_COLLECTE_CDC[t] ?? t;
}

/** « Zéro Déchet (ZD) » / « Anti-Gaspi (AG) » (`graphie: 'cdc'` → « Zéro-Déchet (ZD) »). */
export function libelleCompletTypeCollecte(
  type: string | null | undefined,
  graphie: 'app' | 'cdc' = 'app',
): string {
  const t = normaliserTypeCollecte(type);
  if (!t) return '—';
  const long = (
    graphie === 'cdc' ? LIBELLE_TYPE_COLLECTE_CDC : LIBELLE_TYPE_COLLECTE
  )[t];
  return long ? `${long} (${LIBELLE_COURT_TYPE_COLLECTE[t]})` : t;
}

export function variantTypeCollecte(type: string | null | undefined): Variant {
  const t = normaliserTypeCollecte(type);
  return (t && VARIANT_TYPE_COLLECTE[t]) || 'neutral';
}
