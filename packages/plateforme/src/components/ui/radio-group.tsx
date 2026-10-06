'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// RadioGroup — choix unique parmi N (§10 §6 « Formulaires », R-UI-5 F2).
// Composant maison, sans dépendance Radix : `<fieldset role="radiogroup">` +
// `<input type="radio">` natifs partageant un même `name`. Le navigateur
// fournit donc le clavier attendu (Tab entre dans le groupe sur l'option
// cochée, flèches = déplacer ET cocher) et la soumission de formulaire.
// Rendu calqué sur `Checkbox` : 20 px, bordure neutral-300, coché = anneau
// primary-700 épais (pastille centrale blanche), focus ring signature (levier #4).
// Le libellé de chaque option est un `<Label variant="choice">` posé par
// l'appelant (option en ligne ou carte cliquable), qui reste maître de la mise
// en page.

interface RadioGroupContextValue {
  name: string;
  value: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(
  null,
);

export interface RadioGroupProps extends Omit<
  React.FieldsetHTMLAttributes<HTMLFieldSetElement>,
  'onChange' | 'defaultValue'
> {
  /** Valeur cochée (contrôlé). Chaîne vide = aucune option cochée. */
  value: string;
  onValueChange?: (value: string) => void;
  /** `name` partagé des radios ; généré si absent. */
  name?: string;
  /** Légende du groupe (nom accessible). `legendClassName="sr-only"` pour la masquer. */
  legend?: React.ReactNode;
  legendClassName?: string;
  required?: boolean;
}

const RadioGroup = React.forwardRef<HTMLFieldSetElement, RadioGroupProps>(
  (
    {
      value,
      onValueChange,
      name,
      legend,
      legendClassName,
      required,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const autoName = React.useId();
    const legendId = React.useId();
    const ctx = React.useMemo<RadioGroupContextValue>(
      () => ({
        name: name ?? autoName,
        value,
        onValueChange,
        disabled,
        required,
      }),
      [name, autoName, value, onValueChange, disabled, required],
    );
    return (
      <fieldset
        ref={ref}
        role="radiogroup"
        aria-labelledby={legend ? legendId : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        className={cn('m-0 min-w-0 border-0 p-0', className)}
        {...props}
      >
        {legend && (
          <legend
            id={legendId}
            className={cn(
              'mb-1.5 text-sm font-semibold text-savr-neutral-700',
              legendClassName,
            )}
          >
            {legend}
          </legend>
        )}
        <RadioGroupContext.Provider value={ctx}>
          {children}
        </RadioGroupContext.Provider>
      </fieldset>
    );
  },
);
RadioGroup.displayName = 'RadioGroup';

export interface RadioGroupItemProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'name' | 'checked' | 'defaultChecked' | 'value'
> {
  value: string;
}

const RadioGroupItem = React.forwardRef<HTMLInputElement, RadioGroupItemProps>(
  ({ value, className, disabled, onChange, ...props }, ref) => {
    const ctx = React.useContext(RadioGroupContext);
    if (!ctx) {
      throw new Error('RadioGroupItem doit être placé dans un RadioGroup.');
    }
    return (
      <input
        ref={ref}
        type="radio"
        name={ctx.name}
        value={value}
        checked={ctx.value === value}
        required={ctx.required}
        disabled={disabled || ctx.disabled}
        onChange={(e) => {
          onChange?.(e);
          if (e.target.checked) ctx.onValueChange?.(value);
        }}
        className={cn(
          'peer h-5 w-5 shrink-0 cursor-pointer appearance-none rounded-savr-full border border-savr-neutral-300 bg-savr-white transition-colors',
          'checked:border-[6px] checked:border-savr-primary-700',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
RadioGroupItem.displayName = 'RadioGroupItem';

export { RadioGroup, RadioGroupItem };
