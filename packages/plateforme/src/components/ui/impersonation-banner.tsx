'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

interface ImpersonationBannerProps {
  userName: string;
  onExit: () => void;
  className?: string;
}

const ImpersonationBanner = React.forwardRef<
  HTMLDivElement,
  ImpersonationBannerProps
>(({ userName, onExit, className }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(
      // Texte centré dans toute la largeur ; bouton « Quitter » ancré à droite
      // (positionné en absolu pour ne pas décentrer le texte).
      'relative flex items-center justify-center gap-2 px-4 py-2',
      'bg-savr-accent-500 text-savr-primary-950 text-sm font-medium',
      className,
    )}
  >
    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
    <span className="text-center">
      Vous consultez l'espace de <strong className="mx-1">{userName}</strong> en
      mode administrateur
    </span>
    <button
      onClick={onExit}
      className="absolute right-4 top-1/2 -translate-y-1/2 shrink-0 rounded-savr-md px-3 py-1 text-xs font-semibold bg-savr-primary-950/10 hover:bg-savr-primary-950/20 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-800"
    >
      Quitter l'impersonation
    </button>
  </div>
));
ImpersonationBanner.displayName = 'ImpersonationBanner';

export { ImpersonationBanner };
