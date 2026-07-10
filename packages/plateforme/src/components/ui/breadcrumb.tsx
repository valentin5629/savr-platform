'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Breadcrumb — fil d'Ariane (§10 §6 « Breadcrumb », ex. Dashboard → Événement →
// Collecte). Séparateur ChevronRight (Lucide, §9). Le dernier item porte
// aria-current="page" et n'est pas un lien. §10 ne détaille pas le style →
// tokens neutres §2.3 + focus ring hérité (levier #4).
export interface BreadcrumbItem {
  label: string;
  /** Lien de l'item. Omis = item courant (dernier), rendu en texte. */
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

const Breadcrumb = React.forwardRef<HTMLElement, BreadcrumbProps>(
  ({ items, className }, ref) => (
    <nav ref={ref} aria-label="Fil d'Ariane" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li
              key={`${item.label}-${i}`}
              className="flex items-center gap-1.5"
            >
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="rounded-savr-sm text-savr-neutral-500 transition-colors hover:text-savr-primary-700"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    isLast
                      ? 'font-semibold text-savr-neutral-900'
                      : 'text-savr-neutral-500',
                  )}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-savr-neutral-400"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  ),
);
Breadcrumb.displayName = 'Breadcrumb';

export { Breadcrumb };
