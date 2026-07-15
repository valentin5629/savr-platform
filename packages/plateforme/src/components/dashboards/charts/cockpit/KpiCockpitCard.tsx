'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { fmtDec } from './fmt';
import { Sparkline } from './Sparkline';

// KpiCockpitCard — carte KPI de la rangée « cockpit » (R24). Pastille couleur,
// grande valeur, badge de variation coloré (vert ≥0 / rouge <0) et micro
// sparkline optionnelle. Colonne flex `h-full` : la rangée du bas (badge +
// sparkline + `footer`) est plaquée en bas via `mt-auto` → toutes les cartes
// d'une même rangée gardent la MÊME hauteur, quel que soit leur contenu.
// `headerRight` (ex. tooltip d'aide) et `footer` (ex. badge d'état) vivent DANS
// la carte pour ne pas déformer la grille. Purement présentationnel.
interface KpiCockpitCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  dotColor: string;
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

function KpiCockpitCard({
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
}: KpiCockpitCardProps): React.JSX.Element {
  const rootClassName = cn(
    'flex h-full flex-col rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-5 shadow-savr-sm transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-savr-neutral-300 hover:shadow-savr-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
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
        <div className="flex shrink-0 items-center gap-2">
          {headerRight}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: dotColor,
            }}
          />
        </div>
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
              {`${variationPct >= 0 ? '▲' : '▼'} ${fmtDec(Math.abs(variationPct), 1)} %`}
            </span>
          ) : (
            <span />
          )}
          {sparkPoints != null && sparkPoints.length >= 2 && (
            <Sparkline points={sparkPoints} color={sparkColor ?? dotColor} />
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
KpiCockpitCard.displayName = 'KpiCockpitCard';

export { KpiCockpitCard };
