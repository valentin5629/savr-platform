'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { type Role, NAV_CONFIG } from '@/lib/nav-config';
import { useLogoZd, isZdSectionPath } from '@/components/layout/logo-context';
import { SavrLogoMark } from '@/components/layout/savr-logo';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
  role: Role;
  collapsed?: boolean;
  onToggle?: () => void;
  /** hrefs à masquer (ex : « Mon pack AG » si l'org n'a aucun pack — §06.05 l.71). */
  hiddenNavHrefs?: string[];
  /** Compteurs par href (ex : { '/admin/alertes': 3 }) → pastille sur l'item. */
  navBadges?: Record<string, number>;
  className?: string;
}

// Sidebar — bloc primaire plein primary-800 (levier #2)
// Item actif : fond primary-700 + barre accent-500 3px gauche
const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  (
    { role, collapsed = false, onToggle, hiddenNavHrefs, navBadges, className },
    ref,
  ) => {
    const pathname = usePathname();
    const { zdSelected } = useLogoZd();
    // Logo Savr : orange par défaut, vert dès qu'on est en contexte ZD — soit
    // par la navigation (section ZD-only), soit par une sélection ZD en cours
    // dans la page (ex : type de collecte ZD coché).
    const logoZd = zdSelected || isZdSectionPath(pathname);
    const hidden = new Set(hiddenNavHrefs ?? []);
    const groups = (NAV_CONFIG[role] ?? []).map((g) => ({
      ...g,
      items: g.items.filter((i) => !hidden.has(i.href)),
    }));

    return (
      <nav
        ref={ref}
        aria-label="Navigation principale"
        className={cn(
          'flex h-full flex-col bg-savr-primary-800 transition-[width] duration-[200ms] ease-out',
          collapsed ? 'w-16' : 'w-64',
          className,
        )}
      >
        {/* Logo / marque — asset officiel « + savr » teinté (orange par défaut,
            vert en contexte ZD), comme l'asset de marque monochrome */}
        <div
          data-testid="savr-logo"
          className={cn(
            'flex h-16 shrink-0 items-center border-b border-savr-primary-700 px-4 transition-colors duration-200',
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
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                const badgeCount = navBadges?.[item.href] ?? 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex h-10 items-center gap-3 rounded-savr-md px-3 text-sm font-medium transition-colors duration-[120ms]',
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
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-savr-accent-500"
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
                          className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-savr-error ring-2 ring-savr-primary-800"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    {!collapsed && <span>{item.label}</span>}
                    {!collapsed && badgeCount > 0 && (
                      <span
                        className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-savr-error px-1.5 py-0.5 text-xs font-semibold text-savr-white"
                        aria-label={`${badgeCount} alerte${badgeCount > 1 ? 's' : ''} ouverte${badgeCount > 1 ? 's' : ''}`}
                      >
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </span>
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
            <button
              onClick={onToggle}
              className={cn(
                'flex h-9 w-full items-center justify-center rounded-savr-md text-savr-primary-300 hover:bg-savr-primary-700 hover:text-savr-white transition-colors',
              )}
              aria-label={
                collapsed ? 'Développer la navigation' : 'Réduire la navigation'
              }
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        )}
      </nav>
    );
  },
);
Sidebar.displayName = 'Sidebar';

export { Sidebar };
