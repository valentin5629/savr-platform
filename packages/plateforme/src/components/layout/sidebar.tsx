'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_CONFIG, hrefNavActif } from '@/lib/nav-config';
import type { NavRole } from '@/lib/roles';
import { useLogoZd, isZdSectionPath } from '@/components/layout/logo-context';
import { SavrLogoMark } from '@/components/layout/savr-logo';
import {
  CaretLeftIcon,
  CaretRightIcon,
  SignOutIcon,
} from '@/components/ui/icones';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { ROUTES } from '@/lib/routes';
import { initiales } from '@/components/dashboards/charts/cockpit/fmt';
import type { IdentiteSession } from '@/lib/identite-session';

// Logo de l'organisation sur une tuile blanche, ENTIER (object-contain, jamais
// rogné) ; initiales si l'organisation n'a pas de logo ou s'il ne charge pas.
function LogoOrganisation({
  identite,
  collapsed,
}: {
  identite: IdentiteSession;
  collapsed: boolean;
}) {
  const [logoKo, setLogoKo] = React.useState(false);
  const logo = identite.logoSrc && !logoKo ? identite.logoSrc : null;
  return (
    <span
      data-testid="logo-organisation"
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-savr-md bg-savr-white p-1 text-sm font-semibold text-savr-primary-800',
        collapsed ? 'h-11 w-12' : 'h-14 w-20',
      )}
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setLogoKo(true)}
        />
      ) : (
        initiales(identite.organisation ?? identite.utilisateur)
      )}
    </span>
  );
}

interface SidebarProps {
  role: NavRole;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Organisation et utilisateur, affichés au-dessus de « Se déconnecter ». */
  identite?: IdentiteSession | null;
  /**
   * Handler de déconnexion. Par défaut (non fourni) : `signOut()` côté client
   * puis redirection dure vers `/login` (les layouts, Server Components, ne
   * peuvent pas passer de handler).
   */
  onLogout?: () => void;
  /** hrefs à masquer (ex : « Mon pack AG » si l'org n'a aucun pack). */
  hiddenNavHrefs?: string[];
  /** Compteurs par href (ex : { '/admin/alertes': 3 }) → pastille sur l'item. */
  navBadges?: Record<string, number>;
  className?: string;
}

