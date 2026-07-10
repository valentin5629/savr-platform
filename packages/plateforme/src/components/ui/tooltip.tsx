'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

// Tooltip — info-bulle au survol/focus (§10 §6 « Tooltip » ; §7 état Disabled :
// « bouton grisé + tooltip »). Bâti sur Radix (a11y clavier + ARIA). Fond navy
// profond primary-900, ombre md §4.4, radius md.
const TooltipProvider = TooltipPrimitive.Provider;
const TooltipRoot = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-savr-md bg-savr-primary-900 px-3 py-1.5 text-xs text-savr-white shadow-savr-md',
        className,
      )}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="fill-savr-primary-900" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/**
 * Tooltip — raccourci « content sur un trigger ». Enveloppe l'ensemble
 * Provider/Root/Trigger/Content pour l'usage courant (une bulle sur un élément).
 * Pour un contrôle fin, composer avec les primitives exportées.
 */
interface TooltipProps {
  /** Contenu de la bulle. */
  content: React.ReactNode;
  children: React.ReactNode;
  /** Ouverture contrôlée (tests, ou pilotage manuel). */
  open?: boolean;
  defaultOpen?: boolean;
  side?: React.ComponentPropsWithoutRef<
    typeof TooltipPrimitive.Content
  >['side'];
  delayDuration?: number;
}

function Tooltip({
  content,
  children,
  open,
  defaultOpen,
  side = 'top',
  delayDuration = 200,
}: TooltipProps) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <TooltipRoot open={open} defaultOpen={defaultOpen}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{content}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}

export {
  Tooltip,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
};
