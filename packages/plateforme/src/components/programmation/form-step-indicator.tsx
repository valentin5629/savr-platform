'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface Step {
  label: string;
  description?: string;
}

interface FormStepIndicatorProps {
  steps: Step[];
  current: number; // 0-indexed
  className?: string;
}

export function FormStepIndicator({
  steps,
  current,
  className,
}: FormStepIndicatorProps) {
  return (
    <nav
      aria-label="Étapes du formulaire"
      className={cn('flex gap-0', className)}
    >
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={i}>
            <div className="flex flex-col items-center gap-1 min-w-0">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold border-2 shrink-0 transition-colors duration-150',
                  done
                    ? 'bg-savr-success border-savr-success text-savr-white'
                    : active
                      ? 'bg-savr-primary-700 border-savr-primary-700 text-savr-white'
                      : 'bg-savr-white border-savr-neutral-300 text-savr-neutral-400',
                )}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <Check className="h-4 w-4" /> : <span>{i + 1}</span>}
              </div>
              <span
                className={cn(
                  'text-xs font-medium text-center hidden sm:block',
                  active
                    ? 'text-savr-primary-700'
                    : done
                      ? 'text-savr-neutral-600'
                      : 'text-savr-neutral-400',
                )}
              >
                {step.label}
              </span>
            </div>

            {i < steps.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mt-4 mx-2 transition-colors duration-150',
                  i < current ? 'bg-savr-success' : 'bg-savr-neutral-200',
                )}
                aria-hidden="true"
              />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
