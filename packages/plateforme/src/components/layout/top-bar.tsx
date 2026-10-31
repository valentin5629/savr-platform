'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { ListIcon } from '@/components/ui/icones';
import { IconButton } from '@/components/ui/icon-button';

interface TopBarProps {
  onMenuToggle?: () => void;
  className?: string;
}

// Plus de barre d'en-tête sur ordinateur (Val 2026-10-30) : ni titre d'espace
// ni cloche. Sur téléphone, il reste le seul bouton qui ouvre la barre latérale
// (menu complet, organisation, « Se déconnecter »).
const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  ({ onMenuToggle, className }, ref) => {
    if (!onMenuToggle) return null;
    return (
      <header
        ref={ref}
        className={cn(
          'flex h-14 shrink-0 items-center border-b border-savr-neutral-200 bg-savr-white px-4 lg:hidden',
          className,
        )}
      >
        <IconButton
          size="sm"
          onClick={onMenuToggle}
          aria-label="Ouvrir le menu"
        >
          <ListIcon aria-hidden="true" />
        </IconButton>
      </header>
    );
  },
);
TopBar.displayName = 'TopBar';

export { TopBar };
