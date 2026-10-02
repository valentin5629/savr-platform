'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { fmtPct } from '@/lib/format';
import { Sparkline } from './sparkline';

// StatCard — carte KPI unique de l'app (R-UI-6b, I6 : fusion de l'ancienne
// `StatCard` ui, 1 usage, et de `KpiCockpitCard`, 55 usages — API et rendu de
// cette dernière conservés). Pastille couleur optionnelle, grande valeur,
// badge de variation coloré (vert ≥ 0 / rouge < 0) et micro sparkline
// optionnelle. Colonne flex `h-full` : la rangée du bas (badge + sparkline +
// `footer`) est plaquée en bas via `mt-auto` → toutes les cartes d'une même
// rangée gardent la MÊME hauteur, quel que soit leur contenu. `headerRight`
// (ex. tooltip d'aide) et `footer` (ex. badge d'état) vivent DANS la carte
// pour ne pas déformer la grille. Purement présentationnel.
interface StatCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  /** Couleur de la pastille (token `var(--color-savr-*)`). Absente = pas de pastille. */
  dotColor?: string;
  variationPct?: number | null;
  sparkPoints?: number[];
  sparkColor?: string;
  href?: string;
  /** Carte cliquable (ex. ouvre une modale de détail) — rendue en <button>. */
  onClick?: () => void;
  className?: string;
  /** Contenu à droite de l'en-tête (avant la pastille) — ex. tooltip d'aide. */
  headerRight?: React.ReactNode;
  /** Contenu plaqué en bas de la carte — ex. badge d'état. */
  footer?: React.ReactNode;
  /**
   * Réserve la hauteur de 2 lignes pour le libellé → la valeur démarre à la même
   * ligne sur toute une rangée, quel que soit le nombre de lignes du titre.
   * Opt-in (défaut inchangé) pour ne pas décaler les dashboards cockpit existants.
   */
  reserveTwoLineLabel?: boolean;
}

function StatCard({
  label,
  value,
  unit,
  dotColor,
  variationPct,
  sparkPoints,
  sparkColor,
  href,
  onClick,
  className,
  headerRight,
  footer,
  reserveTwoLineLabel,
}: StatCardProps): React.JSX.Element {
  const rootClassName = cn(
    'flex h-full flex-col rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-5 shadow-savr-sm transition-[transform,box-shadow,border-color] duration-savr-fast hover:-translate-y-0.5 hover:border-savr-neutral-300 hover:shadow-savr-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
    className,
  );

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-[0.08em] text-savr-neutral-500',
            reserveTwoLineLabel && 'block min-h-[2.6em] leading-[1.3]',
          )}
        >
          {label}
        </span>
        {(headerRight || dotColor) && (
          <div className="flex shrink-0 items-center gap-2">
            {headerRight}
            {dotColor && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: dotColor,
                }}
              />
            )}
          </div>
        )}
      </div>

      <div className="mt-2.5">
        <div className="flex items-baseline gap-1">
          <span className="text-[34px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-savr-neutral-900">
            {value}
          </span>
          {unit && (
            <span className="text-[17px] font-bold text-savr-neutral-400">
              {unit}
            </span>
          )}
        </div>
      </div>

      <div className="mt-auto">
        <div className="mt-3 flex items-center justify-between">
          {variationPct != null ? (
            <span
              title="Variation vs période précédente équivalente"
              className={cn(
                'inline-flex items-center gap-1 rounded-savr-full px-2 py-0.5 text-xs font-extrabold tabular-nums',
                variationPct >= 0
                  ? 'bg-savr-success-subtle text-savr-success-strong'
                  : 'bg-savr-error-subtle text-savr-error',
              )}
            >
              {`${variationPct >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(variationPct), 1)}`}
            </span>
          ) : (
            <span />
          )}
          {sparkPoints != null && sparkPoints.length >= 2 && (
            <Sparkline
              points={sparkPoints}
              color={sparkColor ?? dotColor ?? 'var(--color-savr-primary-700)'}
            />
          )}
        </div>
        {footer && <div className="mt-2.5">{footer}</div>}
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} className={rootClassName} tabIndex={0}>
        {body}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(rootClassName, 'cursor-pointer text-left')}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={rootClassName} tabIndex={0}>
      {body}
    </div>
  );
}
StatCard.displayName = 'StatCard';

// StatCardGrid — grille responsive de KPIs (§8 « Dashboard KPIs : 1 col mobile /
// 2 tablet / 3-4 desktop »). Encode la règle une fois pour que les dashboards la
// réutilisent au lieu de la redéfinir écran par écran.
interface StatCardGridProps {
  children: React.ReactNode;
  /** Nombre de colonnes desktop (≥ 1024px). 3 ou 4. Défaut 4. */
  desktopCols?: 3 | 4;
  className?: string;
}

const StatCardGrid = React.forwardRef<HTMLDivElement, StatCardGridProps>(
  ({ children, desktopCols = 4, className }, ref) => (
    <div
      ref={ref}
      className={cn(
        // 1 col mobile · 2 tablet (≥640px) · 3-4 desktop (≥1024px)
        'grid grid-cols-1 gap-4 sm:grid-cols-2',
        desktopCols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  ),
);
StatCardGrid.displayName = 'StatCardGrid';

export { StatCard, StatCardGrid };
