'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Menu, Bell, LogOut } from 'lucide-react';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';

interface TopBarProps {
  title?: string;
  userName?: string;
  onMenuToggle?: () => void;
  /**
   * Handler de déconnexion. Par défaut (non fourni) : `signOut()` côté client
   * puis redirection dure vers `/login`. Les layouts étant des Server
   * Components, ils ne peuvent pas passer de handler → le bouton fonctionne
   * de manière autonome.
   */
  onLogout?: () => void;
  className?: string;
}

const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  ({ title, userName, onMenuToggle, onLogout, className }, ref) => {
    const [loggingOut, setLoggingOut] = React.useState(false);

    const handleLogout = React.useCallback(async () => {
      if (onLogout) {
        onLogout();
        return;
      }
      setLoggingOut(true);
      try {
        const supabase = createBrowserSupabaseClient();
        await supabase.auth.signOut();
      } catch {
        /* on redirige vers /login même si le signOut échoue */
      }
      window.location.href = '/login';
    }, [onLogout]);

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

          <button
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="flex h-9 items-center gap-2 rounded-savr-md px-3 text-sm font-medium text-savr-neutral-600 hover:bg-savr-neutral-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 disabled:opacity-50"
            aria-label="Se déconnecter"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">
              {loggingOut ? 'Déconnexion…' : 'Se déconnecter'}
            </span>
          </button>
        </div>
      </header>
    );
  },
);
TopBar.displayName = 'TopBar';

export { TopBar };
