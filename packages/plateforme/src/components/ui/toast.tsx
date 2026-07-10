'use client';

import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Bell,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Toast — notification temporaire (§10 §6 « Toast » ; §7 état Success :
// « Toast (disparaît après 4s) »). Bâti sur Radix (a11y : aria-live, focus,
// swipe). Carte blanche + icône sémantique, ombre lg §4.4, auto-dismiss 4s.
export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral';

const VARIANT_ICON: Record<
  ToastVariant,
  React.ComponentType<{ className?: string }>
> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  neutral: Bell,
};

const VARIANT_ICON_COLOR: Record<ToastVariant, string> = {
  success: 'text-savr-success-strong',
  error: 'text-savr-error-strong',
  warning: 'text-savr-warning-strong',
  info: 'text-savr-info-strong',
  neutral: 'text-savr-neutral-500',
};

export interface ToastOptions {
  title?: string;
  description?: React.ReactNode;
  variant?: ToastVariant;
  /** Durée d'affichage en ms. Défaut 4000 (§7). */
  duration?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
  open: boolean;
}

const ToastContext = React.createContext<{
  toast: (options: ToastOptions) => void;
} | null>(null);

/** Élément Radix Toast stylé Savr (rendu par le provider). */
function ToastItem({
  entry,
  onOpenChange,
}: {
  entry: ToastEntry;
  onOpenChange: (open: boolean) => void;
}) {
  const variant = entry.variant ?? 'neutral';
  const Icon = VARIANT_ICON[variant];
  return (
    <ToastPrimitive.Root
      open={entry.open}
      onOpenChange={onOpenChange}
      duration={entry.duration ?? 4000}
      className={cn(
        'flex items-start gap-3 rounded-savr-md border border-savr-neutral-200 bg-savr-white p-4 shadow-savr-lg',
        'transition-[opacity,transform] duration-200 ease-out',
        'data-[state=closed]:opacity-0 data-[swipe=end]:opacity-0',
      )}
    >
      <Icon
        className={cn('mt-0.5 h-5 w-5 shrink-0', VARIANT_ICON_COLOR[variant])}
      />
      <div className="min-w-0 flex-1">
        {entry.title && (
          <ToastPrimitive.Title className="text-sm font-semibold text-savr-neutral-900">
            {entry.title}
          </ToastPrimitive.Title>
        )}
        {entry.description && (
          <ToastPrimitive.Description className="mt-0.5 text-sm text-savr-neutral-600">
            {entry.description}
          </ToastPrimitive.Description>
        )}
      </div>
      <ToastPrimitive.Close
        aria-label="Fermer"
        className="shrink-0 rounded-savr-sm text-savr-neutral-400 transition-colors hover:text-savr-neutral-700"
      >
        <X className="h-4 w-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

/**
 * ToastProvider — fournit `useToast().toast(...)` et rend le viewport (coin
 * bas-droite desktop, pleine largeur bas mobile §8). À monter une fois au niveau
 * layout.
 */
function ToastProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = React.useState<ToastEntry[]>([]);
  const counter = React.useRef(0);

  const toast = React.useCallback((options: ToastOptions) => {
    const id = counter.current++;
    setEntries((prev) => [...prev, { ...options, id, open: true }]);
  }, []);

  const setOpen = React.useCallback((id: number, open: boolean) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, open } : e)));
    if (!open) {
      // Purge différée (laisse jouer l'animation de sortie).
      setTimeout(
        () => setEntries((prev) => prev.filter((e) => e.id !== id)),
        200,
      );
    }
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {entries.map((entry) => (
          <ToastItem
            key={entry.id}
            entry={entry}
            onOpenChange={(open) => setOpen(entry.id, open)}
          />
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none max-sm:max-w-full" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx)
    throw new Error('useToast doit être utilisé dans un <ToastProvider>.');
  return ctx;
}

export { ToastProvider, useToast };
