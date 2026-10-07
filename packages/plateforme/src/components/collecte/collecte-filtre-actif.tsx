'use client';

import { X } from 'lucide-react';
import { Text } from '@/components/ui/text';
import { IconButton } from '@/components/ui/icon-button';

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
      <Text as="span" variant="overline" tone="faint">
        Filtre actif
      </Text>
      <span className="inline-flex items-center gap-2 rounded-savr-full bg-savr-primary-50 py-1 pl-3 pr-1 text-sm font-medium text-savr-primary-800">
        <span>
          {label}
          {scope && (
            <span className="ml-1 font-normal text-savr-primary-700/70">
              · {scope}
            </span>
          )}
        </span>
        <IconButton
          size="sm"
          onClick={onClear}
          aria-label="Retirer le filtre"
          className="-my-1.5 rounded-savr-full text-savr-primary-700 hover:bg-savr-primary-100 hover:text-savr-primary-800 [&>svg]:h-4 [&>svg]:w-4"
        >
          <X className="h-4 w-4" aria-hidden />
        </IconButton>
      </span>
    </div>
  );
}
