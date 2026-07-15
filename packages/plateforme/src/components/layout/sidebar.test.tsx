/**
 * Sidebar — teinte contextuelle de la marque cœur Savr.
 * Orange (`text-savr-accent-500`) par défaut ; vert (`text-savr-success`) dès
 * qu'on est en contexte ZD : soit par la navigation (section `/registre`,
 * ZD-only §06.03), soit par une sélection ZD en cours dans la page (signalée
 * via `useSignalZdSelection`). Le logomark porte `fill=currentColor`, donc la
 * teinte est portée par la classe `text-*` du SVG.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let currentPath = '/traiteur';
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { Sidebar } from './sidebar';
import {
  LogoZdProvider,
  useSignalZdSelection,
  isZdSectionPath,
} from './logo-context';

function ZdSignal({ active }: { active: boolean }) {
  useSignalZdSelection(active);
  return null;
}

describe('Sidebar — logo orange/vert selon le contexte ZD', () => {
  it('orange par défaut sur une route non-ZD', () => {
    currentPath = '/traiteur';
    render(<Sidebar role="traiteur_manager" />);
    expect(screen.getByTestId('savr-logo').getAttribute('class')).toContain(
      'text-savr-accent-500',
    );
  });

  it('vert par navigation sur le Registre réglementaire (ZD-only)', () => {
    currentPath = '/registre';
    render(<Sidebar role="traiteur_manager" />);
    expect(screen.getByTestId('savr-logo').getAttribute('class')).toContain(
      'text-savr-success',
    );
  });

  it('vert quand une sélection ZD est signalée, même hors route ZD', () => {
    currentPath = '/programmer/nouveau';
    render(
      <LogoZdProvider>
        <ZdSignal active />
        <Sidebar role="traiteur_manager" />
      </LogoZdProvider>,
    );
    expect(screen.getByTestId('savr-logo').getAttribute('class')).toContain(
      'text-savr-success',
    );
  });

  it('reste orange quand la sélection ZD est inactive (AG)', () => {
    currentPath = '/programmer/nouveau';
    render(
      <LogoZdProvider>
        <ZdSignal active={false} />
        <Sidebar role="traiteur_manager" />
      </LogoZdProvider>,
    );
    expect(screen.getByTestId('savr-logo').getAttribute('class')).toContain(
      'text-savr-accent-500',
    );
  });
});

describe('isZdSectionPath', () => {
  it('vrai sur le registre et ses sous-pages', () => {
    expect(isZdSectionPath('/registre')).toBe(true);
    expect(isZdSectionPath('/registre/123')).toBe(true);
  });
  it('faux ailleurs', () => {
    expect(isZdSectionPath('/traiteur')).toBe(false);
    expect(isZdSectionPath('/programmer/nouveau')).toBe(false);
  });
});
