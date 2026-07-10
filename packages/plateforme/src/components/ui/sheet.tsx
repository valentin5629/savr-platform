'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Sheet — panneau latéral / montant (§10 §6 « Modal / Sheet » ; §8 « Modals sur
// mobile → Sheet panel montant depuis le bas »). Même mécanique que `Modal`
// (overlay navy, fermeture Esc + clic overlay, focus-trap, scroll-lock), mais
// glisse depuis un bord. Le <h2> du titre est enfant DIRECT du panneau
// role="dialog" (cohérence tests, cf. Modal).
type SheetSide = 'right' | 'left' | 'bottom';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Bord d'apparition. Défaut 'right' (desktop) ; 'bottom' pour le mobile (§8). */
  side?: SheetSide;
  footer?: React.ReactNode;
  className?: string;
}

const SIDE_CLOSED: Record<SheetSide, string> = {
  right: 'translate-x-full',
  left: '-translate-x-full',
  bottom: 'translate-y-full',
};

const SIDE_LAYOUT: Record<SheetSide, string> = {
  right: 'inset-y-0 right-0 h-full w-full max-w-md rounded-l-savr-lg',
  left: 'inset-y-0 left-0 h-full w-full max-w-md rounded-r-savr-lg',
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-savr-lg',
};

const Sheet = ({
  open,
  title,
  onClose,
  children,
  side = 'right',
  footer,
  className,
}: SheetProps) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const [show, setShow] = React.useState(false);

  // onClose lu via ref pour que l'effet ne dépende QUE de `open` (cf. Modal :
  // évite le vol de focus à chaque frappe dans un champ du panneau).
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });

  React.useEffect(() => {
    if (!open) {
      setShow(false);
      return;
    }
    const raf = requestAnimationFrame(() => setShow(true));
    const focusTimer = setTimeout(() => panelRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(13,20,40,0.45)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn(
          'fixed flex flex-col bg-savr-white shadow-savr-lg outline-none',
          'transition-transform duration-[320ms] ease-out',
          SIDE_LAYOUT[side],
          show ? 'translate-x-0 translate-y-0' : SIDE_CLOSED[side],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-savr-neutral-100 px-6 py-4">
          <h2
            id={titleId}
            className="text-lg font-bold tracking-[-0.01em] text-savr-neutral-900"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-savr-md text-savr-neutral-400 transition-colors hover:bg-savr-neutral-100 hover:text-savr-neutral-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-savr-neutral-100 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
Sheet.displayName = 'Sheet';

export { Sheet };
