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
 * Couleurs du type de collecte — arbitrage Q1 tranché par Val le 2026-10-07 :
 * **ZD vert, AG navy**, une seule paire pour toutes les formes du badge (et
 * pour les séries ZD/AG des graphes qui codent le type par la couleur).
 * Divergence D59 : le CDC §10 l.140 disait « AG = orange, ZD = navy ».
 * - pastille / badge (listes, référentiel transporteurs) : Badge `success`
 *   (ZD) / `primary` (AG) — `VARIANT_TYPE_COLLECTE` ;
 * - aplat (sur-titre des fiches collecte Admin et client) : ZD success-strong
 *   texte blanc (5,0:1) / AG primary-700 texte blanc — `CLASSES_APLAT_TYPE_COLLECTE`.
 */
export type VarianteTypeCollecte = 'success' | 'primary' | 'neutral';

export const VARIANT_TYPE_COLLECTE: Record<string, VarianteTypeCollecte> = {
  zero_dechet: 'success',
  anti_gaspi: 'primary',
} satisfies Record<TypeCollecte, VarianteTypeCollecte>;

export const CLASSES_APLAT_TYPE_COLLECTE: Record<string, string> = {
  zero_dechet: 'bg-savr-success-strong text-savr-white',
  anti_gaspi: 'bg-savr-primary-700 text-savr-white',
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

export function variantTypeCollecte(
  type: string | null | undefined,
): VarianteTypeCollecte {
  const t = normaliserTypeCollecte(type);
  return (t && VARIANT_TYPE_COLLECTE[t]) || 'neutral';
}
