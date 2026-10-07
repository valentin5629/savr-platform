'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Menu, Bell, LogOut } from 'lucide-react';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { IconButton } from '@/components/ui/icon-button';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';

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
      window.location.href = ROUTES.login;
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
            <IconButton
              size="sm"
              onClick={onMenuToggle}
              className="lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <Menu aria-hidden="true" />
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
            <Bell aria-hidden="true" />
          </IconButton>

          {userName && (
            <Text
              as="span"
              variant="body"
              className="hidden sm:block font-medium px-2"
            >
              {userName}
            </Text>
          )}

          <Button
            variant="ghost"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="h-9 px-3 font-medium text-savr-neutral-600 hover:bg-savr-neutral-100 sm:h-9 [&>svg]:h-5 [&>svg]:w-5"
            aria-label="Se déconnecter"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">
              {loggingOut ? 'Déconnexion…' : 'Se déconnecter'}
            </span>
          </Button>
        </div>
      </header>
    );
  },
);
TopBar.displayName = 'TopBar';

export { TopBar };
