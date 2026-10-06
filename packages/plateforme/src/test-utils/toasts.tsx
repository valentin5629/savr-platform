import * as React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Rendu sous `ToastProvider` (monté par `app/layout.tsx` en vrai) : à utiliser
 * dans les tests qui vérifient un message de succès devenu Toast (R-UI-1 H1).
 */
export function renderAvecToasts(
  ui: React.ReactElement,
  options?: RenderOptions,
) {
  return render(ui, {
    wrapper: ({ children }) => <ToastProvider>{children}</ToastProvider>,
    ...options,
  });
}