// Sidebar — bloc primaire plein primary-800 (levier #2)
// Item actif : fond primary-700 + barre accent-500 3px gauche
const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  (
    {
      role,
      collapsed = false,
      onToggle,
      onLogout,
      identite,
      hiddenNavHrefs,
      navBadges,
      className,
    },
    ref,
  ) => {
    const pathname = usePathname();
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
    const { zdSelected } = useLogoZd();
    // Logo Savr : orange par défaut, vert dès qu'on est en contexte ZD — soit
    // par la navigation (section ZD-only), soit par une sélection ZD en cours
    // dans la page (ex : type de collecte ZD coché).
    const logoZd = zdSelected || isZdSectionPath(pathname);
    const hidden = new Set(hiddenNavHrefs ?? []);
    const hrefActif = hrefNavActif(role, pathname);
    const groups = (NAV_CONFIG[role] ?? []).map((g) => ({
      ...g,
      items: g.items.filter((i) => !hidden.has(i.href)),
    }));

    return (
      <nav
        ref={ref}
        aria-label="Navigation principale"
        className={cn(
          'flex h-full flex-col bg-savr-primary-800 transition-[width] duration-savr-base ease-out',
          collapsed ? 'w-16' : 'w-64',
          className,
        )}
      >
        {/* Logo / marque — asset officiel « + savr » teinté (orange par défaut,
            vert en contexte ZD), comme l'asset de marque monochrome */}
        <div
          data-testid="savr-logo"
          className={cn(
            'flex h-16 shrink-0 items-center border-b border-savr-primary-700 px-4 transition-colors duration-savr-base',
            collapsed && 'justify-center px-0',
            logoZd ? 'text-savr-success' : 'text-savr-accent-500',
          )}
        >
          <SavrLogoMark
            title="savr"
            variant={collapsed ? 'mark' : 'full'}
            className={collapsed ? 'h-7 w-7' : 'h-8 w-auto'}
          />
        </div>

        {/* Items de nav */}
        <div className="flex-1 overflow-y-auto py-4 space-y-1 px-2">
          {groups.map((group, gi) => (
            <div key={gi} className="space-y-0.5">
              {group.title && !collapsed && (
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-savr-primary-300">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => {
                const isActive = item.href === hrefActif;
                const Icon = item.icon;
                const badgeCount = navBadges?.[item.href] ?? 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex h-10 items-center gap-3 rounded-savr-md px-3 text-sm font-medium transition-colors duration-savr-fast',
                      isActive
                        ? 'bg-savr-primary-700 text-savr-white'
                        : 'text-savr-primary-200 hover:bg-savr-primary-700 hover:text-savr-white',
                      collapsed && 'justify-center px-0',
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    {/* Barre accent gauche sur item actif */}
                    {isActive && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-savr-full bg-savr-accent-500"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative shrink-0">
                      <Icon
                        className={cn(
                          'h-5 w-5',
                          isActive
                            ? 'text-savr-white'
                            : 'text-savr-primary-200 group-hover:text-savr-white',
                        )}
                        aria-hidden="true"
                      />
                      {/* Collapsé : point rouge (le compteur n'a pas la place). */}
                      {collapsed && badgeCount > 0 && (
                        <span
                          className="absolute -right-1 -top-1 h-2 w-2 rounded-savr-full bg-savr-error ring-2 ring-savr-primary-800"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    {!collapsed && <span>{item.label}</span>}
                    {!collapsed && badgeCount > 0 && (
                      <Badge
                        variant="count"
                        className="ml-auto"
                        aria-label={`${badgeCount} alerte${badgeCount > 1 ? 's' : ''} ouverte${badgeCount > 1 ? 's' : ''}`}
                      >
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Toggle collapse */}
        {onToggle && (
          <div className="shrink-0 border-t border-savr-primary-700 p-2">
            <IconButton
              size="sm"
              onClick={onToggle}
              className="w-full text-savr-primary-300 hover:bg-savr-primary-700 hover:text-savr-white [&>svg]:h-4 [&>svg]:w-4"
              aria-label={
                collapsed ? 'Développer la navigation' : 'Réduire la navigation'
              }
            >
              {collapsed ? (
                <CaretRightIcon className="h-4 w-4" aria-hidden="true" />
              ) : (
                <CaretLeftIcon className="h-4 w-4" aria-hidden="true" />
              )}
            </IconButton>
          </div>
        )}
        {/* Qui est connecté puis déconnexion — tout en bas (Val 2026-10-30, ex-TopBar) */}
        <div className="shrink-0 border-t border-savr-primary-700 p-2">
          {identite && (identite.organisation || identite.utilisateur) && (
            <div
              data-testid="identite-session"
              title={
                collapsed
                  ? [identite.organisation, identite.utilisateur]
                      .filter(Boolean)
                      .join(' — ')
                  : undefined
              }
              className={cn(
                'mb-1 flex items-center gap-3 px-1 py-2',
                collapsed && 'justify-center px-0',
              )}
            >
              <LogoOrganisation identite={identite} collapsed={collapsed} />
              <div className={cn('min-w-0', collapsed && 'sr-only')}>
                {identite.organisation && (
                  <p className="truncate text-sm font-semibold text-savr-white">
                    {identite.organisation}
                  </p>
                )}
                {identite.utilisateur && (
                  <p className="truncate text-sm text-savr-primary-200">
                    {identite.utilisateur}
                  </p>
                )}
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            onClick={() => void handleLogout()}
            loading={loggingOut}
            loadingText={collapsed ? '' : <span>Déconnexion…</span>}
            aria-label="Se déconnecter"
            title={collapsed ? 'Se déconnecter' : undefined}
            className={cn(
              // Mêmes teintes que les entrées du menu (fond primary-800).
              'h-10 w-full justify-start gap-3 px-3 font-medium text-savr-primary-200 hover:bg-savr-primary-700 hover:text-savr-white active:bg-savr-primary-700 sm:h-10 [&>svg]:h-5 [&>svg]:w-5',
              collapsed && 'justify-center px-0',
            )}
          >
            <SignOutIcon aria-hidden="true" />
            {!collapsed && <span>Se déconnecter</span>}
          </Button>
        </div>
      </nav>
    );
  },
);
Sidebar.displayName = 'Sidebar';

export { Sidebar };
