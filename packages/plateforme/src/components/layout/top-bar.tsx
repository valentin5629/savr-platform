'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Menu, Bell, LogOut } from 'lucide-react';

interface TopBarProps {
  title?: string;
  userName?: string;
  onMenuToggle?: () => void;
  onLogout?: () => void;
  className?: string;
}

const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  ({ title, userName, onMenuToggle, onLogout, className }, ref) => (
    <header
      ref={ref}
      className={cn(
        'flex h-16 shrink-0 items-center justify-between border-b border-savr-neutral-200 bg-savr-white px-4 gap-4',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="flex h-9 w-9 items-center justify-center rounded-savr-md text-savr-neutral-600 hover:bg-savr-neutral-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 lg:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {title && (
          <h1 className="text-xl font-bold tracking-[-0.02em] text-savr-neutral-900">
            {title}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          className="flex h-9 w-9 items-center justify-center rounded-savr-md text-savr-neutral-600 hover:bg-savr-neutral-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
        </button>

        {userName && (
          <span className="hidden sm:block text-sm font-medium text-savr-neutral-700 px-2">
            {userName}
          </span>
        )}

        {onLogout && (
          <button
            onClick={onLogout}
            className="flex h-9 w-9 items-center justify-center rounded-savr-md text-savr-neutral-600 hover:bg-savr-neutral-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
            aria-label="Se déconnecter"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  ),
);
TopBar.displayName = 'TopBar';

export { TopBar };
