'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { BellIcon, ListIcon } from '@/components/ui/icones';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { IconButton } from '@/components/ui/icon-button';
import { initiales } from '@/components/dashboards/charts/cockpit/fmt';
import type { IdentiteOrganisation } from '@/lib/identite-organisation';

interface TopBarProps {
  title?: string;
  /** Repli quand l'organisation n'est pas connue (staff Savr). */
  userName?: string;
  /**
   * Organisation de l'utilisateur : avatar (logo ou initiales) + nom, en haut à
   * droite (Val 2026-10-30). « Se déconnecter » est en bas de la Sidebar.
   */
  organisation?: IdentiteOrganisation | null;
  onMenuToggle?: () => void;
  className?: string;
}

// Avatar rond de l'organisation : son logo, ou ses initiales s'il n'y en a pas
// ou si le fichier ne se charge pas.
function AvatarOrganisation({
  organisation,
}: {
  organisation: IdentiteOrganisation;
}) {
  const [logoKo, setLogoKo] = React.useState(false);
  const logo = organisation.logoSrc && !logoKo ? organisation.logoSrc : null;
  return (
    <span
      data-testid="avatar-organisation"
      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-savr-full border border-savr-neutral-200 bg-savr-primary-50 text-xs font-semibold text-savr-primary-800"
      aria-hidden="true"
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          className="h-full w-full bg-savr-white object-contain"
          onError={() => setLogoKo(true)}
        />
      ) : (
        initiales(organisation.nom)
      )}
    </span>
  );
}

const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  ({ title, userName, organisation, onMenuToggle, className }, ref) => {
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

        <div className="flex min-w-0 items-center gap-2">
          <IconButton size="sm" aria-label="Notifications">
            <BellIcon aria-hidden="true" />
          </IconButton>

          {organisation ? (
            <div
              data-testid="organisation-entete"
              className="flex min-w-0 items-center gap-2 pl-2"
            >
              <AvatarOrganisation organisation={organisation} />
              <Text
                as="span"
                variant="body"
                className="hidden max-w-64 truncate font-medium sm:block"
              >
                {organisation.nom}
              </Text>
            </div>
          ) : (
            userName && (
              <Text
                as="span"
                variant="body"
                className="hidden sm:block font-medium px-2"
              >
                {userName}
              </Text>
            )
          )}
        </div>
      </header>
    );
  },
);
TopBar.displayName = 'TopBar';

export { TopBar };
