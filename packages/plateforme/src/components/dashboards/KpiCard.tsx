'use client';

import { useRouter } from 'next/navigation';
import { Tooltip } from '@/components/ui/tooltip';

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  /** URL cible + query string transmis au clic (§11 décision cartes cliquables) */
  href?: string;
  className?: string;
  /** Info-bulle explicative du KPI (ex. formule Marge, BL-P3-02). Marqueur « ? » à côté du libellé. */
  tooltip?: React.ReactNode;
}

/**
 * Carte KPI cliquable — clic navigue vers la liste collectes avec filtres transmis en query string (§11).
 */
export function KpiCard({
  label,
  value,
  trend,
  href,
  className,
  tooltip,
}: KpiCardProps) {
  const router = useRouter();

  const trendColor =
    trend === 'up'
      ? 'text-green-600'
      : trend === 'down'
        ? 'text-red-600'
        : 'text-muted-foreground';

  const base =
    'rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const interactive = href ? 'cursor-pointer hover:shadow-md' : '';

  function handleClick() {
    if (href) router.push(href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (href && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      router.push(href);
    }
  }

  return (
    <div
      role={href ? 'button' : undefined}
      tabIndex={href ? 0 : undefined}
      aria-label={href ? `Voir les collectes : ${label}` : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`${base} ${interactive} ${className ?? ''}`}
    >
      <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {tooltip != null && (
          <Tooltip content={tooltip}>
            <span
              role="note"
              tabIndex={0}
              aria-label={typeof tooltip === 'string' ? tooltip : label}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-current text-[10px] leading-none"
            >
              ?
            </span>
          </Tooltip>
        )}
      </p>
      <p className={`mt-1 text-2xl font-bold ${trendColor}`}>{value}</p>
    </div>
  );
}
