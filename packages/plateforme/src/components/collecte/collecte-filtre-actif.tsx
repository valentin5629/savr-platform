'use client';

import { X } from 'lucide-react';

interface Props {
  /** Libellé complet du filtre, ex. « Lieu : Le Pavillon ». */
  label: string;
  /** Périmètre appliqué (ex. « clôturées · 13/07/25–13/07/26 ») — rend visible
   *  le fait que la liste reflète exactement le chiffre du dashboard. */
  scope?: string;
  /** Retire le filtre (efface le paramètre d'URL + le libellé mémorisé). */
  onClear: () => void;
}

/**
 * Chip « filtre actif » affiché en tête d'une liste Collectes quand on arrive
 * depuis une Top liste de dashboard (drill-down lieu / commercial / traiteur).
 * Rend le filtre visible et réversible (§ Design System — tokens, cible 44px).
 */
export function CollecteFiltreActif({ label, scope, onClear }: Props) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="filtre-actif"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-savr-neutral-400">
        Filtre actif
      </span>
      <span className="inline-flex items-center gap-2 rounded-savr-full bg-savr-primary-50 py-1 pl-3 pr-1 text-sm font-medium text-savr-primary-800">
        <span>
          {label}
          {scope && (
            <span className="ml-1 font-normal text-savr-primary-700/70">
              · {scope}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Retirer le filtre"
          className="flex h-6 w-6 items-center justify-center rounded-savr-full text-savr-primary-700 transition-colors hover:bg-savr-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-savr-primary-400"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </span>
    </div>
  );
}
