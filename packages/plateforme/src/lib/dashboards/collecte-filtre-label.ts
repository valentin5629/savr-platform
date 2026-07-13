'use client';

// Drill-down « Top listes → liste Collectes filtrée » (dashboards traiteur /
// gestionnaire / agence). Le libellé humain du filtre (nom du lieu, du
// commercial, du traiteur) est passé du dashboard à la liste via sessionStorage
// et JAMAIS par l'URL : un nom de personne / d'organisation n'a pas à transiter
// en query string. L'URL ne porte que l'ID (opaque). La liste réhydrate le
// libellé pour le chip « filtre actif », en le validant contre l'ID courant
// (garde anti-libellé périmé si l'utilisateur édite l'URL à la main).

export type CollecteFiltreKind = 'lieu' | 'commercial' | 'traiteur';

interface StoredLabel {
  kind: CollecteFiltreKind;
  id: string;
  label: string;
}

const KEY = 'savr:collectes-filtre-label';

/** Mémorise le libellé du filtre au clic sur une ligne de Top liste. */
export function setCollecteFiltreLabel(v: StoredLabel): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // sessionStorage indisponible (SSR / mode privé) — le chip retombera sur un
    // libellé générique, le filtrage n'en dépend pas.
  }
}

/**
 * Relit le libellé mémorisé s'il correspond au filtre courant (même type + même
 * ID). Retourne null si absent ou périmé → l'appelant applique un fallback.
 */
export function readCollecteFiltreLabel(
  kind: CollecteFiltreKind,
  id: string,
): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredLabel;
    return v.kind === kind && v.id === id ? v.label : null;
  } catch {
    return null;
  }
}

/** Format court d'une période (bornes ISO) pour le chip, ex. « 13/07/25–13/07/26 ». */
export function periodeCourte(
  from?: string | null,
  to?: string | null,
): string | null {
  if (!from || !to) return null;
  const fmt = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return d && m && y ? `${d}/${m}/${y.slice(2)}` : iso;
  };
  return `${fmt(from)}–${fmt(to)}`;
}
