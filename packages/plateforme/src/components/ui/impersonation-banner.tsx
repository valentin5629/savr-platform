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
      'flex items-center justify-between gap-4 px-4 py-2',
      'bg-savr-accent-500 text-savr-primary-950 text-sm font-medium',
      className,
    )}
  >
    <span className="flex items-center gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      Vous consultez l'espace de <strong className="mx-1">{userName}</strong> en
      mode administrateur
    </span>
    <button
      onClick={onExit}
      className="shrink-0 rounded-savr-md px-3 py-1 text-xs font-semibold bg-savr-primary-950/10 hover:bg-savr-primary-950/20 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-800"
    >
      Quitter l'impersonation
    </button>
  </div>
));
ImpersonationBanner.displayName = 'ImpersonationBanner';

export { ImpersonationBanner };
