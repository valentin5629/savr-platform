'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { BellIcon, ListIcon } from '@/components/ui/icones';
import { Heading } from '@/components/ui/heading';
import { IconButton } from '@/components/ui/icon-button';

interface TopBarProps {
  title?: string;
  onMenuToggle?: () => void;
  className?: string;
}

// L'organisation, l'utilisateur et « Se déconnecter » sont en bas de la
// Sidebar (Val 2026-10-30) : l'en-tête garde le titre et les notifications.
const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  ({ title, onMenuToggle, className }, ref) => {
    return (
      <header
        ref={ref}
        className={cn(
          'flex h-16 shrink-0 items-center justify-between border-b border-savr-neutral-200 bg-savr-white px-4 gap-4',
          className,
        )}
      >
        <div className="flex items-center gap-3">
          {onMenuToggle && (
            <IconButton
              size="sm"
              onClick={onMenuToggle}
              className="lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <ListIcon aria-hidden="true" />
            </IconButton>
          )}
          {title && (
            <Heading level={1} size="xl" tight>
              {title}
            </Heading>
          )}
        </div>

        <div className="flex items-center gap-2">
          <IconButton size="sm" aria-label="Notifications">
            <BellIcon aria-hidden="true" />
          </IconButton>
        </div>
      </header>
    );
  },
);
TopBar.displayName = 'TopBar';

export { TopBar };
