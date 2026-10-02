'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button, type ButtonProps } from './button';

// FormActions — rangée d'actions d'un formulaire ou pied de modale (R-UI-3,
// B5) : secondaire (annuler / retour) puis primaire, alignés à droite — règle
// §5.5 (8) et §5.9 « footer : actions alignées à droite ». Remplace les
// `flex justify-end gap-2 …` recopiés et fixe la position de « Annuler » (à
// gauche de l'action, partout). `loading` désactive les deux boutons et passe
// l'action en « en cours » (`Button loading`).
interface ActionProps extends Omit<ButtonProps, 'children' | 'loading'> {
  label: React.ReactNode;
}

interface FormActionsProps {
  /** Action secondaire ; absente = une seule action. */
  cancel?: ActionProps;
  /**
   * Action principale (`variant="primary"` par défaut). `type` : `submit` si
   * `form` est donné ou sans `onClick`, sinon `button` (pas de soumission
   * d'un formulaire parent par un simple `onClick`).
   */
  submit: ActionProps;
  loading?: boolean;
  /** Libellé pendant `loading` (ex. « Enregistrement… »). */
  loadingText?: React.ReactNode;
  /** Filet supérieur (rangée en bas d'un corps de modale ou de formulaire). */
  bordered?: boolean;
  className?: string;
}

const FormActions = React.forwardRef<HTMLDivElement, FormActionsProps>(
  (
    { cancel, submit, loading = false, loadingText, bordered, className },
    ref,
  ) => {
    const { label: cancelLabel, ...cancelRest } = cancel ?? { label: null };
    const { label: submitLabel, ...submitRest } = submit;
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-wrap justify-end gap-2',
          bordered && 'border-t border-savr-neutral-100 pt-4',
          className,
        )}
      >
        {cancel && (
          <Button
            type="button"
            variant="secondary"
            {...cancelRest}
            disabled={cancelRest.disabled || loading}
          >
            {cancelLabel}
          </Button>
        )}
        <Button
          type={
            submitRest.type ??
            (submitRest.form || !submitRest.onClick ? 'submit' : 'button')
          }
          {...submitRest}
          loading={loading}
          loadingText={loadingText}
        >
          {submitLabel}
        </Button>
      </div>
    );
  },
);
FormActions.displayName = 'FormActions';

export { FormActions };
