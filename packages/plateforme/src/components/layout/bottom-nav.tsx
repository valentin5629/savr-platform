'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getNavItems, hrefNavActif } from '@/lib/nav-config';
import type { NavRole } from '@/lib/roles';

interface BottomNavProps {
  role: NavRole;
  className?: string;
}

// Affiche les 4 premiers items de nav en bas d'écran (mobile)
const BottomNav = React.forwardRef<HTMLElement, BottomNavProps>(
  ({ role, className }, ref) => {
    const pathname = usePathname();
    const hrefActif = hrefNavActif(role, pathname);
    const items = getNavItems(role).slice(0, 4);

    return (
      <nav
        ref={ref}
        aria-label="Navigation mobile"
        className={cn(
          'fixed bottom-0 left-0 right-0 z-40 flex border-t border-savr-neutral-200 bg-savr-white lg:hidden',
          className,
        )}
      >
        {items.map((item) => {
          const isActive = item.href === hrefActif;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors',
                isActive
                  ? 'text-savr-primary-700'
                  : 'text-savr-neutral-500 hover:text-savr-neutral-900',
              )}
            >
              <Icon
                className={cn(
                  'h-5 w-5',
                  isActive ? 'text-savr-primary-700' : 'text-savr-neutral-400',
                )}
                aria-hidden="true"
              />
              {/* Deux lignes au plus : « Dashboard Admin » et « Dashboard
                  Client » ne se distinguent pas, coupés à « Dashbo… ». */}
              <span className="line-clamp-2 max-w-full px-1 text-center leading-tight">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    );
  },
);
BottomNav.displayName = 'BottomNav';

export { BottomNav };
