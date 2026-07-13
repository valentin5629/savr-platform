'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Contenu du pied (boutons d'action), aligné à droite. */
  footer?: React.ReactNode;
  /** Panneau élargi (max-w-3xl au lieu de max-w-lg). */
  wide?: boolean;
  className?: string;
}

// Modal — dialogue centré (§10 §6 « Modal », radius-lg + shadow-lg). Overlay
// navy translucide, fermeture Esc + clic overlay, focus trap léger, animation
// « pop » (opacity + translation) sans keyframe globale (globals.css inchangé).
// §10 ne spécifie pas la structure header/body/footer → divergence tracée.
//
// IMPORTANT (compat tests) : le <h2> du titre est un enfant DIRECT du panneau
// `role="dialog"`, qui contient aussi le pied → `getByText(titre).closest('div')`
// résout le panneau entier (bouton de confirmation inclus).
const Modal = ({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  className,
}: ModalProps) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const [show, setShow] = React.useState(false);

  // onClose est souvent une fonction inline (nouvelle identité à chaque render).
  // On la lit via une ref pour que l'effet ci-dessous ne dépende QUE de `open` —
  // sinon il se relancerait à chaque frappe dans un champ de la modale et volerait
  // le focus (panelRef.focus()), rendant la saisie impossible (1 lettre à la fois).
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(13,20,40,0.45)] p-4"
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
          // Colonne flex bornée à 90vh : en-tête/pied fixes, corps défilable —
          // un contenu long (ex. modale CO₂ méthode) ne déborde plus l'écran.
          'relative flex max-h-[90vh] w-full flex-col rounded-savr-lg bg-savr-white shadow-savr-lg outline-none',
          'transition-[opacity,transform] duration-200 ease-out',
          show ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
          wide ? 'max-w-3xl' : 'max-w-lg',
          className,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-savr-md text-savr-neutral-400 transition-colors hover:bg-savr-neutral-100 hover:text-savr-neutral-700"
        >
          <X className="h-4 w-4" />
        </button>
        <h2
          id={titleId}
          className="shrink-0 px-6 pr-14 pt-6 text-lg font-bold tracking-[-0.01em] text-savr-neutral-900"
        >
          {title}
        </h2>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-savr-neutral-100 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
Modal.displayName = 'Modal';

export { Modal };
