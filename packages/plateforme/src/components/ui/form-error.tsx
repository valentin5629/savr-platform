'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// FormError — message d'erreur inline (§10 §6 « FormError », recette §5.5 :
// texte error-strong + icône). Extrait de FormField pour être réutilisable
// hors du FormField (ex. erreur de groupe, erreur serveur d'un formulaire).
// `role="alert"` + `aria-live` (§10 accessibilité : aria-live sur les erreurs).
interface FormErrorProps {
  /** Message d'erreur. Non rendu si vide/undefined. */
  children?: React.ReactNode;
  id?: string;
  className?: string;
}

function FormError({ children, id, className }: FormErrorProps) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-center gap-1 text-xs text-savr-error-strong',
        className,
      )}
    >
      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

export { FormError };
