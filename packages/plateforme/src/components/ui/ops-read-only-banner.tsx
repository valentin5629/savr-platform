import * as React from 'react';
import { LockSimpleIcon } from '@/components/ui/icones';

/**
 * Bandeau « Lecture seule — édition réservée admin » (texte exact CDC §06 l.26).
 * Affiché aux rôles staff en lecture seule (`ops_savr`) sur les écrans dont
 * l'écriture est réservée à `admin_savr` (§9 Paramètres : « Toutes les
 * sous-sections sont admin-only en écriture »). La sécurité réelle reste côté
 * serveur (`requireAdmin` → 403) ; ce bandeau ne fait que refléter le droit.
 */
export function OpsReadOnlyBanner(): React.ReactElement {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-savr-warning-subtle bg-savr-warning-subtle px-4 py-2.5 text-sm text-savr-warning-strong">
      <LockSimpleIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>Lecture seule — édition réservée admin.</span>
    </div>
  );
}
