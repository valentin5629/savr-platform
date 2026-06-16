'use client';

import { useRouter } from 'next/navigation';

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  /** URL cible + query string transmis au clic (§11 décision cartes cliquables) */
  href?: string;
  className?: string;
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
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${trendColor}`}>{value}</p>
    </div>
  );
}
