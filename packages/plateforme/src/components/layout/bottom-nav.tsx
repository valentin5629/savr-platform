'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { type Role, NAV_CONFIG } from '@/lib/nav-config';

interface BottomNavProps {
  role: Role;
  /** hrefs à masquer (ex : « Mon pack AG » si l'org n'a aucun pack — §06.05 l.71). */
  hiddenNavHrefs?: string[];
  className?: string;
}

// Affiche les 4 premiers items de nav en bas d'écran (mobile)
const BottomNav = React.forwardRef<HTMLElement, BottomNavProps>(
  ({ role, hiddenNavHrefs, className }, ref) => {
    const pathname = usePathname();
    const hidden = new Set(hiddenNavHrefs ?? []);
    const items = (NAV_CONFIG[role]?.flatMap((g) => g.items) ?? [])
      .filter((i) => !hidden.has(i.href))
      .slice(0, 4);

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
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors',
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
              <span className="truncate max-w-[60px]">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  },
);
BottomNav.displayName = 'BottomNav';

export { BottomNav };
